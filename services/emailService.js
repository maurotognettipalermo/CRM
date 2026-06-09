// Servicio de envío de email por SMTP (nodemailer). La configuración SMTP vive en la
// tabla clave-valor `ajustes` (claves smtp_*); se gestiona desde Ajustes.
const nodemailer = require('nodemailer');

// Valores por defecto de la configuración SMTP (se usan si la clave no está en `ajustes`).
const SMTP_DEFAULTS = {
  smtp_host: 'smtp.gmail.com',
  smtp_port: '587',
  smtp_user: '',
  smtp_password: '',
  smtp_from_name: 'Inmobiliaria',
  smtp_from_email: '',
};

// Lee una clave de la tabla ajustes; devuelve el default si no existe.
function leerAjuste(db, clave) {
  const fila = db.prepare('SELECT valor FROM ajustes WHERE clave = ?').get(clave);
  if (fila && fila.valor != null) return fila.valor;
  return SMTP_DEFAULTS[clave] != null ? SMTP_DEFAULTS[clave] : '';
}

// Devuelve toda la configuración SMTP como objeto (con defaults aplicados).
function leerConfigSmtp(db) {
  const cfg = {};
  for (const clave of Object.keys(SMTP_DEFAULTS)) cfg[clave] = leerAjuste(db, clave);
  return cfg;
}

// Crea el transporter de nodemailer a partir de la configuración guardada.
function getTransporter(db) {
  const cfg = leerConfigSmtp(db);
  const port = parseInt(cfg.smtp_port, 10) || 587;
  return nodemailer.createTransport({
    host: cfg.smtp_host,
    port,
    secure: port === 465, // 465 = SSL implícito; 587 = STARTTLS
    auth: { user: cfg.smtp_user, pass: cfg.smtp_password },
  });
}

// Envía un email. attachments: [{ filename, path }] (rutas absolutas) o con cid para inline.
async function enviarEmail(db, { to, subject, html, attachments }) {
  const transporter = getTransporter(db);
  const smtp_from_name = leerAjuste(db, 'smtp_from_name') || 'CRM';
  // El remitente debe ser el email configurado; si no hay, cae al usuario SMTP.
  const smtp_from_email = leerAjuste(db, 'smtp_from_email') || leerAjuste(db, 'smtp_user');
  return transporter.sendMail({
    from: `"${smtp_from_name}" <${smtp_from_email}>`,
    to,
    subject,
    html,
    attachments,
  });
}

module.exports = { enviarEmail, getTransporter, leerConfigSmtp, leerAjuste, SMTP_DEFAULTS };
