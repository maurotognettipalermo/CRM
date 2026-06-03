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

// GET /api/estadisticas/apartamentos?anio=2026[&apartamento_id=5]
// Sin apartamento_id: ingresos agregados por apartamento durante el año (por fecha de
//   entrada, excluye canceladas y reservas sin asignar). Ordena por ingresos netos desc.
// Con apartamento_id: ese apartamento + el detalle de sus reservas del año.
// ingresos_netos = SUM(pagado). porcentaje_ocupacion = noches_ocupadas / 365 * 100.
router.get('/apartamentos', (req, res) => {
  const anio = anioParam(req);
  const aptoId = parseInt(req.query.apartamento_id, 10);

  // ---- Vista detalle: un solo apartamento + sus reservas del año ----
  if (Number.isInteger(aptoId)) {
    const apto = db.prepare(`
      SELECT
        a.id                                                             AS apartamento_id,
        a.nombre                                                         AS apartamento_nombre,
        a.tipo                                                           AS tipo,
        COUNT(r.id)                                                      AS total_reservas,
        COALESCE(SUM(r.pagado), 0)                                       AS ingresos_netos,
        CAST(ROUND(COALESCE(SUM(julianday(r.salida) - julianday(r.entrada)), 0)) AS INTEGER) AS noches_ocupadas
      FROM apartamentos a
      LEFT JOIN reservas r
        ON r.apartamento_id = a.id
        AND strftime('%Y', r.entrada) = ?
        AND (r.tipo_reserva IS NULL OR r.tipo_reserva <> 'Cancelada')
      WHERE a.id = ?
      GROUP BY a.id, a.nombre, a.tipo
    `).get(anio, aptoId);

    if (!apto) return res.status(404).json({ error: 'Apartamento no encontrado' });

    apto.porcentaje_ocupacion = Math.round((apto.noches_ocupadas / 365) * 1000) / 10;

    apto.reservas = db.prepare(`
      SELECT
        numero_reserva,
        nombre_cliente,
        entrada,
        salida,
        CAST(ROUND(julianday(salida) - julianday(entrada)) AS INTEGER)  AS noches,
        COALESCE(pagado, 0)                                             AS pagado,
        COALESCE(NULLIF(TRIM(portal), ''), 'Sin portal')               AS portal
      FROM reservas
      WHERE apartamento_id = ?
        AND strftime('%Y', entrada) = ?
        AND (tipo_reserva IS NULL OR tipo_reserva <> 'Cancelada')
      ORDER BY entrada ASC
    `).all(aptoId, anio);

    return res.json({ apartamento: apto });
  }

  // ---- Vista general: un registro por apartamento con reservas ese año ----
  const apartamentos = db.prepare(`
    SELECT
      a.id                                                             AS apartamento_id,
      a.nombre                                                         AS apartamento_nombre,
      a.tipo                                                           AS tipo,
      COUNT(r.id)                                                      AS total_reservas,
      COALESCE(SUM(r.pagado), 0)                                       AS ingresos_netos,
      CAST(ROUND(COALESCE(SUM(julianday(r.salida) - julianday(r.entrada)), 0)) AS INTEGER) AS noches_ocupadas
    FROM apartamentos a
    JOIN reservas r
      ON r.apartamento_id = a.id
      AND strftime('%Y', r.entrada) = ?
      AND (r.tipo_reserva IS NULL OR r.tipo_reserva <> 'Cancelada')
    GROUP BY a.id, a.nombre, a.tipo
    ORDER BY ingresos_netos DESC
  `).all(anio);

  apartamentos.forEach((a) => {
    a.porcentaje_ocupacion = Math.round((a.noches_ocupadas / 365) * 1000) / 10;
  });

  const totalApts = apartamentos.length;
  const ingresosTotal = apartamentos.reduce((s, a) => s + (Number(a.ingresos_netos) || 0), 0);
  const resumen = {
    total_apartamentos_con_reservas: totalApts,
    ingresos_netos_total: ingresosTotal,
    media_ingresos_por_apartamento: totalApts > 0 ? Math.round((ingresosTotal / totalApts) * 100) / 100 : 0,
  };

  res.json({ apartamentos, resumen });
});

