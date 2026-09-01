// scripts/crear-usuario-bot.js
// Crea (o resetea) la cuenta de servicio "bot-telegram" que usa bot-telegram.js
// para autenticarse contra la API del CRM. Rol 'usuario' (no admin): el bot
// solo llama endpoints de lectura, pero mantener el rol acotado limita el daño
// si el token/credenciales se filtraran alguna vez.
const crypto = require('crypto');
const fs = require('fs');
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '../db/crm.db'));
const envPath = path.join(__dirname, '../.env');

const username = 'bot-telegram';
const password = crypto.randomBytes(24).toString('base64url');
const hash = crypto.createHash('sha256').update(password).digest('hex');

try {
  db.prepare(`
    INSERT INTO usuarios (nombre, username, password_hash, rol, activo)
    VALUES (?, ?, ?, 'usuario', 1)
  `).run('Bot Telegram', username, hash);
  console.log('Usuario creado.');
} catch (e) {
  if (e.message.includes('UNIQUE')) {
    db.prepare(`UPDATE usuarios SET password_hash = ?, rol = 'usuario', activo = 1 WHERE username = ?`).run(hash, username);
    console.log('Usuario ya existía, password reseteado.');
  } else {
    console.error('Error:', e.message);
    process.exit(1);
  }
}
db.close();

// Escribe las credenciales directo en .env (nunca por consola, para no dejar
// la contraseña en logs/historial de terminal).
let contenido = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
const setLinea = (clave, valor) => {
  const linea = `${clave}=${valor}`;
  const re = new RegExp(`^${clave}=.*$`, 'm');
  contenido = re.test(contenido) ? contenido.replace(re, linea) : (contenido.trim() + '\n' + linea + '\n');
};
setLinea('CRM_BOT_USERNAME', username);
setLinea('CRM_BOT_PASSWORD', password);
fs.writeFileSync(envPath, contenido.trimStart());

console.log('Credenciales escritas en .env (CRM_BOT_USERNAME / CRM_BOT_PASSWORD).');
