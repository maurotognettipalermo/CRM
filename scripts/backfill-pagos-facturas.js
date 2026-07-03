// scripts/backfill-pagos-facturas.js
// Corrige facturas en estado 'pagada' cuya suma de factura_pagos no cubre el total
// (facturas afectadas por el bug de "marcar pagada a mano no dejaba rastro en
// factura_pagos", ya arreglado de cara a adelante en routes/facturas.js).
//
// Uso:
//   node scripts/backfill-pagos-facturas.js            -> dry run, no escribe nada
//   node scripts/backfill-pagos-facturas.js --aplicar   -> inserta los pagos que faltan
//
// IMPORTANTE: para el servidor (Get-Process node | Stop-Process -Force) antes de ejecutar
// este script con --aplicar. Escribe directamente en crm.db; si el servidor tiene la
// conexión abierta a la vez, ambos procesos comparten la misma BD (WAL) sin problema para
// una escritura puntual, pero es más seguro no tenerlo corriendo mientras se aplican cambios.

const Database = require('better-sqlite3');
const path = require('path');

console.log('AVISO: para el servidor antes de ejecutar este script con --aplicar.\n');

const APLICAR = process.argv.includes('--aplicar');
const MARGEN = 0.01;

const db = new Database(path.join(__dirname, '../db/crm.db'));

const facturas = db.prepare(`SELECT id, numero, total FROM facturas WHERE estado = 'pagada'`).all();

const sumaPagos = db.prepare(`SELECT COALESCE(SUM(importe), 0) AS s FROM factura_pagos WHERE factura_id = ?`);

const afectadas = [];
for (const f of facturas) {
  const suma = sumaPagos.get(f.id).s;
  const diferencia = Math.round((f.total - suma) * 100) / 100;
  if (diferencia > MARGEN) {
    afectadas.push({ ...f, suma, diferencia });
  }
}

if (afectadas.length === 0) {
  console.log('No hay facturas pagadas con pagos por debajo del total. Nada que hacer.');
  db.close();
  process.exit(0);
}

console.log('Facturas afectadas:');
console.table(afectadas.map((f) => ({
  id: f.id,
  numero: f.numero,
  total: f.total,
  suma_actual: f.suma,
  diferencia: f.diferencia,
})));

const sumaDiferencias = Math.round(afectadas.reduce((s, f) => s + f.diferencia, 0) * 100) / 100;
console.log(`\n${afectadas.length} factura(s) afectada(s). Diferencia total: ${sumaDiferencias} €.`);

if (!APLICAR) {
  console.log('\nDry run: no se ha escrito nada en la base de datos. Ejecuta con --aplicar para insertar los pagos que faltan.');
  db.close();
  process.exit(0);
}

const hoy = new Date().toISOString().slice(0, 10);
const insertar = db.prepare(`
  INSERT INTO factura_pagos (factura_id, importe, fecha_pago, metodo_pago, notas)
  VALUES (?, ?, ?, NULL, 'Ajuste retroactivo (backfill)')
`);

const tx = db.transaction((lista) => {
  for (const f of lista) insertar.run(f.id, f.diferencia, hoy);
});
tx(afectadas);

console.log(`\nInsertados ${afectadas.length} registro(s) en factura_pagos.`);
db.close();
