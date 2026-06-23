// API REST de contratos de gestión con el propietario y sus cuotas de pago.
// Dos tipos: 'precio_cerrado' (importe garantizado total repartido en cuotas) y
// 'comision' (% sobre el precio de cada reserva). Montado bajo requireAuth, así que
// req.usuario = { id, nombre, username, rol } está disponible.
const express = require('express');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const db = require('../db/database');
const { registrarActividad } = require('../services/actividadService');

const router = express.Router();

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MM = 2.83465; // 1 mm en puntos PDF
const MESES_PDF = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// Lee una variable de plantilla (tabla clave-valor `ajustes`); si falta o está vacía, el default.
function plantilla(clave, def) {
  const r = db.prepare('SELECT valor FROM ajustes WHERE clave = ?').get(clave);
  return (r && r.valor != null && r.valor !== '') ? r.valor : (def || '');
}

const TIPOS = ['precio_cerrado', 'comision'];
const ESTADOS = ['activo', 'finalizado', 'cancelado'];

// --- Helpers de coerción (better-sqlite3 lanza al hacer bind de undefined) ---
function num(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}
function intOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}
function txt(v) {
  return v === undefined || v === null ? null : String(v);
}

// Regenera las reservas automáticas de un contrato: bloqueos fuera de la temporada
// y reservas "De propietario" por cada fecha de uso. Idempotente: borra primero las
// reservas que este contrato hubiera generado (contrato_origen_id o nº BLQ-/PROP-).
function generarBloqueosContrato(db, contratoId) {
  const c = db.prepare(
    'SELECT id, apartamento_id, temporada_inicio, temporada_fin, anio FROM contratos WHERE id = ?'
  ).get(contratoId);
  if (!c || c.apartamento_id == null) return;

  const fechasProp = db.prepare(
    'SELECT * FROM contrato_fechas_propietario WHERE contrato_id = ? ORDER BY fecha_inicio'
  ).all(contratoId);

  const gen = db.transaction(() => {
    // Limpia las reservas auto-generadas previas de este contrato (incluye legado por nº).
    db.prepare(
      'DELETE FROM reservas WHERE contrato_origen_id = ? OR numero_reserva LIKE ? OR numero_reserva LIKE ?'
    ).run(contratoId, `BLQ-${contratoId}-%`, `PROP-${contratoId}-%`);

    const ins = db.prepare(`
      INSERT INTO reservas
        (numero_reserva, nombre_cliente, apartamento_id, entrada, salida, tipo_reserva, contrato_origen_id, observaciones)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const inicioAnio = `${c.anio}-01-01`;
    const finAnio = `${c.anio}-12-31`;
    let n = 0;
    if (c.temporada_inicio > inicioAnio) {
      n++;
      ins.run(`BLQ-${contratoId}-${n}`, 'BLOQUEADO', c.apartamento_id, inicioAnio, c.temporada_inicio,
        'Bloqueado', contratoId, 'Bloqueo automático fuera de contrato');
    }
    if (c.temporada_fin < finAnio) {
      n++;
      ins.run(`BLQ-${contratoId}-${n}`, 'BLOQUEADO', c.apartamento_id, c.temporada_fin, finAnio,
        'Bloqueado', contratoId, 'Bloqueo automático fuera de contrato');
    }
    let m = 0;
    for (const fp of fechasProp) {
      m++;
      ins.run(`PROP-${contratoId}-${m}`, 'USO PROPIETARIO', c.apartamento_id, fp.fecha_inicio, fp.fecha_fin,
        'De propietario', contratoId, fp.motivo || 'Uso del propietario');
    }
  });
  gen();
}

// Valida el cuerpo de un contrato (POST/PUT). Devuelve { error } o { ok, datos, cuotas }.
function validarContrato(body) {
  const b = body || {};

  const apartamento_id = intOrNull(b.apartamento_id);
  if (apartamento_id === null) return { error: 'El apartamento es obligatorio' };
  const apto = db.prepare('SELECT id FROM apartamentos WHERE id = ?').get(apartamento_id);
  if (!apto) return { error: 'El apartamento indicado no existe' };

  const tipo = String(b.tipo || '');
  if (!TIPOS.includes(tipo)) return { error: "Tipo inválido (precio_cerrado o comision)" };

  const temporada_inicio = String(b.temporada_inicio || '').trim();
  const temporada_fin = String(b.temporada_fin || '').trim();
  if (!temporada_inicio || !temporada_fin) {
    return { error: 'Las fechas de temporada son obligatorias' };
  }
  if (!(temporada_inicio < temporada_fin)) {
    return { error: 'La fecha de inicio debe ser anterior a la de fin' };
  }

  // Año: el del body o, en su defecto, el de la fecha de inicio.
  let anio = intOrNull(b.anio);
  if (anio === null) anio = parseInt(temporada_inicio.slice(0, 4), 10);
  if (!anio || isNaN(anio)) return { error: 'El año del contrato es obligatorio' };

  const estado = ESTADOS.includes(b.estado) ? b.estado : 'activo';
  const precio_total = num(b.precio_total);
  const porcentaje_comision = num(b.porcentaje_comision);

  // Fiscalidad (solo aplica de cara al cálculo en precio_cerrado, pero se guarda siempre).
  const aplica_iva = (b.aplica_iva === undefined || b.aplica_iva === null) ? 1 : (b.aplica_iva ? 1 : 0);
  const RETENCIONES_VALIDAS = [0, 19, 24];
  let porcentaje_retencion = num(b.porcentaje_retencion);
  if (!RETENCIONES_VALIDAS.includes(porcentaje_retencion)) porcentaje_retencion = 19;

  // Normaliza las cuotas.
  const cuotasIn = Array.isArray(b.cuotas) ? b.cuotas : [];
  const cuotas = cuotasIn.map((c, i) => ({
    numero_cuota: intOrNull(c.numero_cuota) != null ? intOrNull(c.numero_cuota) : i + 1,
    fecha_prevista: String(c.fecha_prevista || '').trim(),
    importe: num(c.importe),
    // pagado/fecha_pago son opcionales (permiten conservar el estado al reemplazar en PUT).
    pagado: c.pagado ? 1 : 0,
    fecha_pago: txt(c.fecha_pago),
    notas: txt(c.notas),
  }));

  for (const c of cuotas) {
    if (!c.fecha_prevista) return { error: 'Cada cuota necesita una fecha prevista' };
  }

  // En precio cerrado, la suma de cuotas debe cuadrar con el importe garantizado.
  if (tipo === 'precio_cerrado') {
    const suma = cuotas.reduce((s, c) => s + c.importe, 0);
    if (Math.abs(suma - precio_total) > 0.01) {
      return { error: `La suma de las cuotas (${suma.toFixed(2)} €) no coincide con el precio total (${precio_total.toFixed(2)} €)` };
    }
  }

  // Propietario: si no llega, se autorrellena con el propietario ACTIVO del apartamento
  // (relación N:M). Con varios activos hay que especificarlo; sin ninguno queda null.
  let propietario_id = intOrNull(b.propietario_id);
  if (propietario_id === null) {
    const activos = db.prepare(
      `SELECT propietario_id FROM apartamento_propietarios
       WHERE apartamento_id = ? AND activo = 1
       ORDER BY porcentaje DESC, fecha_inicio ASC`
    ).all(apartamento_id);
    if (activos.length === 1) propietario_id = activos[0].propietario_id;
    else if (activos.length > 1) {
      return { error: 'El apartamento tiene varios propietarios activos: especifica el propietario del contrato' };
    }
  }

  return {
    ok: true,
    datos: {
      apartamento_id,
      propietario_id,
      tipo,
      temporada_inicio,
      temporada_fin,
      anio,
      precio_total,
      porcentaje_comision,
      aplica_iva,
      porcentaje_retencion,
      estado,
      notas: txt(b.notas),
    },
    cuotas,
  };
}

// GET /api/contratos?anio=&apartamento_id=&propietario_id=
// Lista con nombre de apartamento y de propietario. Filtros opcionales.
router.get('/', (req, res) => {
  const cond = [];
  const params = [];
  const anio = intOrNull(req.query.anio);
  const apartamentoId = intOrNull(req.query.apartamento_id);
  const propietarioId = intOrNull(req.query.propietario_id);
  if (anio !== null) { cond.push('c.anio = ?'); params.push(anio); }
  if (apartamentoId !== null) { cond.push('c.apartamento_id = ?'); params.push(apartamentoId); }
  if (propietarioId !== null) { cond.push('c.propietario_id = ?'); params.push(propietarioId); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';

  const filas = db.prepare(`
    SELECT
      c.*,
      a.nombre                                              AS apartamento_nombre,
      p.nombre                                              AS propietario_nombre,
      p.apellidos                                           AS propietario_apellidos
    FROM contratos c
    JOIN apartamentos a ON a.id = c.apartamento_id
    LEFT JOIN propietarios p ON p.id = c.propietario_id
    ${where}
    ORDER BY c.anio DESC, a.nombre
  `).all(...params);

  res.json(filas);
});

// GET /api/contratos/resumen-propietario?propietario_id=X&anio=2026
// Resumen por contrato del propietario ese año (base de la futura liquidación).
// Declarado ANTES de /:id para que Express no lo tome como parámetro.
router.get('/resumen-propietario', (req, res) => {
  const propietarioId = intOrNull(req.query.propietario_id);
  if (propietarioId === null) return res.status(400).json({ error: 'propietario_id es obligatorio' });
  const anio = intOrNull(req.query.anio) || new Date().getFullYear();

  const contratos = db.prepare(`
    SELECT
      c.id                                                                       AS contrato_id,
      c.tipo                                                                      AS tipo,
      c.precio_total                                                             AS precio_total,
      c.porcentaje_comision                                                      AS porcentaje_comision,
      a.nombre                                                                   AS apartamento_nombre,
      c.apartamento_id                                                           AS apartamento_id,
      COUNT(q.id)                                                                AS total_cuotas,
      COALESCE(SUM(q.pagado), 0)                                                 AS cuotas_pagadas,
      COALESCE(SUM(CASE WHEN q.pagado = 1 THEN q.importe ELSE 0 END), 0)         AS importe_pagado,
      COALESCE(SUM(CASE WHEN q.pagado = 0 THEN q.importe ELSE 0 END), 0)         AS importe_pendiente
    FROM contratos c
    JOIN apartamentos a ON a.id = c.apartamento_id
    LEFT JOIN contrato_cuotas q ON q.contrato_id = c.id
    WHERE c.propietario_id = ? AND c.anio = ?
    GROUP BY c.id, c.tipo, c.precio_total, c.porcentaje_comision, a.nombre, c.apartamento_id
    ORDER BY a.nombre
  `).all(propietarioId, anio);

  res.json({ propietario_id: propietarioId, anio, contratos });
});

// ---- Helpers del PDF del contrato ----
function fechaPDF(iso) {
  if (!iso) return '';
  const p = String(iso).split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : String(iso);
}
function fechaTextoPDF(iso) {
  // ISO YYYY-MM-DD → "DD de mes de YYYY".
  if (!iso) return '';
  const p = String(iso).split('-');
  if (p.length !== 3) return String(iso);
  const dia = parseInt(p[2], 10);
  const mi = parseInt(p[1], 10);
  return `${dia} de ${MESES_PDF[mi - 1] || ''} de ${p[0]}`;
}
function euroContrato(n) {
  return (Number(n) || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}
function leerLogoContrato(url) {
  if (!url) return null;
  const ext = path.extname(url).toLowerCase();
  if (!['.png', '.jpg', '.jpeg'].includes(ext)) return null;
  try { return fs.readFileSync(path.join(PUBLIC_DIR, url)); } catch (e) { return null; }
}
function nombrePropContrato(p) {
  return [p.nombre, p.apellidos, p.segundo_apellido].filter(Boolean).join(' ');
}

// GET /api/contratos/:id/pdf — contrato de arrendamiento vacacional en PDF (pdfkit, sin Chrome).
router.get('/:id/pdf', (req, res) => {
  const c = db.prepare(`
    SELECT c.*, a.nombre AS apartamento_nombre, a.ref_catastral AS apartamento_ref_catastral
    FROM contratos c
    JOIN apartamentos a ON a.id = c.apartamento_id
    WHERE c.id = ?
  `).get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Contrato no encontrado' });

  // Propietario: el del contrato o, en su defecto, el activo principal del apartamento (N:M).
  let prop = c.propietario_id
    ? db.prepare('SELECT * FROM propietarios WHERE id = ?').get(c.propietario_id)
    : null;
  if (!prop) {
    prop = db.prepare(`
      SELECT p.* FROM apartamento_propietarios ap
      JOIN propietarios p ON p.id = ap.propietario_id
      WHERE ap.apartamento_id = ? AND ap.activo = 1
      ORDER BY ap.porcentaje DESC, ap.fecha_inicio ASC, ap.id ASC
      LIMIT 1
    `).get(c.apartamento_id);
  }
  prop = prop || {};

  // Razón social predeterminada (la marcada; si ninguna lo está, la de menor id).
  const rs = db.prepare('SELECT * FROM razones_sociales ORDER BY predeterminada DESC, id LIMIT 1').get() || {};
  const cuotas = db.prepare(
    'SELECT * FROM contrato_cuotas WHERE contrato_id = ? ORDER BY numero_cuota'
  ).all(c.id);
  const fechasProp = db.prepare(
    'SELECT * FROM contrato_fechas_propietario WHERE contrato_id = ? ORDER BY fecha_inicio'
  ).all(c.id);

  // Valores: dato existente o línea de relleno; los editables van en bold.
  const v = (x) => {
    const s = (x === undefined || x === null ? '' : String(x)).trim();
    return s || '___________';
  };
  const propNombre = v(nombrePropContrato(prop));
  const propNif = v(prop.numero_documento || prop.dni);
  const propDir = v(prop.direccion);
  const propCuenta = v(prop.numero_cuenta);
  const rsNombre = v(rs.razon_social);
  const rsNombreMay = (rs.razon_social || '___________').toUpperCase();
  const rsCif = v(rs.cif_nif);
  const rsDir = v(rs.direccion);
  const rsCp = v(rs.codigo_postal);
  const rsCiudad = v(rs.ciudad);
  const rsProvincia = v(rs.estado_provincia);
  const rsEmail = v(rs.email_contacto);
  const aptoNombre = v(c.apartamento_nombre);
  const refCat = v(c.apartamento_ref_catastral);
  // Variables de plantilla configurables en Ajustes → Plantillas.
  const repNombre = v(plantilla('plantilla_representante_nombre', rs.persona_contacto));
  const repDni = v(plantilla('plantilla_representante_dni', ''));
  const condicionesQuinta = (c.notas && String(c.notas).trim()) || plantilla('plantilla_contrato_condiciones_quinta', '---');
  const emailRgpd = v(plantilla('plantilla_contrato_email_rgpd', rs.email_contacto || ''));

  const M = Math.round(22 * MM); // margen 22mm
  const doc = new PDFDocument({ size: 'A4', margin: M });
  const contentW = doc.page.width - 2 * M;
  const LG = 3.5; // interlineado ~1.35 sobre fuente 10

  const chunks = [];
  doc.on('data', (ch) => chunks.push(ch));
  doc.on('end', () => {
    const pdf = Buffer.concat(chunks);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="contrato-${c.id}.pdf"`);
    res.send(pdf);
  });
  doc.on('error', (e) => { if (!res.headersSent) res.status(500).json({ error: e.message }); });

  // --- Primitivas de texto ---
  // Párrafo con segmentos {t, b}: b=true → bold (campos editables).
  const parrafo = (segs, opts) => {
    opts = opts || {};
    doc.x = M;
    segs.forEach((s, i) => {
      doc.font(s.b ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor('#000000');
      const o = { width: contentW, align: opts.align || 'justify', continued: i < segs.length - 1, lineGap: LG };
      doc.text(s.t, o);
    });
    doc.font('Helvetica');
    doc.moveDown(opts.gap != null ? opts.gap : 0.7);
  };
  const texto = (t, opts) => parrafo([{ t }], opts);
  const tituloCentro = (t, size) => {
    doc.x = M;
    doc.font('Helvetica-Bold').fontSize(size || 12).fillColor('#000000')
      .text(t, { width: contentW, align: 'center', lineGap: LG });
    doc.font('Helvetica').fontSize(10);
    doc.moveDown(0.5);
  };
  const clausula = (t) => {
    doc.x = M;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#000000')
      .text(t, { width: contentW, align: 'center', underline: true });
    doc.font('Helvetica').fontSize(10);
    doc.moveDown(0.4);
  };
  const bullet = (segs) => {
    const y0 = doc.y;
    doc.font('Helvetica').fontSize(10).fillColor('#000000').text('•', M, y0, { width: 12 });
    segs.forEach((s, i) => {
      doc.font(s.b ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor('#000000');
      const o = { width: contentW - 16, align: 'left', continued: i < segs.length - 1, lineGap: LG };
      if (i === 0) doc.text(s.t, M + 16, y0, o); else doc.text(s.t, o);
    });
    doc.font('Helvetica');
    doc.moveDown(0.35);
  };

  // ================= Encabezamiento =================
  tituloCentro('CONTRATO DE ARRENDAMIENTO VACACIONAL', 14);
  doc.moveDown(0.3);
  texto(`En Oropesa del Mar, a ${fechaTextoPDF(new Date().toISOString().slice(0, 10))}`, { align: 'center', gap: 0.8 });

  tituloCentro('REUNIDOS');
  parrafo([
    { t: 'De una parte ' }, { t: repNombre, b: true }, { t: ', DNI ' }, { t: repDni, b: true },
    { t: ', como administrador, en nombre y representación de la entidad mercantil ' }, { t: rsNombre, b: true },
    { t: ', con CIF ' }, { t: rsCif, b: true }, { t: ' y con domicilio social en ' }, { t: rsDir, b: true },
    { t: ', ' }, { t: rsCp, b: true }, { t: ', ' }, { t: rsCiudad, b: true }, { t: ' (' }, { t: rsProvincia, b: true }, { t: ').' },
  ]);
  parrafo([
    { t: 'De otra parte ' }, { t: propNombre, b: true },
    { t: ', mayor de edad, actuando en nombre y derecho propio, con domicilio en ' }, { t: propDir, b: true },
    { t: ', con NIF/CIF ' }, { t: propNif, b: true }, { t: ', como propietario/a del apartamento: ' },
    { t: aptoNombre, b: true }, { t: ' - R. Cat.: ' }, { t: refCat, b: true },
  ]);
  texto('Ambas partes se reconocen la capacidad necesaria para otorgar el presente contrato de arrendamiento y pactan libremente con arreglo a las siguientes:');

  tituloCentro('CLAUSULAS');

  // ----- PRIMERA -----
  clausula('PRIMERA');
  parrafo([
    { t: propNombre, b: true }, { t: ' cede en arrendamiento a la Mercantil ' }, { t: rsNombre, b: true },
    { t: ', el inmueble antes referido y que el inmueble está libre de cargas y ocupantes.' },
  ]);
  parrafo([
    { t: propNombre, b: true }, { t: ', autoriza expresamente a ' }, { t: rsNombre, b: true },
    { t: ', a subarrendar en forma total o parcial a terceras personas, físicas o jurídicas dentro de los periodos que aquí se establecen.' },
  ]);
  texto('Períodos con garantía:', { gap: 0.2 });
  parrafo([{ t: v(fechaPDF(c.temporada_inicio)), b: true }], { gap: 0.1 });
  parrafo([{ t: v(fechaPDF(c.temporada_fin)), b: true }]);
  texto('Fechas reservadas al propietario:', { gap: 0.2 });
  if (fechasProp.length) {
    fechasProp.forEach((f) => parrafo([{ t: `${fechaPDF(f.fecha_inicio)} — ${fechaPDF(f.fecha_fin)}`, b: true }], { gap: 0.1 }));
    doc.moveDown(0.5);
  } else {
    texto('Sin fechas reservadas');
  }

  // ----- SEGUNDA -----
  clausula('SEGUNDA');
  texto('Finalizada la duración pactada, la parte arrendadora deberá dejar el inmueble (y en su caso los muebles que comprende) en el mismo estado que tenía cuando lo ocupó, salvo el desgaste de uso habitual.');

  // ----- TERCERA -----
  clausula('TERCERA');
  parrafo([
    { t: 'El precio total del presente contrato será de ' }, { t: euroContrato(c.precio_total), b: true },
    { t: '. Este importe lleva incluido el IVA y se le aplicarán las retenciones correspondientes en cada caso.' },
  ]);
  parrafo([
    { t: 'El pago se realizara mediante transferencia bancaria a la cuenta ' }, { t: propCuenta, b: true },
    { t: ', siendo imprescindible el envío anticipado de la factura correspondiente a cada pago. La empresa ' },
    { t: rsNombre, b: true },
    { t: ' enviará el desglose con el importe del pago y los gastos correspondientes a reparaciones y mantenimiento del inmueble, si las hubiere, y el propietario emitirá la factura correspondiente.' },
  ]);
  texto('La forma de pago del presente contrato será:', { gap: 0.2 });
  if (cuotas.length) {
    cuotas.forEach((q) => parrafo([
      { t: `Cuota ${q.numero_cuota}: ${euroContrato(q.importe)} — ${fechaPDF(q.fecha_prevista)}`, b: true },
    ], { gap: 0.1 }));
    doc.moveDown(0.5);
  } else {
    texto('___________');
  }

  // ----- CUARTA -----
  clausula('CUARTA');
  texto('Dentro de los periodos estipulados en el contrato, el propietario estará obligado a:', { gap: 0.3 });
  bullet([{ t: 'Entregar la finca en perfectas condiciones de uso y habitabilidad, siendo de su cuenta cualquier responsabilidad que al respecto hubiere.' }]);
  bullet([{ t: 'El apartamento debe disponer de una conexión Wi-Fi privada.' }]);
  bullet([{ t: 'Pagar los impuestos, tasas y arbitrios correspondientes a la finca antes referida.' }]);
  bullet([{ t: 'Abonar los gastos de comunidad de propietarios del inmueble.' }]);
  bullet([{ t: 'Contratar un Seguro de Hogar con cobertura de robo, incendios y responsabilidad civil, etc.' }]);
  bullet([{ t: 'Realizar las reparaciones de mantenimiento del inmueble y de los muebles y en general los no imputables a la ocupación normal del alojamiento de los usuarios.' }]);
  bullet([
    { t: 'Autoriza a la mercantil ' }, { t: rsNombre, b: true },
    { t: ', a reparar o reponer cualquier elemento (lavadora, termo etc.) que se estropeara durante la vigencia de este contrato, y será a cargo del propietario.' },
  ]);
  bullet([
    { t: 'Durante el plazo pactado para el subarriendo, el propietario no podrá entrar en el inmueble sin autorización expresa del arrendador (' },
    { t: rsNombre, b: true }, { t: ').' },
  ]);
  doc.moveDown(0.4);

  // ----- QUINTA -----
  clausula('QUINTA');
  parrafo([{ t: 'Por cuenta de la mercantil ' }, { t: rsNombre, b: true }]);
  parrafo([{ t: condicionesQuinta, b: true }]);
  bullet([{ t: 'La captación y recepción de clientes.' }]);
  bullet([{ t: 'Los gastos de lavandería.' }]);
  bullet([{ t: 'La limpieza del inmueble.' }]);
  doc.moveDown(0.4);

  // ----- SEXTA -----
  clausula('SEXTA');
  parrafo([
    { t: rsNombreMay, b: true },
    { t: ' es el Responsable del tratamiento de los datos personales del Interesado y le informa de que esos datos se tratarán de conformidad con lo dispuesto en el Reglamento (UE) 2016/679, de 27 de abril (GDPR), y la ley Orgánica 3/2018, de 5 de diciembre (LOPDGDD), por lo que se le facilita la siguiente información del tratamiento:' },
  ]);
  texto('Fines y legitimación del tratamiento: prestación de los servicios solicitados (por ser necesario para la ejecución del contrato que supone dichos servicios, art. 6.1.b GDPR) y envío de comunicaciones de productos o servicios (con el consentimiento del interesado, art. 6.1.a GDPR)');
  texto('Criterios de conservación de los datos: se conservarán durante no más del tiempo necesario para mantener el fin del tratamiento o mientras existan prescripciones legales que dictaminen su custodia y cuando ya no sea necesario para ello, se suprimirán con medidas de seguridad adecuadas para garantizar la anonimización de los datos o la destrucción total de los mismos.');
  texto('Comunicación de los datos: no se comunicarán los datos a terceros, salvo obligación legal o que sea necesario para la prestación del servicio.');
  texto('Derechos que asisten al interesado:', { gap: 0.3 });
  bullet([{ t: 'Derecho a retirar el consentimiento en cualquier momento' }]);
  bullet([{ t: 'Derecho de acceso, rectificación, portabilidad y supresión de sus datos y de limitación u oposición a su tratamiento' }]);
  bullet([{ t: 'Derecho a presentar una reclamación ante la Autoridad de control (www.aepd.es) si considera que el tratamiento no se ajusta a la normativa vigente.' }]);
  doc.moveDown(0.3);
  texto('Datos de contacto para ejercer sus derechos', { gap: 0.3 });
  parrafo([
    { t: rsNombreMay, b: true }, { t: ', ' }, { t: (rs.direccion || '___________').toUpperCase(), b: true },
    { t: ', ' }, { t: rsCp, b: true }, { t: ' ' }, { t: (rs.ciudad || '___________').toUpperCase(), b: true },
    { t: ' (' }, { t: rsProvincia, b: true }, { t: ').' },
  ]);
  parrafo([{ t: 'Email: ' }, { t: emailRgpd, b: true }]);

  // ----- SÉPTIMA -----
  clausula('SÉPTIMA');
  texto('Para todos los conflictos que puedan surgir de la interpretación, aplicación, efectos incumplimiento de este contrato por las partes se someten a la Jurisdicción de los Tribunales de Castellón');
  texto('Y para que así conste y surta los efectos oportunos, firman arrendadora y propietario el presente contrato por duplicado y que se suscribe en cada hoja de los dos ejemplares idénticos que se otorgan mutuamente en el lugar y fecha de encabezamiento');

  // ----- Firmas (dos columnas) -----
  doc.moveDown(1.5);
  const firmaH = 110;
  if (doc.y + firmaH > doc.page.height - M) { doc.addPage(); }
  const yF = doc.y;
  const colW = contentW / 2;
  const rightX = M + colW;
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000000');
  doc.text(rsNombre, M, yF, { width: colW - 12, align: 'left' });
  doc.text(propNombre, rightX, yF, { width: colW - 12, align: 'left' });
  // Izquierda: logo de la razón social (si es PNG/JPG).
  const logo = leerLogoContrato(rs.logo_url);
  if (logo) { try { doc.image(logo, M, yF + 20, { fit: [140, 70] }); } catch (e) { /* logo inválido */ } }
  // Derecha: rectángulo vacío para la firma.
  doc.rect(rightX, yF + 20, colW - 24, 70).strokeColor('#000000').lineWidth(1).stroke();

  doc.end();
});

// GET /api/contratos/:id — ficha completa + cuotas.
router.get('/:id', (req, res) => {
  const contrato = db.prepare(`
    SELECT
      c.*,
      a.nombre                                              AS apartamento_nombre,
      a.tipo                                                AS apartamento_tih,
      p.nombre                                              AS propietario_nombre,
      p.apellidos                                           AS propietario_apellidos
    FROM contratos c
    JOIN apartamentos a ON a.id = c.apartamento_id
    LEFT JOIN propietarios p ON p.id = c.propietario_id
    WHERE c.id = ?
  `).get(req.params.id);

  if (!contrato) return res.status(404).json({ error: 'Contrato no encontrado' });

  // Contrato sin propietario propio: mostrar el propietario activo del apartamento
  // (relación N:M, el de mayor porcentaje) como referencia.
  if (!contrato.propietario_id) {
    const activo = db.prepare(`
      SELECT ap.propietario_id, p.nombre, p.apellidos
      FROM apartamento_propietarios ap
      JOIN propietarios p ON p.id = ap.propietario_id
      WHERE ap.apartamento_id = ? AND ap.activo = 1
      ORDER BY ap.porcentaje DESC, ap.fecha_inicio ASC
      LIMIT 1
    `).get(contrato.apartamento_id);
    if (activo) {
      contrato.propietario_nombre = activo.nombre;
      contrato.propietario_apellidos = activo.apellidos;
    }
  }

  contrato.cuotas = db.prepare(
    'SELECT * FROM contrato_cuotas WHERE contrato_id = ? ORDER BY numero_cuota'
  ).all(contrato.id);

  res.json(contrato);
});

// POST /api/contratos — crear contrato + cuotas en una transacción.
router.post('/', (req, res) => {
  const v = validarContrato(req.body);
  if (v.error) return res.status(400).json({ error: v.error });

  const insertarTodo = db.transaction((d, cuotas, createdBy) => {
    const info = db.prepare(`
      INSERT INTO contratos
        (apartamento_id, propietario_id, tipo, temporada_inicio, temporada_fin, anio,
         precio_total, porcentaje_comision, aplica_iva, porcentaje_retencion, estado, notas, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      d.apartamento_id, d.propietario_id, d.tipo, d.temporada_inicio, d.temporada_fin,
      d.anio, d.precio_total, d.porcentaje_comision, d.aplica_iva, d.porcentaje_retencion,
      d.estado, d.notas, createdBy
    );
    const cid = info.lastInsertRowid;
    const insCuota = db.prepare(`
      INSERT INTO contrato_cuotas
        (contrato_id, numero_cuota, fecha_prevista, importe, pagado, fecha_pago, notas)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of cuotas) {
      insCuota.run(cid, c.numero_cuota, c.fecha_prevista, c.importe, c.pagado, c.fecha_pago, c.notas);
    }
    return cid;
  });

  const id = insertarTodo(v.datos, v.cuotas, req.usuario.username);
  generarBloqueosContrato(db, id); // bloqueos fuera de temporada + reservas de propietario
  registrarActividad(db, req.usuario.id, req.usuario.nombre, 'crear', 'contrato', id,
    `Contrato ${v.datos.tipo} (${v.cuotas.length} cuota(s))`);
  res.status(201).json({ id });
});

// PUT /api/contratos/:id — editar contrato y reemplazar sus cuotas (DELETE + INSERT).
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existe = db.prepare('SELECT id FROM contratos WHERE id = ?').get(id);
  if (!existe) return res.status(404).json({ error: 'Contrato no encontrado' });

  const v = validarContrato(req.body);
  if (v.error) return res.status(400).json({ error: v.error });

  const actualizarTodo = db.transaction((d, cuotas) => {
    db.prepare(`
      UPDATE contratos SET
        apartamento_id = ?, propietario_id = ?, tipo = ?, temporada_inicio = ?,
        temporada_fin = ?, anio = ?, precio_total = ?, porcentaje_comision = ?,
        aplica_iva = ?, porcentaje_retencion = ?, estado = ?, notas = ?
      WHERE id = ?
    `).run(
      d.apartamento_id, d.propietario_id, d.tipo, d.temporada_inicio, d.temporada_fin,
      d.anio, d.precio_total, d.porcentaje_comision, d.aplica_iva, d.porcentaje_retencion,
      d.estado, d.notas, id
    );
    db.prepare('DELETE FROM contrato_cuotas WHERE contrato_id = ?').run(id);
    const insCuota = db.prepare(`
      INSERT INTO contrato_cuotas
        (contrato_id, numero_cuota, fecha_prevista, importe, pagado, fecha_pago, notas)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of cuotas) {
      insCuota.run(id, c.numero_cuota, c.fecha_prevista, c.importe, c.pagado, c.fecha_pago, c.notas);
    }
  });

  actualizarTodo(v.datos, v.cuotas);
  generarBloqueosContrato(db, id); // regenera bloqueos/uso de propietario tras editar
  registrarActividad(db, req.usuario.id, req.usuario.nombre, 'editar', 'contrato', id,
    `Contrato ${v.datos.tipo} (${v.cuotas.length} cuota(s))`);
  res.json({ ok: true });
});

// DELETE /api/contratos/:id — solo si no tiene cuotas pagadas.
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const contrato = db.prepare('SELECT id FROM contratos WHERE id = ?').get(id);
  if (!contrato) return res.status(404).json({ error: 'Contrato no encontrado' });

  const pagadas = db.prepare(
    'SELECT COUNT(*) AS c FROM contrato_cuotas WHERE contrato_id = ? AND pagado = 1'
  ).get(id).c;
  if (pagadas > 0) {
    return res.status(409).json({ error: 'No se puede eliminar un contrato con pagos registrados' });
  }

  db.prepare('DELETE FROM contratos WHERE id = ?').run(id); // cuotas en CASCADE
  registrarActividad(db, req.usuario.id, req.usuario.nombre, 'eliminar', 'contrato', id, null);
  res.json({ ok: true });
});

// PUT /api/contratos/:id/cuotas/:cuota_id — marcar/desmarcar una cuota como pagada.
router.put('/:id/cuotas/:cuota_id', (req, res) => {
  const contratoId = Number(req.params.id);
  const cuotaId = Number(req.params.cuota_id);
  const cuota = db.prepare(
    'SELECT * FROM contrato_cuotas WHERE id = ? AND contrato_id = ?'
  ).get(cuotaId, contratoId);
  if (!cuota) return res.status(404).json({ error: 'Cuota no encontrada' });

  const b = req.body || {};
  const pagado = b.pagado ? 1 : 0;
  // Si se marca pagada y no llega fecha, usar hoy; si se desmarca, limpiar la fecha.
  let fechaPago = null;
  if (pagado) {
    fechaPago = String(b.fecha_pago || '').trim() || new Date().toISOString().slice(0, 10);
  }

  db.prepare('UPDATE contrato_cuotas SET pagado = ?, fecha_pago = ? WHERE id = ?')
    .run(pagado, fechaPago, cuotaId);

  registrarActividad(db, req.usuario.id, req.usuario.nombre, 'pago', 'contrato', contratoId,
    `Cuota ${cuota.numero_cuota} ${pagado ? 'marcada como pagada' : 'marcada como pendiente'}`);
  res.json({ ok: true, pagado, fecha_pago: fechaPago });
});

// ---- Fechas de uso del propietario (generan reservas "De propietario") ----

// GET /api/contratos/:id/fechas-propietario — lista de fechas del contrato.
router.get('/:id/fechas-propietario', (req, res) => {
  const id = Number(req.params.id);
  const c = db.prepare('SELECT id FROM contratos WHERE id = ?').get(id);
  if (!c) return res.status(404).json({ error: 'Contrato no encontrado' });
  const filas = db.prepare(
    'SELECT * FROM contrato_fechas_propietario WHERE contrato_id = ? ORDER BY fecha_inicio'
  ).all(id);
  res.json(filas);
});

// POST /api/contratos/:id/fechas-propietario — { fecha_inicio, fecha_fin, motivo }.
// Las fechas deben estar dentro del período del contrato. Regenera los bloqueos.
router.post('/:id/fechas-propietario', (req, res) => {
  const id = Number(req.params.id);
  const c = db.prepare('SELECT id, temporada_inicio, temporada_fin FROM contratos WHERE id = ?').get(id);
  if (!c) return res.status(404).json({ error: 'Contrato no encontrado' });

  const b = req.body || {};
  const fi = String(b.fecha_inicio || '').trim();
  const ff = String(b.fecha_fin || '').trim();
  if (!fi || !ff) return res.status(400).json({ error: 'Las fechas son obligatorias' });
  if (!(fi < ff)) return res.status(400).json({ error: 'La fecha de inicio debe ser anterior a la de fin' });
  if (fi < c.temporada_inicio || ff > c.temporada_fin) {
    return res.status(400).json({ error: 'Las fechas deben estar dentro del período del contrato' });
  }

  const info = db.prepare(
    'INSERT INTO contrato_fechas_propietario (contrato_id, fecha_inicio, fecha_fin, motivo) VALUES (?, ?, ?, ?)'
  ).run(id, fi, ff, txt(b.motivo));
  generarBloqueosContrato(db, id);
  res.status(201).json({ id: info.lastInsertRowid });
});

// DELETE /api/contratos/:id/fechas-propietario/:fp_id — elimina y regenera bloqueos.
router.delete('/:id/fechas-propietario/:fp_id', (req, res) => {
  const id = Number(req.params.id);
  const fpId = Number(req.params.fp_id);
  const fp = db.prepare(
    'SELECT id FROM contrato_fechas_propietario WHERE id = ? AND contrato_id = ?'
  ).get(fpId, id);
  if (!fp) return res.status(404).json({ error: 'Fecha no encontrada' });
  db.prepare('DELETE FROM contrato_fechas_propietario WHERE id = ?').run(fpId);
  generarBloqueosContrato(db, id);
  res.json({ ok: true });
});

module.exports = router;
