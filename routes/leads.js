// API REST del módulo Leads: captación de clientes de alquiler vacacional.
// Leads + propuestas (emails de oferta con fotos) + notas (chat) + plantillas de email.
// Conversión de lead a reserva real en la tabla `reservas`.
const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db/database');
const { enviarEmail } = require('../services/emailService');
const { registrarActividad } = require('../services/actividadService');

const router = express.Router();
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const ESTADOS = ['nuevo', 'contactado', 'propuesta_enviada', 'esperando_respuesta', 'reservado', 'descartado'];

function txt(v) { return v === undefined || v === null ? null : String(v); }
function aEntero(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}
function aNumero(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function usuarioActual(req) {
  return {
    id: req.usuario && req.usuario.id != null ? req.usuario.id : null,
    nombre: req.usuario && req.usuario.nombre != null ? req.usuario.nombre : null,
    username: req.usuario && req.usuario.username != null ? req.usuario.username : null,
  };
}

// =========================================================================
// Rutas estáticas (se declaran ANTES de /:id para que no las capture).
// =========================================================================

// GET /api/leads/plantillas — todas las plantillas activas.
router.get('/plantillas', (req, res) => {
  const filas = db.prepare('SELECT * FROM lead_plantillas WHERE activa = 1 ORDER BY nombre ASC').all();
  res.json(filas);
});

// POST /api/leads/plantillas — crear plantilla.
router.post('/plantillas', (req, res) => {
  const b = req.body || {};
  const nombre = txt(b.nombre);
  const asunto = txt(b.asunto);
  const cuerpo = txt(b.cuerpo);
  if (!nombre || !asunto || !cuerpo) return res.status(400).json({ error: 'nombre, asunto y cuerpo son obligatorios' });
  const existe = db.prepare('SELECT id FROM lead_plantillas WHERE nombre = ?').get(nombre);
  if (existe) return res.status(409).json({ error: 'Ya existe una plantilla con ese nombre' });
  const activa = b.activa === 0 || b.activa === false ? 0 : 1;
  const info = db.prepare('INSERT INTO lead_plantillas (nombre, asunto, cuerpo, activa) VALUES (?, ?, ?, ?)')
    .run(nombre, asunto, cuerpo, activa);
  res.status(201).json({ id: info.lastInsertRowid });
});

// PUT /api/leads/plantillas/:id — editar plantilla.
router.put('/plantillas/:id', (req, res) => {
  const pl = db.prepare('SELECT * FROM lead_plantillas WHERE id = ?').get(req.params.id);
  if (!pl) return res.status(404).json({ error: 'Plantilla no encontrada' });
  const b = req.body || {};
  if ('nombre' in b && txt(b.nombre) && txt(b.nombre) !== pl.nombre) {
    const dup = db.prepare('SELECT id FROM lead_plantillas WHERE nombre = ? AND id <> ?').get(txt(b.nombre), pl.id);
    if (dup) return res.status(409).json({ error: 'Ya existe una plantilla con ese nombre' });
  }
  const nombre = 'nombre' in b ? txt(b.nombre) : pl.nombre;
  const asunto = 'asunto' in b ? txt(b.asunto) : pl.asunto;
  const cuerpo = 'cuerpo' in b ? txt(b.cuerpo) : pl.cuerpo;
  const activa = 'activa' in b ? (b.activa === 0 || b.activa === false ? 0 : 1) : pl.activa;
  db.prepare('UPDATE lead_plantillas SET nombre = ?, asunto = ?, cuerpo = ?, activa = ? WHERE id = ?')
    .run(nombre, asunto, cuerpo, activa, pl.id);
  res.json({ ok: true });
});

// DELETE /api/leads/plantillas/:id — solo si no tiene propuestas asociadas.
router.delete('/plantillas/:id', (req, res) => {
  const pl = db.prepare('SELECT id FROM lead_plantillas WHERE id = ?').get(req.params.id);
  if (!pl) return res.status(404).json({ error: 'Plantilla no encontrada' });
  const usada = db.prepare('SELECT COUNT(*) AS c FROM lead_propuestas WHERE plantilla_id = ?').get(pl.id).c;
  if (usada > 0) return res.status(409).json({ error: 'No se puede borrar: la plantilla tiene propuestas asociadas' });
  db.prepare('DELETE FROM lead_plantillas WHERE id = ?').run(pl.id);
  res.json({ ok: true });
});

// GET /api/leads/resumen — contadores por estado + tasa de conversión.
router.get('/resumen', (req, res) => {
  const r = db.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(estado = 'nuevo'), 0) AS nuevos,
      COALESCE(SUM(estado = 'contactado'), 0) AS contactados,
      COALESCE(SUM(estado = 'propuesta_enviada'), 0) AS propuestas_enviadas,
      COALESCE(SUM(estado = 'esperando_respuesta'), 0) AS esperando,
      COALESCE(SUM(estado = 'reservado'), 0) AS reservados,
      COALESCE(SUM(estado = 'descartado'), 0) AS descartados
    FROM leads
  `).get();
  r.conversion_rate = r.total > 0 ? Math.round((r.reservados / r.total) * 1000) / 10 : 0;
  res.json(r);
});

// =========================================================================
// Leads
// =========================================================================

// GET /api/leads?estado=&atendido_por=&desde=&hasta= — lista con filtros.
router.get('/', (req, res) => {
  const { estado, atendido_por, desde, hasta } = req.query;
  let sql = `
    SELECT l.*, a.nombre AS apartamento_nombre_actual
    FROM leads l
    LEFT JOIN apartamentos a ON a.id = l.apartamento_id
    WHERE 1 = 1`;
  const params = [];
  if (estado) { sql += ' AND l.estado = ?'; params.push(estado); }
  if (atendido_por) { sql += ' AND l.atendido_por = ?'; params.push(atendido_por); }
  if (desde) { sql += ' AND date(l.created_at) >= ?'; params.push(desde); }
  if (hasta) { sql += ' AND date(l.created_at) <= ?'; params.push(hasta); }
  sql += ' ORDER BY l.updated_at DESC';
  res.json(db.prepare(sql).all(...params));
});

// GET /api/leads/:id — ficha con propuestas + notas.
router.get('/:id', (req, res) => {
  const lead = db.prepare(`
    SELECT l.*, a.nombre AS apartamento_nombre_actual
    FROM leads l LEFT JOIN apartamentos a ON a.id = l.apartamento_id
    WHERE l.id = ?
  `).get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  const propuestas = db.prepare('SELECT * FROM lead_propuestas WHERE lead_id = ? ORDER BY created_at DESC').all(lead.id);
  // El hilo de notas va en `notas_chat` para NO eclipsar la columna texto `notas` del lead.
  const notas_chat = db.prepare('SELECT * FROM lead_notas WHERE lead_id = ? ORDER BY fecha ASC').all(lead.id);
  res.json({ ...lead, propuestas, notas_chat });
});

// POST /api/leads — crear lead.
router.post('/', (req, res) => {
  const b = req.body || {};
  const nombre = txt(b.nombre);
  if (!nombre) return res.status(400).json({ error: 'nombre es obligatorio' });

  const apartamentoId = aEntero(b.apartamento_id);
  let apartamentoNombre = txt(b.apartamento_nombre);
  if (apartamentoId !== null) {
    const apto = db.prepare('SELECT id, nombre FROM apartamentos WHERE id = ?').get(apartamentoId);
    if (!apto) return res.status(400).json({ error: 'El apartamento indicado no existe' });
    apartamentoNombre = apto.nombre; // copia del nombre del apartamento
  }

  const estado = ESTADOS.includes(b.estado) ? b.estado : 'nuevo';
  const u = usuarioActual(req);
  const info = db.prepare(`
    INSERT INTO leads
      (nombre, telefono, email, apartamento_id, apartamento_nombre, fecha_entrada, fecha_salida,
       personas, presupuesto, estado, notas, atendido_por, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    nombre, txt(b.telefono), txt(b.email), apartamentoId, apartamentoNombre,
    txt(b.fecha_entrada), txt(b.fecha_salida), aEntero(b.personas), aNumero(b.presupuesto),
    estado, txt(b.notas), u.username, u.username
  );

  registrarActividad(db, u.id, u.nombre, 'crear', 'lead', info.lastInsertRowid, `Lead: ${nombre}`);
  res.status(201).json({ id: info.lastInsertRowid });
});

