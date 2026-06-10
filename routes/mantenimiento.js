// API REST del módulo de Mantenimiento: tareas tipo kanban (columnas por estado),
// notas (hilo cronológico), fotos de incidencia e historial por apartamento.
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db/database');
const { registrarActividad } = require('../services/actividadService');

const router = express.Router();

const UPLOAD_BASE = path.join(__dirname, '..', 'public', 'uploads', 'mantenimiento');
const EXT_PERMITIDAS = ['.jpg', '.jpeg', '.png', '.webp'];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const ESTADOS = ['urgente', 'pendiente', 'en_proceso', 'completada'];

function txt(v) { return v === undefined || v === null || v === '' ? null : String(v); }
function aEntero(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}
function esAdmin(req) { return req.usuario && req.usuario.rol === 'administrador'; }

// Extrae un teléfono de un texto de observaciones. Busca primero una etiqueta
// TEL/TELF/TFNO/MÓVIL seguida de dígitos; si no, un prefijo +34; si no, un número
// español de 9 dígitos. Devuelve el número normalizado (sin espacios) o null.
function extraerTelefono(texto) {
  if (!texto) return null;
  const s = String(texto);
  const etiquetado = s.match(/(?:tel[eéf]*|tfno|m[oó]vil)\.?\s*:?\s*(\+?[\d][\d\s.\-]{6,}\d)/i);
  if (etiquetado) return etiquetado[1].replace(/[\s.\-]/g, '');
  const internacional = s.match(/\+\d{1,3}[\s.\-]?\d[\d\s.\-]{6,}\d/);
  if (internacional) return internacional[0].replace(/[\s.\-]/g, '');
  const espanol = s.match(/(?<!\d)([679]\d{2}[\s.\-]?\d{3}[\s.\-]?\d{3})(?!\d)/);
  if (espanol) return espanol[1].replace(/[\s.\-]/g, '');
  return null;
}

// Vincula los datos del cliente (nombre + teléfono) a partir de una reserva.
function datosCliente(reserva) {
  if (!reserva) return { cliente_nombre: null, cliente_telefono: null };
  return {
    cliente_nombre: reserva.nombre_cliente || null,
    cliente_telefono: extraerTelefono(reserva.observaciones),
  };
}

// GET /api/mantenimiento/resumen — contadores globales.
router.get('/resumen', (req, res) => {
  const r = db.prepare(`
    SELECT
      COALESCE(SUM(estado <> 'completada'), 0) AS total_abiertas,
      COALESCE(SUM(estado = 'urgente'), 0) AS urgentes,
      COALESCE(SUM(estado = 'en_proceso'), 0) AS en_proceso,
      COALESCE(SUM(estado = 'completada' AND strftime('%Y-%m', completado_fecha) = strftime('%Y-%m', 'now')), 0) AS completadas_este_mes
    FROM mantenimiento_tareas
  `).get();
  res.json(r);
});

// GET /api/mantenimiento/historial?apartamento_id=&anio= — tareas de un apartamento ese
// año con sus notas, nº de fotos y un resumen por estado.
router.get('/historial', (req, res) => {
  const apartamentoId = aEntero(req.query.apartamento_id);
  if (apartamentoId === null) return res.status(400).json({ error: 'apartamento_id es obligatorio' });

  let sql = `
    SELECT t.*, a.nombre AS apartamento_nombre, a.tipo AS apartamento_tipo,
           (SELECT COUNT(*) FROM mantenimiento_fotos f WHERE f.tarea_id = t.id) AS num_fotos
    FROM mantenimiento_tareas t
    JOIN apartamentos a ON a.id = t.apartamento_id
    WHERE t.apartamento_id = ?`;
  const params = [apartamentoId];
  const anio = txt(req.query.anio);
  if (anio) { sql += " AND strftime('%Y', t.fecha_creacion) = ?"; params.push(String(anio)); }
  sql += ' ORDER BY t.fecha_creacion DESC';

  const tareas = db.prepare(sql).all(...params);
  const notasStmt = db.prepare('SELECT * FROM mantenimiento_notas WHERE tarea_id = ? ORDER BY fecha ASC');
  for (const t of tareas) t.notas = notasStmt.all(t.id);

  const resumen = {
    total: tareas.length,
    completadas: tareas.filter((t) => t.estado === 'completada').length,
    pendientes: tareas.filter((t) => t.estado === 'pendiente').length,
    en_proceso: tareas.filter((t) => t.estado === 'en_proceso').length,
    urgentes: tareas.filter((t) => t.estado === 'urgente').length,
  };
  res.json({ tareas, resumen });
});

