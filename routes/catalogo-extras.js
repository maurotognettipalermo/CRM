// API REST de extras: catálogo reutilizable (gestionado en Ajustes) y extras imputados a
// cada reserva. Se exportan DOS routers que server.js monta por separado:
//   catalogo        -> /api/catalogo-extras
//   reservaExtras   -> /api/reservas/:id/extras   (mergeParams para leer :id)
// Ambos van bajo requireAuth, así que req.usuario = { id, nombre, username, rol }.
const express = require('express');
const db = require('../db/database');
const { registrarActividad } = require('../services/actividadService');

const TIPOS_PRECIO = ['unidad', 'noche', 'persona'];

// --- Helpers de coerción (better-sqlite3 lanza al hacer bind de undefined) ---
function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function txt(v) { return v === undefined || v === null || v === '' ? null : String(v); }
function tipoPrecio(v) { return TIPOS_PRECIO.includes(v) ? v : 'unidad'; }
function r2(n) { return Math.round(n * 100) / 100; }
function cant(v) { const n = parseInt(v, 10); return isNaN(n) || n < 1 ? 1 : n; }

// ==================== Catálogo de extras (/api/catalogo-extras) ====================
const catalogo = express.Router();

// Lista completa: activos primero, luego orden alfabético (case-insensitive).
catalogo.get('/', (req, res) => {
  res.json(db.prepare(
    'SELECT * FROM catalogo_extras ORDER BY activo DESC, nombre COLLATE NOCASE'
  ).all());
});

// Crear extra de catálogo (nombre único).
catalogo.post('/', (req, res) => {
  const b = req.body || {};
  const nombre = String(b.nombre || '').trim();
  if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
  if (db.prepare('SELECT id FROM catalogo_extras WHERE nombre = ?').get(nombre)) {
    return res.status(409).json({ error: 'Ya existe un extra con ese nombre' });
  }
  const activo = (b.activo === undefined || b.activo === null) ? 1 : (b.activo ? 1 : 0);
  const info = db.prepare(
    'INSERT INTO catalogo_extras (nombre, precio, tipo_precio, descripcion, activo) VALUES (?, ?, ?, ?, ?)'
  ).run(nombre, num(b.precio), tipoPrecio(b.tipo_precio), txt(b.descripcion), activo);
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'crear', 'catalogo_extra', info.lastInsertRowid, nombre);
  res.status(201).json({ id: info.lastInsertRowid });
});

// Editar nombre / precio / tipo_precio / descripcion / activo (solo campos presentes).
catalogo.put('/:id', (req, res) => {
  const actual = db.prepare('SELECT * FROM catalogo_extras WHERE id = ?').get(req.params.id);
  if (!actual) return res.status(404).json({ error: 'Extra de catálogo no encontrado' });
  const b = req.body || {};

  let nombre = actual.nombre;
  if (b.nombre !== undefined) {
    nombre = String(b.nombre || '').trim();
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    const dup = db.prepare('SELECT id FROM catalogo_extras WHERE nombre = ? AND id <> ?').get(nombre, req.params.id);
    if (dup) return res.status(409).json({ error: 'Ya existe un extra con ese nombre' });
  }
  const precio = b.precio !== undefined ? num(b.precio) : actual.precio;
  const tipo_precio = b.tipo_precio !== undefined ? tipoPrecio(b.tipo_precio) : actual.tipo_precio;
  const descripcion = b.descripcion !== undefined ? txt(b.descripcion) : actual.descripcion;
  const activo = b.activo !== undefined ? (b.activo ? 1 : 0) : actual.activo;

  db.prepare('UPDATE catalogo_extras SET nombre = ?, precio = ?, tipo_precio = ?, descripcion = ?, activo = ? WHERE id = ?')
    .run(nombre, precio, tipo_precio, descripcion, activo, req.params.id);
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'editar', 'catalogo_extra', req.params.id, nombre);
  res.json({ ok: true });
});

// Borrar extra de catálogo: solo si no se usa en ninguna reserva.
catalogo.delete('/:id', (req, res) => {
  const extra = db.prepare('SELECT nombre FROM catalogo_extras WHERE id = ?').get(req.params.id);
  if (!extra) return res.status(404).json({ error: 'Extra de catálogo no encontrado' });
  const usos = db.prepare('SELECT COUNT(*) AS c FROM reserva_extras WHERE catalogo_extra_id = ?').get(req.params.id).c;
  if (usos > 0) {
    return res.status(409).json({ error: `No se puede eliminar: usado en ${usos} reserva(s)` });
  }
  db.prepare('DELETE FROM catalogo_extras WHERE id = ?').run(req.params.id);
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'eliminar', 'catalogo_extra', req.params.id, extra.nombre);
  res.json({ ok: true });
});

