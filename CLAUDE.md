# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Idioma

**Responder SIEMPRE en español** desde el primer mensaje. CRM de **alquiler vacacional** en red local sin internet. Stack: Node.js + Express + SQLite + HTML/CSS/JS vanilla.

## Arranque

```powershell
$env:Path = "C:\Program Files\nodejs;" + $env:Path
npm start   # node server.js — puerto 3000, escucha 0.0.0.0
```

- Sin hot-reload: `Get-Process node | Stop-Process -Force` para reiniciar.
- BD en `db/crm.db` (se crea sola, modo WAL). **Sin tests, sin linter, sin build.**
- `README.md` = guía de instalación para usuario final (tono no técnico; mantenerlo así si se actualiza).

## Dependencias

| Paquete | Rol |
|---------|-----|
| `better-sqlite3 ^12` | BD síncrona — **requiere Node ≥20** (binarios precompilados para Node 24, evita compilar con Visual Studio) |
| `xlsx ^0.18` | Parseo Excel/CSV — siempre `{ raw: true }` |
| `pdfkit ^0.18` | PDF server-side (sin Chromium) |
| `docx ^9` | Word `.docx` (contratos) |
| `multer ^2` | Subida de archivos (memoryStorage) |
| `nodemailer ^8` | Email SMTP |
| `flatpickr ^4` | Date picker — **copiado a `public/lib/`** (sin CDN, LAN sin internet) |

## Arquitectura

```
server.js         Express: monta /api/* + static(public) + listen 3000
db/
  database.js     WAL + foreign_keys. Schema + migraciones ALTER + seeds
  schema.sql      Todas las tablas (CREATE TABLE IF NOT EXISTS)
routes/           Un router Express por recurso
services/
  importService.js          Excel/CSV reservas, upsert por nº reserva, autoasignación
  importReservasAvantio.js  XLS Avantio 69 cols; UPDATE no pisa apartamento_id/notas_internas/observaciones
  importPropietarios.js     Excel Avantio; upsert email→documento→id_avantio; nunca borra
  importAlojamientos.js     HTML-as-XLS Avantio; upsert id_avantio; UPDATE solo rellena vacíos
  importClientes.js         HTML-as-XLS Avantio; upsert id_avantio; UPDATE no pisa observaciones
  importPropiedades.js      Excel Idealista; upsert referencia; UPDATE no pisa estado/notas/descripcion
  actividadService.js       registrarActividad() — defensivo, nunca rompe la op. principal
  asignacion.js             buscarPisoLibre() + normalizaTih()
  dateUtils.js              parseFecha (DD/MM/AAAA / serial Excel / ISO), solapan()
  emailService.js           nodemailer; config SMTP en tabla ajustes (smtp_*); secure=true solo si puerto 465
public/
  index.html      SPA, sidebar colapsable, modal genérico
  css/styles.css  Tema claro
  js/             Módulos frontend (ver tabla abajo)
  lib/            flatpickr local
  uploads/        apartamentos/{id}/ · limpieza/{tarea_id}/ · mantenimiento/{tarea_id}/ · portales/
scripts/
  crear-usuario.js  node scripts/crear-usuario.js — crea/actualiza admin en BD
```

**Montaje en server.js**: sub-routers `/:id/pagos`, `/:id/extras`, `/:id/gastos`, `/:id/fotos` deben montarse **antes** de su recurso padre para que `/:id` no capture esos prefijos.

## Módulos frontend

Orden de carga: `api.js` → `auth.js` → módulos → `app.js` (último). Los módulos se referencian entre sí solo en runtime.

