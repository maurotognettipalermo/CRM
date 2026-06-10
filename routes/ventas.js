// API REST del módulo de Ventas (inmobiliaria): propiedades en venta, clientes
// compradores, visitas (con notas) y un resumen para el dashboard.
const express = require('express');
const multer = require('multer');
const db = require('../db/database');
const { importarPropiedades } = require('../services/importPropiedades');
const { registrarActividad } = require('../services/actividadService');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function txt(v) { return v === undefined || v === null || v === '' ? null : String(v); }
function aEntero(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}
function aReal(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}
function aBool(v) { return v ? 1 : 0; }
function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function actor(req) { return req.usuario ? (req.usuario.nombre || req.usuario.username) : null; }

// ============================================================
// Resumen para el dashboard
// ============================================================
router.get('/resumen', (req, res) => {
  const prop = db.prepare(`
    SELECT
      COALESCE(SUM(estado = 'Disponible'), 0) AS disponibles,
      COALESCE(SUM(estado = 'Reservada'), 0) AS reservadas,
      COALESCE(SUM(estado = 'Vendida'), 0) AS vendidas,
      COALESCE(SUM(estado = 'Retirada'), 0) AS retiradas,
      COUNT(*) AS total
    FROM propiedades_venta
  `).get();
  const cli = db.prepare(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(estado NOT IN ('Compró','Descartado')), 0) AS activos
    FROM clientes_compradores
  `).get();
  const vis = db.prepare(`
    SELECT
      COALESCE(SUM(fecha = ? AND estado = 'Programada'), 0) AS hoy,
      COALESCE(SUM(estado = 'Programada'), 0) AS programadas,
      COALESCE(SUM(estado = 'Realizada'), 0) AS realizadas
    FROM visitas_venta
  `).get(hoyISO());

  res.json({
    propiedades_disponibles: prop.disponibles,
    propiedades_reservadas: prop.reservadas,
    propiedades_vendidas: prop.vendidas,
    propiedades_retiradas: prop.retiradas,
    propiedades_total: prop.total,
    clientes_total: cli.total,
    clientes_activos: cli.activos,
    visitas_hoy: vis.hoy,
    visitas_programadas: vis.programadas,
    visitas_realizadas: vis.realizadas,
  });
});

// ============================================================
// Propiedades en venta
// ============================================================
const PROP_CAMPOS = [
  'referencia', 'codigo_idealista', 'tipo', 'calle', 'numero', 'planta', 'zona', 'localidad',
  'precio', 'dormitorios', 'banos', 'metros_cuadrados', 'metros_utiles', 'clase_energetica',
  'garaje', 'num_fotos', 'estado', 'estado_idealista', 'fecha_alta', 'fecha_baja',
  'propietario_nombre', 'propietario_apellidos', 'propietario_telefono', 'propietario_email',
  'descripcion', 'notas',
  'fecha_venta', 'fecha_escritura', 'precio_venta_final',
  'comprador_nombre', 'comprador_telefono', 'comprador_email',
];
const PROP_INT = ['dormitorios', 'banos', 'num_fotos'];
const PROP_REAL = ['precio', 'metros_cuadrados', 'metros_utiles', 'precio_venta_final'];

function normalizaPropCampo(campo, valor) {
  if (PROP_INT.includes(campo)) return aEntero(valor);
  if (PROP_REAL.includes(campo)) return aReal(valor);
  return txt(valor);
}

// GET /api/ventas/propiedades — lista con filtros opcionales.
router.get('/propiedades', (req, res) => {
  let sql = 'SELECT * FROM propiedades_venta WHERE 1 = 1';
  const params = [];
  const { estado, tipo, zona, precio_min, precio_max, dormitorios } = req.query;
  if (estado) { sql += ' AND estado = ?'; params.push(estado); }
  if (tipo) { sql += ' AND tipo = ?'; params.push(tipo); }
  if (zona) { sql += ' AND zona LIKE ?'; params.push('%' + zona + '%'); }
  if (precio_min) { sql += ' AND precio >= ?'; params.push(aReal(precio_min)); }
  if (precio_max) { sql += ' AND precio <= ?'; params.push(aReal(precio_max)); }
  if (dormitorios) { sql += ' AND dormitorios >= ?'; params.push(aEntero(dormitorios)); }
  sql += " ORDER BY (fecha_alta IS NULL), fecha_alta DESC, id DESC";
  res.json(db.prepare(sql).all(...params));
});

// GET /api/ventas/propiedades/:id — ficha + historial de visitas.
router.get('/propiedades/:id', (req, res) => {
  const prop = db.prepare('SELECT * FROM propiedades_venta WHERE id = ?').get(req.params.id);
  if (!prop) return res.status(404).json({ error: 'Propiedad no encontrada' });
  const visitas = db.prepare(`
    SELECT v.*, c.nombre AS cliente_nombre, c.apellidos AS cliente_apellidos, c.telefono AS cliente_telefono
    FROM visitas_venta v
    JOIN clientes_compradores c ON c.id = v.cliente_id
    WHERE v.propiedad_id = ?
    ORDER BY v.fecha DESC, v.id DESC
  `).all(prop.id);
  res.json({ ...prop, visitas });
});

// POST /api/ventas/propiedades — crear manual.
router.post('/propiedades', (req, res) => {
  const b = req.body || {};
  const referencia = txt(b.referencia);
  if (!referencia) return res.status(400).json({ error: 'La referencia es obligatoria' });
  if (db.prepare('SELECT id FROM propiedades_venta WHERE referencia = ?').get(referencia)) {
    return res.status(409).json({ error: 'Ya existe una propiedad con esa referencia' });
  }
  const datos = {};
  for (const c of PROP_CAMPOS) if (c in b) datos[c] = normalizaPropCampo(c, b[c]);
  datos.referencia = referencia;
  if (!datos.estado) datos.estado = 'Disponible';

  const claves = Object.keys(datos);
  const cols = claves.join(', ');
  const ph = claves.map((c) => '@' + c).join(', ');
  const info = db.prepare(`INSERT INTO propiedades_venta (${cols}) VALUES (${ph})`).run(datos);
  registrarActividad(db, req.usuario && req.usuario.id, actor(req), 'crear', 'propiedad-venta', info.lastInsertRowid, referencia);
  res.status(201).json({ id: info.lastInsertRowid });
});

// PUT /api/ventas/propiedades/:id — editar.
router.put('/propiedades/:id', (req, res) => {
  const prop = db.prepare('SELECT * FROM propiedades_venta WHERE id = ?').get(req.params.id);
  if (!prop) return res.status(404).json({ error: 'Propiedad no encontrada' });
  const b = req.body || {};

  if ('referencia' in b) {
    const ref = txt(b.referencia);
    if (!ref) return res.status(400).json({ error: 'La referencia no puede quedar vacía' });
    const dup = db.prepare('SELECT id FROM propiedades_venta WHERE referencia = ? AND id <> ?').get(ref, prop.id);
    if (dup) return res.status(409).json({ error: 'Ya existe otra propiedad con esa referencia' });
  }

  const sets = [];
  const vals = {};
  for (const c of PROP_CAMPOS) {
    if (c in b) { sets.push(`${c} = @${c}`); vals[c] = normalizaPropCampo(c, b[c]); }
  }
  if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
  vals.id = prop.id;
  db.prepare(`UPDATE propiedades_venta SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = @id`).run(vals);
  res.json({ ok: true });
});

// DELETE /api/ventas/propiedades/:id — 409 si tiene visitas.
router.delete('/propiedades/:id', (req, res) => {
  const prop = db.prepare('SELECT id, referencia FROM propiedades_venta WHERE id = ?').get(req.params.id);
  if (!prop) return res.status(404).json({ error: 'Propiedad no encontrada' });
  const n = db.prepare('SELECT COUNT(*) AS c FROM visitas_venta WHERE propiedad_id = ?').get(prop.id).c;
  if (n > 0) return res.status(409).json({ error: 'No se puede borrar: la propiedad tiene visitas registradas' });
  db.prepare('DELETE FROM propiedades_venta WHERE id = ?').run(prop.id);
  registrarActividad(db, req.usuario && req.usuario.id, actor(req), 'eliminar', 'propiedad-venta', prop.id, prop.referencia);
  res.json({ ok: true });
});

// POST /api/ventas/propiedades/importar — Excel de Idealista (campo "archivo").
router.post('/propiedades/importar', upload.single('archivo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se ha recibido ningún archivo' });
  try {
    const resumen = importarPropiedades(req.file.buffer);
    registrarActividad(db, req.usuario && req.usuario.id, actor(req), 'importar', 'propiedad-venta', null,
      `${resumen.nuevas} nuevas / ${resumen.actualizadas} actualizadas`);
    res.json(resumen);
  } catch (e) {
    console.error('Error importando propiedades:', e);
    res.status(500).json({ error: 'No se pudo procesar el archivo: ' + e.message });
  }
});

// POST /api/ventas/propiedades/:id/vender — cierra la venta: estado='Vendida' + datos.
router.post('/propiedades/:id/vender', (req, res) => {
  const prop = db.prepare('SELECT id, referencia FROM propiedades_venta WHERE id = ?').get(req.params.id);
  if (!prop) return res.status(404).json({ error: 'Propiedad no encontrada' });
  const b = req.body || {};
  db.prepare(`
    UPDATE propiedades_venta SET
      estado = 'Vendida',
      fecha_venta = ?, fecha_escritura = ?, precio_venta_final = ?,
      comprador_nombre = ?, comprador_telefono = ?, comprador_email = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    txt(b.fecha_venta) || hoyISO(), txt(b.fecha_escritura), aReal(b.precio_venta_final),
    txt(b.comprador_nombre), txt(b.comprador_telefono), txt(b.comprador_email), prop.id);
  registrarActividad(db, req.usuario && req.usuario.id, actor(req), 'editar', 'propiedad-venta', prop.id, `Vendida ${prop.referencia}`);
  res.json({ ok: true });
});

