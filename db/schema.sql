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

-- Fechas de uso del propietario dentro de un contrato (generan reservas "De propietario";
-- el resto de la temporada fuera del contrato se rellena con bloqueos automáticos).
CREATE TABLE IF NOT EXISTS contrato_fechas_propietario (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  contrato_id   INTEGER NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
  fecha_inicio  TEXT NOT NULL,
  fecha_fin     TEXT NOT NULL,
  motivo        TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_contratos_apartamento ON contratos(apartamento_id);
CREATE INDEX IF NOT EXISTS idx_contratos_propietario ON contratos(propietario_id);
CREATE INDEX IF NOT EXISTS idx_contratos_anio ON contratos(anio);
CREATE INDEX IF NOT EXISTS idx_cuotas_contrato ON contrato_cuotas(contrato_id);
CREATE INDEX IF NOT EXISTS idx_contrato_fechas_prop ON contrato_fechas_propietario(contrato_id);

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

-- ==================== Módulo de Limpieza ====================

-- Tareas de limpieza programadas por día (checkout/turnover automáticos o manuales).
CREATE TABLE IF NOT EXISTS limpieza_tareas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  apartamento_id INTEGER NOT NULL REFERENCES apartamentos(id) ON DELETE CASCADE,
  fecha TEXT NOT NULL,                    -- ISO YYYY-MM-DD, día para el que se programa
  tipo TEXT DEFAULT 'checkout' CHECK(tipo IN ('checkout','manual','turnover')),
  prioridad INTEGER DEFAULT 0,           -- 0=normal, 1=urgente (turnover mismo día)
  estado TEXT DEFAULT 'pendiente' CHECK(estado IN ('pendiente','en_proceso','completada')),
  reserva_checkout_id INTEGER REFERENCES reservas(id) ON DELETE SET NULL,
  reserva_checkin_id INTEGER REFERENCES reservas(id) ON DELETE SET NULL,
  asignado_a INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  asignado_nombre TEXT,
  completado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  completado_nombre TEXT,
  completado_fecha TEXT,
  notas_limpieza TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_limpieza_tareas_fecha ON limpieza_tareas(fecha);
CREATE INDEX IF NOT EXISTS idx_limpieza_tareas_apartamento ON limpieza_tareas(apartamento_id);

-- Fotos de reporte de una tarea de limpieza. Archivos en public/uploads/limpieza/{tarea_id}/.
CREATE TABLE IF NOT EXISTS limpieza_fotos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tarea_id INTEGER NOT NULL REFERENCES limpieza_tareas(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  nombre_archivo TEXT NOT NULL,
  descripcion TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_limpieza_fotos_tarea ON limpieza_fotos(tarea_id);

-- Tareas de mantenimiento (estilo kanban: columnas por estado, ordenadas por posicion).
-- Pueden vincularse a una reserva (cliente que reporta la incidencia).
CREATE TABLE IF NOT EXISTS mantenimiento_tareas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  apartamento_id INTEGER NOT NULL REFERENCES apartamentos(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  descripcion TEXT,
  estado TEXT DEFAULT 'pendiente' CHECK(estado IN ('urgente','pendiente','en_proceso','completada')),
  posicion INTEGER DEFAULT 0,
  reserva_id INTEGER REFERENCES reservas(id) ON DELETE SET NULL,
  cliente_nombre TEXT,
  cliente_telefono TEXT,
  asignado_a INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  asignado_nombre TEXT,
  completado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  completado_nombre TEXT,
  completado_fecha TEXT,
  fecha_creacion TEXT DEFAULT (datetime('now')),
  fecha_limite TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mantenimiento_tareas_estado ON mantenimiento_tareas(estado);
CREATE INDEX IF NOT EXISTS idx_mantenimiento_tareas_apartamento ON mantenimiento_tareas(apartamento_id);

-- Notas/comentarios de una tarea de mantenimiento (hilo cronológico).
CREATE TABLE IF NOT EXISTS mantenimiento_notas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tarea_id INTEGER NOT NULL REFERENCES mantenimiento_tareas(id) ON DELETE CASCADE,
  texto TEXT NOT NULL,
  usuario_id INTEGER REFERENCES usuarios(id),
  usuario_nombre TEXT,
  fecha TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mantenimiento_notas_tarea ON mantenimiento_notas(tarea_id);

-- Fotos de una tarea de mantenimiento. Archivos en public/uploads/mantenimiento/{tarea_id}/.
CREATE TABLE IF NOT EXISTS mantenimiento_fotos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tarea_id INTEGER NOT NULL REFERENCES mantenimiento_tareas(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  nombre_archivo TEXT NOT NULL,
  descripcion TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mantenimiento_fotos_tarea ON mantenimiento_fotos(tarea_id);

-- ===================== Módulo de Ventas (inmobiliaria) =====================

-- Propiedades en venta. Se importan desde el Excel de Idealista (upsert por referencia);
-- los campos estado/notas/descripcion son del CRM y la importación no los pisa.
CREATE TABLE IF NOT EXISTS propiedades_venta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referencia TEXT UNIQUE NOT NULL,
  codigo_idealista TEXT,
  tipo TEXT,
  calle TEXT,
  numero TEXT,
  planta TEXT,
  zona TEXT,
  localidad TEXT,
  precio REAL,
  dormitorios INTEGER,
  banos INTEGER,
  metros_cuadrados REAL,
  metros_utiles REAL,
  clase_energetica TEXT,
  garaje TEXT,
  num_fotos INTEGER DEFAULT 0,
  estado TEXT DEFAULT 'Disponible' CHECK(estado IN ('Disponible','Reservada','Vendida','Retirada')),
  estado_idealista TEXT,
  fecha_alta TEXT,
  fecha_baja TEXT,
  propietario_nombre TEXT,
  propietario_apellidos TEXT,
  propietario_telefono TEXT,
  propietario_email TEXT,
  descripcion TEXT,
  notas TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_propiedades_venta_estado ON propiedades_venta(estado);
CREATE INDEX IF NOT EXISTS idx_propiedades_venta_zona ON propiedades_venta(zona);

-- Clientes compradores (demanda) con sus criterios de búsqueda.
CREATE TABLE IF NOT EXISTS clientes_compradores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  apellidos TEXT,
  telefono TEXT,
  email TEXT,
  presupuesto_max REAL,
  busca_tipo TEXT,
  busca_dormitorios INTEGER,
  busca_zona TEXT,
  busca_linea TEXT,
  busca_frontal INTEGER DEFAULT 0,
  busca_villa INTEGER DEFAULT 0,
  notas TEXT,
  estado TEXT DEFAULT 'Nuevo' CHECK(estado IN ('Nuevo','Contactado','Visitado','En negociación','Compró','Descartado')),
  origen TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_clientes_compradores_estado ON clientes_compradores(estado);

-- Visitas de un cliente a una propiedad.
CREATE TABLE IF NOT EXISTS visitas_venta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL REFERENCES clientes_compradores(id) ON DELETE CASCADE,
  propiedad_id INTEGER NOT NULL REFERENCES propiedades_venta(id) ON DELETE CASCADE,
  fecha TEXT NOT NULL,
  hora TEXT,
  estado TEXT DEFAULT 'Programada' CHECK(estado IN ('Programada','Realizada','Cancelada')),
  valoracion TEXT,
  notas TEXT,
  atendido_por TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(cliente_id, propiedad_id, fecha)
);
CREATE INDEX IF NOT EXISTS idx_visitas_venta_fecha ON visitas_venta(fecha);
CREATE INDEX IF NOT EXISTS idx_visitas_venta_cliente ON visitas_venta(cliente_id);
CREATE INDEX IF NOT EXISTS idx_visitas_venta_propiedad ON visitas_venta(propiedad_id);

-- Hilo de notas de una visita.
CREATE TABLE IF NOT EXISTS visitas_notas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visita_id INTEGER NOT NULL REFERENCES visitas_venta(id) ON DELETE CASCADE,
  texto TEXT NOT NULL,
  usuario_nombre TEXT,
  fecha TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_visitas_notas_visita ON visitas_notas(visita_id);

-- Propiedades de una visita (N:M). visitas_venta.propiedad_id queda como compat (1ª propiedad).
CREATE TABLE IF NOT EXISTS visitas_propiedades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visita_id INTEGER NOT NULL REFERENCES visitas_venta(id) ON DELETE CASCADE,
  propiedad_id INTEGER NOT NULL REFERENCES propiedades_venta(id) ON DELETE CASCADE,
  UNIQUE(visita_id, propiedad_id)
);
CREATE INDEX IF NOT EXISTS idx_visitas_propiedades_visita ON visitas_propiedades(visita_id);
CREATE INDEX IF NOT EXISTS idx_visitas_propiedades_propiedad ON visitas_propiedades(propiedad_id);

-- Propietarios del módulo de ventas (inmobiliaria). Pueden importarse desde los
-- propietarios de alquiler (propietario_alquiler_id apunta al original para no duplicar)
-- o crearse como propietarios exclusivos de ventas (propietario_alquiler_id NULL).
CREATE TABLE IF NOT EXISTS propietarios_venta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  apellidos TEXT,
  telefono TEXT,
  telefono2 TEXT,
  email TEXT,
  dni TEXT,
  direccion TEXT,
  ciudad TEXT,
  codigo_postal TEXT,
  notas TEXT,
  propietario_alquiler_id INTEGER REFERENCES propietarios(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_propietarios_venta_alquiler ON propietarios_venta(propietario_alquiler_id);

-- ===================== Pagos de Mayoristas =====================

-- Mayoristas (turoperadores / agencias con contrato anual de cupo).
CREATE TABLE IF NOT EXISTS mayoristas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  cif TEXT,
  direccion TEXT,
  telefono TEXT,
  email TEXT,
  contacto_nombre TEXT,
  notas TEXT,
  activo INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Contrato anual con un mayorista (importe total comprometido del año).
CREATE TABLE IF NOT EXISTS mayorista_contratos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mayorista_id INTEGER NOT NULL REFERENCES mayoristas(id) ON DELETE CASCADE,
  anio INTEGER NOT NULL,
  descripcion TEXT,
  importe_total REAL NOT NULL,
  estado TEXT DEFAULT 'activo' CHECK(estado IN ('activo','finalizado','cancelado')),
  notas TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(mayorista_id, anio)
);
CREATE INDEX IF NOT EXISTS idx_mayorista_contratos_mayorista ON mayorista_contratos(mayorista_id);
CREATE INDEX IF NOT EXISTS idx_mayorista_contratos_anio ON mayorista_contratos(anio);

-- Plan de pagos de un contrato de mayorista (cuotas previstas).
CREATE TABLE IF NOT EXISTS mayorista_pagos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contrato_id INTEGER NOT NULL REFERENCES mayorista_contratos(id) ON DELETE CASCADE,
  numero_pago INTEGER NOT NULL,
  fecha_prevista TEXT NOT NULL,
  importe REAL NOT NULL,
  pagado INTEGER DEFAULT 0,
  fecha_pago TEXT,
  metodo_pago TEXT CHECK(metodo_pago IN ('transferencia','cheque','efectivo')),
  numero_factura TEXT,
  notas TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mayorista_pagos_contrato ON mayorista_pagos(contrato_id);

-- ===================== Módulo de Personal (RRHH) =====================

-- Empleados de la oficina. usuario_id (opcional) vincula con el usuario del CRM
-- para que ese usuario pueda fichar como este empleado.
CREATE TABLE IF NOT EXISTS empleados (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER UNIQUE REFERENCES usuarios(id) ON DELETE SET NULL,
  nombre TEXT NOT NULL,
  apellidos TEXT,
  dni TEXT,
  telefono TEXT,
  email TEXT,
  puesto TEXT,
  fecha_inicio TEXT,
  dias_vacaciones_anio INTEGER DEFAULT 30,
  activo INTEGER DEFAULT 1,
  notas TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Registro de fichajes (control horario). Una fila por evento del día.
CREATE TABLE IF NOT EXISTS fichajes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empleado_id INTEGER NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
  fecha TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK(tipo IN ('entrada','pausa','reanudacion','salida')),
  hora TEXT NOT NULL,
  notas TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fichajes_empleado_fecha ON fichajes(empleado_id, fecha);

-- Ausencias (vacaciones, días libres, bajas...).
CREATE TABLE IF NOT EXISTS ausencias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empleado_id INTEGER NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK(tipo IN ('vacaciones','dia_libre','dia_gracia','baja_medica','asuntos_propios')),
  fecha_inicio TEXT NOT NULL,
  fecha_fin TEXT NOT NULL,
  dias INTEGER NOT NULL,
  estado TEXT DEFAULT 'aprobada' CHECK(estado IN ('pendiente','aprobada','rechazada')),
  aprobado_por TEXT,
  notas TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ausencias_empleado ON ausencias(empleado_id);

-- Horas extra registradas por empleado.
CREATE TABLE IF NOT EXISTS horas_extra (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empleado_id INTEGER NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
  fecha TEXT NOT NULL,
  horas REAL NOT NULL,
  descripcion TEXT,
  pagada INTEGER DEFAULT 0,
  importe REAL,
  fecha_pago TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_horas_extra_empleado ON horas_extra(empleado_id);

-- ===========================================================================
-- Módulo Leads (captación de clientes de alquiler vacacional)
-- ===========================================================================

-- Plantillas de email reutilizables para las propuestas (con marcadores {nombre}, etc.).
CREATE TABLE IF NOT EXISTS lead_plantillas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  asunto TEXT NOT NULL,
  cuerpo TEXT NOT NULL,
  activa INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Leads: clientes potenciales de alquiler que aún no han reservado.
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  telefono TEXT,
  email TEXT,
  apartamento_id INTEGER REFERENCES apartamentos(id) ON DELETE SET NULL,
  apartamento_nombre TEXT,
  fecha_entrada TEXT,
  fecha_salida TEXT,
  personas INTEGER,
  presupuesto REAL,
  estado TEXT DEFAULT 'nuevo' CHECK(estado IN ('nuevo','contactado','propuesta_enviada','esperando_respuesta','reservado','descartado')),
  notas TEXT,
  reserva_id INTEGER REFERENCES reservas(id) ON DELETE SET NULL,
  atendido_por TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_leads_estado ON leads(estado);

-- Propuestas (emails de oferta) enviadas o preparadas para un lead.
CREATE TABLE IF NOT EXISTS lead_propuestas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  asunto TEXT NOT NULL,
  mensaje TEXT NOT NULL,
  apartamento_id INTEGER REFERENCES apartamentos(id) ON DELETE SET NULL,
  precio_propuesto REAL,
  fotos_enviadas TEXT,
  email_destino TEXT,
  enviada INTEGER DEFAULT 0,
  fecha_envio TEXT,
  plantilla_id INTEGER REFERENCES lead_plantillas(id) ON DELETE SET NULL,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lead_propuestas_lead ON lead_propuestas(lead_id);

-- Hilo cronológico de notas (chat) de un lead.
CREATE TABLE IF NOT EXISTS lead_notas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  texto TEXT NOT NULL,
  usuario_nombre TEXT,
  fecha TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lead_notas_lead ON lead_notas(lead_id);

-- ===========================================================================
-- Clientes (huéspedes/inquilinos) — importables del export de Avantio.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  id_avantio TEXT,
  nombre TEXT NOT NULL,
  apellido1 TEXT,
  apellido2 TEXT,
  fecha_nacimiento TEXT,
  sexo TEXT,
  nacionalidad TEXT,
  calle TEXT,
  numero TEXT,
  puerta TEXT,
  codigo_postal TEXT,
  ciudad TEXT,
  provincia TEXT,
  pais TEXT,
  dni TEXT,
  email TEXT,
  email2 TEXT,
  telefono TEXT,
  telefono2 TEXT,
  telefono3 TEXT,
  idioma TEXT,
  tipo_cliente TEXT,
  cuenta_bancaria TEXT,
  codigo_fiscal TEXT,
  observaciones TEXT,
  cuenta_contable TEXT,
  region TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_clientes_avantio ON clientes(id_avantio);
CREATE INDEX IF NOT EXISTS idx_clientes_email ON clientes(email);

-- Pagos a propietario por apartamento (suministros, comunidad, IBI…). Cada pago puede
-- generar una autofactura (factura_id la vincula).
CREATE TABLE IF NOT EXISTS pagos_propietario (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  apartamento_id INTEGER NOT NULL REFERENCES apartamentos(id) ON DELETE CASCADE,
  concepto TEXT NOT NULL,
  importe REAL NOT NULL,
  fecha TEXT NOT NULL,
  pagado INTEGER DEFAULT 0,
  fecha_pago TEXT,
  factura_id INTEGER REFERENCES facturas(id) ON DELETE SET NULL,
  notas TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pagos_propietario_apto ON pagos_propietario(apartamento_id);

-- Restricciones de fechas: bloquean visualmente días en el planning y avisan al crear
-- reservas. NO impiden crear reservas (solo aviso). Se gestionan en Ajustes (solo admin).
CREATE TABLE IF NOT EXISTS restricciones (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha_inicio TEXT NOT NULL,
  fecha_fin    TEXT NOT NULL,
  motivo       TEXT,
  created_by   TEXT,
  created_at   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_restricciones_fechas ON restricciones(fecha_inicio, fecha_fin);

-- ===========================================================================
-- Extras (inventario de objetos prestables: cunas, tronas, ventiladores...).
-- Stock + préstamos/devoluciones por apartamento/reserva.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS extras_categorias (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre     TEXT NOT NULL UNIQUE,
  icono      TEXT DEFAULT '📦',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS extras_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre       TEXT NOT NULL,
  categoria_id INTEGER REFERENCES extras_categorias(id) ON DELETE SET NULL,
  stock_total  INTEGER DEFAULT NULL,   -- NULL = ilimitado
  descripcion  TEXT,
  created_at   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_extras_items_categoria ON extras_items(categoria_id);

CREATE TABLE IF NOT EXISTS extras_movimientos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id        INTEGER NOT NULL REFERENCES extras_items(id) ON DELETE CASCADE,
  apartamento_id INTEGER REFERENCES apartamentos(id) ON DELETE SET NULL,
  reserva_id     INTEGER REFERENCES reservas(id) ON DELETE SET NULL,
  cantidad       INTEGER NOT NULL DEFAULT 1,
  tipo           TEXT NOT NULL CHECK(tipo IN ('prestamo','devolucion')),
  fecha          TEXT NOT NULL DEFAULT (date('now')),
  notas          TEXT,
  created_by     TEXT,
  created_at     TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_extras_mov_item ON extras_movimientos(item_id);
CREATE INDEX IF NOT EXISTS idx_extras_mov_apartamento ON extras_movimientos(apartamento_id);

CREATE INDEX IF NOT EXISTS idx_actividad_fecha ON actividad_log(id);
CREATE INDEX IF NOT EXISTS idx_reservas_fechas ON reservas(entrada, salida);
CREATE INDEX IF NOT EXISTS idx_reservas_apartamento ON reservas(apartamento_id);
CREATE INDEX IF NOT EXISTS idx_apartamentos_tipo ON apartamentos(tipo);