| Archivo | IIFE | Expone / notas clave |
|---------|------|----------------------|
| `api.js` | `API` | `.get/post/put/del/subirArchivo`, `toast()`, `abrirModal/cerrarModal`, `initDatePickers()` (flatpickr + MutationObserver auto-init), `getPortales()` (caché memoria), helpers `fechaES/tihTexto` |
| `auth.js` | `Auth` | sesión localStorage, login/logout |
| `app.js` | — | gate login, `activarTab()`, sidebar colapsable (grupos Alquiler/Administración/Equipo), control de acceso por rol, `ROL_RESTRINGIDO` para limpieza/mantenimiento |
| `planning.js` | — | vista N días, drag&drop; calculadora de precios replica el cálculo de tarifas en cliente (NO llama a `/api/tarifas/calcular`). Rango fijo opcional (`fecha-fin` + ✕): con rango activo, nº de columnas lo manda la longitud del rango (no el ancho de pantalla) — scroll horizontal, resize no recalcula, ◀/▶/Hoy desplazan el rango completo |
| `alojamientos.js` | — | `abrirFicha(id)` |
| `reservas.js` | — | `abrirFicha(id)`; ficha incluye EXTRAS y PAGOS |
| `contratos.js` | — | `filtrarPorPropietario(id, nombre)`. Buscador libre (texto) por alojamiento+propietario inyectado en init; contador "X contratos / X de Y" junto al buscador |
| `mantenimiento.js` | — | `abrirDetalle(id)`, `nuevaTareaPara(aptoId)` |
| `dashboard.js` | `Dashboard` | Pantalla de inicio: 4 tarjetas (pagos pendientes, próximos check-in, reservas en curso, próximos check-out). Refresco automático cada 5 min |
| `facturas.js` | `Facturas` | Lista con filtros (+ buscador libre por apartamento/propietario/receptor/emisor, filtro en cliente sobre `todas`) + ficha en panel lateral + wizard de 2 pasos para emitir (propietario/autofactura/gastos/huésped/mayorista/proforma). Autofactura tiene 2 modos (📑 contrato / ✏️ libre, `wiz.modoAutofactura`); modo contrato admite buscar por propietario o por apartamento (`wireAptoAutofactura`, sincroniza ambos campos) |
| `limpieza.js` | `Limpieza` | Tareas del día (cards, mobile-first) + sub-pestaña Reportes |
| `propietarios.js` | `Propietarios` | Lista + ficha en panel lateral con edición inline + modal alta/edición por pestañas + importación Excel |
| `tarifas.js` | `Tarifas` | Sub-pestañas: temporadas (calendario anual), modificadores por `tipo_clasificacion`, descuentos |
| `ventas.js` | `Ventas` | `init/cargar/abrirFicha`; sub-pestañas 2-5 inyectadas en runtime |
| `personal.js` | `Personal` | `init/cargar`; sub-pestañas inyectadas en runtime |
| `leads.js` | `Leads` | `init/cargar/abrirFicha` |
| `clientes-alquiler.js` | `ClientesAlquiler` | `init/cargar/abrirFicha` (IIFE distinto de clientes de Ventas) |
| `extras-inventario.js` | `ExtrasInventario` | `init/cargar` |
| `estadisticas.js` | — | solo admin; sub-pestañas 4-6 inyectadas en runtime |
| `ajustes.js` | — | Correo/Actividad/Restricciones ocultos para no-admin |

**Layout**: `<body>` flex-row. Secciones `<section id="vista-{nombre}" class="vista">` dentro de `<main>`. Overlays (`#modal-fondo`, paneles laterales, `#login-overlay`) fuera de `<main>` (`position: fixed`).

## CSS / Diseño

Variables: `--nav:#1a1a2e` · `--green:#10b981` · `--blue:#3b82f6` · `--red:#ef4444` · `--border:#e5e7eb` · `--border-soft:#f0f0f0`

- Botones: `.btn-pri` / `.btn-sec` / `.btn-peligro`; en tabla: `[data-editar]` (azul pastel) / `[data-borrar]` (rojo pastel)
- **`ANCHO_DIA = 28`** en `planning.js` ↔ `.dia { width: 28px }` CSS; `ANCHO_SEP = 32` ↔ `.col-sep-mes { width: 32px }`. Cambiar siempre los dos.
- Portales en planning: `.barra-logo` (16px) + `.barra-texto`; en tabla/ficha: `.portal-cel-*` / `.portal-val-*`. `onerror` oculta imagen sin romper.

## Modelo de datos — lo no obvio

