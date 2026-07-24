// API REST del módulo de Ventas (inmobiliaria): propiedades en venta, clientes
// compradores, visitas (con notas) y un resumen para el dashboard.
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const {
  Document, Packer, Paragraph, TextRun, AlignmentType, UnderlineType, ImageRun,
} = require('docx');
const { Jimp } = require('jimp');
const db = require('../db/database');
const { importarPropiedades } = require('../services/importPropiedades');
const { registrarActividad } = require('../services/actividadService');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const MM = 2.83465; // 1 mm en puntos PDF
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Fecha ISO (YYYY-MM-DD) -> DD/MM/YYYY; si no es ISO, devuelve el valor tal cual.
function fechaDDMM(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v || '');
}

// Importe en formato europeo con el símbolo: 163000 -> "163.000 €".
function formatearEuros(n) {
  return Number(n || 0).toLocaleString('de-DE', { minimumFractionDigits: 0 }) + ' €';
}

// Fecha ISO -> "22 de junio de 2026"; si no es ISO, devuelve el valor tal cual.
function fechaTextoEspanol(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
  if (!m) return String(v || '');
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return `${parseInt(m[3], 10)} de ${MESES[parseInt(m[2], 10) - 1]} de ${m[1]}`;
}

// Convierte un entero a texto en español (hasta millones). 163000 -> "ciento sesenta y tres mil".
function numeroATextoEspanol(n) {
  n = Math.floor(Number(n) || 0);
  if (n === 0) return 'cero';
  const UNIDADES = ['', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'];
  const DECENAS = ['', 'diez', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
  const ESPECIALES = {
    10: 'diez', 11: 'once', 12: 'doce', 13: 'trece', 14: 'catorce', 15: 'quince',
    16: 'dieciséis', 17: 'diecisiete', 18: 'dieciocho', 19: 'diecinueve', 20: 'veinte',
    21: 'veintiún', 22: 'veintidós', 23: 'veintitrés', 24: 'veinticuatro', 25: 'veinticinco',
    26: 'veintiséis', 27: 'veintisiete', 28: 'veintiocho', 29: 'veintinueve',
  };
  const CENTENAS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos',
    'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

  const decenas = (num) => {
    if (num === 0) return '';
    if (num < 10) return UNIDADES[num];
    if (ESPECIALES[num]) return ESPECIALES[num];
    const d = Math.floor(num / 10);
    const u = num % 10;
    return u === 0 ? DECENAS[d] : `${DECENAS[d]} y ${UNIDADES[u]}`;
  };
  const centenas = (num) => {
    if (num === 0) return '';
    if (num === 100) return 'cien';
    const c = Math.floor(num / 100);
    const r = num % 100;
    return [c > 0 ? CENTENAS[c] : '', decenas(r)].filter(Boolean).join(' ');
  };

  const partes = [];
  const millones = Math.floor(n / 1000000);
  const miles = Math.floor((n % 1000000) / 1000);
  const resto = n % 1000;
  if (millones > 0) partes.push(millones === 1 ? 'un millón' : `${centenas(millones)} millones`);
  if (miles > 0) partes.push(miles === 1 ? 'mil' : `${centenas(miles)} mil`);
  if (resto > 0) partes.push(centenas(resto));
  return partes.join(' ').trim();
}

// Lee el logo de una razón social desde el disco solo si es PNG/JPG (pdfkit no soporta SVG/WEBP).
function leerLogoVenta(url) {
  if (!url) return null;
  const ext = path.extname(url).toLowerCase();
  if (!['.png', '.jpg', '.jpeg'].includes(ext)) return null;
  try { return fs.readFileSync(path.join(PUBLIC_DIR, url)); } catch (e) { return null; }
}

// Tipo de imagen ('png'/'jpg') que espera ImageRun de docx, a partir de la extensión del
// archivo. null si no es una extensión soportada por leerLogoVenta (ya filtrado antes).
function tipoImagenVenta(url) {
  const ext = path.extname(url || '').toLowerCase();
  return ext === '.png' ? 'png' : (ext === '.jpg' || ext === '.jpeg') ? 'jpg' : null;
}

// Paragraph con la imagen de firma/sello de la razón social, o el texto de siempre
// ("(Firma)"/"(Firma y sello)") si no hay firma_url configurada. A diferencia de pdfkit
// (que con `fit` escala manteniendo proporción), ImageRun de docx solo admite un ancho/alto
// fijo (estira la imagen si no coincide la proporción) — por eso se calcula aquí el tamaño
// final a partir de las dimensiones reales del archivo, para no deformar la firma.
const FIRMA_DOCX_MAX_W = 170;
const FIRMA_DOCX_MAX_H = 85;
async function parrafoFirmaDocx(firmaBuf, firmaUrl, textoSinFirma, Pt) {
  const tipo = firmaBuf ? tipoImagenVenta(firmaUrl) : null;
  if (firmaBuf && tipo) {
    let w = FIRMA_DOCX_MAX_W;
    let h = FIRMA_DOCX_MAX_H;
    try {
      const img = await Jimp.read(firmaBuf);
      const escala = Math.min(FIRMA_DOCX_MAX_W / img.width, FIRMA_DOCX_MAX_H / img.height);
      w = Math.max(1, Math.round(img.width * escala));
      h = Math.max(1, Math.round(img.height * escala));
    } catch (e) { /* si no se puede leer, usa el tamaño máximo tal cual */ }
    return new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [new ImageRun({ data: firmaBuf, type: tipo, transformation: { width: w, height: h } })],
    });
  }
  return Pt(textoSinFirma);
}

function txt(v) { return v === undefined || v === null || v === '' ? null : String(v); }
function aEntero(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}
function aReal(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}
function aBool(v) { return v ? 1 : 0; }
function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function actor(req) { return req.usuario ? (req.usuario.nombre || req.usuario.username) : null; }

// Párrafo de identificación de las partes del documento de Arras (compartido por
// /autorizacion-pdf y /autorizacion-docx). Con segunda persona en un lado, la nombra junto
// a la primera y pluraliza "domiciliado(s)"; sin segunda persona, el texto queda idéntico
// al de siempre. Formato de segmento {t, b} común a parrafo() (pdfkit) y P() (docx).
function segsIdentificacionArras(v) {
  const seg = (t, b) => ({ t, b: !!b });
  const segs = [seg('De una parte '), seg(v.nombreVend, true), seg(' con '), seg(`${v.docVend} ${v.dniVend}`, true)];
  if (v.nombreVend2) segs.push(seg(' y '), seg(v.nombreVend2, true), seg(' con '), seg(`${v.docVend2} ${v.dniVend2}`, true));
  segs.push(
    seg(v.nombreVend2 ? ', ambos domiciliados en ' : ', domiciliado en '), seg(v.dirVend, true),
    seg(' de '), seg(`${v.ciuVend} ${v.provVend}`, true),
    seg('; en adelante parte vendedora, y por otra parte '),
    seg(v.nombreComp, true), seg(' con '), seg(`${v.docComp} ${v.dniComp}`, true),
  );
  if (v.nombreComp2) segs.push(seg(' y '), seg(v.nombreComp2, true), seg(' con '), seg(`${v.docComp2} ${v.dniComp2}`, true));
  segs.push(
    seg(v.nombreComp2 ? ', ambos con domicilio en ' : ', con domicilio en '), seg(`${v.dirComp} ${v.ciuComp} ${v.provComp}`, true),
    seg('; en adelante parte compradora.'),
  );
  return segs;
}

// Agrupa las firmas en filas de máximo 3 columnas (repartidas lo más parejo posible entre
// las filas) para que quepan legibles aunque haya 4 o 5 firmantes.
function filasFirmas(firmas) {
  if (firmas.length <= 3) return [firmas];
  const filaN = Math.ceil(firmas.length / 2);
  return [firmas.slice(0, filaN), firmas.slice(filaN)];
}

// Párrafo de identificación del vendedor en la Autorización de venta (compartido por
// /autorizacion-venta-pdf y /autorizacion-venta-docx). Con segundo vendedor, los nombra a
// ambos y pluraliza "con domicilio"; sin él, el texto queda idéntico al de siempre.
function segsIdentificacionAutVenta(v) {
  const seg = (t, b) => ({ t, b: !!b });
  const segs = [seg('Don/Dña '), seg(v.nombreVend, true), seg(' de estado civil '), seg(v.estadoCivil, true)];
  if (v.nombreVend2) segs.push(seg(' y Don/Dña '), seg(v.nombreVend2, true), seg(' de estado civil '), seg(v.estadoCivil2, true));
  segs.push(seg(', con D.N.I. nº '), seg(v.dniVend, true));
  if (v.nombreVend2) segs.push(seg(' y '), seg(v.dniVend2, true), seg(' respectivamente'));
  segs.push(
    seg(v.nombreVend2 ? ', con domicilio ambos en ' : ', con domicilio en '), seg(v.dirVend, true),
    seg(' ('), seg(v.ciuVend, true), seg(') '), seg(v.provVend, true),
    seg(' y teléfono '), seg(v.telVend, true), seg('.'),
  );
  return segs;
}

