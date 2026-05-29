// Servicio de importación de propietarios desde Excel/CSV.
//
// Soporta el export de Avantio, cuyo XLS trae una estructura especial:
//   fila 0 -> título ("Lista"), fila 1 -> cabeceras reales, fila 2+ -> datos.
// Por eso parseamos con header:1 (array de arrays) y detectamos en qué fila están
// las cabeceras (la primera que mapea 'nombre' o varias columnas conocidas). Así
// funcionan tanto el XLS de Avantio como un CSV genérico con cabeceras en la fila 0.
//
// Mapea cabeceras de forma flexible (case-insensitive, sin acentos), ignora las
// columnas no reconocidas y hace upsert por email -> nº documento -> id_avantio.
// Nunca borra propietarios existentes.
const xlsx = require('xlsx');
const db = require('../db/database');
const { parseFecha } = require('./dateUtils');

// Cabecera normalizada del archivo -> campo interno. Varias cabeceras pueden
// apuntar al mismo campo (sinónimos). Incluye las 33 columnas del export de Avantio.
const MAPA = {
  idpropietario: 'id_avantio',
  nombre: 'nombre',
  tratamiento: 'tratamiento',
  apellidos: 'apellidos',
  apellido: 'apellidos',
  primerapellido: 'apellidos',
  apellido1: 'apellidos',
  segundoapellido: 'segundo_apellido',
  apellido2: 'segundo_apellido',
  idioma: 'idioma',
  fechaalta: 'fecha_alta',
  fechanacimiento: 'fecha_nacimiento',
  fechadenacimiento: 'fecha_nacimiento',
  tags: 'tags',
  etiquetas: 'tags',
  telefono: 'telefono',
  telefono1: 'telefono',
  movil: 'telefono',
  telefonomovil: 'telefono',
  tlf: 'telefono',
  telefono2: 'telefono2',
  telefonoalternativo: 'telefono2',
  telefonoalternativo1: 'telefono2',
  telefono3: 'telefono3',
  telefonoalternativo2: 'telefono3',
  email: 'email',
  correo: 'email',
  correoelectronico: 'email',
  mail: 'email',
  email2: 'email2',
  emailalternativo: 'email2',
  fax: 'fax',
  direccion: 'direccion',
  domicilio: 'direccion',
  numero: 'direccion_numero',
  bloqueportal: 'bloque_portal',
  plantapuerta: 'planta_puerta',
  codigopostal: 'codigo_postal',
  cp: 'codigo_postal',
  pais: 'pais',
  region: 'region',
  provincia: 'provincia',
  ciudad: 'ciudad',
  poblacion: 'ciudad',
  localidad: 'ciudad',
  dni: 'numero_documento',
  nie: 'numero_documento',
  nif: 'numero_documento',
  documento: 'numero_documento',
  numerodocumento: 'numero_documento',
  ndocumento: 'numero_documento',
  tipodocumento: 'tipo_documento',
  lugardeexpedicion: 'lugar_expedicion',
  lugarexpedicion: 'lugar_expedicion',
  expedidofecha: 'expedido_fecha',
  observaciones: 'notas', // en la UI el campo "Observaciones" se guarda en notas
  notas: 'notas',
  comentarios: 'notas',
  metodopago: 'metodo_pago',
  titularcuenta: 'titular_cuenta',
  titulardelacuenta: 'titular_cuenta',
  numerocuenta: 'numero_cuenta',
  ncuenta: 'numero_cuenta',
  cuenta: 'numero_cuenta',
  iban: 'numero_cuenta', // se usa si Nº cuenta viene vacío (gana el primer no-nulo en orden)
  codigofiscal: 'codigo_fiscal',
  cuentacontable: 'cuenta_contable',
};

// Campos de fecha: se normalizan a ISO (acepta DD/MM/AAAA, serial de Excel, ISO).
const CAMPOS_FECHA = ['fecha_nacimiento', 'expedido_fecha', 'fecha_alta'];

function normalizaClave(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita acentos (diacríticos combinados U+0300–U+036F)
    .replace(/[^a-z0-9]/g, ''); // quita espacios, signos, etc.
}