- **apartamentos**: ya NO tiene `propietario_id` (migrado a N:M). `tipo_clasificacion` A/A+/A++/B/B+/C. `portal_id` FK portales. `estado_limpieza` CHECK 'limpio'|'sucio'.
- **apartamento_propietarios**: N:M con histórico. "Principal" = mayor porcentaje (empate → fecha_inicio más antigua). Activos deben sumar 100%.
- **portales**: `mayorista_id INTEGER REFERENCES mayoristas(id) ON DELETE SET NULL` — vinculación explícita (no por nombre). `comision_porcentaje REAL DEFAULT 0` — % que se descuenta del bruto en estadísticas. GET incluye `mayorista_nombre` (LEFT JOIN). POST/PUT aceptan ambos campos.
- **reservas**: `portal` es TEXT (nombre, NO FK a portales). `cliente_id` FK nullable. `contrato_origen_id` marca reservas auto de contratos. `apartamento_id` NULL = Sin asignar.
- **ajustes**: clave/valor. Flag `limpieza_datos_prueba_v1` — **NO borrar** (volvería a borrar datos reales si reaparece). Claves `smtp_*` de correo.
- **Patrón snapshot**: `apartamento_gastos`, `reserva_extras`, `factura_lineas`, `mantenimiento_tareas.cliente_*` copian nombre/precio al insertar. El catálogo puede cambiar sin afectar registros previos.
- **facturas**: numeración correlativa `{serie}-{anio}-NNN` vía `factura_contador` (PK compuesta `anio+serie`, en transacción). `serie` sale de `razones_sociales.serie` (propia por razón social, fallback `'F'` si no tiene asignada); proformas siempre `PRO`. IVA: propietario/autofactura→del contrato; gastos→21% si incluye IVA; huésped/mayorista→10%. Tipo `abono` (nota de crédito): `factura_abonada_id` apunta a la factura que rectifica, líneas en negativo, numeración con sufijo `{serie}-A` (contador propio, independiente del normal); `POST /:id/abono` no admite abonar proforma/abono/anulada/borrador. `numero` editable por PUT (solo admin) validando único.
  - **Autofactura**: el emisor legal es el propietario, no la razón social receptora → serie propia `AF-{CIF emisor}` (función `serieAutofactura`, en vez de `serieParaRazonSocial`), independiente por propietario y del resto de facturas de esa razón social. `AF-SINCIF` es colchón compartido solo para autofacturas legadas por contrato de propietarios sin CIF en su ficha. Dos modos al crear (`construirPropietario(body, true)` vs `construirAutofacturaLibre(body)`, elegidos por `body.modo === 'libre'`): **por contrato** (`contrato_id`+`cuota_ids`, como siempre) o **Libre** (emisor/líneas/IVA/retención manuales, sin contrato — `emisor_cif` obligatorio porque de él depende la numeración; receptor siempre la razón social).
  - **Borrado**: `DELETE /:id` permite borrador (cualquiera, sin cambios) o **anulada + administrador** (borrado definitivo, deja hueco a propósito en la numeración correlativa); cualquier otro estado exige anular primero. Registra actividad antes de borrar.
  - **Pagos parciales** (`factura_pagos`, `routes/factura-pagos.js`, montado en `/api/facturas/:id/pagos` **antes** de `/api/facturas`): CRUD independiente de las líneas. El `estado` de la factura (`emitida`/`parcialmente_pagada`/`pagada`) se recalcula siempre en `recalcularEstadoFactura()` a partir de `SUM(importe)` vs `facturas.total` — nunca se fija a mano; no toca facturas `anulada`/`borrador`.
- **razones_sociales**: `serie` (TEXT, nullable) — prefijo de numeración de facturas propio; único case-insensitive/trim, validado en POST/PUT (409 si choca).
- **pagos_propietario**: CRUD en `routes/apartamentos.js`. El endpoint `generar-factura` llama `crearAutofacturaPago` exportado por `routes/facturas.js` (dependencia cruzada entre routers).
- **contrato_fechas_propietario**: `generarBloqueosContrato()` en `routes/contratos.js` — idempotente, regenera en el planning reservas "Bloqueado"/"De propietario" al POST/PUT contrato o POST/DELETE fechas-propietario.
- **visitas_venta**: campo `propiedad_id` directo es legado (compat = 1ª propiedad). Propiedades reales en N:M `visitas_propiedades`.
- **propiedades_venta**: `numero_puerta` (TEXT) independiente de `numero` (nº de calle) — usar `numero_puerta` para autorrellenar "puerta" en Arras/Autorización, `numero` sigue siendo el de la calle. `fecha_escritura`: editable/borrable (PUT con `null`) solo admin desde la ficha de Vendidos.
- **usuarios**: password_hash = sha256 (sin bcrypt). Roles: administrador/usuario/limpieza/mantenimiento. Admin por defecto: `admin` / `admin1234`.
- **fichajes**: estado del día derivado de la secuencia de eventos (sin tabla de estado separada).
- **extras_items**: `stock_total NULL = ilimitado`. `disponible` = stock − Σpréstamos + Σdevoluciones, calculado en API.
- **Tablas sin migración ALTER**: las que no existían en versiones anteriores se crean solo por `schema.sql`. Las migraciones ALTER en `database.js` solo afectan columnas añadidas a tablas ya existentes (apartamentos, reservas, portales, horas_extra, propiedades_venta, usuarios, facturas).
- TIH: `'1'`/`'2'` en BD → "1ª Línea"/"2ª Línea". Fechas: ISO en BD, DD/MM/AAAA en UI.

## Reglas de negocio

1. Pisos se crean manualmente; el Excel no indica a qué piso va cada reserva.
2. **Autoasignación al importar** (solo nuevas): piso libre de la misma TIH. Sin filtro de edificio ni capacidad.
3. **Solape**: `A.entrada < B.salida && B.entrada < A.salida` (medio abierto). Turnover (salida = entrada siguiente) NO solapa.
4. Sin piso libre → `apartamento_id = NULL` (bandeja "Sin asignar"). Usuario coloca con drag & drop.
5. Upsert por `numero_reserva`: UPDATE conserva `apartamento_id`. Nunca se borran reservas automáticamente.
6. Drag & drop: valida solape (409 si choca). `apartamento_id: null` → Sin asignar.
7. Nº reserva auto: `{PREFIJO}-NNNN` (prefijo del portal) o `R-{timestamp}`. Nunca se pide al usuario.
8. **Plan de pagos 20%/80% automático** al crear reserva con `precio_total > 0` — en la misma transacción del INSERT.
9. **Total a cobrar = `precio_total` + `total_extras`**. `precio_base` es legado, no se edita desde UI.
10. Extras obligatorios del catálogo se añaden automáticamente al crear reservas nuevas.
11. Roles `limpieza`/`mantenimiento`: solo ven su módulo + Personal (fichar).
12. `limpieza_tareas` checkout/turnover: autogeneradas (idempotente) en GET. Solo `manual`+`pendiente` borrables.

