// API REST de la galería de fotos de un apartamento.
// Se monta como sub-router en /api/apartamentos/:id/fotos (ANTES del router de
// apartamentos), por eso usa mergeParams para acceder a req.params.id.
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db/database');
const { registrarActividad } = require('../services/actividadService');

const router = express.Router({ mergeParams: true });

const UPLOAD_BASE = path.join(__dirname, '..', 'public', 'uploads', 'apartamentos');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const EXT_PERMITIDAS = ['.jpg', '.jpeg', '.png', '.webp'];

// Las fotos se reciben en memoria y se escriben con el nombre definitivo.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB por foto
});

// Comprueba que el apartamento existe; devuelve la fila o null.
function getApartamento(id) {
  return db.prepare('SELECT id, nombre FROM apartamentos WHERE id = ?').get(id);
}

// GET /api/apartamentos/:id/fotos — lista de fotos ordenadas.
router.get('/', (req, res) => {
  if (!getApartamento(req.params.id)) return res.status(404).json({ error: 'Alojamiento no encontrado' });
  const fotos = db
    .prepare('SELECT * FROM apartamento_fotos WHERE apartamento_id = ? ORDER BY orden, id')
    .all(req.params.id);
  res.json(fotos);
});

// POST /api/apartamentos/:id/fotos — sube hasta 10 fotos (multipart, campo "fotos").
router.post('/', upload.array('fotos', 10), (req, res) => {
  const apto = getApartamento(req.params.id);
  if (!apto) return res.status(404).json({ error: 'Alojamiento no encontrado' });
  if (!req.files || !req.files.length) {
    return res.status(400).json({ error: 'No se ha recibido ninguna foto' });
  }

  // Validar formatos antes de escribir nada.
  for (const f of req.files) {
    const ext = path.extname(f.originalname).toLowerCase();
    if (!EXT_PERMITIDAS.includes(ext)) {
      return res.status(400).json({ error: `Formato no permitido en "${f.originalname}" (solo .jpg, .jpeg, .png, .webp)` });
    }
  }

  const destino = path.join(UPLOAD_BASE, String(apto.id));
  fs.mkdirSync(destino, { recursive: true });

  // El orden continúa a partir del máximo actual.
  let orden = db
    .prepare('SELECT COALESCE(MAX(orden), 0) AS m FROM apartamento_fotos WHERE apartamento_id = ?')
    .get(apto.id).m;

  const insertar = db.prepare(`
    INSERT INTO apartamento_fotos (apartamento_id, url, nombre_archivo, orden)
    VALUES (?, ?, ?, ?)
  `);
  const ts = Date.now();
  const creadas = [];
  const tx = db.transaction(() => {
    req.files.forEach((f, index) => {
      const ext = path.extname(f.originalname).toLowerCase();
      const nombreArchivo = `${apto.id}-${ts}-${index}${ext}`;
      fs.writeFileSync(path.join(destino, nombreArchivo), f.buffer);
      const url = `/uploads/apartamentos/${apto.id}/${nombreArchivo}`;
      orden += 1;
      const info = insertar.run(apto.id, url, nombreArchivo, orden);
      creadas.push({ id: info.lastInsertRowid, url, nombre_archivo: nombreArchivo, orden });
    });
  });
  tx();

  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre,
    'crear', 'alojamiento-foto', apto.id, `${creadas.length} foto(s) en ${apto.nombre}`);
  res.status(201).json({ ok: true, fotos: creadas });
});

// PUT /api/apartamentos/:id/fotos/:foto_id — edita descripcion y/o orden.
router.put('/:foto_id', (req, res) => {
  const foto = db
    .prepare('SELECT * FROM apartamento_fotos WHERE id = ? AND apartamento_id = ?')
    .get(req.params.foto_id, req.params.id);
  if (!foto) return res.status(404).json({ error: 'Foto no encontrada' });

  const b = req.body || {};
  const sets = [];
  const vals = [];
  if ('descripcion' in b) {
    sets.push('descripcion = ?');
    vals.push(b.descripcion === undefined || b.descripcion === null ? null : String(b.descripcion));
  }
  if ('orden' in b) {
    const o = parseInt(b.orden, 10);
    if (!isNaN(o)) { sets.push('orden = ?'); vals.push(o); }
  }
  if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });

  vals.push(foto.id);
  db.prepare(`UPDATE apartamento_fotos SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  res.json({ ok: true });
});

// POST /api/apartamentos/:id/fotos/reordenar — Body: { orden: [id1, id2, ...] }.
router.post('/reordenar', (req, res) => {
  if (!getApartamento(req.params.id)) return res.status(404).json({ error: 'Alojamiento no encontrado' });
  const orden = (req.body || {}).orden;
  if (!Array.isArray(orden)) return res.status(400).json({ error: 'Se espera { orden: [id1, id2, ...] }' });

  const actualizar = db.prepare(
    'UPDATE apartamento_fotos SET orden = ? WHERE id = ? AND apartamento_id = ?'
  );
  const tx = db.transaction(() => {
    orden.forEach((fotoId, i) => actualizar.run(i + 1, fotoId, req.params.id));
  });
  tx();
  res.json({ ok: true });
});

// DELETE /api/apartamentos/:id/fotos/:foto_id — borra de BD y de disco.
router.delete('/:foto_id', (req, res) => {
  const foto = db
    .prepare('SELECT * FROM apartamento_fotos WHERE id = ? AND apartamento_id = ?')
    .get(req.params.foto_id, req.params.id);
  if (!foto) return res.status(404).json({ error: 'Foto no encontrada' });

  db.prepare('DELETE FROM apartamento_fotos WHERE id = ?').run(foto.id);
  try { fs.unlinkSync(path.join(PUBLIC_DIR, foto.url)); } catch (e) { /* puede no existir */ }

  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre,
    'eliminar', 'alojamiento-foto', foto.id, foto.nombre_archivo);
  res.json({ ok: true });
});

module.exports = router;
