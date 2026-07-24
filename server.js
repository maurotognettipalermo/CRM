require('dotenv').config();

// Servidor Express del CRM de alquiler vacacional.
// Arranca con: node server.js  ->  accesible en http://<IP-del-servidor>:3000
const express = require('express');
const path = require('path');
const os = require('os');

require('./db/database'); // inicializa la base de datos al arrancar

const app = express();
const PORT = process.env.PORT || 3000;

// Límite de tamaño de cuerpo más alto solo para publicar-web (fotos en base64); tiene que
// registrarse ANTES del express.json() genérico para que sea éste el que procese el body
// (body-parser no reprocesa un req.body ya parseado).
app.use('/api/ventas/propiedades/:id/publicar-web', express.json({ limit: '50mb' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Autenticación: el login es público; el resto de /api exige token válido.
const { router: authRouter, requireAuth } = require('./routes/auth');
app.use('/api/auth', authRouter);
app.use('/api', requireAuth);

// Rutas de la API (protegidas por requireAuth).
const gastos = require('./routes/gastos');
app.use('/api/apartamentos/:id/gastos', gastos.apartamentoGastos); // antes del router de apartamentos
app.use('/api/apartamentos/:id/fotos', require('./routes/fotos')); // antes del router de apartamentos
app.use('/api/apartamentos', require('./routes/apartamentos'));
app.use('/api/catalogo-gastos', gastos.catalogo);
app.use('/api/propietarios', require('./routes/propietarios'));
// Sub-recursos de reserva (pagos y extras): se montan ANTES del router de reservas para
// que /:id no capture estos prefijos.
const extras = require('./routes/catalogo-extras');
app.use('/api/reservas/:id/pagos', require('./routes/reserva-pagos'));
app.use('/api/reservas/:id/extras', extras.reservaExtras);
app.use('/api/reservas', require('./routes/reservas'));
app.use('/api/catalogo-extras', extras.catalogo);
app.use('/api/importar', require('./routes/importar'));
app.use('/api/ajustes', require('./routes/ajustes'));
app.use('/api/usuarios', require('./routes/usuarios'));
app.use('/api/portales', require('./routes/portales'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/estadisticas', require('./routes/estadisticas'));
app.use('/api/contratos', require('./routes/contratos'));
app.use('/api/facturas/:id/pagos', require('./routes/factura-pagos'));
app.use('/api/facturas', require('./routes/facturas'));
app.use('/api/tarifas', require('./routes/tarifas'));
app.use('/api/email', require('./routes/email'));
const limpieza = require('./routes/limpieza');
app.use('/api/limpieza', limpieza);
app.use('/api/mantenimiento', require('./routes/mantenimiento'));
app.use('/api/ventas/propiedades/:id/fotos', require('./routes/propiedad-fotos')); // antes del router de ventas
app.use('/api/ventas', require('./routes/ventas'));
app.use('/api/mayoristas', require('./routes/mayoristas'));
app.use('/api/personal', require('./routes/personal'));
app.use('/api/leads', require('./routes/leads'));
app.use('/api/clientes', require('./routes/clientes'));
app.use('/api/restricciones', require('./routes/restricciones'));
app.use('/api/extras', require('./routes/extras-inventario'));

// Manejador de errores genérico.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Error interno del servidor' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('==============================================');
  console.log(' CRM de Alquiler Vacacional - servidor activo');
  console.log('==============================================');
  console.log(` Local:  http://localhost:${PORT}`);
  for (const ip of ipsLocales()) {
    console.log(` Red:    http://${ip}:${PORT}   (acceso desde otros ordenadores)`);
  }
  console.log('');
  console.log(' Para detener el servidor: Ctrl + C');

  // Auto-sucio: marcar como sucios los apartamentos con checkout hoy. Una vez al
  // arrancar y luego cada hora (no se pierden checkouts si el servidor lleva días encendido).
  try { limpieza.marcarSuciosPorCheckout(); } catch (e) { console.error('Auto-sucio (arranque):', e.message); }
  setInterval(() => {
    try { limpieza.marcarSuciosPorCheckout(); } catch (e) { console.error('Auto-sucio (intervalo):', e.message); }
  }, 60 * 60 * 1000);
});

// Devuelve las direcciones IPv4 de la red local de este equipo.
function ipsLocales() {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const nombre of Object.keys(ifaces)) {
    for (const iface of ifaces[nombre]) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}
