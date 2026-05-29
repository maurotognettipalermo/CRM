// Lógica de asignación de reservas a pisos (apartamentos).
// Un piso es válido para una reserva si coincide en TIH y no tiene fechas solapadas.
const { solapan } = require('./dateUtils');

// Busca el primer apartamento libre de la TIH dada para el rango [entrada, salida).
// - apartamentos: lista completa de apartamentos {id, tipo, ...}.
// - ocupaciones: array de reservas ya colocadas {apartamento_id, entrada, salida}
//   (incluye las de la BD y las asignadas en el lote actual de importación).
// Devuelve el id del apartamento elegido, o null si no hay ninguno libre.
function buscarPisoLibre(apartamentos, ocupaciones, tih, entrada, salida) {
  const candidatos = apartamentos
    .filter((a) => normalizaTih(a.tipo) === tih)
    .sort((a, b) => a.id - b.id);

  for (const apto of candidatos) {
    const choca = ocupaciones.some(
      (o) =>
        o.apartamento_id === apto.id &&
        solapan(entrada, salida, o.entrada, o.salida)
    );
    if (!choca) return apto.id;
  }
  return null;
}

// Normaliza el valor de TIH/tipo a '1' o '2'. Acepta "1 Línea", "1ª Línea", 1, "1", etc.
function normalizaTih(valor) {
  if (valor === null || valor === undefined) return null;
  const m = String(valor).match(/[12]/);
  return m ? m[0] : null;
}

module.exports = { buscarPisoLibre, normalizaTih };
