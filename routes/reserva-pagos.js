// API REST del plan de pagos de una reserva (huésped). Router con mergeParams montado en
// server.js bajo /api/reservas/:id/pagos. Va bajo requireAuth -> req.usuario = { id, nombre, ... }.
const express = require('express');
const db = require('../db/database');
const { registrarActividad } = require('../services/actividadService');

const METODOS = ['caja', 'tpv', 'transferencia'];

// --- Helpers de coerción (better-sqlite3 lanza al hacer bind de undefined) ---
function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function txt(v) { return v === undefined || v === null || v === '' ? null : String(v); }
function metodo(v) { return METODOS.includes(v) ? v : null; }
function r2(n) { return Math.round(n * 100) / 100; }

function getReserva(id) {
  return db.prepare('SELECT id, precio_total FROM reservas WHERE id = ?').get(id);
}

const router = express.Router({ mergeParams: true });

// Lista los pagos de la reserva (por orden) + resumen de totales.
router.get('/', (req, res) => {
  const reserva = getReserva(req.params.id);
  if (!reserva) return res.status(404).json({ error: 'Reserva no encontrada' });

  const pagos = db.prepare(
    'SELECT * FROM reserva_pagos WHERE reserva_id = ? ORDER BY orden, id'
  ).all(req.params.id);

  const total_pagado = pagos.reduce((s, p) => s + (p.pagado ? Number(p.importe) || 0 : 0), 0);
  const total_pendiente = pagos.reduce((s, p) => s + (p.pagado ? 0 : Number(p.importe) || 0), 0);

  res.json({
    pagos,
    total_pagado: r2(total_pagado),
    total_pendiente: r2(total_pendiente),
    precio_total_reserva: Number(reserva.precio_total) || 0,
  });
});

// Crea un pago manual.
router.post('/', (req, res) => {
  const reserva = getReserva(req.params.id);
  if (!reserva) return res.status(404).json({ error: 'Reserva no encontrada' });

  const b = req.body || {};
  const concepto = String(b.concepto || '').trim();
  if (!concepto) return res.status(400).json({ error: 'El concepto es obligatorio' });

  const pagado = b.pagado ? 1 : 0;
  // Si llega marcado como pagado sin fecha, se usa hoy.
  let fecha_pago = txt(b.fecha_pago);
  if (pagado && !fecha_pago) fecha_pago = new Date().toISOString().slice(0, 10);
  if (!pagado) fecha_pago = null;

  // orden: siguiente al máximo existente.
  const maxOrden = db.prepare('SELECT COALESCE(MAX(orden), 0) AS m FROM reserva_pagos WHERE reserva_id = ?')
    .get(req.params.id).m;

  const info = db.prepare(`
    INSERT INTO reserva_pagos (reserva_id, concepto, importe, metodo_pago, pagado, fecha_pago, notas, orden)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.params.id, concepto, num(b.importe), metodo(b.metodo_pago), pagado, fecha_pago, txt(b.notas), maxOrden + 1);

  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'crear', 'reserva_pago', info.lastInsertRowid, `${concepto} (reserva ${req.params.id})`);
  res.status(201).json({ id: info.lastInsertRowid });
});

// Genera el plan automático 20% / 80%. Borra los pagos NO pagados existentes y crea las dos cuotas.
router.post('/generar-plan', (req, res) => {
  const reserva = getReserva(req.params.id);
  if (!reserva) return res.status(404).json({ error: 'Reserva no encontrada' });

  const precio = Number(reserva.precio_total) || 0;
  if (precio <= 0) {
    return res.status(409).json({ error: 'Introduce primero el precio total de la reserva' });
  }

  const generar = db.transaction(() => {
    db.prepare('DELETE FROM reserva_pagos WHERE reserva_id = ? AND pagado = 0').run(req.params.id);
    const ins = db.prepare(`
      INSERT INTO reserva_pagos (reserva_id, concepto, importe, pagado, fecha_pago, orden)
      VALUES (?, ?, ?, 0, NULL, ?)
    `);
    ins.run(req.params.id, 'Confirmación (20%)', r2(precio * 0.2), 1);
    ins.run(req.params.id, 'Resto a la llegada (80%)', r2(precio * 0.8), 2);
  });
  generar();

  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'crear', 'reserva_pago', req.params.id, `Plan 20/80 (reserva ${req.params.id})`);
  res.status(201).json({ ok: true });
});

// Edita un pago (concepto, importe, metodo_pago, pagado, fecha_pago, notas) — solo campos presentes.
router.put('/:pago_id', (req, res) => {
  const pago = db.prepare('SELECT * FROM reserva_pagos WHERE id = ? AND reserva_id = ?')
    .get(req.params.pago_id, req.params.id);
  if (!pago) return res.status(404).json({ error: 'Pago no encontrado' });

  const b = req.body || {};
  const concepto = b.concepto !== undefined ? (String(b.concepto || '').trim() || pago.concepto) : pago.concepto;
  const importe = b.importe !== undefined ? num(b.importe) : pago.importe;
  const metodo_pago = b.metodo_pago !== undefined ? metodo(b.metodo_pago) : pago.metodo_pago;
  const pagado = b.pagado !== undefined ? (b.pagado ? 1 : 0) : pago.pagado;

  // fecha_pago: si se marca pagado sin fecha -> hoy; si se desmarca -> null.
  let fecha_pago = b.fecha_pago !== undefined ? txt(b.fecha_pago) : pago.fecha_pago;
  if (pagado && !fecha_pago) fecha_pago = new Date().toISOString().slice(0, 10);
  if (!pagado) fecha_pago = null;

  const notas = b.notas !== undefined ? txt(b.notas) : pago.notas;

  db.prepare(`
    UPDATE reserva_pagos SET concepto = ?, importe = ?, metodo_pago = ?, pagado = ?, fecha_pago = ?, notas = ?
    WHERE id = ?
  `).run(concepto, importe, metodo_pago, pagado, fecha_pago, notas, req.params.pago_id);

  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'editar', 'reserva_pago', req.params.pago_id, concepto);
  res.json({ ok: true });
});

// Elimina un pago.
router.delete('/:pago_id', (req, res) => {
  const pago = db.prepare('SELECT concepto FROM reserva_pagos WHERE id = ? AND reserva_id = ?')
    .get(req.params.pago_id, req.params.id);
  if (!pago) return res.status(404).json({ error: 'Pago no encontrado' });
  db.prepare('DELETE FROM reserva_pagos WHERE id = ?').run(req.params.pago_id);
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'eliminar', 'reserva_pago', req.params.pago_id, pago.concepto);
  res.json({ ok: true });
});

module.exports = router;