// ============================================================
// Clientes compradores
// ============================================================
const CLI_CAMPOS = [
  'nombre', 'apellidos', 'telefono', 'email', 'presupuesto_max', 'busca_tipo',
  'busca_dormitorios', 'busca_zona', 'busca_linea', 'busca_frontal', 'busca_villa',
  'notas', 'estado', 'origen',
];
function normalizaCliCampo(campo, valor) {
  if (campo === 'presupuesto_max') return aReal(valor);
  if (campo === 'busca_dormitorios') return aEntero(valor);
  if (campo === 'busca_frontal' || campo === 'busca_villa') return aBool(valor);
  return txt(valor);
}

// GET /api/ventas/clientes — lista con filtros.
router.get('/clientes', (req, res) => {
  let sql = 'SELECT * FROM clientes_compradores WHERE 1 = 1';
  const params = [];
  const { estado, busca_tipo, presupuesto_min, presupuesto_max } = req.query;
  if (estado) { sql += ' AND estado = ?'; params.push(estado); }
  if (busca_tipo) { sql += ' AND busca_tipo = ?'; params.push(busca_tipo); }
  if (presupuesto_min) { sql += ' AND presupuesto_max >= ?'; params.push(aReal(presupuesto_min)); }
  if (presupuesto_max) { sql += ' AND presupuesto_max <= ?'; params.push(aReal(presupuesto_max)); }
  sql += ' ORDER BY created_at DESC, id DESC';
  res.json(db.prepare(sql).all(...params));
});