// GET /api/estadisticas/ocupacion?anio=2026
// Ocupación del año: % por mes (noches ocupadas / noches disponibles), comparativa por TIH
// y un resumen global. Noches ocupadas = solape de cada reserva con el periodo (clamp a
// inicio/fin). Noches disponibles = nº de apartamentos × días del periodo. Excluye
// canceladas y reservas sin asignar.
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

router.get('/ocupacion', (req, res) => {
  const anio = parseInt(anioParam(req), 10);
  const pad2 = (n) => String(n).padStart(2, '0');
  const diasMes = (m) => new Date(anio, m, 0).getDate(); // m: 1-12
  const bisiesto = (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
  const diasAnio = bisiesto ? 366 : 365;

  const totalApts = db.prepare('SELECT COUNT(*) AS n FROM apartamentos').get().n;
  const aptsTih = (t) => db.prepare('SELECT COUNT(*) AS n FROM apartamentos WHERE tipo = ?').get(t).n;

  // Suma de noches ocupadas (solape con [@inicio, @fin)) de reservas asignadas no canceladas.
  const stmtSolape = db.prepare(`
    SELECT COALESCE(SUM(
      julianday(MIN(salida, @fin)) - julianday(MAX(entrada, @inicio))
    ), 0) AS noches
    FROM reservas
    WHERE apartamento_id IS NOT NULL
      AND entrada < @fin AND salida > @inicio
      AND (tipo_reserva IS NULL OR tipo_reserva <> 'Cancelada')
  `);

  // Igual pero filtrando por TIH del apartamento.
  const stmtSolapeTih = db.prepare(`
    SELECT COALESCE(SUM(
      julianday(MIN(r.salida, @fin)) - julianday(MAX(r.entrada, @inicio))
    ), 0) AS noches
    FROM reservas r
    JOIN apartamentos a ON a.id = r.apartamento_id
    WHERE a.tipo = @tipo
      AND r.entrada < @fin AND r.salida > @inicio
      AND (r.tipo_reserva IS NULL OR r.tipo_reserva <> 'Cancelada')
  `);

  // ---- Por mes ----
  const por_mes = [];
  let totalNoches = 0;
  for (let m = 1; m <= 12; m++) {
    const inicio = `${anio}-${pad2(m)}-01`;
    const fin = m === 12 ? `${anio + 1}-01-01` : `${anio}-${pad2(m + 1)}-01`;
    const noches = Math.round(stmtSolape.get({ inicio, fin }).noches);
    const disponibles = totalApts * diasMes(m);
    const porcentaje = disponibles > 0 ? Math.round((noches / disponibles) * 1000) / 10 : 0;
    totalNoches += noches;
    por_mes.push({ mes: m, nombre_mes: MESES[m - 1], noches_ocupadas: noches, noches_disponibles: disponibles, porcentaje });
  }

  // ---- Por TIH (sobre el año completo) ----
  const inicioAnio = `${anio}-01-01`;
  const finAnio = `${anio + 1}-01-01`;
  const tihStats = (tipo) => {
    const n = aptsTih(tipo);
    const noches = Math.round(stmtSolapeTih.get({ inicio: inicioAnio, fin: finAnio, tipo }).noches);
    const media = n > 0 ? Math.round((noches / (n * diasAnio)) * 1000) / 10 : 0;
    return { total_apartamentos: n, media_ocupacion: media, noches_ocupadas: noches };
  };

  // ---- Resumen ----
  const mesTop = por_mes.reduce((a, b) => (b.porcentaje > a.porcentaje ? b : a), por_mes[0]);
  const resumen = {
    total_apartamentos: totalApts,
    media_ocupacion_anual: totalApts > 0 ? Math.round((totalNoches / (totalApts * diasAnio)) * 1000) / 10 : 0,
    mes_mas_ocupado: totalNoches > 0 ? mesTop.nombre_mes : '—',
    total_noches_ocupadas: totalNoches,
  };

  res.json({
    resumen,
    por_mes,
    por_tih: { primera_linea: tihStats('1'), segunda_linea: tihStats('2') },
  });
});

module.exports = router;