// GET /api/mantenimiento/tareas?estado=&apartamento_id=&anio= — lista (JOIN apartamento),
// ordenada por posicion ASC dentro de cada estado.
router.get('/tareas', (req, res) => {
  let sql = `
    SELECT t.*, a.nombre AS apartamento_nombre, a.tipo AS apartamento_tipo
    FROM mantenimiento_tareas t
    JOIN apartamentos a ON a.id = t.apartamento_id
    WHERE 1 = 1`;
  const params = [];
  const estado = txt(req.query.estado);
  if (estado) {
    if (!ESTADOS.includes(estado)) return res.status(400).json({ error: 'estado no válido' });
    sql += ' AND t.estado = ?'; params.push(estado);
  }
  const apartamentoId = aEntero(req.query.apartamento_id);
  if (apartamentoId !== null) { sql += ' AND t.apartamento_id = ?'; params.push(apartamentoId); }
  const anio = txt(req.query.anio);
  if (anio) { sql += " AND strftime('%Y', t.fecha_creacion) = ?"; params.push(String(anio)); }
  sql += ' ORDER BY t.estado ASC, t.posicion ASC, t.id ASC';
  res.json(db.prepare(sql).all(...params));
});

// GET /api/mantenimiento/tareas/:id — ficha completa: tarea + apartamento + notas + fotos +
// reserva vinculada (si tiene).
router.get('/tareas/:id', (req, res) => {
  const tarea = db.prepare(`
    SELECT t.*, a.nombre AS apartamento_nombre, a.tipo AS apartamento_tipo, a.edificio, a.capacidad
    FROM mantenimiento_tareas t
    JOIN apartamentos a ON a.id = t.apartamento_id
    WHERE t.id = ?
  `).get(req.params.id);
  if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });

  const notas = db.prepare('SELECT * FROM mantenimiento_notas WHERE tarea_id = ? ORDER BY fecha ASC').all(tarea.id);
  const fotos = db.prepare('SELECT * FROM mantenimiento_fotos WHERE tarea_id = ? ORDER BY id ASC').all(tarea.id);
  const reserva = tarea.reserva_id
    ? db.prepare('SELECT * FROM reservas WHERE id = ?').get(tarea.reserva_id) : null;
  res.json({ ...tarea, notas, fotos, reserva });
});

// POST /api/mantenimiento/tareas — crear tarea.
router.post('/tareas', (req, res) => {
  const b = req.body || {};
  const apartamentoId = aEntero(b.apartamento_id);
  const titulo = txt(b.titulo);
  if (apartamentoId === null) return res.status(400).json({ error: 'apartamento_id es obligatorio' });
  if (!titulo) return res.status(400).json({ error: 'El título es obligatorio' });

  const apto = db.prepare('SELECT id, nombre FROM apartamentos WHERE id = ?').get(apartamentoId);
  if (!apto) return res.status(400).json({ error: 'El apartamento indicado no existe' });

  let estado = 'pendiente';
  if ('estado' in b && b.estado != null && b.estado !== '') {
    if (!ESTADOS.includes(b.estado)) return res.status(400).json({ error: 'estado no válido' });
    estado = b.estado;
  }

  // Vincular reserva: la indicada explícitamente, o la activa hoy en el apartamento.
  let reservaId = aEntero(b.reserva_id);
  let reserva = null;
  if (reservaId !== null) {
    reserva = db.prepare('SELECT * FROM reservas WHERE id = ?').get(reservaId);
    if (!reserva) return res.status(400).json({ error: 'La reserva indicada no existe' });
  } else {
    reserva = db.prepare(`
      SELECT * FROM reservas
      WHERE apartamento_id = ? AND entrada <= date('now') AND salida >= date('now')
      ORDER BY entrada DESC LIMIT 1
    `).get(apartamentoId);
    if (reserva) reservaId = reserva.id;
  }
  const { cliente_nombre, cliente_telefono } = datosCliente(reserva);

  // Asignación opcional.
  let asignadoId = null;
  let asignadoNombre = null;
  if (b.asignado_a !== undefined && b.asignado_a !== null && b.asignado_a !== '') {
    asignadoId = aEntero(b.asignado_a);
    const u = asignadoId !== null ? db.prepare('SELECT id, nombre FROM usuarios WHERE id = ?').get(asignadoId) : null;
    if (!u) return res.status(400).json({ error: 'El usuario indicado no existe' });
    asignadoNombre = u.nombre;
  }

  // posicion = MAX(posicion)+1 dentro del estado.
  const maxPos = db.prepare('SELECT COALESCE(MAX(posicion), -1) AS m FROM mantenimiento_tareas WHERE estado = ?').get(estado).m;
  const posicion = maxPos + 1;

  const info = db.prepare(`
    INSERT INTO mantenimiento_tareas
      (apartamento_id, titulo, descripcion, estado, posicion, reserva_id, cliente_nombre,
       cliente_telefono, asignado_a, asignado_nombre, fecha_limite, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(apartamentoId, titulo, txt(b.descripcion), estado, posicion, reservaId, cliente_nombre,
    cliente_telefono, asignadoId, asignadoNombre, txt(b.fecha_limite), req.usuario && req.usuario.username);

  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre,
    'crear', 'mantenimiento-tarea', info.lastInsertRowid, `${titulo} (${apto.nombre})`);
  res.status(201).json({ id: info.lastInsertRowid });
});

// PUT /api/mantenimiento/tareas/:id — editar titulo, descripcion, estado, asignado_a, fecha_limite.
// Si cambia el estado, la tarea se mueve al final de la nueva columna.
router.put('/tareas/:id', (req, res) => {
  const tarea = db.prepare('SELECT * FROM mantenimiento_tareas WHERE id = ?').get(req.params.id);
  if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });

  const b = req.body || {};
  const sets = [];
  const vals = [];
  const add = (col, val) => { sets.push(`${col} = ?`); vals.push(val); };

  if ('titulo' in b) {
    const titulo = txt(b.titulo);
    if (!titulo) return res.status(400).json({ error: 'El título no puede quedar vacío' });
    add('titulo', titulo);
  }
  if ('descripcion' in b) add('descripcion', txt(b.descripcion));
  if ('fecha_limite' in b) add('fecha_limite', txt(b.fecha_limite));
  if ('asignado_a' in b) {
    const uid = aEntero(b.asignado_a);
    if (uid === null) { add('asignado_a', null); add('asignado_nombre', null); }
    else {
      const u = db.prepare('SELECT id, nombre FROM usuarios WHERE id = ?').get(uid);
      if (!u) return res.status(400).json({ error: 'El usuario indicado no existe' });
      add('asignado_a', u.id);
      add('asignado_nombre', u.nombre);
    }
  }
  if ('estado' in b && b.estado !== tarea.estado) {
    if (!ESTADOS.includes(b.estado)) return res.status(400).json({ error: 'estado no válido' });
    const maxPos = db.prepare('SELECT COALESCE(MAX(posicion), -1) AS m FROM mantenimiento_tareas WHERE estado = ?').get(b.estado).m;
    add('estado', b.estado);
    add('posicion', maxPos + 1);
  }

  if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
  vals.push(tarea.id);
  db.prepare(`UPDATE mantenimiento_tareas SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre,
    'editar', 'mantenimiento-tarea', tarea.id, null);
  res.json({ ok: true });
});