// ============================================================
// Resumen para el dashboard
// ============================================================
router.get('/resumen', (req, res) => {
  const prop = db.prepare(`
    SELECT
      COALESCE(SUM(estado = 'Disponible'), 0) AS disponibles,
      COALESCE(SUM(estado = 'Reservada'), 0) AS reservadas,
      COALESCE(SUM(estado = 'Vendida'), 0) AS vendidas,
      COALESCE(SUM(estado = 'Retirada'), 0) AS retiradas,
      COUNT(*) AS total
    FROM propiedades_venta
  `).get();
  const cli = db.prepare(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(estado NOT IN ('Compró','Descartado')), 0) AS activos
    FROM clientes_compradores
  `).get();
  const vis = db.prepare(`
    SELECT
      COALESCE(SUM(fecha = ? AND estado = 'Programada'), 0) AS hoy,
      COALESCE(SUM(estado = 'Programada'), 0) AS programadas,
      COALESCE(SUM(estado = 'Realizada'), 0) AS realizadas
    FROM visitas_venta
  `).get(hoyISO());

  res.json({
    propiedades_disponibles: prop.disponibles,
    propiedades_reservadas: prop.reservadas,
    propiedades_vendidas: prop.vendidas,
    propiedades_retiradas: prop.retiradas,
    propiedades_total: prop.total,
    clientes_total: cli.total,
    clientes_activos: cli.activos,
    visitas_hoy: vis.hoy,
    visitas_programadas: vis.programadas,
    visitas_realizadas: vis.realizadas,
  });
});

// ============================================================
// PDF de autorización de venta
// ============================================================
// POST /api/ventas/autorizacion-pdf — genera el contrato de autorización con pdfkit.
router.post('/autorizacion-pdf', (req, res) => {
  const b = req.body || {};
  const s = (v) => (v === undefined || v === null) ? '' : String(v);
  const money = (v) => (Number(v) || 0).toLocaleString('es-ES');

  const nombreVend = s(b.nombre_vendedor);
  const docVend = s(b.documento_identidad_vendedor) || 'DNI';
  const dniVend = s(b.dni_vendedor);
  const dirVend = s(b.direccion_vendedor);
  const ciuVend = s(b.ciudad_vendedor);
  const provVend = s(b.provincia_vendedor);
  const nombreVend2 = s(b.nombre_vendedor_2);
  const docVend2 = s(b.documento_identidad_vendedor_2) || 'DNI';
  const dniVend2 = s(b.dni_vendedor_2);
  const nombreComp = s(b.nombre_comprador);
  const docComp = s(b.documento_identidad_comprador) || 'DNI';
  const dniComp = s(b.dni_comprador);
  const dirComp = s(b.direccion_comprador);
  const ciuComp = s(b.ciudad_comprador);
  const provComp = s(b.provincia_comprador);
  const nombreComp2 = s(b.nombre_comprador_2);
  const docComp2 = s(b.documento_identidad_comprador_2) || 'DNI';
  const dniComp2 = s(b.dni_comprador_2);
  const edificio = s(b.edificio);
  const planta = s(b.planta);
  const numPuerta = s(b.numero_puerta);
  const numParking = s(b.numero_parking);
  const numTrastero = s(b.numero_trastero);
  // Importe en formato europeo con el símbolo: 163000 -> "163.000 €".
  const formatearEuros = (n) => Number(n || 0).toLocaleString('de-DE', { minimumFractionDigits: 0 }) + ' €';
  const precioVenta = formatearEuros(b.precio_venta);
  const senal = formatearEuros(b.senal);
  const restoPago = formatearEuros(b.resto_pago);
  const fechaEscritura = fechaDDMM(b.fecha_escritura);
  const importeComision = formatearEuros(b.importe_comision);
  const textoIva = b.iva_incluido ? 'con el IVA incluido' : 'más el IVA correspondiente';

  // Logo y firma/sello de la razón social (si se indicó y son PNG/JPG).
  const rsId = aEntero(b.razon_social_id);
  const rsLogo = rsId != null ? db.prepare('SELECT logo_url, firma_url FROM razones_sociales WHERE id = ?').get(rsId) : null;
  const logoBuf = rsLogo ? leerLogoVenta(rsLogo.logo_url) : null;
  const firmaBuf = rsLogo ? leerLogoVenta(rsLogo.firma_url) : null;

  const BODY = 10;   // tamaño de fuente del cuerpo
  const LG = 2.6;    // interlineado ~1.25 con BODY (reducido para que quepa con hasta 5 firmantes)
  const PARR = 0.35; // espacio entre párrafos (reducido, ver LG)

  const M = Math.round(20 * MM); // márgenes 20mm (reducido de 25mm para ganar alto de página)
  const doc = new PDFDocument({ size: 'A4', margin: M });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  doc.on('end', () => {
    const pdf = Buffer.concat(chunks);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="autorizacion-venta.pdf"');
    res.send(pdf);
  });
  doc.on('error', (e) => { if (!res.headersSent) res.status(500).json({ error: e.message }); });

  const contentW = doc.page.width - M * 2;
  const N = (t) => ({ t, b: false });
  const B = (t) => ({ t, b: true });

  // Renderiza un párrafo con segmentos en negrita intercalados, justificado.
  // pdfkit, en texto 'continued', conserva el espacio FINAL de cada fragmento pero
  // recorta el INICIAL; por eso el espacio de separación se coloca al FINAL del
  // fragmento izquierdo (sirve tanto para texto→campo como campo→texto).
  function parrafo(segs) {
    const arr = segs.map((x) => ({ ...x }));
    for (let i = 0; i < arr.length - 1; i++) {
      const sep = /\s$/.test(arr[i].t) || /^\s/.test(arr[i + 1].t);
      arr[i].t = arr[i].t.replace(/\s+$/, '');
      arr[i + 1].t = arr[i + 1].t.replace(/^\s+/, '');
      if (sep) arr[i].t = arr[i].t + ' ';
    }
    arr.forEach((seg, i) => {
      doc.font(seg.b ? 'Helvetica-Bold' : 'Helvetica').fontSize(BODY);
      doc.text(seg.t, { align: 'justify', lineGap: LG, continued: i < arr.length - 1 });
    });
    doc.moveDown(PARR);
  }

  // Cabecera: logo ARRIBA (no flotante), luego salto de línea y el título debajo.
  // El cuerpo arranca debajo del título a ancho completo.
  if (logoBuf) {
    try { doc.image(logoBuf, M, doc.y, { fit: [100, 50] }); } catch (e) { /* logo inválido */ }
    doc.y += 50 + 8;
  }
  doc.font('Helvetica-Bold').fontSize(14).fillColor('#000000')
    .text('DOCUMENTO DE ARRAS PENITENCIALES', M, doc.y, { width: contentW, align: 'center' });
  doc.moveDown(0.8);

  parrafo(segsIdentificacionArras({
    nombreVend, docVend, dniVend, nombreVend2, docVend2, dniVend2, dirVend, ciuVend, provVend,
    nombreComp, docComp, dniComp, nombreComp2, docComp2, dniComp2, dirComp, ciuComp, provComp,
  }));

  parrafo([N('Ambas partes se reconocen su mutua capacidad legal para obligarse en derecho y suscribir el presente contrato, así como el estar asistidos a requerimiento de la empresa, representada en este acto por Analia Palermo Cornet, DNI 20473042Y, debidamente facultada para intervenir en virtud del contrato de autorización de venta que se encuentra vigente, y con derecho a percibir sus honorarios conforme al pacto establecido, teniendo como fecha límite el día de la escrituración.')]);

  // Parking y trastero solo se mencionan si tienen valor.
  const segInmueble = [
    N('La parte vendedora vende a la parte compradora, el apartamento '),
    B(`${edificio} ${planta} ${numPuerta}`),
  ];
  if (numParking) segInmueble.push(N(' y la plaza de parking '), B(numParking), N(' situada en el mismo edificio'));
  if (numTrastero) segInmueble.push(N(' y el trastero '), B(numTrastero), N(' situado en el mismo edificio'));
  segInmueble.push(N(', dentro de la Urbanización Marina D\'or de Oropesa del Mar.'));
  parrafo(segInmueble);

  parrafo([
    N('El importe total de esta operación será de: '), B(precioVenta),
    N('. Dicho monto se pagará:'),
  ]);

  parrafo([
    B(senal),
    N(' que serán custodiadas en la cta. de la sra. Analia Palermo Cornet con n.° de cuenta ES74 0081 1276 2900 0108 0515, sirviendo este contrato de eficaz recibo.'),
  ]);

  parrafo([
    N('Los '), B(restoPago), N(' restantes el día de la escrituración ante notario, que será antes del día '),
    B(fechaEscritura), N('.'),
  ]);

  parrafo([N('Se deja expresa constancia que el día de la escritura la susodicha finca estará libre de cargas, gravámenes e inquilinos, al corriente en el pago de contribuciones, arbitrios, impuestos, servicios y suministros, debiendo el vendedor presentar la documentación que acredite lo anteriormente expuesto.')]);

  parrafo([N('En el caso que la parte vendedora se volviera atrás deberán devolver el doble de la cantidad entregada a cuenta y si fuese por la parte compradora perderían la cantidad entregada.')]);

  parrafo([N('Los gastos que origine dicha compraventa correrán a cargo del comprador excepto la plusvalía que la abonará el vendedor.')]);

  parrafo([
    N('La empresa Analia Palermo Cornet recibirá de la parte vendedora la cantidad de '),
    B(`${importeComision} ${textoIva}`),
    N(', en concepto de honorarios por la mediación en esta compraventa, conforme el pacto establecido.'),
  ]);

  // Fecha y lugar con la fecha actual en texto.
  const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const ahora = new Date();
  const fechaTexto = `En Oropesa del Mar, a ${ahora.getDate()} de ${MESES_ES[ahora.getMonth()]} de ${ahora.getFullYear()}`;
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(BODY).text(fechaTexto, { align: 'left' });

  // Columnas de firma con línea encima (espacio real para firmar). Hasta 5 firmantes
  // (agencia + hasta 2 vendedores + hasta 2 compradores); con más de 3 se reparten en
  // dos filas para que las columnas no queden demasiado estrechas.
  const FIRMA_IMG_H = 55;      // alto de la imagen de firma/sello (criterio: recuadro de 70pt de Contratos, adaptado a columna más estrecha)
  const RESERVA_FIRMA = FIRMA_IMG_H + 12; // + un margen antes/después de la imagen
  doc.moveDown(1.2);
  let yF = doc.y;
  if (firmaBuf) yF += RESERVA_FIRMA; // hueco reservado para que la imagen no se solape con el texto de arriba
  if (yF > doc.page.height - M - 50) { doc.addPage(); yF = doc.y; if (firmaBuf) yF += RESERVA_FIRMA; }
  const firmas = [['Analia Palermo Cornet', '20473042Y'], [nombreVend || '—', dniVend || '']];
  if (nombreVend2) firmas.push([nombreVend2, dniVend2 || '']);
  firmas.push([nombreComp || '—', dniComp || '']);
  if (nombreComp2) firmas.push([nombreComp2, dniComp2 || '']);

  filasFirmas(firmas).forEach((fila, filaIdx) => {
    if (filaIdx > 0) yF += 44;
    if (yF > doc.page.height - M - 50) { doc.addPage(); yF = M; }
    const colW = (contentW - (fila.length - 1) * 20) / fila.length;
    fila.forEach((fm, i) => {
      const x = M + i * (colW + 20);
      // Columna de la agencia (siempre la primera de la primera fila): si la razón social
      // tiene firma_url se inserta la imagen encima de la línea, dentro del hueco ya
      // reservado (RESERVA_FIRMA) para que no se solape con el texto de arriba.
      if (filaIdx === 0 && i === 0 && firmaBuf) {
        try { doc.image(firmaBuf, x, yF - RESERVA_FIRMA + 6, { fit: [colW - 6, FIRMA_IMG_H] }); } catch (e) { /* firma inválida */ }
      }
      doc.moveTo(x, yF).lineTo(x + colW, yF).strokeColor('#000000').lineWidth(0.8).stroke();
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#000000').text(fm[0], x, yF + 4, { width: colW, align: 'center' });
      doc.font('Helvetica').fontSize(8).text(fm[1], x, doc.y, { width: colW, align: 'center' });
    });
  });

  doc.end();
});

// POST /api/ventas/autorizacion-docx — mismo contrato de arras que /autorizacion-pdf, en Word.
router.post('/autorizacion-docx', async (req, res) => {
  const b = req.body || {};
  const s = (v) => (v === undefined || v === null) ? '' : String(v);

  const nombreVend = s(b.nombre_vendedor);
  const docVend = s(b.documento_identidad_vendedor) || 'DNI';
  const dniVend = s(b.dni_vendedor);
  const dirVend = s(b.direccion_vendedor);
  const ciuVend = s(b.ciudad_vendedor);
  const provVend = s(b.provincia_vendedor);
  const nombreVend2 = s(b.nombre_vendedor_2);
  const docVend2 = s(b.documento_identidad_vendedor_2) || 'DNI';
  const dniVend2 = s(b.dni_vendedor_2);
  const nombreComp = s(b.nombre_comprador);
  const docComp = s(b.documento_identidad_comprador) || 'DNI';
  const dniComp = s(b.dni_comprador);
  const dirComp = s(b.direccion_comprador);
  const ciuComp = s(b.ciudad_comprador);
  const provComp = s(b.provincia_comprador);
  const nombreComp2 = s(b.nombre_comprador_2);
  const docComp2 = s(b.documento_identidad_comprador_2) || 'DNI';
  const dniComp2 = s(b.dni_comprador_2);
  const edificio = s(b.edificio);
  const planta = s(b.planta);
  const numPuerta = s(b.numero_puerta);
  const numParking = s(b.numero_parking);
  const numTrastero = s(b.numero_trastero);
  const precioVenta = formatearEuros(b.precio_venta);
  const senal = formatearEuros(b.senal);
  const restoPago = formatearEuros(b.resto_pago);
  const fechaEscritura = fechaDDMM(b.fecha_escritura);
  const importeComision = formatearEuros(b.importe_comision);
  const textoIva = b.iva_incluido ? 'con el IVA incluido' : 'más el IVA correspondiente';

  // Firma/sello de la razón social (misma que el logo del PDF de Arras).
  const rsIdDocx = aEntero(b.razon_social_id);
  const rsFirmaDocx = rsIdDocx != null ? db.prepare('SELECT firma_url FROM razones_sociales WHERE id = ?').get(rsIdDocx) : null;
  const firmaBufDocx = rsFirmaDocx ? leerLogoVenta(rsFirmaDocx.firma_url) : null;

  // --- Primitivas docx (tamaños en medios puntos: 20 = 10pt, 28 = 14pt) ---
  const R = (t, bold) => new TextRun({ text: t, bold: !!bold, size: 20, font: 'Helvetica' });
  const P = (segs, align) => new Paragraph({
    alignment: align || AlignmentType.JUSTIFIED,
    spacing: { after: 110, line: 250 },
    children: segs.map((seg) => R(seg.t, seg.b)),
  });
  const Pt = (t, align) => P([{ t }], align);
  const titulo = (t, size) => new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 200, before: 120 },
    children: [new TextRun({ text: t, bold: true, size: size || 28, font: 'Helvetica' })],
  });

  const k = [];
  k.push(titulo('DOCUMENTO DE ARRAS PENITENCIALES'));

  k.push(P(segsIdentificacionArras({
    nombreVend, docVend, dniVend, nombreVend2, docVend2, dniVend2, dirVend, ciuVend, provVend,
    nombreComp, docComp, dniComp, nombreComp2, docComp2, dniComp2, dirComp, ciuComp, provComp,
  })));

  k.push(Pt('Ambas partes se reconocen su mutua capacidad legal para obligarse en derecho y suscribir el presente contrato, así como el estar asistidos a requerimiento de la empresa, representada en este acto por Analia Palermo Cornet, DNI 20473042Y, debidamente facultada para intervenir en virtud del contrato de autorización de venta que se encuentra vigente, y con derecho a percibir sus honorarios conforme al pacto establecido, teniendo como fecha límite el día de la escrituración.'));

  const segInmueble = [
    { t: 'La parte vendedora vende a la parte compradora, el apartamento ' },
    { t: `${edificio} ${planta} ${numPuerta}`, b: true },
  ];
  if (numParking) segInmueble.push({ t: ' y la plaza de parking ' }, { t: numParking, b: true }, { t: ' situada en el mismo edificio' });
  if (numTrastero) segInmueble.push({ t: ' y el trastero ' }, { t: numTrastero, b: true }, { t: ' situado en el mismo edificio' });
  segInmueble.push({ t: ', dentro de la Urbanización Marina D\'or de Oropesa del Mar.' });
  k.push(P(segInmueble));

  k.push(P([
    { t: 'El importe total de esta operación será de: ' }, { t: precioVenta, b: true },
    { t: '. Dicho monto se pagará:' },
  ]));

  k.push(P([
    { t: senal, b: true },
    { t: ' que serán custodiadas en la cta. de la sra. Analia Palermo Cornet con n.° de cuenta ES74 0081 1276 2900 0108 0515, sirviendo este contrato de eficaz recibo.' },
  ]));

  k.push(P([
    { t: 'Los ' }, { t: restoPago, b: true }, { t: ' restantes el día de la escrituración ante notario, que será antes del día ' },
    { t: fechaEscritura, b: true }, { t: '.' },
  ]));

  k.push(Pt('Se deja expresa constancia que el día de la escritura la susodicha finca estará libre de cargas, gravámenes e inquilinos, al corriente en el pago de contribuciones, arbitrios, impuestos, servicios y suministros, debiendo el vendedor presentar la documentación que acredite lo anteriormente expuesto.'));

  k.push(Pt('En el caso que la parte vendedora se volviera atrás deberán devolver el doble de la cantidad entregada a cuenta y si fuese por la parte compradora perderían la cantidad entregada.'));

  k.push(Pt('Los gastos que origine dicha compraventa correrán a cargo del comprador excepto la plusvalía que la abonará el vendedor.'));

  k.push(P([
    { t: 'La empresa Analia Palermo Cornet recibirá de la parte vendedora la cantidad de ' },
    { t: `${importeComision} ${textoIva}`, b: true },
    { t: ', en concepto de honorarios por la mediación en esta compraventa, conforme el pacto establecido.' },
  ]));

  const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const ahora = new Date();
  const fechaTexto = `En Oropesa del Mar, a ${ahora.getDate()} de ${MESES_ES[ahora.getMonth()]} de ${ahora.getFullYear()}`;
  k.push(new Paragraph({ spacing: { before: 150, after: 300 }, children: [R(fechaTexto)] }));

  // Firmas (empresa + hasta 2 vendedores + hasta 2 compradores) en bloques sucesivos. Para
  // la empresa, si hay firma_url se inserta la imagen en vez del texto "(Firma)".
  const firmaEmpresaParrafo = await parrafoFirmaDocx(firmaBufDocx, rsFirmaDocx && rsFirmaDocx.firma_url, '(Firma)', Pt);
  const firmas = [['Analia Palermo Cornet', '20473042Y'], [nombreVend || '—', dniVend || '']];
  if (nombreVend2) firmas.push([nombreVend2, dniVend2 || '']);
  firmas.push([nombreComp || '—', dniComp || '']);
  if (nombreComp2) firmas.push([nombreComp2, dniComp2 || '']);
  firmas.forEach(([nombre, dni], i) => {
    k.push(new Paragraph({ spacing: { before: 220 }, children: [R(nombre, true)] }));
    k.push(Pt(dni));
    k.push(i === 0 ? firmaEmpresaParrafo : Pt('(Firma)'));
  });

  const docx = new Document({
    sections: [{
      properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, // 20mm
      children: k,
    }],
  });

  try {
    const buf = await Packer.toBuffer(docx);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename="arras-autorizacion-venta.docx"');
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ventas/autorizacion-venta-pdf — mandato de autorización de venta (pdfkit).
router.post('/autorizacion-venta-pdf', (req, res) => {
  const b = req.body || {};
  const s = (v) => (v === undefined || v === null) ? '' : String(v);
  const money = (v) => (Number(v) || 0).toLocaleString('es-ES');

  const nombreVend = s(b.nombre_vendedor);
  const estadoCivil = s(b.estado_civil);
  const dniVend = s(b.dni_vendedor);
  const dirVend = s(b.direccion_vendedor);
  const ciuVend = s(b.ciudad_vendedor);
  const provVend = s(b.provincia_vendedor);
  const telVend = s(b.telefono_vendedor);
  const nombreVend2 = s(b.nombre_vendedor_2);
  const estadoCivil2 = s(b.estado_civil_2);
  const dniVend2 = s(b.dni_vendedor_2);
  const edificio = s(b.edificio);
  const planta = s(b.planta);
  const puerta = s(b.puerta);
  const precioNum = Number(b.precio_venta) || 0;
  const porcComision = s(b.porcentaje_comision) || '3';
  const razonSocial = s(b.razon_social) || 'Costa Azahar Real Estate Solutions 2023 S.L.';
  const fechaDoc = fechaTextoEspanol(b.fecha_documento);

  // Logo y firma/sello de la razón social (si coincide por nombre y son PNG/JPG).
  const rs = db.prepare('SELECT logo_url, firma_url FROM razones_sociales WHERE razon_social = ?').get(razonSocial);
  const logoBuf = rs ? leerLogoVenta(rs.logo_url) : null;
  const firmaBuf = rs ? leerLogoVenta(rs.firma_url) : null;

  const BODY = 11;   // tamaño de fuente del cuerpo
  const LG = 3.4;    // interlineado (reducido para que quepa con el segundo vendedor)
  const PARR = 0.4;  // espacio entre párrafos (reducido, ver LG)

  const M = Math.round(20 * MM); // márgenes 20mm (reducido de 22mm para ganar alto de página)
  const doc = new PDFDocument({ size: 'A4', margin: M });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  doc.on('end', () => {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="autorizacion-venta.pdf"');
    res.send(Buffer.concat(chunks));
  });
  doc.on('error', (e) => { if (!res.headersSent) res.status(500).json({ error: e.message }); });

  const contentW = doc.page.width - M * 2;
  const N = (t) => ({ t, b: false });
  const B = (t) => ({ t, b: true });
  // pdfkit, en texto 'continued', conserva el espacio FINAL de cada fragmento pero
  // recorta el INICIAL. Por eso el espacio de separación se normaliza a un único
  // espacio al FINAL del fragmento izquierdo (sirve tanto para texto→campo como campo→texto).
  function parrafo(segs) {
    const arr = segs.map((x) => ({ ...x }));
    for (let i = 0; i < arr.length - 1; i++) {
      const sep = /\s$/.test(arr[i].t) || /^\s/.test(arr[i + 1].t);
      arr[i].t = arr[i].t.replace(/\s+$/, '');
      arr[i + 1].t = arr[i + 1].t.replace(/^\s+/, '');
      if (sep) arr[i].t = arr[i].t + ' ';
    }
    arr.forEach((seg, i) => {
      doc.font(seg.b ? 'Helvetica-Bold' : 'Helvetica').fontSize(BODY);
      doc.text(seg.t, { align: 'justify', lineGap: LG, continued: i < arr.length - 1 });
    });
    doc.moveDown(PARR);
  }

  // Cabecera: logo arriba a la izquierda (mismo estilo que el PDF de Arras).
  if (logoBuf) {
    try { doc.image(logoBuf, M, doc.y, { fit: [100, 50] }); } catch (e) { /* logo inválido */ }
    doc.y += 50 + 8;
  }
  doc.font('Helvetica-Bold').fontSize(14).fillColor('#000000')
    .text('AUTORIZACIÓN DE VENTA', M, doc.y, { width: contentW, align: 'center' });
  doc.moveDown(0.6);

  parrafo(segsIdentificacionAutVenta({
    nombreVend, estadoCivil, dniVend, dirVend, ciuVend, provVend, telVend,
    nombreVend2, estadoCivil2, dniVend2,
  }));

  parrafo([
    N('AUTORIZA a la mercantil '), B(razonSocial),
    N(` para que proceda a la venta de ${nombreVend2 ? 'nuestra' : 'mi'} propiedad sita en Oropesa del Mar (Castellón), urbanización Magic World, edificio `),
    B(edificio), N(' planta '), B(planta), N(' puerta '), B(puerta), N('.'),
  ]);

  parrafo([
    N('El precio para la citada venta es de '), B(formatearEuros(precioNum)),
    N(' ('), B(`${numeroATextoEspanol(precioNum)} euros`), N(')'),
  ]);

  parrafo([
    B(razonSocial),
    N(` percibirá d${nombreVend2 ? 'e los propietarios' : 'el propietario'} del inmueble, en concepto de honorarios, gastos de promoción y publicidad la cantidad correspondiente al `),
    B(`${porcComision} %`),
    N(' del precio de la venta mas el IVA correspondiente. La propiedad autoriza expresamente a '),
    B(razonSocial),
    N(' a percibir sus honorarios en la primera entrega de cantidad dada a cuenta. A tal fin, la propiedad concede plena autorización a '),
    B(razonSocial),
    N(' para percibir cantidades en concepto de señal de arras, o a cuenta del precio pactado como paso previo para la formalización del contrato privado de compraventa.'),
  ]);

  parrafo([N('La duración del presente mandato se pacta en 365 días, a contar desde el día de la fecha prorrogándose por periodos iguales, si no media denuncia expresa por cualquiera de las partes en el plazo de quince días antes de su vencimiento.')]);

  parrafo([N('En el caso de desistimiento o incumplimiento por parte de los compradores de la compra en las condiciones pactadas en el presente documento, estos perderán la cantidad entregada como reserva en concepto de indemnización por daños y perjuicios. Si el desistimiento o incumplimiento fuese por los vendedores, estos deberán devolver a los compradores la cantidad recibida como reserva doblada.')]);

  parrafo([
    N('Y en prueba de conformidad, firman el presente documento por duplicado y a un solo efecto en Oropesa del Mar, a '),
    B(fechaDoc), N('.'),
  ]);

  // Columnas de firma con línea encima (en la misma página que el texto). Dos si un solo
  // vendedor (igual que siempre), tres si hay un segundo vendedor — ancho recalculado.
  const FIRMA_IMG_H = 55;      // alto de la imagen de firma/sello (criterio: recuadro de 70pt de Contratos, adaptado a columna más estrecha)
  const RESERVA_FIRMA = FIRMA_IMG_H + 12; // + un margen antes/después de la imagen
  doc.moveDown(1.2);
  let yF = doc.y;
  if (firmaBuf) yF += RESERVA_FIRMA; // hueco reservado para que la imagen no se solape con el texto de arriba
  // Si no caben, se suben hasta el límite inferior en vez de pasar a otra página.
  const yMax = doc.page.height - M - 40;
  if (yF > yMax) yF = yMax;
  const etiquetasFirma = [razonSocial, nombreVend2 ? 'El Vendedor 1' : 'El Vendedor'];
  if (nombreVend2) etiquetasFirma.push('El Vendedor 2');
  const gapFirma = 30;
  const colW = (contentW - gapFirma * (etiquetasFirma.length - 1)) / etiquetasFirma.length;
  etiquetasFirma.forEach((label, i) => {
    const x = M + i * (colW + gapFirma);
    // Columna de la mercantil (siempre la primera): si tiene firma_url se inserta la
    // imagen encima de la línea, dentro del hueco ya reservado (RESERVA_FIRMA).
    if (i === 0 && firmaBuf) {
      try { doc.image(firmaBuf, x, yF - RESERVA_FIRMA + 6, { fit: [colW - 6, FIRMA_IMG_H] }); } catch (e) { /* firma inválida */ }
    }
    doc.moveTo(x, yF).lineTo(x + colW, yF).strokeColor('#000000').lineWidth(0.8).stroke();
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#000000').text(label, x, yF + 8, { width: colW, align: 'center' });
  });

  doc.end();
});

// POST /api/ventas/autorizacion-venta-docx — mismo mandato de venta que /autorizacion-venta-pdf, en Word.
router.post('/autorizacion-venta-docx', async (req, res) => {
  const b = req.body || {};
  const s = (v) => (v === undefined || v === null) ? '' : String(v);

  const nombreVend = s(b.nombre_vendedor);
  const estadoCivil = s(b.estado_civil);
  const dniVend = s(b.dni_vendedor);
  const dirVend = s(b.direccion_vendedor);
  const ciuVend = s(b.ciudad_vendedor);
  const provVend = s(b.provincia_vendedor);
  const telVend = s(b.telefono_vendedor);
  const nombreVend2 = s(b.nombre_vendedor_2);
  const estadoCivil2 = s(b.estado_civil_2);
  const dniVend2 = s(b.dni_vendedor_2);
  const edificio = s(b.edificio);
  const planta = s(b.planta);
  const puerta = s(b.puerta);
  const precioNum = Number(b.precio_venta) || 0;
  const porcComision = s(b.porcentaje_comision) || '3';
  const razonSocial = s(b.razon_social) || 'Costa Azahar Real Estate Solutions 2023 S.L.';
  const fechaDoc = fechaTextoEspanol(b.fecha_documento);

  // Firma/sello de la razón social (misma que el logo del PDF de Autorización de venta).
  const rsDocx = db.prepare('SELECT firma_url FROM razones_sociales WHERE razon_social = ?').get(razonSocial);
  const firmaBufDocx = rsDocx ? leerLogoVenta(rsDocx.firma_url) : null;

  // --- Primitivas docx (tamaños en medios puntos: 20 = 10pt, 28 = 14pt) ---
  const R = (t, bold) => new TextRun({ text: t, bold: !!bold, size: 22, font: 'Helvetica' });
  const P = (segs, align) => new Paragraph({
    alignment: align || AlignmentType.JUSTIFIED,
    spacing: { after: 110, line: 250 },
    children: segs.map((seg) => R(seg.t, seg.b)),
  });
  const Pt = (t, align) => P([{ t }], align);
  const titulo = (t, size) => new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 200, before: 120 },
    children: [new TextRun({ text: t, bold: true, size: size || 28, font: 'Helvetica' })],
  });

  const k = [];
  k.push(titulo('AUTORIZACIÓN DE VENTA'));

  k.push(P(segsIdentificacionAutVenta({
    nombreVend, estadoCivil, dniVend, dirVend, ciuVend, provVend, telVend,
    nombreVend2, estadoCivil2, dniVend2,
  })));

  k.push(P([
    { t: 'AUTORIZA a la mercantil ' }, { t: razonSocial, b: true },
    { t: ` para que proceda a la venta de ${nombreVend2 ? 'nuestra' : 'mi'} propiedad sita en Oropesa del Mar (Castellón), urbanización Magic World, edificio ` },
    { t: edificio, b: true }, { t: ' planta ' }, { t: planta, b: true }, { t: ' puerta ' }, { t: puerta, b: true }, { t: '.' },
  ]));

  k.push(P([
    { t: 'El precio para la citada venta es de ' }, { t: formatearEuros(precioNum), b: true },
    { t: ' (' }, { t: `${numeroATextoEspanol(precioNum)} euros`, b: true }, { t: ')' },
  ]));

  k.push(P([
    { t: razonSocial, b: true },
    { t: ` percibirá d${nombreVend2 ? 'e los propietarios' : 'el propietario'} del inmueble, en concepto de honorarios, gastos de promoción y publicidad la cantidad correspondiente al ` },
    { t: `${porcComision} %`, b: true },
    { t: ' del precio de la venta mas el IVA correspondiente. La propiedad autoriza expresamente a ' },
    { t: razonSocial, b: true },
    { t: ' a percibir sus honorarios en la primera entrega de cantidad dada a cuenta. A tal fin, la propiedad concede plena autorización a ' },
    { t: razonSocial, b: true },
    { t: ' para percibir cantidades en concepto de señal de arras, o a cuenta del precio pactado como paso previo para la formalización del contrato privado de compraventa.' },
  ]));

  k.push(Pt('La duración del presente mandato se pacta en 365 días, a contar desde el día de la fecha prorrogándose por periodos iguales, si no media denuncia expresa por cualquiera de las partes en el plazo de quince días antes de su vencimiento.'));

  k.push(Pt('En el caso de desistimiento o incumplimiento por parte de los compradores de la compra en las condiciones pactadas en el presente documento, estos perderán la cantidad entregada como reserva en concepto de indemnización por daños y perjuicios. Si el desistimiento o incumplimiento fuese por los vendedores, estos deberán devolver a los compradores la cantidad recibida como reserva doblada.'));

  k.push(P([
    { t: 'Y en prueba de conformidad, firman el presente documento por duplicado y a un solo efecto en Oropesa del Mar, a ' },
    { t: fechaDoc, b: true }, { t: '.' },
  ]));

  // Firmas (mercantil + uno o dos vendedores) en bloques sucesivos. Para la mercantil, si
  // hay firma_url se inserta la imagen en vez del texto "(Firma y sello)".
  k.push(new Paragraph({ spacing: { before: 300 }, children: [R(razonSocial, true)] }));
  k.push(await parrafoFirmaDocx(firmaBufDocx, rsDocx && rsDocx.firma_url, '(Firma y sello)', Pt));
  k.push(new Paragraph({ spacing: { before: 220 }, children: [R(nombreVend2 ? 'El Vendedor 1' : 'El Vendedor', true)] }));
  k.push(Pt('(Firma)'));
  if (nombreVend2) {
    k.push(new Paragraph({ spacing: { before: 220 }, children: [R('El Vendedor 2', true)] }));
    k.push(Pt('(Firma)'));
  }

  const docx = new Document({
    sections: [{
      properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, // 20mm
      children: k,
    }],
  });

  try {
    const buf = await Packer.toBuffer(docx);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename="autorizacion-venta-mandato.docx"');
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// Propiedades en venta
// ============================================================
const PROP_CAMPOS = [
  'apartamento_nombre',
  'referencia', 'codigo_idealista', 'tipo', 'calle', 'numero', 'planta', 'numero_puerta', 'zona', 'localidad',
  'precio', 'dormitorios', 'banos', 'metros_cuadrados', 'metros_utiles', 'clase_energetica',
  'garaje', 'num_fotos', 'estado', 'estado_idealista', 'fecha_alta', 'fecha_baja',
  'propietario_nombre', 'propietario_apellidos', 'propietario_telefono', 'propietario_email',
  'propietario_venta_id',
  'descripcion', 'notas',
  'fecha_venta', 'fecha_escritura', 'precio_venta_final',
  'comprador_nombre', 'comprador_telefono', 'comprador_email',
  'factura_comprador_id', 'factura_vendedor_id',
  'comision_total', 'comision_comprador', 'comision_vendedor',
];
const PROP_INT = ['dormitorios', 'banos', 'num_fotos', 'propietario_venta_id', 'factura_comprador_id', 'factura_vendedor_id'];
const PROP_REAL = ['precio', 'metros_cuadrados', 'metros_utiles', 'precio_venta_final', 'comision_total', 'comision_comprador', 'comision_vendedor'];

function normalizaPropCampo(campo, valor) {
  if (PROP_INT.includes(campo)) return aEntero(valor);
  if (PROP_REAL.includes(campo)) return aReal(valor);
  return txt(valor);
}

// GET /api/ventas/propiedades — lista con filtros opcionales.
router.get('/propiedades', (req, res) => {
  let sql = `
    SELECT p.*,
           fc.numero AS fc_numero, fc.estado AS fc_estado, fc.total AS fc_total,
           fv.numero AS fv_numero, fv.estado AS fv_estado, fv.total AS fv_total,
           (SELECT COALESCE(SUM(importe), 0) FROM factura_pagos WHERE factura_id = p.factura_comprador_id) AS fc_pagado,
           (SELECT COALESCE(SUM(importe), 0) FROM factura_pagos WHERE factura_id = p.factura_vendedor_id) AS fv_pagado
    FROM propiedades_venta p
    LEFT JOIN facturas fc ON fc.id = p.factura_comprador_id
    LEFT JOIN facturas fv ON fv.id = p.factura_vendedor_id
    WHERE 1 = 1`;
  const params = [];
  const { estado, tipo, zona, precio_min, precio_max, dormitorios } = req.query;
  if (estado) { sql += ' AND p.estado = ?'; params.push(estado); }
  if (tipo) { sql += ' AND p.tipo = ?'; params.push(tipo); }
  if (zona) { sql += ' AND p.zona LIKE ?'; params.push('%' + zona + '%'); }
  if (precio_min) { sql += ' AND p.precio >= ?'; params.push(aReal(precio_min)); }
  if (precio_max) { sql += ' AND p.precio <= ?'; params.push(aReal(precio_max)); }
  if (dormitorios) { sql += ' AND p.dormitorios >= ?'; params.push(aEntero(dormitorios)); }
  sql += " ORDER BY (p.fecha_alta IS NULL), p.fecha_alta DESC, p.id DESC";
  res.json(db.prepare(sql).all(...params));
});

// GET /api/ventas/propiedades/:id — ficha + historial de visitas.
router.get('/propiedades/:id', (req, res) => {
  const prop = db.prepare(`
    SELECT p.*,
           pv.nombre AS pv_nombre, pv.apellidos AS pv_apellidos, pv.telefono AS pv_telefono,
           pv.email AS pv_email, pv.dni AS pv_dni,
           fc.numero AS fc_numero, fc.estado AS fc_estado, fc.total AS fc_total,
           fv.numero AS fv_numero, fv.estado AS fv_estado, fv.total AS fv_total,
           (SELECT COALESCE(SUM(importe), 0) FROM factura_pagos WHERE factura_id = p.factura_comprador_id) AS fc_pagado,
           (SELECT COALESCE(SUM(importe), 0) FROM factura_pagos WHERE factura_id = p.factura_vendedor_id) AS fv_pagado
    FROM propiedades_venta p
    LEFT JOIN propietarios_venta pv ON pv.id = p.propietario_venta_id
    LEFT JOIN facturas fc ON fc.id = p.factura_comprador_id
    LEFT JOIN facturas fv ON fv.id = p.factura_vendedor_id
    WHERE p.id = ?
  `).get(req.params.id);
  if (!prop) return res.status(404).json({ error: 'Propiedad no encontrada' });
  const visitas = db.prepare(`
    SELECT v.*, c.nombre AS cliente_nombre, c.apellidos AS cliente_apellidos, c.telefono AS cliente_telefono
    FROM visitas_venta v
    JOIN clientes_compradores c ON c.id = v.cliente_id
    WHERE EXISTS (SELECT 1 FROM visitas_propiedades vp WHERE vp.visita_id = v.id AND vp.propiedad_id = ?)
    ORDER BY v.fecha DESC, v.id DESC
  `).all(prop.id);
  res.json({ ...prop, visitas });
});

// Siguiente referencia libre con formato "A" + correlativo (A424 -> A425). Se deriva
// siempre de las referencias reales existentes (sin contador aparte) para autocorregirse.
function siguienteReferencia() {
  const filas = db.prepare("SELECT referencia FROM propiedades_venta WHERE referencia LIKE 'A%'").all();
  let max = 0;
  for (const { referencia } of filas) {
    const m = /^A(\d+)$/.exec(referencia || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return 'A' + (max + 1);
}

// POST /api/ventas/propiedades — crear manual. Sin referencia -> se autogenera (A+correlativo).
router.post('/propiedades', (req, res) => {
  const b = req.body || {};
  const referencia = txt(b.referencia) || siguienteReferencia();
  if (db.prepare('SELECT id FROM propiedades_venta WHERE referencia = ?').get(referencia)) {
    return res.status(409).json({ error: 'Ya existe una propiedad con esa referencia' });
  }
  const datos = {};
  for (const c of PROP_CAMPOS) if (c in b) datos[c] = normalizaPropCampo(c, b[c]);
  datos.referencia = referencia;
  if (!datos.estado) datos.estado = 'Disponible';

  const claves = Object.keys(datos);
  const cols = claves.join(', ');
  const ph = claves.map((c) => '@' + c).join(', ');
  const info = db.prepare(`INSERT INTO propiedades_venta (${cols}) VALUES (${ph})`).run(datos);
  registrarActividad(db, req.usuario && req.usuario.id, actor(req), 'crear', 'propiedad-venta', info.lastInsertRowid, referencia);
  res.status(201).json({ id: info.lastInsertRowid, referencia });
});

// PUT /api/ventas/propiedades/:id — editar.
router.put('/propiedades/:id', (req, res) => {
  const prop = db.prepare('SELECT * FROM propiedades_venta WHERE id = ?').get(req.params.id);
  if (!prop) return res.status(404).json({ error: 'Propiedad no encontrada' });
  const b = req.body || {};

  if ('referencia' in b) {
    const ref = txt(b.referencia);
    if (!ref) return res.status(400).json({ error: 'La referencia no puede quedar vacía' });
    const dup = db.prepare('SELECT id FROM propiedades_venta WHERE referencia = ? AND id <> ?').get(ref, prop.id);
    if (dup) return res.status(409).json({ error: 'Ya existe otra propiedad con esa referencia' });
  }

  const sets = [];
  const vals = {};
  for (const c of PROP_CAMPOS) {
    if (c in b) { sets.push(`${c} = @${c}`); vals[c] = normalizaPropCampo(c, b[c]); }
  }
  if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
  vals.id = prop.id;
  db.prepare(`UPDATE propiedades_venta SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = @id`).run(vals);
  res.json({ ok: true });
});

// DELETE /api/ventas/propiedades/:id — 409 si tiene visitas.
router.delete('/propiedades/:id', (req, res) => {
  const prop = db.prepare('SELECT id, referencia FROM propiedades_venta WHERE id = ?').get(req.params.id);
  if (!prop) return res.status(404).json({ error: 'Propiedad no encontrada' });
  const n = db.prepare('SELECT COUNT(*) AS c FROM visitas_venta WHERE propiedad_id = ?').get(prop.id).c;
  if (n > 0) return res.status(409).json({ error: 'No se puede borrar: la propiedad tiene visitas registradas' });
  db.prepare('DELETE FROM propiedades_venta WHERE id = ?').run(prop.id);
  registrarActividad(db, req.usuario && req.usuario.id, actor(req), 'eliminar', 'propiedad-venta', prop.id, prop.referencia);
  res.json({ ok: true });
});

// POST /api/ventas/propiedades/importar — Excel de Idealista (campo "archivo").
router.post('/propiedades/importar', upload.single('archivo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se ha recibido ningún archivo' });
  try {
    const resumen = importarPropiedades(req.file.buffer);
    registrarActividad(db, req.usuario && req.usuario.id, actor(req), 'importar', 'propiedad-venta', null,
      `${resumen.nuevas} nuevas / ${resumen.actualizadas} actualizadas`);
    res.json(resumen);
  } catch (e) {
    console.error('Error importando propiedades:', e);
    res.status(500).json({ error: 'No se pudo procesar el archivo: ' + e.message });
  }
});

// Cierra una venta: estado='Vendida' + datos del comprador/escritura (lógica compartida por
// el endpoint de vender y por convertir-venta de una visita).
function marcarVendida(propId, b) {
  db.prepare(`
    UPDATE propiedades_venta SET
      estado = 'Vendida',
      fecha_venta = ?, fecha_escritura = ?, precio_venta_final = ?,
      comprador_nombre = ?, comprador_telefono = ?, comprador_email = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    txt(b.fecha_venta) || hoyISO(), txt(b.fecha_escritura), aReal(b.precio_venta_final),
    txt(b.comprador_nombre), txt(b.comprador_telefono), txt(b.comprador_email), propId);
}

