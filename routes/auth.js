// Autenticación: login, logout y middleware de validación de token.
// Token simple = sha256(username + password + fecha). Se guarda en usuarios.token
// al hacer login y se valida en cada llamada a /api/* (header X-Auth-Token).
const express = require('express');
const crypto = require('crypto');
const db = require('../db/database');
const { registrarActividad } = require('../services/actividadService');

const router = express.Router();
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

// Middleware: exige un token válido y adjunta req.usuario = { id, nombre, username, rol }.
function requireAuth(req, res, next) {
  const token = req.get('X-Auth-Token');
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  const u = db
    .prepare('SELECT id, nombre, username, rol FROM usuarios WHERE token = ? AND activo = 1')
    .get(token);
  if (!u) return res.status(401).json({ error: 'Sesión no válida o expirada' });
  req.usuario = { id: u.id, nombre: u.nombre, username: u.username, rol: u.rol };
  next();
}

// POST /api/auth/login -> { username, password } -> { ok, token, userId, username, nombre, rol }
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.json({ ok: false, error: 'Usuario y contraseña son obligatorios' });
  }
  const u = db.prepare('SELECT * FROM usuarios WHERE username = ?').get(String(username).trim());
  if (!u || !u.activo || u.password_hash !== sha256(password)) {
    return res.json({ ok: false, error: 'Usuario o contraseña incorrectos' });
  }
  const token = sha256(u.username + password + new Date().toISOString());
  db.prepare("UPDATE usuarios SET token = ?, ultimo_acceso = datetime('now') WHERE id = ?").run(token, u.id);
  registrarActividad(db, u.id, u.nombre, 'login', 'usuario', u.id, u.username);
  res.json({ ok: true, token, userId: u.id, username: u.username, nombre: u.nombre, rol: u.rol });
});

// POST /api/auth/logout -> limpia el token de la sesión actual.
router.post('/logout', (req, res) => {
  const token = req.get('X-Auth-Token');
  if (token) {
    const u = db.prepare('SELECT id, nombre FROM usuarios WHERE token = ?').get(token);
    if (u) {
      db.prepare('UPDATE usuarios SET token = NULL WHERE id = ?').run(u.id);
      registrarActividad(db, u.id, u.nombre, 'logout', 'usuario', u.id, null);
    }
  }
  res.json({ ok: true });
});

module.exports = { router, requireAuth };