// POST /api/mantenimiento/tareas/:id/completar — marca completada.
router.post('/tareas/:id/completar', (req, res) => {
  const tarea = db.prepare('SELECT * FROM mantenimiento_tareas WHERE id = ?').get(req.params.id);
  if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });

  const uid = req.usuario && req.usuario.id != null ? req.usuario.id : null;
  const unombre = req.usuario && req.usuario.nombre != null ? req.usuario.nombre : null;
  const maxPos = db.prepare("SELECT COALESCE(MAX(posicion), -1) AS m FROM mantenimiento_tareas WHERE estado = 'completada'").get().m;

  db.prepare(`
    UPDATE mantenimiento_tareas
    SET estado = 'completada', posicion = ?, completado_por = ?, completado_nombre = ?,
        completado_fecha = datetime('now')
    WHERE id = ?
  `).run(maxPos + 1, uid, unombre, tarea.id);

  registrarActividad(db, uid, unombre, 'editar', 'mantenimiento-tarea', tarea.id, `Mantenimiento completado: ${tarea.titulo}`);
  res.json({ ok: true });
});

// POST /api/mantenimiento/tareas/:id/reordenar — mover a una posición concreta de una columna.
// Body { posicion, estado }. Incrementa la posicion de los que están >= la nueva.
router.post('/tareas/:id/reordenar', (req, res) => {
  const tarea = db.prepare('SELECT * FROM mantenimiento_tareas WHERE id = ?').get(req.params.id);
  if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });

  const b = req.body || {};
  const estado = txt(b.estado) || tarea.estado;
  if (!ESTADOS.includes(estado)) return res.status(400).json({ error: 'estado no válido' });
  let posicion = aEntero(b.posicion);
  if (posicion === null || posicion < 0) posicion = 0;

  db.transaction(() => {
    // Hueco en la columna destino para la nueva posición (excluyendo la propia tarea).
    db.prepare(`
      UPDATE mantenimiento_tareas SET posicion = posicion + 1
      WHERE estado = ? AND posicion >= ? AND id <> ?
    `).run(estado, posicion, tarea.id);
    db.prepare('UPDATE mantenimiento_tareas SET estado = ?, posicion = ? WHERE id = ?').run(estado, posicion, tarea.id);
  })();

  res.json({ ok: true });
});

