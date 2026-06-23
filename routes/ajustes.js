// API REST de ajustes: razones sociales (datos de facturación) y registro de actividad.
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db/database');
const { registrarActividad } = require('../services/actividadService');
const { enviarEmail, leerConfigSmtp } = require('../services/emailService');

const router = express.Router();

const SMTP_MASK = '••••••••'; // se devuelve en vez de la contraseña real
const SMTP_CLAVES = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_password', 'smtp_from_name', 'smtp_from_email'];

// Solo administradores. Devuelve true si responde 403 (corta el handler).
function bloqueaNoAdmin(req, res) {
  if (!req.usuario || req.usuario.rol !== 'administrador') {
    res.status(403).json({ error: 'Solo los administradores pueden gestionar esta configuración' });
    return true;
  }
  return false;
}

// Guarda (upsert) una clave en la tabla clave-valor `ajustes`.
function guardarAjuste(clave, valor) {
  db.prepare(`
    INSERT INTO ajustes (clave, valor) VALUES (?, ?)
    ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor
  `).run(clave, valor == null ? '' : String(valor));
}

// Logos de razones sociales: se reciben en memoria y se escriben con el nombre definitivo.
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads', 'razones-sociales');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const EXT_LOGO = ['.jpg', '.jpeg', '.png', '.webp', '.svg'];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Columnas editables de razones_sociales (todas menos id y created_at).
const RS_CAMPOS = [
  'razon_social', 'nombre_comercial', 'cif_nif', 'direccion', 'persona_contacto',
  'numero', 'email_contacto', 'puerta', 'telefono', 'codigo_postal', 'fax', 'ciudad',
  'iva', 'estado_provincia', 'codigo_cnae', 'pais', 'iva_intracomunitario',
  'tipo_direccion', 'tipo_documento_in', 'numero_documento_in',
  'nombre_banco', 'iban', 'direccion_banco', 'codigo_swift', 'numero_cuenta_ccc',
  'representante_nombre', 'representante_dni',
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
// Orden: la predeterminada primero (para que los selects la tomen como opción inicial).
router.get('/razones-sociales', (req, res) => {
  res.json(db.prepare('SELECT * FROM razones_sociales ORDER BY predeterminada DESC, id').all());
});

// Razón social predeterminada (la marcada; si ninguna lo está, la de menor id).
// Declarada antes de /razones-sociales/:id (ruta distinta, sin colisión de prefijo).
router.get('/razon-social-predeterminada', (req, res) => {
  const rs = db.prepare('SELECT * FROM razones_sociales ORDER BY predeterminada DESC, id LIMIT 1').get();
  if (!rs) return res.status(404).json({ error: 'No hay ninguna razón social' });
  res.json(rs);
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

// Sube/actualiza el logo de una razón social (multipart, campo "logo").
router.post('/razones-sociales/:id/logo', upload.single('logo'), (req, res) => {
  const id = Number(req.params.id);
  const rs = db.prepare('SELECT * FROM razones_sociales WHERE id = ?').get(id);
  if (!rs) return res.status(404).json({ error: 'Razón social no encontrada' });
  if (!req.file) return res.status(400).json({ error: 'No se ha recibido ninguna imagen' });

  const ext = path.extname(req.file.originalname).toLowerCase();
  if (!EXT_LOGO.includes(ext)) {
    return res.status(400).json({ error: 'Formato no permitido (solo .jpg, .jpeg, .png, .webp, .svg)' });
  }

  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  // Borra el logo anterior del disco, si lo había.
  if (rs.logo_url) {
    try { fs.unlinkSync(path.join(PUBLIC_DIR, rs.logo_url)); } catch (e) { /* puede no existir */ }
  }

  const nombreArchivo = `razon-${id}-${Date.now()}${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, nombreArchivo), req.file.buffer);

  const logo_url = `/uploads/razones-sociales/${nombreArchivo}`;
  db.prepare('UPDATE razones_sociales SET logo_url = ? WHERE id = ?').run(logo_url, id);
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'editar', 'razon_social', id, rs.razon_social);
  res.json({ ok: true, logo_url });
});

// Sube/actualiza la imagen de firma/sello de una razón social (multipart, campo "firma").
// Misma mecánica que el logo; se inserta en el recuadro de firma del PDF del contrato.
router.post('/razones-sociales/:id/firma', upload.single('firma'), (req, res) => {
  const id = Number(req.params.id);
  const rs = db.prepare('SELECT * FROM razones_sociales WHERE id = ?').get(id);
  if (!rs) return res.status(404).json({ error: 'Razón social no encontrada' });
  if (!req.file) return res.status(400).json({ error: 'No se ha recibido ninguna imagen' });

  const ext = path.extname(req.file.originalname).toLowerCase();
  if (!EXT_LOGO.includes(ext)) {
    return res.status(400).json({ error: 'Formato no permitido (solo .jpg, .jpeg, .png, .webp, .svg)' });
  }

  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  // Borra la firma anterior del disco, si la había.
  if (rs.firma_url) {
    try { fs.unlinkSync(path.join(PUBLIC_DIR, rs.firma_url)); } catch (e) { /* puede no existir */ }
  }

  const nombreArchivo = `firma-${id}-${Date.now()}${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, nombreArchivo), req.file.buffer);

  const firma_url = `/uploads/razones-sociales/${nombreArchivo}`;
  db.prepare('UPDATE razones_sociales SET firma_url = ? WHERE id = ?').run(firma_url, id);
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'editar', 'razon_social', id, rs.razon_social);
  res.json({ ok: true, firma_url });
});

// Marca una razón social como predeterminada y desmarca el resto (en una transacción).
router.put('/razones-sociales/:id/predeterminada', (req, res) => {
  const id = Number(req.params.id);
  const rs = db.prepare('SELECT id, razon_social FROM razones_sociales WHERE id = ?').get(id);
  if (!rs) return res.status(404).json({ error: 'Razón social no encontrada' });
  db.transaction(() => {
    db.prepare('UPDATE razones_sociales SET predeterminada = 0').run();
    db.prepare('UPDATE razones_sociales SET predeterminada = 1 WHERE id = ?').run(id);
  })();
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'editar', 'razon_social', id, `Predeterminada: ${rs.razon_social || id}`);
  res.json({ ok: true });
});

