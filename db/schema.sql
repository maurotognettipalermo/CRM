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
  notas          TEXT
);

-- Relación N:M apartamento ↔ propietarios con porcentaje de propiedad e histórico.
-- Sustituye a la antigua columna apartamentos.propietario_id (migrada en database.js).
CREATE TABLE IF NOT EXISTS apartamento_propietarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  apartamento_id INTEGER NOT NULL REFERENCES apartamentos(id) ON DELETE CASCADE,
  propietario_id INTEGER NOT NULL REFERENCES propietarios(id) ON DELETE CASCADE,
  porcentaje REAL NOT NULL DEFAULT 100,    -- % de propiedad (todos deben sumar 100)
  fecha_inicio TEXT NOT NULL,              -- ISO YYYY-MM-DD
  fecha_fin TEXT,                          -- null = propietario actual
  activo INTEGER DEFAULT 1,                -- 1=actual, 0=histórico
  notas TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(apartamento_id, propietario_id, fecha_inicio)
);
CREATE INDEX IF NOT EXISTS idx_ap_apartamento ON apartamento_propietarios(apartamento_id);
CREATE INDEX IF NOT EXISTS idx_ap_propietario ON apartamento_propietarios(propietario_id);

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

-- Catálogo de gastos reutilizables (limpieza, mantenimiento, etc.); se gestiona en Ajustes.
CREATE TABLE IF NOT EXISTS catalogo_gastos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre      TEXT NOT NULL UNIQUE,
  precio      REAL NOT NULL DEFAULT 0,
  descripcion TEXT,
  activo      INTEGER DEFAULT 1,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- Gastos imputados a un apartamento. nombre/precio son un SNAPSHOT del catálogo en el
-- momento de insertar (cambios futuros del catálogo no alteran el histórico).
CREATE TABLE IF NOT EXISTS apartamento_gastos (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  apartamento_id      INTEGER NOT NULL REFERENCES apartamentos(id) ON DELETE CASCADE,
  catalogo_gasto_id   INTEGER REFERENCES catalogo_gastos(id) ON DELETE SET NULL,
  nombre              TEXT NOT NULL,
  precio              REAL NOT NULL,
  fecha               TEXT NOT NULL,        -- ISO YYYY-MM-DD
  notas               TEXT,
  cobrado_propietario INTEGER DEFAULT 0,    -- 0/1
  created_by          TEXT,
  created_at          TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_apto_gastos_apartamento ON apartamento_gastos(apartamento_id);
CREATE INDEX IF NOT EXISTS idx_apto_gastos_catalogo ON apartamento_gastos(catalogo_gasto_id);

-- Facturas (huésped / propietario / autofactura / gastos).
CREATE TABLE IF NOT EXISTS facturas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero TEXT UNIQUE NOT NULL,        -- F-2026-001
  serie TEXT NOT NULL DEFAULT 'F',
  anio INTEGER NOT NULL,
  tipo TEXT NOT NULL CHECK(tipo IN ('huésped','propietario','autofactura','gastos')),
  estado TEXT DEFAULT 'emitida' CHECK(estado IN ('borrador','emitida','pagada','anulada')),

  -- Emisor (nuestra empresa o propietario en autofactura)
  razon_social_id INTEGER REFERENCES razones_sociales(id) ON DELETE SET NULL,
  emisor_nombre TEXT NOT NULL,
  emisor_cif TEXT,
  emisor_direccion TEXT,
  emisor_logo_url TEXT,

  -- Receptor
  receptor_nombre TEXT NOT NULL,
  receptor_cif TEXT,
  receptor_direccion TEXT,
  receptor_email TEXT,

  -- Importes
  base_imponible REAL DEFAULT 0,
  porcentaje_iva REAL DEFAULT 21,
  importe_iva REAL DEFAULT 0,
  porcentaje_retencion REAL DEFAULT 0,
  importe_retencion REAL DEFAULT 0,
  total REAL DEFAULT 0,

  -- Referencias
  contrato_id INTEGER REFERENCES contratos(id) ON DELETE SET NULL,
  apartamento_id INTEGER REFERENCES apartamentos(id) ON DELETE SET NULL,
  propietario_id INTEGER REFERENCES propietarios(id) ON DELETE SET NULL,
  reserva_id INTEGER REFERENCES reservas(id) ON DELETE SET NULL,

  -- Metadata
  fecha_emision TEXT NOT NULL DEFAULT (date('now')),
  fecha_vencimiento TEXT,
  notas TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS factura_lineas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  factura_id INTEGER NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
  descripcion TEXT NOT NULL,
  cantidad REAL DEFAULT 1,
  precio_unitario REAL NOT NULL,
  importe REAL NOT NULL,           -- cantidad * precio_unitario
  orden INTEGER DEFAULT 0
);