// POST /api/ventas/propiedades/:id/vender — cierra la venta: estado='Vendida' + datos.
router.post('/propiedades/:id/vender', (req, res) => {
  const prop = db.prepare('SELECT id, referencia FROM propiedades_venta WHERE id = ?').get(req.params.id);
  if (!prop) return res.status(404).json({ error: 'Propiedad no encontrada' });
  marcarVendida(prop.id, req.body || {});
  registrarActividad(db, req.usuario && req.usuario.id, actor(req), 'editar', 'propiedad-venta', prop.id, `Vendida ${prop.referencia}`);
  res.json({ ok: true });
});

// ============================================================
// Publicar propiedad en la web (WordPress, hectorinmobiliaria.com)
// ============================================================
// POST /api/ventas/propiedades/:id/publicar-web — publica o actualiza la propiedad en
// WordPress (endpoint POST /wp-json/hector/v1/publicar-propiedad, auth por contraseña de
// aplicación). Si la propiedad ya tiene wp_post_id guardado, se envía para que WordPress
// actualice esa misma entrada en vez de crear una nueva.
router.post('/propiedades/:id/publicar-web', async (req, res) => {
  const prop = db.prepare('SELECT * FROM propiedades_venta WHERE id = ?').get(req.params.id);
  if (!prop) return res.status(404).json({ error: 'Propiedad no encontrada' });

  const { WP_URL, WP_USER, WP_APP_PASSWORD } = process.env;
  if (!WP_URL || !WP_USER || !WP_APP_PASSWORD) {
    return res.status(500).json({ error: 'Faltan las variables WP_URL/WP_USER/WP_APP_PASSWORD en el servidor (.env)' });
  }

  const fotos = db.prepare('SELECT * FROM propiedad_fotos WHERE propiedad_id = ? ORDER BY orden, id').all(prop.id);
  const fotosPayload = [];
  for (const f of fotos) {
    try {
      const buf = fs.readFileSync(path.join(PUBLIC_DIR, f.url));
      fotosPayload.push({ nombre_archivo: f.nombre_archivo, contenido_base64: buf.toString('base64') });
    } catch (e) { /* archivo no encontrado en disco: se omite esa foto */ }
  }

  const payload = { fotos: fotosPayload };
  const set = (clave, valor) => { if (valor !== null && valor !== undefined && valor !== '') payload[clave] = valor; };
  set('titulo', prop.apartamento_nombre || prop.referencia);
  set('descripcion', prop.descripcion);
  set('precio', prop.precio);
  set('dormitorios', prop.dormitorios);
  set('banos', prop.banos);
  set('area', prop.metros_cuadrados);
  set('anio_construccion', prop.anio_construccion); // columna no existe hoy en propiedades_venta: queda omitido
  set('direccion', [prop.calle, prop.numero].filter(Boolean).join(' '));
  set('referencia', prop.referencia);
  if (prop.aire_acondicionado) set('aire_acondicionado', 'Sí'); // columna no existe hoy: nunca se envía
  if (prop.piscina_privada) set('piscina', 'Sí'); // columna no existe hoy: nunca se envía
  set('tipo', prop.tipo);
  set('zona', prop.zona);
  if (prop.wp_post_id) payload.wp_post_id = prop.wp_post_id;

  const auth = 'Basic ' + Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString('base64');
  let wpRes, wpBody;
  try {
    wpRes = await fetch(`${WP_URL}/wp-json/hector/v1/publicar-propiedad`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    wpBody = await wpRes.json().catch(() => null);
  } catch (e) {
    return res.status(502).json({ error: 'No se pudo conectar con WordPress: ' + e.message });
  }

  if (!wpRes.ok || !wpBody || !wpBody.ok) {
    const msg = (wpBody && (wpBody.message || wpBody.error)) || `WordPress respondió con el estado ${wpRes.status}`;
    return res.status(502).json({ error: msg });
  }

  db.prepare("UPDATE propiedades_venta SET wp_post_id = ?, updated_at = datetime('now') WHERE id = ?")
    .run(wpBody.wp_post_id, prop.id);
  registrarActividad(db, req.usuario && req.usuario.id, actor(req), 'editar', 'propiedad-venta', prop.id,
    `Publicada en la web (${prop.referencia})`);
  res.json({ ok: true, url: wpBody.url });
});

// ============================================================
// Propietarios de venta (cartera de ventas / inmobiliaria)
// ============================================================
const PRV_CAMPOS = [
  'nombre', 'apellidos', 'telefono', 'telefono2', 'email', 'dni',
  'direccion', 'ciudad', 'codigo_postal', 'notas',
];

// GET /api/ventas/propietarios-venta — lista con búsqueda opcional + nº de propiedades.
router.get('/propietarios-venta', (req, res) => {
  const buscar = txt(req.query.buscar);
  let sql = `
    SELECT pv.*,
           (SELECT COUNT(*) FROM propiedades_venta p WHERE p.propietario_venta_id = pv.id) AS num_propiedades
    FROM propietarios_venta pv WHERE 1 = 1`;
  const params = [];
  if (buscar) {
    sql += ' AND (pv.nombre LIKE ? OR pv.apellidos LIKE ? OR pv.email LIKE ? OR pv.telefono LIKE ?)';
    const t = '%' + buscar + '%';
    params.push(t, t, t, t);
  }
  sql += ' ORDER BY pv.nombre COLLATE NOCASE, pv.apellidos COLLATE NOCASE';
  res.json(db.prepare(sql).all(...params));
});

// POST /api/ventas/propietarios-venta/importar-alquiler — copia de un propietario de alquiler
// (declarar ANTES de /:id). Body { propietario_id }.
router.post('/propietarios-venta/importar-alquiler', (req, res) => {
  const propId = aEntero((req.body || {}).propietario_id);
  if (propId === null) return res.status(400).json({ error: 'propietario_id es obligatorio' });
  const p = db.prepare('SELECT * FROM propietarios WHERE id = ?').get(propId);
  if (!p) return res.status(404).json({ error: 'El propietario de alquiler no existe' });
  if (db.prepare('SELECT id FROM propietarios_venta WHERE propietario_alquiler_id = ?').get(propId)) {
    return res.status(409).json({ error: 'Este propietario ya fue importado' });
  }
  const apellidos = [p.apellidos, p.segundo_apellido].filter(Boolean).join(' ') || null;
  const dni = p.numero_documento || p.dni || null;
  const info = db.prepare(`
    INSERT INTO propietarios_venta
      (nombre, apellidos, telefono, email, dni, direccion, ciudad, codigo_postal, propietario_alquiler_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(p.nombre, apellidos, txt(p.telefono), txt(p.email), dni,
    txt(p.direccion), txt(p.ciudad), txt(p.codigo_postal), propId);
  registrarActividad(db, req.usuario && req.usuario.id, actor(req), 'crear', 'propietario-venta', info.lastInsertRowid, `Importado de alquileres: ${p.nombre}`);
  res.status(201).json({ id: info.lastInsertRowid });
});

// GET /api/ventas/propietarios-venta/:id — ficha + propiedades asociadas.
router.get('/propietarios-venta/:id', (req, res) => {
  const pv = db.prepare('SELECT * FROM propietarios_venta WHERE id = ?').get(req.params.id);
  if (!pv) return res.status(404).json({ error: 'Propietario no encontrado' });
  const propiedades = db.prepare(`
    SELECT id, referencia, calle, numero, zona, precio, estado
    FROM propiedades_venta WHERE propietario_venta_id = ?
    ORDER BY referencia COLLATE NOCASE
  `).all(pv.id);
  res.json({ ...pv, propiedades });
});

// POST /api/ventas/propietarios-venta — crear.
router.post('/propietarios-venta', (req, res) => {
  const b = req.body || {};
  if (!txt(b.nombre)) return res.status(400).json({ error: 'El nombre es obligatorio' });
  const datos = {};
  for (const c of PRV_CAMPOS) if (c in b) datos[c] = txt(b[c]);
  datos.nombre = txt(b.nombre);
  const claves = Object.keys(datos);
  const cols = claves.join(', ');
  const ph = claves.map((c) => '@' + c).join(', ');
  const info = db.prepare(`INSERT INTO propietarios_venta (${cols}) VALUES (${ph})`).run(datos);
  registrarActividad(db, req.usuario && req.usuario.id, actor(req), 'crear', 'propietario-venta', info.lastInsertRowid, datos.nombre);
  res.status(201).json({ id: info.lastInsertRowid });
});

// PUT /api/ventas/propietarios-venta/:id — editar.
router.put('/propietarios-venta/:id', (req, res) => {
  const pv = db.prepare('SELECT id FROM propietarios_venta WHERE id = ?').get(req.params.id);
  if (!pv) return res.status(404).json({ error: 'Propietario no encontrado' });
  const b = req.body || {};
  if ('nombre' in b && !txt(b.nombre)) return res.status(400).json({ error: 'El nombre no puede quedar vacío' });
  const sets = [];
  const vals = {};
  for (const c of PRV_CAMPOS) {
    if (c in b) { sets.push(`${c} = @${c}`); vals[c] = txt(b[c]); }
  }
  if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
  vals.id = pv.id;
  db.prepare(`UPDATE propietarios_venta SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = @id`).run(vals);
  res.json({ ok: true });
});

// DELETE /api/ventas/propietarios-venta/:id — 409 si tiene propiedades asociadas.
router.delete('/propietarios-venta/:id', (req, res) => {
  const pv = db.prepare('SELECT id, nombre FROM propietarios_venta WHERE id = ?').get(req.params.id);
  if (!pv) return res.status(404).json({ error: 'Propietario no encontrado' });
  const n = db.prepare('SELECT COUNT(*) AS c FROM propiedades_venta WHERE propietario_venta_id = ?').get(pv.id).c;
  if (n > 0) return res.status(409).json({ error: 'No se puede borrar: el propietario tiene propiedades asociadas' });
  db.prepare('DELETE FROM propietarios_venta WHERE id = ?').run(pv.id);
  registrarActividad(db, req.usuario && req.usuario.id, actor(req), 'eliminar', 'propietario-venta', pv.id, pv.nombre);
  res.json({ ok: true });
});

// ============================================================
// Clientes compradores
// ============================================================
const CLI_CAMPOS = [
  'nombre', 'apellidos', 'telefono', 'email', 'presupuesto_max', 'busca_tipo',
  'busca_dormitorios', 'busca_zona', 'busca_linea', 'busca_frontal', 'busca_villa',
  'notas', 'estado', 'origen',
];
function normalizaCliCampo(campo, valor) {
  if (campo === 'presupuesto_max') return aReal(valor);
  if (campo === 'busca_dormitorios') return aEntero(valor);
  if (campo === 'busca_frontal' || campo === 'busca_villa') return aBool(valor);
  return txt(valor);
}

// GET /api/ventas/clientes — lista con filtros.
router.get('/clientes', (req, res) => {
  let sql = 'SELECT * FROM clientes_compradores WHERE 1 = 1';
  const params = [];
  const { estado, busca_tipo, presupuesto_min, presupuesto_max } = req.query;
  if (estado) { sql += ' AND estado = ?'; params.push(estado); }
  if (busca_tipo) { sql += ' AND busca_tipo = ?'; params.push(busca_tipo); }
  if (presupuesto_min) { sql += ' AND presupuesto_max >= ?'; params.push(aReal(presupuesto_min)); }
  if (presupuesto_max) { sql += ' AND presupuesto_max <= ?'; params.push(aReal(presupuesto_max)); }
  sql += ' ORDER BY created_at DESC, id DESC';
  res.json(db.prepare(sql).all(...params));
});

// GET /api/ventas/clientes/:id — ficha + historial de visitas.
router.get('/clientes/:id', (req, res) => {
  const cli = db.prepare('SELECT * FROM clientes_compradores WHERE id = ?').get(req.params.id);
  if (!cli) return res.status(404).json({ error: 'Cliente no encontrado' });
  const visitas = db.prepare(`
    SELECT v.*, p.referencia AS propiedad_referencia, p.calle AS propiedad_calle,
           p.precio AS propiedad_precio, p.zona AS propiedad_zona
    FROM visitas_venta v
    JOIN propiedades_venta p ON p.id = v.propiedad_id
    WHERE v.cliente_id = ?
    ORDER BY v.fecha DESC, v.id DESC
  `).all(cli.id).map((v) => ({ ...v, propiedades: propsDeVisita(v.id) }));
  res.json({ ...cli, visitas });
});

// POST /api/ventas/clientes — crear.
router.post('/clientes', (req, res) => {
  const b = req.body || {};
  if (!txt(b.nombre)) return res.status(400).json({ error: 'El nombre es obligatorio' });
  const datos = {};
  for (const c of CLI_CAMPOS) if (c in b) datos[c] = normalizaCliCampo(c, b[c]);
  datos.nombre = txt(b.nombre);
  datos.created_by = actor(req);

  const claves = Object.keys(datos);
  const cols = claves.join(', ');
  const ph = claves.map((c) => '@' + c).join(', ');
  const info = db.prepare(`INSERT INTO clientes_compradores (${cols}) VALUES (${ph})`).run(datos);
  registrarActividad(db, req.usuario && req.usuario.id, actor(req), 'crear', 'cliente-comprador', info.lastInsertRowid, datos.nombre);
  res.status(201).json({ id: info.lastInsertRowid });
});

// PUT /api/ventas/clientes/:id — editar.
router.put('/clientes/:id', (req, res) => {
  const cli = db.prepare('SELECT id FROM clientes_compradores WHERE id = ?').get(req.params.id);
  if (!cli) return res.status(404).json({ error: 'Cliente no encontrado' });
  const b = req.body || {};
  if ('nombre' in b && !txt(b.nombre)) return res.status(400).json({ error: 'El nombre no puede quedar vacío' });

  const sets = [];
  const vals = {};
  for (const c of CLI_CAMPOS) {
    if (c in b) { sets.push(`${c} = @${c}`); vals[c] = normalizaCliCampo(c, b[c]); }
  }
  if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
  vals.id = cli.id;
  db.prepare(`UPDATE clientes_compradores SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = @id`).run(vals);
  res.json({ ok: true });
});

// DELETE /api/ventas/clientes/:id — 409 si tiene visitas.
router.delete('/clientes/:id', (req, res) => {
  const cli = db.prepare('SELECT id, nombre FROM clientes_compradores WHERE id = ?').get(req.params.id);
  if (!cli) return res.status(404).json({ error: 'Cliente no encontrado' });
  const n = db.prepare('SELECT COUNT(*) AS c FROM visitas_venta WHERE cliente_id = ?').get(cli.id).c;
  if (n > 0) return res.status(409).json({ error: 'No se puede borrar: el cliente tiene visitas registradas' });
  db.prepare('DELETE FROM clientes_compradores WHERE id = ?').run(cli.id);
  registrarActividad(db, req.usuario && req.usuario.id, actor(req), 'eliminar', 'cliente-comprador', cli.id, cli.nombre);
  res.json({ ok: true });
});

// ============================================================
// Visitas
// ============================================================
const SELECT_VISITA = `
  SELECT v.*,
         c.nombre AS cliente_nombre, c.apellidos AS cliente_apellidos, c.telefono AS cliente_telefono,
         p.referencia AS propiedad_referencia, p.calle AS propiedad_calle, p.precio AS propiedad_precio
  FROM visitas_venta v
  JOIN clientes_compradores c ON c.id = v.cliente_id
  JOIN propiedades_venta p ON p.id = v.propiedad_id`;

// Propiedades (N:M) de una visita: [{id, referencia, calle, planta, precio, estado}].
function propsDeVisita(visitaId) {
  return db.prepare(`
    SELECT p.id, p.referencia, p.calle, p.planta, p.precio, p.estado
    FROM visitas_propiedades vp
    JOIN propiedades_venta p ON p.id = vp.propiedad_id
    WHERE vp.visita_id = ?
    ORDER BY p.referencia
  `).all(visitaId);
}
const conProps = (v) => ({ ...v, propiedades: propsDeVisita(v.id) });

// GET /api/ventas/visitas — lista con filtros (sin fecha = todas).
router.get('/visitas', (req, res) => {
  let sql = SELECT_VISITA + ' WHERE 1 = 1';
  const params = [];
  const { fecha, estado, cliente_id, propiedad_id } = req.query;
  if (fecha) { sql += ' AND v.fecha = ?'; params.push(fecha); }
  if (estado) { sql += ' AND v.estado = ?'; params.push(estado); }
  if (cliente_id) { sql += ' AND v.cliente_id = ?'; params.push(aEntero(cliente_id)); }
  if (propiedad_id) {
    sql += ' AND EXISTS (SELECT 1 FROM visitas_propiedades vp WHERE vp.visita_id = v.id AND vp.propiedad_id = ?)';
    params.push(aEntero(propiedad_id));
  }
  sql += ' ORDER BY v.fecha DESC, v.hora DESC, v.id DESC';
  res.json(db.prepare(sql).all(...params).map(conProps));
});

// GET /api/ventas/visitas/hoy — programadas para hoy (antes de /:id).
router.get('/visitas/hoy', (req, res) => {
  const sql = SELECT_VISITA + " WHERE v.fecha = ? AND v.estado = 'Programada' ORDER BY v.hora ASC, v.id ASC";
  res.json(db.prepare(sql).all(hoyISO()).map(conProps));
});

// GET /api/ventas/visitas/:id — detalle + notas + propiedades.
router.get('/visitas/:id', (req, res) => {
  const visita = db.prepare(SELECT_VISITA + ' WHERE v.id = ?').get(req.params.id);
  if (!visita) return res.status(404).json({ error: 'Visita no encontrada' });
  const notas = db.prepare('SELECT * FROM visitas_notas WHERE visita_id = ? ORDER BY fecha ASC, id ASC').all(visita.id);
  res.json({ ...conProps(visita), notas });
});

// POST /api/ventas/visitas — crear. Avanza el cliente Nuevo -> Contactado.
// Acepta propiedad_id (singular) o propiedad_ids[]: UNA visita con N propiedades (N:M).
router.post('/visitas', (req, res) => {
  const b = req.body || {};
  const clienteId = aEntero(b.cliente_id);
  const fecha = txt(b.fecha);

  // Normaliza a lista de ids de propiedad (array tiene prioridad; cae al singular).
  let propIds = Array.isArray(b.propiedad_ids)
    ? b.propiedad_ids.map(aEntero).filter((id) => id !== null)
    : [];
  if (propIds.length === 0 && aEntero(b.propiedad_id) !== null) propIds = [aEntero(b.propiedad_id)];
  propIds = [...new Set(propIds)]; // sin duplicados

  if (clienteId === null || propIds.length === 0 || !fecha) {
    return res.status(400).json({ error: 'cliente_id, al menos una propiedad y fecha son obligatorios' });
  }
  const cli = db.prepare('SELECT id, estado FROM clientes_compradores WHERE id = ?').get(clienteId);
  if (!cli) return res.status(400).json({ error: 'El cliente indicado no existe' });

  // Valida existencia + que ninguna propiedad ya tenga visita de ese cliente en esa fecha.
  for (const pid of propIds) {
    if (!db.prepare('SELECT id FROM propiedades_venta WHERE id = ?').get(pid)) {
      return res.status(400).json({ error: `La propiedad ${pid} no existe` });
    }
    const dup = db.prepare(`
      SELECT vp.visita_id FROM visitas_propiedades vp
      JOIN visitas_venta v ON v.id = vp.visita_id
      WHERE v.cliente_id = ? AND v.fecha = ? AND vp.propiedad_id = ?
    `).get(clienteId, fecha, pid);
    if (dup) return res.status(409).json({ error: 'Ya existe una visita de ese cliente a esa propiedad en esa fecha' });
  }

  let visitaId;
  db.transaction(() => {
    // propiedad_id (NOT NULL en visitas_venta) = 1ª propiedad, solo por compat.
    const info = db.prepare(`
      INSERT INTO visitas_venta (cliente_id, propiedad_id, fecha, hora, atendido_por, notas, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(clienteId, propIds[0], fecha, txt(b.hora), txt(b.atendido_por), txt(b.notas), actor(req));
    visitaId = info.lastInsertRowid;
    const insProp = db.prepare('INSERT INTO visitas_propiedades (visita_id, propiedad_id) VALUES (?, ?)');
    for (const pid of propIds) insProp.run(visitaId, pid);
    if (cli.estado === 'Nuevo') {
      db.prepare("UPDATE clientes_compradores SET estado = 'Contactado', updated_at = datetime('now') WHERE id = ?").run(clienteId);
    }
  })();
  registrarActividad(db, req.usuario && req.usuario.id, actor(req), 'crear', 'visita-venta', visitaId, fecha);
  res.status(201).json({ ok: true, id: visitaId, propiedades: propsDeVisita(visitaId) });
});

// PUT /api/ventas/visitas/:id — editar campos y/o reemplazar sus propiedades (N:M).
// Acepta propiedad_ids[]: borra e inserta todas las filas de visitas_propiedades. UN solo
// registro de visita; propiedad_id queda como compat (1ª propiedad).
router.put('/visitas/:id', (req, res) => {
  const visita = db.prepare('SELECT * FROM visitas_venta WHERE id = ?').get(req.params.id);
  if (!visita) return res.status(404).json({ error: 'Visita no encontrada' });
  const b = req.body || {};
  const sets = [];
  const vals = {};
  const add = (col, val) => { sets.push(`${col} = @${col}`); vals[col] = val; };

  if ('estado' in b) {
    if (!['Programada', 'Realizada', 'Cancelada'].includes(b.estado)) {
      return res.status(400).json({ error: 'estado no válido' });
    }
    add('estado', b.estado);
  }
  if ('valoracion' in b) add('valoracion', txt(b.valoracion));
  if ('notas' in b) add('notas', txt(b.notas));
  if ('hora' in b) add('hora', txt(b.hora));
  if ('fecha' in b && txt(b.fecha)) add('fecha', txt(b.fecha));
  if ('atendido_por' in b) add('atendido_por', txt(b.atendido_por));

  // Normaliza propiedad_ids (array) — array tiene prioridad sobre propiedad_id.
  let propIds = null;
  if (Array.isArray(b.propiedad_ids)) {
    propIds = [...new Set(b.propiedad_ids.map(aEntero).filter((id) => id !== null))];
    if (propIds.length === 0) return res.status(400).json({ error: 'Selecciona al menos una propiedad' });
  } else if (aEntero(b.propiedad_id) !== null) {
    propIds = [aEntero(b.propiedad_id)];
  }

  // La 1ª propiedad pasa a ser la de compat (propiedad_id).
  if (propIds) add('propiedad_id', propIds[0]);
  if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });

  // Fecha efectiva (body o la actual) para el control de duplicados.
  const efFecha = 'fecha' in vals ? vals.fecha : visita.fecha;

  // Valida existencia y que ninguna propiedad ya esté en OTRA visita del cliente esa fecha.
  if (propIds) {
    for (const pid of propIds) {
      if (!db.prepare('SELECT id FROM propiedades_venta WHERE id = ?').get(pid)) {
        return res.status(400).json({ error: `La propiedad ${pid} no existe` });
      }
      const dup = db.prepare(`
        SELECT vp.visita_id FROM visitas_propiedades vp
        JOIN visitas_venta v ON v.id = vp.visita_id
        WHERE v.cliente_id = ? AND v.fecha = ? AND vp.propiedad_id = ? AND v.id != ?
      `).get(visita.cliente_id, efFecha, pid, visita.id);
      if (dup) return res.status(409).json({ error: 'Ya existe una visita de ese cliente a esa propiedad en esa fecha' });
    }
  }

  vals.id = visita.id;
  db.transaction(() => {
    db.prepare(`UPDATE visitas_venta SET ${sets.join(', ')} WHERE id = @id`).run(vals);
    if (propIds) {
      db.prepare('DELETE FROM visitas_propiedades WHERE visita_id = ?').run(visita.id);
      const insProp = db.prepare('INSERT INTO visitas_propiedades (visita_id, propiedad_id) VALUES (?, ?)');
      for (const pid of propIds) insProp.run(visita.id, pid);
    }
  })();

  res.json({ ok: true, propiedades: propsDeVisita(visita.id) });
});

