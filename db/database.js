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
  estado_limpieza:    "TEXT DEFAULT 'limpio' CHECK(estado_limpieza IN ('limpio','sucio'))",
};

// Columnas extra de la tabla catalogo_gastos.
const COLUMNAS_CATALOGO_GASTOS = {
  incluye_iva: 'INTEGER DEFAULT 0',         // 0/1 — el precio lleva IVA 21% (informativo)
};

// Columnas extra de la tabla razones_sociales.
const COLUMNAS_RAZONES = {
  logo_url: 'TEXT',
};

// Columnas extra de la tabla catalogo_extras.
const COLUMNAS_CATALOGO_EXTRAS = {
  obligatorio: 'INTEGER DEFAULT 0',         // 0/1 — se añade automáticamente a toda reserva
};

// Modificadores de precio por tipo de clasificación (se insertan si la tabla está vacía).
// A es la referencia (0%); el resto suben o bajan respecto al precio base de la temporada.
const MODIFICADORES_DEFECTO = [
  { tipo: 'A++', porcentaje: 20, orden: 1 },
  { tipo: 'A+', porcentaje: 10, orden: 2 },
  { tipo: 'A', porcentaje: 0, orden: 3 },
  { tipo: 'B+', porcentaje: -10, orden: 4 },
  { tipo: 'B', porcentaje: -20, orden: 5 },
  { tipo: 'C', porcentaje: -30, orden: 6 },
];

// Estados de reserva por defecto (se insertan si la tabla está vacía).
// es_sistema=1 → no se pueden eliminar desde Ajustes.
const ESTADOS_RESERVA_DEFECTO = [
  { nombre: 'Confirmada', color: '#10b981', orden: 1, es_sistema: 1 },
  { nombre: 'Pendiente', color: '#f59e0b', orden: 2, es_sistema: 1 },
  { nombre: 'Cancelada', color: '#ef4444', orden: 3, es_sistema: 1 },
  { nombre: 'Pagada', color: '#6b7280', orden: 4, es_sistema: 0 },
  { nombre: 'De propietario', color: '#8b5cf6', orden: 5, es_sistema: 0 },
  { nombre: 'Bloqueado', color: '#dc2626', orden: 6, es_sistema: 0 },
];

// Columnas extra de las tablas de facturación (forward-compat: se añaden si faltan).
// Las tablas las crea schema.sql; aquí solo reservamos el punto para columnas futuras.
const COLUMNAS_FACTURAS = {};

// Crea las tablas si no existen ejecutando el schema.sql.
function init() {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);
  limpiarDatosPrueba();
  migrarPropietarios();
  migrarReservas();
  migrarPortales();
  migrarContratos();
  migrarApartamentos();
  migrarRelacionPropietarios();
  migrarGastos();
  migrarRazones();
  migrarFacturas();
  migrarCatalogoExtras();
  migrarUsuariosRol();
  seedAdmin();
  seedPortales();
  seedModificadores();
  seedEstadosReserva();
}

// Limpieza ÚNICA de datos de prueba (facturación, contratos, pagos, extras, gastos y
// actividad) previa a la puesta en producción. Se ejecuta una sola vez: deja un flag
// en la tabla ajustes para no volver a borrar datos reales en arranques posteriores.
// NO toca: apartamentos, propietarios, reservas, usuarios, portales, catálogos ni razones sociales.
function limpiarDatosPrueba() {
  const FLAG = 'limpieza_datos_prueba_v1';
  const hecho = db.prepare('SELECT valor FROM ajustes WHERE clave = ?').get(FLAG);
  if (hecho) return;
  const tx = db.transaction(() => {
    db.exec(`
      DELETE FROM factura_lineas;
      DELETE FROM facturas;
      DELETE FROM factura_contador;
      DELETE FROM contrato_cuotas;
      DELETE FROM contratos;
      DELETE FROM reserva_pagos;
      DELETE FROM reserva_extras;
      DELETE FROM apartamento_gastos;
      DELETE FROM actividad_log;
    `);
    db.prepare('INSERT INTO ajustes (clave, valor) VALUES (?, ?)').run(FLAG, new Date().toISOString());
  });
  tx();
  console.log('Datos de prueba eliminados (facturas, contratos, pagos, extras, gastos, actividad).');
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

// Migración a la relación N:M apartamento ↔ propietarios:
//  1) Copia las relaciones de la antigua columna apartamentos.propietario_id a la
//     tabla apartamento_propietarios (porcentaje 100, inicio 2024-01-01, activo).
//  2) Elimina la columna propietario_id recreando la tabla (SQLite antiguo no soporta
//     DROP COLUMN): CREATE nueva → INSERT SELECT → DROP vieja → RENAME.
// Idempotente: si la columna ya no existe, no hace nada. Debe ejecutarse DESPUÉS de
// migrarApartamentos() para que la tabla vieja ya tenga todas las columnas ampliadas.
function migrarRelacionPropietarios() {
  const cols = db.prepare('PRAGMA table_info(apartamentos)').all().map((c) => c.name);
  if (!cols.includes('propietario_id')) return;

  // 1) Volcar las relaciones existentes (solo si no están ya en la tabla N:M).
  db.prepare(`
    INSERT INTO apartamento_propietarios (apartamento_id, propietario_id, porcentaje, fecha_inicio, activo)
    SELECT a.id, a.propietario_id, 100, '2024-01-01', 1
    FROM apartamentos a
    WHERE a.propietario_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM apartamento_propietarios ap
        WHERE ap.apartamento_id = a.id AND ap.propietario_id = a.propietario_id
      )
  `).run();

  // 2) Recrear la tabla sin propietario_id. FKs desactivadas durante el rebuild para
  //    que el DROP no afecte a las tablas que referencian apartamentos(id).
  const restantes = cols.filter((n) => n !== 'propietario_id');
  const lista = restantes.join(', ');
  const extras = Object.entries(COLUMNAS_APARTAMENTOS)
    .map(([nombre, def]) => `${nombre} ${def}`)
    .join(',\n      ');
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`CREATE TABLE apartamentos_nueva (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre         TEXT NOT NULL,
      edificio       TEXT,
      tipo           TEXT,
      capacidad      INTEGER,
      notas          TEXT,
      ${extras}
    )`);
    db.exec(`INSERT INTO apartamentos_nueva (${lista}) SELECT ${lista} FROM apartamentos`);
    db.exec('DROP TABLE apartamentos');
    db.exec('ALTER TABLE apartamentos_nueva RENAME TO apartamentos');
    db.exec('CREATE INDEX IF NOT EXISTS idx_apartamentos_tipo ON apartamentos(tipo)');
  })();
  db.pragma('foreign_keys = ON');
  const rotas = db.prepare('PRAGMA foreign_key_check').all();
  if (rotas.length) {
    console.error('AVISO: claves foráneas rotas tras la migración:', rotas);
  }
  console.log('Migración: apartamentos.propietario_id -> apartamento_propietarios completada.');
}