## Orden de rutas (evita que `/:id` capture rutas específicas)

```
reservas.js      /sin-asignar /todas /verificar-disponibilidad /entradas-pdf /importar-avantio
ventas.js        /visitas/hoy /resumen /propiedades/importar /propietarios-venta/importar-alquiler
personal.js      /fichajes/exportar /fichajes/estado /fichajes/resumen /ausencias/calendario /ausencias/saldo /horas-extra/resumen
leads.js         /plantillas /resumen
apartamentos.js  /pagos-propietario/resumen
contratos.js     /resumen-propietario /:id/pdf /:id/docx
```
Todas las rutas anteriores deben declararse **antes** de `/:id` en su archivo.

## Gotchas

- **⚠️ BD NUNCA en OneDrive/Dropbox**: OneDrive restauró una versión antigua pisando datos reales. BD en `C:\CRM`.
- **WAL**: copiar siempre los 3 archivos juntos: `crm.db`, `crm.db-wal`, `crm.db-shm`. Solo `crm.db` puede estar ~4 KB (datos no volcados en WAL).
- **SheetJS**: siempre `xlsx.read(buffer, { raw: true })`. Sin `raw:true`, "02/06/2026" se lee como MM/DD americano.
- **better-sqlite3 síncrono**: no `async/await` para BD. Lanza al hacer bind de `undefined` → el frontend siempre envía todos los campos (string vacío, nunca undefined).
- **pdfkit logos**: `fs.readFileSync` solo funciona con PNG/JPG. SVG/WEBP no funcionan.
- **multer campos**: `archivo` para importaciones/fotos-galería-apto, **`imagen`** para logos de portal, **`fotos`** para limpieza/mantenimiento/galería.
- **Migraciones ALTER**: SQLite no permite `DEFAULT datetime('now')`. Para columnas fecha: añadir sin DEFAULT + UPDATE filas viejas + fijar en cada INSERT.
- **Imagen de portal**: `ajustes.js` hace fetch manual con campo `imagen` (no usa `API.subirArchivo` que usa campo `archivo`).
- **`API.getPortales()`**: caché en memoria de sesión. Cambios en portales no se reflejan hasta F5.

## API REST

