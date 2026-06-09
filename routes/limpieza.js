// API REST del módulo de Limpieza: tareas por día (checkout/turnover/manual),
// completar con reporte (notas + fotos) y reportes/estadística.
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db/database');
const { registrarActividad } = require('../services/actividadService');

const router = express.Router();

const UPLOAD_BASE = path.join(__dirname, '..', 'public', 'uploads', 'limpieza');
const EXT_PERMITIDAS = ['.jpg', '.jpeg', '.png', '.webp'];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function txt(v) { return v === undefined || v === null ? null : String(v); }
function aEntero(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

// Genera (idempotente) las tareas de checkout/turnover de un día. No duplica si ya
// existe una tarea para ese apartamento y fecha.
function generarTareas(fecha, usuario) {
  const checkouts = db.prepare(
    'SELECT * FROM reservas WHERE salida = ? AND apartamento_id IS NOT NULL'
  ).all(fecha);
  if (!checkouts.length) return;

  const yaTarea = db.prepare('SELECT id FROM limpieza_tareas WHERE apartamento_id = ? AND fecha = ?');
  const buscarCheckin = db.prepare('SELECT * FROM reservas WHERE entrada = ? AND apartamento_id = ? AND id <> ?');
  const insertar = db.prepare(`
    INSERT INTO limpieza_tareas
      (apartamento_id, fecha, tipo, prioridad, reserva_checkout_id, reserva_checkin_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const creador = usuario && usuario.username ? usuario.username : 'sistema';

  db.transaction(() => {
    for (const co of checkouts) {
      if (yaTarea.get(co.apartamento_id, fecha)) continue;
      const checkin = buscarCheckin.get(fecha, co.apartamento_id, co.id);
      const tipo = checkin ? 'turnover' : 'checkout';
      const prioridad = checkin ? 1 : 0;
      insertar.run(co.apartamento_id, fecha, tipo, prioridad, co.id, checkin ? checkin.id : null, creador);
    }
  })();
}

// GET /api/limpieza/tareas?fecha=YYYY-MM-DD — tareas del día (las genera si faltan).
router.get('/tareas', (req, res) => {
  const fecha = String(req.query.fecha || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: 'fecha (YYYY-MM-DD) es obligatoria' });

  generarTareas(fecha, req.usuario);

  const tareas = db.prepare(`
    SELECT t.*, a.nombre AS apartamento_nombre, a.tipo_clasificacion, a.estado_limpieza,
           co.nombre_cliente AS checkout_cliente, co.hora_salida AS hora_checkout,
           ci.nombre_cliente AS checkin_cliente, ci.hora_entrada AS hora_checkin
    FROM limpieza_tareas t
    JOIN apartamentos a ON a.id = t.apartamento_id
    LEFT JOIN reservas co ON co.id = t.reserva_checkout_id
    LEFT JOIN reservas ci ON ci.id = t.reserva_checkin_id
    WHERE t.fecha = ?
    ORDER BY t.prioridad DESC, a.nombre ASC
  `).all(fecha);
  res.json(tareas);
});

// GET /api/limpieza/reportes?desde=&hasta=&apartamento_id= — tareas completadas con reporte.
router.get('/reportes', (req, res) => {
  const { desde, hasta, apartamento_id } = req.query;
  let sql = `
    SELECT t.*, a.nombre AS apartamento_nombre, a.tipo_clasificacion,
           (SELECT COUNT(*) FROM limpieza_fotos f WHERE f.tarea_id = t.id) AS num_fotos
    FROM limpieza_tareas t
    JOIN apartamentos a ON a.id = t.apartamento_id
    WHERE t.estado = 'completada'
      AND ((t.notas_limpieza IS NOT NULL AND t.notas_limpieza <> '')
           OR EXISTS (SELECT 1 FROM limpieza_fotos f WHERE f.tarea_id = t.id))`;
  const params = [];
  if (desde) { sql += ' AND date(t.completado_fecha) >= ?'; params.push(desde); }
  if (hasta) { sql += ' AND date(t.completado_fecha) <= ?'; params.push(hasta); }
  if (apartamento_id) { sql += ' AND t.apartamento_id = ?'; params.push(apartamento_id); }
  sql += ' ORDER BY t.completado_fecha DESC';
  res.json(db.prepare(sql).all(...params));
});

// GET /api/limpieza/resumen?fecha= — contadores rápidos del día.
router.get('/resumen', (req, res) => {
  const fecha = String(req.query.fecha || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: 'fecha (YYYY-MM-DD) es obligatoria' });
  const r = db.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(estado = 'pendiente'), 0) AS pendientes,
      COALESCE(SUM(estado = 'en_proceso'), 0) AS en_proceso,
      COALESCE(SUM(estado = 'completada'), 0) AS completadas,
      COALESCE(SUM(tipo = 'turnover'), 0) AS turnovers
    FROM limpieza_tareas WHERE fecha = ?
  `).get(fecha);
  res.json(r);
});