// DELETE /api/mantenimiento/tareas/:id — eliminar tarea (solo admin y usuario).
router.delete('/tareas/:id', (req, res) => {
  if (req.usuario && req.usuario.rol === 'mantenimiento') {
    return res.status(403).json({ error: 'No tienes permiso para eliminar tareas' });
  }
  const tarea = db.prepare('SELECT * FROM mantenimiento_tareas WHERE id = ?').get(req.params.id);
  if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });
  db.prepare('DELETE FROM mantenimiento_tareas WHERE id = ?').run(tarea.id);
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre,
    'eliminar', 'mantenimiento-tarea', tarea.id, tarea.titulo);
  res.json({ ok: true });
});

// POST /api/mantenimiento/tareas/:id/notas — añade una nota al hilo.
router.post('/tareas/:id/notas', (req, res) => {
  const tarea = db.prepare('SELECT id FROM mantenimiento_tareas WHERE id = ?').get(req.params.id);
  if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });
  const texto = txt((req.body || {}).texto);
  if (!texto) return res.status(400).json({ error: 'El texto de la nota es obligatorio' });

  const info = db.prepare(`
    INSERT INTO mantenimiento_notas (tarea_id, texto, usuario_id, usuario_nombre)
    VALUES (?, ?, ?, ?)
  `).run(tarea.id, texto, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre);
  const nota = db.prepare('SELECT * FROM mantenimiento_notas WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(nota);
});

// DELETE /api/mantenimiento/tareas/:id/notas/:nota_id — solo el autor o un admin.
router.delete('/tareas/:id/notas/:nota_id', (req, res) => {
  const nota = db.prepare('SELECT * FROM mantenimiento_notas WHERE id = ? AND tarea_id = ?')
    .get(req.params.nota_id, req.params.id);
  if (!nota) return res.status(404).json({ error: 'Nota no encontrada' });
  const esAutor = req.usuario && nota.usuario_id != null && req.usuario.id === nota.usuario_id;
  if (!esAutor && !esAdmin(req)) {
    return res.status(403).json({ error: 'Solo el autor o un administrador pueden borrar la nota' });
  }
  db.prepare('DELETE FROM mantenimiento_notas WHERE id = ?').run(nota.id);
  res.json({ ok: true });
});

// POST /api/mantenimiento/tareas/:id/fotos — sube hasta 5 fotos (campo "fotos").
router.post('/tareas/:id/fotos', upload.array('fotos', 5), (req, res) => {
  const tarea = db.prepare('SELECT id FROM mantenimiento_tareas WHERE id = ?').get(req.params.id);
  if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });
  if (!req.files || !req.files.length) return res.status(400).json({ error: 'No se ha recibido ninguna foto' });

  for (const f of req.files) {
    const ext = path.extname(f.originalname).toLowerCase();
    if (!EXT_PERMITIDAS.includes(ext)) {
      return res.status(400).json({ error: `Formato no permitido en "${f.originalname}" (solo .jpg, .jpeg, .png, .webp)` });
    }
  }

  const destino = path.join(UPLOAD_BASE, String(tarea.id));
  fs.mkdirSync(destino, { recursive: true });
  const insertar = db.prepare('INSERT INTO mantenimiento_fotos (tarea_id, url, nombre_archivo, created_by) VALUES (?, ?, ?, ?)');
  const ts = Date.now();
  const creador = req.usuario && req.usuario.username;
  const creadas = [];
  db.transaction(() => {
    req.files.forEach((f, index) => {
      const ext = path.extname(f.originalname).toLowerCase();
      const nombreArchivo = `${tarea.id}-${ts}-${index}${ext}`;
      fs.writeFileSync(path.join(destino, nombreArchivo), f.buffer);
      const url = `/uploads/mantenimiento/${tarea.id}/${nombreArchivo}`;
      const info = insertar.run(tarea.id, url, nombreArchivo, creador);
      creadas.push({ id: info.lastInsertRowid, url, nombre_archivo: nombreArchivo });
    });
  })();
  res.status(201).json({ ok: true, fotos: creadas });
});

// DELETE /api/mantenimiento/tareas/:id/fotos/:foto_id — borra de BD y disco.
router.delete('/tareas/:id/fotos/:foto_id', (req, res) => {
  const foto = db.prepare('SELECT * FROM mantenimiento_fotos WHERE id = ? AND tarea_id = ?')
    .get(req.params.foto_id, req.params.id);
  if (!foto) return res.status(404).json({ error: 'Foto no encontrada' });

  db.prepare('DELETE FROM mantenimiento_fotos WHERE id = ?').run(foto.id);
  try {
    const ruta = path.join(UPLOAD_BASE, String(req.params.id), foto.nombre_archivo);
    if (fs.existsSync(ruta)) fs.unlinkSync(ruta);
  } catch (e) {
    console.error('No se pudo borrar el archivo de foto de mantenimiento:', e.message);
  }
  res.json({ ok: true });
});

module.exports = router;
