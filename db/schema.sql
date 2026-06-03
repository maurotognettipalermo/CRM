-- Esquema de la base de datos del CRM de alquiler vacacional
-- Se ejecuta automáticamente al arrancar el servidor si las tablas no existen.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS propietarios (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  id_avantio           TEXT,                      -- "Id Propietario" del export de Avantio
  nombre               TEXT NOT NULL,
  apellidos            TEXT,                      -- primer apellido
  telefono             TEXT,
  email                TEXT,
  dni                  TEXT,                      -- legado; el campo canónico es numero_documento
  direccion            TEXT,
  notas                TEXT,                      -- se usa como "Observaciones" en la ficha
  -- Datos del propietario
  fecha_alta           TEXT,                      -- ISO YYYY-MM-DD
  tratamiento          TEXT,                      -- Sr / Sra / otro
  segundo_apellido     TEXT,
  idioma               TEXT,
  fecha_nacimiento     TEXT,
  tags                 TEXT,                      -- etiquetas separadas por comas
  -- Contacto
  telefono2            TEXT,
  telefono3            TEXT,
  email2               TEXT,
  fax                  TEXT,
  -- Domicilio
  direccion_numero     TEXT,
  bloque_portal        TEXT,
  planta_puerta        TEXT,
  codigo_postal        TEXT,
  pais                 TEXT,
  region               TEXT,
  provincia            TEXT,
  ciudad               TEXT,
  tipo_direccion       TEXT,
  -- Documentación
  tipo_documento       TEXT,                      -- DNI / NIE / Pasaporte / otro
  numero_documento     TEXT,
  expedido_fecha       TEXT,
  ciudad_nacimiento    TEXT,
  provincia_nacimiento TEXT,
  pais_nacimiento      TEXT,
  lugar_expedicion     TEXT,
  tipo_identificacion  TEXT,
  -- Datos contables
  metodo_pago          TEXT,
  retencion            TEXT,
  tipo_cuenta          TEXT,
  titular_cuenta       TEXT,
  numero_cuenta        TEXT,                      -- IBAN
  cuenta_contable      TEXT,
  codigo_fiscal        TEXT
);

CREATE TABLE IF NOT EXISTS apartamentos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre         TEXT NOT NULL,
  edificio       TEXT,
  tipo           TEXT,            -- '1' = 1ª Línea, '2' = 2ª Línea
  capacidad      INTEGER,
  notas          TEXT,
  propietario_id INTEGER REFERENCES propietarios(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS reservas (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  numero_reserva TEXT NOT NULL UNIQUE,   -- identificador único de la reserva (columna "Reserva")
  nombre_cliente TEXT,
  contrato       TEXT,
  edificio       TEXT,
  tih            TEXT,                    -- '1' / '2'
  personas       INTEGER,
  entrada        TEXT,                    -- ISO YYYY-MM-DD
  salida         TEXT,                    -- ISO YYYY-MM-DD
  observaciones  TEXT,
  apartamento_id INTEGER REFERENCES apartamentos(id) ON DELETE SET NULL,  -- NULL = "Sin asignar"
  -- Datos de gestión de la ficha de reserva
  tipo_reserva          TEXT DEFAULT 'Confirmada',   -- Confirmada / Pendiente / Cancelada
  fecha_creacion        TEXT DEFAULT (datetime('now')),
  portal                TEXT,                          -- nombre del portal de venta
  condicion_cancelacion TEXT,                          -- Reembolsable / No reembolsable
  atendido_por          TEXT,                          -- username que gestionó la reserva
  hora_entrada          TEXT DEFAULT '17:00',
  hora_salida           TEXT DEFAULT '10:00',
  checkin_estado        TEXT DEFAULT 'Pendiente',      -- Pendiente / Asignado / Completado
  checkout_estado       TEXT DEFAULT 'Pendiente',      -- Pendiente / Asignado / Completado
  precio_base           REAL DEFAULT 0,
  precio_total          REAL DEFAULT 0,
  pagado                REAL DEFAULT 0,
  pendiente             REAL DEFAULT 0,
  notas_internas        TEXT,
  ocupante              TEXT                            -- nombre del ocupante si difiere del cliente
);

-- Portales de venta (Booking.com, Airbnb, etc.).
CREATE TABLE IF NOT EXISTS portales (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  activo INTEGER DEFAULT 1,
  orden  INTEGER DEFAULT 0
);

-- Almacén genérico clave-valor para ajustes varios de la aplicación.
CREATE TABLE IF NOT EXISTS ajustes (
  clave TEXT PRIMARY KEY,
  valor TEXT
);

-- Razones sociales / datos de facturación (cada una es una tarjeta en Ajustes).
CREATE TABLE IF NOT EXISTS razones_sociales (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  razon_social         TEXT,
  nombre_comercial     TEXT,
  cif_nif              TEXT,
  direccion            TEXT,
  persona_contacto     TEXT,
  numero               TEXT,
  email_contacto       TEXT,
  puerta               TEXT,
  telefono             TEXT,
  codigo_postal        TEXT,
  fax                  TEXT,
  ciudad               TEXT,
  iva                  TEXT,
  estado_provincia     TEXT,
  codigo_cnae          TEXT,
  pais                 TEXT,
  iva_intracomunitario TEXT,
  tipo_direccion       TEXT,
  tipo_documento_in    TEXT,
  numero_documento_in  TEXT,
  nombre_banco         TEXT,
  iban                 TEXT,
  direccion_banco      TEXT,
  codigo_swift         TEXT,
  numero_cuenta_ccc    TEXT,
  created_at           TEXT DEFAULT (datetime('now'))
);

-- Usuarios de la aplicación. La columna token guarda la sesión activa (sha256);
-- se valida en el middleware de autenticación. Un usuario = una sesión activa.
CREATE TABLE IF NOT EXISTS usuarios (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre        TEXT NOT NULL,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  rol           TEXT NOT NULL CHECK(rol IN ('administrador','usuario')),
  activo        INTEGER DEFAULT 1,
  created_at    TEXT DEFAULT (datetime('now')),
  ultimo_acceso TEXT,
  token         TEXT
);

-- Registro de actividad (auditoría).
CREATE TABLE IF NOT EXISTS actividad_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id     INTEGER REFERENCES usuarios(id),
  usuario_nombre TEXT,
  accion         TEXT NOT NULL,
  entidad        TEXT,
  entidad_id     TEXT,
  detalle        TEXT,
  fecha          TEXT DEFAULT (datetime('now'))
);

