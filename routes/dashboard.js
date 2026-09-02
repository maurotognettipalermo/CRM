// API REST del dashboard: agrega en una sola llamada los datos de la pantalla de inicio.
const express = require('express');
const db = require('../db/database');

const router = express.Router();

// Campos comunes que devuelven las listas de reservas (con el nombre del apartamento).
const CAMPOS = `
  r.id, r.numero_reserva, r.nombre_cliente, a.nombre AS apartamento_nombre,
  r.entrada, r.salida, r.hora_entrada, r.hora_salida,
  r.checkin_estado, r.checkout_estado, r.portal, r.personas
`;

// Fecha ISO (YYYY-MM-DD) en hora local del servidor.
function isoLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/dashboard -> todos los datos del dashboard en una sola respuesta.
// ?checkin_fecha= / ?checkout_fecha= (YYYY-MM-DD): día a mostrar en cada ficha
// (Hoy/Mañana/personalizado desde el frontend); por defecto, hoy.
router.get('/', (req, res) => {
  const hoy = new Date();
  const hoyISO = isoLocal(hoy);
  const checkinFecha = FECHA_RE.test(req.query.checkin_fecha) ? req.query.checkin_fecha : hoyISO;
  const checkoutFecha = FECHA_RE.test(req.query.checkout_fecha) ? req.query.checkout_fecha : hoyISO;

  // Reservas que entran el día elegido (sin LIMIT: es un día concreto, no un rango).
  const proximos_checkin = db.prepare(`
    SELECT ${CAMPOS}
    FROM reservas r LEFT JOIN apartamentos a ON a.id = r.apartamento_id
    WHERE r.entrada = ?
    ORDER BY r.hora_entrada ASC, r.id ASC
  `).all(checkinFecha);

  // Reservas que salen el día elegido.
  const proximos_checkout = db.prepare(`
    SELECT ${CAMPOS}
    FROM reservas r LEFT JOIN apartamentos a ON a.id = r.apartamento_id
    WHERE r.salida = ?
    ORDER BY r.hora_salida ASC, r.id ASC
  `).all(checkoutFecha);

  // Visitas de venta programadas de hoy al fin de mes, ordenadas por fecha más próxima.
  const finMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
  const finMesISO = isoLocal(finMes);
  const visitas_mes = db.prepare(`
    SELECT v.id, v.fecha, v.hora, v.estado,
           c.nombre AS cliente_nombre, c.apellidos AS cliente_apellidos,
           p.referencia AS propiedad_referencia, p.calle AS propiedad_calle
    FROM visitas_venta v
    JOIN clientes_compradores c ON c.id = v.cliente_id
    JOIN propiedades_venta p ON p.id = v.propiedad_id
    WHERE v.fecha >= ? AND v.fecha <= ? AND v.estado = 'Programada'
    ORDER BY v.fecha ASC, v.hora ASC
    LIMIT 50
  `).all(hoyISO, finMesISO);

  // Reservas creadas en los últimos 7 días (fecha_creacion se guarda en UTC).
  const entrantes = db.prepare(`
    SELECT COUNT(*) AS count
    FROM reservas
    WHERE fecha_creacion >= datetime('now', '-7 days')
  `).get();

  res.json({
    proximos_checkin,
    visitas_mes,
    reservas_entrantes: { count: entrantes.count },
    proximos_checkout,
  });
});

module.exports = router;
