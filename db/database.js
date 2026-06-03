// Conexión a SQLite mediante better-sqlite3 e inicialización del esquema.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'crm.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Columnas (además de las originales) que debe tener la tabla propietarios.
// Se añaden con ALTER TABLE si faltan, para BD creadas con el esquema antiguo.
const COLUMNAS_PROPIETARIOS = {
  id_avantio: 'TEXT',
  fecha_alta: 'TEXT',
  tratamiento: 'TEXT',
  segundo_apellido: 'TEXT',
  idioma: 'TEXT',
  fecha_nacimiento: 'TEXT',
  tags: 'TEXT',
  telefono2: 'TEXT',
  telefono3: 'TEXT',
  email2: 'TEXT',
  fax: 'TEXT',
  direccion_numero: 'TEXT',
  bloque_portal: 'TEXT',
  planta_puerta: 'TEXT',
  codigo_postal: 'TEXT',
  pais: 'TEXT',
  region: 'TEXT',
  provincia: 'TEXT',
  ciudad: 'TEXT',
  tipo_direccion: 'TEXT',
  tipo_documento: 'TEXT',
  numero_documento: 'TEXT',
  expedido_fecha: 'TEXT',
  ciudad_nacimiento: 'TEXT',
  provincia_nacimiento: 'TEXT',
  pais_nacimiento: 'TEXT',
  lugar_expedicion: 'TEXT',
  tipo_identificacion: 'TEXT',
  metodo_pago: 'TEXT',
  retencion: 'TEXT',
  tipo_cuenta: 'TEXT',
  titular_cuenta: 'TEXT',
  numero_cuenta: 'TEXT',
  cuenta_contable: 'TEXT',
  codigo_fiscal: 'TEXT',
};

// Columnas (además de las originales) que debe tener la tabla reservas.
// El valor es la definición completa para el ALTER (tipo + DEFAULT cuando aplica).
// OJO: SQLite NO permite DEFAULT con expresión (datetime('now')) en ADD COLUMN, así que
// fecha_creacion se añade sin default y se rellena con un UPDATE más abajo.
const COLUMNAS_RESERVAS = {
  tipo_reserva: "TEXT DEFAULT 'Confirmada'",
  fecha_creacion: 'TEXT',
  portal: 'TEXT',
  condicion_cancelacion: 'TEXT',
  atendido_por: 'TEXT',
  hora_entrada: "TEXT DEFAULT '17:00'",
  hora_salida: "TEXT DEFAULT '10:00'",
  checkin_estado: "TEXT DEFAULT 'Pendiente'",
  checkout_estado: "TEXT DEFAULT 'Pendiente'",
  precio_base: 'REAL DEFAULT 0',
  precio_total: 'REAL DEFAULT 0',
  pagado: 'REAL DEFAULT 0',
  pendiente: 'REAL DEFAULT 0',
  notas_internas: 'TEXT',
  ocupante: 'TEXT',
};

// Portales de venta por defecto (se insertan si la tabla está vacía).
const PORTALES_DEFECTO = [
  'Booking.com', 'Airbnb', 'Apartplaya', 'Viajes Himalaya', 'Web propia', 'Directo', 'Otro',
];

// Columnas extra de la tabla portales (color e imagen).
const COLUMNAS_PORTALES = {
  color: "TEXT DEFAULT '#3b82f6'",
  imagen_url: 'TEXT',
};

// Columnas extra de las tablas de contratos (forward-compat: se añaden si faltan).
const COLUMNAS_CONTRATOS = {
  aplica_iva: 'INTEGER DEFAULT 1',          // 0/1 — IVA del 21% sobre el precio base
  porcentaje_retencion: 'REAL DEFAULT 19',  // retención IRPF: 0 / 19 (residentes) / 24 (no residentes)
};
const COLUMNAS_CUOTAS = {
  // (reservado para columnas futuras de las cuotas)
};

// Columnas extra de la tabla apartamentos (ficha ampliada). DEFAULT constante en los 0/1.
const COLUMNAS_APARTAMENTOS = {
  tipo_clasificacion: 'TEXT',               // A / A+ / A++ / B / B+ / C
  orientacion:        'TEXT',               // Norte / Sur / Este / Oeste / Sureste / ...
  situacion:          'TEXT',               // Frontal / Lateral Principio / Medio / Final
  parking:            'TEXT',               // nº/código de plaza
  pwd_wifi:           'TEXT',
  en_garantia:        'INTEGER DEFAULT 0',  // 0/1
  quitar_planning:    'INTEGER DEFAULT 0',  // 0/1 — si 1 no aparece en el planning
  licencia_turistica: 'TEXT',
  nra:                'TEXT',               // nº de registro de actividad
  ref_catastral:      'TEXT',
  bloque:             'TEXT',
  escalera:           'TEXT',
  piso:               'TEXT',
  puerta:             'TEXT',
};