// GET /api/ventas/clientes/:id — ficha + historial de visitas.
router.get('/clientes/:id', (req, res) => {
  const cli = db.prepare('SELECT * FROM clientes_compradores WHERE id = ?').get(req.params.id);
  if (!cli) return res.status(404).json({ error: 'Cliente no encontrado' });
  const visitas = db.prepare(`
    SELECT v.*, p.referencia AS propiedad_referencia, p.calle AS propiedad_calle,
           p.precio AS propiedad_precio, p.zona AS propiedad_zona
    FROM visitas_venta v
    JOIN propiedades_venta p ON p.id = v.propiedad_id
    WHERE v.cliente_id = ?
    ORDER BY v.fecha DESC, v.id DESC
  `).all(cli.id);
  res.json({ ...cli, visitas });
});

// POST /api/ventas/clientes — crear.
router.post('/clientes', (req, res) => {
  const b = req.body || {};
  if (!txt(b.nombre)) return res.status(400).json({ error: 'El nombre es obligatorio' });
  const datos = {};
  for (const c of CLI_CAMPOS) if (c in b) datos[c] = normalizaCliCampo(c, b[c]);
  datos.nombre = txt(b.nombre);
  datos.created_by = actor(req);

  const claves = Object.keys(datos);
  const cols = claves.join(', ');
  const ph = claves.map((c) => '@' + c).join(', ');
  const info = db.prepare(`INSERT INTO clientes_compradores (${cols}) VALUES (${ph})`).run(datos);
  registrarActividad(db, req.usuario && req.usuario.id, actor(req), 'crear', 'cliente-comprador', info.lastInsertRowid, datos.nombre);
  res.status(201).json({ id: info.lastInsertRowid });
});

