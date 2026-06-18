// Servicio de importación de alojamientos (apartamentos) desde el export de Avantio.
//
// El archivo es HTML disfrazado de .xls; SheetJS parsea correctamente las tablas HTML.
// Estructura Avantio: fila 0 -> título ("Listado de propiedades"), fila 1 -> cabeceras,
// fila 2+ -> datos. Parseamos con header:1 (array de arrays) y detectamos la fila de
// cabeceras (igual que importPropietarios / importClientes).
//
// Upsert por id_avantio (columna "Código"): si existe, solo rellena campos vacíos y los
// de dirección, SIN pisar notas/estado_limpieza/tipo_clasificacion ya puestos a mano;
// si no existe, inserta. Nunca borra. Vincula el propietario por coincidencia de nombre.
const xlsx = require('xlsx');
const db = require('../db/database');

// Cabecera normalizada del archivo -> campo interno (o "especial" para propietario/estado).
const MAPA = {
  codigo: 'id_avantio',
  alojamiento: 'nombre',
  capacidadpersonas: 'capacidad',
  capacidad: 'capacidad',
  tarifa: 'tipo_clasificacion',
  direccion: 'direccion',
  numero: 'numero',
  escalera: 'escalera',
  planta: 'piso',
  puerta: 'puerta',
  propietario: 'propietario_nombre',   // especial: se resuelve a una relación N:M
  licenciaturistica: 'licencia_turistica',
  referenciacatastral: 'ref_catastral',
  numeroderegistrounicoarrendamientos: 'nra',
  estado: 'estado',                    // especial: "Desactivado"/"Activado" -> quitar_planning
};

// Columnas reales de apartamentos que se escriben desde el Excel (sin los especiales).
const COLS_APTO = [
  'id_avantio', 'nombre', 'capacidad', 'tipo_clasificacion', 'direccion', 'numero',
  'escalera', 'piso', 'puerta', 'licencia_turistica', 'ref_catastral', 'nra',
];
// Campos de dirección: en un UPDATE se actualizan siempre (no solo si están vacíos).
const COLS_DIRECCION = ['direccion', 'numero'];

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

function esVacio(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

// "Tipo A+" -> "A+", "Tipo A" -> "A". Devuelve null si queda vacío.
function limpiarTarifa(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/^\s*tipo\s*/i, '').trim();
  return s === '' ? null : s;
}

function aEntero(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(String(v).replace(/[^0-9-]/g, ''), 10);
  return isNaN(n) ? null : n;
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
  if ('tipo_clasificacion' in datos) datos.tipo_clasificacion = limpiarTarifa(datos.tipo_clasificacion);
  if ('capacidad' in datos) datos.capacidad = aEntero(datos.capacidad);
  return datos;
}

// "Desactivado" -> 1 (quitar del planning); "Activado" -> 0; otro -> null (no tocar).
function quitarPlanningDeEstado(estado) {
  if (!estado) return null;
  const s = String(estado).toLowerCase();
  if (s.includes('desactiv')) return 1;
  if (s.includes('activ')) return 0;
  return null;
}

// Busca un propietario por coincidencia de nombre completo (varias combinaciones).
function buscarPropietario(nombreTexto) {
  if (!nombreTexto) return null;
  const buscar = String(nombreTexto).trim().toLowerCase().replace(/\s+/g, ' ');
  if (!buscar) return null;
  return db.prepare(`
    SELECT id FROM propietarios
    WHERE lower(trim(nombre || ' ' || COALESCE(apellidos,'') || ' ' || COALESCE(segundo_apellido,''))) = ?
       OR lower(trim(nombre || ' ' || COALESCE(apellidos,''))) = ?
       OR lower(trim(COALESCE(apellidos,'') || ' ' || nombre)) = ?
       OR lower(trim(nombre)) = ?
    LIMIT 1
  `).get(buscar, buscar, buscar, buscar);
}

