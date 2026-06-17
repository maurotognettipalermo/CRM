// Configuración de PM2 para el CRM en producción (Hetzner VPS).
// Uso: pm2 start deploy/ecosystem.config.js   (desde /home/crm/crm-app)
//      pm2 save && pm2 startup   (para que arranque al reiniciar el servidor)
//
// SQLite (better-sqlite3) NO soporta escrituras concurrentes desde varios
// procesos → una sola instancia (NADA de modo cluster).
module.exports = {
  apps: [
    {
      name: 'crm',
      script: 'server.js',
      cwd: '/home/crm/crm-app',

      instances: 1,
      exec_mode: 'fork',

      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },

      autorestart: true,
      max_restarts: 10,
      max_memory_restart: '512M',

      // Logs con fecha en cada línea.
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/home/crm/logs/crm-error.log',
      out_file: '/home/crm/logs/crm-out.log',
      merge_logs: true,
    },
  ],
};