router.delete('/razones-sociales/:id', (req, res) => {
  const rs = db.prepare('SELECT razon_social FROM razones_sociales WHERE id = ?').get(req.params.id);
  const info = db.prepare('DELETE FROM razones_sociales WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Razón social no encontrada' });
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'eliminar', 'razon_social', req.params.id, rs && rs.razon_social);
  res.json({ ok: true });
});

// ===== Estados de reserva (catálogo configurable) =====
router.get('/estados-reserva', (req, res) => {
  res.json(db.prepare('SELECT * FROM estados_reserva ORDER BY orden, nombre').all());
});

router.post('/estados-reserva', (req, res) => {
  const b = req.body || {};
  const nombre = String(b.nombre || '').trim();
  if (!nombre) return res.status(400).json({ error: 'El nombre del estado es obligatorio' });
  const dup = db.prepare('SELECT id FROM estados_reserva WHERE nombre = ?').get(nombre);
  if (dup) return res.status(409).json({ error: 'Ya existe un estado con ese nombre' });

  const color = String(b.color || '').trim() || '#3b82f6';
  const maxOrden = db.prepare('SELECT COALESCE(MAX(orden), 0) AS m FROM estados_reserva').get().m;
  let orden = maxOrden + 1;
  if (b.orden !== undefined && b.orden !== null && b.orden !== '') {
    const o = parseInt(b.orden, 10);
    if (!isNaN(o)) orden = o;
  }
  // Los estados creados desde Ajustes nunca son del sistema.
  const info = db.prepare(
    'INSERT INTO estados_reserva (nombre, color, orden, activo, es_sistema) VALUES (?, ?, ?, 1, 0)'
  ).run(nombre, color, orden);
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'crear', 'estado_reserva', info.lastInsertRowid, nombre);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.put('/estados-reserva/:id', (req, res) => {
  const actual = db.prepare('SELECT * FROM estados_reserva WHERE id = ?').get(req.params.id);
  if (!actual) return res.status(404).json({ error: 'Estado no encontrado' });

  const b = req.body || {};
  const nombre = b.nombre != null && String(b.nombre).trim() ? String(b.nombre).trim() : actual.nombre;
  if (nombre !== actual.nombre) {
    const dup = db.prepare('SELECT id FROM estados_reserva WHERE nombre = ? AND id <> ?').get(nombre, actual.id);
    if (dup) return res.status(409).json({ error: 'Ya existe un estado con ese nombre' });
  }
  const color = b.color != null && String(b.color).trim() ? String(b.color).trim() : actual.color;
  const activo = b.activo === undefined ? actual.activo : (b.activo ? 1 : 0);
  let orden = actual.orden;
  if (b.orden !== undefined && b.orden !== null && b.orden !== '') {
    const o = parseInt(b.orden, 10);
    if (!isNaN(o)) orden = o;
  }
  db.prepare('UPDATE estados_reserva SET nombre = ?, color = ?, activo = ?, orden = ? WHERE id = ?')
    .run(nombre, color, activo, orden, actual.id);
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'editar', 'estado_reserva', actual.id, nombre);
  res.json({ ok: true });
});