// Columnas extra de la tabla catalogo_gastos.
const COLUMNAS_CATALOGO_GASTOS = {
  incluye_iva: 'INTEGER DEFAULT 0',         // 0/1 — el precio lleva IVA 21% (informativo)
};

// Crea las tablas si no existen ejecutando el schema.sql.
function init() {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);
  migrarPropietarios();
  migrarReservas();
  migrarPortales();
  migrarContratos();
  migrarApartamentos();
  migrarGastos();
  seedAdmin();
  seedPortales();
}

// Añade con ALTER TABLE las columnas que falten en `tabla` (SQLite no admite
// ADD COLUMN IF NOT EXISTS). `columnas` = { nombre: 'definicion para el ALTER' }.
function anadirColumnasFaltantes(tabla, columnas) {
  const existentes = new Set(
    db.prepare(`PRAGMA table_info(${tabla})`).all().map((c) => c.name)
  );
  for (const [nombre, definicion] of Object.entries(columnas)) {
    if (!existentes.has(nombre)) {
      db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${nombre} ${definicion}`);
    }
  }
}

// Migración de la tabla reservas: añade columnas nuevas y rellena fecha_creacion
// en filas existentes (su DEFAULT con expresión solo aplica en BD nuevas).
function migrarReservas() {
  anadirColumnasFaltantes('reservas', COLUMNAS_RESERVAS);
  db.prepare("UPDATE reservas SET fecha_creacion = datetime('now') WHERE fecha_creacion IS NULL OR fecha_creacion = ''").run();
}

// Migración de la tabla portales: añade color (def. azul) e imagen_url.
function migrarPortales() {
  anadirColumnasFaltantes('portales', COLUMNAS_PORTALES);
}

// Migración de las tablas de contratos. Las tablas las crea schema.sql (CREATE TABLE IF
// NOT EXISTS, se re-ejecuta en cada arranque), así que aquí solo añadimos de forma segura
// las columnas que pudieran faltar en BD antiguas (ALTER TABLE ADD COLUMN idempotente).
function migrarContratos() {
  anadirColumnasFaltantes('contratos', COLUMNAS_CONTRATOS);
  anadirColumnasFaltantes('contrato_cuotas', COLUMNAS_CUOTAS);
}

// Migración de la tabla apartamentos: añade los campos de la ficha ampliada si faltan
// (los DEFAULT constantes 0 de en_garantia/quitar_planning se aplican a las filas existentes).
function migrarApartamentos() {
  anadirColumnasFaltantes('apartamentos', COLUMNAS_APARTAMENTOS);
}

// Migración de la tabla catalogo_gastos: añade incluye_iva si falta.
function migrarGastos() {
  anadirColumnasFaltantes('catalogo_gastos', COLUMNAS_CATALOGO_GASTOS);
}

// Inserta los portales por defecto si la tabla está vacía.
function seedPortales() {
  const n = db.prepare('SELECT COUNT(*) AS c FROM portales').get().c;
  if (n === 0) {
    const insertar = db.prepare('INSERT INTO portales (nombre, activo, orden) VALUES (?, 1, ?)');
    PORTALES_DEFECTO.forEach((nombre, i) => insertar.run(nombre, i + 1));
    console.log('Portales por defecto creados.');
  }
}

// Crea el usuario administrador por defecto si la tabla usuarios está vacía.
function seedAdmin() {
  const n = db.prepare('SELECT COUNT(*) AS c FROM usuarios').get().c;
  if (n === 0) {
    const hash = crypto.createHash('sha256').update('admin1234').digest('hex');
    db.prepare(
      `INSERT INTO usuarios (nombre, username, password_hash, rol, activo)
       VALUES ('Administrador', 'admin', ?, 'administrador', 1)`
    ).run(hash);
    console.log('Usuario administrador por defecto creado -> usuario: admin | contraseña: admin1234');
  }
}

// Añade de forma segura las columnas que falten en propietarios (SQLite no admite
// ADD COLUMN IF NOT EXISTS, así que comprobamos primero con PRAGMA table_info).
function migrarPropietarios() {
  anadirColumnasFaltantes('propietarios', COLUMNAS_PROPIETARIOS);
  // Rellena fecha_alta en filas antiguas que la tengan vacía.
  db.prepare("UPDATE propietarios SET fecha_alta = date('now') WHERE fecha_alta IS NULL OR fecha_alta = ''").run();
}

init();

module.exports = db;