// POST /api/ventas/visitas/:id/realizar — marcar realizada. Avanza Contactado -> Visitado.
router.post('/visitas/:id/realizar', (req, res) => {
  const visita = db.prepare('SELECT * FROM visitas_venta WHERE id = ?').get(req.params.id);
  if (!visita) return res.status(404).json({ error: 'Visita no encontrada' });
  const b = req.body || {};

  db.transaction(() => {
    db.prepare(`
      UPDATE visitas_venta
      SET estado = 'Realizada',
          valoracion = COALESCE(?, valoracion),
          notas = COALESCE(?, notas)
      WHERE id = ?
    `).run(txt(b.valoracion), txt(b.notas), visita.id);
    const cli = db.prepare('SELECT estado FROM clientes_compradores WHERE id = ?').get(visita.cliente_id);
    if (cli && cli.estado === 'Contactado') {
      db.prepare("UPDATE clientes_compradores SET estado = 'Visitado', updated_at = datetime('now') WHERE id = ?").run(visita.cliente_id);
    }
  })();
  registrarActividad(db, req.usuario && req.usuario.id, actor(req), 'editar', 'visita-venta', visita.id, 'Visita realizada');
  res.json({ ok: true });
});

// POST /api/ventas/visitas/:id/convertir-venta — cierra la venta de una de las propiedades de
// la visita y marca su cliente como 'Compró'. Reutiliza marcarVendida (lógica de vender).
router.post('/visitas/:id/convertir-venta', (req, res) => {
  const visita = db.prepare('SELECT * FROM visitas_venta WHERE id = ?').get(req.params.id);
  if (!visita) return res.status(404).json({ error: 'Visita no encontrada' });
  const b = req.body || {};
  const propId = aEntero(b.propiedad_id);
  if (propId === null) return res.status(400).json({ error: 'propiedad_id es obligatorio' });

  // La propiedad debe pertenecer a esta visita (relación N:M).
  const pertenece = db.prepare(
    'SELECT 1 FROM visitas_propiedades WHERE visita_id = ? AND propiedad_id = ?'
  ).get(visita.id, propId);
  if (!pertenece) return res.status(400).json({ error: 'La propiedad no pertenece a esta visita' });

  const prop = db.prepare('SELECT id, referencia, estado FROM propiedades_venta WHERE id = ?').get(propId);
  if (!prop) return res.status(404).json({ error: 'Propiedad no encontrada' });
  if (prop.estado === 'Vendida') return res.status(409).json({ error: 'La propiedad ya está vendida' });

  const precio = aReal(b.precio_venta_final);
  if (precio === null || precio <= 0) return res.status(400).json({ error: 'precio_venta_final es obligatorio' });

  db.transaction(() => {
    marcarVendida(prop.id, b);
    db.prepare("UPDATE clientes_compradores SET estado = 'Compró', updated_at = datetime('now') WHERE id = ?")
      .run(visita.cliente_id);
  })();
  registrarActividad(db, req.usuario && req.usuario.id, actor(req), 'editar', 'propiedad-venta', prop.id,
    `Venta desde visita ${visita.id}: ${prop.referencia}`);
  res.json({ ok: true, propiedad_id: prop.id, referencia: prop.referencia, precio_venta_final: precio });
});