router.delete('/estados-reserva/:id', (req, res) => {
  const estado = db.prepare('SELECT * FROM estados_reserva WHERE id = ?').get(req.params.id);
  if (!estado) return res.status(404).json({ error: 'Estado no encontrado' });
  if (estado.es_sistema) {
    return res.status(409).json({ error: 'No se puede eliminar un estado del sistema' });
  }
  const usos = db.prepare('SELECT COUNT(*) AS c FROM reservas WHERE tipo_reserva = ?').get(estado.nombre).c;
  if (usos > 0) {
    return res.status(409).json({ error: `No se puede eliminar: ${usos} reserva(s) usan este estado` });
  }
  db.prepare('DELETE FROM estados_reserva WHERE id = ?').run(estado.id);
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'eliminar', 'estado_reserva', estado.id, estado.nombre);
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

// ===== Configuración SMTP (solo admin) =====
router.get('/smtp', (req, res) => {
  if (bloqueaNoAdmin(req, res)) return;
  const cfg = leerConfigSmtp(db);
  // No devolver la contraseña en claro: máscara si hay guardada, vacío si no.
  cfg.smtp_password = cfg.smtp_password ? SMTP_MASK : '';
  res.json(cfg);
});

router.put('/smtp', (req, res) => {
  if (bloqueaNoAdmin(req, res)) return;
  const b = req.body || {};
  for (const clave of SMTP_CLAVES) {
    if (clave === 'smtp_password') {
      // Si llega la máscara (o no llega), conservar la contraseña anterior.
      if (b.smtp_password === undefined || b.smtp_password === SMTP_MASK) continue;
      guardarAjuste('smtp_password', b.smtp_password);
    } else if (clave in b) {
      guardarAjuste(clave, b[clave]);
    }
  }
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'editar', 'smtp', null, 'Configuración SMTP actualizada');
  res.json({ ok: true });
});

router.post('/smtp/test', async (req, res) => {
  if (bloqueaNoAdmin(req, res)) return;
  const cfg = leerConfigSmtp(db);
  const destino = cfg.smtp_user;
  if (!destino) return res.json({ ok: false, error: 'No hay usuario SMTP configurado' });
  try {
    await enviarEmail(db, {
      to: destino,
      subject: 'Prueba de configuración SMTP — CRM',
      html: '<p>Este es un email de prueba del CRM. Si lo recibes, la configuración SMTP funciona correctamente.</p>',
    });
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message || 'No se pudo enviar el email de prueba' });
  }
});

module.exports = router;
