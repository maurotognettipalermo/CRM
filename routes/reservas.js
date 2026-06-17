// API REST de reservas.
const express = require('express');
const db = require('../db/database');
const { solapan } = require('../services/dateUtils');
const { normalizaTih } = require('../services/asignacion');
const { registrarActividad } = require('../services/actividadService');

const router = express.Router();

// Inserta el plan de pagos 20%/80% de una reserva (2 cuotas sin pagar). Debe llamarse
// dentro de una transacción (no abre la suya). precio = precio_total (> 0).
function generarPlanPagos(reservaId, precio) {
  const r2 = (n) => Math.round(n * 100) / 100;
  const ins = db.prepare(`
    INSERT INTO reserva_pagos (reserva_id, concepto, importe, pagado, fecha_pago, orden)
    VALUES (?, ?, ?, 0, NULL, ?)
  `);
  ins.run(reservaId, 'Confirmación (20%)', r2(precio * 0.2), 1);
  ins.run(reservaId, 'Resto a la llegada (80%)', r2(precio * 0.8), 2);
}

// Genera un número de reserva automático a partir del prefijo del portal.
// Con prefijo: {PREFIJO}-NNNN (4 dígitos), incrementando el máximo existente.
// Sin prefijo (o portal desconocido): R-{timestamp} como fallback.
function generarNumeroReserva(portalNombre) {
  const portal = portalNombre
    ? db.prepare('SELECT prefijo FROM portales WHERE nombre = ?').get(portalNombre) : null;
  const prefijo = portal && portal.prefijo ? String(portal.prefijo).trim().toUpperCase() : null;
  if (!prefijo) return 'R-' + Date.now();

  const rows = db.prepare('SELECT numero_reserva FROM reservas WHERE numero_reserva LIKE ?').all(prefijo + '-%');
  const re = new RegExp('^' + prefijo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-(\\d+)$', 'i');
  let max = 0;
  for (const r of rows) {
    const m = re.exec(r.numero_reserva || '');
    if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; }
  }
  return `${prefijo}-${String(max + 1).padStart(4, '0')}`;
}

// Reservas para el planning (vista continua de días). Devuelve las que solapan
// la ventana visible [desde, hasta], con hasta = último día visible (inclusive).
// Parámetros: ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&tih=1|2
router.get('/', (req, res) => {
  const { desde, hasta } = req.query;
  const tih = normalizaTih(req.query.tih);

  let sql = 'SELECT * FROM reservas WHERE 1=1';
  const params = [];

  // Solape con la ventana: empieza en o antes del último día visible (entrada <= hasta)
  // y sigue ocupada después del primer día visible (salida > desde, intervalo medio abierto).
  if (desde && hasta) {
    sql += ' AND entrada <= ? AND salida > ?';
    params.push(hasta, desde);
  }
  if (tih) {
    sql += ' AND tih = ?';
    params.push(tih);
  }
  sql += ' ORDER BY entrada';
  res.json(db.prepare(sql).all(...params));
});

// Reservas sin apartamento asignado (bandeja "Sin asignar"), con filtro opcional de TIH.
router.get('/sin-asignar', (req, res) => {
  const tih = normalizaTih(req.query.tih);
  let sql = 'SELECT * FROM reservas WHERE apartamento_id IS NULL';
  const params = [];
  if (tih) {
    sql += ' AND tih = ?';
    params.push(tih);
  }
  sql += ' ORDER BY entrada';
  res.json(db.prepare(sql).all(...params));
});

// Todas las reservas con nombre del apartamento, ordenadas por entrada DESC. Usada por la pestaña Reservas.
router.get('/todas', (req, res) => {
  res.json(
    db.prepare(`
      SELECT r.*, a.nombre AS apartamento_nombre
      FROM reservas r
      LEFT JOIN apartamentos a ON a.id = r.apartamento_id
      ORDER BY r.entrada DESC
    `).all()
  );
});

