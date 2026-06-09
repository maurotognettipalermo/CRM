// API REST de usuarios. Las contraseñas se guardan como sha256 (sin dependencias).
const express = require('express');
const crypto = require('crypto');
const db = require('../db/database');
const { registrarActividad } = require('../services/actividadService');

const router = express.Router();
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const ROLES_VALIDOS = ['administrador', 'usuario', 'limpieza'];

// Lista (sin exponer password_hash ni token).
router.get('/', (req, res) => {
  res.json(
    db.prepare(
      'SELECT id, nombre, username, rol, activo, created_at, ultimo_acceso FROM usuarios ORDER BY nombre'
    ).all()
  );
});

// Crear usuario.
router.post('/', (req, res) => {
  const { nombre, username, password, rol, activo } = req.body || {};
  if (!nombre || !String(nombre).trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  if (!username || !String(username).trim()) return res.status(400).json({ error: 'El usuario es obligatorio' });
  if (!password) return res.status(400).json({ error: 'La contraseña es obligatoria' });
  if (!ROLES_VALIDOS.includes(rol)) return res.status(400).json({ error: 'Rol no válido' });

  const existe = db.prepare('SELECT id FROM usuarios WHERE username = ?').get(String(username).trim());
  if (existe) return res.status(409).json({ error: 'Ya existe un usuario con ese nombre de usuario' });

  const info = db
    .prepare('INSERT INTO usuarios (nombre, username, password_hash, rol, activo) VALUES (?, ?, ?, ?, ?)')
    .run(nombre.trim(), username.trim(), sha256(password), rol, activo ? 1 : 0);
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'crear', 'usuario', info.lastInsertRowid, nombre.trim());
  res.status(201).json({ id: info.lastInsertRowid });
});

// Editar usuario. La contraseña solo se cambia si se envía no vacía.
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const actual = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  if (!actual) return res.status(404).json({ error: 'Usuario no encontrado' });

  const { nombre, username, password, rol, activo } = req.body || {};
  if (rol && !ROLES_VALIDOS.includes(rol)) return res.status(400).json({ error: 'Rol no válido' });

  // Un usuario no puede desactivarse a sí mismo.
  if (req.usuario && req.usuario.id === id && activo !== undefined && !activo) {
    return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta' });
  }

  const nuevoUsername = username != null && String(username).trim() ? String(username).trim() : actual.username;
  if (nuevoUsername !== actual.username) {
    const dup = db.prepare('SELECT id FROM usuarios WHERE username = ? AND id <> ?').get(nuevoUsername, id);
    if (dup) return res.status(409).json({ error: 'Ya existe un usuario con ese nombre de usuario' });
  }

  const nuevo = {
    nombre: nombre != null && String(nombre).trim() ? String(nombre).trim() : actual.nombre,
    username: nuevoUsername,
    rol: rol || actual.rol,
    activo: activo === undefined ? actual.activo : (activo ? 1 : 0),
    password_hash: password ? sha256(password) : actual.password_hash,
  };
  db.prepare('UPDATE usuarios SET nombre=?, username=?, rol=?, activo=?, password_hash=? WHERE id=?')
    .run(nuevo.nombre, nuevo.username, nuevo.rol, nuevo.activo, nuevo.password_hash, id);
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'editar', 'usuario', id, nuevo.nombre);
  res.json({ ok: true });
});

// Eliminar usuario (no puedes eliminarte a ti mismo).
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (req.usuario && req.usuario.id === id) {
    return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
  }
  const u = db.prepare('SELECT nombre FROM usuarios WHERE id = ?').get(id);
  const info = db.prepare('DELETE FROM usuarios WHERE id = ?').run(id);
  if (info.changes === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'eliminar', 'usuario', id, u && u.nombre);
  res.json({ ok: true });
});

module.exports = router;
