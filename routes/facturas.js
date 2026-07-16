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

const TIPOS = ['huésped', 'propietario', 'autofactura', 'gastos', 'mayorista', 'libre', 'proforma', 'abono'];
const ESTADOS = ['borrador', 'emitida', 'parcialmente_pagada', 'pagada', 'anulada'];
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
  'proforma_convertida', 'factura_origen_id', 'factura_abonada_id',
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
    proforma_convertida: 0, factura_origen_id: null, factura_abonada_id: null,
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

// Numeración correlativa por año + serie (dentro de la transacción del INSERT). Cada serie
// lleva su propio contador, para que dos razones sociales con series distintas no choquen.
function siguienteNumeroFactura(anio, serie) {
  const s = serie || 'F';
  db.prepare('INSERT OR IGNORE INTO factura_contador (anio, serie, ultimo_numero) VALUES (?, ?, 0)').run(anio, s);
  db.prepare('UPDATE factura_contador SET ultimo_numero = ultimo_numero + 1 WHERE anio = ? AND serie = ?').run(anio, s);
  const n = db.prepare('SELECT ultimo_numero FROM factura_contador WHERE anio = ? AND serie = ?').get(anio, s).ultimo_numero;
  return `${s}-${anio}-${String(n).padStart(3, '0')}`;
}

// Serie a usar para una factura según la razón social emisora: si tiene una serie propia
// asignada (Ajustes > Razones sociales), esa; si no (o sin razón social), 'F' de siempre —
// así una razón social sin serie configurada sigue compartiendo la numeración legada.
function serieParaRazonSocial(razonSocialId) {
  if (razonSocialId == null) return 'F';
  const rs = db.prepare('SELECT serie FROM razones_sociales WHERE id = ?').get(razonSocialId);
  const serie = rs && rs.serie ? String(rs.serie).trim() : '';
  return serie || 'F';
}