function limpia(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

// Devuelve, para una fila de cabeceras, el índice de columna -> campo interno.
function mapearCabeceras(headers) {
  return (headers || []).map((h) => MAPA[normalizaClave(h)] || null);
}

// Localiza la fila de cabeceras: la primera (en las primeras filas) que mapea
// 'nombre' o al menos 3 columnas conocidas. Salta el título "Lista" de Avantio.
function detectarFilaCabeceras(rows) {
  const limite = Math.min(rows.length, 10);
  for (let i = 0; i < limite; i++) {
    const campos = mapearCabeceras(rows[i]).filter(Boolean);
    if (campos.includes('nombre') || campos.length >= 3) return i;
  }
  // Sin coincidencias claras: asumir Avantio (fila 1) o genérico (fila 0).
  return rows.length > 1 ? 1 : 0;
}

// Construye el objeto de campos internos a partir de una fila de datos y el
// mapeo de columnas. El primer valor no nulo gana (p. ej. Nº cuenta antes que IBAN).
function mapearFila(fila, colCampo) {
  const datos = {};
  for (let c = 0; c < colCampo.length; c++) {
    const campo = colCampo[c];
    if (!campo) continue;
    const v = limpia(fila[c]);
    if (v !== null && datos[campo] == null) datos[campo] = v;
  }
  // Normaliza las fechas a ISO; si no se puede parsear, se descarta el campo.
  for (const f of CAMPOS_FECHA) {
    if (f in datos) {
      const iso = parseFecha(datos[f]);
      if (iso) datos[f] = iso;
      else delete datos[f];
    }
  }
  return datos;
}

function importarPropietarios(buffer) {
  // raw:true evita que SheetJS reinterprete fechas/números; las celdas llegan como
  // texto o serial y las normalizamos nosotros (igual que el importador de reservas).
  const wb = xlsx.read(buffer, { type: 'buffer', raw: true });
  const hoja = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(hoja, { header: 1, raw: true, blankrows: false });

  const resumen = { nuevos: 0, actualizados: 0, errores: [] };
  if (rows.length === 0) return resumen;

  const filaCabeceras = detectarFilaCabeceras(rows);
  const colCampo = mapearCabeceras(rows[filaCabeceras]);
  const dataRows = rows.slice(filaCabeceras + 1);

  const buscarPorEmail = db.prepare(
    "SELECT id FROM propietarios WHERE email IS NOT NULL AND email <> '' AND lower(email) = lower(?)"
  );
  const buscarPorDoc = db.prepare(
    "SELECT id FROM propietarios WHERE numero_documento IS NOT NULL AND numero_documento <> '' AND lower(numero_documento) = lower(?)"
  );
  const buscarPorAvantio = db.prepare(
    "SELECT id FROM propietarios WHERE id_avantio IS NOT NULL AND id_avantio <> '' AND id_avantio = ?"
  );

  // Una única transacción para procesar las ~1635 filas sin penalización de E/S.
  const tx = db.transaction(() => {
    dataRows.forEach((fila, i) => {
      const numFila = filaCabeceras + 2 + i; // nº de fila real en el archivo (1-based)
      const datos = mapearFila(fila, colCampo);

      if (!datos.nombre) {
        // Fila vacía: se ignora en silencio; si traía algún dato, se reporta.
        if (Object.keys(datos).length > 0) {
          resumen.errores.push({ fila: numFila, motivo: 'Falta el nombre' });
        }
        return;
      }

      // Upsert: email -> número de documento -> id de Avantio.
      let existente = null;
      if (datos.email) existente = buscarPorEmail.get(datos.email);
      if (!existente && datos.numero_documento) existente = buscarPorDoc.get(datos.numero_documento);
      if (!existente && datos.id_avantio) existente = buscarPorAvantio.get(datos.id_avantio);

      if (existente) {
        // UPDATE solo de los campos presentes (no pisamos datos existentes con vacíos).
        const claves = Object.keys(datos);
        const set = claves.map((c) => `${c} = @${c}`).join(', ');
        db.prepare(`UPDATE propietarios SET ${set} WHERE id = @id`).run({ ...datos, id: existente.id });
        resumen.actualizados++;
      } else {
        if (!datos.fecha_alta) datos.fecha_alta = new Date().toISOString().slice(0, 10);
        const claves = Object.keys(datos);
        const cols = claves.join(', ');
        const placeholders = claves.map((c) => '@' + c).join(', ');
        db.prepare(`INSERT INTO propietarios (${cols}) VALUES (${placeholders})`).run(datos);
        resumen.nuevos++;
      }
    });
  });

  tx();
  return resumen;
}

module.exports = { importarPropietarios };
