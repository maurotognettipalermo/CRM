// API REST de apartamentos (alojamientos).
const express = require('express');
const db = require('../db/database');
const { normalizaTih } = require('../services/asignacion');
const { registrarActividad } = require('../services/actividadService');

const router = express.Router();

// Lista de apartamentos, con filtro opcional por TIH (?tih=1 | 2) y nombre del propietario.
// Por defecto excluye los marcados como "quitar del planning"; con ?todos=1 los incluye
// (lo usa el módulo de Alojamientos, que sí los necesita todos).
router.get('/', (req, res) => {
  const tih = normalizaTih(req.query.tih);
  const todos = req.query.todos === '1' || req.query.todos === 'true';
  let sql = `
    SELECT a.*, p.nombre AS propietario_nombre, p.apellidos AS propietario_apellidos
    FROM apartamentos a
    LEFT JOIN propietarios p ON p.id = a.propietario_id
  `;
  const cond = [];
  const params = [];
  if (tih) { cond.push('a.tipo = ?'); params.push(tih); }
  if (!todos) cond.push('(a.quitar_planning IS NULL OR a.quitar_planning = 0)');
  if (cond.length) sql += ' WHERE ' + cond.join(' AND ');
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

// Campos de texto de la ficha ampliada que se guardan tal cual (snapshot del body).
const CAMPOS_TEXTO_APTO = [
  'tipo_clasificacion', 'orientacion', 'situacion', 'parking', 'pwd_wifi',
  'licencia_turistica', 'nra', 'ref_catastral', 'bloque', 'escalera', 'piso', 'puerta',
];

// Actualiza un apartamento. Solo toca los campos presentes en el body (merge), para no
// pisar los de la ficha ampliada cuando el formulario envía un subconjunto.
router.put('/:id', (req, res) => {
  const b = req.body || {};
  const sets = [];
  const vals = [];
  const add = (col, val) => { sets.push(`${col} = ?`); vals.push(val); };

  if ('nombre' in b) add('nombre', b.nombre);
  if ('edificio' in b) add('edificio', txt(b.edificio));
  if ('tipo' in b) add('tipo', normalizaTih(b.tipo));
  if ('capacidad' in b) add('capacidad', aEntero(b.capacidad));
  if ('notas' in b) add('notas', txt(b.notas));
  if ('propietario_id' in b) add('propietario_id', b.propietario_id || null);
  for (const c of CAMPOS_TEXTO_APTO) if (c in b) add(c, txt(b[c]));
  if ('en_garantia' in b) add('en_garantia', b.en_garantia ? 1 : 0);
  if ('quitar_planning' in b) add('quitar_planning', b.quitar_planning ? 1 : 0);

  if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });

  vals.push(req.params.id);
  const info = db.prepare(`UPDATE apartamentos SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  if (info.changes === 0) return res.status(404).json({ error: 'Alojamiento no encontrado' });

  const nombre = 'nombre' in b ? b.nombre : (db.prepare('SELECT nombre FROM apartamentos WHERE id = ?').get(req.params.id) || {}).nombre;
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

// Texto seguro para bind (better-sqlite3 lanza con undefined).
function txt(v) {
  return v === undefined || v === null ? null : String(v);
}

module.exports = router;