// Migración de la tabla catalogo_gastos: añade incluye_iva si falta.
function migrarGastos() {
  anadirColumnasFaltantes('catalogo_gastos', COLUMNAS_CATALOGO_GASTOS);
}

// Migración de la tabla razones_sociales: añade logo_url si falta.
function migrarRazones() {
  anadirColumnasFaltantes('razones_sociales', COLUMNAS_RAZONES);
}

// Migración de la tabla facturas (las tablas las crea schema.sql; reservado para columnas futuras).
function migrarFacturas() {
  anadirColumnasFaltantes('facturas', COLUMNAS_FACTURAS);
}

// Migración de la tabla catalogo_extras: añade obligatorio si falta.
function migrarCatalogoExtras() {
  anadirColumnasFaltantes('catalogo_extras', COLUMNAS_CATALOGO_EXTRAS);
}

// Amplía el CHECK de usuarios.rol para permitir 'limpieza' y 'mantenimiento'. SQLite no
// permite alterar un CHECK, así que se recrea la tabla (CREATE temp → INSERT → DROP → RENAME)
// solo si el CHECK actual aún no incluye 'mantenimiento' (el rol añadido más recientemente).
// Idempotente. FKs desactivadas durante el rebuild para que el DROP no afecte a las tablas
// que referencian usuarios(id).
function migrarUsuariosRol() {
  const def = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='usuarios'").get();
  if (!def || /'mantenimiento'/.test(def.sql)) return; // ya admite todos los roles (o tabla no creada aún)

  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`CREATE TABLE usuarios_nueva (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre        TEXT NOT NULL,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      rol           TEXT NOT NULL CHECK(rol IN ('administrador','usuario','limpieza','mantenimiento')),
      activo        INTEGER DEFAULT 1,
      created_at    TEXT DEFAULT (datetime('now')),
      ultimo_acceso TEXT,
      token         TEXT
    )`);
    db.exec(`INSERT INTO usuarios_nueva (id, nombre, username, password_hash, rol, activo, created_at, ultimo_acceso, token)
             SELECT id, nombre, username, password_hash, rol, activo, created_at, ultimo_acceso, token FROM usuarios`);
    db.exec('DROP TABLE usuarios');
    db.exec('ALTER TABLE usuarios_nueva RENAME TO usuarios');
  })();
  db.pragma('foreign_keys = ON');
  const rotas = db.prepare('PRAGMA foreign_key_check').all();
  if (rotas.length) console.error('AVISO: claves foráneas rotas tras migrar usuarios.rol:', rotas);
  console.log("Migración: usuarios.rol ahora admite 'limpieza' y 'mantenimiento'.");
}

// Inserta los modificadores por tipo de clasificación si la tabla está vacía.
function seedModificadores() {
  const n = db.prepare('SELECT COUNT(*) AS c FROM tipo_modificadores').get().c;
  if (n === 0) {
    const insertar = db.prepare('INSERT INTO tipo_modificadores (tipo, porcentaje, orden) VALUES (?, ?, ?)');
    for (const m of MODIFICADORES_DEFECTO) insertar.run(m.tipo, m.porcentaje, m.orden);
    console.log('Modificadores de tarifa por tipo creados.');
  }
}

// Inserta los estados de reserva por defecto si la tabla está vacía.
function seedEstadosReserva() {
  const n = db.prepare('SELECT COUNT(*) AS c FROM estados_reserva').get().c;
  if (n === 0) {
    const insertar = db.prepare(
      'INSERT INTO estados_reserva (nombre, color, orden, es_sistema) VALUES (?, ?, ?, ?)'
    );
    for (const e of ESTADOS_RESERVA_DEFECTO) insertar.run(e.nombre, e.color, e.orden, e.es_sistema);
    console.log('Estados de reserva por defecto creados.');
  }
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
