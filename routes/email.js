// API REST de envío de email (SMTP vía services/emailService).
const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db/database');
const { enviarEmail } = require('../services/emailService');
const { registrarActividad } = require('../services/actividadService');

const router = express.Router();
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Escape básico para insertar texto del usuario en el HTML del email.
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// POST /api/email/enviar-fotos — envía por email las fotos seleccionadas de un apartamento.
router.post('/enviar-fotos', async (req, res) => {
  const b = req.body || {};
  const to = String(b.to || '').trim();
  const subject = String(b.subject || '').trim();
  const mensaje = String(b.mensaje || '');
  const apartamentoId = b.apartamento_id;
  const fotoIds = Array.isArray(b.foto_ids) ? b.foto_ids.map(Number).filter((n) => !isNaN(n)) : [];

  if (!to) return res.status(400).json({ ok: false, error: 'Falta el destinatario (to)' });
  if (!subject) return res.status(400).json({ ok: false, error: 'Falta el asunto (subject)' });
  if (apartamentoId == null) return res.status(400).json({ ok: false, error: 'Falta apartamento_id' });
  if (!fotoIds.length) return res.status(400).json({ ok: false, error: 'No se han indicado fotos (foto_ids)' });

  const apto = db.prepare('SELECT id, nombre FROM apartamentos WHERE id = ?').get(apartamentoId);
  if (!apto) return res.status(404).json({ ok: false, error: 'Alojamiento no encontrado' });

  // Cargar las fotos por ID y verificar que pertenecen al apartamento.
  const placeholders = fotoIds.map(() => '?').join(',');
  const fotos = db.prepare(
    `SELECT * FROM apartamento_fotos WHERE id IN (${placeholders}) AND apartamento_id = ?`
  ).all(...fotoIds, apto.id);
  if (fotos.length !== fotoIds.length) {
    return res.status(400).json({ ok: false, error: 'Algunas fotos no existen o no pertenecen a este apartamento' });
  }

  // Adjuntos: ruta absoluta en disco de cada foto.
  const attachments = [];
  for (const f of fotos) {
    const abs = path.join(PUBLIC_DIR, f.url);
    if (!fs.existsSync(abs)) {
      return res.status(400).json({ ok: false, error: `El archivo de una foto no existe en disco (${f.nombre_archivo})` });
    }
    attachments.push({ filename: f.nombre_archivo, path: abs });
  }

  // Logo de la razón social principal (la primera), embebido inline si es archivo local.
  const razon = db.prepare('SELECT razon_social, logo_url FROM razones_sociales ORDER BY id LIMIT 1').get();
  let logoHtml = '';
  if (razon && razon.logo_url) {
    const logoAbs = path.join(PUBLIC_DIR, razon.logo_url);
    if (fs.existsSync(logoAbs)) {
      attachments.push({ filename: path.basename(logoAbs), path: logoAbs, cid: 'logo-razon' });
      logoHtml = '<img src="cid:logo-razon" alt="" style="max-height:70px;margin-bottom:16px">';
    }
  }
  const cabeceraTexto = razon && razon.razon_social ? `<div style="font-weight:600;margin-bottom:12px">${esc(razon.razon_social)}</div>` : '';

  const n = fotos.length;
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a2e;font-size:14px;line-height:1.5">
      ${logoHtml}
      ${cabeceraTexto}
      <div>${esc(mensaje).replace(/\n/g, '<br>')}</div>
      <p style="margin-top:16px;color:#6b7280">Se adjuntan ${n} foto${n === 1 ? '' : 's'} del apartamento ${esc(apto.nombre)}.</p>
    </div>`;

  try {
    await enviarEmail(db, { to, subject, html, attachments });
  } catch (e) {
    return res.json({ ok: false, error: e.message || 'No se pudo enviar el email' });
  }

  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre,
    'enviar', 'email-fotos', apto.id, `${n} foto(s) de ${apto.nombre} a ${to}`);
  res.json({ ok: true });
});

module.exports = router;