// GET /api/limpieza/tareas/:id/detalle — tarea + fotos + apartamento + reservas asociadas.
router.get('/tareas/:id/detalle', (req, res) => {
  const tarea = db.prepare(`
    SELECT t.*, a.nombre AS apartamento_nombre, a.tipo_clasificacion, a.estado_limpieza,
           a.capacidad, a.edificio
    FROM limpieza_tareas t
    JOIN apartamentos a ON a.id = t.apartamento_id
    WHERE t.id = ?
  `).get(req.params.id);
  if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });

  const fotos = db.prepare('SELECT * FROM limpieza_fotos WHERE tarea_id = ? ORDER BY id').all(tarea.id);
  const reserva_checkout = tarea.reserva_checkout_id
    ? db.prepare('SELECT * FROM reservas WHERE id = ?').get(tarea.reserva_checkout_id) : null;
  const reserva_checkin = tarea.reserva_checkin_id
    ? db.prepare('SELECT * FROM reservas WHERE id = ?').get(tarea.reserva_checkin_id) : null;
  res.json({ ...tarea, fotos, reserva_checkout, reserva_checkin });
});

// POST /api/limpieza/tareas — crea una tarea manual.
router.post('/tareas', (req, res) => {
  const b = req.body || {};
  const apartamentoId = aEntero(b.apartamento_id);
  const fecha = String(b.fecha || '').trim();
  if (apartamentoId === null) return res.status(400).json({ error: 'apartamento_id es obligatorio' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: 'fecha (YYYY-MM-DD) es obligatoria' });
  const apto = db.prepare('SELECT id, nombre FROM apartamentos WHERE id = ?').get(apartamentoId);
  if (!apto) return res.status(400).json({ error: 'El apartamento indicado no existe' });

  // Asignación opcional: si llega asignado_a, validar el usuario y guardar también su nombre.
  let asignadoId = null;
  let asignadoNombre = null;
  if (b.asignado_a !== undefined && b.asignado_a !== null && b.asignado_a !== '') {
    asignadoId = aEntero(b.asignado_a);
    const u = asignadoId !== null ? db.prepare('SELECT id, nombre FROM usuarios WHERE id = ?').get(asignadoId) : null;
    if (!u) return res.status(400).json({ error: 'El usuario indicado no existe' });
    asignadoNombre = u.nombre;
  }

  const info = db.prepare(`
    INSERT INTO limpieza_tareas (apartamento_id, fecha, tipo, prioridad, estado, notas_limpieza, asignado_a, asignado_nombre, created_by)
    VALUES (?, ?, 'manual', 0, 'pendiente', ?, ?, ?, ?)
  `).run(apartamentoId, fecha, txt(b.notas), asignadoId, asignadoNombre, req.usuario && req.usuario.username);

  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre,
    'crear', 'limpieza-tarea', info.lastInsertRowid, `Tarea manual en ${apto.nombre} (${fecha})`);
  res.status(201).json({ id: info.lastInsertRowid });
});