// DELETE /api/ventas/visitas/:id
router.delete('/visitas/:id', (req, res) => {
  const visita = db.prepare('SELECT id FROM visitas_venta WHERE id = ?').get(req.params.id);
  if (!visita) return res.status(404).json({ error: 'Visita no encontrada' });
  db.prepare('DELETE FROM visitas_venta WHERE id = ?').run(visita.id);
  registrarActividad(db, req.usuario && req.usuario.id, actor(req), 'eliminar', 'visita-venta', visita.id, null);
  res.json({ ok: true });
});

// ============================================================
// Notas de visita
// ============================================================
// POST /api/ventas/visitas/:id/notas — crear nota.
router.post('/visitas/:id/notas', (req, res) => {
  const visita = db.prepare('SELECT id FROM visitas_venta WHERE id = ?').get(req.params.id);
  if (!visita) return res.status(404).json({ error: 'Visita no encontrada' });
  const texto = txt((req.body || {}).texto);
  if (!texto) return res.status(400).json({ error: 'El texto de la nota es obligatorio' });
  const info = db.prepare('INSERT INTO visitas_notas (visita_id, texto, usuario_nombre) VALUES (?, ?, ?)')
    .run(visita.id, texto, actor(req));
  const nota = db.prepare('SELECT * FROM visitas_notas WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(nota);
});

// DELETE /api/ventas/visitas/:id/notas/:nota_id
router.delete('/visitas/:id/notas/:nota_id', (req, res) => {
  const nota = db.prepare('SELECT id FROM visitas_notas WHERE id = ? AND visita_id = ?')
    .get(req.params.nota_id, req.params.id);
  if (!nota) return res.status(404).json({ error: 'Nota no encontrada' });
  db.prepare('DELETE FROM visitas_notas WHERE id = ?').run(nota.id);
  res.json({ ok: true });
});

module.exports = router;