-- Contador de numeración de facturas por año (numeración correlativa sin huecos).
CREATE TABLE IF NOT EXISTS factura_contador (
  anio INTEGER PRIMARY KEY,
  ultimo_numero INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_facturas_anio ON facturas(anio);
CREATE INDEX IF NOT EXISTS idx_facturas_tipo ON facturas(tipo);
CREATE INDEX IF NOT EXISTS idx_facturas_propietario ON facturas(propietario_id);
CREATE INDEX IF NOT EXISTS idx_facturas_reserva ON facturas(reserva_id);
CREATE INDEX IF NOT EXISTS idx_factura_lineas_factura ON factura_lineas(factura_id);

-- Plan de pagos de una reserva (huésped): confirmación 20% / resto 80%, o pagos manuales.
CREATE TABLE IF NOT EXISTS reserva_pagos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reserva_id INTEGER NOT NULL REFERENCES reservas(id) ON DELETE CASCADE,
  concepto TEXT NOT NULL,           -- 'Confirmación (20%)' / 'Resto a la llegada (80%)' / libre
  importe REAL NOT NULL,
  metodo_pago TEXT CHECK(metodo_pago IN ('caja','tpv','transferencia')),
  pagado INTEGER DEFAULT 0,         -- 0/1
  fecha_pago TEXT,                  -- ISO YYYY-MM-DD, null hasta que se paga
  notas TEXT,
  orden INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Catálogo de extras reutilizables (cuna, parking, late check-out...); se gestiona en Ajustes.
CREATE TABLE IF NOT EXISTS catalogo_extras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  precio REAL NOT NULL DEFAULT 0,
  tipo_precio TEXT DEFAULT 'unidad' CHECK(tipo_precio IN ('unidad','noche','persona')),
  descripcion TEXT,
  activo INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Extras imputados a una reserva. nombre/precio_unitario/tipo_precio son SNAPSHOT del catálogo.
CREATE TABLE IF NOT EXISTS reserva_extras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reserva_id INTEGER NOT NULL REFERENCES reservas(id) ON DELETE CASCADE,
  catalogo_extra_id INTEGER REFERENCES catalogo_extras(id) ON DELETE SET NULL,
  nombre TEXT NOT NULL,             -- snapshot del nombre
  precio_unitario REAL NOT NULL,    -- snapshot del precio
  tipo_precio TEXT NOT NULL,        -- snapshot del tipo
  cantidad INTEGER DEFAULT 1,
  importe REAL NOT NULL,            -- calculado: precio_unitario * cantidad (* noches si tipo=noche)
  noches INTEGER DEFAULT 1,         -- número de noches de la reserva en el momento de añadir
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reserva_pagos_reserva ON reserva_pagos(reserva_id);
CREATE INDEX IF NOT EXISTS idx_reserva_extras_reserva ON reserva_extras(reserva_id);
CREATE INDEX IF NOT EXISTS idx_reserva_extras_catalogo ON reserva_extras(catalogo_extra_id);

-- ==================== Módulo de Tarifas ====================

-- Temporadas de precios por año. precio_base_noche es el del Tipo A (referencia);
-- el resto de tipos aplican su modificador porcentual (tipo_modificadores).
CREATE TABLE IF NOT EXISTS temporadas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,                  -- 'Temporada Alta', 'Temporada Media'...
  anio INTEGER NOT NULL,
  fecha_inicio TEXT NOT NULL,            -- ISO YYYY-MM-DD
  fecha_fin TEXT NOT NULL,               -- ISO YYYY-MM-DD
  precio_base_noche REAL NOT NULL,       -- precio por noche del Tipo A (el que manda)
  color TEXT DEFAULT '#3b82f6',          -- para visualizar en calendario
  orden INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(anio, fecha_inicio, fecha_fin)
);