-- Contratos de gestión con el propietario (precio cerrado garantizado o comisión).
CREATE TABLE IF NOT EXISTS contratos (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  apartamento_id     INTEGER NOT NULL REFERENCES apartamentos(id) ON DELETE RESTRICT,
  propietario_id     INTEGER REFERENCES propietarios(id) ON DELETE SET NULL,
  tipo               TEXT NOT NULL CHECK(tipo IN ('precio_cerrado','comision')),
  temporada_inicio   TEXT NOT NULL,   -- ISO YYYY-MM-DD
  temporada_fin      TEXT NOT NULL,   -- ISO YYYY-MM-DD
  anio               INTEGER NOT NULL,            -- año del contrato ej: 2026
  precio_total       REAL DEFAULT 0,              -- solo precio_cerrado: importe garantizado total
  porcentaje_comision REAL DEFAULT 0,             -- solo comision: % sobre precio_total reserva
  estado             TEXT DEFAULT 'activo' CHECK(estado IN ('activo','finalizado','cancelado')),
  notas              TEXT,
  created_at         TEXT DEFAULT (datetime('now')),
  created_by         TEXT
);

-- Cuotas/calendario de pagos de un contrato (sobre todo para precio_cerrado).
CREATE TABLE IF NOT EXISTS contrato_cuotas (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  contrato_id    INTEGER NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
  numero_cuota   INTEGER NOT NULL,     -- 1, 2, 3...
  fecha_prevista TEXT NOT NULL,        -- ISO YYYY-MM-DD: fecha en que se debe pagar
  importe        REAL NOT NULL,
  pagado         INTEGER DEFAULT 0,    -- 0/1
  fecha_pago     TEXT,                 -- ISO YYYY-MM-DD: fecha en que se pagó realmente
  notas          TEXT
);

CREATE INDEX IF NOT EXISTS idx_contratos_apartamento ON contratos(apartamento_id);
CREATE INDEX IF NOT EXISTS idx_contratos_propietario ON contratos(propietario_id);
CREATE INDEX IF NOT EXISTS idx_contratos_anio ON contratos(anio);
CREATE INDEX IF NOT EXISTS idx_cuotas_contrato ON contrato_cuotas(contrato_id);

CREATE INDEX IF NOT EXISTS idx_actividad_fecha ON actividad_log(id);
CREATE INDEX IF NOT EXISTS idx_reservas_fechas ON reservas(entrada, salida);
CREATE INDEX IF NOT EXISTS idx_reservas_apartamento ON reservas(apartamento_id);
CREATE INDEX IF NOT EXISTS idx_apartamentos_tipo ON apartamentos(tipo);
