// API REST de Estadísticas (solo accesible bajo requireAuth; la pestaña es admin-only
// en el frontend). Agrega datos de reservas por distintos criterios para los informes.
const express = require('express');
const db = require('../db/database');

const router = express.Router();

// Año válido (4 dígitos) a partir del query; por defecto, el año actual.
function anioParam(req) {
  const n = parseInt(req.query.anio, 10);
  return String(n >= 1900 && n <= 9999 ? n : new Date().getFullYear());
}

// GET /api/estadisticas/portales?anio=2026
// Ingresos agregados por portal de venta durante el año indicado (por fecha de entrada).
// Se excluyen las reservas canceladas. Ordena por ingresos brutos desc.
router.get('/portales', (req, res) => {
  const anio = anioParam(req);

  // Una fila por portal. LEFT JOIN con `portales` (por nombre) para color/logo.
  // El portal vacío o NULL se agrupa como 'Sin portal' (sin color ni logo).
  const portales = db.prepare(`
    SELECT
      COALESCE(NULLIF(TRIM(r.portal), ''), 'Sin portal')              AS portal,
      p.color                                                          AS color,
      p.imagen_url                                                     AS imagen_url,
      COUNT(*)                                                         AS total_reservas,
      COALESCE(SUM(r.precio_total), 0)                                 AS ingresos_brutos,
      COALESCE(SUM(r.pagado), 0)                                       AS ingresos_cobrados,
      COALESCE(SUM(r.pendiente), 0)                                    AS pendiente_cobro,
      CAST(ROUND(COALESCE(SUM(julianday(r.salida) - julianday(r.entrada)), 0)) AS INTEGER) AS noches_totales
    FROM reservas r
    LEFT JOIN portales p ON p.nombre = r.portal
    WHERE strftime('%Y', r.entrada) = ?
      AND (r.tipo_reserva IS NULL OR r.tipo_reserva <> 'Cancelada')
    GROUP BY COALESCE(NULLIF(TRIM(r.portal), ''), 'Sin portal'), p.color, p.imagen_url
    ORDER BY ingresos_brutos DESC
  `).all(anio);

  // Totales del año (mismo filtro, sin agrupar).
  const resumen = db.prepare(`
    SELECT
      COUNT(*)                          AS total_reservas,
      COALESCE(SUM(precio_total), 0)    AS ingresos_brutos,
      COALESCE(SUM(pagado), 0)          AS ingresos_cobrados,
      COALESCE(SUM(pendiente), 0)       AS pendiente_cobro
    FROM reservas
    WHERE strftime('%Y', entrada) = ?
      AND (tipo_reserva IS NULL OR tipo_reserva <> 'Cancelada')
  `).get(anio);

  res.json({ portales, resumen });
});

module.exports = router;