// PUT /api/leads/:id — editar lead (actualiza updated_at).
router.put('/:id', (req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  const b = req.body || {};

  const sets = [];
  const vals = [];
  const add = (col, val) => { sets.push(`${col} = ?`); vals.push(val); };

  if ('nombre' in b) {
    if (!txt(b.nombre)) return res.status(400).json({ error: 'nombre no puede quedar vacío' });
    add('nombre', txt(b.nombre));
  }
  if ('telefono' in b) add('telefono', txt(b.telefono));
  if ('email' in b) add('email', txt(b.email));
  if ('apartamento_id' in b) {
    const aid = aEntero(b.apartamento_id);
    if (aid !== null) {
      const apto = db.prepare('SELECT id, nombre FROM apartamentos WHERE id = ?').get(aid);
      if (!apto) return res.status(400).json({ error: 'El apartamento indicado no existe' });
      add('apartamento_id', aid);
      add('apartamento_nombre', apto.nombre);
    } else {
      add('apartamento_id', null);
    }
  }
  if ('fecha_entrada' in b) add('fecha_entrada', txt(b.fecha_entrada));
  if ('fecha_salida' in b) add('fecha_salida', txt(b.fecha_salida));
  if ('personas' in b) add('personas', aEntero(b.personas));
  if ('presupuesto' in b) add('presupuesto', aNumero(b.presupuesto));
  if ('estado' in b) {
    if (!ESTADOS.includes(b.estado)) return res.status(400).json({ error: 'estado no válido' });
    add('estado', b.estado);
  }
  if ('notas' in b) add('notas', txt(b.notas));
  if ('atendido_por' in b) add('atendido_por', txt(b.atendido_por));

  if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
  add('updated_at', new Date().toISOString().replace('T', ' ').slice(0, 19));
  vals.push(lead.id);
  db.prepare(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  res.json({ ok: true });
});

// DELETE /api/leads/:id — solo si no está reservado.
router.delete('/:id', (req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  if (lead.estado === 'reservado') {
    return res.status(409).json({ error: 'No se puede borrar un lead ya reservado' });
  }
  db.prepare('DELETE FROM leads WHERE id = ?').run(lead.id);
  const u = usuarioActual(req);
  registrarActividad(db, u.id, u.nombre, 'eliminar', 'lead', lead.id, `Lead: ${lead.nombre}`);
  res.json({ ok: true });
});

// POST /api/leads/:id/convertir — crea una reserva real a partir del lead.
router.post('/:id/convertir', (req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  if (lead.estado === 'reservado' && lead.reserva_id) {
    return res.status(409).json({ error: 'El lead ya está convertido en reserva' });
  }

  const b = req.body || {};
  const apartamentoId = aEntero(b.apartamento_id) != null ? aEntero(b.apartamento_id) : lead.apartamento_id;
  const entrada = txt(b.fecha_entrada) || lead.fecha_entrada;
  const salida = txt(b.fecha_salida) || lead.fecha_salida;
  const personas = aEntero(b.personas) != null ? aEntero(b.personas) : lead.personas;
  const precioTotal = aNumero(b.precio_total) != null ? aNumero(b.precio_total) : (lead.presupuesto || 0);

  if (!entrada || !salida) return res.status(400).json({ error: 'fecha_entrada y fecha_salida son obligatorias' });

  let tih = null;
  if (apartamentoId != null) {
    const apto = db.prepare('SELECT id, tipo FROM apartamentos WHERE id = ?').get(apartamentoId);
    if (!apto) return res.status(400).json({ error: 'El apartamento indicado no existe' });
    tih = apto.tipo || null;
  }

  const u = usuarioActual(req);
  const numeroReserva = `LEAD-${lead.id}-${Date.now()}`;

  const result = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO reservas
        (numero_reserva, nombre_cliente, tih, personas, entrada, salida, apartamento_id,
         tipo_reserva, portal, atendido_por, precio_total, pagado, pendiente)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'Confirmada', 'Web propia', ?, ?, 0, ?)
    `).run(
      numeroReserva, lead.nombre, tih, personas, entrada, salida, apartamentoId,
      u.username, precioTotal, precioTotal
    );
    const reservaId = info.lastInsertRowid;
    // Plan de pagos 20%/80% si la reserva tiene precio (misma transacción).
    const precioNum = Math.round((Number(precioTotal) || 0) * 100) / 100;
    if (precioNum > 0) {
      const r2 = (n) => Math.round(n * 100) / 100;
      const insPago = db.prepare(`
        INSERT INTO reserva_pagos (reserva_id, concepto, importe, pagado, fecha_pago, orden)
        VALUES (?, ?, ?, 0, NULL, ?)
      `);
      insPago.run(reservaId, 'Confirmación (20%)', r2(precioNum * 0.2), 1);
      insPago.run(reservaId, 'Resto a la llegada (80%)', r2(precioNum * 0.8), 2);
    }
    db.prepare(`
      UPDATE leads SET estado = 'reservado', reserva_id = ?,
        updated_at = datetime('now') WHERE id = ?
    `).run(reservaId, lead.id);
    return { reservaId, numeroReserva };
  })();

  registrarActividad(db, u.id, u.nombre, 'convertir', 'lead', lead.id,
    `Lead "${lead.nombre}" convertido en reserva ${result.numeroReserva}`);
  res.json({ ok: true, reserva_id: result.reservaId, numero_reserva: result.numeroReserva });
});

// =========================================================================
// Notas del lead
// =========================================================================

// POST /api/leads/:id/notas — añadir nota.
router.post('/:id/notas', (req, res) => {
  const lead = db.prepare('SELECT id FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  const texto = txt((req.body || {}).texto);
  if (!texto) return res.status(400).json({ error: 'texto es obligatorio' });
  const u = usuarioActual(req);
  const info = db.prepare('INSERT INTO lead_notas (lead_id, texto, usuario_nombre) VALUES (?, ?, ?)')
    .run(lead.id, texto, u.nombre);
  res.status(201).json({ id: info.lastInsertRowid });
});

// DELETE /api/leads/:id/notas/:nota_id — borrar nota.
router.delete('/:id/notas/:nota_id', (req, res) => {
  const nota = db.prepare('SELECT * FROM lead_notas WHERE id = ? AND lead_id = ?').get(req.params.nota_id, req.params.id);
  if (!nota) return res.status(404).json({ error: 'Nota no encontrada' });
  db.prepare('DELETE FROM lead_notas WHERE id = ?').run(nota.id);
  res.json({ ok: true });
});

// =========================================================================
// Propuestas del lead
// =========================================================================

// GET /api/leads/:id/propuestas — lista de propuestas del lead.
router.get('/:id/propuestas', (req, res) => {
  const lead = db.prepare('SELECT id FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  const filas = db.prepare('SELECT * FROM lead_propuestas WHERE lead_id = ? ORDER BY created_at DESC').all(lead.id);
  res.json(filas);
});

// POST /api/leads/:id/propuestas — crear propuesta (preparada, sin enviar).
router.post('/:id/propuestas', (req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
  const b = req.body || {};
  const asunto = txt(b.asunto);
  const mensaje = txt(b.mensaje);
  if (!asunto || !mensaje) return res.status(400).json({ error: 'asunto y mensaje son obligatorios' });

  const apartamentoId = aEntero(b.apartamento_id);
  const plantillaId = aEntero(b.plantilla_id);
  const fotoIds = Array.isArray(b.foto_ids) ? b.foto_ids.map(Number).filter((n) => !isNaN(n)) : [];
  const emailDestino = txt(b.email_destino) || lead.email;
  const u = usuarioActual(req);

  const info = db.prepare(`
    INSERT INTO lead_propuestas
      (lead_id, asunto, mensaje, apartamento_id, precio_propuesto, fotos_enviadas,
       email_destino, plantilla_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    lead.id, asunto, mensaje, apartamentoId, aNumero(b.precio_propuesto),
    fotoIds.length ? JSON.stringify(fotoIds) : null, emailDestino, plantillaId, u.username
  );
  res.status(201).json({ id: info.lastInsertRowid });
});