// PUT /api/limpieza/tareas/:id — editar estado, asignado_a y/o notas.
router.put('/tareas/:id', (req, res) => {
  const tarea = db.prepare('SELECT * FROM limpieza_tareas WHERE id = ?').get(req.params.id);
  if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });

  const b = req.body || {};
  const sets = [];
  const vals = [];
  const add = (col, val) => { sets.push(`${col} = ?`); vals.push(val); };

  if ('estado' in b) {
    if (!['pendiente', 'en_proceso', 'completada'].includes(b.estado)) {
      return res.status(400).json({ error: 'estado no válido' });
    }
    add('estado', b.estado);
  }
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
  if ('notas' in b) add('notas_limpieza', txt(b.notas));
  if ('notas_limpieza' in b) add('notas_limpieza', txt(b.notas_limpieza));

  if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
  vals.push(tarea.id);
  db.prepare(`UPDATE limpieza_tareas SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre,
    'editar', 'limpieza-tarea', tarea.id, null);
  res.json({ ok: true });
});

// POST /api/limpieza/tareas/:id/completar — marca completada + apartamento limpio + log.
router.post('/tareas/:id/completar', (req, res) => {
  const tarea = db.prepare('SELECT * FROM limpieza_tareas WHERE id = ?').get(req.params.id);
  if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });
  const apto = db.prepare('SELECT id, nombre, estado_limpieza FROM apartamentos WHERE id = ?').get(tarea.apartamento_id);

  const notas = txt((req.body || {}).notas_limpieza);
  const uid = req.usuario && req.usuario.id != null ? req.usuario.id : null;
  const unombre = req.usuario && req.usuario.nombre != null ? req.usuario.nombre : null;

  db.transaction(() => {
    db.prepare(`
      UPDATE limpieza_tareas
      SET estado = 'completada', completado_por = ?, completado_nombre = ?,
          completado_fecha = datetime('now'),
          notas_limpieza = COALESCE(?, notas_limpieza)
      WHERE id = ?
    `).run(uid, unombre, notas, tarea.id);

    if (apto) {
      const anterior = apto.estado_limpieza || null;
      db.prepare("UPDATE apartamentos SET estado_limpieza = 'limpio' WHERE id = ?").run(apto.id);
      db.prepare(`
        INSERT INTO limpieza_log (apartamento_id, estado_anterior, estado_nuevo, usuario_id, usuario_nombre)
        VALUES (?, ?, 'limpio', ?, ?)
      `).run(apto.id, anterior, uid, unombre);
    }
  })();

  registrarActividad(db, uid, unombre, 'editar', 'limpieza-tarea', tarea.id,
    `Limpieza completada${apto ? ' en ' + apto.nombre : ''}`);
  res.json({ ok: true });
});

// POST /api/limpieza/tareas/:id/fotos — sube hasta 5 fotos de reporte (campo "fotos").
router.post('/tareas/:id/fotos', upload.array('fotos', 5), (req, res) => {
  const tarea = db.prepare('SELECT id FROM limpieza_tareas WHERE id = ?').get(req.params.id);
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
  const insertar = db.prepare('INSERT INTO limpieza_fotos (tarea_id, url, nombre_archivo) VALUES (?, ?, ?)');
  const ts = Date.now();
  const creadas = [];
  db.transaction(() => {
    req.files.forEach((f, index) => {
      const ext = path.extname(f.originalname).toLowerCase();
      const nombreArchivo = `${tarea.id}-${ts}-${index}${ext}`;
      fs.writeFileSync(path.join(destino, nombreArchivo), f.buffer);
      const url = `/uploads/limpieza/${tarea.id}/${nombreArchivo}`;
      const info = insertar.run(tarea.id, url, nombreArchivo);
      creadas.push({ id: info.lastInsertRowid, url, nombre_archivo: nombreArchivo });
    });
  })();

  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre,
    'crear', 'limpieza-foto', tarea.id, `${creadas.length} foto(s) de reporte`);
  res.status(201).json({ ok: true, fotos: creadas });
});

// DELETE /api/limpieza/tareas/:id — solo tareas manuales pendientes.
router.delete('/tareas/:id', (req, res) => {
  const tarea = db.prepare('SELECT * FROM limpieza_tareas WHERE id = ?').get(req.params.id);
  if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });
  if (tarea.tipo !== 'manual' || tarea.estado !== 'pendiente') {
    return res.status(409).json({ error: 'Solo se pueden eliminar tareas manuales pendientes' });
  }
  db.prepare('DELETE FROM limpieza_tareas WHERE id = ?').run(tarea.id);
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre,
    'eliminar', 'limpieza-tarea', tarea.id, null);
  res.json({ ok: true });
});

module.exports = router;
