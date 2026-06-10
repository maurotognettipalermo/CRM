// API REST de facturación. Cuatro tipos de factura (huésped / propietario / autofactura /
// gastos), cada uno construye emisor, receptor, líneas e importes a partir de los datos
// referenciados. Numeración correlativa por año (factura_contador) dentro de la misma
// transacción que el INSERT para evitar duplicados. Montado bajo requireAuth.
const express = require('express');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const db = require('../db/database');
const { registrarActividad } = require('../services/actividadService');

const router = express.Router();

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MM = 2.83465; // 1 mm en puntos PDF

const TIPOS = ['huésped', 'propietario', 'autofactura', 'gastos', 'mayorista'];
const ESTADOS = ['borrador', 'emitida', 'pagada', 'anulada'];
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// Columnas del INSERT de facturas (numero se fija dentro de la transacción).
const COLS = [
  'numero', 'serie', 'anio', 'tipo', 'estado', 'razon_social_id',
  'emisor_nombre', 'emisor_cif', 'emisor_direccion', 'emisor_logo_url',
  'receptor_nombre', 'receptor_cif', 'receptor_direccion', 'receptor_email',
  'base_imponible', 'porcentaje_iva', 'importe_iva', 'porcentaje_retencion', 'importe_retencion', 'total',
  'contrato_id', 'apartamento_id', 'propietario_id', 'reserva_id',
  'fecha_emision', 'fecha_vencimiento', 'notas', 'created_by',
];

// --- Helpers ---
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function intOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}
function txt(v) { return v === undefined || v === null ? null : String(v); }
function hoyISO() { return new Date().toISOString().slice(0, 10); }
function mesDeFecha(iso) {
  if (!iso) return '';
  const [a, m] = String(iso).split('-');
  const mi = parseInt(m, 10);
  return mi >= 1 && mi <= 12 ? `${MESES[mi - 1]} ${a}` : iso;
}

