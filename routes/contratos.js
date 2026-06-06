// API REST de contratos de gestión con el propietario y sus cuotas de pago.
// Dos tipos: 'precio_cerrado' (importe garantizado total repartido en cuotas) y
// 'comision' (% sobre el precio de cada reserva). Montado bajo requireAuth, así que
// req.usuario = { id, nombre, username, rol } está disponible.
const express = require('express');
const db = require('../db/database');
const { registrarActividad } = require('../services/actividadService');

const router = express.Router();

const TIPOS = ['precio_cerrado', 'comision'];
const ESTADOS = ['activo', 'finalizado', 'cancelado'];

// --- Helpers de coerción (better-sqlite3 lanza al hacer bind de undefined) ---
function num(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}
function intOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}
function txt(v) {
  return v === undefined || v === null ? null : String(v);
}

// Valida el cuerpo de un contrato (POST/PUT). Devuelve { error } o { ok, datos, cuotas }.
function validarContrato(body) {
  const b = body || {};

  const apartamento_id = intOrNull(b.apartamento_id);
  if (apartamento_id === null) return { error: 'El apartamento es obligatorio' };
  const apto = db.prepare('SELECT id FROM apartamentos WHERE id = ?').get(apartamento_id);
  if (!apto) return { error: 'El apartamento indicado no existe' };

  const tipo = String(b.tipo || '');
  if (!TIPOS.includes(tipo)) return { error: "Tipo inválido (precio_cerrado o comision)" };

  const temporada_inicio = String(b.temporada_inicio || '').trim();
  const temporada_fin = String(b.temporada_fin || '').trim();
  if (!temporada_inicio || !temporada_fin) {
    return { error: 'Las fechas de temporada son obligatorias' };
  }
  if (!(temporada_inicio < temporada_fin)) {
    return { error: 'La fecha de inicio debe ser anterior a la de fin' };
  }

  // Año: el del body o, en su defecto, el de la fecha de inicio.
  let anio = intOrNull(b.anio);
  if (anio === null) anio = parseInt(temporada_inicio.slice(0, 4), 10);
  if (!anio || isNaN(anio)) return { error: 'El año del contrato es obligatorio' };

  const estado = ESTADOS.includes(b.estado) ? b.estado : 'activo';
  const precio_total = num(b.precio_total);
  const porcentaje_comision = num(b.porcentaje_comision);

  // Fiscalidad (solo aplica de cara al cálculo en precio_cerrado, pero se guarda siempre).
  const aplica_iva = (b.aplica_iva === undefined || b.aplica_iva === null) ? 1 : (b.aplica_iva ? 1 : 0);
  const RETENCIONES_VALIDAS = [0, 19, 24];
  let porcentaje_retencion = num(b.porcentaje_retencion);
  if (!RETENCIONES_VALIDAS.includes(porcentaje_retencion)) porcentaje_retencion = 19;

  // Normaliza las cuotas.
  const cuotasIn = Array.isArray(b.cuotas) ? b.cuotas : [];
  const cuotas = cuotasIn.map((c, i) => ({
    numero_cuota: intOrNull(c.numero_cuota) != null ? intOrNull(c.numero_cuota) : i + 1,
    fecha_prevista: String(c.fecha_prevista || '').trim(),
    importe: num(c.importe),
    // pagado/fecha_pago son opcionales (permiten conservar el estado al reemplazar en PUT).
    pagado: c.pagado ? 1 : 0,
    fecha_pago: txt(c.fecha_pago),
    notas: txt(c.notas),
  }));

  for (const c of cuotas) {
    if (!c.fecha_prevista) return { error: 'Cada cuota necesita una fecha prevista' };
  }

  // En precio cerrado, la suma de cuotas debe cuadrar con el importe garantizado.
  if (tipo === 'precio_cerrado') {
    const suma = cuotas.reduce((s, c) => s + c.importe, 0);
    if (Math.abs(suma - precio_total) > 0.01) {
      return { error: `La suma de las cuotas (${suma.toFixed(2)} €) no coincide con el precio total (${precio_total.toFixed(2)} €)` };
    }
  }

  // Propietario: si no llega, se autorrellena con el propietario ACTIVO del apartamento
  // (relación N:M). Con varios activos hay que especificarlo; sin ninguno queda null.
  let propietario_id = intOrNull(b.propietario_id);
  if (propietario_id === null) {
    const activos = db.prepare(
      `SELECT propietario_id FROM apartamento_propietarios
       WHERE apartamento_id = ? AND activo = 1
       ORDER BY porcentaje DESC, fecha_inicio ASC`
    ).all(apartamento_id);
    if (activos.length === 1) propietario_id = activos[0].propietario_id;
    else if (activos.length > 1) {
      return { error: 'El apartamento tiene varios propietarios activos: especifica el propietario del contrato' };
    }
  }

  return {
    ok: true,
    datos: {
      apartamento_id,
      propietario_id,
      tipo,
      temporada_inicio,
      temporada_fin,
      anio,
      precio_total,
      porcentaje_comision,
      aplica_iva,
      porcentaje_retencion,
      estado,
      notas: txt(b.notas),
    },
    cuotas,
  };
}