// ============== Extras por reserva (/api/reservas/:id/extras) ==============
const reservaExtras = express.Router({ mergeParams: true });

// Nº de noches de la reserva (julianday(salida)-julianday(entrada)); mínimo 1 si faltan fechas.
function nochesReserva(reserva) {
  if (!reserva.entrada || !reserva.salida) return 1;
  const n = db.prepare('SELECT CAST(julianday(?) - julianday(?) AS INTEGER) AS n')
    .get(reserva.salida, reserva.entrada).n;
  return n && n > 0 ? n : 1;
}

// Lista los extras de la reserva + total_extras.
reservaExtras.get('/', (req, res) => {
  const reserva = db.prepare('SELECT id FROM reservas WHERE id = ?').get(req.params.id);
  if (!reserva) return res.status(404).json({ error: 'Reserva no encontrada' });
  const extras = db.prepare('SELECT * FROM reserva_extras WHERE reserva_id = ? ORDER BY id').all(req.params.id);
  const total_extras = r2(extras.reduce((s, e) => s + (Number(e.importe) || 0), 0));
  res.json({ extras, total_extras });
});

// Añade un extra a la reserva. Snapshot de nombre/precio/tipo del catálogo; importe calculado.
reservaExtras.post('/', (req, res) => {
  const reserva = db.prepare('SELECT id, entrada, salida FROM reservas WHERE id = ?').get(req.params.id);
  if (!reserva) return res.status(404).json({ error: 'Reserva no encontrada' });

  const b = req.body || {};
  const cat = db.prepare('SELECT id, nombre, precio, tipo_precio FROM catalogo_extras WHERE id = ?').get(b.catalogo_extra_id);
  if (!cat) return res.status(400).json({ error: 'Extra de catálogo no válido' });

  const cantidad = cant(b.cantidad);
  const noches = nochesReserva(reserva);
  const importe = r2(cat.precio * cantidad * (cat.tipo_precio === 'noche' ? noches : 1));

  const info = db.prepare(`
    INSERT INTO reserva_extras
      (reserva_id, catalogo_extra_id, nombre, precio_unitario, tipo_precio, cantidad, importe, noches)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.params.id, cat.id, cat.nombre, cat.precio, cat.tipo_precio, cantidad, importe, noches);

  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'crear', 'reserva_extra', info.lastInsertRowid, `${cat.nombre} (reserva ${req.params.id})`);
  res.status(201).json({ id: info.lastInsertRowid });
});

// Edita la cantidad y recalcula el importe (precio/tipo/noches se conservan del snapshot).
reservaExtras.put('/:extra_id', (req, res) => {
  const extra = db.prepare('SELECT * FROM reserva_extras WHERE id = ? AND reserva_id = ?')
    .get(req.params.extra_id, req.params.id);
  if (!extra) return res.status(404).json({ error: 'Extra no encontrado' });

  const b = req.body || {};
  const cantidad = b.cantidad !== undefined ? cant(b.cantidad) : extra.cantidad;
  const importe = r2(extra.precio_unitario * cantidad * (extra.tipo_precio === 'noche' ? (extra.noches || 1) : 1));

  db.prepare('UPDATE reserva_extras SET cantidad = ?, importe = ? WHERE id = ?')
    .run(cantidad, importe, req.params.extra_id);
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'editar', 'reserva_extra', req.params.extra_id, extra.nombre);
  res.json({ ok: true });
});

// Elimina un extra de la reserva.
reservaExtras.delete('/:extra_id', (req, res) => {
  const extra = db.prepare('SELECT nombre FROM reserva_extras WHERE id = ? AND reserva_id = ?')
    .get(req.params.extra_id, req.params.id);
  if (!extra) return res.status(404).json({ error: 'Extra no encontrado' });
  db.prepare('DELETE FROM reserva_extras WHERE id = ?').run(req.params.extra_id);
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'eliminar', 'reserva_extra', req.params.extra_id, extra.nombre);
  res.json({ ok: true });
});

module.exports = { catalogo, reservaExtras };