// Verifica si un apartamento está libre para un rango de fechas.
// ?apartamento_id=X&entrada=YYYY-MM-DD&salida=YYYY-MM-DD[&excluir_reserva_id=Y]
router.get('/verificar-disponibilidad', (req, res) => {
  const { apartamento_id, entrada, salida, excluir_reserva_id } = req.query;
  if (!apartamento_id || !entrada || !salida) {
    return res.status(400).json({ error: 'Faltan parámetros: apartamento_id, entrada y salida son obligatorios' });
  }

  // Solapan: entrada < salida_otra AND salida > entrada_otra
  let sql = 'SELECT * FROM reservas WHERE apartamento_id = ? AND entrada < ? AND salida > ?';
  const params = [apartamento_id, salida, entrada];
  if (excluir_reserva_id) {
    sql += ' AND id <> ?';
    params.push(excluir_reserva_id);
  }

  const conflicto = db.prepare(sql).get(...params);
  if (conflicto) {
    return res.json({
      disponible: false,
      conflicto: {
        nombre_cliente: conflicto.nombre_cliente,
        entrada: conflicto.entrada,
        salida: conflicto.salida,
      },
    });
  }
  res.json({ disponible: true });
});

// Ficha de una reserva.
router.get('/:id', (req, res) => {
  const reserva = db
    .prepare(
      `SELECT r.*, a.nombre AS apartamento_nombre,
              TRIM(COALESCE(c.nombre,'') || ' ' || COALESCE(c.apellido1,'') || ' ' || COALESCE(c.apellido2,'')) AS cliente_nombre_completo,
              c.telefono AS cliente_telefono, c.email AS cliente_email
       FROM reservas r
       LEFT JOIN apartamentos a ON a.id = r.apartamento_id
       LEFT JOIN clientes c ON c.id = r.cliente_id
       WHERE r.id = ?`
    )
    .get(req.params.id);
  if (!reserva) return res.status(404).json({ error: 'Reserva no encontrada' });
  res.json(reserva);
});

// Crea una reserva manualmente desde la pestaña Reservas.
router.post('/', (req, res) => {
  const {
    numero_reserva, nombre_cliente, contrato, edificio,
    tih, personas, entrada, salida, observaciones, apartamento_id, precio_total, portal, cliente_id,
  } = req.body;

  // Número de reserva: si no viene, se autogenera con el prefijo del portal.
  const numeroFinal = numero_reserva && String(numero_reserva).trim()
    ? String(numero_reserva).trim()
    : generarNumeroReserva(portal);

  if (!nombre_cliente || !String(nombre_cliente).trim())
    return res.status(400).json({ error: 'El nombre del cliente es obligatorio' });
  if (!entrada) return res.status(400).json({ error: 'La fecha de entrada es obligatoria' });
  if (!salida)  return res.status(400).json({ error: 'La fecha de salida es obligatoria' });
  if (entrada >= salida)
    return res.status(400).json({ error: 'La entrada debe ser anterior a la salida' });

  const tihNorm = normalizaTih(tih);
  if (!tihNorm) return res.status(400).json({ error: 'TIH inválida (debe ser 1ª o 2ª Línea)' });

  const existente = db.prepare('SELECT id FROM reservas WHERE numero_reserva = ?').get(numeroFinal);
  if (existente)
    return res.status(409).json({ error: `Ya existe una reserva con el número "${numeroFinal}"` });

  const p = parseInt(personas, 10);
  const precioNum = Math.round((Number(precio_total) || 0) * 100) / 100;

  // Insert de la reserva + (si hay precio) plan de pagos 20/80, en una sola transacción.
  const crear = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO reservas
        (numero_reserva, nombre_cliente, contrato, edificio, tih, personas, entrada, salida, observaciones, apartamento_id, precio_total, pendiente, cliente_id, fecha_creacion)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      numeroFinal,
      nombre_cliente,
      contrato  || null,
      edificio  || null,
      tihNorm,
      isNaN(p) ? null : p,
      entrada,
      salida,
      observaciones || null,
      apartamento_id || null,
      precioNum,
      precioNum,
      cliente_id || null
    );
    if (precioNum > 0) generarPlanPagos(info.lastInsertRowid, precioNum);
    return info.lastInsertRowid;
  });
  const nuevoId = crear();

  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'crear', 'reserva', nuevoId, `${numeroFinal} · ${nombre_cliente || ''}`);
  res.status(201).json({ id: nuevoId, numero_reserva: numeroFinal });
});

