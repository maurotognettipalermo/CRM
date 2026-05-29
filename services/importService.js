// Servicio de importación: parsea Excel/CSV, hace upsert por número de reserva y
// autoasigna las reservas nuevas a un piso libre de su misma TIH.
const xlsx = require('xlsx');
const db = require('../db/database');
const { parseFecha, solapan } = require('./dateUtils');
const { buscarPisoLibre, normalizaTih } = require('./asignacion');

// Mapa de cabeceras del archivo -> campo interno. Se normaliza la cabecera (minúsculas,
// sin acentos, sin espacios extra ni puntos) para tolerar variaciones.
const COLUMNAS = {
  reserva: 'numero_reserva',
  nombrecliente: 'nombre_cliente',
  contrato: 'contrato',
  edificio: 'edificio',
  tih: 'tih',
  per: 'personas',
  entrada: 'entrada',
  salida: 'salida',
  observaciones: 'observaciones',
};

function normalizaClave(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita acentos
    .replace(/[^a-z0-9]/g, ''); // quita espacios, puntos, etc.
}

// Convierte una fila cruda (objeto por cabecera) en un objeto con campos internos.
function mapearFila(filaCruda) {
  const fila = {};
  for (const [cabecera, valor] of Object.entries(filaCruda)) {
    const campo = COLUMNAS[normalizaClave(cabecera)];
    if (campo) fila[campo] = valor;
  }
  return fila;
}

// Procesa el buffer de un archivo subido. Devuelve el resumen de la importación.
function importar(buffer) {
  // raw:true evita que SheetJS interprete las fechas de CSV en formato americano
  // (MM/DD/AAAA). Así las celdas llegan como texto "DD/MM/AAAA" (CSV) o como número
  // serial (Excel) y las normaliza parseFecha().
  const wb = xlsx.read(buffer, { type: 'buffer', raw: true });
  const hoja = wb.Sheets[wb.SheetNames[0]];
  const filas = xlsx.utils.sheet_to_json(hoja, { defval: '', raw: true });

  const resumen = { nuevas: 0, actualizadas: 0, errores: [] };

  // Estado en memoria para la autoasignación dentro del lote.
  const apartamentos = db.prepare('SELECT id, tipo FROM apartamentos').all();
  const ocupaciones = db
    .prepare(
      'SELECT apartamento_id, entrada, salida FROM reservas WHERE apartamento_id IS NOT NULL'
    )
    .all();

  const buscarExistente = db.prepare(
    'SELECT id, apartamento_id FROM reservas WHERE numero_reserva = ?'
  );
  const insertar = db.prepare(`
    INSERT INTO reservas
      (numero_reserva, nombre_cliente, contrato, edificio, tih, personas, entrada, salida, observaciones, apartamento_id)
    VALUES
      (@numero_reserva, @nombre_cliente, @contrato, @edificio, @tih, @personas, @entrada, @salida, @observaciones, @apartamento_id)
  `);
  const actualizar = db.prepare(`
    UPDATE reservas SET
      nombre_cliente = @nombre_cliente,
      contrato       = @contrato,
      edificio       = @edificio,
      tih            = @tih,
      personas       = @personas,
      entrada        = @entrada,
      salida         = @salida,
      observaciones  = @observaciones
    WHERE id = @id
  `);

  // Pre-procesa y ordena las filas nuevas por fecha de entrada para una asignación
  // estable (primero las que entran antes).
  const preparadas = filas
    .map((cruda, idx) => ({ idx: idx + 2, datos: mapearFila(cruda) })) // +2: cabecera = fila 1
    .map((f) => ({ ...f, norm: normalizar(f.datos) }));

  const tx = db.transaction(() => {
    // Ordenamos por entrada para que la autoasignación sea determinista.
    const ordenadas = [...preparadas].sort((a, b) => {
      const ea = a.norm.entrada || '';
      const eb = b.norm.entrada || '';
      return ea < eb ? -1 : ea > eb ? 1 : 0;
    });

    for (const { idx, norm } of ordenadas) {
      const err = validar(norm);
      if (err) {
        resumen.errores.push({ fila: idx, numero_reserva: norm.numero_reserva || '', motivo: err });
        continue;
      }

      const existente = buscarExistente.get(norm.numero_reserva);
      if (existente) {
        actualizar.run({ ...norm, id: existente.id });
        resumen.actualizadas++;
        continue;
      }

      // Reserva nueva: autoasignar a un piso libre de su TIH.
      const pisoId = buscarPisoLibre(apartamentos, ocupaciones, norm.tih, norm.entrada, norm.salida);
      insertar.run({ ...norm, apartamento_id: pisoId });

      if (pisoId === null) {
        resumen.errores.push({
          fila: idx,
          numero_reserva: norm.numero_reserva,
          motivo: `No hay piso libre de ${norm.tih === '1' ? '1ª' : norm.tih === '2' ? '2ª' : '?'} Línea para esas fechas (queda Sin asignar)`,
        });
      } else {
        ocupaciones.push({ apartamento_id: pisoId, entrada: norm.entrada, salida: norm.salida });
        resumen.nuevas++;
      }
    }
  });

  tx();
  return resumen;
}

// Normaliza los tipos de una fila mapeada a los formatos de la BD.
function normalizar(datos) {
  return {
    numero_reserva: limpia(datos.numero_reserva),
    nombre_cliente: limpia(datos.nombre_cliente),
    contrato: limpia(datos.contrato),
    edificio: limpia(datos.edificio),
    tih: normalizaTih(datos.tih),
    personas: aEntero(datos.personas),
    entrada: parseFecha(datos.entrada),
    salida: parseFecha(datos.salida),
    observaciones: limpia(datos.observaciones),
  };
}

function validar(n) {
  if (!n.numero_reserva) return 'Falta el número de reserva';
  if (!n.entrada) return 'Fecha de entrada inválida';
  if (!n.salida) return 'Fecha de salida inválida';
  if (n.entrada >= n.salida) return 'La entrada debe ser anterior a la salida';
  if (!n.tih) return 'TIH inválida (debe indicar 1 o 2 línea)';
  return null;
}

function limpia(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function aEntero(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(String(v).replace(/[^\d-]/g, ''), 10);
  return isNaN(n) ? null : n;
}

module.exports = { importar };
