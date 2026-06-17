// API REST de clientes (huéspedes/inquilinos). CRUD + búsqueda + importación Avantio.
const express = require('express');
const multer = require('multer');
const db = require('../db/database');
const { importarClientes } = require('../services/importClientes');
const { registrarActividad } = require('../services/actividadService');

const router = express.Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Columnas editables vía API (punto de verdad para INSERT/UPDATE).
const CAMPOS = [
  'id_avantio', 'nombre', 'apellido1', 'apellido2', 'fecha_nacimiento', 'sexo', 'nacionalidad',
  'calle', 'numero', 'puerta', 'codigo_postal', 'ciudad', 'provincia', 'pais', 'dni',
  'email', 'email2', 'telefono', 'telefono2', 'telefono3', 'idioma', 'tipo_cliente',
  'cuenta_bancaria', 'codigo_fiscal', 'observaciones', 'cuenta_contable', 'region',
];

function txt(v) { return v === undefined || v === null || v === '' ? null : String(v); }

// GET /api/clientes?buscar=&limit=50 — búsqueda por nombre/apellidos/email/teléfono/DNI.
router.get('/', (req, res) => {
  const buscar = String(req.query.buscar || '').trim();
  let limit = parseInt(req.query.limit, 10);
  if (isNaN(limit) || limit <= 0) limit = 50;

  let offset = parseInt(req.query.offset, 10);
  if (isNaN(offset) || offset < 0) offset = 0;

  let sql = `SELECT c.*,
               (SELECT COUNT(*) FROM reservas r WHERE r.cliente_id = c.id) AS num_reservas
             FROM clientes c`;
  const params = [];
  if (buscar) {
    const like = `%${buscar.toLowerCase()}%`;
    sql += ` WHERE lower(c.nombre) LIKE ? OR lower(c.apellido1) LIKE ? OR lower(c.apellido2) LIKE ?
             OR lower(c.email) LIKE ? OR lower(c.email2) LIKE ?
             OR c.telefono LIKE ? OR c.telefono2 LIKE ? OR c.telefono3 LIKE ?
             OR lower(c.dni) LIKE ?`;
    params.push(like, like, like, like, like, like, like, like, like);
  }
  sql += ' ORDER BY c.nombre, c.apellido1 LIMIT ? OFFSET ?';
  params.push(limit, offset);
  res.json(db.prepare(sql).all(...params));
});

// GET /api/clientes/:id — ficha completa + historial de reservas vinculadas.
router.get('/:id', (req, res) => {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });
  const reservas = db.prepare(`
    SELECT r.id, r.numero_reserva, r.entrada, r.salida, r.precio_total, r.tipo_reserva,
           a.nombre AS apartamento_nombre
    FROM reservas r LEFT JOIN apartamentos a ON a.id = r.apartamento_id
    WHERE r.cliente_id = ?
    ORDER BY r.entrada DESC
  `).all(cliente.id);
  res.json({ ...cliente, reservas });
});

// POST /api/clientes — crear.
router.post('/', (req, res) => {
  const b = req.body || {};
  if (!b.nombre || !String(b.nombre).trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  const datos = {};
  for (const c of CAMPOS) datos[c] = txt(b[c]);
  datos.nombre = String(b.nombre).trim();
  const cols = CAMPOS.join(', ');
  const placeholders = CAMPOS.map((c) => '@' + c).join(', ');
  const info = db.prepare(`INSERT INTO clientes (${cols}) VALUES (${placeholders})`).run(datos);
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre,
    'crear', 'cliente', info.lastInsertRowid, datos.nombre);
  res.status(201).json({ id: info.lastInsertRowid });
});

// PUT /api/clientes/:id — editar (solo los campos presentes en el body).
router.put('/:id', (req, res) => {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });
  const b = req.body || {};
  if ('nombre' in b && !String(b.nombre).trim()) return res.status(400).json({ error: 'El nombre no puede quedar vacío' });

  const sets = [];
  const vals = {};
  for (const c of CAMPOS) {
    if (c in b) { sets.push(`${c} = @${c}`); vals[c] = c === 'nombre' ? String(b.nombre).trim() : txt(b[c]); }
  }
  if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
  sets.push("updated_at = datetime('now')");
  vals.id = cliente.id;
  db.prepare(`UPDATE clientes SET ${sets.join(', ')} WHERE id = @id`).run(vals);
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre,
    'editar', 'cliente', cliente.id, cliente.nombre);
  res.json({ ok: true });
});

// DELETE /api/clientes/:id — solo si no tiene reservas vinculadas.
router.delete('/:id', (req, res) => {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });
  const usos = db.prepare('SELECT COUNT(*) AS c FROM reservas WHERE cliente_id = ?').get(cliente.id).c;
  if (usos > 0) return res.status(409).json({ error: `No se puede eliminar: ${usos} reserva(s) vinculada(s)` });
  db.prepare('DELETE FROM clientes WHERE id = ?').run(cliente.id);
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre,
    'eliminar', 'cliente', cliente.id, cliente.nombre);
  res.json({ ok: true });
});

// POST /api/clientes/importar — multipart (campo "archivo"); upsert por id_avantio.
router.post('/importar', upload.single('archivo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se ha recibido ningún archivo' });
  try {
    const resumen = importarClientes(req.file.buffer);
    registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre,
      'importar', 'cliente', null, `${resumen.nuevos} nuevos / ${resumen.actualizados} actualizados`);
    res.json(resumen);
  } catch (e) {
    console.error('Error importando clientes:', e);
    res.status(500).json({ error: 'No se pudo procesar el archivo: ' + e.message });
  }
});

module.exports = router;