// Mueve una reserva a otro apartamento (drag & drop). Valida que no solape en el destino.
// Body: { apartamento_id }  (null = devolver a "Sin asignar").
router.put('/:id/mover', (req, res) => {
  const reserva = db.prepare('SELECT * FROM reservas WHERE id = ?').get(req.params.id);
  if (!reserva) return res.status(404).json({ error: 'Reserva no encontrada' });

  const destino = req.body.apartamento_id || null;

  if (destino !== null) {
    const apto = db.prepare('SELECT id FROM apartamentos WHERE id = ?').get(destino);
    if (!apto) return res.status(400).json({ error: 'El alojamiento destino no existe' });

    const otras = db
      .prepare('SELECT entrada, salida FROM reservas WHERE apartamento_id = ? AND id <> ?')
      .all(destino, reserva.id);
    const choca = otras.some((o) => solapan(reserva.entrada, reserva.salida, o.entrada, o.salida));
    if (choca) {
      return res
        .status(409)
        .json({ error: 'No se puede mover: las fechas se solapan con otra reserva de ese piso' });
    }
  }

  db.prepare('UPDATE reservas SET apartamento_id = ? WHERE id = ?').run(destino, reserva.id);
  const detalleMover = destino
    ? `${reserva.numero_reserva} → alojamiento ${destino}`
    : `${reserva.numero_reserva} → Sin asignar`;
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'mover', 'reserva', reserva.id, detalleMover);
  res.json({ ok: true });
});

// Campos editables vía PUT (numero_reserva y fecha_creacion NO se tocan; pendiente se calcula).
const CAMPOS_EDITABLES = [
  'nombre_cliente', 'contrato', 'edificio', 'tih', 'personas', 'entrada', 'salida',
  'observaciones', 'apartamento_id', 'tipo_reserva', 'portal', 'condicion_cancelacion',
  'atendido_por', 'hora_entrada', 'hora_salida', 'checkin_estado', 'checkout_estado',
  'precio_base', 'precio_total', 'pagado', 'notas_internas', 'ocupante', 'cliente_id',
];

function aNumero(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

// Edición manual de una reserva (incluye todos los campos de gestión de la ficha).
router.put('/:id', (req, res) => {
  const actual = db.prepare('SELECT * FROM reservas WHERE id = ?').get(req.params.id);
  if (!actual) return res.status(404).json({ error: 'Reserva no encontrada' });

  const b = req.body || {};
  const datos = {};
  for (const c of CAMPOS_EDITABLES) {
    if (c in b) datos[c] = b[c];
  }
  if ('tih' in datos) datos.tih = normalizaTih(datos.tih);
  if ('apartamento_id' in datos) datos.apartamento_id = datos.apartamento_id || null;
  if ('cliente_id' in datos) datos.cliente_id = datos.cliente_id || null;
  for (const k of ['precio_base', 'precio_total', 'pagado']) {
    if (k in datos) datos[k] = aNumero(datos[k]);
  }

  // atendido_por: se rellena con el usuario actual si no se envía explícitamente.
  if (!('atendido_por' in b) || !b.atendido_por) {
    datos.atendido_por = (req.usuario && req.usuario.username) || actual.atendido_por || null;
  }

  // pendiente = precio_total - pagado (con los valores efectivos a guardar).
  const precioTotal = 'precio_total' in datos ? datos.precio_total : aNumero(actual.precio_total);
  const pagado = 'pagado' in datos ? datos.pagado : aNumero(actual.pagado);
  datos.pendiente = precioTotal - pagado;

  const claves = Object.keys(datos);
  const set = claves.map((c) => `${c}=@${c}`).join(', ');
  db.prepare(`UPDATE reservas SET ${set} WHERE id=@id`).run({ ...datos, id: req.params.id });

  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'editar', 'reserva', req.params.id, datos.nombre_cliente || actual.nombre_cliente || '');
  res.json({ ok: true });
});

// Elimina una reserva (cancelación manual).
router.delete('/:id', (req, res) => {
  const reserva = db.prepare('SELECT numero_reserva, nombre_cliente FROM reservas WHERE id = ?').get(req.params.id);
  const info = db.prepare('DELETE FROM reservas WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Reserva no encontrada' });
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'eliminar', 'reserva', req.params.id, reserva && `${reserva.numero_reserva} · ${reserva.nombre_cliente || ''}`);
  res.json({ ok: true });
});

module.exports = router;
