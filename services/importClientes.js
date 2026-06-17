// Servicio de importación de clientes (huéspedes) desde el export de Avantio.
//
// El archivo es HTML disfrazado de .xls; SheetJS parsea correctamente las tablas HTML.
// Estructura Avantio: fila 0 -> título ("Lista"), fila 1 -> cabeceras, fila 2+ -> datos.
// Parseamos con header:1 (array de arrays) y detectamos la fila de cabeceras.
//
// Mapeo flexible (case-insensitive, sin acentos). Upsert por id_avantio: si existe se
// actualiza (sin pisar `observaciones`); si no, se inserta. Nunca borra.
const xlsx = require('xlsx');
const db = require('../db/database');
const { parseFecha } = require('./dateUtils');

// Cabecera normalizada del archivo -> campo interno (incluye sinónimos).
const MAPA = {
  idcliente: 'id_avantio',
  id: 'id_avantio',
  nombre: 'nombre',
  primerapellido: 'apellido1',
  apellido1: 'apellido1',
  apellido: 'apellido1',
  segundoapellido: 'apellido2',
  apellido2: 'apellido2',
  fechanacimiento: 'fecha_nacimiento',
  fechadenacimiento: 'fecha_nacimiento',
  sexo: 'sexo',
  nacionalidadpais: 'nacionalidad',
  nacionalidad: 'nacionalidad',
  calle: 'calle',
  numero: 'numero',
  puerta: 'puerta',
  codigopostal: 'codigo_postal',
  cp: 'codigo_postal',
  ciudad: 'ciudad',
  poblacion: 'ciudad',
  provincia: 'provincia',
  pais: 'pais',
  dniid: 'dni',
  dni: 'dni',
  nie: 'dni',
  nif: 'dni',
  documento: 'dni',
  email: 'email',
  correoelectronico: 'email',
  emailalternativo: 'email2',
  email2: 'email2',
  telefono: 'telefono',
  telefonoalternativo1: 'telefono2',
  telefonoalternativo: 'telefono2',
  telefono2: 'telefono2',
  telefonoalternativo2: 'telefono3',
  telefono3: 'telefono3',
  idiomadelcliente: 'idioma',
  idioma: 'idioma',
  tipocliente: 'tipo_cliente',
  cuentabancaria: 'cuenta_bancaria',
  iban: 'cuenta_bancaria',
  codigofiscal: 'codigo_fiscal',
  observaciones: 'observaciones',
  notas: 'observaciones',
  cuentacontable: 'cuenta_contable',
  region: 'region',
};

// Campos de fecha: se normalizan a ISO.
const CAMPOS_FECHA = ['fecha_nacimiento'];

// Todas las columnas válidas de la tabla clientes (para INSERT/UPDATE seguros).
const CAMPOS_CLIENTE = [
  'id_avantio', 'nombre', 'apellido1', 'apellido2', 'fecha_nacimiento', 'sexo', 'nacionalidad',
  'calle', 'numero', 'puerta', 'codigo_postal', 'ciudad', 'provincia', 'pais', 'dni',
  'email', 'email2', 'telefono', 'telefono2', 'telefono3', 'idioma', 'tipo_cliente',
  'cuenta_bancaria', 'codigo_fiscal', 'observaciones', 'cuenta_contable', 'region',
];

function normalizaClave(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita acentos
    .replace(/[^a-z0-9]/g, '');      // quita espacios, signos, etc.
}

function limpia(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function mapearCabeceras(headers) {
  return (headers || []).map((h) => MAPA[normalizaClave(h)] || null);
}

// Localiza la fila de cabeceras (la primera que mapea 'nombre' o >=3 columnas conocidas).
function detectarFilaCabeceras(rows) {
  const limite = Math.min(rows.length, 10);
  for (let i = 0; i < limite; i++) {
    const campos = mapearCabeceras(rows[i]).filter(Boolean);
    if (campos.includes('nombre') || campos.length >= 3) return i;
  }
  return rows.length > 1 ? 1 : 0;
}

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
      if (iso) datos[f] = iso;
      else delete datos[f];
    }
  }
  return datos;
}

function importarClientes(buffer) {
  // raw:true: las celdas llegan como texto/serial y las normalizamos nosotros.
  const wb = xlsx.read(buffer, { type: 'buffer', raw: true });
  const hoja = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(hoja, { header: 1, raw: true, blankrows: false });

  const resumen = { nuevos: 0, actualizados: 0, errores: [] };
  if (rows.length === 0) return resumen;

  const filaCabeceras = detectarFilaCabeceras(rows);
  const colCampo = mapearCabeceras(rows[filaCabeceras]);
  const dataRows = rows.slice(filaCabeceras + 1);

  const buscarPorAvantio = db.prepare(
    "SELECT id FROM clientes WHERE id_avantio IS NOT NULL AND id_avantio <> '' AND id_avantio = ?"
  );

  const tx = db.transaction(() => {
    dataRows.forEach((fila, i) => {
      const numFila = filaCabeceras + 2 + i; // nº real de fila (1-based)
      const datos = mapearFila(fila, colCampo);

      // Solo conservar columnas válidas de la tabla.
      for (const k of Object.keys(datos)) {
        if (!CAMPOS_CLIENTE.includes(k)) delete datos[k];
      }

      if (!datos.nombre) {
        if (Object.keys(datos).length > 0) resumen.errores.push({ fila: numFila, motivo: 'Falta el nombre' });
        return;
      }

      const existente = datos.id_avantio ? buscarPorAvantio.get(datos.id_avantio) : null;

      if (existente) {
        // UPDATE de los campos presentes, sin pisar observaciones (campo del CRM).
        const datosUpd = { ...datos };
        delete datosUpd.observaciones;
        datosUpd.updated_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
        const claves = Object.keys(datosUpd);
        const set = claves.map((c) => `${c} = @${c}`).join(', ');
        db.prepare(`UPDATE clientes SET ${set} WHERE id = @id`).run({ ...datosUpd, id: existente.id });
        resumen.actualizados++;
      } else {
        const claves = Object.keys(datos);
        const cols = claves.join(', ');
        const placeholders = claves.map((c) => '@' + c).join(', ');
        db.prepare(`INSERT INTO clientes (${cols}) VALUES (${placeholders})`).run(datos);
        resumen.nuevos++;
      }
    });
  });

  tx();
  return resumen;
}

module.exports = { importarClientes };
