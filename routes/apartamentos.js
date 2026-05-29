// API REST de apartamentos (alojamientos).
const express = require('express');
const db = require('../db/database');
const { normalizaTih } = require('../services/asignacion');
const { registrarActividad } = require('../services/actividadService');

const router = express.Router();

// Lista de apartamentos, con filtro opcional por TIH (?tih=1 | 2) y nombre del propietario.
router.get('/', (req, res) => {
  const tih = normalizaTih(req.query.tih);
  let sql = `
    SELECT a.*, p.nombre AS propietario_nombre, p.apellidos AS propietario_apellidos
    FROM apartamentos a
    LEFT JOIN propietarios p ON p.id = a.propietario_id
  `;
  const params = [];
  if (tih) {
    sql += ' WHERE a.tipo = ?';
    params.push(tih);
  }
  sql += ' ORDER BY a.edificio, a.nombre';
  res.json(db.prepare(sql).all(...params));
});

// Ficha completa: datos + propietario + historial de reservas del apartamento.
router.get('/:id', (req, res) => {
  const apartamento = db
    .prepare(
      `SELECT a.*, p.nombre AS propietario_nombre, p.apellidos AS propietario_apellidos,
              p.telefono AS propietario_telefono, p.email AS propietario_email
       FROM apartamentos a
       LEFT JOIN propietarios p ON p.id = a.propietario_id
       WHERE a.id = ?`
    )
    .get(req.params.id);
  if (!apartamento) return res.status(404).json({ error: 'Alojamiento no encontrado' });

  const reservas = db
    .prepare('SELECT * FROM reservas WHERE apartamento_id = ? ORDER BY entrada DESC')
    .all(req.params.id);

  res.json({ ...apartamento, reservas });
});

// Crea un apartamento.
router.post('/', (req, res) => {
  const { nombre, edificio, tipo, capacidad, notas, propietario_id } = req.body;
  if (!nombre || !String(nombre).trim()) {
    return res.status(400).json({ error: 'El nombre es obligatorio' });
  }
  const info = db
    .prepare(
      `INSERT INTO apartamentos (nombre, edificio, tipo, capacidad, notas, propietario_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(nombre, edificio, normalizaTih(tipo), aEntero(capacidad), notas, propietario_id || null);
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'crear', 'alojamiento', info.lastInsertRowid, nombre);
  res.status(201).json({ id: info.lastInsertRowid });
});

// Actualiza un apartamento.
router.put('/:id', (req, res) => {
  const { nombre, edificio, tipo, capacidad, notas, propietario_id } = req.body;
  const info = db
    .prepare(
      `UPDATE apartamentos SET nombre=?, edificio=?, tipo=?, capacidad=?, notas=?, propietario_id=?
       WHERE id=?`
    )
    .run(nombre, edificio, normalizaTih(tipo), aEntero(capacidad), notas, propietario_id || null, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Alojamiento no encontrado' });
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'editar', 'alojamiento', req.params.id, nombre);
  res.json({ ok: true });
});

// Elimina un apartamento (sus reservas quedan "Sin asignar").
router.delete('/:id', (req, res) => {
  const apto = db.prepare('SELECT nombre FROM apartamentos WHERE id = ?').get(req.params.id);
  const info = db.prepare('DELETE FROM apartamentos WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Alojamiento no encontrado' });
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'eliminar', 'alojamiento', req.params.id, apto && apto.nombre);
  res.json({ ok: true });
});

function aEntero(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

module.exports = router;
