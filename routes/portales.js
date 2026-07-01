// API REST de portales de venta (Booking.com, Airbnb, etc.).
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db/database');

const router = express.Router();

// Carpeta donde se guardan las imágenes de portales (servida por express.static).
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads', 'portales');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const EXT_PERMITIDAS = ['.jpg', '.jpeg', '.png', '.webp', '.svg'];

// Recibimos la imagen en memoria y la escribimos nosotros con el nombre definitivo.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

// Lista de portales ordenados. Por defecto solo los activos (para el select de reservas);
// con ?todos=1 devuelve también los inactivos (para la pantalla de gestión en Ajustes).
router.get('/', (req, res) => {
  const todos = req.query.todos === '1' || req.query.todos === 'true';
  const filtro = todos ? '' : 'WHERE p.activo = 1';
  const sql = `
    SELECT p.*, m.nombre AS mayorista_nombre
    FROM portales p
    LEFT JOIN mayoristas m ON m.id = p.mayorista_id
    ${filtro}
    ORDER BY p.orden, p.nombre
  `;
  res.json(db.prepare(sql).all());
});

// Crea un portal nuevo.
router.post('/', (req, res) => {
  const nombre = String((req.body && req.body.nombre) || '').trim();
  if (!nombre) return res.status(400).json({ error: 'El nombre del portal es obligatorio' });
  const existe = db.prepare('SELECT id FROM portales WHERE nombre = ?').get(nombre);
  if (existe) return res.status(409).json({ error: 'Ya existe un portal con ese nombre' });
  const maxOrden = db.prepare('SELECT COALESCE(MAX(orden), 0) AS m FROM portales').get().m;
  const prefijo = req.body && req.body.prefijo != null && String(req.body.prefijo).trim()
    ? String(req.body.prefijo).trim().toUpperCase() : null;
  const mayorista_id = (req.body && req.body.mayorista_id != null && req.body.mayorista_id !== '')
    ? Number(req.body.mayorista_id) : null;
  const comision = (req.body && req.body.comision_porcentaje != null && req.body.comision_porcentaje !== '')
    ? Number(req.body.comision_porcentaje) : 0;
  const info = db.prepare('INSERT INTO portales (nombre, activo, orden, prefijo, mayorista_id, comision_porcentaje) VALUES (?, 1, ?, ?, ?, ?)')
    .run(nombre, maxOrden + 1, prefijo, mayorista_id, comision);
  res.status(201).json({ id: info.lastInsertRowid });
});

// Edita un portal: nombre, activo y/o orden (solo los campos presentes en el body).
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const actual = db.prepare('SELECT * FROM portales WHERE id = ?').get(id);
  if (!actual) return res.status(404).json({ error: 'Portal no encontrado' });

  const b = req.body || {};
  const nombre = b.nombre != null && String(b.nombre).trim() ? String(b.nombre).trim() : actual.nombre;
  if (nombre !== actual.nombre) {
    const dup = db.prepare('SELECT id FROM portales WHERE nombre = ? AND id <> ?').get(nombre, id);
    if (dup) return res.status(409).json({ error: 'Ya existe un portal con ese nombre' });
  }
  const activo = b.activo === undefined ? actual.activo : (b.activo ? 1 : 0);
  let orden = actual.orden;
  if (b.orden !== undefined && b.orden !== null && b.orden !== '') {
    const o = parseInt(b.orden, 10);
    if (!isNaN(o)) orden = o;
  }
  const color = b.color != null && String(b.color).trim() ? String(b.color).trim() : actual.color;
  // prefijo: si viene en el body se actualiza (cadena vacía => null); si no, se conserva.
  const prefijo = 'prefijo' in b
    ? (String(b.prefijo || '').trim() ? String(b.prefijo).trim().toUpperCase() : null)
    : actual.prefijo;
  const mayorista_id = 'mayorista_id' in b
    ? (b.mayorista_id != null && b.mayorista_id !== '' ? Number(b.mayorista_id) : null)
    : actual.mayorista_id;
  const comision = 'comision_porcentaje' in b
    ? (b.comision_porcentaje != null && b.comision_porcentaje !== '' ? Number(b.comision_porcentaje) : 0)
    : (actual.comision_porcentaje || 0);
  db.prepare('UPDATE portales SET nombre = ?, activo = ?, orden = ?, color = ?, prefijo = ?, mayorista_id = ?, comision_porcentaje = ? WHERE id = ?')
    .run(nombre, activo, orden, color, prefijo, mayorista_id, comision, id);
  res.json({ ok: true });
});

// Sube/actualiza la imagen de un portal (multipart, campo "imagen").
router.post('/:id/imagen', upload.single('imagen'), (req, res) => {
  const id = Number(req.params.id);
  const portal = db.prepare('SELECT * FROM portales WHERE id = ?').get(id);
  if (!portal) return res.status(404).json({ error: 'Portal no encontrado' });
  if (!req.file) return res.status(400).json({ error: 'No se ha recibido ninguna imagen' });

  const ext = path.extname(req.file.originalname).toLowerCase();
  if (!EXT_PERMITIDAS.includes(ext)) {
    return res.status(400).json({ error: 'Formato no permitido (solo .jpg, .jpeg, .png, .webp, .svg)' });
  }

  // Asegura la carpeta de destino.
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  // Borra la imagen anterior del disco, si la había.
  if (portal.imagen_url) {
    try { fs.unlinkSync(path.join(PUBLIC_DIR, portal.imagen_url)); } catch (e) { /* puede no existir */ }
  }

  // Nombre único para evitar colisiones y problemas de caché.
  const nombreArchivo = `portal-${id}-${Date.now()}${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, nombreArchivo), req.file.buffer);

  const imagen_url = `/uploads/portales/${nombreArchivo}`;
  db.prepare('UPDATE portales SET imagen_url = ? WHERE id = ?').run(imagen_url, id);
  res.json({ ok: true, imagen_url });
});

// Elimina un portal (solo si ninguna reserva lo usa).
router.delete('/:id', (req, res) => {
  const portal = db.prepare('SELECT nombre FROM portales WHERE id = ?').get(req.params.id);
  if (!portal) return res.status(404).json({ error: 'Portal no encontrado' });
  const usos = db.prepare('SELECT COUNT(*) AS c FROM reservas WHERE portal = ?').get(portal.nombre).c;
  if (usos > 0) {
    return res.status(409).json({ error: `No se puede eliminar: ${usos} reserva(s) usan este portal` });
  }
  db.prepare('DELETE FROM portales WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
