# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

CRM de gestión de **alquiler vacacional** para oficina con 4 ordenadores. Instalado en un PC servidor; los demás acceden por navegador en **red local sin internet**. Stack: Node.js + Express + SQLite + HTML/CSS/JS vanilla.

## Ubicación y arranque

El proyecto vive en **`C:\CRM`** (NO en OneDrive — ver Gotchas). El usuario lo arranca con doble clic en `iniciar-crm.bat`.

```powershell
$env:Path = "C:\Program Files\nodejs;" + $env:Path
npm install   # solo la primera vez
npm start     # equivale a: node C:\CRM\server.js
```

- Puerto **3000**, escucha en `0.0.0.0` (accesible desde la LAN).
- BD SQLite se crea sola en `db/crm.db` al arrancar (modo WAL).
- Scripts en raíz: `iniciar-crm.bat` (arranca), `backup.bat` (copia BD a `backups\AAAA-MM-DD_HH-MM-SS\`).
- Para reiniciar: `Get-Process node | Stop-Process -Force` y volver a lanzar (sin hot-reload).

## Arquitectura

```
server.js              Express: json + static(public) + /api/* + listen 3000.
db/database.js         better-sqlite3, WAL + foreign_keys. Ejecuta schema + migraciones ALTER
                       (anadirColumnasFaltantes) + seeds (admin por defecto, portales por defecto).
scripts/crear-usuario.js  Crear/actualizar usuario admin directamente en BD (node scripts/crear-usuario.js).
db/schema.sql          Tablas: propietarios, apartamentos, reservas, ajustes, razones_sociales,
                       usuarios, actividad_log, portales, contratos, contrato_cuotas,
                       catalogo_gastos, apartamento_gastos, facturas, factura_lineas, factura_contador,
                       reserva_pagos, catalogo_extras, reserva_extras.
routes/                Un router Express por recurso:
  apartamentos · propietarios · reservas · importar · ajustes · auth · usuarios ·
  portales · dashboard · estadisticas · contratos · gastos · facturas ·
  reserva-pagos (/api/reservas/:id/pagos) · catalogo-extras (exporta catalogo + reservaExtras)
services/
  importService.js     Parseo Excel/CSV de reservas (SheetJS), upsert por nº reserva, autoasignación.
  importPropietarios.js Parseo Excel/CSV propietarios (formato Avantio), upsert por email/documento/id_avantio.
  actividadService.js  registrarActividad(...) → inserta en actividad_log (defensivo, nunca rompe la op.).
  asignacion.js        buscarPisoLibre(apartamentos, ocupaciones, tih, entrada, salida) + normalizaTih.
  dateUtils.js         parseFecha (DD/MM/AAAA, serial Excel, ISO), solapan (intervalos medio abiertos).
public/                Frontend vanilla. Sin build, servido estático.
  index.html           SPA de 9 pestañas + menú lateral plegable + modal genérico + panel lateral + toast.
  css/styles.css       Tema claro (blanco / sidebar #1a1a2e). Variables CSS en :root.
  js/api.js            API.get/post/put/del/subirArchivo (header X-Auth-Token; 401→onNoAutorizado) +
                       API.getPortales() (caché en memoria, compartida por planning/reservas) +
                       toast() + abrirModal/cerrarModal + helpers (fechaES, tihTexto).
  js/auth.js           Auth (window.Auth). Sesión en localStorage('crm-sesion'). Login/logout.
  js/app.js            Gate de login + menú lateral (navegación, plegado, logout) + init de módulos.
                       Vista por defecto: Dashboard. activarTab('estadisticas') exige rol admin.
  js/dashboard.js      4 tarjetas (pagos pendientes, próximos check-in, reservas en curso, check-out)
                       desde GET /api/dashboard. Skeleton, error+reintentar, paginación 5/5, auto-refresco 5 min.
  js/planning.js       Vista continua de N días (estilo Avantio) con drag&drop e import.
                       Barras coloreadas por portal (con logo) o por TIH si no hay portal.
  js/alojamientos.js   Tabla + modal alta/edición (ficha ampliada con typeahead de propietario,
                       toggles En garantía / Quitar planning). Ficha en panel lateral con 3 pestañas:
                       Alojamiento (datos + "Recaudación del año"), Propietario (lazy load + link),
                       Gastos (por año, tabla con marcar cobrado/borrar + modal Añadir gasto con typeahead).
                       Expone abrirFicha(id).
  js/contratos.js      Contratos propietario: precio_cerrado o comision. Filtros año/tipo/propietario.
                       Tabla con badges y mini barra de cuotas. Expone filtrarPorPropietario(id, nombre).
  js/facturas.js       Facturación: tipos propietario/autofactura/gastos/huésped. Filtros año/tipo/estado.
                       Ficha en panel lateral (emisor/receptor, líneas, totales, PDF).
                       Wizard 2 pasos: tipo+razón social → datos según tipo (typeahead propietario→
                       contrato→cuotas / apartamento→gastos / reserva→huésped manual).
                       PDF: /api/facturas/:id/pdf en nueva pestaña.
  js/propietarios.js   Lista con avatar/búsqueda/orden/paginación. Ficha en panel lateral editable.
                       Modal por pestañas e importación Excel.
  js/reservas.js       Tabla + alta/edición manual + validación disponibilidad. Filtros avanzados
                       (panel "🔽 Filtros" inyectado por JS: clasificación/portal/estado/condición
                       multiselección + rango de fechas; badge contador; los botones TIH y el select
                       de mes de index.html se eliminan del DOM en runtime). Estado de filtros en vars
                       de módulo (persiste al cambiar de pestaña, no localStorage).
                       Ficha en panel lateral (sub-pestañas Datos/Mensajes/Margen/Liquidación; solo Datos funcional).
                       Datos contiene secciones EXTRAS y PAGOS (ver más abajo). Panel creado por JS.
  js/ajustes.js        Sub-pestañas: Razón Social / Usuarios / Actividad (admin) / Portales
                       (reordenar, color, logo) / Catálogo de gastos / Catálogo de extras.
                       Portales, Catálogo de gastos y Catálogo de extras se inyectan por JS.
  js/estadisticas.js   Solo admin. Selector de año + 4 sub-pestañas con datos reales y anti-respuesta-obsoleta:
                       (1) Ingresos por portal · (2) Ingresos por apartamento (general + detalle por apto) ·
                       (3) Ocupación (barras por mes + comparativa 1ª/2ª Línea) ·
                       (4) Propietarios 💰 (cashflow precio_cerrado → link a Contratos filtrado).
                       Sub-pestaña 4 y su panel se inyectan por JS (no en index.html).
```

**Orden de carga de scripts**: `api.js` y `auth.js` primero, `app.js` último. Los módulos se referencian entre sí solo en runtime (no en carga).

**Layout**: sidebar izquierdo plegable 220px↔56px (`.colapsado`; estado en `localStorage`). `<body>` es `flex-direction: row`. Cada pestaña: `<section id="vista-{nombre}" class="vista">` **dentro de `<main>`**. Overlays (`#modal-fondo`, paneles laterales, `#login-overlay`) van **fuera de `<main>`** como `position: fixed`.

## CSS / Diseño

Tema **claro**: fondo blanco, sidebar `#1a1a2e`, tipografía Inter. Variables principales:
- `--nav: #1a1a2e` · `--green: #10b981` · `--blue: #3b82f6` · `--red: #ef4444`
- `--border: #e5e7eb` / `--border-soft: #f0f0f0`

Patrones clave:
- Botones: `.btn-pri` / `.btn-sec` / `.btn-peligro`. `#btn-importar` sobreescribe con verde.
- Botones de tabla diferenciados por atributo: `[data-editar]` (azul pastel) / `[data-borrar]` (rojo pastel).
- **Planning**: `ANCHO_DIA = 28` en `planning.js` ↔ `.dia { width: 28px }` en CSS; `ANCHO_SEP = 32` ↔ `.col-sep-mes { width: 32px }`. Si se cambia uno, cambiar el otro.
- Portales: barra planning con `.barra-logo` (16px, `pointer-events:none`) + `.barra-texto`. En tabla/ficha: `.portal-cel-*` (20/10px) y `.portal-val-*` (24/12px). `onerror` oculta la imagen sin romper.
- Disponibilidad: `.disponibilidad-ok` / `.disponibilidad-error` / `.disponibilidad-aviso`.
- Estadísticas: clases `.est-*` (cards, tabla, barras de %).

## API REST

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | /api/apartamentos | Lista; `?todos=1` incluye `quitar_planning=1`; `?tih=` filtra |
| GET/PUT/DELETE | /api/apartamentos/:id | Ficha (campos ampliados + propietario + historial) / Editar (merge) / Borrar (reservas→Sin asignar) |
| GET/POST/PUT/DELETE | /api/apartamentos/:id/gastos[/:gasto_id] | Gastos del apto por año. POST: snapshot nombre+precio del catálogo |
| GET/POST/PUT/DELETE | /api/catalogo-gastos[/:id] | Catálogo de gastos. DELETE→409 si tiene gastos asociados |
| GET/POST/PUT/DELETE | /api/propietarios[/:id] | CRUD propietarios |
| POST | /api/propietarios/importar | Excel/CSV (campo `archivo`); upsert por email o documento |
| GET | /api/reservas | Para planning; `?desde=&hasta=` (ISO) + `?tih=` |
| GET | /api/reservas/sin-asignar | Bandeja sin asignar; `?tih=` |
| GET | /api/reservas/todas | Todas + apartamento_nombre; orden entrada DESC |
| GET | /api/reservas/verificar-disponibilidad | `?apartamento_id=&entrada=&salida=[&excluir_reserva_id=]` → `{ disponible, conflicto }` |
| GET/POST/PUT/DELETE | /api/reservas[/:id] | CRUD. POST→409 si numero_reserva duplicado |
| PUT | /api/reservas/:id/mover | Drag&drop; body `{apartamento_id}`; 409 si solapa. `null` → Sin asignar |
| GET/POST/PUT/DELETE | /api/reservas/:id/pagos[/:pago_id] | Plan de pagos. GET→`{pagos, total_pagado, total_pendiente, precio_total_reserva}`. POST pago manual (pagado sin fecha→hoy) |
| POST | /api/reservas/:id/pagos/generar-plan | Plan 20%/80%: borra pagos NO pagados y crea 2 cuotas. 409 si precio_total=0 |
| GET/POST/PUT/DELETE | /api/reservas/:id/extras[/:extra_id] | Extras de la reserva. POST `{catalogo_extra_id, cantidad}`: snapshot nombre/precio/tipo; importe = precio×cant (×noches si tipo='noche', noches via julianday). GET→`{extras, total_extras}` |
| GET/POST/PUT/DELETE | /api/catalogo-extras[/:id] | Catálogo de extras. GET activos primero, alfabético. DELETE→409 si usado en alguna reserva |
| GET/POST/PUT/DELETE | /api/portales[/:id] | CRUD portales |
| POST | /api/portales/:id/imagen | Multipart campo **`imagen`** (no `archivo`); .jpg/.jpeg/.png/.webp/.svg |
| POST | /api/importar | Excel/CSV (campo `archivo`); devuelve resumen |
| POST | /api/auth/login | **Pública**. `{username,password}` → `{ok,token,userId,username,nombre,rol}` |
| POST | /api/auth/logout | Limpia token (lee X-Auth-Token) |
| GET/POST/PUT/DELETE | /api/usuarios[/:id] | CRUD usuarios (no puedes eliminarte/desactivarte a ti mismo) |
| GET/POST/PUT/DELETE | /api/ajustes/razones-sociales[/:id] | CRUD razones sociales |
| POST | /api/ajustes/razones-sociales/:id/logo | Multipart campo `logo`; .jpg/.jpeg/.png/.webp/.svg |
| GET | /api/ajustes/actividad | **Solo admin**. `?usuario_id=&accion=&limit=200`; orden fecha DESC |
| GET | /api/dashboard | proximos_checkin, reservas_en_curso, proximos_checkout (máx 50 c/u), pagos_pendientes, reservas_entrantes |
| GET | /api/estadisticas/portales | `?anio=`. Ingresos por portal (excluye canceladas): totales, noches, resumen |
| GET | /api/estadisticas/apartamentos | `?anio=[&apartamento_id=]`. Sin id: ingresos+ocupación por apto. Con id: detalle + reservas del año |
| GET | /api/estadisticas/ocupacion | `?anio=`. por_mes[12] + por_tih + resumen. Maneja bisiestos |
| GET | /api/estadisticas/propietarios | `?anio=`. Cashflow precio_cerrado: comprometido/pagado/pendiente/próxima cuota por propietario |
| GET/POST/PUT/DELETE | /api/contratos[/:id] | CRUD contratos + cuotas (transacción). DELETE→409 si hay cuotas pagadas |
| GET | /api/contratos/resumen-propietario | `?propietario_id=&anio=` (**declarar antes de /:id**) |
| PUT | /api/contratos/:id/cuotas/:cuota_id | Marcar/desmarcar pago; sin fecha→usa hoy; desmarcar limpia fecha |
| GET/POST/PUT/DELETE | /api/facturas[/:id] | CRUD facturas. POST numera correlativo F-{anio}-NNN en transacción |
| GET | /api/facturas/:id/pdf | PDF pdfkit; `Content-Disposition: attachment` |
| PUT | /api/facturas/:id/anular | Marca estado='anulada' (no borra) |

Todas las rutas `/api/*` salvo `/api/auth/login` pasan por `requireAuth` (header `X-Auth-Token`) → `req.usuario = { id, nombre, username, rol }`.

**Orden en `routes/reservas.js`**: `/sin-asignar`, `/todas`, `/verificar-disponibilidad` deben declararse **antes** de `/:id`.

**Orden en `server.js`**: los sub-routers `/api/reservas/:id/pagos` y `/api/reservas/:id/extras` se montan **antes** de `/api/reservas` (igual que `/api/apartamentos/:id/gastos` antes de `/api/apartamentos`) para que `/:id` no capture esos prefijos.

## Modelo de datos

- **propietarios**: ~40 columnas (datos personales, contacto, domicilio, documentación, contables). `notas` = "Observaciones" en UI. `numero_documento` es el canónico (el campo `dni` es legado). `id_avantio` para upsert desde Avantio. `routes/propietarios.js` define `CAMPOS` como único punto de verdad para INSERT/UPDATE. Columnas nuevas: ALTER TABLE via `migrarPropietarios`.
- **apartamentos**: nombre, edificio, `tipo` ('1'|'2'), capacidad, notas, `propietario_id` (FK nullable). Ficha ampliada via `COLUMNAS_APARTAMENTOS`: clasificación (A/A+/A++/B/B+/C), orientación, situación, parking, wifi, `en_garantia`, `quitar_planning`, licencia_turistica, NRA, ref_catastral, escalera/piso/puerta. Edificio/TIH/bloque ocultos en UI pero conservados en BD.
- **reservas**: `numero_reserva` (TEXT UNIQUE), nombre_cliente, contrato, edificio, `tih` ('1'|'2'), personas, `entrada`/`salida` (ISO), observaciones, `apartamento_id` (NULL = "Sin asignar"). Campos de gestión: tipo_reserva, fecha_creacion, portal (TEXT por nombre), condicion_cancelacion, atendido_por, hora_entrada/salida, checkin/checkout_estado, precio_base/total/pagado/pendiente (pendiente = total−pagado, calculado en PUT), notas_internas, ocupante.
- **portales**: nombre (UNIQUE), activo, orden, color (def. `#3b82f6`), imagen_url. Portal se guarda en reservas por **nombre**, no por id. Semilla: Booking.com, Airbnb, Apartplaya, Viajes Himalaya, Web propia, Directo, Otro. Imágenes en `public/uploads/portales/`; al re-subir se borra la anterior.
- **ajustes**: almacén genérico clave/valor para uso futuro.
- **razones_sociales**: datos de facturación (razon_social, CIF, dirección, IBAN, logo_url). `RS_CAMPOS` en `routes/ajustes.js` como punto de verdad.
- **usuarios**: nombre, username (UNIQUE), password_hash (sha256 sin bcrypt), rol ('administrador'|'usuario'), activo, ultimo_acceso, token (sesión activa). Admin por defecto: `admin` / `admin1234`.
- **actividad_log**: usuario_id (FK sin ON DELETE — borrar usuario con registros requiere vaciar el log primero), usuario_nombre, accion, entidad, entidad_id, detalle, fecha.
- **contratos**: apartamento_id (FK NOT NULL, ON DELETE RESTRICT), propietario_id (FK nullable), tipo ('precio_cerrado'|'comision'), temporada_inicio/fin, anio, precio_total, porcentaje_comision, aplica_iva, porcentaje_retencion (0/19/24, def. 19), estado ('activo'|'finalizado'|'cancelado'), created_by. Fiscalidad precio_cerrado: total = base + IVA 21% − retención.
- **contrato_cuotas**: contrato_id (FK, ON DELETE CASCADE), numero_cuota, fecha_prevista, importe, pagado, fecha_pago. Suma de importes debe cuadrar con precio_total (±0.01€). PUT de contrato borra y reinserta todas las cuotas.
- **catalogo_gastos**: nombre (UNIQUE), precio, descripcion, activo, incluye_iva (informativo; precio lleva IVA 21%).
- **apartamento_gastos**: apartamento_id (FK, ON DELETE CASCADE), catalogo_gasto_id (FK nullable, ON DELETE SET NULL), nombre/precio (**snapshot** al insertar), fecha, notas, cobrado_propietario, created_by. Cambios en catálogo no afectan gastos ya registrados.
- **facturas**: tipo CHECK (huésped/propietario/autofactura/gastos), estado CHECK (borrador/emitida/pagada/anulada), numero UNIQUE (F-{anio}-NNN). Snapshot de emisor y receptor. IVA por tipo: propietario/autofactura→del contrato; gastos→21% si algún gasto lleva IVA; huésped→10%.
- **factura_lineas**: factura_id (FK, ON DELETE CASCADE), descripcion, cantidad, precio_unitario, importe, orden.
- **factura_contador**: anio PK / ultimo_numero. Numeración correlativa sin huecos dentro de la transacción del INSERT de factura.
- **reserva_pagos**: reserva_id (FK, ON DELETE CASCADE), concepto, importe, metodo_pago (CHECK caja/tpv/transferencia, nullable), pagado (0/1), fecha_pago (ISO, null hasta pagar), notas, orden, created_at. Plan de pagos del huésped. Sin migración en database.js (la tabla la crea schema.sql).
- **catalogo_extras**: nombre (UNIQUE), precio, tipo_precio (CHECK unidad/noche/persona, def. 'unidad'), descripcion, activo. Catálogo reutilizable gestionado en Ajustes.
- **reserva_extras**: reserva_id (FK, ON DELETE CASCADE), catalogo_extra_id (FK nullable, ON DELETE SET NULL), nombre/precio_unitario/tipo_precio (**snapshot**), cantidad, importe (calculado: precio×cant ×noches si tipo='noche'), noches (snapshot de noches de la reserva al añadir).

**Tablas nuevas sin migración**: `reserva_pagos`, `catalogo_extras`, `reserva_extras` se crean solo vía `CREATE TABLE IF NOT EXISTS` en schema.sql (re-ejecutado cada arranque). No hay entradas en `database.js` porque no existen BD antiguas que migrar con ALTER.

TIH: guardado como `'1'`/`'2'`, mostrado como "1ª Línea"/"2ª Línea" (`tihTexto`). Fechas en BD en ISO; en UI en DD/MM/AAAA (`fechaES`).

## Reglas de negocio

1. **Los pisos los crea el usuario a mano** (módulo Alojamientos). El Excel no indica a qué piso va cada reserva.
2. **Autoasignación al importar** (solo reservas nuevas): piso libre de la **misma TIH**. No filtra por edificio ni capacidad.
3. **Solape = intervalos medio abiertos**: `A.entrada < B.salida && B.entrada < A.salida`. El turnover (salida = entrada siguiente) NO solapa.
4. Sin piso libre de esa TIH → `apartamento_id = NULL` (bandeja "Sin asignar"), reportado como incidencia. El usuario la coloca con drag & drop.
5. **Upsert por `numero_reserva`**: si existe → UPDATE (conserva `apartamento_id`); si no → crea y autoasigna. Nunca se borran reservas automáticamente.
6. **Drag & drop** (`PUT /mover`): valida solape → 409 si choca. No restringe por TIH. `apartamento_id: null` devuelve a "Sin asignar".
7. **Alta manual**: `numero_reserva` único e inmutable. Selector de apartamentos filtrado por TIH. Validación de solape en frontend antes de guardar.

### Pagos y extras de la ficha de reserva (pestaña Datos)
- **Sección EXTRAS** (encima de PAGOS): tabla de `reserva_extras` + total. Modal Añadir con typeahead del catálogo (solo activos) y resumen en vivo; modal Editar solo cambia cantidad (nombre/precio son snapshot). Recargar extras repinta también PAGOS (el total de extras mueve el cálculo).
- **Sección PAGOS**: resumen `cobrado / total a cobrar`, barra de progreso y aviso de desfase. **Total a cobrar = `precio_total` + `total_extras`**. El campo "Precio" es solo lectura en la ficha; se edita desde el modal de edición (botón Editar de la cabecera, campo que escribe `precio_total`). `precio_base` es legado, ya no se edita desde la UI.
- **Aviso de desfase**: compara `suma de importes de todos los pagos` vs total a cobrar (tolerancia 0,01€). Suma > total → cartel naranja; suma < total con ≥1 pago → cartel azul.
- **Botones**: Añadir pago · Generar plan 20%/80% (confirma si hay pendientes; toast si precio=0) · 💰 Autocompletar pago (crea "Pago complementario" por la diferencia; toasts si no hay desfase o si los pagos superan el total).
- El modal de edición de reserva ya **no** tiene Hora entrada/salida ni Check-out (la sección de la ficha es solo "Check-in").

### Columnas del Excel de importación de reservas
`Reserva | Nombre Cliente | Contrato | Edificio | TIH | Per. | Entrada | Salida | Observaciones`
TIH llega como "1 Línea"/"2 Línea". Cabeceras normalizadas (minúsculas, sin acentos) en `importService.COLUMNAS`.

### Importación de propietarios (`importPropietarios.js`)
Formato Avantio: fila 0 = título "Lista", fila 1 = cabeceras, fila 2+ = datos → se parsea con `sheet_to_json({ header: 1, raw: true })` y `detectarFilaCabeceras` busca la primera fila válida. Upsert: email → numero_documento → id_avantio. Nunca borra. Transacción única (~1635 filas). `Nº cuenta` e `IBAN` mapean a `numero_cuenta` (gana el primero no-nulo).

## Gotchas / decisiones técnicas

- **⚠️ NUNCA poner la BD en OneDrive/Dropbox.** OneDrive sincronizaba el `crm.db` en uso y llegó a **restaurar una versión antigua** pisando datos reales. Por eso está en `C:\CRM`. Resetear solo con el servidor parado.
- **WAL — copiar siempre los 3 archivos juntos**: `crm.db`, `crm.db-wal`, `crm.db-shm`. Copiar solo `crm.db` puede perder los últimos cambios (el WAL puede tener datos no volcados; `crm.db` puede verse ~4 KB).
- **SheetJS y fechas**: leer con `xlsx.read(buffer, { raw: true })`. Sin `raw:true`, "02/06/2026" se interpreta como fecha americana MM/DD. **No usar `cellDates:true`.**
- **better-sqlite3 12.x**: síncrono → las rutas no usan async/await para la BD. Elegido por binarios precompilados para Node 24 (evita compilar con Visual Studio). Lanza al hacer bind de `undefined` → el frontend envía siempre todos los campos (string vacío).
- **Migraciones ALTER TABLE**: SQLite no permite DEFAULT con expresión (`datetime('now')`). DEFAULT constantes (`'Confirmada'`, `0`) sí valen. Para columnas de fecha: añadir sin DEFAULT, rellenar con UPDATE las filas viejas, fijar explícitamente en el INSERT.
- **multer 2.x**: memoryStorage + `.single('archivo')` (la 1.x tenía vulnerabilidades).
- **PDF con pdfkit** (no puppeteer): JS puro, sin Chromium, funciona offline. Logo embebido con `fs.readFileSync` **solo si es PNG/JPG** (no SVG/WEBP). Buffer acumulado de eventos `data`/`end`.
- **Autenticación** (LAN de confianza): token = sha256(username+password+fecha), guardado en `usuarios.token`. Una sesión por usuario (nuevo login invalida la anterior). Token persiste en BD, sobrevive a reinicios. `API.getPortales()` cachea en memoria de sesión — cambios en portales no se reflejan hasta F5.
- **Subida de imagen de portal**: campo multipart **`imagen`** (no `archivo`). `ajustes.js` hace el fetch a mano con `X-Auth-Token` porque `API.subirArchivo` usa el campo `archivo`.
- **`ANCHO_DIA = 28` en `planning.js`** debe coincidir con `.dia { width: 28px }` en CSS (y `ANCHO_SEP = 32` con `.col-sep-mes`). El nº de columnas se recalcula por `ResizeObserver`.
- **Secciones fuera de `<main>`**: los overlays (`#modal-fondo`, paneles laterales, `#login-overlay`) van fuera de `<main>` a propósito (`position: fixed`). Todo lo demás dentro.

## Cómo probar la API (sin navegador)

PowerShell 5.1 no soporta `Invoke-RestMethod -Form`. Para subir archivos usar `curl.exe`:
```powershell
curl.exe -s -F "archivo=@ruta\reservas.csv" http://localhost:3000/api/importar
```
Para acentos en consola: `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`.

```powershell
# Crear reserva manual
$body = @{ numero_reserva="TEST-001"; nombre_cliente="Test"; tih="1"; entrada="2026-08-01"; salida="2026-08-10" } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3000/api/reservas" -Method POST -Body $body -ContentType "application/json"

# Verificar disponibilidad
Invoke-RestMethod "http://localhost:3000/api/reservas/verificar-disponibilidad?apartamento_id=1&entrada=2026-08-01&salida=2026-08-10"
```

## Backups

`db/crm.db` (+ `-wal`/`-shm`) y `backups/` están en `.gitignore`.

- **Hacer copia**: `backup.bat` → `backups\AAAA-MM-DD_HH-MM-SS\` con los **tres** archivos.
- **Restaurar**: parar el servidor, copiar los tres archivos de vuelta a `db\`.
