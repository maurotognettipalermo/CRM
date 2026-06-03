// API REST de gastos: catálogo reutilizable (gestionado en Ajustes) y gastos imputados a
// cada apartamento. Se exportan DOS routers que server.js monta por separado:
//   catalogo            -> /api/catalogo-gastos
//   apartamentoGastos   -> /api/apartamentos/:id/gastos   (mergeParams para leer :id)
// Ambos van bajo requireAuth, así que req.usuario = { id, nombre, username, rol }.
const express = require('express');
const db = require('../db/database');
const { registrarActividad } = require('../services/actividadService');

// --- Helpers de coerción (better-sqlite3 lanza al hacer bind de undefined) ---
function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function txt(v) { return v === undefined || v === null ? null : String(v); }
function anioParam(req) {
  const n = parseInt(req.query.anio, 10);
  return String(n >= 1900 && n <= 9999 ? n : new Date().getFullYear());
}

// ==================== Catálogo de gastos (/api/catalogo-gastos) ====================
const catalogo = express.Router();

// Lista completa: activos primero, luego orden alfabético (case-insensitive).
catalogo.get('/', (req, res) => {
  res.json(db.prepare(
    'SELECT * FROM catalogo_gastos ORDER BY activo DESC, nombre COLLATE NOCASE'
  ).all());
});

// Crear gasto de catálogo (nombre único).
catalogo.post('/', (req, res) => {
  const b = req.body || {};
  const nombre = String(b.nombre || '').trim();
  if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
  if (db.prepare('SELECT id FROM catalogo_gastos WHERE nombre = ?').get(nombre)) {
    return res.status(409).json({ error: 'Ya existe un gasto con ese nombre' });
  }
  const activo = (b.activo === undefined || b.activo === null) ? 1 : (b.activo ? 1 : 0);
  const info = db.prepare(
    'INSERT INTO catalogo_gastos (nombre, precio, descripcion, activo) VALUES (?, ?, ?, ?)'
  ).run(nombre, num(b.precio), txt(b.descripcion), activo);
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'crear', 'catalogo_gasto', info.lastInsertRowid, nombre);
  res.status(201).json({ id: info.lastInsertRowid });
});

// Editar nombre / precio / descripcion / activo (solo campos presentes).
catalogo.put('/:id', (req, res) => {
  const actual = db.prepare('SELECT * FROM catalogo_gastos WHERE id = ?').get(req.params.id);
  if (!actual) return res.status(404).json({ error: 'Gasto de catálogo no encontrado' });
  const b = req.body || {};

  let nombre = actual.nombre;
  if (b.nombre !== undefined) {
    nombre = String(b.nombre || '').trim();
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    const dup = db.prepare('SELECT id FROM catalogo_gastos WHERE nombre = ? AND id <> ?').get(nombre, req.params.id);
    if (dup) return res.status(409).json({ error: 'Ya existe un gasto con ese nombre' });
  }
  const precio = b.precio !== undefined ? num(b.precio) : actual.precio;
  const descripcion = b.descripcion !== undefined ? txt(b.descripcion) : actual.descripcion;
  const activo = b.activo !== undefined ? (b.activo ? 1 : 0) : actual.activo;

  db.prepare('UPDATE catalogo_gastos SET nombre = ?, precio = ?, descripcion = ?, activo = ? WHERE id = ?')
    .run(nombre, precio, descripcion, activo, req.params.id);
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'editar', 'catalogo_gasto', req.params.id, nombre);
  res.json({ ok: true });
});

// Borrar gasto de catálogo: solo si no se usa en ningún apartamento.
catalogo.delete('/:id', (req, res) => {
  const gasto = db.prepare('SELECT nombre FROM catalogo_gastos WHERE id = ?').get(req.params.id);
  if (!gasto) return res.status(404).json({ error: 'Gasto de catálogo no encontrado' });
  const usos = db.prepare('SELECT COUNT(*) AS c FROM apartamento_gastos WHERE catalogo_gasto_id = ?').get(req.params.id).c;
  if (usos > 0) {
    return res.status(409).json({ error: `No se puede eliminar: usado en ${usos} gasto(s) de apartamentos` });
  }
  db.prepare('DELETE FROM catalogo_gastos WHERE id = ?').run(req.params.id);
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'eliminar', 'catalogo_gasto', req.params.id, gasto.nombre);
  res.json({ ok: true });
});

