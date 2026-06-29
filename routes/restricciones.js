// API REST de restricciones de fechas. Bloquean visualmente días en el planning y avisan
// al crear reservas, pero NO impiden crearlas. Solo los administradores pueden gestionarlas.
const express = require('express');
const db = require('../db/database');

const router = express.Router();

// Corta el handler con 403 si el usuario no es administrador. Devuelve true si cortó.
function bloquearNoAdmin(req, res) {
  if (!req.usuario || req.usuario.rol !== 'administrador') {
    res.status(403).json({ error: 'Solo los administradores pueden gestionar las restricciones' });
    return true;
  }
  return false;
}

// Valida y normaliza el body. Devuelve { fecha_inicio, fecha_fin, motivo } o { error }.
function leerBody(req) {
  const b = req.body || {};
  const fecha_inicio = String(b.fecha_inicio || '').trim();
  const fecha_fin = String(b.fecha_fin || '').trim();
  const motivo = b.motivo != null ? String(b.motivo).trim() : '';
  if (!fecha_inicio || !fecha_fin) return { error: 'Las fechas de inicio y fin son obligatorias' };
  if (fecha_fin < fecha_inicio) return { error: 'La fecha de fin debe ser igual o posterior a la de inicio' };
  return { fecha_inicio, fecha_fin, motivo };
}

// GET /api/restricciones — lista todas, ordenadas por fecha de inicio.
router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM restricciones ORDER BY fecha_inicio, fecha_fin').all());
});

// POST /api/restricciones — crea una restricción (solo admin).
router.post('/', (req, res) => {
  if (bloquearNoAdmin(req, res)) return;
  const datos = leerBody(req);
  if (datos.error) return res.status(400).json({ error: datos.error });
  const info = db.prepare(
    'INSERT INTO restricciones (fecha_inicio, fecha_fin, motivo, created_by) VALUES (?, ?, ?, ?)'
  ).run(datos.fecha_inicio, datos.fecha_fin, datos.motivo || null, req.usuario.nombre || req.usuario.username || null);
  res.status(201).json({ id: info.lastInsertRowid });
});

// PUT /api/restricciones/:id — edita una restricción (solo admin).
router.put('/:id', (req, res) => {
  if (bloquearNoAdmin(req, res)) return;
  const actual = db.prepare('SELECT id FROM restricciones WHERE id = ?').get(req.params.id);
  if (!actual) return res.status(404).json({ error: 'Restricción no encontrada' });
  const datos = leerBody(req);
  if (datos.error) return res.status(400).json({ error: datos.error });
  db.prepare('UPDATE restricciones SET fecha_inicio = ?, fecha_fin = ?, motivo = ? WHERE id = ?')
    .run(datos.fecha_inicio, datos.fecha_fin, datos.motivo || null, req.params.id);
  res.json({ ok: true });
});

// DELETE /api/restricciones/:id — elimina una restricción (solo admin).
router.delete('/:id', (req, res) => {
  if (bloquearNoAdmin(req, res)) return;
  const actual = db.prepare('SELECT id FROM restricciones WHERE id = ?').get(req.params.id);
  if (!actual) return res.status(404).json({ error: 'Restricción no encontrada' });
  db.prepare('DELETE FROM restricciones WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
