// API REST de propietarios.
const express = require('express');
const multer = require('multer');
const db = require('../db/database');
const { importarPropietarios } = require('../services/importPropietarios');
const { registrarActividad } = require('../services/actividadService');

const router = express.Router();

// Atajo para registrar actividad con el usuario de la petición.
function log(req, accion, entidadId, detalle) {
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, accion, 'propietario', entidadId, detalle);
}

// Columnas editables de propietarios (todas menos id). Se usan para construir
// INSERT/UPDATE de forma dinámica y mantener un único punto de verdad.
const CAMPOS = [
  'nombre', 'apellidos', 'segundo_apellido', 'tratamiento', 'idioma',
  'fecha_alta', 'fecha_nacimiento', 'tags', 'notas',
  'telefono', 'telefono2', 'telefono3', 'email', 'email2', 'fax',
  'direccion', 'direccion_numero', 'bloque_portal', 'planta_puerta',
  'codigo_postal', 'pais', 'region', 'provincia', 'ciudad', 'tipo_direccion',
  'dni', 'tipo_documento', 'numero_documento', 'expedido_fecha',
  'ciudad_nacimiento', 'provincia_nacimiento', 'pais_nacimiento',
  'lugar_expedicion', 'tipo_identificacion',
  'metodo_pago', 'retencion', 'tipo_cuenta', 'titular_cuenta',
  'numero_cuenta', 'cuenta_contable', 'codigo_fiscal',
];

// Recibe el archivo de importación en memoria.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
});

// Construye un objeto con todos los CAMPOS a partir del body, normalizando a
// string vacío -> null (better-sqlite3 lanza al hacer bind de undefined).
function recogerCampos(body, { soloPresentes = false } = {}) {
  const datos = {};
  for (const c of CAMPOS) {
    if (soloPresentes && !(c in body)) continue;
    const v = body[c];
    datos[c] = v === undefined || v === null || v === '' ? null : v;
  }
  return datos;
}

// Lista todos los propietarios con el nº de alojamientos asignados.
router.get('/', (req, res) => {
  const filas = db
    .prepare(
      `SELECT p.*,
        (SELECT COUNT(*) FROM apartamento_propietarios ap WHERE ap.propietario_id = p.id AND ap.activo = 1) AS num_alojamientos
       FROM propietarios p
       ORDER BY p.nombre, p.apellidos`
    )
    .all();
  res.json(filas);
});

// Importación desde Excel/CSV (multipart, campo "archivo"). Debe ir antes de /:id.
router.post('/importar', upload.single('archivo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se ha recibido ningún archivo' });
  try {
    const resumen = importarPropietarios(req.file.buffer);
    log(req, 'importar', null, `${resumen.nuevos} nuevos / ${resumen.actualizados} actualizados`);
    res.json(resumen);
  } catch (e) {
    console.error('Error importando propietarios:', e);
    res.status(500).json({ error: 'No se pudo procesar el archivo: ' + e.message });
  }
});

// Ficha de un propietario con sus apartamentos asociados.
router.get('/:id', (req, res) => {
  const propietario = db.prepare('SELECT * FROM propietarios WHERE id = ?').get(req.params.id);
  if (!propietario) return res.status(404).json({ error: 'Propietario no encontrado' });

  const apartamentos = db
    .prepare(`
      SELECT a.*, ap.porcentaje, ap.fecha_inicio, ap.fecha_fin, ap.activo AS relacion_activa
      FROM apartamento_propietarios ap
      JOIN apartamentos a ON a.id = ap.apartamento_id
      WHERE ap.propietario_id = ? AND ap.activo = 1
      ORDER BY a.nombre
    `)
    .all(req.params.id);

  res.json({ ...propietario, apartamentos });
});

// Crea un propietario.
router.post('/', (req, res) => {
  if (!req.body.nombre || !String(req.body.nombre).trim()) {
    return res.status(400).json({ error: 'El nombre es obligatorio' });
  }
  const datos = recogerCampos(req.body);
  if (!datos.fecha_alta) datos.fecha_alta = new Date().toISOString().slice(0, 10);

  const cols = CAMPOS.join(', ');
  const placeholders = CAMPOS.map((c) => '@' + c).join(', ');
  const info = db
    .prepare(`INSERT INTO propietarios (${cols}) VALUES (${placeholders})`)
    .run(datos);
  log(req, 'crear', info.lastInsertRowid, [datos.nombre, datos.apellidos].filter(Boolean).join(' '));
  res.status(201).json({ id: info.lastInsertRowid });
});

// Actualiza un propietario (todos los campos presentes en el body).
router.put('/:id', (req, res) => {
  if ('nombre' in req.body && !String(req.body.nombre).trim()) {
    return res.status(400).json({ error: 'El nombre es obligatorio' });
  }
  const datos = recogerCampos(req.body, { soloPresentes: true });
  const claves = Object.keys(datos);
  if (claves.length === 0) return res.json({ ok: true });

  const set = claves.map((c) => `${c} = @${c}`).join(', ');
  const info = db
    .prepare(`UPDATE propietarios SET ${set} WHERE id = @id`)
    .run({ ...datos, id: req.params.id });
  if (info.changes === 0) return res.status(404).json({ error: 'Propietario no encontrado' });
  log(req, 'editar', req.params.id, [datos.nombre, datos.apellidos].filter(Boolean).join(' '));
  res.json({ ok: true });
});

// Elimina un propietario (sus apartamentos quedan sin propietario asociado).
router.delete('/:id', (req, res) => {
  const prop = db.prepare('SELECT nombre, apellidos FROM propietarios WHERE id = ?').get(req.params.id);
  const info = db.prepare('DELETE FROM propietarios WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Propietario no encontrado' });
  log(req, 'eliminar', req.params.id, prop && [prop.nombre, prop.apellidos].filter(Boolean).join(' '));
  res.json({ ok: true });
});

module.exports = router;
