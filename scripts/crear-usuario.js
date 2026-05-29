// scripts/crear-usuario.js
const crypto = require('crypto');
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '../db/crm.db'));

const username = 'Mauro';
const password = 'Mauro_3307.+';
const hash = crypto.createHash('sha256').update(password).digest('hex');

try {
  db.prepare(`
    INSERT INTO usuarios (nombre, username, password_hash, rol, activo)
    VALUES (?, ?, ?, 'administrador', 1)
  `).run('Mauro', username, hash);
  console.log('Usuario creado correctamente');
  console.log('Hash:', hash);
} catch (e) {
  if (e.message.includes('UNIQUE')) {
    // Ya existe, actualizar password
    db.prepare(`UPDATE usuarios SET password_hash = ?, rol = 'administrador', activo = 1 WHERE username = ?`).run(hash, username);
    console.log('Usuario actualizado correctamente');
    console.log('Hash:', hash);
  } else {
    console.error('Error:', e.message);
  }
}

db.close();