// --- Formato para el PDF ---
function euroPDF(n) { return (Number(n) || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'; }
function cantidadPDF(n) { return (Number(n) || 0).toLocaleString('es-ES'); }
function fechaPDF(iso) {
  if (!iso) return '—';
  const p = String(iso).split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso;
}
// Lee el logo del disco como Buffer (pdfkit solo admite PNG/JPG).
function leerLogoBuffer(url) {
  if (!url) return null;
  const ext = path.extname(url).toLowerCase();
  if (!['.png', '.jpg', '.jpeg'].includes(ext)) return null;
  try { return fs.readFileSync(path.join(PUBLIC_DIR, url)); } catch (e) { return null; }
}

// Plantilla de factura con todas las columnas a su valor por defecto.
function nuevaFactura() {
  return {
    numero: null, serie: 'F', anio: null, tipo: null, estado: 'emitida', razon_social_id: null,
    emisor_nombre: '', emisor_cif: null, emisor_direccion: null, emisor_logo_url: null,
    receptor_nombre: '', receptor_cif: null, receptor_direccion: null, receptor_email: null,
    base_imponible: 0, porcentaje_iva: 0, importe_iva: 0, porcentaje_retencion: 0, importe_retencion: 0, total: 0,
    contrato_id: null, apartamento_id: null, propietario_id: null, reserva_id: null,
    fecha_emision: hoyISO(), fecha_vencimiento: null, notas: null, created_by: null,
  };
}

// Aplica IVA y retención sobre la base imponible (redondeo a 2 decimales).
function calcularImportes(f) {
  f.base_imponible = round2(f.base_imponible);
  f.importe_iva = round2(f.base_imponible * (f.porcentaje_iva || 0) / 100);
  f.importe_retencion = round2(f.base_imponible * (f.porcentaje_retencion || 0) / 100);
  f.total = round2(f.base_imponible + f.importe_iva - f.importe_retencion);
}

// Datos de emisor a partir de una razón social.
function emisorDeRazon(rs) {
  return {
    razon_social_id: rs.id,
    emisor_nombre: rs.razon_social || rs.nombre_comercial || '',
    emisor_cif: rs.cif_nif || null,
    emisor_direccion: [rs.direccion, rs.numero, rs.codigo_postal, rs.ciudad].filter(Boolean).join(', ') || null,
    emisor_logo_url: rs.logo_url || null,
  };
}
function nombrePropietario(p) {
  return [p.nombre, p.apellidos, p.segundo_apellido].filter(Boolean).join(' ');
}
function cifPropietario(p) { return p.numero_documento || p.dni || null; }
function direccionPropietario(p) {
  return [p.direccion, p.direccion_numero, p.codigo_postal, p.ciudad].filter(Boolean).join(', ') || null;
}
function direccionRazon(rs) {
  return [rs.direccion, rs.numero, rs.codigo_postal, rs.ciudad].filter(Boolean).join(', ') || null;
}

// Numeración correlativa por año (dentro de la transacción del INSERT).
function siguienteNumeroFactura(anio, serie) {
  db.prepare('INSERT OR IGNORE INTO factura_contador (anio, ultimo_numero) VALUES (?, 0)').run(anio);
  db.prepare('UPDATE factura_contador SET ultimo_numero = ultimo_numero + 1 WHERE anio = ?').run(anio);
  const n = db.prepare('SELECT ultimo_numero FROM factura_contador WHERE anio = ?').get(anio).ultimo_numero;
  return `${serie || 'F'}-${anio}-${String(n).padStart(3, '0')}`;
}

// Inserta factura + líneas en una transacción, fijando el número correlativo.
const insertarFactura = db.transaction((f, lineas) => {
  f.numero = siguienteNumeroFactura(f.anio, f.serie);
  const ph = COLS.map((c) => '@' + c).join(', ');
  const info = db.prepare(`INSERT INTO facturas (${COLS.join(', ')}) VALUES (${ph})`).run(f);
  const fid = info.lastInsertRowid;
  const insL = db.prepare(
    'INSERT INTO factura_lineas (factura_id, descripcion, cantidad, precio_unitario, importe, orden) VALUES (?, ?, ?, ?, ?, ?)'
  );
  lineas.forEach((l, i) => insL.run(fid, l.descripcion, l.cantidad != null ? l.cantidad : 1, l.precio_unitario, l.importe, l.orden != null ? l.orden : i));
  return { id: fid, numero: f.numero };
});

// ==================== Constructores por tipo ====================

function construirPropietario(body, autofactura) {
  const contratoId = intOrNull(body.contrato_id);
  const contrato = contratoId != null ? db.prepare('SELECT * FROM contratos WHERE id = ?').get(contratoId) : null;
  if (!contrato) return { error: 'Contrato no encontrado' };
  const rs = db.prepare('SELECT * FROM razones_sociales WHERE id = ?').get(intOrNull(body.razon_social_id));
  if (!rs) return { error: 'Razón social no válida' };
  const propietario = contrato.propietario_id ? db.prepare('SELECT * FROM propietarios WHERE id = ?').get(contrato.propietario_id) : null;
  if (!propietario) return { error: 'El contrato no tiene propietario asociado' };
  const apto = db.prepare('SELECT nombre FROM apartamentos WHERE id = ?').get(contrato.apartamento_id) || {};

  const ids = Array.isArray(body.cuota_ids) ? body.cuota_ids.map((x) => intOrNull(x)).filter((x) => x != null) : [];
  if (!ids.length) return { error: 'Selecciona al menos una cuota' };
  const cuotas = db.prepare(
    `SELECT * FROM contrato_cuotas WHERE contrato_id = ? AND id IN (${ids.map(() => '?').join(',')}) ORDER BY numero_cuota`
  ).all(contrato.id, ...ids);
  if (!cuotas.length) return { error: 'No se encontraron cuotas válidas para ese contrato' };

  const lineas = cuotas.map((c) => ({
    descripcion: `Pago ${c.numero_cuota} — ${apto.nombre || 'Apartamento'} — ${mesDeFecha(c.fecha_prevista)}`,
    cantidad: 1, precio_unitario: round2(c.importe), importe: round2(c.importe),
  }));

  const f = nuevaFactura();
  f.tipo = autofactura ? 'autofactura' : 'propietario';
  f.contrato_id = contrato.id;
  f.apartamento_id = contrato.apartamento_id;
  f.propietario_id = contrato.propietario_id;
  f.porcentaje_iva = contrato.aplica_iva ? 21 : 0;
  f.porcentaje_retencion = num(contrato.porcentaje_retencion);
  f.base_imponible = lineas.reduce((s, l) => s + l.importe, 0);

  if (autofactura) {
    // Emisor = propietario, receptor = nuestra razón social.
    f.razon_social_id = rs.id;
    f.emisor_nombre = nombrePropietario(propietario);
    f.emisor_cif = cifPropietario(propietario);
    f.emisor_direccion = direccionPropietario(propietario);
    f.emisor_logo_url = null;
    f.receptor_nombre = rs.razon_social || rs.nombre_comercial || '';
    f.receptor_cif = rs.cif_nif || null;
    f.receptor_direccion = direccionRazon(rs);
    f.receptor_email = rs.email_contacto || null;
  } else {
    Object.assign(f, emisorDeRazon(rs));
    f.receptor_nombre = nombrePropietario(propietario);
    f.receptor_cif = cifPropietario(propietario);
    f.receptor_direccion = direccionPropietario(propietario);
    f.receptor_email = propietario.email || null;
  }
  return { f, lineas };
}

function construirGastos(body) {
  const apartamentoId = intOrNull(body.apartamento_id);
  const apto = apartamentoId != null ? db.prepare('SELECT * FROM apartamentos WHERE id = ?').get(apartamentoId) : null;
  if (!apto) return { error: 'Apartamento no encontrado' };
  const rs = db.prepare('SELECT * FROM razones_sociales WHERE id = ?').get(intOrNull(body.razon_social_id));
  if (!rs) return { error: 'Razón social no válida' };
  // Receptor: propietario ACTIVO del apartamento (relación N:M). Con varios activos,
  // el de mayor porcentaje (en empate, el de relación más antigua).
  const propietario = db.prepare(`
    SELECT p.* FROM apartamento_propietarios ap
    JOIN propietarios p ON p.id = ap.propietario_id
    WHERE ap.apartamento_id = ? AND ap.activo = 1
    ORDER BY ap.porcentaje DESC, ap.fecha_inicio ASC, ap.id ASC
    LIMIT 1
  `).get(apto.id) || null;

  const ids = Array.isArray(body.gasto_ids) ? body.gasto_ids.map((x) => intOrNull(x)).filter((x) => x != null) : [];
  if (!ids.length) return { error: 'Selecciona al menos un gasto' };
  const gastos = db.prepare(
    `SELECT g.*, c.incluye_iva AS incluye_iva FROM apartamento_gastos g
     LEFT JOIN catalogo_gastos c ON c.id = g.catalogo_gasto_id
     WHERE g.apartamento_id = ? AND g.id IN (${ids.map(() => '?').join(',')}) ORDER BY g.fecha`
  ).all(apto.id, ...ids);
  if (!gastos.length) return { error: 'No se encontraron gastos válidos para ese apartamento' };

  const lineas = gastos.map((g) => ({
    descripcion: g.nombre, cantidad: 1, precio_unitario: round2(g.precio), importe: round2(g.precio),
  }));

  const f = nuevaFactura();
  f.tipo = 'gastos';
  f.apartamento_id = apto.id;
  f.propietario_id = propietario ? propietario.id : null;
  f.porcentaje_iva = gastos.some((g) => g.incluye_iva) ? 21 : 0; // si algún gasto lleva IVA, 21% al total
  f.porcentaje_retencion = 0;
  f.base_imponible = lineas.reduce((s, l) => s + l.importe, 0);
  Object.assign(f, emisorDeRazon(rs));
  if (propietario) {
    f.receptor_nombre = nombrePropietario(propietario);
    f.receptor_cif = cifPropietario(propietario);
    f.receptor_direccion = direccionPropietario(propietario);
    f.receptor_email = propietario.email || null;
  } else {
    f.receptor_nombre = 'Propietario';
  }
  return { f, lineas };
}

function construirHuesped(body) {
  const rs = db.prepare('SELECT * FROM razones_sociales WHERE id = ?').get(intOrNull(body.razon_social_id));
  if (!rs) return { error: 'Razón social no válida' };
  const reservaId = intOrNull(body.reserva_id);
  const reserva = reservaId != null ? db.prepare('SELECT * FROM reservas WHERE id = ?').get(reservaId) : null;
  if (!reserva) return { error: 'Reserva no encontrada' };
  const apto = reserva.apartamento_id ? db.prepare('SELECT nombre FROM apartamentos WHERE id = ?').get(reserva.apartamento_id) : null;

  const receptor = body.receptor || {};
  if (!String(receptor.nombre || '').trim()) return { error: 'El nombre del receptor es obligatorio' };

  const lineas = [{
    descripcion: `Estancia en ${(apto && apto.nombre) || 'apartamento'} del ${reserva.entrada} al ${reserva.salida}`,
    cantidad: 1, precio_unitario: round2(reserva.precio_total), importe: round2(reserva.precio_total),
  }];
  // Extras manuales opcionales: [{ descripcion, importe }]
  if (Array.isArray(body.extras)) {
    for (const e of body.extras) {
      if (!e || !String(e.descripcion || '').trim()) continue;
      const imp = round2(e.importe);
      lineas.push({ descripcion: String(e.descripcion), cantidad: 1, precio_unitario: imp, importe: imp });
    }
  }

  const f = nuevaFactura();
  f.tipo = 'huésped';
  f.reserva_id = reserva.id;
  f.apartamento_id = reserva.apartamento_id || null;
  f.porcentaje_iva = 10; // alojamiento turístico
  f.porcentaje_retencion = 0;
  f.base_imponible = lineas.reduce((s, l) => s + l.importe, 0);
  Object.assign(f, emisorDeRazon(rs));
  f.receptor_nombre = String(receptor.nombre).trim();
  f.receptor_cif = txt(receptor.cif);
  f.receptor_direccion = txt(receptor.direccion);
  f.receptor_email = txt(receptor.email);
  f.notas = 'Datos del huésped pendientes de integración con check-in online';
  return { f, lineas };
}

// Factura a un mayorista: una línea por pago seleccionado del plan, IVA 21% sin retención.
// Emisor = nuestra razón social; receptor = datos del mayorista. Devuelve también pagoIds
// para fijar numero_factura en los pagos una vez generada la factura.
function construirMayorista(body) {
  const rs = db.prepare('SELECT * FROM razones_sociales WHERE id = ?').get(intOrNull(body.razon_social_id));
  if (!rs) return { error: 'Razón social no válida' };

  const ids = Array.isArray(body.mayorista_pago_ids)
    ? body.mayorista_pago_ids.map((x) => intOrNull(x)).filter((x) => x != null) : [];
  if (!ids.length) return { error: 'Selecciona al menos un pago de mayorista' };

  const pagos = db.prepare(`
    SELECT p.*, c.anio AS contrato_anio, c.mayorista_id,
           m.nombre AS mayorista_nombre, m.cif AS mayorista_cif,
           m.direccion AS mayorista_direccion, m.email AS mayorista_email
    FROM mayorista_pagos p
    JOIN mayorista_contratos c ON c.id = p.contrato_id
    JOIN mayoristas m ON m.id = c.mayorista_id
    WHERE p.id IN (${ids.map(() => '?').join(',')})
    ORDER BY c.anio, p.numero_pago
  `).all(...ids);
  if (!pagos.length) return { error: 'No se encontraron pagos válidos' };

  // Todos los pagos deben ser del mismo mayorista (un receptor por factura).
  const mids = new Set(pagos.map((p) => p.mayorista_id));
  if (mids.size > 1) return { error: 'Todos los pagos deben pertenecer al mismo mayorista' };
  const m = pagos[0];

  const lineas = pagos.map((p) => ({
    descripcion: `Pago ${p.numero_pago} — Contrato ${p.contrato_anio} — ${p.mayorista_nombre}`,
    cantidad: 1, precio_unitario: round2(p.importe), importe: round2(p.importe),
  }));

  const f = nuevaFactura();
  f.tipo = 'mayorista';
  f.porcentaje_iva = 10; // alojamiento turístico: IVA reducido
  f.porcentaje_retencion = 0;
  f.base_imponible = lineas.reduce((s, l) => s + l.importe, 0);
  Object.assign(f, emisorDeRazon(rs));
  f.receptor_nombre = m.mayorista_nombre;
  f.receptor_cif = m.mayorista_cif || null;
  f.receptor_direccion = m.mayorista_direccion || null;
  f.receptor_email = m.mayorista_email || null;
  return { f, lineas, pagoIds: pagos.map((p) => p.id) };
}

// ==================== Endpoints ====================

// GET /api/facturas?anio=&tipo=&estado=&propietario_id=&reserva_id=
router.get('/', (req, res) => {
  const cond = [];
  const params = [];
  const anio = intOrNull(req.query.anio);
  if (anio !== null) { cond.push('f.anio = ?'); params.push(anio); }
  if (TIPOS.includes(req.query.tipo)) { cond.push('f.tipo = ?'); params.push(req.query.tipo); }
  if (ESTADOS.includes(req.query.estado)) { cond.push('f.estado = ?'); params.push(req.query.estado); }
  const propId = intOrNull(req.query.propietario_id);
  if (propId !== null) { cond.push('f.propietario_id = ?'); params.push(propId); }
  const resId = intOrNull(req.query.reserva_id);
  if (resId !== null) { cond.push('f.reserva_id = ?'); params.push(resId); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';

  res.json(db.prepare(`
    SELECT f.*, rs.logo_url AS razon_logo_url
    FROM facturas f
    LEFT JOIN razones_sociales rs ON rs.id = f.razon_social_id
    ${where}
    ORDER BY f.fecha_emision DESC, f.id DESC
  `).all(...params));
});

// GET /api/facturas/:id/pdf — genera el PDF de la factura con pdfkit (sin Chrome).
router.get('/:id/pdf', (req, res) => {
  const f = db.prepare('SELECT * FROM facturas WHERE id = ?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'Factura no encontrada' });
  const lineas = db.prepare('SELECT * FROM factura_lineas WHERE factura_id = ? ORDER BY orden, id').all(f.id);

  const M = Math.round(20 * MM); // margen 20mm
  const doc = new PDFDocument({ size: 'A4', margin: M });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  doc.on('end', () => {
    const pdf = Buffer.concat(chunks);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${f.numero}.pdf"`);
    res.send(pdf);
  });
  doc.on('error', (e) => { if (!res.headersSent) res.status(500).json({ error: e.message }); });

  const right = doc.page.width - M;
  const contentW = right - M;
  let y = M;

  // ---- Cabecera: logo + caja de título ----
  const logo = leerLogoBuffer(f.emisor_logo_url);
  if (logo) { try { doc.image(logo, M, y, { fit: [120, 60] }); } catch (e) { /* logo inválido */ } }

  const titulo = 'FACTURA';
  const boxW = 210;
  const boxH = 30;
  doc.rect(right - boxW, y, boxW, boxH).fill('#1a1a2e');
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(16).text(titulo, right - boxW, y + 8, { width: boxW, align: 'center' });
  doc.fillColor('#000000').font('Helvetica').fontSize(10);
  let infoY = y + boxH + 8;
  doc.text(`Nº: ${f.numero}`, right - boxW, infoY, { width: boxW, align: 'right' });
  doc.text(`Fecha: ${fechaPDF(f.fecha_emision)}`, right - boxW, infoY + 14, { width: boxW, align: 'right' });
  if (f.fecha_vencimiento) doc.text(`Vencimiento: ${fechaPDF(f.fecha_vencimiento)}`, right - boxW, infoY + 28, { width: boxW, align: 'right' });

  y = Math.max(y + 70, infoY + 46);

  // ---- Emisor / Receptor ----
  doc.moveTo(M, y).lineTo(right, y).strokeColor('#e5e7eb').lineWidth(1).stroke();
  y += 12;
  const colW = contentW / 2;
  const y0 = y;
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#1a1a2e').text('EMISOR', M, y);
  doc.font('Helvetica').fontSize(10).fillColor('#000000');
  let ey = y + 16;
  [f.emisor_nombre, f.emisor_cif, f.emisor_direccion].filter(Boolean).forEach((t) => { doc.text(String(t), M, ey, { width: colW - 12 }); ey = doc.y + 2; });
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#1a1a2e').text('RECEPTOR', M + colW, y0);
  doc.font('Helvetica').fontSize(10).fillColor('#000000');
  let ry = y0 + 16;
  [f.receptor_nombre, f.receptor_cif, f.receptor_direccion, f.receptor_email].filter(Boolean).forEach((t) => { doc.text(String(t), M + colW, ry, { width: colW - 12 }); ry = doc.y + 2; });
  y = Math.max(ey, ry) + 12;

  // ---- Tabla de líneas ----
  const cDesc = M;
  const cCant = M + contentW * 0.56;
  const cUnit = M + contentW * 0.70;
  const cImp = M + contentW * 0.85;
  const wDesc = cCant - cDesc - 8;
  const wCant = cUnit - cCant - 6;
  const wUnit = cImp - cUnit - 6;
  const wImp = right - cImp - 4;

  doc.rect(M, y, contentW, 20).fill('#f3f4f6');
  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(9);
  doc.text('CONCEPTO', cDesc + 4, y + 6, { width: wDesc });
  doc.text('CANT', cCant, y + 6, { width: wCant, align: 'right' });
  doc.text('P. UNIT', cUnit, y + 6, { width: wUnit, align: 'right' });
  doc.text('IMPORTE', cImp, y + 6, { width: wImp, align: 'right' });
  y += 20;

  doc.font('Helvetica').fontSize(9).fillColor('#000000');
  lineas.forEach((l, i) => {
    const dh = doc.heightOfString(String(l.descripcion || ''), { width: wDesc });
    const h = Math.max(18, dh + 10);
    if (y + h > doc.page.height - M) { doc.addPage(); y = M; }
    if (i % 2 === 1) doc.rect(M, y, contentW, h).fill('#fafafa');
    doc.fillColor('#000000');
    doc.text(String(l.descripcion || ''), cDesc + 4, y + 5, { width: wDesc });
    doc.text(cantidadPDF(l.cantidad), cCant, y + 5, { width: wCant, align: 'right' });
    doc.text(euroPDF(l.precio_unitario), cUnit, y + 5, { width: wUnit, align: 'right' });
    doc.text(euroPDF(l.importe), cImp, y + 5, { width: wImp, align: 'right' });
    y += h;
  });

  // ---- Totales ----
  y += 14;
  const totX = right - 240;
  const totLblW = 150;
  const totValW = 90;
  const fila = (label, val, opts) => {
    opts = opts || {};
    if (y + 22 > doc.page.height - M) { doc.addPage(); y = M; }
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.big ? 14 : 10).fillColor(opts.color || '#000000');
    doc.text(label, totX, y, { width: totLblW, align: 'right' });
    doc.text(val, totX + totLblW, y, { width: totValW, align: 'right' });
    y += opts.big ? 22 : 16;
  };
  fila('Base imponible:', euroPDF(f.base_imponible));
  if (f.porcentaje_iva) fila(`IVA ${f.porcentaje_iva}%:`, euroPDF(f.importe_iva));
  if (f.porcentaje_retencion) fila(`Retención ${f.porcentaje_retencion}%:`, '-' + euroPDF(f.importe_retencion));
  doc.moveTo(totX, y).lineTo(right, y).strokeColor('#1a1a2e').lineWidth(1).stroke();
  y += 6;
  fila('TOTAL:', euroPDF(f.total), { bold: true, big: true });

  // ---- Notas + nota de autofactura ----
  if (f.notas) {
    y += 12;
    doc.font('Helvetica').fontSize(9).fillColor('#374151').text('Notas: ' + f.notas, M, y, { width: contentW });
    y = doc.y;
  }

  doc.end();
});

// GET /api/facturas/:id — factura + líneas.
router.get('/:id', (req, res) => {
  const factura = db.prepare('SELECT * FROM facturas WHERE id = ?').get(req.params.id);
  if (!factura) return res.status(404).json({ error: 'Factura no encontrada' });
  factura.lineas = db.prepare('SELECT * FROM factura_lineas WHERE factura_id = ? ORDER BY orden, id').all(factura.id);
  res.json(factura);
});

// POST /api/facturas — crear según el tipo.
router.post('/', (req, res) => {
  const body = req.body || {};
  if (!TIPOS.includes(body.tipo)) return res.status(400).json({ error: 'Tipo de factura no válido' });

  let construido;
  if (body.tipo === 'propietario') construido = construirPropietario(body, false);
  else if (body.tipo === 'autofactura') construido = construirPropietario(body, true);
  else if (body.tipo === 'gastos') construido = construirGastos(body);
  else if (body.tipo === 'mayorista') construido = construirMayorista(body);
  else construido = construirHuesped(body);

  if (construido.error) return res.status(400).json({ error: construido.error });
  const { f, lineas } = construido;

  // Metadatos comunes del body.
  f.serie = String(body.serie || 'F');
  f.fecha_emision = String(body.fecha_emision || '').trim() || hoyISO();
  f.anio = intOrNull(body.anio) || parseInt(f.fecha_emision.slice(0, 4), 10);
  f.estado = ESTADOS.includes(body.estado) ? body.estado : 'emitida';
  f.fecha_vencimiento = txt(body.fecha_vencimiento);
  if (body.notas) f.notas = f.notas ? `${f.notas}\n${body.notas}` : String(body.notas);
  f.created_by = (req.usuario && req.usuario.username) || null;

  calcularImportes(f);

  let r;
  try {
    r = insertarFactura(f, lineas);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  // Tipo mayorista: anotar el número de factura en cada pago facturado.
  if (f.tipo === 'mayorista' && Array.isArray(construido.pagoIds) && construido.pagoIds.length) {
    const upd = db.prepare('UPDATE mayorista_pagos SET numero_factura = ? WHERE id = ?');
    db.transaction(() => { for (const pid of construido.pagoIds) upd.run(r.numero, pid); })();
  }

  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'crear', 'factura', r.id, `${r.numero} (${f.tipo})`);
  res.status(201).json({ id: r.id, numero: r.numero });
});

// PUT /api/facturas/:id — solo estado / fecha_vencimiento / notas (no toca importes).
router.put('/:id', (req, res) => {
  const factura = db.prepare('SELECT id FROM facturas WHERE id = ?').get(req.params.id);
  if (!factura) return res.status(404).json({ error: 'Factura no encontrada' });
  const b = req.body || {};
  const sets = [];
  const vals = [];
  if (b.estado !== undefined) {
    if (!ESTADOS.includes(b.estado)) return res.status(400).json({ error: 'Estado no válido' });
    sets.push('estado = ?'); vals.push(b.estado);
  }
  if (b.fecha_vencimiento !== undefined) { sets.push('fecha_vencimiento = ?'); vals.push(txt(b.fecha_vencimiento)); }
  if (b.notas !== undefined) { sets.push('notas = ?'); vals.push(txt(b.notas)); }
  if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
  vals.push(req.params.id);
  db.prepare(`UPDATE facturas SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  res.json({ ok: true });
});

// PUT /api/facturas/:id/anular — marca anulada (no borra).
router.put('/:id/anular', (req, res) => {
  const factura = db.prepare('SELECT id, numero FROM facturas WHERE id = ?').get(req.params.id);
  if (!factura) return res.status(404).json({ error: 'Factura no encontrada' });
  db.prepare("UPDATE facturas SET estado = 'anulada' WHERE id = ?").run(req.params.id);
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'editar', 'factura', factura.id, `Anulada ${factura.numero}`);
  res.json({ ok: true });
});

// DELETE /api/facturas/:id — solo borradores.
router.delete('/:id', (req, res) => {
  const factura = db.prepare('SELECT estado FROM facturas WHERE id = ?').get(req.params.id);
  if (!factura) return res.status(404).json({ error: 'Factura no encontrada' });
  if (factura.estado !== 'borrador') {
    return res.status(409).json({ error: 'Solo se pueden eliminar facturas en borrador' });
  }
  db.prepare('DELETE FROM facturas WHERE id = ?').run(req.params.id); // líneas en CASCADE
  res.json({ ok: true });
});

module.exports = router;