// POST /api/leads/:id/propuestas/:prop_id/enviar — envía la propuesta por email.
router.post('/:id/propuestas/:prop_id/enviar', async (req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ ok: false, error: 'Lead no encontrado' });
  const prop = db.prepare('SELECT * FROM lead_propuestas WHERE id = ? AND lead_id = ?')
    .get(req.params.prop_id, lead.id);
  if (!prop) return res.status(404).json({ ok: false, error: 'Propuesta no encontrada' });

  const to = (txt((req.body || {}).email_destino) || prop.email_destino || lead.email || '').trim();
  if (!to) return res.status(400).json({ ok: false, error: 'No hay email de destino para enviar la propuesta' });

  // Adjuntar las fotos indicadas (verificando que pertenecen al apartamento de la propuesta).
  const attachments = [];
  let fotoIds = [];
  try { fotoIds = prop.fotos_enviadas ? JSON.parse(prop.fotos_enviadas) : []; } catch (e) { fotoIds = []; }
  fotoIds = (Array.isArray(fotoIds) ? fotoIds : []).map(Number).filter((n) => !isNaN(n));
  if (fotoIds.length && prop.apartamento_id != null) {
    const placeholders = fotoIds.map(() => '?').join(',');
    const fotos = db.prepare(
      `SELECT * FROM apartamento_fotos WHERE id IN (${placeholders}) AND apartamento_id = ?`
    ).all(...fotoIds, prop.apartamento_id);
    for (const f of fotos) {
      const abs = path.join(PUBLIC_DIR, f.url);
      if (fs.existsSync(abs)) attachments.push({ filename: f.nombre_archivo, path: abs });
    }
  }

  // Logo de la razón social principal (embebido inline si es archivo local).
  const razon = db.prepare('SELECT razon_social, logo_url FROM razones_sociales ORDER BY predeterminada DESC, id LIMIT 1').get();
  let logoHtml = '';
  if (razon && razon.logo_url) {
    const logoAbs = path.join(PUBLIC_DIR, razon.logo_url);
    if (fs.existsSync(logoAbs)) {
      attachments.push({ filename: path.basename(logoAbs), path: logoAbs, cid: 'logo-razon' });
      logoHtml = '<img src="cid:logo-razon" alt="" style="max-height:70px;margin-bottom:16px">';
    }
  }
  const cabecera = razon && razon.razon_social
    ? `<div style="font-weight:600;margin-bottom:12px">${esc(razon.razon_social)}</div>` : '';

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a2e;font-size:14px;line-height:1.5">
      ${logoHtml}
      ${cabecera}
      <div>${esc(prop.mensaje).replace(/\n/g, '<br>')}</div>
    </div>`;

  try {
    await enviarEmail(db, { to, subject: prop.asunto, html, attachments });
  } catch (e) {
    return res.json({ ok: false, error: e.message || 'No se pudo enviar el email' });
  }

  const u = usuarioActual(req);
  db.transaction(() => {
    db.prepare("UPDATE lead_propuestas SET enviada = 1, fecha_envio = datetime('now'), email_destino = ? WHERE id = ?")
      .run(to, prop.id);
    db.prepare("UPDATE leads SET estado = 'propuesta_enviada', updated_at = datetime('now') WHERE id = ?")
      .run(lead.id);
  })();

  registrarActividad(db, u.id, u.nombre, 'enviar', 'lead-propuesta', prop.id,
    `Propuesta a ${to} (lead "${lead.nombre}")`);
  res.json({ ok: true });
});

module.exports = router;
