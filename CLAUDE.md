# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

CRM de gestión de **alquiler vacacional** para una oficina con 4 ordenadores. Se instala
en un PC servidor de la oficina y los demás equipos acceden por navegador en **red local
sin internet**. Web app: Node.js + Express + SQLite + HTML/CSS/JS vanilla (sin frameworks
de frontend).

## Ubicación

El proyecto vive en **`C:\CRM`** (servidor de la oficina). NO está en OneDrive — ver el
aviso en "Gotchas". El usuario final lo arranca con doble clic en `iniciar-crm.bat`.

## Cómo arrancar

```powershell
# Node está en C:\Program Files\nodejs (puede no estar en el PATH de la sesión)
$env:Path = "C:\Program Files\nodejs;" + $env:Path
npm install            # solo la primera vez (requiere internet una vez)
npm start              # equivale a: node C:\CRM\server.js
```

- `server.js` usa `__dirname`, así que funciona desde cualquier CWD (rutas a `db/` y
  `public/` resueltas relativas al archivo, no al directorio actual).
- Scripts `.bat` en la raíz:
  - **`iniciar-crm.bat`** — arranca el servidor (detecta Node aunque no esté en el PATH).
  - **`backup.bat`** — copia la BD a `backups\AAAA-MM-DD_HH-MM-SS\` (ver "Backups").
- Puerto **3000**, escucha en `0.0.0.0` (accesible desde la LAN).
- La BD SQLite se crea sola en `db/crm.db` al arrancar (modo WAL).
- Para reiniciar el servidor hay que matar el proceso node y volver a lanzarlo (no hay
  hot-reload). Detener: `Get-Process node | Stop-Process -Force`.

## Arquitectura

```
server.js              Express: json + static(public) + monta /api/* + errores. listen 3000.
db/database.js         Conexión better-sqlite3 (síncrono), pragma WAL + foreign_keys; ejecuta schema + migraciones ALTER (anadirColumnasFaltantes para propietarios/reservas/portales/contratos) + seeds (admin por defecto, portales por defecto).
scripts/crear-usuario.js  Script suelto (node scripts/crear-usuario.js) para crear/actualizar un usuario admin directamente en la BD sin pasar por el seed.
db/schema.sql          Tablas: propietarios, apartamentos, reservas, ajustes, razones_sociales, usuarios, actividad_log, portales, contratos, contrato_cuotas (+ índices).
routes/                Un router Express por recurso (CRUD + acciones).
  apartamentos.js · propietarios.js · reservas.js · importar.js · ajustes.js · auth.js · usuarios.js · portales.js · dashboard.js · estadisticas.js · contratos.js
services/
  importService.js     Parseo Excel/CSV de reservas (SheetJS), upsert por nº reserva, autoasignación.
  importPropietarios.js Parseo Excel/CSV de propietarios, mapeo flexible de cabeceras, upsert por email o documento.
  actividadService.js  registrarActividad(db, usuarioId, usuarioNombre, accion, entidad, entidadId, detalle) -> inserta en actividad_log (defensivo).
  asignacion.js        buscarPisoLibre(apartamentos, ocupaciones, tih, entrada, salida) + normalizaTih.
  dateUtils.js         parseFecha (DD/MM/AAAA, serial Excel, ISO), solapan (intervalos medio abiertos).
public/                Frontend vanilla. Sin build, se sirve estático.
  index.html           SPA de 8 pestañas (Dashboard por defecto; Estadísticas solo admin) + menú lateral plegable + modal genérico + panel lateral + toast.
  uploads/portales/    Imágenes/logos de portales subidos (servidos estáticos; ver tabla portales).
  css/styles.css       Tema claro (fondo blanco, sidebar #1a1a2e). Variables CSS en :root.
  js/api.js            API.get/post/put/del/subirArchivo (añaden header X-Auth-Token; 401 -> window.onNoAutorizado) + API.getPortales() (lista de portales cacheada en memoria, compartida por planning/reservas) + toast() + abrirModal/cerrarModal + helpers (esc, fechaES, tihTexto).
  js/auth.js           Módulo Auth (window.Auth). Sesión en localStorage ('crm-sesion'), pantalla de login, logout. onNoAutorizado -> vuelve al login.
  js/dashboard.js      Módulo Dashboard (window.Dashboard). Pantalla de inicio (1ª pestaña). 4 tarjetas (pagos pendientes, próximos check-in, reservas en curso, próximos check-out) desde GET /api/dashboard + API.getPortales(); skeleton de carga, error+reintentar, paginación 5/5 y auto-refresco cada 5 min.
  js/planning.js       Módulo Planning (IIFE -> window.Planning). Vista continua de N días (estilo Avantio) desde una fecha de inicio, drag&drop, import. Las barras se colorean con el color del portal (con su logo dentro) y, si no hay portal, con el color por TIH.
  js/alojamientos.js   Módulo Alojamientos (window.Alojamientos). Tabla + form modal + ficha. Expone `abrirFicha(id)` (lo usa Contratos para enlazar al apartamento).
  js/contratos.js      Módulo Contratos (window.Contratos). Contratos de gestión con el propietario: precio_cerrado (importe garantizado en cuotas) o comision (% sobre cada reserva). Cabecera con filtro de año + tipo y "Nuevo contrato"; tabla (badges tipo/estado, Importe/% según tipo, columna Cuotas X/Y con mini barra). Ficha en **panel lateral creado por JS** (reutiliza `.panel-lateral`/`.rsv-*`): Datos del contrato (apartamento con link a su ficha, IVA/retención, cálculo fiscal), y según tipo: plan de pagos (tabla de cuotas con marcar/desmarcar pago vía mini modal, pie Precio base/IVA/Retención/Total/Pagado/Pendiente) o resumen de comisión (reservas del apto ese año × %). Modal alta/edición: **autocompletado typeahead** del apartamento (≥2 chars, busca nombre/edificio, ↑↓/Enter/Esc, autorrellena propietario), radios grandes de tipo, rango de temporada, sección Fiscalidad (IVA 21% + retención 0/19/24 con resumen en vivo, solo precio_cerrado) y plan de pagos dinámico (añadir/eliminar cuotas, "Distribuir automáticamente", contador de cuadre verde/rojo).
  js/propietarios.js   Módulo Propietarios (window.Propietarios). Lista con avatar/búsqueda/orden/paginación, ficha en panel lateral deslizante editable, modal por pestañas e importación Excel.
  js/reservas.js       Módulo Reservas (window.Reservas). Tabla (con columna Portal: logo o círculo de color) + filtros + alta/edición manual + validación de disponibilidad + ficha en panel lateral deslizante (sub-pestañas Datos/Mensajes/Margen comercial/Liquidación propietario; solo Datos es funcional) con modal de edición de los campos de gestión. El panel del lateral se crea dinámicamente por JS (no está en index.html).
  js/ajustes.js        Módulo Ajustes (window.Ajustes). Sub-pestañas Razón Social (tarjetas + modal) / Usuarios (tabla + modal) / Actividad (admin) / Portales (tabla con logo+color, reordenar ▲▼, modal con selector de color y subida de logo). La sub-pestaña Portales y su panel se inyectan por JS.
  js/estadisticas.js   Módulo Estadísticas (window.Estadisticas). **Solo administradores** (ítem de sidebar `#nav-estadisticas` oculto si no es admin; guard en `activarTab`). Cabecera con título + selector de año (2024/2025/2026, actual por defecto) y 4 sub-pestañas (reusan `.subtab`/`.sub-panel`), **todas con datos reales**; cada una hace skeleton/error+reintentar y comparte el guard `reqSeq` anti-respuesta-obsoleta. (1) **"Ingresos por portal"** (GET /api/estadisticas/portales): 2 tarjetas de resumen + tabla con barra de % sobre ingresos_cobrados. (2) **"Ingresos por apartamento"** (GET /api/estadisticas/apartamentos): dos modos — vista general (3 tarjetas, buscador que filtra en memoria sin recargar, tabla con badge TIH + barra de ocupación coloreada por umbral + barra de % de ingresos; clic en fila → detalle) y vista detalle (botón "← Volver", cabecera + 3 tarjetas + tabla de reservas con total al pie, GET con `&apartamento_id=`). Cachea la vista general por año (`aptoCache`); el cambio de año invalida la caché. (3) **"Ocupación"** (GET /api/estadisticas/ocupacion): 4 tarjetas + gráfico de barras verticales por mes (CSS inline, color por umbral, mes actual resaltado) + comparativa 1ª/2ª Línea. (4) **"Propietarios 💰"** (GET /api/estadisticas/propietarios): cashflow de contratos precio_cerrado — 4 tarjetas + barra de cashflow (verde pagado / naranja pendiente) + tabla por propietario (Comprometido/Pagado con mini barra/Pendiente/Próxima cuota/"Ver contratos") con buscador en memoria, totales en `<tfoot>` y caché por año (`propCache`). **Esta 4ª sub-pestaña y su panel se inyectan por JS** (`inyectarSubPropietarios`), no están en index.html. Recarga al cambiar año o sub-pestaña.
  js/app.js            Gate de login (arranca la app solo con sesión) + menú lateral (navegación, plegado, usuario, logout) + init de los módulos. La vista por defecto al entrar es Dashboard. `activarTab('estadisticas')` exige rol admin (si no, toast "Acceso restringido a administradores" y no activa); el ítem del sidebar se muestra/oculta por rol en `arrancarApp`.
```

Frontend: cada módulo es una IIFE que expone un objeto global (`Dashboard`, `Planning`,
`Alojamientos`, `Contratos`, `Propietarios`, `Reservas`, `Ajustes`, `Estadisticas`, `Auth`). El orden de carga de scripts en `index.html`
importa: `api.js` y `auth.js` primero (definen helpers globales y sesión), `app.js` último
(orquesta; arranca los módulos solo si hay sesión válida). Los módulos se referencian entre
sí solo dentro de handlers en runtime (no en carga).

**Menú lateral**: la navegación es un sidebar izquierdo (`#sidebar`, `.nav-item[data-tab]`),
no una navbar superior. Plegable (220px ↔ 56px) con clase `.colapsado`; el estado se guarda
en `localStorage` (`sidebar-colapsado`). El `<body>` es `flex-direction: row` (sidebar +
`main` con `min-width: 0`). `app.js` gobierna el toggle y `activarTab`.

**Secciones HTML**: cada pestaña tiene un `<section id="vista-{nombre}" class="vista">` que
debe estar **dentro de `<main>`**. Sacarlo de `<main>` rompe el layout flex-column que
gestiona la altura; el contenido aparecería flotando a mitad de página.

## CSS / Diseño

El tema es **claro** (light): fondo blanco, sidebar `#1a1a2e` (azul muy oscuro), tipografía
Inter (Google Fonts, pesos 400/500/600). Variables en `:root`:

- `--nav: #1a1a2e` — sidebar y botón primario
- `--green: #10b981` — barras TIH 1ª Línea (color por defecto) y botón "Importar reservas"
- `--blue: #3b82f6` — barras TIH 2ª Línea y enlaces de tabla
  (nota: si la reserva tiene portal con color, ese color **sustituye** al de TIH en la barra)
- `--red: #ef4444` — botones destructivos
- `--border: #e5e7eb` / `--border-soft: #f0f0f0` — bordes generales / celdas planning

Patrones de componentes en el CSS:
- **Botones**: `.btn-pri` (oscuro), `.btn-sec` (blanco+borde), `.btn-peligro` (rojo).
  `#btn-importar` sobreescribe `.btn-pri` con verde.
- **Botones de tabla**: `.tabla .acciones [data-editar]` (azul pastel) y `[data-borrar]`
  (rojo pastel) — diferenciados por selector de atributo, no por clase.
- **Filtro TIH pills**: `.btn-filtro-tih` con `border-radius: 999px`; activo = fondo `--nav`.
- **Planning**: filas 52px, columna izquierda 160px (`celda-apto`). `ANCHO_DIA = 28px`
  en `planning.js` debe coincidir con `.dia { width: 28px }`; `ANCHO_SEP = 32px` con
  `.col-sep-mes/.col-sep-mes-row { width: 32px }` (columnas separadoras de mes). El nº de
  días visibles se calcula según el ancho del contenedor (ResizeObserver).
- **Indicador de disponibilidad**: `.disponibilidad-ok` (verde), `.disponibilidad-error`
  (rojo), `.disponibilidad-aviso` (ámbar). Se muestra en el modal de reservas.
- **Portales (color/logo)**: la barra del planning es `display:flex` con `.barra-logo`
  (16px, `pointer-events:none` para no capturar el drag) + `.barra-texto` (ellipsis). En la
  ficha de reserva y en la tabla de reservas el portal se muestra con `.portal-val` +
  `.portal-val-logo`/`.portal-val-color` (ficha, 24/12px) o `.portal-cel-logo`/
  `.portal-cel-color` (tabla, 20/10px). Si la imagen falla (`onerror`) se oculta sin romper.
- **Estadísticas**: clases `.est-*`. Cabecera `.est-cabecera` (título 24px + selector de
  año), sub-pestañas `.est-subtabs` (reusan `.subtab`) sobre `.sub-panel`. Tarjetas de
  resumen `.est-cards`/`.est-card` (icono de color tipo dashboard). Tabla `.est-tabla` con
  `.num` (alineado dcha.), barra de % `.est-barra`/`.est-barra-fill` (ancho=%, color del
  portal), fila de totales `.est-fila-total`. Reusa `.portal-cel-logo`/`.portal-cel-color`
  para la celda de portal y `.skeleton` para la carga. Placeholder `.est-placeholder`.

## API REST

| Método | Ruta                                    | Descripción                                                      |
|--------|-----------------------------------------|------------------------------------------------------------------|
| GET    | /api/apartamentos                       | Lista; ?tih=1\|2                                                 |
| GET    | /api/apartamentos/:id                   | Ficha + propietario + historial de reservas                      |
| POST   | /api/apartamentos                       | Crear apartamento (nombre obligatorio)                           |
| PUT    | /api/apartamentos/:id                   | Editar apartamento                                               |
| DELETE | /api/apartamentos/:id                   | Borrar (sus reservas pasan a Sin asignar)                        |
| GET    | /api/propietarios                       | Lista                                                            |
| GET    | /api/propietarios/:id                   | Ficha + apartamentos asociados                                   |
| POST   | /api/propietarios                       | Crear propietario (todos los campos; nombre obligatorio)         |
| POST   | /api/propietarios/importar              | Subir Excel/CSV (campo `archivo`); upsert por email o documento  |
| PUT    | /api/propietarios/:id                   | Editar; solo actualiza los campos presentes en el body           |
| DELETE | /api/propietarios/:id                   | Borrar                                                           |
| GET    | /api/reservas                           | Para planning; ?desde=&hasta= (ISO) + ?tih=                      |
| GET    | /api/reservas/sin-asignar               | Bandeja sin asignar; ?tih=                                       |
| GET    | /api/reservas/todas                     | Todas las reservas + apartamento_nombre JOIN; orden entrada DESC  |
| GET    | /api/reservas/verificar-disponibilidad  | ?apartamento_id=&entrada=&salida=[&excluir_reserva_id=]; devuelve { disponible, conflicto } |
| GET    | /api/reservas/:id                       | Ficha + nombre del apartamento                                   |
| POST   | /api/reservas                           | Crear reserva manual; 409 si numero_reserva ya existe            |
| PUT    | /api/reservas/:id                       | Editar (solo campos presentes); todos los campos de ficha. `atendido_por` -> `req.usuario.username` si no se envía; `pendiente` = precio_total − pagado |
| PUT    | /api/reservas/:id/mover                 | Drag & drop; body: {apartamento_id}; 409 si solapa               |
| DELETE | /api/reservas/:id                       | Cancelación manual                                               |
| GET    | /api/portales                           | Portales de venta activos (orden por `orden`); `?todos=1` incluye inactivos |
| POST   | /api/portales                           | Crear portal (nombre único)                                      |
| PUT    | /api/portales/:id                       | Editar nombre/activo/orden/color (solo campos presentes)         |
| POST   | /api/portales/:id/imagen                | Subir imagen (multipart, campo `imagen`); .jpg/.jpeg/.png/.webp/.svg; devuelve { ok, imagen_url } |
| DELETE | /api/portales/:id                       | Borrar portal; 409 si alguna reserva lo usa (por nombre)         |
| POST   | /api/importar                           | Subir Excel/CSV (campo `archivo`); devuelve resumen              |
| POST   | /api/auth/login                         | **Pública**. {username,password} -> {ok,token,userId,username,nombre,rol} |
| POST   | /api/auth/logout                        | Limpia el token de la sesión (lee X-Auth-Token)                  |
| GET    | /api/usuarios                           | Lista de usuarios (sin password_hash ni token)                   |
| POST   | /api/usuarios                           | Crear usuario (nombre, username, password, rol, activo)          |
| PUT    | /api/usuarios/:id                       | Editar (password vacío = no cambia); no puedes desactivarte a ti mismo |
| DELETE | /api/usuarios/:id                       | Borrar (no puedes eliminarte a ti mismo)                         |
| GET    | /api/ajustes/razones-sociales           | Lista de razones sociales                                        |
| POST   | /api/ajustes/razones-sociales           | Crear razón social                                               |
| PUT    | /api/ajustes/razones-sociales/:id       | Editar razón social                                              |
| DELETE | /api/ajustes/razones-sociales/:id       | Borrar razón social                                              |
| GET    | /api/ajustes/actividad                  | **Solo admin**. ?usuario_id=&accion=&limit=200; orden fecha DESC |
| GET    | /api/dashboard                          | Datos del dashboard en una llamada: proximos_checkin, reservas_en_curso, proximos_checkout (máx 50 c/u, JOIN apartamento), pagos_pendientes {total,count}, reservas_entrantes {count} |
| GET    | /api/estadisticas/portales              | ?anio=AAAA (def. año actual). Ingresos agregados por portal del año (por `entrada`, excluye canceladas): `{ portales[], resumen }`. Cada portal: nombre (NULL/''→'Sin portal'), color/imagen_url (LEFT JOIN portales por nombre), total_reservas, ingresos_brutos/cobrados, pendiente_cobro, noches_totales (SUM julianday). Orden ingresos_brutos DESC |
| GET    | /api/estadisticas/apartamentos          | ?anio=AAAA[&apartamento_id=]. Sin id: ingresos por apartamento del año (JOIN apartamentos; excluye canceladas y sin asignar): `{ apartamentos[], resumen }`. Cada uno: nombre, tipo (TIH), total_reservas, ingresos_netos (SUM pagado), noches_ocupadas, porcentaje_ocupacion (noches/365·100). Orden ingresos_netos DESC. Con id: `{ apartamento }` (LEFT JOIN, devuelve aunque tenga 0 reservas) + `reservas[]` del año (numero_reserva, cliente, entrada/salida, noches, pagado, portal); 404 si no existe |
| GET    | /api/estadisticas/ocupacion             | ?anio=AAAA. Ocupación del año: `{ resumen, por_mes[12], por_tih }`. por_mes: noches_ocupadas (solape reserva↔mes vía julianday MIN/MAX), noches_disponibles (nº apartamentos·días reales del mes), porcentaje. por_tih: primera_linea/segunda_linea con total_apartamentos, media_ocupacion, noches_ocupadas. resumen: total_apartamentos, media_ocupacion_anual, mes_mas_ocupado, total_noches_ocupadas. Excluye canceladas y sin asignar; maneja bisiestos |
| GET    | /api/estadisticas/propietarios          | ?anio=AAAA. Cashflow por propietario de los contratos **precio_cerrado** activos del año (comisión y cancelados excluidos): `{ resumen, por_propietario[] }`. Cada uno: propietario_id/nombre, contratos, total_comprometido (SUM precio_total), total_pagado/total_pendiente (SUM importe de cuotas según pagado, vía subconsulta por contrato), proxima_cuota_fecha/importe (1ª cuota sin pagar con fecha ≥ hoy). Orden total_pendiente DESC. resumen: total_propietarios_con_contrato, total_comprometido, total_pagado, total_pendiente, contratos_activos |
| GET    | /api/contratos                          | ?anio=&apartamento_id=&propietario_id= (todos opcionales). Lista (`c.*` + apartamento_nombre + propietario nombre/apellidos). Orden anio DESC, nombre. **No trae recuento de cuotas** (el frontend lo obtiene de la ficha de cada uno) |
| GET    | /api/contratos/resumen-propietario      | ?propietario_id=X&anio=AAAA. Por contrato del propietario/año: apartamento, tipo, precio_total/porcentaje, total_cuotas, cuotas_pagadas, importe_pagado, importe_pendiente. **Declarar antes de /:id** |
| GET    | /api/contratos/:id                      | Ficha (`c.*` + apartamento_nombre/tih + propietario) + `cuotas[]` ordenadas por numero_cuota |
| POST   | /api/contratos                          | Crear contrato + cuotas (transacción). Valida: apartamento existe, tipo válido, inicio<fin, y en precio_cerrado suma de cuotas == precio_total (±0.01€). `created_by` = req.usuario.username |
| PUT    | /api/contratos/:id                      | Editar contrato y **reemplazar cuotas** (DELETE+INSERT en transacción), misma validación |
| DELETE | /api/contratos/:id                      | Borrar (cuotas en CASCADE); **409** si tiene alguna cuota pagada |
| PUT    | /api/contratos/:id/cuotas/:cuota_id     | Marcar/desmarcar cuota pagada; body `{ pagado, fecha_pago }` (al marcar sin fecha usa hoy; al desmarcar la limpia) |

Todas las rutas `/api/*` **salvo `/api/auth/login`** pasan por el middleware `requireAuth`
(header `X-Auth-Token`) y reciben `req.usuario = { id, nombre, username, rol }`.

**Orden de rutas en `routes/reservas.js`**: las rutas estáticas (`/sin-asignar`, `/todas`,
`/verificar-disponibilidad`) deben declararse **antes** de `/:id` para que Express no las
interprete como parámetro de ruta.

## Modelo de datos

- **propietarios**: ficha ampliada (~40 columnas) — datos personales (nombre, apellidos,
  segundo_apellido, tratamiento, idioma, fecha_alta, fecha_nacimiento, tags), contacto
  (telefono/2/3, email/2, fax), domicilio (direccion, numero, bloque_portal, planta_puerta,
  codigo_postal, pais, region, provincia, ciudad, tipo_direccion), documentación
  (tipo_documento, numero_documento, expedido_fecha, *_nacimiento, lugar_expedicion,
  tipo_identificacion) y datos contables (metodo_pago, retencion, tipo_cuenta,
  titular_cuenta, numero_cuenta, cuenta_contable, codigo_fiscal) + `id_avantio` (el "Id
  Propietario" del export de Avantio). El campo `notas` se usa como "Observaciones" en la
  UI. `dni` es legado: el documento canónico es `numero_documento` (la tabla muestra
  `numero_documento || dni`). Las columnas nuevas se añaden con ALTER TABLE en
  `db/database.js` (`migrarPropietarios`) si faltan, así que las BD antiguas se actualizan
  solas al arrancar. `routes/propietarios.js` define el array `CAMPOS` como único punto de
  verdad para construir INSERT/UPDATE.
- **apartamentos**: nombre, edificio, `tipo` ('1'|'2' = 1ª/2ª línea), capacidad, notas,
  `propietario_id` (FK nullable, ON DELETE SET NULL). Un propietario tiene N apartamentos.
- **reservas**: `numero_reserva` (TEXT UNIQUE, identificador del Excel o alta manual),
  nombre_cliente, contrato, edificio, `tih` ('1'|'2'), personas, `entrada`/`salida`
  (ISO YYYY-MM-DD), observaciones, `apartamento_id` (FK nullable; **NULL = "Sin asignar"**).
  Campos de gestión de la ficha: `tipo_reserva` (Confirmada/Pendiente/Cancelada, def.
  Confirmada), `fecha_creacion` (datetime), `portal`, `condicion_cancelacion`
  (Reembolsable/No reembolsable), `atendido_por` (username), `hora_entrada` (def. 17:00),
  `hora_salida` (def. 10:00), `checkin_estado`/`checkout_estado`
  (Pendiente/Asignado/Completado), `precio_base`, `precio_total`, `pagado`, `pendiente`
  (= precio_total − pagado, calculado en el PUT), `notas_internas`, `ocupante`. Migración en
  `db/database.js` (`migrarReservas`/`COLUMNAS_RESERVAS`).
- **portales**: catálogo de portales de venta (id, `nombre` UNIQUE, `activo`, `orden`,
  `color` def. `#3b82f6`, `imagen_url`). `color`/`imagen_url` se añaden vía `migrarPortales`
  en `db/database.js` (no están en schema.sql). Semilla por defecto en `seedPortales`
  (Booking.com, Airbnb, Apartplaya, Viajes Himalaya, Web propia, Directo, Otro). En `reservas`
  el portal se guarda por **nombre** (TEXT), no por id. Las imágenes se suben a
  `public/uploads/portales/` (nombre `portal-{id}-{timestamp}.{ext}`; al re-subir se borra la
  anterior) y se sirven como estáticos vía `express.static('public')` (sin auth, fuera de `/api`).
- **ajustes**: almacén genérico `clave` (TEXT PRIMARY KEY) / `valor` (TEXT). Disponible para
  ajustes sueltos futuros (los datos de facturación ya NO viven aquí; ver `razones_sociales`).
- **razones_sociales**: datos de facturación, una fila por razón social (cada una es una
  tarjeta en Ajustes). Columnas propias (razon_social, nombre_comercial, cif_nif, dirección,
  banco, IBAN…). `routes/ajustes.js` define `RS_CAMPOS` como punto de verdad para INSERT/UPDATE.
- **usuarios**: nombre, `username` (UNIQUE), `password_hash` (sha256 con crypto nativo, sin
  bcrypt), `rol` ('administrador'|'usuario', CHECK), `activo`, ultimo_acceso, y `token` (la
  sesión activa; se compara en `requireAuth`). **Admin por defecto** creado al arrancar si no
  hay usuarios: `admin` / `admin1234` (ver `seedAdmin` en `db/database.js`).
- **actividad_log**: auditoría — usuario_id (FK a usuarios), usuario_nombre, accion, entidad,
  entidad_id, detalle, fecha. ⚠️ Tiene FK a `usuarios` sin ON DELETE: para borrar un usuario
  con registros hay que vaciar antes sus filas del log (o el DELETE falla por FK).
- **contratos**: contrato de gestión con el propietario. `apartamento_id` (FK NOT NULL,
  **ON DELETE RESTRICT**), `propietario_id` (FK nullable, ON DELETE SET NULL), `tipo`
  ('precio_cerrado'|'comision', CHECK), `temporada_inicio`/`temporada_fin` (ISO), `anio`,
  `precio_total` (solo precio_cerrado), `porcentaje_comision` (solo comision), `aplica_iva`
  (0/1, def. 1) y `porcentaje_retencion` (0/19/24, def. 19) — **fiscalidad** del precio_cerrado:
  total = base + (IVA 21% si aplica) − (base·retención/100). `estado`
  ('activo'|'finalizado'|'cancelado', CHECK), `notas`, `created_at`, `created_by`. `aplica_iva`
  y `porcentaje_retencion` se añaden vía `migrarContratos`/`COLUMNAS_CONTRATOS` en
  `db/database.js`; el resto en `schema.sql`.
- **contrato_cuotas**: calendario de pagos de un contrato (sobre todo precio_cerrado).
  `contrato_id` (FK NOT NULL, **ON DELETE CASCADE**), `numero_cuota`, `fecha_prevista` (ISO),
  `importe`, `pagado` (0/1), `fecha_pago` (ISO), `notas`. En precio_cerrado la suma de
  importes debe cuadrar con `contratos.precio_total` (validado en POST/PUT, ±0.01€). El PUT de
  contrato **borra y reinserta** todas las cuotas.

TIH/tipo se guardan normalizados como `'1'`/`'2'` (ver `normalizaTih`); en UI se muestran
"1ª Línea"/"2ª Línea" (ver `tihTexto`). Fechas en BD siempre ISO; en UI se muestran
DD/MM/AAAA (ver `fechaES`). El campo `tipo` de `apartamentos` y el campo `tih` de
`reservas` son equivalentes (ambos '1'/'2'); `normalizaTih` acepta cualquier variante.

## Reglas de negocio (IMPORTANTES — confirmadas con el cliente)

1. **Los pisos los crea el usuario a mano** (módulo Alojamientos). El Excel NO trae columna
   que diga a qué piso va cada reserva.
2. **Autoasignación al importar (solo reservas nuevas)**: se asigna a un piso libre de la
   **misma TIH**. NO se filtra por edificio ni por capacidad (capacidad es informativa).
3. Un piso aloja **varias reservas** si las **fechas no se solapan**. Solape = intervalos
   medio abiertos `A.entrada < B.salida && B.entrada < A.salida` → el turnover (salida de
   una = entrada de la siguiente) NO solapa.
4. Si una reserva nueva no encuentra piso libre de su TIH → se inserta con
   `apartamento_id = NULL` (bandeja **"Sin asignar"**) y se reporta como **incidencia** en
   el resumen. No se pierde el dato; el usuario la coloca con drag & drop.
5. **Upsert por `numero_reserva`** (importación): si ya existe → UPDATE (conserva su
   `apartamento_id`, no reasigna). Si no existe → crea y autoasigna. **Nunca se borran
   reservas automáticamente** (cancelaciones manuales desde la ficha o pestaña Reservas).
6. **Drag & drop / mover** (`PUT /api/reservas/:id/mover`): valida solape en el piso
   destino → **409** si choca. NO restringe por TIH (permite override manual).
   `apartamento_id: null` devuelve la reserva a "Sin asignar".
7. **Alta manual** (pestaña Reservas): `numero_reserva` es único y no puede modificarse
   tras crear. El selector de apartamentos se filtra por TIH seleccionada. La validación
   de solape se hace en frontend vía `GET /verificar-disponibilidad` antes de guardar;
   el botón Guardar se deshabilita si hay conflicto.

### Columnas del archivo de importación de reservas (.xlsx/.xls/.csv)
`Reserva | Nombre Cliente | Contrato | Edificio | TIH | Per. | Entrada | Salida | Observaciones`
TIH llega como "1 Línea"/"2 Línea". Las cabeceras se normalizan (minúsculas, sin acentos
ni signos) en `importService.COLUMNAS`, así que toleran variaciones menores.

### Importación de propietarios (`services/importPropietarios.js`)
Pensado para el **export de Avantio**, cuyo XLS tiene una estructura especial: **fila 0 =
título "Lista", fila 1 = cabeceras, fila 2+ = datos**. Por eso se parsea con
`sheet_to_json(hoja, { header: 1, raw: true })` (array de arrays) y `detectarFilaCabeceras`
busca la primera fila que mapea `nombre` o ≥3 columnas conocidas (salta el título). Así
también funciona un CSV genérico con cabeceras en la fila 0. Cabeceras → campos en `MAPA`
(normalizadas sin acentos; incluye las 33 columnas de Avantio). Detalles:
- **Observaciones → `notas`** (el campo "Observaciones" de la UI vive en `notas`).
- **`Nº cuenta` e `IBAN`** mapean ambos a `numero_cuenta`; gana el primer no-nulo (Nº cuenta
  precede a IBAN), así que IBAN solo se usa si Nº cuenta viene vacío.
- Fechas (`fecha_nacimiento`, `expedido_fecha`, `fecha_alta`) se normalizan a ISO con
  `parseFecha`; columnas no reconocidas (Contrato, Intranet, BIC…) se ignoran.
- **Upsert** por email → `numero_documento` → `id_avantio`. Nunca borra. Todo en una única
  transacción better-sqlite3 (procesa ~1635 filas sin problema). Filas sin nombre se
  reportan como incidencia en `{ nuevos, actualizados, errores[] }`.

## Gotchas / decisiones técnicas

- **SheetJS y fechas de CSV**: hay que leer con `xlsx.read(buffer, { raw: true })`. Sin
  `raw:true`, SheetJS interpreta "02/06/2026" como fecha **americana MM/DD** y la corrompe.
  Con raw, las celdas llegan como texto (CSV) o serial numérico (Excel) y las normaliza
  `parseFecha`. **No volver a poner `cellDates:true`.**
- **better-sqlite3 12.x**: elegido por tener binarios precompilados para Node 24 (evita
  compilar con Visual Studio). better-sqlite es síncrono → las rutas no usan async/await
  para la BD.
- **Migraciones con `ALTER TABLE ADD COLUMN`** (helper `anadirColumnasFaltantes` en
  `db/database.js`): SQLite **no** permite un DEFAULT con expresión (p. ej.
  `(datetime('now'))`) ni `CURRENT_TIMESTAMP` al añadir columnas. Los DEFAULT **constantes**
  (`'Confirmada'`, `'17:00'`, `0`) sí valen y se aplican también a las filas existentes y a
  los INSERT futuros. Por eso `reservas.fecha_creacion` se añade **sin** default, se rellena
  con un UPDATE para las filas viejas, y el INSERT del POST de reservas lo fija explícitamente
  con `datetime('now')` (en BD nuevas el DEFAULT del `schema.sql` ya lo cubre). Si añades una
  columna "fecha de creación" a otra tabla, sigue el mismo patrón.
- **multer 2.x**: memoryStorage + `.single('archivo')` (la 1.x tenía vulnerabilidades).
- **Autenticación** (login simple para red local): el login es lo primero que se ve si no
  hay sesión válida. `POST /api/auth/login` valida usuario+contraseña (sha256) y genera
  `token = sha256(username+password+fecha)`, lo guarda en `usuarios.token` y lo devuelve. El
  frontend lo guarda en `localStorage('crm-sesion')` y lo envía en cada llamada como header
  `X-Auth-Token`. El middleware `requireAuth` (en `routes/auth.js`, montado como
  `app.use('/api', requireAuth)` **después** de `/api/auth`) valida el token y adjunta
  `req.usuario`. Un 401 en el frontend limpia la sesión y vuelve al login
  (`window.onNoAutorizado`). Una sesión por usuario (un nuevo login invalida la anterior); el
  token persiste en BD, así que sobrevive a reinicios del servidor. **No es seguridad fuerte**
  (sha256 sin salt, pensado para una LAN de confianza), pero ya NO es "sin login".
- **Auditoría**: todos los routes de creación/edición/borrado/importación/mover llaman a
  `registrarActividad(...)` tras la operación con éxito, usando `req.usuario`. Es defensivo
  (un fallo al registrar nunca rompe la operación). El log solo lo ven los administradores.
- **`API.getPortales()` cachea en memoria** (variable de módulo en `api.js`) para no repetir
  la llamada; lo comparten planning y reservas. El caché es **de sesión**: si se edita un
  portal en Ajustes (color/logo/nombre), planning y la ficha no lo reflejan hasta **recargar
  la página** (F5). Subida de imágenes de portal: campo multipart **`imagen`** (no `archivo`);
  `ajustes.js` hace el `fetch` a mano con `X-Auth-Token` porque `API.subirArchivo` usa el
  campo `archivo`.
- better-sqlite3 lanza al hacer bind de `undefined`; el frontend envía siempre todos los
  campos (string vacío). Mantener esa convención al añadir formularios.
- **⚠️ NUNCA poner la BD en OneDrive/Dropbox/sincronizadores.** El proyecto estaba en
  `OneDrive\Escritorio\CRM Mauro` y OneDrive (a) sincronizaba el `crm.db` en uso y (b)
  llegó a **restaurar una versión antigua** tras borrarla, pisando datos reales del
  usuario. Por eso se movió a `C:\CRM`. Si hay que resetear la BD, hacerlo solo en
  `C:\CRM` y con el servidor parado.
- **El WAL contiene datos no volcados.** Con journal_mode=WAL, los últimos cambios pueden
  estar solo en `crm.db-wal` (el `crm.db` principal puede verse casi vacío, ~4 KB).
  Cualquier copia/restauración debe incluir **los tres archivos juntos**: `crm.db`,
  `crm.db-wal`, `crm.db-shm`. Copiar solo `crm.db` puede perder lo más reciente.
- **`ANCHO_DIA = 28` en `planning.js`** debe coincidir con el ancho de `.dia` en el CSS
  (y `ANCHO_SEP = 32` con `.col-sep-mes`). Si se cambia uno, cambiar el otro. El planning
  muestra una **vista continua de días** desde una fecha de inicio (no un mes fijo): el nº
  de columnas se recalcula según el ancho disponible (`Math.floor((ancho-160)/28)`) al
  cargar y al redimensionar. Las barras se posicionan por offset en días desde la fecha de
  inicio (recortadas a la ventana visible), usando la tabla `xDia` que tiene en cuenta el
  ancho extra de las columnas separadoras de mes.
- **Secciones fuera de `<main>`**: cada `<section class="vista">` debe estar dentro de
  `<main>`. Si se coloca fuera, el flexbox de `main` no la gestiona y el contenido aparece
  desplazado hacia el centro-inferior de la página. **Excepciones**: el modal genérico
  (`#modal-fondo`), el panel lateral de propietarios (`#panel-fondo` + `#panel-propietario`),
  el panel lateral de la ficha de reserva (`#rsv-panel-fondo` + `#rsv-panel`, **creado por JS**
  desde `reservas.js`, no en index.html) y la pantalla de login (`#login-overlay`) van fuera
  de `<main>` a propósito — son overlays `position: fixed` y no deben entrar en el flujo flex.
  Los paneles se abren/cierran con la clase `.abierto` (transición `translateX`); overlay y
  panel comparten esa clase.

## Cómo probar la API (sin navegador)

PowerShell 5.1 **no** soporta `Invoke-RestMethod -Form` (multipart). Para subir archivos
usar `curl.exe`:
```powershell
curl.exe -s -F "archivo=@ruta\reservas.csv" http://localhost:3000/api/importar
```
El resto de endpoints con `Invoke-RestMethod` y `-Body (... | ConvertTo-Json)`.
Para ver acentos en consola: `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`.

```powershell
# Ejemplo: crear reserva manual
$body = @{ numero_reserva="TEST-001"; nombre_cliente="Test"; tih="1"; entrada="2026-08-01"; salida="2026-08-10" } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3000/api/reservas" -Method POST -Body $body -ContentType "application/json"

# Verificar disponibilidad
Invoke-RestMethod "http://localhost:3000/api/reservas/verificar-disponibilidad?apartamento_id=1&entrada=2026-08-01&salida=2026-08-10"
```

## Backups

Los datos están en `db/crm.db` (+ ficheros `-wal`/`-shm`). Todo (`crm.db*` y `backups/`)
está en `.gitignore`.

- **Hacer copia**: doble clic en `backup.bat` → crea `backups\AAAA-MM-DD_HH-MM-SS\` con
  los **tres** archivos (`crm.db`, `crm.db-wal`, `crm.db-shm`). El timestamp lo genera
  PowerShell desde el `.bat` para no depender del idioma de Windows.
- **Restaurar**: parar el servidor y copiar los tres archivos de la carpeta de backup de
  vuelta a `db\`.
- Conviene NO copiar solo `crm.db` (ver gotcha del WAL más arriba).

## Pendientes (TODO)

- **Filtro de propietario en Contratos**: el botón "Ver contratos" de Estadísticas →
  Propietarios solo **navega** a la pestaña Contratos (`activarTab('contratos')`); todavía
  **no aplica el filtro por propietario** porque `contratos.js` solo expone filtros de año y
  tipo. Pendiente (tarea aparte que tocará `contratos.js`): añadir un filtro/selector de
  propietario y un método público (p. ej. `Contratos.cargar({ propietario_id })`) y llamarlo
  desde `estadisticas.js` tras navegar. El backend ya soporta `GET /api/contratos?propietario_id=`.
