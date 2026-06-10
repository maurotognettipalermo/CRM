// Servicio de importación de propiedades en venta desde el Excel de Idealista.
//
// Cabeceras en la fila 1 (a diferencia del export de propietarios de Avantio, aquí no
// hay fila de título). Parseamos con header:1 (array de arrays) y mapeamos las columnas
// de forma flexible (case-insensitive, sin acentos). Upsert por `referencia`: si existe
// se actualizan los campos del Excel EXCEPTO estado/notas/descripcion (campos del CRM,
// no de Idealista). Nunca borra propiedades. Solo procesa filas de Venta.
const xlsx = require('xlsx');
const db = require('../db/database');
const { parseFecha } = require('./dateUtils');

// Cabecera normalizada del archivo -> campo interno de la BD.
// '_venta_alquiler' es una columna de control (no se guarda; sirve para filtrar Venta).
const MAPA = {
  referencia: 'referencia',
  ref: 'referencia',
  codigo: 'codigo_idealista',
  codigoidealista: 'codigo_idealista',
  tipo: 'tipo',
  nombredelacalle: 'calle',
  calle: 'calle',
  direccion: 'calle',
  num: 'numero',
  numero: 'numero',
  planta: 'planta',
  zona: 'zona',
  localidad: 'localidad',
  poblacion: 'localidad',
  precio: 'precio',
  dorm: 'dormitorios',
  dormitorios: 'dormitorios',
  habitaciones: 'dormitorios',
  banos: 'banos',
  banios: 'banos',
  m: 'metros_cuadrados',           // "m²" -> normaliza a "m"
  m2: 'metros_cuadrados',
  metros: 'metros_cuadrados',
  metroscuadrados: 'metros_cuadrados',
  mutiles: 'metros_utiles',        // "M² útiles" -> "mutiles"
  m2utiles: 'metros_utiles',
  metrosutiles: 'metros_utiles',
  claseenergetica: 'clase_energetica',
  capgaraje: 'garaje',
  garaje: 'garaje',
  numfotos: 'num_fotos',
  numerofotos: 'num_fotos',
  fotos: 'num_fotos',
  estado: 'estado_idealista',
  fechaalta: 'fecha_alta',
  fechabaja: 'fecha_baja',
  nombrepropietario: 'propietario_nombre',
  apellidospropietario: 'propietario_apellidos',
  telefono1: 'propietario_telefono',
  telefono: 'propietario_telefono',
  telefonopropietario: 'propietario_telefono',
  email: 'propietario_email',
  emailpropietario: 'propietario_email',
  ventaoalquiler: '_venta_alquiler',
  operacion: '_venta_alquiler',
};

const CAMPOS_FECHA = ['fecha_alta', 'fecha_baja'];
const CAMPOS_NUM_REAL = ['precio', 'metros_cuadrados', 'metros_utiles'];
const CAMPOS_NUM_INT = ['dormitorios', 'banos', 'num_fotos'];
// Campos del CRM que la importación NUNCA debe sobreescribir en un UPDATE.
const PROTEGIDOS_UPDATE = ['estado', 'notas', 'descripcion'];

function normalizaClave(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita acentos
    .replace(/[^a-z0-9]/g, '');      // quita espacios, signos, símbolos (²,€,...)
}

function limpia(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

// Convierte un valor a número admitiendo formato europeo ("150.000 €", "85,5", "1.234,56").
function aNumero(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  let s = String(v).trim().replace(/[€\s]/g, '');
  if (!s) return null;
  if (s.includes('.') && s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');      // . miles, , decimal
  } else if (s.includes(',')) {
    s = s.replace(',', '.');                          // , decimal
  } else if (s.includes('.')) {
    const partes = s.split('.');
    if (partes.length > 1 && partes.slice(1).every((p) => p.length === 3)) s = partes.join(''); // miles
  }
  s = s.replace(/[^0-9.\-]/g, '');
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}

function mapearCabeceras(headers) {
  return (headers || []).map((h) => MAPA[normalizaClave(h)] || null);
}

// Construye el objeto de campos internos de una fila (primer valor no nulo gana).
function mapearFila(fila, colCampo) {
  const datos = {};
  for (let c = 0; c < colCampo.length; c++) {
    const campo = colCampo[c];
    if (!campo) continue;
    const v = limpia(fila[c]);
    if (v !== null && datos[campo] == null) datos[campo] = v;
  }
  for (const f of CAMPOS_FECHA) {
    if (f in datos) {
      const iso = parseFecha(datos[f]);
      if (iso) datos[f] = iso; else delete datos[f];
    }
  }
  for (const f of CAMPOS_NUM_REAL) {
    if (f in datos) { const n = aNumero(datos[f]); if (n !== null) datos[f] = n; else delete datos[f]; }
  }
  for (const f of CAMPOS_NUM_INT) {
    if (f in datos) { const n = aNumero(datos[f]); if (n !== null) datos[f] = Math.round(n); else delete datos[f]; }
  }
  return datos;
}

function importarPropiedades(buffer) {
  // raw:true: las celdas llegan como texto/serial y las normalizamos nosotros.
  const wb = xlsx.read(buffer, { type: 'buffer', raw: true });
  const hoja = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(hoja, { header: 1, raw: true, blankrows: false });

  const resumen = { nuevas: 0, actualizadas: 0, errores: [] };
  if (rows.length === 0) return resumen;

  // Cabeceras en la fila 0.
  const colCampo = mapearCabeceras(rows[0]);
  const dataRows = rows.slice(1);

  const buscarPorRef = db.prepare('SELECT id FROM propiedades_venta WHERE referencia = ?');

  const tx = db.transaction(() => {
    dataRows.forEach((fila, i) => {
      const numFila = i + 2; // nº de fila real (1-based, cabecera en la 1)
      const datos = mapearFila(fila, colCampo);

      // Filtrar solo Venta (si la columna existe). Se descarta la columna de control.
      const operacion = datos._venta_alquiler;
      delete datos._venta_alquiler;
      if (operacion && normalizaClave(operacion) !== 'venta') return; // alquiler u otro: ignorar

      // Fila totalmente vacía: ignorar en silencio.
      if (Object.keys(datos).length === 0) return;

      if (!datos.referencia) {
        resumen.errores.push({ fila: numFila, referencia: null, motivo: 'Falta la referencia' });
        return;
      }

      try {
        const existente = buscarPorRef.get(datos.referencia);
        if (existente) {
          // UPDATE de los campos del Excel, sin pisar los del CRM ni la referencia.
          const claves = Object.keys(datos).filter((k) => k !== 'referencia' && !PROTEGIDOS_UPDATE.includes(k));
          if (claves.length) {
            const set = claves.map((c) => `${c} = @${c}`).join(', ');
            db.prepare(`UPDATE propiedades_venta SET ${set}, updated_at = datetime('now') WHERE id = @id`)
              .run({ ...datos, id: existente.id });
          }
          resumen.actualizadas++;
        } else {
          if (!datos.estado) datos.estado = 'Disponible';
          const claves = Object.keys(datos);
          const cols = claves.join(', ');
          const ph = claves.map((c) => '@' + c).join(', ');
          db.prepare(`INSERT INTO propiedades_venta (${cols}) VALUES (${ph})`).run(datos);
          resumen.nuevas++;
        }
      } catch (e) {
        resumen.errores.push({ fila: numFila, referencia: datos.referencia || null, motivo: e.message });
      }
    });
  });

  tx();
  return resumen;
}

module.exports = { importarPropiedades };