Todas las rutas `/api/*` salvo `/api/auth/login` requieren header `X-Auth-Token` → `req.usuario = { id, nombre, username, rol }`.

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | /api/apartamentos | Lista; `?todos=1` incluye `quitar_planning=1`; `?tih=`; `?portal_id=`. Lleva `propietarios[]` (activos) + `portal_id/portal_nombre` |
| GET/PUT/DELETE | /api/apartamentos/:id | Ficha / Editar (merge; acepta `portal_id` null=desasignar) / Borrar (reservas→Sin asignar) |
| GET/POST | /api/apartamentos/:id/propietarios | N:M. POST `{propietario_id, porcentaje, fecha_inicio, notas}`: sin activa duplicada (409), suma ≤ 100 (400); suma < 100 → `{ok, aviso}` |
| PUT/DELETE | /api/apartamentos/:id/propietarios/:rel_id | Editar (valida suma ≤ 100) / Borrar (409 si tiene contratos o facturas) |
| POST | /api/apartamentos/:id/propietarios/:rel_id/cerrar | activo=0 + fecha_fin. 409 si ya cerrada |
| GET/POST/PUT/DELETE | /api/apartamentos/:id/fotos[/:foto_id] | Galería. POST multipart campo **`fotos`** (≤10, jpg/png/webp). PUT: descripcion/orden |
| POST | /api/apartamentos/:id/fotos/reordenar | `{orden:[id1,id2,...]}` |
| PUT | /api/apartamentos/:id/limpieza | `{estado_limpieza:'limpio'\|'sucio'}` + registra limpieza_log |
| GET | /api/apartamentos/:id/limpieza-log | Historial, fecha DESC, máx 50 |
| GET | /api/apartamentos/pagos-propietario/resumen | `?anio=`. Total pagado/pendiente por apto. **Antes de /:id** |
| GET/POST/PUT/DELETE | /api/apartamentos/:id/pagos-propietario[/:pago_id] | `?anio=`. PUT acepta `pagado/fecha_pago`. DELETE→409 si tiene factura |
| POST | /api/apartamentos/:id/pagos-propietario/:pago_id/generar-factura | Autofactura (IVA 0%, ret 19%, emisor=propietario). 409 si ya tiene |
| GET/POST/PUT/DELETE | /api/apartamentos/:id/gastos[/:gasto_id] | Por año. POST: snapshot nombre+precio del catálogo |
| GET/POST/PUT/DELETE | /api/catalogo-gastos[/:id] | DELETE→409 si tiene gastos asociados |
| GET/POST/PUT/DELETE | /api/propietarios[/:id] | CRUD |
| POST | /api/propietarios/importar | `archivo`; upsert por email o documento |
| POST | /api/apartamentos/importar | Export Avantio (`archivo`, antes de /:id); upsert id_avantio. No pisa notas/config en UPDATE |
| GET | /api/reservas | `?desde=&hasta=` (ISO) + `?tih=` — para planning |
| GET | /api/reservas/sin-asignar | Bandeja; `?tih=` |
| GET | /api/reservas/todas | Todas + apartamento_nombre; orden entrada DESC |
| GET | /api/reservas/verificar-disponibilidad | `?apartamento_id=&entrada=&salida=[&excluir_reserva_id=]` → `{disponible, conflicto}` |
| GET | /api/reservas/entradas-pdf | `?desde=&hasta=`. PDF A4 horizontal check-ins del rango. `Content-Disposition: attachment` |
| POST | /api/reservas/importar-avantio | Multipart `archivo`; upsert por numero_reserva sin pisar apartamento_id/notas/observaciones |
| GET/POST/PUT/DELETE | /api/reservas[/:id] | CRUD. POST: autogenera nº si vacío; crea plan 20/80 si precio>0; devuelve `{id, numero_reserva}`. GET/:id: incluye cliente_* |
| PUT | /api/reservas/:id/mover | `{apartamento_id}`. 409 si solapa. `null` → Sin asignar |
| GET/POST/PUT/DELETE | /api/reservas/:id/pagos[/:pago_id] | GET→`{pagos, total_pagado, total_pendiente, precio_total_reserva}` |
| POST | /api/reservas/:id/pagos/generar-plan | Plan 20/80: borra no pagados + crea 2 cuotas. 409 si precio=0 |
| GET/POST/PUT/DELETE | /api/reservas/:id/extras[/:extra_id] | POST `{catalogo_extra_id, cantidad}`: snapshot; importe×noches si tipo='noche'. GET→`{extras, total_extras}` |
| GET/POST/PUT/DELETE | /api/catalogo-extras[/:id] | DELETE→409 si usado en reservas |
| GET/POST/PUT/DELETE | /api/portales[/:id] | `prefijo` (uppercase, vacío→null) para auto-numerar reservas. GET incluye `mayorista_id`+`mayorista_nombre`. POST/PUT aceptan `mayorista_id` y `comision_porcentaje` |
| POST | /api/portales/:id/imagen | Multipart campo **`imagen`**; jpg/png/webp/svg |
| POST | /api/importar | Excel/CSV `archivo`; devuelve resumen |
| POST | /api/auth/login | **Pública**. `{username,password}` → `{ok,token,userId,username,nombre,rol}` |
| POST | /api/auth/logout | Limpia token |
| GET/POST/PUT/DELETE | /api/usuarios[/:id] | CRUD. No puedes eliminarte/desactivarte a ti mismo |
| GET | /api/limpieza/tareas | `?fecha=YYYY-MM-DD`. Genera idempotente tareas del día (checkout + turnover si hay entrada mismo día) |
| POST | /api/limpieza/tareas | Tarea manual `{apartamento_id, fecha, notas, asignado_a?}` |
| PUT | /api/limpieza/tareas/:id | Editar estado / asignado_a / notas |
| POST | /api/limpieza/tareas/:id/completar | `{notas_limpieza}` → completada + apto 'limpio' + limpieza_log |
| POST | /api/limpieza/tareas/:id/fotos | Multipart **`fotos`** (≤5) → `uploads/limpieza/{tarea_id}/` |
| GET/DELETE | /api/limpieza/tareas/:id/detalle · /:id | Detalle / Borrar (solo manual+pendiente, else 409) |
| GET | /api/limpieza/reportes | `?desde=&hasta=&apartamento_id=`. Completadas con notas/fotos |
| GET | /api/limpieza/resumen | `?fecha=` → `{total, pendientes, en_proceso, completadas, turnovers}` |
| GET | /api/mantenimiento/tareas | `?estado=&apartamento_id=&anio=`. Orden estado+posicion ASC |
| GET | /api/mantenimiento/tareas/:id | Ficha + apto + notas + fotos + reserva vinculada |
| POST | /api/mantenimiento/tareas | Vincula reserva activa hoy si no se indica; copia cliente_nombre+teléfono; posicion=MAX+1 |
| PUT | /api/mantenimiento/tareas/:id | Cambio de estado → al final de la nueva columna |
| POST | /api/mantenimiento/tareas/:id/completar | estado='completada' + completado_por/nombre/fecha |
| POST | /api/mantenimiento/tareas/:id/reordenar | `{posicion, estado}`. Incrementa los ≥ nueva posición |
| DELETE | /api/mantenimiento/tareas/:id | **403 para rol mantenimiento** |
| POST/DELETE | /api/mantenimiento/tareas/:id/notas[/:nota_id] | Borrar: solo autor o admin (403) |
| POST/DELETE | /api/mantenimiento/tareas/:id/fotos[/:foto_id] | Multipart **`fotos`** (≤5) / borrar BD+disco |
| GET | /api/mantenimiento/historial | `?apartamento_id=&anio=`. Con `resumen{total,completadas,...}` |
| GET | /api/mantenimiento/resumen | `{total_abiertas, urgentes, en_proceso, completadas_este_mes}` |
| GET | /api/ventas/resumen | Contadores dashboard (propiedades por estado, clientes, visitas) |
| GET | /api/ventas/propiedades | `?estado=&tipo=&zona=&precio_min=&precio_max=&dormitorios=` |
| GET/POST/PUT/DELETE | /api/ventas/propiedades[/:id] | CRUD. POST/PUT validan `referencia` única (409). DELETE→409 si tiene visitas |
| POST | /api/ventas/propiedades/importar | Excel Idealista (`archivo`); upsert referencia, no pisa estado/notas/descripcion |
| POST | /api/ventas/propiedades/:id/vender | `{fecha_venta, fecha_escritura, precio_venta_final, comprador_*}`. estado='Vendida' |
| GET/POST/PUT/DELETE | /api/ventas/clientes[/:id] | Clientes compradores. DELETE→409 si tiene visitas |
| GET | /api/ventas/visitas | `?fecha=&estado=&cliente_id=&propiedad_id=`. Cada visita lleva `propiedades[]` |
| GET | /api/ventas/visitas/hoy | Programadas hoy, con `propiedades[]`. **Antes de /:id** |
| GET/POST/PUT/DELETE | /api/ventas/visitas[/:id] | N:M con `visitas_propiedades`. Body `propiedad_ids[]`. PUT reemplaza (DELETE+INSERT). 409 si cliente+propiedad+fecha duplicada |
| POST | /api/ventas/visitas/:id/realizar | `{valoracion, notas}` → Realizada; cliente Contactado→Visitado |
| POST | /api/ventas/visitas/:id/convertir-venta | `{propiedad_id, precio_venta_final, comprador_*, fecha_venta, fecha_escritura}`. Valida propiedad de la visita (400) y no vendida (409) |
| POST/DELETE | /api/ventas/visitas/:id/notas[/:nota_id] | Hilo de notas |
| GET | /api/ventas/propietarios-venta?buscar= | Cartera + `num_propiedades` |
| GET/POST/PUT/DELETE | /api/ventas/propietarios-venta[/:id] | DELETE→409 si tiene propiedades |
| POST | /api/ventas/propietarios-venta/importar-alquiler | `{propietario_id}`. 409 si ya importado. **Antes de /:id** |
| GET | /api/mayoristas/resumen | `?anio=`. **Antes de /:id** |
| GET/POST/PUT/DELETE | /api/mayoristas[/:id] | DELETE→409 si tiene contratos |
| GET | /api/mayoristas/contratos | `?anio=`. **Antes de /:id** |
| GET/PUT/DELETE | /api/mayoristas/contratos/:id | PUT reemplaza plan de pagos (transacción, valida suma==total). DELETE→409 si pagos cobrados |
| GET/POST | /api/mayoristas/:id/contratos | `?anio=` / crear `{anio, importe_total, pagos:[...]}`. 409 si año duplicado |
| PUT | /api/mayoristas/pagos/:pago_id | `{pagado, fecha_pago, metodo_pago, numero_factura}`. Marcar sin fecha→hoy |
| GET/POST/PUT/DELETE | /api/personal/empleados[/:id] | GET solo activos; `?todos=1`. DELETE→409 si tiene fichajes/ausencias |
| GET | /api/personal/fichajes/estado | Estado actual + resumen del día del empleado logueado. **Antes de /:id** |
| GET | /api/personal/fichajes/resumen | `?empleado_id=&mes=&anio=`. **Antes de /:id** |
| GET | /api/personal/fichajes | `?empleado_id=&fecha=`. Admin sin empleado_id→todos |
| POST | /api/personal/fichajes | `{tipo}` entrada/pausa/reanudacion/salida. Valida secuencia (409). Devuelve `{ok, fichaje, estado, resumen_dia}` |
| GET | /api/personal/ausencias/calendario | `?anio=&mes=`. No rechazadas. **Antes de /:id** |
| GET | /api/personal/ausencias/saldo | `?empleado_id=&anio=`. Solo aprobadas. **Antes de /:id** |
| GET/POST | /api/personal/ausencias | Lista / crear. Empleado solo para sí; `dias`=laborables auto |
| PUT/DELETE | /api/personal/ausencias/:id | **Solo admin** |
| GET | /api/personal/horas-extra/resumen | `?empleado_id=&anio=`. **Antes de /:id** |
| GET/POST | /api/personal/horas-extra | POST acepta `hora_inicio/hora_fin` (calcula horas), `precio_hora` (→importe), `importe` directo; `horas=0` exige `importe>0` |
| PUT/DELETE | /api/personal/horas-extra/:id | Admin: pago + horario. Empleado: solo fecha/horas/descripción si no pagada |
| GET | /api/personal/resumen-dia | `?fecha=`. **Solo admin** |
| GET | /api/personal/fichajes/exportar | `?empleado_ids=&meses=&anio=`. CSV (`;`, BOM UTF-8). **Solo admin. Antes de /fichajes** |
| GET/POST/PUT/DELETE | /api/ajustes/razones-sociales[/:id] | CRUD |
| POST | /api/ajustes/razones-sociales/:id/logo | Multipart campo `logo` |
| GET/POST/PUT/DELETE | /api/ajustes/estados-reserva[/:id] | DELETE→409 si `es_sistema=1` o en uso |
| GET/PUT | /api/ajustes/smtp | **Solo admin**. PUT con `smtp_password='••••••••'` conserva la anterior |
| POST | /api/ajustes/smtp/test | **Solo admin**. → `{ok}` / `{ok:false,error}` |
| POST | /api/email/enviar-fotos | `{to, subject, mensaje, apartamento_id, foto_ids[]}`. Errores SMTP → `{ok:false,error}` (HTTP 200) |
| GET | /api/ajustes/actividad | **Solo admin**. `?usuario_id=&accion=&limit=200` |
| GET | /api/clientes | `?buscar=&limit=50&offset=`. Cada fila lleva `num_reservas` |
| GET/POST/PUT/DELETE | /api/clientes[/:id] | GET/:id incluye `reservas[]`. DELETE→409 si tiene reservas |
| POST | /api/clientes/importar | Avantio HTML-as-XLS → upsert id_avantio |
| GET/POST/PUT/DELETE | /api/restricciones[/:id] | GET todos los roles. POST/PUT/DELETE **solo admin**. No impiden reservas (solo visual) |
| GET/POST/PUT/DELETE | /api/extras/categorias[/:id] | DELETE→409 si tiene items |
| GET | /api/extras/resumen | `{total_items, prestados_ahora, categorias_con_items}` |
| GET | /api/extras/items[/:id] | `?categoria_id=`. Lista con `disponible` + `ubicaciones[]`. GET/:id incluye `movimientos[]` |
| POST/PUT/DELETE | /api/extras/items[/:id] | `stock_total` vacío/null = ilimitado. DELETE→409 si préstamo neto>0 |
| GET/POST | /api/extras/movimientos | POST `{item_id, tipo:prestamo\|devolucion, apartamento_id, cantidad, fecha, notas}`. 409 si supera disponible |
| DELETE | /api/extras/movimientos/:id | **Solo admin** |
| GET/POST/PUT/:id/DELETE/:id | /api/leads/plantillas | DELETE→409 si tiene propuestas. **Antes de /:id** |
| GET | /api/leads/resumen | `conversion_rate` incluido. **Antes de /:id** |
| GET/POST/PUT/DELETE | /api/leads[/:id] | GET/:id → `{...lead, propuestas, notas_chat}`. DELETE→409 si reservado |
| POST | /api/leads/:id/convertir | Crea reserva (`LEAD-{id}-{ts}`) + plan 20/80; lead→'reservado'. Devuelve `{ok, reserva_id, numero_reserva}` |
| POST/DELETE | /api/leads/:id/notas[/:nota_id] | Hilo de notas |
| GET/POST | /api/leads/:id/propuestas | POST `{plantilla_id, apartamento_id, precio_propuesto, foto_ids[], email_destino, asunto, mensaje}` |
| POST | /api/leads/:id/propuestas/:prop_id/enviar | Envía email; enviada=1 + lead→'propuesta_enviada' |
| GET | /api/dashboard | `proximos_checkin, reservas_en_curso, proximos_checkout` (máx 50 c/u) + `pagos_pendientes` |
| GET | /api/estadisticas/portales | `?anio=`. Ingresos por portal (excluye canceladas). Si portal tiene `mayorista_id`: usa `importe_total` del contrato anual como ingreso (sin comisión). Si no: `ingresos_netos = ingresos_brutos × (1 − comision_porcentaje/100)`. Resumen usa `ingresos_netos` |
| GET | /api/estadisticas/apartamentos | `?anio=[&apartamento_id=]`. Sin id: resumen. Con id: detalle + reservas |
| GET | /api/estadisticas/ocupacion | `?anio=`. `por_mes[12]` + `por_tih` + resumen |
| GET | /api/estadisticas/propietarios | `?anio=`. Cashflow precio_cerrado por propietario |
| GET/POST/PUT/DELETE | /api/contratos[/:id] | POST/PUT llaman `generarBloqueosContrato`. DELETE→409 si cuotas pagadas |
| GET | /api/contratos/resumen-propietario | `?propietario_id=&anio=`. **Antes de /:id** |
| GET | /api/contratos/:id/pdf | PDF pdfkit. **Antes de /:id** |
| GET | /api/contratos/:id/docx | Word via `docx` lib. **Antes de /:id** |
| GET/POST | /api/contratos/:id/fechas-propietario | POST `{fecha_inicio, fecha_fin, motivo}` → regenera bloqueos |
| DELETE | /api/contratos/:id/fechas-propietario/:fp_id | Elimina + regenera bloqueos |
| PUT | /api/contratos/:id/cuotas/:cuota_id | Marcar/desmarcar pago; sin fecha→hoy |
| GET/POST/DELETE | /api/facturas[/:id] | GET admite `?anio=&tipo=&estado=&propietario_id=&reserva_id=`, incluye `apartamento_nombre`/`propietario_nombre`/`apellidos` (búsqueda en frontend). POST numera `{serie}-{anio}-NNN` (serie de la razón social, o `AF-{CIF}` si `autofactura`) en transacción; autofactura admite `modo:'libre'`. Tipo `mayorista`: fija numero_factura en los pagos. GET/:id incluye `abona_a`/`abonos[]`. DELETE: borrador (cualquiera) o anulada (solo admin, definitivo); si no, 409 |
| GET/POST/PUT/DELETE | /api/facturas/:id/pagos[/:pago_id] | Pagos parciales. **Montado antes de /api/facturas**. POST/PUT/DELETE recalculan `facturas.estado` (emitida/parcialmente_pagada/pagada) a partir de la suma pagada |
| PUT | /api/facturas/:id | Admin: todos los campos (incl. `numero`, validado único) + `lineas` reemplaza. No-admin: solo `estado/fecha_vencimiento/notas` (403 si más) |
| POST | /api/facturas/:id/abono | Genera abono (líneas en negativo, o `lineas` propias del body). 400/409 si origen es proforma/abono/anulada/borrador |
| GET/POST/PUT/DELETE | /api/tarifas/temporadas[/:id] | `?anio=`. POST/PUT validan solape (409) |
| POST | /api/tarifas/temporadas/copiar | `{anio_origen, anio_destino}`. 409 si destino ya tiene; 29-feb→28 si no bisiesto |
| GET/PUT | /api/tarifas/modificadores[/:id] | PUT solo porcentaje; tipo A bloqueado (400) |
| GET/POST/PUT/DELETE | /api/tarifas/descuentos[/:id] | `tipos/portales` JSON array o null (= todos) |
| GET | /api/tarifas/calcular | `?apartamento_id=&entrada=&salida=[&portal=]` → desglose + descuentos + extras obligatorios. 400 si falta tarifa |
| GET | /api/facturas/:id/pdf | `Content-Disposition: attachment` |
| PUT | /api/facturas/:id/anular | estado='anulada' (no borra) |