// PUT /api/ventas/clientes/:id — editar.
router.put('/clientes/:id', (req, res) => {
  const cli = db.prepare('SELECT id FROM clientes_compradores WHERE id = ?').get(req.params.id);
  if (!cli) return res.status(404).json({ error: 'Cliente no encontrado' });
  const b = req.body || {};
  if ('nombre' in b && !txt(b.nombre)) return res.status(400).json({ error: 'El nombre no puede quedar vacío' });

  const sets = [];
  const vals = {};
  for (const c of CLI_CAMPOS) {
    if (c in b) { sets.push(`${c} = @${c}`); vals[c] = normalizaCliCampo(c, b[c]); }
  }
  if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
  vals.id = cli.id;
  db.prepare(`UPDATE clientes_compradores SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = @id`).run(vals);
  res.json({ ok: true });
});

// DELETE /api/ventas/clientes/:id — 409 si tiene visitas.
router.delete('/clientes/:id', (req, res) => {
  const cli = db.prepare('SELECT id, nombre FROM clientes_compradores WHERE id = ?').get(req.params.id);
  if (!cli) return res.status(404).json({ error: 'Cliente no encontrado' });
  const n = db.prepare('SELECT COUNT(*) AS c FROM visitas_venta WHERE cliente_id = ?').get(cli.id).c;
  if (n > 0) return res.status(409).json({ error: 'No se puede borrar: el cliente tiene visitas registradas' });
  db.prepare('DELETE FROM clientes_compradores WHERE id = ?').run(cli.id);
  registrarActividad(db, req.usuario && req.usuario.id, actor(req), 'eliminar', 'cliente-comprador', cli.id, cli.nombre);
  res.json({ ok: true });
});

// ============================================================
// Visitas
// ============================================================
const SELECT_VISITA = `
  SELECT v.*,
         c.nombre AS cliente_nombre, c.apellidos AS cliente_apellidos, c.telefono AS cliente_telefono,
         p.referencia AS propiedad_referencia, p.calle AS propiedad_calle, p.precio AS propiedad_precio
  FROM visitas_venta v
  JOIN clientes_compradores c ON c.id = v.cliente_id
  JOIN propiedades_venta p ON p.id = v.propiedad_id`;

