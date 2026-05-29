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

  // Pagos pendientes: total del campo `pendiente` y nº de reservas con saldo > 0.
  // Se excluyen las canceladas.
  const pagos = db.prepare(`
    SELECT COALESCE(SUM(pendiente), 0) AS total,
           COUNT(CASE WHEN pendiente > 0 THEN 1 END) AS count
    FROM reservas
    WHERE tipo_reserva IS NULL OR tipo_reserva <> 'Cancelada'
  `).get();

  // Reservas creadas en los últimos 7 días (fecha_creacion se guarda en UTC).
  const entrantes = db.prepare(`
    SELECT COUNT(*) AS count
    FROM reservas
    WHERE fecha_creacion >= datetime('now', '-7 days')
  `).get();

  res.json({
    proximos_checkin,
    reservas_en_curso,
    pagos_pendientes: { total: pagos.total, count: pagos.count },
    reservas_entrantes: { count: entrantes.count },
    proximos_checkout,
  });
});

module.exports = router;