// Serie para autofacturas: el emisor legal es el propietario, no la razón social receptora,
// así que cada propietario (por CIF/NIF) lleva su propia numeración, independiente de la
// serie de la razón social y del resto de propietarios. 'AF-SINCIF' es un colchón compartido
// solo para autofacturas legadas por contrato de propietarios sin CIF/NIF en su ficha.
function serieAutofactura(cif) {
  const limpio = String(cif || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return limpio ? `AF-${limpio}` : 'AF-SINCIF';
}

// Numeración propia de proformas (PRO-AAAA-NNN), independiente del contador de facturas.
// Se deriva del mayor sufijo existente del año (UNIQUE de numero protege ante carreras).
function siguienteNumeroProforma(anio) {
  const filas = db.prepare("SELECT numero FROM facturas WHERE tipo = 'proforma' AND anio = ?").all(anio);
  let max = 0;
  for (const r of filas) {
    const m = /(\d+)$/.exec(r.numero || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `PRO-${anio}-${String(max + 1).padStart(3, '0')}`;
}

// Inserta factura + líneas en una transacción, fijando el número correlativo.
const insertarFactura = db.transaction((f, lineas) => {
  if (f.tipo === 'abono') f.serie = serieParaRazonSocial(f.razon_social_id) + '-A';
  else if (f.tipo === 'autofactura') f.serie = serieAutofactura(f.emisor_cif);
  else if (f.tipo !== 'proforma') f.serie = serieParaRazonSocial(f.razon_social_id);
  f.numero = f.tipo === 'proforma' ? siguienteNumeroProforma(f.anio) : siguienteNumeroFactura(f.anio, f.serie);
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

  const yaFacturadas = cuotas.filter((c) => c.factura_id);
  if (yaFacturadas.length) {
    return {
      error: `La(s) cuota(s) ${yaFacturadas.map((c) => c.numero_cuota).join(', ')} ya tienen una factura emitida`,
      status: 409,
    };
  }

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
  return { f, lineas, cuotaIds: cuotas.map((c) => c.id) };
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

// Factura libre: emisor = razón social elegida; receptor, líneas y fiscalidad 100% manuales.
// Sin contrato/apartamento/propietario/reserva (quedan a null).
function construirLibre(body) {
  const rs = db.prepare('SELECT * FROM razones_sociales WHERE id = ?').get(intOrNull(body.razon_social_id));
  if (!rs) return { error: 'Razón social no válida' };

  const receptorNombre = String(body.receptor_nombre || '').trim();
  if (!receptorNombre) return { error: 'El nombre del receptor es obligatorio' };

  const lineas = (Array.isArray(body.lineas) ? body.lineas : [])
    .map((l) => {
      const cantidad = l.cantidad != null && l.cantidad !== '' ? num(l.cantidad) : 1;
      const precio = round2(l.precio_unitario);
      return {
        descripcion: String(l.descripcion || '').trim(),
        cantidad,
        precio_unitario: precio,
        importe: round2(cantidad * precio),
      };
    })
    .filter((l) => l.descripcion || l.importe);
  if (!lineas.length) return { error: 'Añade al menos una línea de factura' };

  const f = nuevaFactura();
  f.tipo = 'libre';
  f.porcentaje_iva = num(body.porcentaje_iva);
  f.porcentaje_retencion = num(body.porcentaje_retencion);
  f.base_imponible = lineas.reduce((s, l) => s + l.importe, 0);
  Object.assign(f, emisorDeRazon(rs));
  f.receptor_nombre = receptorNombre;
  f.receptor_cif = txt(body.receptor_cif) || null;
  f.receptor_direccion = txt(body.receptor_direccion) || null;
  f.receptor_email = txt(body.receptor_email) || null;
  return { f, lineas };
}

// Autofactura libre: como 'libre' pero emisor/receptor invertidos — el manual es el emisor
// (el propietario), el receptor es siempre la razón social elegida. Sin contrato/cuotas.
function construirAutofacturaLibre(body) {
  const rs = db.prepare('SELECT * FROM razones_sociales WHERE id = ?').get(intOrNull(body.razon_social_id));
  if (!rs) return { error: 'Razón social no válida' };

  const emisorNombre = String(body.emisor_nombre || '').trim();
  if (!emisorNombre) return { error: 'El nombre del emisor es obligatorio' };
  const emisorCif = String(body.emisor_cif || '').trim();
  if (!emisorCif) return { error: 'El CIF/NIF del propietario es obligatorio para calcular su numeración' };

  const lineas = (Array.isArray(body.lineas) ? body.lineas : [])
    .map((l) => {
      const cantidad = l.cantidad != null && l.cantidad !== '' ? num(l.cantidad) : 1;
      const precio = round2(l.precio_unitario);
      return {
        descripcion: String(l.descripcion || '').trim(),
        cantidad,
        precio_unitario: precio,
        importe: round2(cantidad * precio),
      };
    })
    .filter((l) => l.descripcion || l.importe);
  if (!lineas.length) return { error: 'Añade al menos una línea de factura' };

  const f = nuevaFactura();
  f.tipo = 'autofactura';
  f.razon_social_id = rs.id;
  f.porcentaje_iva = num(body.porcentaje_iva);
  f.porcentaje_retencion = num(body.porcentaje_retencion);
  f.base_imponible = lineas.reduce((s, l) => s + l.importe, 0);
  f.emisor_nombre = emisorNombre;
  f.emisor_cif = emisorCif;
  f.emisor_direccion = txt(body.emisor_direccion) || null;
  f.emisor_email = txt(body.emisor_email) || null;
  f.receptor_nombre = rs.razon_social || rs.nombre_comercial || '';
  f.receptor_cif = rs.cif_nif || null;
  f.receptor_direccion = direccionRazon(rs);
  f.receptor_email = rs.email_contacto || null;
  return { f, lineas };
}

// Proforma: idéntica a 'libre' (receptor manual, líneas, IVA/retención configurables).
// Solo cambian el tipo y la numeración (PRO-AAAA-NNN, vía insertarFactura).
function construirProforma(body) {
  const construido = construirLibre(body);
  if (construido.error) return construido;
  construido.f.tipo = 'proforma';
  return construido;
}

// Crea una autofactura a partir de un pago a propietario suelto (concepto + importe).
// Emisor = propietario activo del apartamento; receptor = la razón social indicada o, si no,
// la predeterminada (primera por id). IVA 0%, retención 19% (IRPF propietario residente).
// Devuelve { id, numero } o lanza Error. Reutilizada por routes/apartamentos.js.
function crearAutofacturaPago({ apartamento_id, concepto, importe, razon_social_id, anio, fecha_emision, created_by }) {
  const apto = db.prepare('SELECT * FROM apartamentos WHERE id = ?').get(intOrNull(apartamento_id));
  if (!apto) throw new Error('Apartamento no encontrado');

  let rs = razon_social_id != null && razon_social_id !== ''
    ? db.prepare('SELECT * FROM razones_sociales WHERE id = ?').get(intOrNull(razon_social_id)) : null;
  if (!rs) rs = db.prepare('SELECT * FROM razones_sociales ORDER BY id LIMIT 1').get();
  if (!rs) throw new Error('No hay ninguna razón social configurada');

  const propietario = db.prepare(`
    SELECT p.* FROM apartamento_propietarios ap
    JOIN propietarios p ON p.id = ap.propietario_id
    WHERE ap.apartamento_id = ? AND ap.activo = 1
    ORDER BY ap.porcentaje DESC, ap.fecha_inicio ASC, ap.id ASC
    LIMIT 1
  `).get(apto.id);
  if (!propietario) throw new Error('El apartamento no tiene propietario activo');

  const imp = round2(importe);
  const lineas = [{ descripcion: String(concepto || 'Pago a propietario'), cantidad: 1, precio_unitario: imp, importe: imp }];

  const f = nuevaFactura();
  f.tipo = 'autofactura';
  f.apartamento_id = apto.id;
  f.propietario_id = propietario.id;
  f.porcentaje_iva = 0;          // pagos a propietario sin IVA por defecto
  f.porcentaje_retencion = 19;   // IRPF estándar propietario residente
  f.base_imponible = imp;
  // Autofactura: emisor = propietario, receptor = nuestra razón social.
  f.razon_social_id = rs.id;
  f.emisor_nombre = nombrePropietario(propietario);
  f.emisor_cif = cifPropietario(propietario);
  f.emisor_direccion = direccionPropietario(propietario);
  f.emisor_logo_url = null;
  f.receptor_nombre = rs.razon_social || rs.nombre_comercial || '';
  f.receptor_cif = rs.cif_nif || null;
  f.receptor_direccion = direccionRazon(rs);
  f.receptor_email = rs.email_contacto || null;
  f.fecha_emision = String(fecha_emision || '').trim() || hoyISO();
  f.anio = intOrNull(anio) || parseInt(f.fecha_emision.slice(0, 4), 10);
  f.estado = 'emitida';
  f.created_by = created_by || null;
  calcularImportes(f);
  return insertarFactura(f, lineas);
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
    SELECT f.*, rs.logo_url AS razon_logo_url,
           a.nombre AS apartamento_nombre,
           p.nombre AS propietario_nombre, p.apellidos AS propietario_apellidos, p.segundo_apellido AS propietario_segundo_apellido
    FROM facturas f
    LEFT JOIN razones_sociales rs ON rs.id = f.razon_social_id
    LEFT JOIN apartamentos a ON a.id = f.apartamento_id
    LEFT JOIN propietarios p ON p.id = f.propietario_id
    ${where}
    ORDER BY f.fecha_emision DESC, f.id DESC
  `).all(...params));
});

// GET /api/facturas/:id/pdf — genera el PDF de la factura con pdfkit (sin Chrome).
// Estilo minimalista: sin cajas de color, cabeceras en negrita + línea fina, caja de
// totales con borde. La nota_pie es de razones_sociales, no de la factura — se trae con
// un LEFT JOIN (una factura puede no tener razon_social_id, ej. autofactura libre).
router.get('/:id/pdf', (req, res) => {
  const f = db.prepare(
    'SELECT f.*, rs.nota_pie AS rs_nota_pie FROM facturas f ' +
    'LEFT JOIN razones_sociales rs ON rs.id = f.razon_social_id WHERE f.id = ?'
  ).get(req.params.id);
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

  // ---- Cabecera: logo + emisor (izquierda) — "FACTURA" / Nº / Fecha (derecha) ----
  const topRightW = 200;
  const emisorW = right - topRightW - 15 - M;

  const logo = leerLogoBuffer(f.emisor_logo_url);
  let logoY = y; // si no hay logo, el texto del emisor arranca en la misma posición
  if (logo) {
    try { doc.image(logo, M, y, { fit: [120, 60] }); logoY = y + 68; } catch (e) { /* logo inválido */ }
  }
  doc.font('Helvetica').fontSize(9).fillColor('#000000');
  let ey = logoY;
  [f.emisor_nombre, f.emisor_cif, f.emisor_direccion].filter(Boolean).forEach((t) => { doc.text(String(t), M, ey, { width: emisorW }); ey = doc.y + 2; });

  doc.font('Helvetica-Bold').fontSize(11).fillColor('#6b7280').text('FACTURA', right - topRightW, y, { width: topRightW, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(15).fillColor('#000000').text(`Nº: ${f.numero}`, right - topRightW, y + 15, { width: topRightW, align: 'right' });
  let infoY = y + 37;
  doc.font('Helvetica').fontSize(9).fillColor('#6b7280').text(`Fecha: ${fechaPDF(f.fecha_emision)}`, right - topRightW, infoY, { width: topRightW, align: 'right' });
  infoY += 12;
  if (f.fecha_vencimiento) { doc.text(`Vencimiento: ${fechaPDF(f.fecha_vencimiento)}`, right - topRightW, infoY, { width: topRightW, align: 'right' }); infoY += 12; }

  y = Math.max(ey, infoY) + 10;

  // ---- Datos cliente ----
  doc.moveTo(M, y).lineTo(right, y).strokeColor('#e5e7eb').lineWidth(1).stroke();
  y += 12;
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000000').text('Datos cliente', M, y);
  doc.font('Helvetica').fontSize(9).fillColor('#000000');
  let ry = y + 16;
  const colW = contentW / 2;
  [f.receptor_nombre, f.receptor_cif, f.receptor_direccion, f.receptor_email].filter(Boolean).forEach((t) => { doc.text(String(t), M, ry, { width: colW }); ry = doc.y + 2; });
  y = ry + 12;

  // ---- Tabla de líneas ----
  const cDesc = M;
  const cCant = M + contentW * 0.56;
  const cUnit = M + contentW * 0.70;
  const cImp = M + contentW * 0.85;
  const wDesc = cCant - cDesc - 8;
  const wCant = cUnit - cCant - 6;
  const wUnit = cImp - cUnit - 6;
  const wImp = right - cImp - 4;

  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(9);
  doc.text('CONCEPTO', cDesc, y, { width: wDesc });
  doc.text('CANT', cCant, y, { width: wCant, align: 'right' });
  doc.text('P. UNIT', cUnit, y, { width: wUnit, align: 'right' });
  doc.text('IMPORTE', cImp, y, { width: wImp, align: 'right' });
  y += 16;
  doc.moveTo(M, y).lineTo(right, y).strokeColor('#e5e7eb').lineWidth(1).stroke();
  y += 6;

  doc.font('Helvetica').fontSize(9).fillColor('#000000');
  lineas.forEach((l) => {
    const dh = doc.heightOfString(String(l.descripcion || ''), { width: wDesc });
    const h = Math.max(18, dh + 10);
    if (y + h > doc.page.height - M) { doc.addPage(); y = M; }
    doc.fillColor('#000000');
    doc.text(String(l.descripcion || ''), cDesc, y + 4, { width: wDesc });
    doc.text(cantidadPDF(l.cantidad), cCant, y + 4, { width: wCant, align: 'right' });
    doc.text(euroPDF(l.precio_unitario), cUnit, y + 4, { width: wUnit, align: 'right' });
    doc.text(euroPDF(l.importe), cImp, y + 4, { width: wImp, align: 'right' });
    y += h;
    doc.moveTo(M, y).lineTo(right, y).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
  });

  // ---- Totales: caja con borde + líneas divisorias internas ----
  y += 14;
  const totX = right - 240;
  const totLblW = 150;
  const totValW = 90;
  const boxLeft = totX - 12;
  const boxW = right - boxLeft;
  const rowH = 16;
  const totalRowH = 26;
  const padTop = 10;

  const filasBase = [{ label: 'Base imponible:', val: euroPDF(f.base_imponible) }];
  if (f.porcentaje_iva) filasBase.push({ label: `IVA ${f.porcentaje_iva}%:`, val: euroPDF(f.importe_iva) });
  if (f.porcentaje_retencion) filasBase.push({ label: `Retención ${f.porcentaje_retencion}%:`, val: '-' + euroPDF(f.importe_retencion) });

  const boxH = padTop + filasBase.length * rowH + totalRowH + 6;
  if (y + boxH > doc.page.height - M) { doc.addPage(); y = M; }
  const boxTop = y;
  doc.rect(boxLeft, boxTop, boxW, boxH).strokeColor('#e5e7eb').lineWidth(1).stroke();

  let ty = boxTop + padTop;
  filasBase.forEach((r) => {
    doc.font('Helvetica').fontSize(10).fillColor('#000000');
    doc.text(r.label, totX, ty, { width: totLblW, align: 'right' });
    doc.text(r.val, totX + totLblW, ty, { width: totValW, align: 'right' });
    ty += rowH;
    doc.moveTo(boxLeft + 10, ty - 4).lineTo(boxLeft + boxW - 10, ty - 4).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
  });
  doc.moveTo(boxLeft + 10, ty).lineTo(boxLeft + boxW - 10, ty).strokeColor('#1a1a2e').lineWidth(1).stroke();
  doc.font('Helvetica-Bold').fontSize(14).fillColor('#000000');
  doc.text('TOTAL:', totX, ty + 6, { width: totLblW, align: 'right' });
  doc.text(euroPDF(f.total), totX + totLblW, ty + 6, { width: totValW, align: 'right' });

  y = boxTop + boxH + 14;

  // ---- Notas de la factura ----
  if (f.notas) {
    doc.font('Helvetica').fontSize(9).fillColor('#374151').text('Notas: ' + f.notas, M, y, { width: contentW });
    y = doc.y;
  }

  // ---- Nota de pie de la razón social (solo si está rellena) ----
  if (f.rs_nota_pie && String(f.rs_nota_pie).trim()) {
    y += 16;
    doc.moveTo(M, y).lineTo(right, y).strokeColor('#e5e7eb').lineWidth(1).stroke();
    y += 10;
    doc.font('Helvetica').fontSize(8).fillColor('#6b7280').text(String(f.rs_nota_pie), M, y, { width: contentW });
  }

  doc.end();
});

// GET /api/facturas/:id — factura + líneas.
router.get('/:id', (req, res) => {
  const factura = db.prepare('SELECT * FROM facturas WHERE id = ?').get(req.params.id);
  if (!factura) return res.status(404).json({ error: 'Factura no encontrada' });
  factura.lineas = db.prepare('SELECT * FROM factura_lineas WHERE factura_id = ? ORDER BY orden, id').all(factura.id);
  // Proforma convertida: adjunta la factura resultante (para el enlace del panel).
  if (factura.tipo === 'proforma') {
    factura.convertida_en = db.prepare('SELECT id, numero FROM facturas WHERE factura_origen_id = ?').get(factura.id) || null;
  }
  // Abono: adjunta la factura original que rectifica.
  if (factura.factura_abonada_id) {
    factura.abona_a = db.prepare('SELECT id, numero FROM facturas WHERE id = ?').get(factura.factura_abonada_id) || null;
  }
  // Cualquier factura puede tener uno o varios abonos (parciales) sobre ella.
  factura.abonos = db.prepare('SELECT id, numero, total, fecha_emision FROM facturas WHERE factura_abonada_id = ?').all(factura.id);
  res.json(factura);
});

// POST /api/facturas — crear según el tipo.
router.post('/', (req, res) => {
  const body = req.body || {};
  if (!TIPOS.includes(body.tipo)) return res.status(400).json({ error: 'Tipo de factura no válido' });

  let construido;
  if (body.tipo === 'propietario') construido = construirPropietario(body, false);
  else if (body.tipo === 'autofactura' && body.modo === 'libre') construido = construirAutofacturaLibre(body);
  else if (body.tipo === 'autofactura') construido = construirPropietario(body, true);
  else if (body.tipo === 'gastos') construido = construirGastos(body);
  else if (body.tipo === 'mayorista') construido = construirMayorista(body);
  else if (body.tipo === 'libre') construido = construirLibre(body);
  else if (body.tipo === 'proforma') construido = construirProforma(body);
  else construido = construirHuesped(body);

  if (construido.error) return res.status(construido.status || 400).json({ error: construido.error });
  const { f, lineas } = construido;

  // Metadatos comunes del body.
  f.serie = f.tipo === 'proforma' ? 'PRO' : String(body.serie || 'F');
  f.fecha_emision = String(body.fecha_emision || '').trim() || hoyISO();
  f.anio = intOrNull(body.anio) || parseInt(f.fecha_emision.slice(0, 4), 10);
  f.estado = ESTADOS.includes(body.estado) ? body.estado : 'emitida';
  f.fecha_vencimiento = txt(body.fecha_vencimiento);
  if (body.notas) f.notas = f.notas ? `${f.notas}\n${body.notas}` : String(body.notas);
  f.created_by = (req.usuario && req.usuario.username) || null;

  calcularImportes(f);

  let r;
  try {
    r = db.transaction(() => {
      const creada = insertarFactura(f, lineas);
      if (Array.isArray(construido.cuotaIds) && construido.cuotaIds.length) {
        const ph = construido.cuotaIds.map(() => '?').join(',');
        db.prepare(`UPDATE contrato_cuotas SET factura_id = ? WHERE id IN (${ph})`).run(creada.id, ...construido.cuotaIds);
      }
      return creada;
    })();
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

// POST /api/facturas/:id/convertir-proforma — solo admin. Copia la proforma en una factura
// 'libre' con numeración normal F-AAAA-NNN; marca la proforma como convertida.
router.post('/:id/convertir-proforma', (req, res) => {
  if (!(req.usuario && req.usuario.rol === 'administrador')) {
    return res.status(403).json({ error: 'Solo los administradores pueden convertir proformas' });
  }
  const prof = db.prepare('SELECT * FROM facturas WHERE id = ?').get(req.params.id);
  if (!prof) return res.status(404).json({ error: 'Factura no encontrada' });
  if (prof.tipo !== 'proforma') return res.status(400).json({ error: 'La factura no es una proforma' });
  if (prof.proforma_convertida) return res.status(409).json({ error: 'La proforma ya fue convertida' });

  const lineas = db.prepare('SELECT * FROM factura_lineas WHERE factura_id = ? ORDER BY orden, id').all(prof.id)
    .map((l, i) => ({ descripcion: l.descripcion, cantidad: l.cantidad, precio_unitario: l.precio_unitario, importe: l.importe, orden: l.orden != null ? l.orden : i }));

  const f = nuevaFactura();
  Object.assign(f, {
    serie: 'F', tipo: 'libre', estado: 'emitida',
    anio: prof.anio, fecha_emision: hoyISO(), fecha_vencimiento: prof.fecha_vencimiento,
    razon_social_id: prof.razon_social_id,
    emisor_nombre: prof.emisor_nombre, emisor_cif: prof.emisor_cif,
    emisor_direccion: prof.emisor_direccion, emisor_logo_url: prof.emisor_logo_url,
    receptor_nombre: prof.receptor_nombre, receptor_cif: prof.receptor_cif,
    receptor_direccion: prof.receptor_direccion, receptor_email: prof.receptor_email,
    base_imponible: prof.base_imponible, porcentaje_iva: prof.porcentaje_iva, porcentaje_retencion: prof.porcentaje_retencion,
    notas: prof.notas, created_by: (req.usuario && req.usuario.username) || null,
    factura_origen_id: prof.id,
  });
  calcularImportes(f);

  let r;
  try {
    r = db.transaction(() => {
      const creada = insertarFactura(f, lineas);
      db.prepare('UPDATE facturas SET proforma_convertida = 1 WHERE id = ?').run(prof.id);
      return creada;
    })();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'crear', 'factura', r.id, `${r.numero} (proforma ${prof.numero})`);
  res.status(201).json({ ok: true, factura_id: r.id, numero_factura: r.numero });
});

// POST /api/facturas/:id/abono — genera un abono (nota de crédito) de una factura existente.
// Copia sus líneas en negativo (o las que traiga el body, para un abono parcial), vinculado
// vía factura_abonada_id. La serie con sufijo "-A" ya la fija insertarFactura para tipo 'abono'.
router.post('/:id/abono', (req, res) => {
  const origen = db.prepare('SELECT * FROM facturas WHERE id = ?').get(req.params.id);
  if (!origen) return res.status(404).json({ error: 'Factura no encontrada' });
  if (origen.tipo === 'proforma') {
    return res.status(400).json({ error: 'No se puede abonar una proforma; conviértela en factura primero' });
  }
  if (origen.tipo === 'abono') return res.status(400).json({ error: 'No se puede abonar un abono' });
  if (origen.estado === 'anulada') return res.status(409).json({ error: 'La factura ya está anulada' });
  if (origen.estado === 'borrador') {
    return res.status(400).json({ error: 'No se puede abonar un borrador; primero hay que emitirlo' });
  }

  const b = req.body || {};
  let lineas;
  if (Array.isArray(b.lineas)) {
    lineas = b.lineas.map((l, i) => ({
      descripcion: String(l.descripcion || '').trim(),
      cantidad: l.cantidad != null ? num(l.cantidad) : 1,
      precio_unitario: round2(l.precio_unitario),
      importe: round2(l.importe),
      orden: l.orden != null ? l.orden : i,
    }));
  } else {
    lineas = db.prepare('SELECT * FROM factura_lineas WHERE factura_id = ? ORDER BY orden, id').all(origen.id)
      .map((l, i) => ({
        descripcion: l.descripcion, cantidad: l.cantidad,
        precio_unitario: round2(-l.precio_unitario), importe: round2(-l.importe),
        orden: l.orden != null ? l.orden : i,
      }));
  }

  const f = nuevaFactura();
  Object.assign(f, {
    tipo: 'abono', estado: 'emitida',
    anio: parseInt(hoyISO().slice(0, 4), 10), fecha_emision: hoyISO(),
    razon_social_id: origen.razon_social_id,
    emisor_nombre: origen.emisor_nombre, emisor_cif: origen.emisor_cif,
    emisor_direccion: origen.emisor_direccion, emisor_logo_url: origen.emisor_logo_url,
    receptor_nombre: origen.receptor_nombre, receptor_cif: origen.receptor_cif,
    receptor_direccion: origen.receptor_direccion, receptor_email: origen.receptor_email,
    contrato_id: origen.contrato_id, apartamento_id: origen.apartamento_id,
    propietario_id: origen.propietario_id, reserva_id: origen.reserva_id,
    porcentaje_iva: origen.porcentaje_iva, porcentaje_retencion: origen.porcentaje_retencion,
    base_imponible: lineas.reduce((s, l) => s + l.importe, 0),
    notas: b.motivo ? `Abono de la factura ${origen.numero}. ${b.motivo}` : `Abono de la factura ${origen.numero}`,
    created_by: (req.usuario && req.usuario.username) || null,
    factura_abonada_id: origen.id,
  });
  calcularImportes(f);

  let r;
  try {
    r = insertarFactura(f, lineas);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'crear', 'factura', r.id, `${r.numero} (abono de ${origen.numero})`);
  res.status(201).json({ id: r.id, numero: r.numero });
});

// PUT /api/facturas/:id — edición completa (solo administradores): emisor, receptor,
// fechas, estado, notas, importes y líneas. Si vienen `lineas`, se reemplazan todas y los
// importes se recalculan desde ellas (la base manda). Campos NOT NULL conservan su valor
// si llegan vacíos.
router.put('/:id', (req, res) => {
  const b = req.body || {};
  // Los no administradores solo pueden tocar estado/fecha_vencimiento/notas (p. ej. "marcar
  // pagada"); cualquier otro campo (líneas, importes, emisor, receptor…) exige rol admin.
  if (!req.usuario || req.usuario.rol !== 'administrador') {
    const PERMITIDOS_NO_ADMIN = ['estado', 'fecha_vencimiento', 'notas'];
    const tieneOtros = Object.keys(b).some((k) => !PERMITIDOS_NO_ADMIN.includes(k));
    if (tieneOtros) {
      return res.status(403).json({ error: 'Solo los administradores pueden editar facturas' });
    }
  }
  const factura = db.prepare('SELECT * FROM facturas WHERE id = ?').get(req.params.id);
  if (!factura) return res.status(404).json({ error: 'Factura no encontrada' });
  if (b.estado !== undefined && b.estado !== null && b.estado !== '' && !ESTADOS.includes(b.estado)) {
    return res.status(400).json({ error: 'Estado no válido' });
  }
  if (b.numero !== undefined && txt(b.numero) !== factura.numero) {
    const nuevoNumero = txt(b.numero);
    if (!nuevoNumero) return res.status(400).json({ error: 'El número de factura no puede quedar vacío' });
    const dup = db.prepare('SELECT id FROM facturas WHERE numero = ? AND id <> ?').get(nuevoNumero, factura.id);
    if (dup) return res.status(409).json({ error: 'Ya existe otra factura con ese número' });
  }
  const lineasNuevas = Array.isArray(b.lineas) ? b.lineas : null;

  // Campos de texto/fecha/estado editables (los no enviados conservan su valor).
  const STR = ['numero', 'emisor_nombre', 'emisor_cif', 'emisor_direccion', 'receptor_nombre',
    'receptor_cif', 'receptor_direccion', 'receptor_email', 'fecha_emision', 'fecha_vencimiento', 'notas', 'estado'];
  const f = {};
  for (const k of STR) f[k] = (b[k] !== undefined) ? txt(b[k]) : factura[k];

  // Porcentajes: del body o conservados.
  const pIva = b.porcentaje_iva !== undefined ? num(b.porcentaje_iva) : num(factura.porcentaje_iva);
  const pRet = b.porcentaje_retencion !== undefined ? num(b.porcentaje_retencion) : num(factura.porcentaje_retencion);
  f.porcentaje_iva = pIva;
  f.porcentaje_retencion = pRet;

  if (lineasNuevas) {
    // Recalcular importes desde las líneas (la suma manda).
    const base = round2(lineasNuevas.reduce((s, l) => s + (round2(l.importe) || 0), 0));
    f.base_imponible = base;
    f.importe_iva = round2(base * pIva / 100);
    f.importe_retencion = round2(base * pRet / 100);
    f.total = round2(base + f.importe_iva - f.importe_retencion);
  } else {
    // Sin líneas: aceptar importes del body o conservar.
    f.base_imponible = b.base_imponible !== undefined ? round2(b.base_imponible) : round2(factura.base_imponible);
    f.importe_iva = b.importe_iva !== undefined ? round2(b.importe_iva) : round2(factura.importe_iva);
    f.importe_retencion = b.importe_retencion !== undefined ? round2(b.importe_retencion) : round2(factura.importe_retencion);
    f.total = b.total !== undefined ? round2(b.total) : round2(factura.total);
  }

  // Columnas NOT NULL: conservar el valor anterior si llega vacío.
  if (!f.emisor_nombre) f.emisor_nombre = factura.emisor_nombre;
  if (!f.receptor_nombre) f.receptor_nombre = factura.receptor_nombre;
  if (!f.fecha_emision) f.fecha_emision = factura.fecha_emision;
  if (!f.estado) f.estado = factura.estado;

  const COLS_UPD = ['numero', 'emisor_nombre', 'emisor_cif', 'emisor_direccion',
    'receptor_nombre', 'receptor_cif', 'receptor_direccion', 'receptor_email',
    'base_imponible', 'porcentaje_iva', 'importe_iva', 'porcentaje_retencion', 'importe_retencion', 'total',
    'fecha_emision', 'fecha_vencimiento', 'notas', 'estado'];

  const tx = db.transaction(() => {
    db.prepare(`UPDATE facturas SET ${COLS_UPD.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`)
      .run({ ...f, id: factura.id });
    if (lineasNuevas) {
      db.prepare('DELETE FROM factura_lineas WHERE factura_id = ?').run(factura.id);
      const ins = db.prepare(
        'INSERT INTO factura_lineas (factura_id, descripcion, cantidad, precio_unitario, importe, orden) VALUES (?, ?, ?, ?, ?, ?)'
      );
      lineasNuevas.forEach((l, i) => ins.run(
        factura.id, txt(l.descripcion) || '', l.cantidad != null ? num(l.cantidad) : 1,
        round2(l.precio_unitario), round2(l.importe), l.orden != null ? l.orden : i));
    }
    // Marcar 'pagada' a mano no debe dejar la suma de factura_pagos en 0: si el body trae
    // estado pagada y los pagos existentes no cubren el total, se completa la diferencia con
    // un pago "manual" para que fc_pagado/fv_pagado y "Pagos registrados" no contradigan al
    // badge. Se comprueba en cada guardado (no solo en la transición), porque el formulario
    // de edición manda el estado actual aunque no se haya tocado el desplegable; la propia
    // comparación suma-vs-total ya evita duplicar si el pago ya estaba cubierto.
    if (f.estado === 'pagada') {
      const suma = db.prepare('SELECT COALESCE(SUM(importe), 0) AS s FROM factura_pagos WHERE factura_id = ?')
        .get(factura.id).s;
      const diferencia = round2(f.total - suma);
      if (diferencia > 0.01) {
        db.prepare(`
          INSERT INTO factura_pagos (factura_id, importe, fecha_pago, metodo_pago, notas)
          VALUES (?, ?, ?, NULL, ?)
        `).run(factura.id, diferencia, new Date().toISOString().slice(0, 10), 'Marcada como pagada manualmente');
      }
    }
  });
  try { tx(); } catch (e) { return res.status(500).json({ error: e.message }); }
  registrarActividad(db, req.usuario.id, req.usuario.nombre, 'editar', 'factura', factura.id, `Editada ${factura.numero}`);
  res.json({ ok: true });
});

// PUT /api/facturas/:id/anular — marca anulada (no borra).
router.put('/:id/anular', (req, res) => {
  const factura = db.prepare('SELECT id, numero FROM facturas WHERE id = ?').get(req.params.id);
  if (!factura) return res.status(404).json({ error: 'Factura no encontrada' });
  db.transaction(() => {
    db.prepare("UPDATE facturas SET estado = 'anulada' WHERE id = ?").run(req.params.id);
    // Libera las cuotas de contrato facturadas por esta autofactura/factura de propietario,
    // para que puedan volver a facturarse.
    db.prepare('UPDATE contrato_cuotas SET factura_id = NULL WHERE factura_id = ?').run(req.params.id);
  })();
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'editar', 'factura', factura.id, `Anulada ${factura.numero}`);
  res.json({ ok: true });
});

// DELETE /api/facturas/:id — borradores (cualquiera) o anuladas (solo administrador; borrado
// definitivo, deja hueco en la numeración correlativa a propósito).
router.delete('/:id', (req, res) => {
  const factura = db.prepare('SELECT id, numero, tipo, estado FROM facturas WHERE id = ?').get(req.params.id);
  if (!factura) return res.status(404).json({ error: 'Factura no encontrada' });
  if (factura.estado === 'anulada') {
    if (!(req.usuario && req.usuario.rol === 'administrador')) {
      return res.status(403).json({ error: 'Solo un administrador puede eliminar definitivamente un documento anulado' });
    }
  } else if (factura.estado !== 'borrador') {
    return res.status(409).json({ error: 'Solo se pueden eliminar facturas en borrador o ya anuladas — anula esta factura primero si quieres eliminarla definitivamente' });
  }
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'eliminar', 'factura', factura.id, `${factura.numero} (${factura.tipo})`);
  db.prepare('DELETE FROM facturas WHERE id = ?').run(req.params.id); // líneas en CASCADE
  res.json({ ok: true });
});

module.exports = router;
// Helper reutilizable por otros routers (p. ej. apartamentos → pagos a propietario).
module.exports.crearAutofacturaPago = crearAutofacturaPago;
