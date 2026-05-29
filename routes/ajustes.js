// API REST de ajustes: razones sociales (datos de facturación) y registro de actividad.
const express = require('express');
const db = require('../db/database');
const { registrarActividad } = require('../services/actividadService');

const router = express.Router();

// Columnas editables de razones_sociales (todas menos id y created_at).
const RS_CAMPOS = [
  'razon_social', 'nombre_comercial', 'cif_nif', 'direccion', 'persona_contacto',
  'numero', 'email_contacto', 'puerta', 'telefono', 'codigo_postal', 'fax', 'ciudad',
  'iva', 'estado_provincia', 'codigo_cnae', 'pais', 'iva_intracomunitario',
  'tipo_direccion', 'tipo_documento_in', 'numero_documento_in',
  'nombre_banco', 'iban', 'direccion_banco', 'codigo_swift', 'numero_cuenta_ccc',
];

function recoger(body) {
  const d = {};
  for (const c of RS_CAMPOS) {
    const v = body[c];
    d[c] = v === undefined || v === null || v === '' ? null : v;
  }
  return d;
}

// ===== Razones sociales =====
router.get('/razones-sociales', (req, res) => {
  res.json(db.prepare('SELECT * FROM razones_sociales ORDER BY id').all());
});

router.post('/razones-sociales', (req, res) => {
  const d = recoger(req.body || {});
  const cols = RS_CAMPOS.join(', ');
  const ph = RS_CAMPOS.map((c) => '@' + c).join(', ');
  const info = db.prepare(`INSERT INTO razones_sociales (${cols}) VALUES (${ph})`).run(d);
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'crear', 'razon_social', info.lastInsertRowid, d.razon_social);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.put('/razones-sociales/:id', (req, res) => {
  const d = recoger(req.body || {});
  const set = RS_CAMPOS.map((c) => `${c}=@${c}`).join(', ');
  const info = db.prepare(`UPDATE razones_sociales SET ${set} WHERE id=@id`).run({ ...d, id: req.params.id });
  if (info.changes === 0) return res.status(404).json({ error: 'Razón social no encontrada' });
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'editar', 'razon_social', req.params.id, d.razon_social);
  res.json({ ok: true });
});

router.delete('/razones-sociales/:id', (req, res) => {
  const rs = db.prepare('SELECT razon_social FROM razones_sociales WHERE id = ?').get(req.params.id);
  const info = db.prepare('DELETE FROM razones_sociales WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Razón social no encontrada' });
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'eliminar', 'razon_social', req.params.id, rs && rs.razon_social);
  res.json({ ok: true });
});

// ===== Registro de actividad (solo administradores) =====
router.get('/actividad', (req, res) => {
  if (!req.usuario || req.usuario.rol !== 'administrador') {
    return res.status(403).json({ error: 'Solo los administradores pueden ver el registro de actividad' });
  }
  const { usuario_id, accion } = req.query;
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
  let sql = 'SELECT * FROM actividad_log WHERE 1=1';
  const p = [];
  if (usuario_id) { sql += ' AND usuario_id = ?'; p.push(usuario_id); }
  if (accion) { sql += ' AND accion = ?'; p.push(accion); }
  sql += ' ORDER BY id DESC LIMIT ?';
  p.push(limit);
  res.json(db.prepare(sql).all(...p));
});

module.exports = router;
