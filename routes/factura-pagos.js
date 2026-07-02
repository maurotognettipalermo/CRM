// API REST de los pagos parciales de una factura (los acreedores a veces pagan en varias
// veces). Router con mergeParams montado en server.js bajo /api/facturas/:id/pagos, ANTES
// del router de facturas. Va bajo requireAuth -> req.usuario = { id, nombre, ... }.
// El estado de la factura (emitida / parcialmente_pagada / pagada) se recalcula siempre a
// partir de la suma de estos pagos frente a facturas.total — nunca se fija a mano aquí.
const express = require('express');
const db = require('../db/database');
const { registrarActividad } = require('../services/actividadService');

const METODOS = ['caja', 'tpv', 'transferencia'];

// --- Helpers de coerción (better-sqlite3 lanza al hacer bind de undefined) ---
function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function txt(v) { return v === undefined || v === null || v === '' ? null : String(v); }
function metodo(v) { return METODOS.includes(v) ? v : null; }
function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function hoyISO() { return new Date().toISOString().slice(0, 10); }

function getFactura(id) {
  return db.prepare('SELECT id, total, estado FROM facturas WHERE id = ?').get(id);
}

// Recalcula el estado de la factura a partir de la suma de factura_pagos. No toca facturas
// 'anulada' ni 'borrador' (los pagos parciales solo aplican a facturas ya emitidas).
function recalcularEstadoFactura(facturaId) {
  const factura = getFactura(facturaId);
  if (!factura || factura.estado === 'anulada' || factura.estado === 'borrador') return;

  const suma = db.prepare('SELECT COALESCE(SUM(importe), 0) AS s FROM factura_pagos WHERE factura_id = ?')
    .get(facturaId).s;

  let nuevoEstado;
  if (suma >= (Number(factura.total) || 0) - 0.01) nuevoEstado = 'pagada';
  else if (suma > 0) nuevoEstado = 'parcialmente_pagada';
  else nuevoEstado = 'emitida';

  if (nuevoEstado !== factura.estado) {
    db.prepare('UPDATE facturas SET estado = ? WHERE id = ?').run(nuevoEstado, facturaId);
  }
}

const router = express.Router({ mergeParams: true });

// Lista los pagos de la factura + resumen de totales.
router.get('/', (req, res) => {
  const factura = getFactura(req.params.id);
  if (!factura) return res.status(404).json({ error: 'Factura no encontrada' });

  const pagos = db.prepare(
    'SELECT * FROM factura_pagos WHERE factura_id = ? ORDER BY fecha_pago, id'
  ).all(req.params.id);

  const total_pagado = pagos.reduce((s, p) => s + (Number(p.importe) || 0), 0);
  const total_factura = Number(factura.total) || 0;

  res.json({
    pagos,
    total_pagado: r2(total_pagado),
    total_pendiente: r2(total_factura - total_pagado),
    total_factura,
  });
});

// Crea un pago parcial.
router.post('/', (req, res) => {
  const factura = getFactura(req.params.id);
  if (!factura) return res.status(404).json({ error: 'Factura no encontrada' });
  if (factura.estado === 'anulada') {
    return res.status(409).json({ error: 'No se pueden registrar pagos en una factura anulada' });
  }

  const b = req.body || {};
  const importe = num(b.importe);
  if (importe <= 0) return res.status(400).json({ error: 'El importe debe ser mayor que 0' });
  const fecha_pago = txt(b.fecha_pago) || hoyISO();

  const info = db.prepare(`
    INSERT INTO factura_pagos (factura_id, importe, fecha_pago, metodo_pago, notas)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.params.id, importe, fecha_pago, metodo(b.metodo_pago), txt(b.notas));

  recalcularEstadoFactura(req.params.id);

  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'crear', 'factura_pago', info.lastInsertRowid, `${importe} € (factura ${req.params.id})`);
  res.status(201).json({ id: info.lastInsertRowid });
});

// Edita un pago (importe, fecha_pago, metodo_pago, notas) — solo campos presentes.
router.put('/:pago_id', (req, res) => {
  const pago = db.prepare('SELECT * FROM factura_pagos WHERE id = ? AND factura_id = ?')
    .get(req.params.pago_id, req.params.id);
  if (!pago) return res.status(404).json({ error: 'Pago no encontrado' });

  const b = req.body || {};
  const importe = b.importe !== undefined ? num(b.importe) : pago.importe;
  if (importe <= 0) return res.status(400).json({ error: 'El importe debe ser mayor que 0' });
  const fecha_pago = b.fecha_pago !== undefined ? (txt(b.fecha_pago) || hoyISO()) : pago.fecha_pago;
  const metodo_pago = b.metodo_pago !== undefined ? metodo(b.metodo_pago) : pago.metodo_pago;
  const notas = b.notas !== undefined ? txt(b.notas) : pago.notas;

  db.prepare(`
    UPDATE factura_pagos SET importe = ?, fecha_pago = ?, metodo_pago = ?, notas = ?
    WHERE id = ?
  `).run(importe, fecha_pago, metodo_pago, notas, req.params.pago_id);

  recalcularEstadoFactura(req.params.id);

  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'editar', 'factura_pago', req.params.pago_id, `${importe} € (factura ${req.params.id})`);
  res.json({ ok: true });
});

// Elimina un pago.
router.delete('/:pago_id', (req, res) => {
  const pago = db.prepare('SELECT id FROM factura_pagos WHERE id = ? AND factura_id = ?')
    .get(req.params.pago_id, req.params.id);
  if (!pago) return res.status(404).json({ error: 'Pago no encontrado' });

  db.prepare('DELETE FROM factura_pagos WHERE id = ?').run(req.params.pago_id);
  recalcularEstadoFactura(req.params.id);

  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'eliminar', 'factura_pago', req.params.pago_id, `factura ${req.params.id}`);
  res.json({ ok: true });
});

module.exports = router;