// Crea una relación 100% activa si el apartamento no tiene ya una relación activa.
function vincularPropietario(apartamentoId, propietarioId) {
  const yaActivo = db.prepare(
    'SELECT id FROM apartamento_propietarios WHERE apartamento_id = ? AND activo = 1 LIMIT 1'
  ).get(apartamentoId);
  if (yaActivo) return false;
  db.prepare(`
    INSERT INTO apartamento_propietarios (apartamento_id, propietario_id, porcentaje, fecha_inicio, activo)
    VALUES (?, ?, 100, date('now'), 1)
  `).run(apartamentoId, propietarioId);
  return true;
}

function importarAlojamientos(buffer) {
  // raw:true: las celdas llegan como texto/serial y las normalizamos nosotros.
  const wb = xlsx.read(buffer, { type: 'buffer', raw: true });
  const hoja = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(hoja, { header: 1, raw: true, blankrows: false });

  const resumen = { nuevos: 0, actualizados: 0, errores: [], propietarios_vinculados: 0 };
  if (rows.length === 0) return resumen;

  const filaCabeceras = detectarFilaCabeceras(rows);
  const colCampo = mapearCabeceras(rows[filaCabeceras]);
  const dataRows = rows.slice(filaCabeceras + 1);

  const buscarPorAvantio = db.prepare(
    "SELECT * FROM apartamentos WHERE id_avantio IS NOT NULL AND id_avantio <> '' AND id_avantio = ?"
  );

  const tx = db.transaction(() => {
    dataRows.forEach((fila, i) => {
      const numFila = filaCabeceras + 2 + i; // nº real de fila (1-based)
      const datos = mapearFila(fila, colCampo);

      if (esVacio(datos.nombre)) {
        // Fila vacía: se ignora; si traía algún dato, se reporta.
        const tieneDatos = Object.values(datos).some((v) => !esVacio(v));
        if (tieneDatos) resumen.errores.push({ fila: numFila, motivo: 'Falta el nombre del alojamiento' });
        return;
      }

      const quitarPlanning = quitarPlanningDeEstado(datos.estado);
      const propietarioNombre = datos.propietario_nombre;

      // Campos de columnas reales presentes en la fila.
      const campos = {};
      for (const c of COLS_APTO) if (c in datos) campos[c] = datos[c];

      const existente = datos.id_avantio ? buscarPorAvantio.get(datos.id_avantio) : null;
      let apartamentoId;

      if (existente) {
        apartamentoId = existente.id;
        // UPDATE: solo campos vacíos en BD, salvo dirección (siempre) e id_avantio (clave).
        // No se tocan notas ni estado_limpieza (no se mapean). tipo_clasificacion solo si vacío.
        const sets = [];
        const vals = [];
        for (const c of COLS_APTO) {
          if (c === 'id_avantio') continue;
          if (!(c in campos)) continue;
          const debe = COLS_DIRECCION.includes(c) || esVacio(existente[c]);
          if (debe) { sets.push(`${c} = ?`); vals.push(campos[c]); }
        }
        if (sets.length) {
          vals.push(apartamentoId);
          db.prepare(`UPDATE apartamentos SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
        }
        resumen.actualizados++;
      } else {
        // INSERT con todos los campos del Excel + quitar_planning si Estado lo indica.
        const cols = Object.keys(campos);
        const vals = cols.map((c) => campos[c]);
        if (quitarPlanning !== null) { cols.push('quitar_planning'); vals.push(quitarPlanning); }
        const placeholders = cols.map(() => '?').join(', ');
        const info = db.prepare(
          `INSERT INTO apartamentos (${cols.join(', ')}) VALUES (${placeholders})`
        ).run(...vals);
        apartamentoId = info.lastInsertRowid;
        resumen.nuevos++;
      }

      // Vincular propietario por nombre (solo si no hay relación activa todavía).
      if (propietarioNombre) {
        const prop = buscarPropietario(propietarioNombre);
        if (prop && vincularPropietario(apartamentoId, prop.id)) resumen.propietarios_vinculados++;
      }
    });
  });

  tx();
  return resumen;
}

module.exports = { importarAlojamientos };
