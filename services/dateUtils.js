// Utilidades de fechas: parseo de DD/MM/AAAA, serial de Excel e ISO; helpers de solape.

// Convierte un valor de celda (string DD/MM/AAAA, número serial de Excel, o Date) a
// fecha ISO 'YYYY-MM-DD'. Devuelve null si no se puede interpretar.
function parseFecha(valor) {
  if (valor === null || valor === undefined || valor === '') return null;

  // Objeto Date (xlsx puede devolverlo con cellDates).
  if (valor instanceof Date && !isNaN(valor)) {
    return toISO(valor.getFullYear(), valor.getMonth() + 1, valor.getDate());
  }

  // Número serial de Excel (días desde 1899-12-30).
  if (typeof valor === 'number' && isFinite(valor)) {
    return serialExcelAISO(valor);
  }

  const texto = String(valor).trim();
  if (!texto) return null;

  // Si es un número en texto, tratarlo como serial de Excel.
  if (/^\d+(\.\d+)?$/.test(texto)) {
    return serialExcelAISO(parseFloat(texto));
  }

  // ISO YYYY-MM-DD (o con hora).
  let m = texto.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return toISO(+m[1], +m[2], +m[3]);

  // DD/MM/AAAA o DD-MM-AAAA (también con año de 2 dígitos).
  m = texto.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) {
    let anio = +m[3];
    if (anio < 100) anio += 2000;
    return toISO(anio, +m[2], +m[1]);
  }

  return null;
}

function serialExcelAISO(serial) {
  // Excel cuenta días desde 1899-12-30 (corrige el bug del año bisiesto 1900).
  const epoch = Date.UTC(1899, 11, 30);
  const ms = epoch + Math.round(serial) * 86400000;
  const d = new Date(ms);
  return toISO(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function toISO(anio, mes, dia) {
  if (!anio || !mes || !dia) return null;
  const mm = String(mes).padStart(2, '0');
  const dd = String(dia).padStart(2, '0');
  return `${anio}-${mm}-${dd}`;
}

// ¿Se solapan dos rangos [aEntrada, aSalida) y [bEntrada, bSalida)?
// Intervalos medio abiertos: turnover (salida == entrada del siguiente) NO solapa.
function solapan(aEntrada, aSalida, bEntrada, bSalida) {
  return aEntrada < bSalida && bEntrada < aSalida;
}

module.exports = { parseFecha, solapan, toISO };
