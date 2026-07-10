// API REST de Pagos de Mayoristas (turoperadores/agencias con contrato anual de cupo).
// Tres recursos: mayoristas, contratos anuales (con plan de pagos) y los pagos del plan.
// Patrón de pagos = mismo que contratos de propietarios (PUT reemplaza todas las cuotas en
// una transacción, validando que su suma cuadra con el importe del contrato). Montado bajo
// requireAuth. Las rutas literales (/resumen, /contratos, /pagos) se declaran antes de /:id.
const express = require('express');
const db = require('../db/database');
const { registrarActividad } = require('../services/actividadService');

const router = express.Router();

const METODOS_PAGO = ['transferencia', 'cheque', 'efectivo'];
const ESTADOS_CONTRATO = ['activo', 'finalizado', 'cancelado'];

// --- Helpers ---
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function txt(v) { return v === undefined || v === null || v === '' ? null : String(v); }
function intOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}
function hoyISO() { return new Date().toISOString().slice(0, 10); }
function actor(req) { return req.usuario ? (req.usuario.nombre || req.usuario.username) : null; }

// Valida el plan de pagos recibido y lo normaliza. Devuelve { error } o { pagos }.
function normalizarPagos(pagosRaw, importeTotal) {
  if (!Array.isArray(pagosRaw) || pagosRaw.length === 0) {
    return { error: 'El contrato debe incluir al menos un pago' };
  }
  const pagos = [];
  for (let i = 0; i < pagosRaw.length; i++) {
    const p = pagosRaw[i] || {};
    const fecha = txt(p.fecha_prevista);
    const importe = round2(p.importe);
    if (!fecha) return { error: `El pago ${i + 1} no tiene fecha prevista` };
    if (!(importe > 0)) return { error: `El pago ${i + 1} debe tener un importe mayor que 0` };
    pagos.push({
      numero_pago: intOrNull(p.numero_pago) != null ? intOrNull(p.numero_pago) : i + 1,
      fecha_prevista: fecha,
      importe,
    });
  }
  const suma = round2(pagos.reduce((s, p) => s + p.importe, 0));
  if (Math.abs(suma - round2(importeTotal)) > 0.01) {
    return { error: `La suma de los pagos (${suma} €) no cuadra con el importe total (${round2(importeTotal)} €)` };
  }
  return { pagos };
}

// ==================== Resumen (antes de /:id) ====================
// GET /api/mayoristas/resumen?anio=2026
router.get('/resumen', (req, res) => {
  const anio = intOrNull(req.query.anio) || new Date().getFullYear();
  const filas = db.prepare(`
    SELECT
      m.id   AS mayorista_id,
      m.nombre AS mayorista_nombre,
      c.id   AS contrato_id,
      c.importe_total,
      COALESCE((SELECT SUM(p.importe) FROM mayorista_pagos p WHERE p.contrato_id = c.id AND p.pagado = 1), 0) AS pagado
    FROM mayorista_contratos c
    JOIN mayoristas m ON m.id = c.mayorista_id
    WHERE c.anio = ? AND c.estado <> 'cancelado'
    ORDER BY m.nombre
  `).all(anio);

  const proximo = db.prepare(`
    SELECT fecha_prevista, importe FROM mayorista_pagos
    WHERE contrato_id = ? AND pagado = 0
    ORDER BY fecha_prevista ASC, numero_pago ASC LIMIT 1
  `);

  const por_mayorista = filas.map((f) => {
    const prox = proximo.get(f.contrato_id);
    return {
      mayorista_id: f.mayorista_id,
      mayorista_nombre: f.mayorista_nombre,
      contrato_id: f.contrato_id,
      importe_total: round2(f.importe_total),
      pagado: round2(f.pagado),
      pendiente: round2(f.importe_total - f.pagado),
      proximo_pago_fecha: prox ? prox.fecha_prevista : null,
      proximo_pago_importe: prox ? round2(prox.importe) : null,
    };
  });

  const resumen = {
    total_comprometido: round2(por_mayorista.reduce((s, x) => s + x.importe_total, 0)),
    total_cobrado: round2(por_mayorista.reduce((s, x) => s + x.pagado, 0)),
    total_pendiente: round2(por_mayorista.reduce((s, x) => s + x.pendiente, 0)),
    contratos_activos: por_mayorista.length,
  };
  res.json({ resumen, por_mayorista });
});

