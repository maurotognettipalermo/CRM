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
// Si el portal tiene mayorista_id vinculado, el ingreso se toma del importe_total del
// contrato de ese mayorista en el año (no de las reservas).
router.get('/portales', (req, res) => {
  const anio = anioParam(req);

  // Una fila por portal. LEFT JOIN con `portales` (por nombre) para color/logo/mayorista_id.
  // El portal vacío o NULL se agrupa como 'Sin portal' (sin color ni logo).
  const portales = db.prepare(`
    SELECT
      COALESCE(NULLIF(TRIM(r.portal), ''), 'Sin portal')              AS portal,
      p.color                                                          AS color,
      p.imagen_url                                                     AS imagen_url,
      p.mayorista_id                                                   AS mayorista_id,
      COALESCE(p.comision_porcentaje, 0)                               AS comision_porcentaje,
      COUNT(*)                                                         AS total_reservas,
      COALESCE(SUM(r.precio_total), 0)                                 AS ingresos_brutos,
      COALESCE(SUM(r.pagado), 0)                                       AS ingresos_cobrados,
      COALESCE(SUM(r.pendiente), 0)                                    AS pendiente_cobro,
      CAST(ROUND(COALESCE(SUM(julianday(r.salida) - julianday(r.entrada)), 0)) AS INTEGER) AS noches_totales
    FROM reservas r
    LEFT JOIN portales p ON p.nombre = r.portal
    WHERE strftime('%Y', r.entrada) = ?
      AND (r.tipo_reserva IS NULL OR r.tipo_reserva <> 'Cancelada')
    GROUP BY COALESCE(NULLIF(TRIM(r.portal), ''), 'Sin portal'), p.color, p.imagen_url, p.mayorista_id, p.comision_porcentaje
    ORDER BY ingresos_brutos DESC
  `).all(anio);

  // Consulta del importe_total del contrato anual de un mayorista.
  const stmtContrato = db.prepare(`
    SELECT importe_total
    FROM mayorista_contratos
    WHERE mayorista_id = ? AND anio = ? AND estado <> 'cancelado'
  `);

  // Para portales con mayorista_id vinculado, sustituir ingresos por el importe comprometido.
  const anioInt = parseInt(anio, 10);
  for (const p of portales) {
    if (p.mayorista_id) {
      p.es_mayorista = true;
      const contrato = stmtContrato.get(p.mayorista_id, anioInt);
      if (contrato) {
        p.tiene_contrato    = true;
        p.ingresos_brutos   = contrato.importe_total;
        p.ingresos_netos    = contrato.importe_total; // precio cerrado ya es neto, sin comisión adicional
        p.ingresos_cobrados = contrato.importe_total;
        p.pendiente_cobro   = 0;
      } else {
        p.tiene_contrato    = false;
        p.ingresos_brutos   = 0;
        p.ingresos_netos    = 0;
        p.ingresos_cobrados = 0;
        p.pendiente_cobro   = 0;
      }
    } else {
      p.es_mayorista = false;
      const comision = Number(p.comision_porcentaje) || 0;
      p.ingresos_netos = Number(p.ingresos_brutos) * (1 - comision / 100);
    }
  }

  // Re-ordenar por ingresos_netos y recalcular resumen en JS.
  portales.sort((a, b) => (Number(b.ingresos_netos) || 0) - (Number(a.ingresos_netos) || 0));

  const resumen = {
    total_reservas:  portales.reduce((s, p) => s + (Number(p.total_reservas) || 0), 0),
    ingresos_brutos: portales.reduce((s, p) => s + (Number(p.ingresos_brutos) || 0), 0),
    ingresos_netos:  portales.reduce((s, p) => s + (Number(p.ingresos_netos) || 0), 0),
  };

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

  // ---- Por tipo de clasificación (tipo_clasificacion: A/A+/A++/B/B+/C, o "Sin clasificar") ----
  const stmtAptsPorTipo = db.prepare('SELECT COUNT(*) AS n FROM apartamentos WHERE tipo_clasificacion = ?');
  const stmtAptsSinClasificar = db.prepare("SELECT COUNT(*) AS n FROM apartamentos WHERE tipo_clasificacion IS NULL OR tipo_clasificacion = ''");

  // Igual que stmtSolape pero filtrando por tipo_clasificacion del apartamento.
  const stmtSolapePorTipo = db.prepare(`
    SELECT COALESCE(SUM(
      julianday(MIN(r.salida, @fin)) - julianday(MAX(r.entrada, @inicio))
    ), 0) AS noches
    FROM reservas r
    JOIN apartamentos a ON a.id = r.apartamento_id
    WHERE a.tipo_clasificacion = @tipo
      AND r.entrada < @fin AND r.salida > @inicio
      AND (r.tipo_reserva IS NULL OR r.tipo_reserva <> 'Cancelada')
  `);
  const stmtSolapeSinClasificar = db.prepare(`
    SELECT COALESCE(SUM(
      julianday(MIN(r.salida, @fin)) - julianday(MAX(r.entrada, @inicio))
    ), 0) AS noches
    FROM reservas r
    JOIN apartamentos a ON a.id = r.apartamento_id
    WHERE (a.tipo_clasificacion IS NULL OR a.tipo_clasificacion = '')
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

  // ---- Por tipo de clasificación (sobre el año completo) ----
  const inicioAnio = `${anio}-01-01`;
  const finAnio = `${anio + 1}-01-01`;
  // tipo === null representa "Sin clasificar" (tipo_clasificacion vacío/NULL).
  const statsTipo = (tipo) => {
    const n = tipo === null ? stmtAptsSinClasificar.get().n : stmtAptsPorTipo.get(tipo).n;
    const solape = tipo === null
      ? stmtSolapeSinClasificar.get({ inicio: inicioAnio, fin: finAnio })
      : stmtSolapePorTipo.get({ inicio: inicioAnio, fin: finAnio, tipo });
    const noches = Math.round(solape.noches);
    const media = n > 0 ? Math.round((noches / (n * diasAnio)) * 1000) / 10 : 0;
    return { tipo: tipo === null ? 'Sin clasificar' : tipo, total_apartamentos: n, media_ocupacion: media, noches_ocupadas: noches };
  };

  // Orden canónico de clasificaciones (igual que CLASIFICACIONES en alojamientos.js); un
  // valor que no esté en la lista se ordena al final, antes de "Sin clasificar".
  const ORDEN_CLASIFICACIONES = ['A', 'A+', 'A++', 'B', 'B+', 'C'];
  const tiposReales = db.prepare(
    "SELECT DISTINCT tipo_clasificacion AS t FROM apartamentos WHERE tipo_clasificacion IS NOT NULL AND tipo_clasificacion <> ''"
  ).all().map((r) => r.t);
  tiposReales.sort((a, b) => {
    const ia = ORDEN_CLASIFICACIONES.indexOf(a);
    const ib = ORDEN_CLASIFICACIONES.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  const por_tipo = tiposReales.map(statsTipo);
  if (stmtAptsSinClasificar.get().n > 0) por_tipo.push(statsTipo(null));

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
    por_tipo,
  });
});

// GET /api/estadisticas/propietarios?anio=2026
// Compromiso de pago por propietario según sus contratos de **precio_cerrado** del año
// (los de comisión no tienen cuotas fijas, se excluyen). Se excluyen los cancelados.
// Comprometido = SUM(precio_total); pagado/pendiente = SUM(importe de cuotas según `pagado`).
// Ordena por total_pendiente DESC (primero a quien más se debe).
router.get('/propietarios', (req, res) => {
  const anio = parseInt(anioParam(req), 10);
  const FILTRO = "c.tipo = 'precio_cerrado' AND c.anio = ? AND c.estado <> 'cancelado'";

  // Una fila por propietario. Las cuotas se agregan en una subconsulta por contrato para no
  // duplicar precio_total al hacer JOIN con las cuotas.
  const por_propietario = db.prepare(`
    SELECT
      p.id                                                              AS propietario_id,
      TRIM(COALESCE(p.nombre, '') || ' ' || COALESCE(p.apellidos, '')) AS propietario_nombre,
      COUNT(c.id)                                                       AS contratos,
      COALESCE(SUM(c.precio_total), 0)                                  AS total_comprometido,
      COALESCE(SUM(cu.pagado_sum), 0)                                   AS total_pagado,
      COALESCE(SUM(cu.pendiente_sum), 0)                                AS total_pendiente
    FROM contratos c
    JOIN propietarios p ON p.id = c.propietario_id
    LEFT JOIN (
      SELECT contrato_id,
        SUM(CASE WHEN pagado = 1 THEN importe ELSE 0 END) AS pagado_sum,
        SUM(CASE WHEN pagado = 0 THEN importe ELSE 0 END) AS pendiente_sum
      FROM contrato_cuotas GROUP BY contrato_id
    ) cu ON cu.contrato_id = c.id
    WHERE ${FILTRO}
    GROUP BY p.id, propietario_nombre
    ORDER BY total_pendiente DESC
  `).all(anio);

  // Próxima cuota sin pagar (a partir de hoy) por propietario: la fecha_prevista más próxima.
  const proximas = db.prepare(`
    SELECT c.propietario_id AS pid, cu.fecha_prevista AS fecha, cu.importe AS importe
    FROM contrato_cuotas cu
    JOIN contratos c ON c.id = cu.contrato_id
    WHERE ${FILTRO}
      AND cu.pagado = 0 AND cu.fecha_prevista >= date('now')
    ORDER BY cu.fecha_prevista ASC
  `).all(anio);
  const mapProx = {};
  for (const r of proximas) {
    if (!(r.pid in mapProx)) mapProx[r.pid] = { fecha: r.fecha, importe: r.importe };
  }
  por_propietario.forEach((p) => {
    const pr = mapProx[p.propietario_id];
    p.proxima_cuota_fecha = pr ? pr.fecha : null;
    p.proxima_cuota_importe = pr ? pr.importe : null;
  });

  // Totales globales (calculados aparte para no depender del JOIN con propietarios).
  const totC = db.prepare(`
    SELECT COUNT(*) AS contratos_activos, COALESCE(SUM(precio_total), 0) AS total_comprometido
    FROM contratos c WHERE ${FILTRO}
  `).get(anio);
  const totCuotas = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN cu.pagado = 1 THEN cu.importe ELSE 0 END), 0) AS total_pagado,
      COALESCE(SUM(CASE WHEN cu.pagado = 0 THEN cu.importe ELSE 0 END), 0) AS total_pendiente
    FROM contrato_cuotas cu
    JOIN contratos c ON c.id = cu.contrato_id
    WHERE ${FILTRO}
  `).get(anio);
  const totProp = db.prepare(`
    SELECT COUNT(DISTINCT propietario_id) AS n
    FROM contratos c WHERE ${FILTRO} AND propietario_id IS NOT NULL
  `).get(anio);

  res.json({
    resumen: {
      total_propietarios_con_contrato: totProp.n,
      total_comprometido: totC.total_comprometido,
      total_pagado: totCuotas.total_pagado,
      total_pendiente: totCuotas.total_pendiente,
      contratos_activos: totC.contratos_activos,
    },
    por_propietario,
  });
});

module.exports = router;
