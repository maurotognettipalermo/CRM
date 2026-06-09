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
- **Sin tests, sin linter, sin paso de build.** `npm start` es el único script de `package.json`. Verificación = arrancar servidor + probar la API a mano (ver "Cómo probar la API").
- `README.md` es la guía de instalación para el usuario final (instalar Node, abrir puerto 3000 en el firewall con `New-NetFirewallRule`, acceso desde otros equipos por IP). Mantenerlo en ese tono no técnico si se actualiza.

## Arquitectura

```
server.js              Express: json + static(public) + /api/* + listen 3000.
db/database.js         better-sqlite3, WAL + foreign_keys. Ejecuta schema + limpiarDatosPrueba()
                       (borrado ÚNICO de datos de prueba, guardado con flag 'limpieza_datos_prueba_v1'
                       en ajustes) + migraciones ALTER (anadirColumnasFaltantes) +
                       migrarRelacionPropietarios() (volcó apartamentos.propietario_id a la tabla N:M
                       y eliminó la columna recreando la tabla) + migrarUsuariosRol() (recrea usuarios
                       para ampliar el CHECK de rol con 'limpieza' si aún no lo incluye) + seeds
                       (admin, portales, estados_reserva).
                       Columna estado_limpieza ('limpio'|'sucio', CHECK) se añade vía COLUMNAS_APARTAMENTOS.
scripts/crear-usuario.js  Crear/actualizar usuario admin directamente en BD (node scripts/crear-usuario.js).
db/schema.sql          Tablas: propietarios, apartamentos, apartamento_propietarios, reservas, ajustes,
                       razones_sociales, usuarios, actividad_log, portales, contratos, contrato_cuotas,
                       catalogo_gastos, apartamento_gastos, facturas, factura_lineas, factura_contador,
                       reserva_pagos, catalogo_extras, reserva_extras, temporadas, tipo_modificadores,
                       descuentos, apartamento_fotos, estados_reserva, limpieza_log,
                       limpieza_tareas, limpieza_fotos.
routes/                Un router Express por recurso:
  apartamentos · propietarios · reservas · importar · ajustes · auth · usuarios ·
  portales · dashboard · estadisticas · contratos · gastos · facturas · tarifas ·
  reserva-pagos (/api/reservas/:id/pagos) · catalogo-extras (exporta catalogo + reservaExtras) ·
  fotos (/api/apartamentos/:id/fotos, galería de fotos del apartamento) ·
  email (/api/email/enviar-fotos, envío de fotos por SMTP) ·
  limpieza (/api/limpieza, tareas de limpieza por día + reportes)
services/
  importService.js     Parseo Excel/CSV de reservas (SheetJS), upsert por nº reserva, autoasignación.
  importPropietarios.js Parseo Excel/CSV propietarios (formato Avantio), upsert por email/documento/id_avantio.
  actividadService.js  registrarActividad(...) → inserta en actividad_log (defensivo, nunca rompe la op.).
  asignacion.js        buscarPisoLibre(apartamentos, ocupaciones, tih, entrada, salida) + normalizaTih.
  dateUtils.js         parseFecha (DD/MM/AAAA, serial Excel, ISO), solapan (intervalos medio abiertos).
  emailService.js      nodemailer: getTransporter(db) + enviarEmail(db, {to,subject,html,attachments}).
                       Config SMTP en tabla ajustes (claves smtp_*); secure=true solo si puerto 465.
public/                Frontend vanilla. Sin build, servido estático.
  index.html           SPA de 11 pestañas + menú lateral plegable + modal genérico + panel lateral + toast.
  css/styles.css       Tema claro (blanco / sidebar #1a1a2e). Variables CSS en :root.
  js/api.js            API.get/post/put/del/subirArchivo (header X-Auth-Token; 401→onNoAutorizado) +
                       API.getPortales() (caché en memoria, compartida por planning/reservas) +
                       toast() + abrirModal/cerrarModal + helpers (fechaES, tihTexto).
  js/auth.js           Auth (window.Auth). Sesión en localStorage('crm-sesion'). Login/logout.
  js/app.js            Gate de login + menú lateral (navegación, plegado, logout) + init de módulos.
                       Vista por defecto: Dashboard. activarTab('estadisticas') exige rol admin.
                       Control de acceso por rol: rol 'limpieza' solo ve la pestaña Limpieza (resto
                       oculto, arranca y se queda en Limpieza); badge de rol en el sidebar
                       (Admin/Usuario/Limpieza) vía pintarBadgeRol().
  js/dashboard.js      4 tarjetas (pagos pendientes, próximos check-in, reservas en curso, check-out)
                       desde GET /api/dashboard. Skeleton, error+reintentar, paginación 5/5, auto-refresco 5 min.
  js/planning.js       Vista continua de N días (estilo Avantio) con drag&drop e import.
                       Barras coloreadas por portal (con logo) o por TIH si no hay portal.
                       Filtro por clasificación (dropdown multiselección sobre tipo_clasificacion,
                       en cliente; sin clasificar → '__sin__'). Sustituye a los botones TIH.
  js/alojamientos.js   Tabla (columnas Propietario = activos por coma + Limpieza = badge punto
                       verde/rojo clicable que alterna estado, columna inyectada por JS) + barra de
                       filtros inyectada por JS (buscador por nombre + panel "🔽 Filtros":
                       tipo/limpieza multiselección + tiene-propietario/visible-planning single;
                       contador "Mostrando X de Y") + modal alta/edición (ficha ampliada, toggles En
                       garantía / Quitar planning; SIN typeahead de propietario). Ficha en panel
                       lateral con 5 pestañas: Alojamiento (datos + indicador de limpieza clicable +
                       popover historial desde /limpieza-log + "Recaudación del año"), Propietario
                       (gestión N:M: cards de activos con badge % verde/naranja/rojo según suma=100,
                       histórico colapsable, modales Añadir/Editar %/Cerrar relación con resumen en
                       vivo), Gastos (por año, marcar cobrado/borrar + modal con typeahead), Galería
                       (grid 3 col, subida multipart con dropzone+preview+barra de progreso XHR,
                       drag&drop reordenar, lightbox con teclas, modal enviar por email — envío
                       directo vía POST /api/email/enviar-fotos con spinner), Calendario (12 meses,
                       días pintados con el color del estado de la
                       reserva, tooltip, clic→ficha de reserva, resumen % ocupación).
                       Expone abrirFicha(id).
  js/contratos.js      Contratos propietario: precio_cerrado o comision. Filtros año/tipo/propietario.
                       Tabla con badges y mini barra de cuotas. Expone filtrarPorPropietario(id, nombre).
  js/facturas.js       Facturación: tipos propietario/autofactura/gastos/huésped. Filtros año/tipo/estado.
                       Ficha en panel lateral (emisor/receptor, líneas, totales, PDF).
                       Wizard 2 pasos: tipo+razón social → datos según tipo (typeahead propietario→
                       contrato→cuotas / apartamento→gastos / reserva→huésped manual).
                       PDF: /api/facturas/:id/pdf en nueva pestaña.
  js/tarifas.js        Pestaña Tarifas (todos los roles): selector de año + botón copiar año +
                       sub-pestañas Temporadas (calendario anual de 12 franjas × grid 31 columnas,
                       días tintados con el color de su temporada, tabla CRUD, modal con preview de
                       precios por tipo) · Modificadores por tipo (tabla inline, A bloqueado, precio
                       ejemplo en vivo, solo PUTea los cambiados) · Descuentos (tabla con badges de
                       condiciones, modal con toggles min_noches/tipos/portales y preview en vivo).
  js/propietarios.js   Lista con avatar/búsqueda/orden/paginación. Ficha en panel lateral editable.
                       Modal por pestañas e importación Excel.
  js/reservas.js       Tabla + alta/edición manual + validación disponibilidad. El modal de
                       alta/edición incluye Portal y Precio con cálculo automático de tarifa
                       (/api/tarifas/calcular, debounce 500ms, desglose por noche colapsable,
                       precio editable con badge "Precio manual" si difiere; al crear añade los
                       extras obligatorios del catálogo y fija portal/precio con PUT posterior).
                       Filtros avanzados
                       (panel "🔽 Filtros" inyectado por JS: clasificación/portal/estado/condición
                       multiselección + rango de fechas; badge contador; los botones TIH y el select
                       de mes de index.html se eliminan del DOM en runtime). Estado de filtros en vars
                       de módulo (persiste al cambiar de pestaña, no localStorage).
                       Ficha en panel lateral (sub-pestañas Datos/Mensajes/Margen/Liquidación; solo Datos funcional).
                       Datos contiene secciones EXTRAS y PAGOS (ver más abajo). Panel creado por JS.
                       El select "Tipo de reserva" del modal de edición carga dinámicamente los
                       estados activos de /api/ajustes/estados-reserva. Expone abrirFicha(id).
  js/ajustes.js        Sub-pestañas: Razón Social / Usuarios / Actividad (admin) / Portales
                       (reordenar, color, logo) / Catálogo de gastos / Catálogo de extras (con
                       toggle "Extra obligatorio" + badge rojo en la tabla) / Estados de reserva
                       (color clicable, badge "Sistema" si es_sistema, sin borrar los del sistema) /
                       Correo electrónico (SMTP, solo admin: formulario + guardar + email de prueba).
                       Modal de usuario: rol Administrador/Usuario/Limpieza (este último con descripción).
                       Portales, Catálogo de gastos, Catálogo de extras, Estados de reserva y Correo
                       electrónico se inyectan por JS (Correo y Actividad ocultas para no-admin).
  js/estadisticas.js   Solo admin. Selector de año + 4 sub-pestañas con datos reales y anti-respuesta-obsoleta:
                       (1) Ingresos por portal · (2) Ingresos por apartamento (general + detalle por apto) ·
                       (3) Ocupación (barras por mes + comparativa 1ª/2ª Línea) ·
                       (4) Propietarios 💰 (cashflow precio_cerrado → link a Contratos filtrado).
                       Sub-pestaña 4 y su panel se inyectan por JS (no en index.html).
  js/limpieza.js       Módulo Limpieza (todos los roles; rol 'limpieza' solo ve esta pestaña).
                       Sub-pestaña "Tareas del día": selector de fecha + Hoy/Mañana, 4 mini-tarjetas
                       de resumen, buscador + filtro pill por estado (Todos/Pendientes/Completadas),
                       cards por tarea (borde por prioridad turnover/checkout/manual, badge estado,
                       sale/entra, asignado) con acciones Marcar limpio (modal: notas + fotos),
                       Asignar (select usuarios) y Notas. Botón "＋ Añadir pisos" (oculto para rol
                       limpieza): modal de selección múltiple (checkboxes, "seleccionar sucios/todos",
                       fecha + asignar a + notas, creación secuencial con barra de progreso).
                       Sub-pestaña "Reportes": filtro de fechas + pills (hoy/semana/mes) + buscador,
                       cards de limpiezas completadas con nota (truncada) y thumbnails, lightbox y
                       modal de detalle (con "Crear gasto" si la nota sugiere incidencia). UI mobile-first.
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
| GET | /api/apartamentos | Lista; `?todos=1` incluye `quitar_planning=1`; `?tih=` filtra. Cada apto lleva `propietarios[]` (activos) + campos planos compat del principal |
| GET/PUT/DELETE | /api/apartamentos/:id | Ficha (campos ampliados + `propietarios[]` activos+históricos + historial) / Editar (merge; ignora propietario_id) / Borrar (reservas→Sin asignar) |
| GET/POST | /api/apartamentos/:id/propietarios | Relaciones N:M. POST `{propietario_id, porcentaje, fecha_inicio, notas}`: valida existencia, sin activa duplicada (409), suma % ≤ 100 (400); suma < 100 → `{ok, aviso}` |
| PUT/DELETE | /api/apartamentos/:id/propietarios/:rel_id | Editar (porcentaje/fechas/notas/activo; valida suma ≤ 100) / Borrar (409 si el propietario tiene contratos o facturas en ese apto) |
| POST | /api/apartamentos/:id/propietarios/:rel_id/cerrar | Cierra relación: activo=0 + fecha_fin (body o hoy). 409 si ya cerrada |
| GET/POST/PUT/DELETE | /api/apartamentos/:id/fotos[/:foto_id] | Galería. POST multipart campo **`fotos`** (≤10, .jpg/.jpeg/.png/.webp) en `public/uploads/apartamentos/{id}/`. PUT: descripcion/orden |
| POST | /api/apartamentos/:id/fotos/reordenar | Body `{orden:[id1,id2,...]}` → fija el campo orden de cada foto |
| PUT | /api/apartamentos/:id/limpieza | Body `{estado_limpieza:'limpio'\|'sucio'}`. Actualiza + registra en limpieza_log con req.usuario |
| GET | /api/apartamentos/:id/limpieza-log | Historial de limpieza, fecha DESC, máx 50 |
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
| GET/POST/PUT/DELETE | /api/usuarios[/:id] | CRUD usuarios (rol administrador/usuario/limpieza; no puedes eliminarte/desactivarte a ti mismo) |
| GET | /api/limpieza/tareas | `?fecha=YYYY-MM-DD`. Genera (idempotente) tareas del día: checkout por cada salida; si hay entrada mismo día/apto → turnover prioridad 1. JOIN apto + cliente/hora checkout-checkin |
| POST | /api/limpieza/tareas | Tarea manual `{apartamento_id, fecha, notas, asignado_a?}`. Valida usuario si asignado_a → guarda asignado_nombre |
| PUT | /api/limpieza/tareas/:id | Editar estado / asignado_a (+nombre) / notas |
| POST | /api/limpieza/tareas/:id/completar | `{notas_limpieza}` → estado completada + apto `estado_limpieza='limpio'` + limpieza_log |
| POST | /api/limpieza/tareas/:id/fotos | Multipart campo **`fotos`** (≤5) → `public/uploads/limpieza/{tarea_id}/` |
| GET/DELETE | /api/limpieza/tareas/:id/detalle · /api/limpieza/tareas/:id | Detalle (tarea+fotos+reservas) / Borrar (solo `manual`+`pendiente`, else 409) |
| GET | /api/limpieza/reportes | `?desde=&hasta=&apartamento_id=`. Completadas con notas o fotos + num_fotos, orden completado_fecha DESC |
| GET | /api/limpieza/resumen | `?fecha=` → `{total, pendientes, en_proceso, completadas, turnovers}` |
| GET/POST/PUT/DELETE | /api/ajustes/razones-sociales[/:id] | CRUD razones sociales |
| POST | /api/ajustes/razones-sociales/:id/logo | Multipart campo `logo`; .jpg/.jpeg/.png/.webp/.svg |
| GET/POST/PUT/DELETE | /api/ajustes/estados-reserva[/:id] | CRUD estados de reserva (orden por `orden`). DELETE→409 si `es_sistema=1` o si alguna reserva usa ese nombre |
| GET/PUT | /api/ajustes/smtp | **Solo admin**. Config SMTP (claves smtp_* de `ajustes`). GET enmascara la contraseña; PUT con `smtp_password='••••••••'` conserva la anterior |
| POST | /api/ajustes/smtp/test | **Solo admin**. Envía email de prueba al smtp_user → `{ok}` / `{ok:false,error}` |
| POST | /api/email/enviar-fotos | `{to, subject, mensaje, apartamento_id, foto_ids[]}`. Adjunta las fotos (verifica que son del apto), HTML con logo de razón social. Errores SMTP → `{ok:false,error}` (HTTP 200) |
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
| GET/POST/PUT/DELETE | /api/tarifas/temporadas[/:id] | CRUD temporadas. `?anio=`. POST/PUT validan solape mismo año (409) |
| POST | /api/tarifas/temporadas/copiar | `{anio_origen, anio_destino}`. 409 si destino ya tiene; 29-feb→28 si destino no bisiesto |
| GET/PUT | /api/tarifas/modificadores[/:id] | Modificadores % por tipo. PUT solo porcentaje; tipo A bloqueado (400) |
| GET/POST/PUT/DELETE | /api/tarifas/descuentos[/:id] | CRUD descuentos. `?anio=`. tipos/portales JSON array o null (= todos) |
| GET | /api/tarifas/calcular | `?apartamento_id=&entrada=&salida=[&portal=]` → desglose por noche + descuentos + extras obligatorios + precio_total. 400 `{ok:false}` si falta tarifa en alguna fecha |
| GET | /api/facturas/:id/pdf | PDF pdfkit; `Content-Disposition: attachment` |
| PUT | /api/facturas/:id/anular | Marca estado='anulada' (no borra) |

Todas las rutas `/api/*` salvo `/api/auth/login` pasan por `requireAuth` (header `X-Auth-Token`) → `req.usuario = { id, nombre, username, rol }`.

**Orden en `routes/reservas.js`**: `/sin-asignar`, `/todas`, `/verificar-disponibilidad` deben declararse **antes** de `/:id`.

**Orden en `server.js`**: los sub-routers `/api/reservas/:id/pagos` y `/api/reservas/:id/extras` se montan **antes** de `/api/reservas` (igual que `/api/apartamentos/:id/gastos` y `/api/apartamentos/:id/fotos` antes de `/api/apartamentos`) para que `/:id` no capture esos prefijos.

## Modelo de datos

- **propietarios**: ~40 columnas (datos personales, contacto, domicilio, documentación, contables). `notas` = "Observaciones" en UI. `numero_documento` es el canónico (el campo `dni` es legado). `id_avantio` para upsert desde Avantio. `routes/propietarios.js` define `CAMPOS` como único punto de verdad para INSERT/UPDATE. Columnas nuevas: ALTER TABLE via `migrarPropietarios`.
- **apartamentos**: nombre, edificio, `tipo` ('1'|'2'), capacidad, notas. **Ya NO tiene `propietario_id`** (migrado a `apartamento_propietarios`). Ficha ampliada via `COLUMNAS_APARTAMENTOS`: clasificación (`tipo_clasificacion`: A/A+/A++/B/B+/C), orientación, situación, parking, wifi, `en_garantia`, `quitar_planning`, licencia_turistica, NRA, ref_catastral, escalera/piso/puerta, `estado_limpieza` ('limpio'|'sucio', CHECK, def. 'limpio'). Edificio/TIH/bloque ocultos en UI pero conservados en BD.
- **apartamento_propietarios**: relación N:M apartamento ↔ propietarios con histórico. apartamento_id/propietario_id (FK, ON DELETE CASCADE), porcentaje (REAL, los activos deben sumar 100), fecha_inicio (NOT NULL), fecha_fin (null = actual), activo (1=actual, 0=histórico), notas, UNIQUE(apartamento_id, propietario_id, fecha_inicio). El "principal" para compat/facturas = mayor porcentaje (empate → fecha_inicio más antigua). Contratos: con 1 propietario activo se autorrellena `propietario_id`; con varios el POST/PUT exige especificarlo.
- **reservas**: `numero_reserva` (TEXT UNIQUE), nombre_cliente, contrato, edificio, `tih` ('1'|'2'), personas, `entrada`/`salida` (ISO), observaciones, `apartamento_id` (NULL = "Sin asignar"). Campos de gestión: tipo_reserva, fecha_creacion, portal (TEXT por nombre), condicion_cancelacion, atendido_por, hora_entrada/salida, checkin/checkout_estado, precio_base/total/pagado/pendiente (pendiente = total−pagado, calculado en PUT), notas_internas, ocupante.
- **portales**: nombre (UNIQUE), activo, orden, color (def. `#3b82f6`), imagen_url. Portal se guarda en reservas por **nombre**, no por id. Semilla: Booking.com, Airbnb, Apartplaya, Viajes Himalaya, Web propia, Directo, Otro. Imágenes en `public/uploads/portales/`; al re-subir se borra la anterior.
- **ajustes**: almacén genérico clave/valor. En uso: flag `limpieza_datos_prueba_v1` (marca la limpieza única de datos de prueba ya ejecutada — no borrar, o re-borraría facturas/contratos/pagos reales en el siguiente arranque) + claves `smtp_*` (host/port/user/password/from_name/from_email) de la config de correo saliente, gestionadas en Ajustes → Correo electrónico (defaults en `emailService.SMTP_DEFAULTS`).
- **razones_sociales**: datos de facturación (razon_social, CIF, dirección, IBAN, logo_url). `RS_CAMPOS` en `routes/ajustes.js` como punto de verdad.
- **usuarios**: nombre, username (UNIQUE), password_hash (sha256 sin bcrypt), rol ('administrador'|'usuario'|'limpieza'), activo, ultimo_acceso, token (sesión activa). Admin por defecto: `admin` / `admin1234`. El rol 'limpieza' se añadió ampliando el CHECK vía `migrarUsuariosRol()` (rebuild). `routes/usuarios.js` valida contra `ROLES_VALIDOS`.
- **actividad_log**: usuario_id (FK sin ON DELETE — borrar usuario con registros requiere vaciar el log primero), usuario_nombre, accion, entidad, entidad_id, detalle, fecha.
- **contratos**: apartamento_id (FK NOT NULL, ON DELETE RESTRICT), propietario_id (FK nullable), tipo ('precio_cerrado'|'comision'), temporada_inicio/fin, anio, precio_total, porcentaje_comision, aplica_iva, porcentaje_retencion (0/19/24, def. 19), estado ('activo'|'finalizado'|'cancelado'), created_by. Fiscalidad precio_cerrado: total = base + IVA 21% − retención.
- **contrato_cuotas**: contrato_id (FK, ON DELETE CASCADE), numero_cuota, fecha_prevista, importe, pagado, fecha_pago. Suma de importes debe cuadrar con precio_total (±0.01€). PUT de contrato borra y reinserta todas las cuotas.
- **catalogo_gastos**: nombre (UNIQUE), precio, descripcion, activo, incluye_iva (informativo; precio lleva IVA 21%).
- **apartamento_gastos**: apartamento_id (FK, ON DELETE CASCADE), catalogo_gasto_id (FK nullable, ON DELETE SET NULL), nombre/precio (**snapshot** al insertar), fecha, notas, cobrado_propietario, created_by. Cambios en catálogo no afectan gastos ya registrados.
- **facturas**: tipo CHECK (huésped/propietario/autofactura/gastos), estado CHECK (borrador/emitida/pagada/anulada), numero UNIQUE (F-{anio}-NNN). Snapshot de emisor y receptor. IVA por tipo: propietario/autofactura→del contrato; gastos→21% si algún gasto lleva IVA; huésped→10%.
- **factura_lineas**: factura_id (FK, ON DELETE CASCADE), descripcion, cantidad, precio_unitario, importe, orden.
- **factura_contador**: anio PK / ultimo_numero. Numeración correlativa sin huecos dentro de la transacción del INSERT de factura.
- **reserva_pagos**: reserva_id (FK, ON DELETE CASCADE), concepto, importe, metodo_pago (CHECK caja/tpv/transferencia, nullable), pagado (0/1), fecha_pago (ISO, null hasta pagar), notas, orden, created_at. Plan de pagos del huésped. Sin migración en database.js (la tabla la crea schema.sql).
- **catalogo_extras**: nombre (UNIQUE), precio, tipo_precio (CHECK unidad/noche/persona, def. 'unidad'), descripcion, activo, `obligatorio` (0/1, via migrarCatalogoExtras — el frontend lo añade automáticamente a las reservas nuevas; /api/tarifas/calcular lo suma al total). Catálogo reutilizable gestionado en Ajustes.
- **reserva_extras**: reserva_id (FK, ON DELETE CASCADE), catalogo_extra_id (FK nullable, ON DELETE SET NULL), nombre/precio_unitario/tipo_precio (**snapshot**), cantidad, importe (calculado: precio×cant ×noches si tipo='noche'), noches (snapshot de noches de la reserva al añadir).
- **temporadas**: nombre, anio, fecha_inicio/fin (ISO, UNIQUE anio+fechas, sin solapes dentro del año), `precio_base_noche` (precio del Tipo A, el que manda), color, orden. Módulo Tarifas.
- **tipo_modificadores**: tipo (UNIQUE: A++/A+/A/B+/B/C), porcentaje (+/− sobre el precio base; A siempre 0, bloqueado en la API), orden. Seed en database.js si la tabla está vacía (A++ +20 … C −30).
- **descuentos**: nombre, porcentaje, fecha_inicio/fin, anio, min_noches (0 = sin mínimo), `tipos`/`portales` (JSON array TEXT, null = aplica a todos), activo, notas. En /calcular solo aplican los que cubren TODAS las noches de la estancia y cumplen condiciones; cada % se aplica sobre el subtotal (no compuestos).
- **apartamento_fotos**: apartamento_id (FK, ON DELETE CASCADE), url, nombre_archivo, descripcion, orden, created_at. Galería del apartamento. Archivos en `public/uploads/apartamentos/{id}/`; el DELETE de foto borra BD + disco (borrar el apartamento cascadea la BD pero deja archivos huérfanos en disco).
- **estados_reserva**: nombre (UNIQUE), color (def. `#3b82f6`), orden, activo, `es_sistema` (0/1). Catálogo configurable en Ajustes. Seed en database.js si está vacía: Confirmada/Pendiente/Cancelada (es_sistema=1, no borrables) + Pagada/De propietario/Bloqueado. El select "Tipo de reserva" y el calendario del apartamento leen de aquí.
- **limpieza_log**: apartamento_id (FK, ON DELETE CASCADE), estado_anterior, estado_nuevo, usuario_id (FK), usuario_nombre, fecha. Histórico de cambios de `apartamentos.estado_limpieza`.
- **limpieza_tareas**: apartamento_id (FK CASCADE), fecha (ISO), tipo (checkout/manual/turnover), prioridad (0/1, 1=turnover urgente), estado (pendiente/en_proceso/completada), reserva_checkout_id/reserva_checkin_id (FK SET NULL), asignado_a/asignado_nombre, completado_por/completado_nombre/completado_fecha, notas_limpieza, created_by. Las de checkout/turnover se autogeneran (idempotente) en `GET /api/limpieza/tareas`; las manuales se crean a mano. Solo las `manual`+`pendiente` se pueden borrar.
- **limpieza_fotos**: tarea_id (FK CASCADE), url, nombre_archivo, descripcion. Fotos de reporte en `public/uploads/limpieza/{tarea_id}/`.

**Tablas nuevas sin migración**: `reserva_pagos`, `catalogo_extras`, `reserva_extras`, `temporadas`, `tipo_modificadores`, `descuentos`, `apartamento_fotos`, `estados_reserva`, `limpieza_log`, `limpieza_tareas`, `limpieza_fotos` se crean solo vía `CREATE TABLE IF NOT EXISTS` en schema.sql (re-ejecutado cada arranque). No hay entradas en `database.js` porque no existen BD antiguas que migrar con ALTER (salvo la columna `estado_limpieza`, que sí va por ALTER en `COLUMNAS_APARTAMENTOS`, y el CHECK de `usuarios.rol` que se amplía recreando la tabla en `migrarUsuariosRol()`). `apartamento_propietarios` también la crea schema.sql, pero su migración de datos (volcado desde la antigua columna + DROP de `propietario_id` recreando apartamentos) vive en `migrarRelacionPropietarios()` y es idempotente (no-op si la columna ya no existe).

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