// ==================== Contratos (rutas literales, antes de /:id) ====================
// GET /api/mayoristas/contratos?anio=2026 — todos los contratos del año con el mayorista.
router.get('/contratos', (req, res) => {
  const cond = [];
  const params = [];
  const anio = intOrNull(req.query.anio);
  if (anio !== null) { cond.push('c.anio = ?'); params.push(anio); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  res.json(db.prepare(`
    SELECT c.*, m.nombre AS mayorista_nombre,
      COALESCE((SELECT SUM(p.importe) FROM mayorista_pagos p WHERE p.contrato_id = c.id AND p.pagado = 1), 0) AS total_pagado
    FROM mayorista_contratos c
    JOIN mayoristas m ON m.id = c.mayorista_id
    ${where}
    ORDER BY c.anio DESC, m.nombre
  `).all(...params));
});

// GET /api/mayoristas/contratos/:id — detalle del contrato con sus pagos.
router.get('/contratos/:id', (req, res) => {
  const contrato = db.prepare(`
    SELECT c.*, m.nombre AS mayorista_nombre
    FROM mayorista_contratos c JOIN mayoristas m ON m.id = c.mayorista_id
    WHERE c.id = ?
  `).get(req.params.id);
  if (!contrato) return res.status(404).json({ error: 'Contrato no encontrado' });
  contrato.pagos = db.prepare(
    'SELECT * FROM mayorista_pagos WHERE contrato_id = ? ORDER BY numero_pago, fecha_prevista'
  ).all(contrato.id);
  contrato.partidas = db.prepare(
    'SELECT * FROM mayorista_contrato_partidas WHERE contrato_id = ? ORDER BY tipo_clasificacion, fecha_inicio'
  ).all(contrato.id);
  res.json(contrato);
});

// PUT /api/mayoristas/contratos/:id — editar contrato + reemplazar el plan de pagos.
router.put('/contratos/:id', (req, res) => {
  const contrato = db.prepare('SELECT * FROM mayorista_contratos WHERE id = ?').get(req.params.id);
  if (!contrato) return res.status(404).json({ error: 'Contrato no encontrado' });
  const b = req.body || {};

  const anio = intOrNull(b.anio) != null ? intOrNull(b.anio) : contrato.anio;
  const importeTotal = b.importe_total !== undefined ? round2(b.importe_total) : round2(contrato.importe_total);
  if (!(importeTotal > 0)) return res.status(400).json({ error: 'El importe total debe ser mayor que 0' });
  const estado = ESTADOS_CONTRATO.includes(b.estado) ? b.estado : contrato.estado;

  // Duplicado mayorista+año (excluyendo el propio contrato).
  const dup = db.prepare('SELECT id FROM mayorista_contratos WHERE mayorista_id = ? AND anio = ? AND id <> ?')
    .get(contrato.mayorista_id, anio, contrato.id);
  if (dup) return res.status(409).json({ error: 'Ya existe un contrato para ese mayorista en ese año' });

  // Plan de pagos: si viene, valida la suma; si no, conserva los actuales.
  let pagos = null;
  if (b.pagos !== undefined) {
    const r = normalizarPagos(b.pagos, importeTotal);
    if (r.error) return res.status(400).json({ error: r.error });
    pagos = r.pagos;
  }

  const tx = db.transaction(() => {
    db.prepare(`UPDATE mayorista_contratos SET anio = ?, descripcion = ?, importe_total = ?, estado = ?, notas = ? WHERE id = ?`)
      .run(anio, txt(b.descripcion) !== null ? txt(b.descripcion) : contrato.descripcion,
        importeTotal, estado,
        b.notas !== undefined ? txt(b.notas) : contrato.notas, contrato.id);
    if (pagos) {
      db.prepare('DELETE FROM mayorista_pagos WHERE contrato_id = ?').run(contrato.id);
      const ins = db.prepare(
        'INSERT INTO mayorista_pagos (contrato_id, numero_pago, fecha_prevista, importe) VALUES (?, ?, ?, ?)'
      );
      for (const p of pagos) ins.run(contrato.id, p.numero_pago, p.fecha_prevista, p.importe);
    }
  });
  try { tx(); } catch (e) { return res.status(500).json({ error: e.message }); }
  registrarActividad(db, req.usuario && req.usuario.id, actor(req), 'editar', 'mayorista-contrato', contrato.id, `Contrato ${anio}`);
  res.json({ ok: true });
});

// DELETE /api/mayoristas/contratos/:id — solo si no tiene pagos ya marcados como pagados.
router.delete('/contratos/:id', (req, res) => {
  const contrato = db.prepare('SELECT id, anio FROM mayorista_contratos WHERE id = ?').get(req.params.id);
  if (!contrato) return res.status(404).json({ error: 'Contrato no encontrado' });
  const pagados = db.prepare('SELECT COUNT(*) AS c FROM mayorista_pagos WHERE contrato_id = ? AND pagado = 1').get(contrato.id).c;
  if (pagados > 0) return res.status(409).json({ error: 'No se puede borrar: el contrato tiene pagos ya cobrados' });
  db.prepare('DELETE FROM mayorista_contratos WHERE id = ?').run(contrato.id); // pagos en CASCADE
  registrarActividad(db, req.usuario && req.usuario.id, actor(req), 'eliminar', 'mayorista-contrato', contrato.id, `Contrato ${contrato.anio}`);
  res.json({ ok: true });
});

// ==================== Pagos (ruta literal, antes de /:id) ====================
// PUT /api/mayoristas/pagos/:pago_id — marcar/desmarcar pagado + datos del cobro.
router.put('/pagos/:pago_id', (req, res) => {
  const pago = db.prepare('SELECT * FROM mayorista_pagos WHERE id = ?').get(req.params.pago_id);
  if (!pago) return res.status(404).json({ error: 'Pago no encontrado' });
  const b = req.body || {};

  const pagado = b.pagado ? 1 : 0;
  let fecha_pago = txt(b.fecha_pago);
  let metodo_pago = txt(b.metodo_pago);
  if (metodo_pago && !METODOS_PAGO.includes(metodo_pago)) {
    return res.status(400).json({ error: 'Método de pago no válido' });
  }
  if (pagado) {
    if (!fecha_pago) fecha_pago = hoyISO();           // marcar sin fecha → hoy
  } else {
    fecha_pago = null;                                // desmarcar → limpia fecha y método
    metodo_pago = null;
  }
  const numero_factura = b.numero_factura !== undefined ? txt(b.numero_factura) : pago.numero_factura;

  db.prepare('UPDATE mayorista_pagos SET pagado = ?, fecha_pago = ?, metodo_pago = ?, numero_factura = ? WHERE id = ?')
    .run(pagado, fecha_pago, metodo_pago, numero_factura, pago.id);
  registrarActividad(db, req.usuario && req.usuario.id, actor(req), 'editar', 'mayorista-pago', pago.id,
    pagado ? `Pago ${pago.numero_pago} cobrado` : `Pago ${pago.numero_pago} desmarcado`);
  res.json({ ok: true });
});

// ==================== Partidas de contrato (rutas literales, antes de /:id) ====================
// Valida los datos de una partida. Devuelve { error } o { partida }.
function normalizarPartida(b) {
  const tipo_clasificacion = txt(b.tipo_clasificacion);
  if (!tipo_clasificacion) return { error: 'El tipo de clasificación es obligatorio' };
  const fecha_inicio = txt(b.fecha_inicio);
  const fecha_fin = txt(b.fecha_fin);
  const fechaOk = (f) => /^\d{4}-\d{2}-\d{2}$/.test(f || '');
  if (!fechaOk(fecha_inicio) || !fechaOk(fecha_fin)) {
    return { error: 'fecha_inicio y fecha_fin deben tener formato YYYY-MM-DD' };
  }
  if (fecha_inicio >= fecha_fin) return { error: 'fecha_inicio debe ser anterior a fecha_fin' };
  const importe_total = round2(b.importe_total);
  if (!(importe_total > 0)) return { error: 'El importe total debe ser mayor que 0' };
  return {
    partida: {
      nombre: txt(b.nombre),
      tipo_clasificacion,
      fecha_inicio,
      fecha_fin,
      importe_total,
      num_apartamentos: intOrNull(b.num_apartamentos),
      notas: txt(b.notas),
    },
  };
}

// POST /api/mayoristas/contratos/:id/partidas — crear partida.
router.post('/contratos/:id/partidas', (req, res) => {
  const contrato = db.prepare('SELECT id FROM mayorista_contratos WHERE id = ?').get(req.params.id);
  if (!contrato) return res.status(404).json({ error: 'Contrato no encontrado' });
  const r = normalizarPartida(req.body || {});
  if (r.error) return res.status(400).json({ error: r.error });
  const p = r.partida;
  const info = db.prepare(`
    INSERT INTO mayorista_contrato_partidas
      (contrato_id, nombre, tipo_clasificacion, fecha_inicio, fecha_fin, importe_total, num_apartamentos, notas)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(contrato.id, p.nombre, p.tipo_clasificacion, p.fecha_inicio, p.fecha_fin, p.importe_total, p.num_apartamentos, p.notas);
  registrarActividad(db, req.usuario && req.usuario.id, actor(req), 'crear', 'mayorista-partida', info.lastInsertRowid,
    `${p.tipo_clasificacion} ${p.fecha_inicio}→${p.fecha_fin}`);
  res.status(201).json({ id: info.lastInsertRowid });
});

// PUT /api/mayoristas/partidas/:id — editar partida.
router.put('/partidas/:id', (req, res) => {
  const partida = db.prepare('SELECT id FROM mayorista_contrato_partidas WHERE id = ?').get(req.params.id);
  if (!partida) return res.status(404).json({ error: 'Partida no encontrada' });
  const r = normalizarPartida(req.body || {});
  if (r.error) return res.status(400).json({ error: r.error });
  const p = r.partida;
  db.prepare(`
    UPDATE mayorista_contrato_partidas
    SET nombre = ?, tipo_clasificacion = ?, fecha_inicio = ?, fecha_fin = ?, importe_total = ?, num_apartamentos = ?, notas = ?
    WHERE id = ?
  `).run(p.nombre, p.tipo_clasificacion, p.fecha_inicio, p.fecha_fin, p.importe_total, p.num_apartamentos, p.notas, partida.id);
  registrarActividad(db, req.usuario && req.usuario.id, actor(req), 'editar', 'mayorista-partida', partida.id,
    `${p.tipo_clasificacion} ${p.fecha_inicio}→${p.fecha_fin}`);
  res.json({ ok: true });
});

// DELETE /api/mayoristas/partidas/:id — borrar partida. Sin restricciones (no es un cobro).
router.delete('/partidas/:id', (req, res) => {
  const partida = db.prepare('SELECT * FROM mayorista_contrato_partidas WHERE id = ?').get(req.params.id);
  if (!partida) return res.status(404).json({ error: 'Partida no encontrada' });
  db.prepare('DELETE FROM mayorista_contrato_partidas WHERE id = ?').run(partida.id);
  registrarActividad(db, req.usuario && req.usuario.id, actor(req), 'eliminar', 'mayorista-partida', partida.id,
    `${partida.tipo_clasificacion} ${partida.fecha_inicio}→${partida.fecha_fin}`);
  res.json({ ok: true });
});

// ==================== Mayoristas (CRUD) ====================
const MAY_CAMPOS = ['nombre', 'cif', 'direccion', 'telefono', 'email', 'contacto_nombre', 'notas', 'activo'];

// GET /api/mayoristas — lista (activos primero, luego alfabético).
router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM mayoristas ORDER BY activo DESC, nombre').all());
});

// POST /api/mayoristas — crear.
router.post('/', (req, res) => {
  const b = req.body || {};
  const nombre = txt(b.nombre);
  if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
  if (db.prepare('SELECT id FROM mayoristas WHERE nombre = ?').get(nombre)) {
    return res.status(409).json({ error: 'Ya existe un mayorista con ese nombre' });
  }
  const info = db.prepare(`
    INSERT INTO mayoristas (nombre, cif, direccion, telefono, email, contacto_nombre, notas, activo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(nombre, txt(b.cif), txt(b.direccion), txt(b.telefono), txt(b.email), txt(b.contacto_nombre),
    txt(b.notas), b.activo === undefined ? 1 : (b.activo ? 1 : 0));
  registrarActividad(db, req.usuario && req.usuario.id, actor(req), 'crear', 'mayorista', info.lastInsertRowid, nombre);
  res.status(201).json({ id: info.lastInsertRowid });
});

// PUT /api/mayoristas/:id — editar.
router.put('/:id', (req, res) => {
  const may = db.prepare('SELECT * FROM mayoristas WHERE id = ?').get(req.params.id);
  if (!may) return res.status(404).json({ error: 'Mayorista no encontrado' });
  const b = req.body || {};
  if ('nombre' in b) {
    const nombre = txt(b.nombre);
    if (!nombre) return res.status(400).json({ error: 'El nombre no puede quedar vacío' });
    const dup = db.prepare('SELECT id FROM mayoristas WHERE nombre = ? AND id <> ?').get(nombre, may.id);
    if (dup) return res.status(409).json({ error: 'Ya existe otro mayorista con ese nombre' });
  }
  const sets = [];
  const vals = [];
  for (const c of MAY_CAMPOS) {
    if (!(c in b)) continue;
    sets.push(`${c} = ?`);
    vals.push(c === 'activo' ? (b[c] ? 1 : 0) : txt(b[c]));
  }
  if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
  vals.push(may.id);
  db.prepare(`UPDATE mayoristas SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  registrarActividad(db, req.usuario && req.usuario.id, actor(req), 'editar', 'mayorista', may.id, txt(b.nombre) || may.nombre);
  res.json({ ok: true });
});

// DELETE /api/mayoristas/:id — solo si no tiene contratos.
router.delete('/:id', (req, res) => {
  const may = db.prepare('SELECT id, nombre FROM mayoristas WHERE id = ?').get(req.params.id);
  if (!may) return res.status(404).json({ error: 'Mayorista no encontrado' });
  const n = db.prepare('SELECT COUNT(*) AS c FROM mayorista_contratos WHERE mayorista_id = ?').get(may.id).c;
  if (n > 0) return res.status(409).json({ error: 'No se puede borrar: el mayorista tiene contratos asociados' });
  db.prepare('DELETE FROM mayoristas WHERE id = ?').run(may.id);
  registrarActividad(db, req.usuario && req.usuario.id, actor(req), 'eliminar', 'mayorista', may.id, may.nombre);
  res.json({ ok: true });
});

// GET /api/mayoristas/:id/contratos?anio= — contratos de un mayorista.
router.get('/:id/contratos', (req, res) => {
  const may = db.prepare('SELECT id FROM mayoristas WHERE id = ?').get(req.params.id);
  if (!may) return res.status(404).json({ error: 'Mayorista no encontrado' });
  const cond = ['c.mayorista_id = ?'];
  const params = [may.id];
  const anio = intOrNull(req.query.anio);
  if (anio !== null) { cond.push('c.anio = ?'); params.push(anio); }
  res.json(db.prepare(`
    SELECT c.*,
      COALESCE((SELECT SUM(p.importe) FROM mayorista_pagos p WHERE p.contrato_id = c.id AND p.pagado = 1), 0) AS total_pagado
    FROM mayorista_contratos c
    WHERE ${cond.join(' AND ')}
    ORDER BY c.anio DESC
  `).all(...params));
});

// POST /api/mayoristas/:id/contratos — crear contrato anual + plan de pagos (transacción).
router.post('/:id/contratos', (req, res) => {
  const may = db.prepare('SELECT id FROM mayoristas WHERE id = ?').get(req.params.id);
  if (!may) return res.status(404).json({ error: 'Mayorista no encontrado' });
  const b = req.body || {};

  const anio = intOrNull(b.anio);
  if (anio === null) return res.status(400).json({ error: 'El año es obligatorio' });
  const importeTotal = round2(b.importe_total);
  if (!(importeTotal > 0)) return res.status(400).json({ error: 'El importe total debe ser mayor que 0' });

  if (db.prepare('SELECT id FROM mayorista_contratos WHERE mayorista_id = ? AND anio = ?').get(may.id, anio)) {
    return res.status(409).json({ error: 'Ya existe un contrato para ese mayorista en ese año' });
  }

  const r = normalizarPagos(b.pagos, importeTotal);
  if (r.error) return res.status(400).json({ error: r.error });

  let nuevoId;
  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO mayorista_contratos (mayorista_id, anio, descripcion, importe_total, estado, notas)
      VALUES (?, ?, ?, ?, 'activo', ?)
    `).run(may.id, anio, txt(b.descripcion), importeTotal, txt(b.notas));
    nuevoId = info.lastInsertRowid;
    const ins = db.prepare(
      'INSERT INTO mayorista_pagos (contrato_id, numero_pago, fecha_prevista, importe) VALUES (?, ?, ?, ?)'
    );
    for (const p of r.pagos) ins.run(nuevoId, p.numero_pago, p.fecha_prevista, p.importe);
  });
  try { tx(); } catch (e) { return res.status(500).json({ error: e.message }); }
  registrarActividad(db, req.usuario && req.usuario.id, actor(req), 'crear', 'mayorista-contrato', nuevoId, `Contrato ${anio}`);
  res.status(201).json({ id: nuevoId });
});

module.exports = router;