-- Modificador porcentual de precio por tipo de clasificación (A es la base, 0%).
CREATE TABLE IF NOT EXISTS tipo_modificadores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL UNIQUE,             -- 'A', 'A+', 'A++', 'B', 'B+', 'C'
  porcentaje REAL NOT NULL DEFAULT 0,    -- +20, -20, etc (positivo=incremento, negativo=decremento)
  orden INTEGER DEFAULT 0
);

-- Descuentos por intervalo de fechas con condiciones opcionales (mín. noches, tipos, portales).
CREATE TABLE IF NOT EXISTS descuentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,                  -- 'Early booking', 'Larga estancia'...
  porcentaje REAL NOT NULL,              -- % de descuento (ej: 10 = 10%)
  fecha_inicio TEXT NOT NULL,            -- intervalo donde aplica
  fecha_fin TEXT NOT NULL,
  anio INTEGER NOT NULL,
  min_noches INTEGER DEFAULT 0,          -- 0 = sin mínimo
  tipos TEXT,                            -- JSON array de tipos donde aplica, null = todos. Ej: '["A","A+"]'
  portales TEXT,                         -- JSON array de portales donde aplica, null = todos
  activo INTEGER DEFAULT 1,
  notas TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_temporadas_anio ON temporadas(anio);
CREATE INDEX IF NOT EXISTS idx_descuentos_anio ON descuentos(anio);

-- ==================== Fotos, estados de reserva y limpieza ====================

-- Galería de fotos de un apartamento. Los archivos viven en
-- public/uploads/apartamentos/{apartamento_id}/ y url es la ruta pública.
CREATE TABLE IF NOT EXISTS apartamento_fotos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  apartamento_id INTEGER NOT NULL REFERENCES apartamentos(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  nombre_archivo TEXT NOT NULL,
  descripcion TEXT,
  orden INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_apto_fotos_apartamento ON apartamento_fotos(apartamento_id);

-- Catálogo de estados de reserva (configurable en Ajustes). es_sistema=1 no se puede eliminar.
CREATE TABLE IF NOT EXISTS estados_reserva (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  orden INTEGER DEFAULT 0,
  activo INTEGER DEFAULT 1,
  es_sistema INTEGER DEFAULT 0
);

-- Histórico de cambios del estado de limpieza de un apartamento.
CREATE TABLE IF NOT EXISTS limpieza_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  apartamento_id INTEGER NOT NULL REFERENCES apartamentos(id) ON DELETE CASCADE,
  estado_anterior TEXT,
  estado_nuevo TEXT NOT NULL,
  usuario_id INTEGER REFERENCES usuarios(id),
  usuario_nombre TEXT,
  fecha TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_limpieza_log_apartamento ON limpieza_log(apartamento_id);

CREATE INDEX IF NOT EXISTS idx_actividad_fecha ON actividad_log(id);
CREATE INDEX IF NOT EXISTS idx_reservas_fechas ON reservas(entrada, salida);
CREATE INDEX IF NOT EXISTS idx_reservas_apartamento ON reservas(apartamento_id);
CREATE INDEX IF NOT EXISTS idx_apartamentos_tipo ON apartamentos(tipo);