// GET /api/contratos?anio=&apartamento_id=&propietario_id=
// Lista con nombre de apartamento y de propietario. Filtros opcionales.
router.get('/', (req, res) => {
  const cond = [];
  const params = [];
  const anio = intOrNull(req.query.anio);
  const apartamentoId = intOrNull(req.query.apartamento_id);
  const propietarioId = intOrNull(req.query.propietario_id);
  if (anio !== null) { cond.push('c.anio = ?'); params.push(anio); }
  if (apartamentoId !== null) { cond.push('c.apartamento_id = ?'); params.push(apartamentoId); }
  if (propietarioId !== null) { cond.push('c.propietario_id = ?'); params.push(propietarioId); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';

  const filas = db.prepare(`
    SELECT
      c.*,
      a.nombre                                              AS apartamento_nombre,
      p.nombre                                              AS propietario_nombre,
      p.apellidos                                           AS propietario_apellidos
    FROM contratos c
    JOIN apartamentos a ON a.id = c.apartamento_id
    LEFT JOIN propietarios p ON p.id = c.propietario_id
    ${where}
    ORDER BY c.anio DESC, a.nombre
  `).all(...params);

  res.json(filas);
});

// GET /api/contratos/resumen-propietario?propietario_id=X&anio=2026
// Resumen por contrato del propietario ese año (base de la futura liquidación).
// Declarado ANTES de /:id para que Express no lo tome como parámetro.
router.get('/resumen-propietario', (req, res) => {
  const propietarioId = intOrNull(req.query.propietario_id);
  if (propietarioId === null) return res.status(400).json({ error: 'propietario_id es obligatorio' });
  const anio = intOrNull(req.query.anio) || new Date().getFullYear();

  const contratos = db.prepare(`
    SELECT
      c.id                                                                       AS contrato_id,
      c.tipo                                                                      AS tipo,
      c.precio_total                                                             AS precio_total,
      c.porcentaje_comision                                                      AS porcentaje_comision,
      a.nombre                                                                   AS apartamento_nombre,
      c.apartamento_id                                                           AS apartamento_id,
      COUNT(q.id)                                                                AS total_cuotas,
      COALESCE(SUM(q.pagado), 0)                                                 AS cuotas_pagadas,
      COALESCE(SUM(CASE WHEN q.pagado = 1 THEN q.importe ELSE 0 END), 0)         AS importe_pagado,
      COALESCE(SUM(CASE WHEN q.pagado = 0 THEN q.importe ELSE 0 END), 0)         AS importe_pendiente
    FROM contratos c
    JOIN apartamentos a ON a.id = c.apartamento_id
    LEFT JOIN contrato_cuotas q ON q.contrato_id = c.id
    WHERE c.propietario_id = ? AND c.anio = ?
    GROUP BY c.id, c.tipo, c.precio_total, c.porcentaje_comision, a.nombre, c.apartamento_id
    ORDER BY a.nombre
  `).all(propietarioId, anio);

  res.json({ propietario_id: propietarioId, anio, contratos });
});

// GET /api/contratos/:id — ficha completa + cuotas.
router.get('/:id', (req, res) => {
  const contrato = db.prepare(`
    SELECT
      c.*,
      a.nombre                                              AS apartamento_nombre,
      a.tipo                                                AS apartamento_tih,
      p.nombre                                              AS propietario_nombre,
      p.apellidos                                           AS propietario_apellidos
    FROM contratos c
    JOIN apartamentos a ON a.id = c.apartamento_id
    LEFT JOIN propietarios p ON p.id = c.propietario_id
    WHERE c.id = ?
  `).get(req.params.id);

  if (!contrato) return res.status(404).json({ error: 'Contrato no encontrado' });

  // Contrato sin propietario propio: mostrar el propietario activo del apartamento
  // (relación N:M, el de mayor porcentaje) como referencia.
  if (!contrato.propietario_id) {
    const activo = db.prepare(`
      SELECT ap.propietario_id, p.nombre, p.apellidos
      FROM apartamento_propietarios ap
      JOIN propietarios p ON p.id = ap.propietario_id
      WHERE ap.apartamento_id = ? AND ap.activo = 1
      ORDER BY ap.porcentaje DESC, ap.fecha_inicio ASC
      LIMIT 1
    `).get(contrato.apartamento_id);
    if (activo) {
      contrato.propietario_nombre = activo.nombre;
      contrato.propietario_apellidos = activo.apellidos;
    }
  }

  contrato.cuotas = db.prepare(
    'SELECT * FROM contrato_cuotas WHERE contrato_id = ? ORDER BY numero_cuota'
  ).all(contrato.id);

  res.json(contrato);
});

// POST /api/contratos — crear contrato + cuotas en una transacción.
router.post('/', (req, res) => {
  const v = validarContrato(req.body);
  if (v.error) return res.status(400).json({ error: v.error });

  const insertarTodo = db.transaction((d, cuotas, createdBy) => {
    const info = db.prepare(`
      INSERT INTO contratos
        (apartamento_id, propietario_id, tipo, temporada_inicio, temporada_fin, anio,
         precio_total, porcentaje_comision, aplica_iva, porcentaje_retencion, estado, notas, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      d.apartamento_id, d.propietario_id, d.tipo, d.temporada_inicio, d.temporada_fin,
      d.anio, d.precio_total, d.porcentaje_comision, d.aplica_iva, d.porcentaje_retencion,
      d.estado, d.notas, createdBy
    );
    const cid = info.lastInsertRowid;
    const insCuota = db.prepare(`
      INSERT INTO contrato_cuotas
        (contrato_id, numero_cuota, fecha_prevista, importe, pagado, fecha_pago, notas)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of cuotas) {
      insCuota.run(cid, c.numero_cuota, c.fecha_prevista, c.importe, c.pagado, c.fecha_pago, c.notas);
    }
    return cid;
  });

  const id = insertarTodo(v.datos, v.cuotas, req.usuario.username);
  registrarActividad(db, req.usuario.id, req.usuario.nombre, 'crear', 'contrato', id,
    `Contrato ${v.datos.tipo} (${v.cuotas.length} cuota(s))`);
  res.status(201).json({ id });
});

// PUT /api/contratos/:id — editar contrato y reemplazar sus cuotas (DELETE + INSERT).
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existe = db.prepare('SELECT id FROM contratos WHERE id = ?').get(id);
  if (!existe) return res.status(404).json({ error: 'Contrato no encontrado' });

  const v = validarContrato(req.body);
  if (v.error) return res.status(400).json({ error: v.error });

  const actualizarTodo = db.transaction((d, cuotas) => {
    db.prepare(`
      UPDATE contratos SET
        apartamento_id = ?, propietario_id = ?, tipo = ?, temporada_inicio = ?,
        temporada_fin = ?, anio = ?, precio_total = ?, porcentaje_comision = ?,
        aplica_iva = ?, porcentaje_retencion = ?, estado = ?, notas = ?
      WHERE id = ?
    `).run(
      d.apartamento_id, d.propietario_id, d.tipo, d.temporada_inicio, d.temporada_fin,
      d.anio, d.precio_total, d.porcentaje_comision, d.aplica_iva, d.porcentaje_retencion,
      d.estado, d.notas, id
    );
    db.prepare('DELETE FROM contrato_cuotas WHERE contrato_id = ?').run(id);
    const insCuota = db.prepare(`
      INSERT INTO contrato_cuotas
        (contrato_id, numero_cuota, fecha_prevista, importe, pagado, fecha_pago, notas)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of cuotas) {
      insCuota.run(id, c.numero_cuota, c.fecha_prevista, c.importe, c.pagado, c.fecha_pago, c.notas);
    }
  });

  actualizarTodo(v.datos, v.cuotas);
  registrarActividad(db, req.usuario.id, req.usuario.nombre, 'editar', 'contrato', id,
    `Contrato ${v.datos.tipo} (${v.cuotas.length} cuota(s))`);
  res.json({ ok: true });
});

// DELETE /api/contratos/:id — solo si no tiene cuotas pagadas.
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const contrato = db.prepare('SELECT id FROM contratos WHERE id = ?').get(id);
  if (!contrato) return res.status(404).json({ error: 'Contrato no encontrado' });

  const pagadas = db.prepare(
    'SELECT COUNT(*) AS c FROM contrato_cuotas WHERE contrato_id = ? AND pagado = 1'
  ).get(id).c;
  if (pagadas > 0) {
    return res.status(409).json({ error: 'No se puede eliminar un contrato con pagos registrados' });
  }

  db.prepare('DELETE FROM contratos WHERE id = ?').run(id); // cuotas en CASCADE
  registrarActividad(db, req.usuario.id, req.usuario.nombre, 'eliminar', 'contrato', id, null);
  res.json({ ok: true });
});

// PUT /api/contratos/:id/cuotas/:cuota_id — marcar/desmarcar una cuota como pagada.
router.put('/:id/cuotas/:cuota_id', (req, res) => {
  const contratoId = Number(req.params.id);
  const cuotaId = Number(req.params.cuota_id);
  const cuota = db.prepare(
    'SELECT * FROM contrato_cuotas WHERE id = ? AND contrato_id = ?'
  ).get(cuotaId, contratoId);
  if (!cuota) return res.status(404).json({ error: 'Cuota no encontrada' });

  const b = req.body || {};
  const pagado = b.pagado ? 1 : 0;
  // Si se marca pagada y no llega fecha, usar hoy; si se desmarca, limpiar la fecha.
  let fechaPago = null;
  if (pagado) {
    fechaPago = String(b.fecha_pago || '').trim() || new Date().toISOString().slice(0, 10);
  }

  db.prepare('UPDATE contrato_cuotas SET pagado = ?, fecha_pago = ? WHERE id = ?')
    .run(pagado, fechaPago, cuotaId);

  registrarActividad(db, req.usuario.id, req.usuario.nombre, 'pago', 'contrato', contratoId,
    `Cuota ${cuota.numero_cuota} ${pagado ? 'marcada como pagada' : 'marcada como pendiente'}`);
  res.json({ ok: true, pagado, fecha_pago: fechaPago });
});

module.exports = router;