// ============== Gastos por apartamento (/api/apartamentos/:id/gastos) ==============
const apartamentoGastos = express.Router({ mergeParams: true });

// Lista los gastos del apartamento de un año + total_anio (SUM precio del año).
apartamentoGastos.get('/', (req, res) => {
  const apartamentoId = req.params.id;
  const anio = anioParam(req);
  const gastos = db.prepare(`
    SELECT g.*, c.nombre AS catalogo_nombre, c.activo AS catalogo_activo
    FROM apartamento_gastos g
    LEFT JOIN catalogo_gastos c ON c.id = g.catalogo_gasto_id
    WHERE g.apartamento_id = ? AND strftime('%Y', g.fecha) = ?
    ORDER BY g.fecha DESC, g.id DESC
  `).all(apartamentoId, anio);
  const total_anio = gastos.reduce((s, g) => s + (Number(g.precio) || 0), 0);
  res.json({ gastos, total_anio });
});

// Añade un gasto al apartamento. El nombre se copia del catálogo (snapshot); el precio usa
// el del body si viene (editable) y, si no, el del catálogo.
apartamentoGastos.post('/', (req, res) => {
  const apartamentoId = req.params.id;
  const apto = db.prepare('SELECT id FROM apartamentos WHERE id = ?').get(apartamentoId);
  if (!apto) return res.status(404).json({ error: 'Alojamiento no encontrado' });

  const b = req.body || {};
  const cat = db.prepare('SELECT id, nombre, precio FROM catalogo_gastos WHERE id = ?').get(b.catalogo_gasto_id);
  if (!cat) return res.status(400).json({ error: 'Gasto de catálogo no válido' });
  const fecha = String(b.fecha || '').trim();
  if (!fecha) return res.status(400).json({ error: 'La fecha es obligatoria' });

  const precio = (b.precio === undefined || b.precio === null || b.precio === '') ? cat.precio : num(b.precio);

  const info = db.prepare(`
    INSERT INTO apartamento_gastos
      (apartamento_id, catalogo_gasto_id, nombre, precio, fecha, notas, cobrado_propietario, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    apartamentoId, cat.id, cat.nombre, precio, fecha, txt(b.notas),
    b.cobrado_propietario ? 1 : 0, req.usuario && req.usuario.username
  );
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'crear', 'gasto', info.lastInsertRowid, `${cat.nombre} (apto ${apartamentoId})`);
  res.status(201).json({ id: info.lastInsertRowid });
});

// Edita fecha / notas / cobrado_propietario (no se tocan nombre ni precio: son histórico).
apartamentoGastos.put('/:gasto_id', (req, res) => {
  const gasto = db.prepare('SELECT * FROM apartamento_gastos WHERE id = ? AND apartamento_id = ?')
    .get(req.params.gasto_id, req.params.id);
  if (!gasto) return res.status(404).json({ error: 'Gasto no encontrado' });

  const b = req.body || {};
  const fecha = b.fecha !== undefined ? (String(b.fecha || '').trim() || gasto.fecha) : gasto.fecha;
  const notas = b.notas !== undefined ? txt(b.notas) : gasto.notas;
  const cobrado = b.cobrado_propietario !== undefined ? (b.cobrado_propietario ? 1 : 0) : gasto.cobrado_propietario;

  db.prepare('UPDATE apartamento_gastos SET fecha = ?, notas = ?, cobrado_propietario = ? WHERE id = ?')
    .run(fecha, notas, cobrado, req.params.gasto_id);
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'editar', 'gasto', req.params.gasto_id, gasto.nombre);
  res.json({ ok: true });
});

// Elimina un gasto del apartamento.
apartamentoGastos.delete('/:gasto_id', (req, res) => {
  const gasto = db.prepare('SELECT nombre FROM apartamento_gastos WHERE id = ? AND apartamento_id = ?')
    .get(req.params.gasto_id, req.params.id);
  if (!gasto) return res.status(404).json({ error: 'Gasto no encontrado' });
  db.prepare('DELETE FROM apartamento_gastos WHERE id = ?').run(req.params.gasto_id);
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'eliminar', 'gasto', req.params.gasto_id, gasto.nombre);
  res.json({ ok: true });
});

module.exports = { catalogo, apartamentoGastos };
