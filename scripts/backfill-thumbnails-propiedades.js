// scripts/backfill-thumbnails-propiedades.js
// Genera la miniatura (url_thumbnail) de las fotos de propiedad_fotos ya subidas antes de
// que POST /api/ventas/propiedades/:id/fotos empezara a generarla automáticamente.
//
// Uso:
//   node scripts/backfill-thumbnails-propiedades.js            -> dry run, no escribe nada
//   node scripts/backfill-thumbnails-propiedades.js --aplicar   -> genera miniaturas y actualiza la BD
//
// IMPORTANTE: para el servidor (Get-Process node | Stop-Process -Force) antes de ejecutar
// este script con --aplicar. Escribe directamente en crm.db; si el servidor tiene la
// conexión abierta a la vez, ambos procesos comparten la misma BD (WAL) sin problema para
// una escritura puntual, pero es más seguro no tenerlo corriendo mientras se aplican cambios.

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { Jimp } = require('jimp');

console.log('AVISO: para el servidor antes de ejecutar este script con --aplicar.\n');

const APLICAR = process.argv.includes('--aplicar');
const THUMB_ANCHO = 500;
const THUMB_CALIDAD = 80;

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const db = new Database(path.join(__dirname, '../db/crm.db'));

const pendientes = db.prepare(`
  SELECT id, propiedad_id, url, nombre_archivo
  FROM propiedad_fotos
  WHERE url_thumbnail IS NULL OR url_thumbnail = ''
`).all();

if (pendientes.length === 0) {
  console.log('No hay fotos sin miniatura. Nada que hacer.');
  db.close();
  process.exit(0);
}

console.log(`${pendientes.length} foto(s) sin miniatura:`);
console.table(pendientes.map((f) => ({ id: f.id, propiedad_id: f.propiedad_id, nombre_archivo: f.nombre_archivo })));

if (!APLICAR) {
  console.log('\nDry run: no se ha escrito nada en disco ni en la base de datos. Ejecuta con --aplicar para generar las miniaturas.');
  db.close();
  process.exit(0);
}

async function generarMiniatura(buffer, destino, nombreBase) {
  try {
    const img = await Jimp.read(buffer);
    if (img.width > THUMB_ANCHO) {
      img.resize({ w: THUMB_ANCHO });
    }
    const bufferThumb = await img.getBuffer('image/jpeg', { quality: THUMB_CALIDAD });
    const nombreThumb = `${nombreBase}-thumb.jpg`;
    fs.writeFileSync(path.join(destino, nombreThumb), bufferThumb);
    return nombreThumb;
  } catch (e) {
    return null;
  }
}

async function main() {
  const actualizar = db.prepare('UPDATE propiedad_fotos SET url_thumbnail = ? WHERE id = ?');
  let generadas = 0;
  let fallidas = 0;

  for (const foto of pendientes) {
    const rutaOriginal = path.join(PUBLIC_DIR, foto.url);
    let buffer;
    try {
      buffer = fs.readFileSync(rutaOriginal);
    } catch (e) {
      console.log(`  [omitida] id=${foto.id} — no se encuentra el archivo original (${foto.url})`);
      fallidas++;
      continue;
    }

    const destino = path.dirname(rutaOriginal);
    const ext = path.extname(foto.nombre_archivo);
    const nombreBase = path.basename(foto.nombre_archivo, ext);
    const nombreThumb = await generarMiniatura(buffer, destino, nombreBase);

    if (!nombreThumb) {
      console.log(`  [omitida] id=${foto.id} — Jimp no pudo procesar la imagen (${foto.nombre_archivo})`);
      fallidas++;
      continue;
    }

    const url_thumbnail = `/uploads/propiedades/${foto.propiedad_id}/${nombreThumb}`;
    actualizar.run(url_thumbnail, foto.id);
    generadas++;
  }

  console.log(`\n${generadas} miniatura(s) generada(s). ${fallidas} omitida(s) (se quedan en null, el frontend caerá al original).`);
  db.close();
}

main();