// GET /api/ventas/visitas — lista con filtros (sin fecha = todas).
router.get('/visitas', (req, res) => {
  let sql = SELECT_VISITA + ' WHERE 1 = 1';
  const params = [];
  const { fecha, estado, cliente_id, propiedad_id } = req.query;
  if (fecha) { sql += ' AND v.fecha = ?'; params.push(fecha); }
  if (estado) { sql += ' AND v.estado = ?'; params.push(estado); }
  if (cliente_id) { sql += ' AND v.cliente_id = ?'; params.push(aEntero(cliente_id)); }
  if (propiedad_id) { sql += ' AND v.propiedad_id = ?'; params.push(aEntero(propiedad_id)); }
  sql += ' ORDER BY v.fecha DESC, v.hora DESC, v.id DESC';
  res.json(db.prepare(sql).all(...params));
});

// GET /api/ventas/visitas/hoy — programadas para hoy (antes de /:id).
router.get('/visitas/hoy', (req, res) => {
  const sql = SELECT_VISITA + " WHERE v.fecha = ? AND v.estado = 'Programada' ORDER BY v.hora ASC, v.id ASC";
  res.json(db.prepare(sql).all(hoyISO()));
});

// GET /api/ventas/visitas/:id — detalle + notas.
router.get('/visitas/:id', (req, res) => {
  const visita = db.prepare(SELECT_VISITA + ' WHERE v.id = ?').get(req.params.id);
  if (!visita) return res.status(404).json({ error: 'Visita no encontrada' });
  const notas = db.prepare('SELECT * FROM visitas_notas WHERE visita_id = ? ORDER BY fecha ASC, id ASC').all(visita.id);
  res.json({ ...visita, notas });
});

