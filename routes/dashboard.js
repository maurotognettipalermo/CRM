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

// GET /api/dashboard -> todos los datos del dashboard en una sola respuesta.
router.get('/', (req, res) => {
  const hoy = new Date();
  const hoyISO = isoLocal(hoy);
  const mas7 = new Date(hoy);
  mas7.setDate(mas7.getDate() + 7);
  const hoy7ISO = isoLocal(mas7);

  // Reservas que entran entre hoy y hoy+7 días.
  const proximos_checkin = db.prepare(`
    SELECT ${CAMPOS}
    FROM reservas r LEFT JOIN apartamentos a ON a.id = r.apartamento_id
    WHERE r.entrada >= ? AND r.entrada <= ?
    ORDER BY r.entrada ASC
    LIMIT 50
  `).all(hoyISO, hoy7ISO);

  // Reservas que salen entre hoy y hoy+7 días.
  const proximos_checkout = db.prepare(`
    SELECT ${CAMPOS}
    FROM reservas r LEFT JOIN apartamentos a ON a.id = r.apartamento_id
    WHERE r.salida >= ? AND r.salida <= ?
    ORDER BY r.salida ASC
    LIMIT 50
  `).all(hoyISO, hoy7ISO);

  // Reservas en curso: ya entraron y todavía no han salido.
  const reservas_en_curso = db.prepare(`
    SELECT ${CAMPOS}
    FROM reservas r LEFT JOIN apartamentos a ON a.id = r.apartamento_id
    WHERE r.entrada <= ? AND r.salida >= ?
    ORDER BY r.entrada ASC
    LIMIT 50
  `).all(hoyISO, hoyISO);

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
    reservas_en_curso,
    visitas_mes,
    reservas_entrantes: { count: entrantes.count },
    proximos_checkout,
  });
});

module.exports = router;