## Cómo probar la API

PowerShell 5.1 no soporta `Invoke-RestMethod -Form`. Para archivos usar `curl.exe`:
```powershell
curl.exe -s -F "archivo=@ruta\archivo.xlsx" -H "X-Auth-Token: TOKEN" http://localhost:3000/api/importar
```

```powershell
$h = @{ "X-Auth-Token" = "TOKEN" }
Invoke-RestMethod "http://localhost:3000/api/reservas" -Headers $h

$body = @{ entrada="2026-08-01"; salida="2026-08-10"; apartamento_id=1 } | ConvertTo-Json
Invoke-RestMethod -Uri http://localhost:3000/api/reservas -Method POST -Body $body -ContentType "application/json" -Headers $h

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8  # para acentos
```

## Backups

`backup.bat` → `backups\AAAA-MM-DD_HH-MM-SS\` con los **3 archivos** (`crm.db`, `crm.db-wal`, `crm.db-shm`).
Restaurar: parar servidor → copiar los 3 archivos a `db\`.

## Deploy remoto (`deploy/`)

Scripts para desplegar en servidor remoto (Hetzner) vía Caddy (reverse proxy/TLS) + PM2 (proceso Node): `Caddyfile`, `deploy.sh`, `ecosystem.config.js`, `setup-servidor.sh`, `backup-remoto.sh`. Uso principal sigue siendo LAN local sin internet; esto es un modo de despliegue alternativo.