// POST /api/ventas/visitas — crear. Avanza el cliente Nuevo -> Contactado.
router.post('/visitas', (req, res) => {
  const b = req.body || {};
  const clienteId = aEntero(b.cliente_id);
  const propiedadId = aEntero(b.propiedad_id);
  const fecha = txt(b.fecha);
  if (clienteId === null || propiedadId === null || !fecha) {
    return res.status(400).json({ error: 'cliente_id, propiedad_id y fecha son obligatorios' });
  }
  const cli = db.prepare('SELECT id, estado FROM clientes_compradores WHERE id = ?').get(clienteId);
  if (!cli) return res.status(400).json({ error: 'El cliente indicado no existe' });
  if (!db.prepare('SELECT id FROM propiedades_venta WHERE id = ?').get(propiedadId)) {
    return res.status(400).json({ error: 'La propiedad indicada no existe' });
  }
  const dup = db.prepare('SELECT id FROM visitas_venta WHERE cliente_id = ? AND propiedad_id = ? AND fecha = ?')
    .get(clienteId, propiedadId, fecha);
  if (dup) return res.status(409).json({ error: 'Ya existe una visita de ese cliente a esa propiedad en esa fecha' });

  let info;
  db.transaction(() => {
    info = db.prepare(`
      INSERT INTO visitas_venta (cliente_id, propiedad_id, fecha, hora, atendido_por, notas, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(clienteId, propiedadId, fecha, txt(b.hora), txt(b.atendido_por), txt(b.notas), actor(req));
    if (cli.estado === 'Nuevo') {
      db.prepare("UPDATE clientes_compradores SET estado = 'Contactado', updated_at = datetime('now') WHERE id = ?").run(clienteId);
    }
  })();
  registrarActividad(db, req.usuario && req.usuario.id, actor(req), 'crear', 'visita-venta', info.lastInsertRowid, fecha);
  res.status(201).json({ id: info.lastInsertRowid });
});

// PUT /api/ventas/visitas/:id — editar estado / valoración / notas.
router.put('/visitas/:id', (req, res) => {
  const visita = db.prepare('SELECT * FROM visitas_venta WHERE id = ?').get(req.params.id);
  if (!visita) return res.status(404).json({ error: 'Visita no encontrada' });
  const b = req.body || {};
  const sets = [];
  const vals = {};
  const add = (col, val) => { sets.push(`${col} = @${col}`); vals[col] = val; };

  if ('estado' in b) {
    if (!['Programada', 'Realizada', 'Cancelada'].includes(b.estado)) {
      return res.status(400).json({ error: 'estado no válido' });
    }
    add('estado', b.estado);
  }
  if ('valoracion' in b) add('valoracion', txt(b.valoracion));
  if ('notas' in b) add('notas', txt(b.notas));
  if ('hora' in b) add('hora', txt(b.hora));
  if ('fecha' in b && txt(b.fecha)) add('fecha', txt(b.fecha));
  if ('atendido_por' in b) add('atendido_por', txt(b.atendido_por));

  if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
  vals.id = visita.id;
  db.prepare(`UPDATE visitas_venta SET ${sets.join(', ')} WHERE id = @id`).run(vals);
  res.json({ ok: true });
});

// POST /api/ventas/visitas/:id/realizar — marcar realizada. Avanza Contactado -> Visitado.
router.post('/visitas/:id/realizar', (req, res) => {
  const visita = db.prepare('SELECT * FROM visitas_venta WHERE id = ?').get(req.params.id);
  if (!visita) return res.status(404).json({ error: 'Visita no encontrada' });
  const b = req.body || {};

  db.transaction(() => {
    db.prepare(`
      UPDATE visitas_venta
      SET estado = 'Realizada',
          valoracion = COALESCE(?, valoracion),
          notas = COALESCE(?, notas)
      WHERE id = ?
    `).run(txt(b.valoracion), txt(b.notas), visita.id);
    const cli = db.prepare('SELECT estado FROM clientes_compradores WHERE id = ?').get(visita.cliente_id);
    if (cli && cli.estado === 'Contactado') {
      db.prepare("UPDATE clientes_compradores SET estado = 'Visitado', updated_at = datetime('now') WHERE id = ?").run(visita.cliente_id);
    }
  })();
  registrarActividad(db, req.usuario && req.usuario.id, actor(req), 'editar', 'visita-venta', visita.id, 'Visita realizada');
  res.json({ ok: true });
});

// DELETE /api/ventas/visitas/:id
router.delete('/visitas/:id', (req, res) => {
  const visita = db.prepare('SELECT id FROM visitas_venta WHERE id = ?').get(req.params.id);
  if (!visita) return res.status(404).json({ error: 'Visita no encontrada' });
  db.prepare('DELETE FROM visitas_venta WHERE id = ?').run(visita.id);
  registrarActividad(db, req.usuario && req.usuario.id, actor(req), 'eliminar', 'visita-venta', visita.id, null);
  res.json({ ok: true });
});

// ============================================================
// Notas de visita
// ============================================================
// POST /api/ventas/visitas/:id/notas — crear nota.
router.post('/visitas/:id/notas', (req, res) => {
  const visita = db.prepare('SELECT id FROM visitas_venta WHERE id = ?').get(req.params.id);
  if (!visita) return res.status(404).json({ error: 'Visita no encontrada' });
  const texto = txt((req.body || {}).texto);
  if (!texto) return res.status(400).json({ error: 'El texto de la nota es obligatorio' });
  const info = db.prepare('INSERT INTO visitas_notas (visita_id, texto, usuario_nombre) VALUES (?, ?, ?)')
    .run(visita.id, texto, actor(req));
  const nota = db.prepare('SELECT * FROM visitas_notas WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(nota);
});

// DELETE /api/ventas/visitas/:id/notas/:nota_id
router.delete('/visitas/:id/notas/:nota_id', (req, res) => {
  const nota = db.prepare('SELECT id FROM visitas_notas WHERE id = ? AND visita_id = ?')
    .get(req.params.nota_id, req.params.id);
  if (!nota) return res.status(404).json({ error: 'Nota no encontrada' });
  db.prepare('DELETE FROM visitas_notas WHERE id = ?').run(nota.id);
  res.json({ ok: true });
});

module.exports = router;
