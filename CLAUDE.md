# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Idioma

**Responder SIEMPRE en español**, desde el primer mensaje de cada sesión (no solo tras corrección). El usuario es hispanohablante.

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
                       para ampliar el CHECK de rol con 'limpieza' y 'mantenimiento'; el guard mira si
                       el CHECK ya incluye 'mantenimiento') + migrarFacturasTipo() (recrea facturas para
                       ampliar el CHECK de tipo con 'mayorista', reescribiendo su SQL por regex) +
                       migrarPropiedadesVenta() (ALTER de los campos de venta cerrada + propietario_venta_id) +
                       migrarHorasExtra() (ALTER hora_inicio/hora_fin en horas_extra) + seeds (admin,
                       portales, estados_reserva, mayoristas: Apartplaya/Viajes Himalaya,
                       extras_categorias: 6 por defecto vía seedExtrasCategorias()).
                       Columna estado_limpieza ('limpio'|'sucio', CHECK) se añade vía COLUMNAS_APARTAMENTOS.
scripts/crear-usuario.js  Crear/actualizar usuario admin directamente en BD (node scripts/crear-usuario.js).
db/schema.sql          Tablas: propietarios, apartamentos, apartamento_propietarios, reservas, ajustes,
                       razones_sociales, usuarios, actividad_log, portales, contratos, contrato_cuotas,
                       contrato_fechas_propietario,
                       catalogo_gastos, apartamento_gastos, facturas, factura_lineas, factura_contador,
                       reserva_pagos, catalogo_extras, reserva_extras, temporadas, tipo_modificadores,
                       descuentos, apartamento_fotos, estados_reserva, limpieza_log,
                       limpieza_tareas, limpieza_fotos, mantenimiento_tareas,
                       mantenimiento_notas, mantenimiento_fotos, propiedades_venta,
                       clientes_compradores, visitas_venta, visitas_propiedades, visitas_notas, propietarios_venta, mayoristas,
                       mayorista_contratos, mayorista_pagos, empleados, fichajes, ausencias, horas_extra,
                       leads, lead_propuestas, lead_plantillas, lead_notas, clientes, pagos_propietario,
                       restricciones, extras_categorias, extras_items, extras_movimientos.
routes/                Un router Express por recurso:
  apartamentos · propietarios · reservas · importar · ajustes · auth · usuarios ·
  portales · dashboard · estadisticas · contratos · gastos · facturas · tarifas ·
  reserva-pagos (/api/reservas/:id/pagos) · catalogo-extras (exporta catalogo + reservaExtras) ·
  fotos (/api/apartamentos/:id/fotos, galería de fotos del apartamento) ·
  apartamentos también: pagos a propietario (/api/apartamentos/:id/pagos-propietario, CRUD +
    generar-factura —autofactura del pago, requiere `crearAutofacturaPago` exportado por
    routes/facturas.js— + /pagos-propietario/resumen?anio para Estadísticas) ·
  email (/api/email/enviar-fotos, envío de fotos por SMTP) ·
  limpieza (/api/limpieza, tareas de limpieza por día + reportes) ·
  mantenimiento (/api/mantenimiento, tareas kanban + notas + fotos + historial por apto) ·
  ventas (/api/ventas, módulo inmobiliaria: propiedades en venta + clientes compradores +
    propietarios de venta + visitas + notas de visita + resumen; importación de Idealista;
    venta de propiedad; convertir-venta: cierra la venta de una propiedad desde una visita
    Realizada vía marcarVendida() + cliente→'Compró') ·
  mayoristas (/api/mayoristas, Pagos de Mayoristas: mayoristas + contratos anuales +
    plan de pagos + resumen) ·
  personal (/api/personal, módulo RRHH: empleados + fichajes/control horario +
    ausencias + horas extra + resumen-dia para el dashboard) ·
  leads (/api/leads, módulo Comercial: captación de leads de alquiler + propuestas por email
    con fotos + notas/chat + plantillas de email + resumen/tasa conversión + convertir lead a reserva) ·
  clientes (/api/clientes, módulo Clientes: huéspedes/inquilinos — CRUD + búsqueda paginada +
    importación del export de Avantio; vinculados a reservas vía reservas.cliente_id) ·
  restricciones (/api/restricciones, periodos de fechas restringidas: CRUD —GET para todos,
    POST/PUT/DELETE solo admin—; bloqueo visual en planning + aviso al crear reservas, no impiden) ·
  extras-inventario (/api/extras, módulo Extras: inventario de objetos prestables —categorías +
    items con stock/disponible/ubicaciones + movimientos préstamo/devolución por apartamento + resumen)
services/
  importService.js     Parseo Excel/CSV de reservas (SheetJS), upsert por nº reserva, autoasignación.
  importReservasAvantio.js Parseo del "Listado de reservas" de Avantio (XLS real Composite Document;
                       SheetJS raw, detecta fila de cabeceras, mapea 69 cols por nombre normalizado).
                       Upsert por numero_reserva ("Localizador"); en UPDATE NO pisa apartamento_id ya
                       asignado, notas_internas, ni observaciones (hace append de fragmentos nuevos).
                       Nunca borra. Distinto del importador simplificado de importService.js.
  importPropietarios.js Parseo Excel/CSV propietarios (formato Avantio), upsert por email/documento/id_avantio.
  importAlojamientos.js Parseo del export de Avantio de alojamientos (HTML disfrazado de XLS; SheetJS raw,
                       detecta fila de cabeceras). Upsert por id_avantio: en UPDATE solo rellena campos
                       vacíos + los de dirección, sin pisar notas/estado_limpieza/tipo_clasificacion.
                       "Tarifa" Tipo X→tipo_clasificacion; "Estado" Desactivado→quitar_planning=1; vincula
                       propietario por coincidencia de nombre (relación N:M 100% si no hay activa). Nunca borra.
  importClientes.js    Parseo del export de Avantio de clientes (HTML disfrazado de XLS; SheetJS raw,
                       detecta fila de cabeceras, mapeo flexible de 27 columnas), upsert por id_avantio
                       (UPDATE sin pisar observaciones). Nunca borra.
  importPropiedades.js Parseo Excel de Idealista (cabeceras en fila 0, header:1, mapeo flexible
                       sin acentos), upsert por `referencia`; solo procesa filas de Venta; en UPDATE
                       NO pisa estado/notas/descripcion (campos del CRM). aNumero admite formato europeo.
  actividadService.js  registrarActividad(...) → inserta en actividad_log (defensivo, nunca rompe la op.).
  asignacion.js        buscarPisoLibre(apartamentos, ocupaciones, tih, entrada, salida) + normalizaTih.
  dateUtils.js         parseFecha (DD/MM/AAAA, serial Excel, ISO), solapan (intervalos medio abiertos).
  emailService.js      nodemailer: getTransporter(db) + enviarEmail(db, {to,subject,html,attachments}).
                       Config SMTP en tabla ajustes (claves smtp_*); secure=true solo si puerto 465.
public/                Frontend vanilla. Sin build, servido estático.
  index.html           SPA + sidebar con grupos colapsables + modal genérico + panel lateral + toast.
  css/styles.css       Tema claro (blanco / sidebar #1a1a2e). Variables CSS en :root.
  js/api.js            API.get/post/put/del/subirArchivo (header X-Auth-Token; 401→onNoAutorizado) +
                       API.getPortales() (caché en memoria, compartida por planning/reservas) +
                       toast() + abrirModal/cerrarModal + helpers (fechaES, tihTexto) +
                       API.initDatePickers() (flatpickr): sustituye TODOS los input[type=date]
                       por un calendario propio (locale es, muestra DD/MM/YYYY vía altInput pero
                       conserva YYYY-MM-DD en el input real → resto del CRM sigue leyendo/enviando
                       ISO sin cambios). Un MutationObserver con debounce auto-inicializa los date
                       inputs nuevos (modales, paneles, contenido renderizado) sin tocar cada módulo.
                       Lib local en public/lib/flatpickr.* (sin CDN, red local).
  js/auth.js           Auth (window.Auth). Sesión en localStorage('crm-sesion'). Login/logout.
  js/app.js            Gate de login + menú lateral (navegación, plegado, logout) + init de módulos.
                       Vista por defecto: Dashboard. activarTab('estadisticas') exige rol admin.
                       Control de acceso por rol: ROL_RESTRINGIDO = {limpieza, mantenimiento} con
                       {principal, permitidas[]} → esos roles solo ven su módulo + Personal (para
                       fichar); arrancan en su `principal`. badge de rol vía pintarBadgeRol().
                       Sidebar agrupado: `.nav-group[data-group]` colapsables (Alquiler/Administración/
                       Equipo) + ítems sueltos (Dashboard/Ventas/Estadísticas/Ajustes). El grupo Alquiler
                       incluye Extras (data-tab="extras", tras Comercial). Ventas es ítem
                       suelto (data-tab="ventas", NO grupo); orden del sidebar: …Administración, Equipo,
                       Ventas, Estadísticas, Ajustes. Estado abierto/
                       cerrado en localStorage('sidebar-grupos'); activarTab expande el grupo del ítem
                       activo; ocultarGruposVacios() esconde grupos sin ítems visibles (roles restringidos).
  js/dashboard.js      4 tarjetas (pagos pendientes, próximos check-in, reservas en curso, check-out)
                       desde GET /api/dashboard. Skeleton, error+reintentar, paginación 5/5, auto-refresco 5 min.
  js/planning.js       Vista continua de N días (estilo Avantio) con drag&drop e import.
                       Barras coloreadas por portal (con logo) o por TIH si no hay portal.
                       Select de portal (filtra filas en cliente por apartamentos.portal_id,
                       combinable con el filtro de clasificación).
                       Filtro por clasificación (dropdown multiselección sobre tipo_clasificacion,
                       en cliente; sin clasificar → '__sin__'). Sustituye a los botones TIH.
                       Calculadora de precios (panel lateral izquierdo): multiselección de tipos
                       (A++…C, color = badge de las fichas) + fechas → calcula el total POR TIPO en
                       el frontend (por cada noche busca la temporada que la cubre y aplica
                       base × (1 + modificador%/100); separador de miles, precio en negro). Cachea
                       modificadores (1 vez) y temporadas por año. Botón limpiar (reset a solo tipo A,
                       sin fechas). No llama a /api/tarifas/calcular (replica el cálculo en cliente).
                       Restricciones (GET /api/restricciones): fondo rojo suave en cada celda de día
                       restringido (clase `.planning-celda-restringida`, solo background —no toca el
                       box-model—) + banner amarillo arriba con las del rango visible, actualizado al
                       navegar. El nombre del mes (`.mes-label`) flota encima de la cabecera (top negativo).
  js/alojamientos.js   Tabla (col. Propietario = activos por coma; Limpieza = badge clicable que
                       alterna estado) + filtros inyectados por JS (buscador + panel "🔽 Filtros":
                       tipo/limpieza/tiene-propietario/visible-planning) + "📥 Importar desde Avantio"
                       (modal dropzone → POST /api/apartamentos/importar) + modal alta/edición (sin
                       typeahead de propietario). Ficha en panel con 6 pestañas: Alojamiento (datos +
                       limpieza clicable + popover /limpieza-log + recaudación), Propietario (gestión
                       N:M: cards % verde/naranja/rojo según suma=100, histórico, modales Añadir/Editar/
                       Cerrar), Gastos (por año, modal con typeahead), Pagos propietario (por año,
                       mini-tarjetas pagado/pendiente/total, tabla con badge Pagado/Pendiente, columna
                       Factura clicable→Facturación o "Generar autofactura", modales añadir/editar/marcar
                       pagado; /api/apartamentos/:id/pagos-propietario), Galería (grid, subida XHR con
                       progreso, drag&drop reordenar, lightbox, enviar por email vía /api/email/enviar-
                       fotos), Calendario (12 meses tintados por estado de reserva, clic→ficha) y
                       Mantenimiento (resumen + cards desde /mantenimiento/historial; "＋ Nueva tarea"
                       vía Mantenimiento.nuevaTareaPara). Expone abrirFicha(id).
  js/contratos.js      Contratos propietario: precio_cerrado o comision. Filtros año/tipo/propietario.
                       Tabla con badges y mini barra de cuotas. Dropdown "Descargar contrato" (PDF o
                       Word, fetch con token, patrón de facturas/entradas). Ficha gestiona fechas de uso
                       del propietario (contrato_fechas_propietario → reservas auto en el planning).
                       Datos del contrato: fila IBAN del propietario (numero_cuenta, pedido a
                       /api/propietarios/:id; "Sin cuenta bancaria registrada" en gris si falta). El plan
                       de pagos lleva columna "Transferencia" = importe×(1+IVA)−importe×retención (azul).
                       Expone filtrarPorPropietario(id, nombre).
  js/facturas.js       Facturación: tipos propietario/autofactura/gastos/huésped/mayorista. Filtros año/tipo/estado.
                       Ficha en panel lateral (emisor/receptor, líneas, totales, PDF).
                       Wizard 2 pasos: tipo+razón social → datos según tipo (typeahead propietario→
                       contrato→cuotas / apartamento→gastos / reserva→huésped manual).
                       Botón "✏️ Editar" (solo admin, oculto vía Auth.sesion().rol): modal de edición
                       completa (generales/emisor/receptor/líneas editables/totales recalculados en vivo)
                       → PUT /api/facturas/:id. PDF: /api/facturas/:id/pdf en nueva pestaña.
  js/tarifas.js        Pestaña Tarifas (todos los roles): selector de año + botón copiar año +
                       sub-pestañas Temporadas (calendario anual de 12 franjas × grid 31 columnas,
                       días tintados con el color de su temporada, tabla CRUD, modal con preview de
                       precios por tipo) · Modificadores por tipo (tabla inline, A bloqueado, precio
                       ejemplo en vivo, solo PUTea los cambiados) · Descuentos (tabla con badges de
                       condiciones, modal con toggles min_noches/tipos/portales y preview en vivo).
  js/propietarios.js   Lista con avatar/búsqueda/orden/paginación. Ficha en panel lateral editable.
                       Modal por pestañas e importación Excel.
  js/reservas.js       Tabla + alta/edición manual + validación disponibilidad. **Nueva reserva** =
                       formulario único (formularioNuevo): Portal+apto (portal obligatorio, apto
                       typeahead) · Cliente (pills Buscar/Nuevo: typeahead /api/clientes o alta inline
                       → POST /api/clientes antes) · Fechas · Precio · Observaciones. NO pide nº/TIH/
                       personas (TIH del apto o '1'; nº lo genera el backend). Editar = formularioEditar.
                       Ids compartidos (f-apartamento-id/f-entrada/f-salida/f-portal/f-precio/f-tarifa)
                       para el cálculo de tarifa (/api/tarifas/calcular, debounce 500ms); el desglose
                       #f-tarifa autorrellena el precio pero queda OCULTO (.rsv-trf-oculta). Al crear
                       añade extras obligatorios, fija portal/cliente_id con PUT y abre la ficha. La
                       ficha (Datos) enlaza al cliente vinculado (→ ClientesAlquiler.abrirFicha).
                       Botón "🖨️ Entradas del día" (modal Hoy/Mañana/Rango → PDF /api/reservas/
                       entradas-pdf vía fetch con token). Filtros avanzados (panel "🔽 Filtros":
                       clasificación/portal/estado/condición + rango fechas; estado en vars de módulo,
                       no localStorage; los botones TIH y el select de mes se eliminan del DOM). Ficha
                       en panel (sub-pestañas Datos/Mensajes/Margen/Liquidación; solo Datos funcional;
                       contiene EXTRAS y PAGOS, ver abajo). El select "Tipo de reserva" del modal de
                       edición carga de /api/ajustes/estados-reserva. Expone abrirFicha(id).
                       Restricciones: carga /api/restricciones; al elegir fechas en Nueva reserva muestra
                       card roja 🚨 (no bloqueante) si solapan un periodo restringido.
  js/ajustes.js        Sub-pestañas: Razón Social / Usuarios / Actividad (admin) / Portales
                       (reordenar, color, prefijo —para auto-numerar reservas—, logo) / Planning
                       (asignar/desasignar apartamentos por portal: secciones por portal + "Sin portal",
                       modal de selección múltiple; PUT apartamentos.portal_id) /
                       Catálogo de gastos / Catálogo de extras (con
                       toggle "Extra obligatorio" + badge rojo en la tabla) / Estados de reserva
                       (color clicable, badge "Sistema" si es_sistema, sin borrar los del sistema) /
                       Correo electrónico (SMTP, solo admin: formulario + guardar + email de prueba) /
                       Restricciones (solo admin: tabla con días auto = fin−inicio+1 + modal nueva/editar;
                       /api/restricciones).
                       Modal de usuario: rol Administrador/Usuario/Limpieza/Mantenimiento (Limpieza y
                       Mantenimiento con descripción dinámica vía ROL_DESC).
                       Portales, Catálogo de gastos, Catálogo de extras, Estados de reserva, Correo
                       electrónico y Restricciones se inyectan por JS (Correo, Actividad y Restricciones
                       ocultas para no-admin).
  js/estadisticas.js   Solo admin. Selector de año + 6 sub-pestañas con datos reales y anti-respuesta-obsoleta:
                       (1) Ingresos por portal · (2) Ingresos por apartamento (general + detalle por apto) ·
                       (3) Ocupación (barras por mes + comparativa 1ª/2ª Línea) ·
                       (4) Propietarios 💰 (cashflow precio_cerrado → link a Contratos filtrado) ·
                       (5) Pagos propietario (mini-tarjetas pagado/pendiente/nº pagos + tabla por apto
                       ordenada por total; cruza en cliente /apartamentos/pagos-propietario/resumen +
                       /apartamentos —propietario— + listas por apto —nº pagos—) ·
                       (6) Mayoristas (4 cards + cashflow + card por mayorista + panel lateral con plan
                       de pagos: marcar/desmarcar cobro, generar factura tipo 'mayorista' —el nº enlaza a
                       Facturación—, gestionar mayoristas y nuevo contrato; desde /api/mayoristas).
                       Sub-pestañas 4, 5 y 6 y sus paneles se inyectan por JS (no en index.html).
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
  js/mantenimiento.js  Módulo Mantenimiento (todos los roles; rol 'mantenimiento' solo ve esta pestaña).
                       Tablero kanban de 4 columnas (urgente/pendiente/en_proceso/completada) con
                       drag&drop nativo HTML5 (intra-columna reordena; entre columnas cambia estado;
                       soltar en "Hecho" llama /completar). 4 mini-tarjetas de resumen. Columna "Hecho"
                       solo muestra completadas de los últimos 30 días. Cards con handle ≡, botón ✓
                       rápido, cliente con tel: clicable, contadores notas/fotos (enriquecidos con el
                       detalle por tarea, el listado no los trae). Modal "＋ Nueva tarea" con typeahead
                       de apto + preview de huésped activo hoy (reservas ?desde=hoy&hasta=hoy). Panel
                       lateral de detalle (datos, cliente —sin nº reserva para rol mantenimiento—,
                       descripción, notas tipo chat con Enter-envía, fotos grid+lightbox+dropzone,
                       modal editar). Columnas colapsables en móvil (clase mant-col-colapsada + CSS).
                       Expone abrirDetalle(id) y nuevaTareaPara(aptoId). UI mobile-first.
  js/ventas.js         Módulo Ventas (inmobiliaria). IIFE `Ventas`, 5 sub-pestañas (#vta-subtabs):
                       Propiedades · Clientes · Visitas · Calendario · Vendidos. Solo Propiedades
                       está en index.html; las otras 4 (incluidos sus paneles) las inyecta ventas.js
                       en runtime, una vez (construirClientes/Visitas/Calendario/Vendidos). 4 mini-tarjetas
                       de resumen (disponibles/clientes activos/visitas hoy/ventas) desde /ventas/resumen.
                       **Propiedades**: tabla (buscador + panel "🔽 Filtros": estado/tipo multiselección
                       —Vendida excluida, va en Vendidos— + rango precio + dormitorios), ficha en panel
                       lateral propio (#vta-panel, editable: descripción/notas; sección verde "Datos de
                       venta" arriba si la propiedad está Vendida), modal alta/edición, modal importar
                       Idealista (dropzone, fetch directo authHeaders() campo `archivo`), botón "🏷️
                       Vendido" por fila → modal venta (precio prerrellenado; comprador por radio
                       "cliente existente" con typeahead que autorellena+lectura / "manual"; al guardar
                       con cliente existente lo marca estado='Compró') → POST /ventas/propiedades/:id/vender.
                       **Clientes**: tabla + filtros, ficha lateral (#vcl-panel) con dropdown cambiar
                       estado, "Qué busca" (chips), "Propiedades sugeridas" (match → Programar visita),
                       historial de visitas, notas. **Visitas** (una visita = N propiedades, N:M): filtro
                       día/semana/mes + estado + buscador, sección "Visitas de hoy", tabla (columna
                       Propiedad = "A417, A381 +1 más"), modal detalle con cards de propiedades + notas
                       chat. Modales crear/editar con selector múltiple compartido (selectorPropsHTML/
                       montarSelectorProps, pills+checkboxes) que envía `propiedad_ids[]`. Avance
                       automático del cliente: crear visita Nuevo→Contactado, realizar Contactado→Visitado.
                       **Convertir a venta** (modalConvertirVenta): botón 💰 en tabla y detalle si la visita
                       está Realizada y ninguna propiedad vendida; selector de propiedad (auto si 1),
                       precio final + diferencia en vivo (rojo/verde), comprador cliente/manual → POST
                       /visitas/:id/convertir-venta; badge verde "Venta cerrada"/"Vendida ✓" si vendida.
                       **Calendario**: vista
                       mensual (grid 7 col + flechas/Hoy + leyenda; modo lista en móvil) con las visitas
                       por día; clic en visita → detalle, clic en día → nueva visita. **Vendidos**:
                       buscador + selector de año (por fecha_venta) + contador + volumen total; tabla
                       (precio anuncio/venta, Diferencia coloreada, comprador, escritura con badge
                       "Pendiente") desde /ventas/propiedades?estado=Vendida filtrado en cliente.
                       Sub-pestaña Propietarios (cartera de ventas): tabla + ficha lateral (#prv-panel)
                       con propiedades asociadas + modal alta/edición + modal "Importar de alquileres"
                       (typeahead sobre /api/propietarios). El modal de propiedad y su ficha enlazan un
                       propietario_venta_id (typeahead; ficha muestra el vínculo con "Ver ficha").
                       Expone init/cargar/abrirFicha. Clases CSS `vta-*`/`vca-*`. UI mobile-first.
  js/personal.js       Módulo Personal (RRHH). IIFE `Personal`, sub-pestañas Fichaje | Empleados |
                       Ausencias | Horas extra (inyectadas en runtime). Gating: limpieza/mantenimiento
                       solo Fichaje + Horas extra; Empleados/Ausencias solo admin/usuario. **Fichaje**
                       (todos): panel por estado (fuera/trabajando/pausa) con contador en vivo, timeline
                       del día y, admin, "Resumen del equipo" (/resumen-dia) + "Exportar fichajes" (CSV
                       por fetch con token). **Empleados** (admin/usuario): tabla + ficha (#per-panel,
                       resumen anual), modal alta/edición (vincula usuario CRM). **Ausencias** (admin/
                       usuario): calendario empleados×días por tipo, saldo por empleado, aprobar/rechazar
                       (solo admin). **Horas extra** (todos): vista propia + gestión del pago (admin). El
                       modal admin "añadir" tiene 3 modos (radio): Horas directas (horas+precio/h) ·
                       Por horario (hora inicio/fin → calcula horas) · Otro concepto (descripción+importe,
                       horas=0). Cálculo de importe/horas en vivo. El modal "Registrar pago" solo pide
                       importe+fecha. En la tabla, horas=0 → "—" y muestra el importe directamente.
                       Clases `per-*`/`aus-*`/`hx-*`. UI mobile-first.
  js/leads.js          Módulo Comercial (Leads). IIFE `Leads`, sub-pestañas Leads | Plantillas.
                       Resumen (5 minis + tasa conversión), tabla con filtros (estado/atendido/fechas,
                       client-side), panel lateral propio (#lead-panel: datos, propuestas, notas tipo
                       chat, banner si reservado, dropdown estado, convertir, editar). Modal alta/edición
                       (typeahead apto). **Envío de propuestas**: modal 2 pasos (configurar email/apto/
                       precio/plantilla con placeholders + seleccionar fotos del apto con preview) →
                       guardar borrador o enviar (POST propuesta + POST .../enviar; maneja {ok:false}
                       SMTP). Convertir a reserva (modal → POST /:id/convertir; notas se guardan como
                       nota del lead). Plantillas: tabla CRUD + placeholders clicables + preview.
                       Expone init/cargar/abrirFicha. Clases `lead-*` (reusa varias `vta-*`/`mant-*`).
  js/clientes-alquiler.js  Módulo Clientes (huéspedes). IIFE `ClientesAlquiler` (nombre distinto de los
                       clientes de Ventas). Tabla paginada (50/pág, ?offset=) con buscador debounce,
                       columnas Nombre/Teléfono/Email/DNI/País/Reservas(badge). Panel lateral propio
                       (#cli-panel: datos personales, contacto, dirección, historial de reservas
                       —clicable → ficha de reserva—, observaciones editables inline). Modal alta/edición
                       (campos principales; el resto entra por importación). Modal importar (dropzone .xls/
                       .xlsx → POST /api/clientes/importar con authHeaders, resumen nuevos/actualizados/
                       errores). Expone init/cargar/abrirFicha. Clases `cli-*`. UI mobile-first.
  js/extras-inventario.js  Módulo Extras (inventario de objetos prestables: cunas, tronas, ventiladores…).
                       IIFE `ExtrasInventario`, 3 sub-pestañas (#ext-subtabs) Inventario|Préstamos|Categorías
                       (en index.html; los paneles se rellenan en runtime). Resumen (mini-cards artículos/
                       en préstamo/categorías con artículos desde /extras/resumen). **Inventario**: filtro por
                       categoría + tabla (stock, disponible coloreado u "Ilimitado", ubicaciones actuales),
                       modal alta/edición de artículo (stock vacío = ilimitado), acciones Prestar/Devolver
                       (modal con cantidad/fecha/apartamento por **typeahead** `montarTypeaheadApto` —reusa
                       clases `.mant-ta*`— /notas → POST /extras/movimientos) e Historial (modal con todos
                       los movimientos). **Préstamos**: filtros item/apartamento + tabla de movimientos +
                       "Registrar movimiento" (elige artículo) + borrar (solo admin). **Categorías**: CRUD
                       icono+nombre (borrar solo si sin artículos). Expone init/cargar. Clases `ext-*`. UI mobile-first.
```

**Orden de carga de scripts**: `api.js` y `auth.js` primero, `app.js` último (entre medias: …`leads.js`, `clientes-alquiler.js`, `personal.js`, `extras-inventario.js`). Los módulos se referencian entre sí solo en runtime (no en carga).

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
| GET | /api/apartamentos | Lista; `?todos=1` incluye `quitar_planning=1`; `?tih=` filtra; `?portal_id=` filtra por portal. Cada apto lleva `propietarios[]` (activos) + `portal_id`/`portal_nombre` (LEFT JOIN portales) + campos planos compat del principal |
| GET/PUT/DELETE | /api/apartamentos/:id | Ficha (campos ampliados + `propietarios[]` activos+históricos + historial) / Editar (merge; ignora propietario_id; acepta `portal_id`, null=desasignar) / Borrar (reservas→Sin asignar) |
| GET/POST | /api/apartamentos/:id/propietarios | Relaciones N:M. POST `{propietario_id, porcentaje, fecha_inicio, notas}`: valida existencia, sin activa duplicada (409), suma % ≤ 100 (400); suma < 100 → `{ok, aviso}` |
| PUT/DELETE | /api/apartamentos/:id/propietarios/:rel_id | Editar (porcentaje/fechas/notas/activo; valida suma ≤ 100) / Borrar (409 si el propietario tiene contratos o facturas en ese apto) |
| POST | /api/apartamentos/:id/propietarios/:rel_id/cerrar | Cierra relación: activo=0 + fecha_fin (body o hoy). 409 si ya cerrada |
| GET/POST/PUT/DELETE | /api/apartamentos/:id/fotos[/:foto_id] | Galería. POST multipart campo **`fotos`** (≤10, .jpg/.jpeg/.png/.webp) en `public/uploads/apartamentos/{id}/`. PUT: descripcion/orden |
| POST | /api/apartamentos/:id/fotos/reordenar | Body `{orden:[id1,id2,...]}` → fija el campo orden de cada foto |
| PUT | /api/apartamentos/:id/limpieza | Body `{estado_limpieza:'limpio'\|'sucio'}`. Actualiza + registra en limpieza_log con req.usuario |
| GET | /api/apartamentos/:id/limpieza-log | Historial de limpieza, fecha DESC, máx 50 |
| GET | /api/apartamentos/pagos-propietario/resumen | `?anio=`. Total pagado/pendiente por apartamento (para Estadísticas). **Declarar antes de /:id** |
| GET/POST/PUT/DELETE | /api/apartamentos/:id/pagos-propietario[/:pago_id] | Pagos a propietario del apto (`?anio=`, JOIN facturas→nº). POST `{concepto, importe, fecha, notas}`. PUT acepta `pagado`/`fecha_pago`. DELETE→409 si tiene factura |
| POST | /api/apartamentos/:id/pagos-propietario/:pago_id/generar-factura | Autofactura del pago (IVA 0%, ret 19%, emisor=propietario) vía `crearAutofacturaPago`; fija `factura_id`. 409 si ya tiene |
| GET/POST/PUT/DELETE | /api/apartamentos/:id/gastos[/:gasto_id] | Gastos del apto por año. POST: snapshot nombre+precio del catálogo |
| GET/POST/PUT/DELETE | /api/catalogo-gastos[/:id] | Catálogo de gastos. DELETE→409 si tiene gastos asociados |
| GET/POST/PUT/DELETE | /api/propietarios[/:id] | CRUD propietarios |
| POST | /api/propietarios/importar | Excel/CSV (campo `archivo`); upsert por email o documento |
| POST | /api/apartamentos/importar | Export Avantio (campo `archivo`, declarado antes de /:id); upsert por id_avantio → `{nuevos, actualizados, errores, propietarios_vinculados}`. No pisa notas/config en UPDATE |
| GET | /api/reservas | Para planning; `?desde=&hasta=` (ISO) + `?tih=` |
| GET | /api/reservas/sin-asignar | Bandeja sin asignar; `?tih=` |
| GET | /api/reservas/todas | Todas + apartamento_nombre; orden entrada DESC |
| GET | /api/reservas/verificar-disponibilidad | `?apartamento_id=&entrada=&salida=[&excluir_reserva_id=]` → `{ disponible, conflicto }` |
| GET | /api/reservas/entradas-pdf | `?desde=&hasta=` (solo admin/usuario; antes de /:id). PDF pdfkit A4 horizontal con las entradas (check-in) del rango: Fecha/Apartamento/Cliente/Personas/Portal/Teléfono/Observaciones. Teléfono = `extraerTelefono(observaciones)` o cliente vinculado. `Content-Disposition: attachment` |
| POST | /api/reservas/importar-avantio | Multipart (campo `archivo`, antes de /:id). Importa el "Listado de reservas" de Avantio vía `importReservasAvantio`; upsert por numero_reserva sin pisar apartamento_id/notas_internas/observaciones → resumen |
| GET/POST/PUT/DELETE | /api/reservas[/:id] | CRUD. POST→409 si numero_reserva duplicado. POST: si `numero_reserva` viene vacío lo autogenera con el prefijo del portal (`generarNumeroReserva`); acepta `cliente_id`; si `precio_total>0` crea el plan 20/80 en la misma transacción (`generarPlanPagos`); devuelve `{id, numero_reserva}`. PUT: `cliente_id` editable. GET/:id: LEFT JOIN clientes → `cliente_nombre_completo/cliente_telefono/cliente_email` |
| PUT | /api/reservas/:id/mover | Drag&drop; body `{apartamento_id}`; 409 si solapa. `null` → Sin asignar |
| GET/POST/PUT/DELETE | /api/reservas/:id/pagos[/:pago_id] | Plan de pagos. GET→`{pagos, total_pagado, total_pendiente, precio_total_reserva}`. POST pago manual (pagado sin fecha→hoy) |
| POST | /api/reservas/:id/pagos/generar-plan | Plan 20%/80%: borra pagos NO pagados y crea 2 cuotas. 409 si precio_total=0 |
| GET/POST/PUT/DELETE | /api/reservas/:id/extras[/:extra_id] | Extras de la reserva. POST `{catalogo_extra_id, cantidad}`: snapshot nombre/precio/tipo; importe = precio×cant (×noches si tipo='noche', noches via julianday). GET→`{extras, total_extras}` |
| GET/POST/PUT/DELETE | /api/catalogo-extras[/:id] | Catálogo de extras. GET activos primero, alfabético. DELETE→409 si usado en alguna reserva |
| GET/POST/PUT/DELETE | /api/portales[/:id] | CRUD portales. `prefijo` (uppercase, vacío→null) para auto-numerar reservas |
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
| GET | /api/mantenimiento/tareas | `?estado=&apartamento_id=&anio=`. JOIN apto (nombre+tipo); orden estado+posicion ASC |
| GET | /api/mantenimiento/tareas/:id | Ficha: tarea + apto + notas (fecha ASC) + fotos + reserva vinculada |
| POST | /api/mantenimiento/tareas | `{apartamento_id, titulo, descripcion, estado, reserva_id, asignado_a, fecha_limite}`. Vincula reserva (la indicada o la activa hoy) y copia cliente_nombre + teléfono de observaciones; posicion = MAX+1 del estado |
| PUT | /api/mantenimiento/tareas/:id | Editar titulo/descripcion/estado/asignado_a/fecha_limite. Cambio de estado → al final de la nueva columna |
| POST | /api/mantenimiento/tareas/:id/completar | estado='completada' + completado_por/nombre/fecha |
| POST | /api/mantenimiento/tareas/:id/reordenar | `{posicion, estado}`. Incrementa la posicion de los ≥ nueva (mismo estado, excluyendo la propia) |
| DELETE | /api/mantenimiento/tareas/:id | Eliminar tarea. **403 para rol mantenimiento** |
| POST/DELETE | /api/mantenimiento/tareas/:id/notas[/:nota_id] | Añadir nota (usuario actual) / borrar (solo autor o admin, else 403) |
| POST/DELETE | /api/mantenimiento/tareas/:id/fotos[/:foto_id] | Multipart campo **`fotos`** (≤5) en `public/uploads/mantenimiento/{tarea_id}/` / borrar BD+disco |
| GET | /api/mantenimiento/historial | `?apartamento_id=&anio=`. Tareas del apto+año con notas y num_fotos, orden fecha_creacion DESC + `resumen{total,completadas,pendientes,en_proceso,urgentes}` |
| GET | /api/mantenimiento/resumen | `{total_abiertas, urgentes, en_proceso, completadas_este_mes}` |
| GET | /api/ventas/resumen | Contadores para el dashboard de Ventas (propiedades por estado, clientes activos, visitas hoy/programadas/realizadas) |
| GET | /api/ventas/propiedades | Lista; filtros `?estado=&tipo=&zona=&precio_min=&precio_max=&dormitorios=` |
| GET/POST/PUT/DELETE | /api/ventas/propiedades[/:id] | CRUD propiedades en venta. GET/:id incluye `visitas[]`. POST/PUT validan `referencia` única (409). DELETE→409 si tiene visitas |
| POST | /api/ventas/propiedades/importar | Excel de Idealista (campo `archivo`); upsert por referencia, no pisa estado/notas/descripcion |
| POST | /api/ventas/propiedades/:id/vender | `{fecha_venta, fecha_escritura, precio_venta_final, comprador_*}`. estado='Vendida' + guarda datos (fecha_venta→hoy si falta) |
| GET | /api/ventas/clientes | Lista; filtros `?estado=&busca_tipo=&presupuesto_min=&presupuesto_max=` |
| GET/POST/PUT/DELETE | /api/ventas/clientes[/:id] | CRUD clientes compradores. GET/:id incluye `visitas[]`. DELETE→409 si tiene visitas |
| GET | /api/ventas/visitas | Lista; filtros `?fecha=&estado=&cliente_id=&propiedad_id=` (propiedad_id vía N:M). Cada visita lleva `propiedades[]` ({id,referencia,calle,precio}); `propiedad_id`+`propiedad_*` = 1ª propiedad (compat) |
| GET | /api/ventas/visitas/hoy | Programadas para hoy, con `propiedades[]` (**declarar antes de /:id**) |
| GET/POST/PUT/DELETE | /api/ventas/visitas[/:id] | CRUD visitas (N:M con `visitas_propiedades`). Body `propiedad_ids[]` (o `propiedad_id` compat): UNA visita con N propiedades. POST inserta todas; PUT reemplaza (DELETE+INSERT); 409 si alguna propiedad ya tiene visita de ese cliente esa fecha. GET/:id + POST/PUT devuelven `propiedades[]`. POST avanza cliente Nuevo→Contactado |
| POST | /api/ventas/visitas/:id/realizar | `{valoracion, notas}` → estado='Realizada'; avanza cliente Contactado→Visitado |
| POST | /api/ventas/visitas/:id/convertir-venta | `{propiedad_id, precio_venta_final, comprador_*, fecha_venta, fecha_escritura}`. Valida que la propiedad es de la visita (400) y no vendida (409); `marcarVendida` + cliente→'Compró'. → `{ok, propiedad_id, referencia, precio_venta_final}` |
| POST/DELETE | /api/ventas/visitas/:id/notas[/:nota_id] | Hilo de notas de la visita |
| GET | /api/ventas/propietarios-venta?buscar= | Cartera de propietarios de venta (+ `num_propiedades`) |
| GET/POST/PUT/DELETE | /api/ventas/propietarios-venta[/:id] | CRUD. GET/:id incluye `propiedades[]`. DELETE→409 si tiene propiedades |
| POST | /api/ventas/propietarios-venta/importar-alquiler | `{propietario_id}`: copia un propietario de alquiler (409 si ya importado). **Antes de /:id** |
| GET | /api/mayoristas/resumen | `?anio=` → `{resumen{total_comprometido,total_cobrado,total_pendiente,contratos_activos}, por_mayorista[]}` (próximo pago incluido). **Antes de /:id** |
| GET/POST/PUT/DELETE | /api/mayoristas[/:id] | CRUD mayoristas (turoperadores). DELETE→409 si tiene contratos |
| GET | /api/mayoristas/contratos | `?anio=`. Todos los contratos del año + nombre del mayorista (**antes de /:id**) |
| GET/PUT/DELETE | /api/mayoristas/contratos/:id | Detalle (con `pagos[]`) / editar + reemplazar plan de pagos (transacción, valida suma==total) / borrar (409 si pagos cobrados) |
| GET/POST | /api/mayoristas/:id/contratos | Contratos de un mayorista (`?anio=`) / crear contrato + plan de pagos `{anio, importe_total, pagos:[{numero_pago,fecha_prevista,importe}]}` (valida suma, 409 si año duplicado) |
| PUT | /api/mayoristas/pagos/:pago_id | Marcar/desmarcar cobro `{pagado, fecha_pago, metodo_pago, numero_factura}`. Marcar sin fecha→hoy; desmarcar limpia fecha+método |
| GET/POST/PUT/DELETE | /api/personal/empleados[/:id] | CRUD empleados. GET por defecto solo activos; `?todos=1` incluye inactivos. POST/PUT validan `usuario_id` (existe + UNIQUE). DELETE→409 si tiene fichajes o ausencias |
| GET | /api/personal/fichajes/estado | Estado actual (`trabajando`/`pausa`/`fuera`) + resumen del día del empleado logueado. **Antes de /:id** |
| GET | /api/personal/fichajes/resumen?empleado_id=&mes=&anio= | Resumen mensual (horas/día + total). Admin cualquiera o todos; empleado el suyo |
| GET | /api/personal/fichajes?empleado_id=&fecha= | Fichajes del día. Admin sin empleado_id→todos; no-admin→solo el suyo |
| POST | /api/personal/fichajes | `{tipo}` (entrada/pausa/reanudacion/salida). Empleado vía `usuario_id`; hora/fecha `localtime`; valida secuencia (409); devuelve `{ok, fichaje, estado, resumen_dia}` |
| GET | /api/personal/ausencias/calendario?anio=&mes= | `[{fecha, empleado_id, empleado_nombre, tipo}]` (no rechazadas). **Antes de /:id** |
| GET | /api/personal/ausencias/saldo?empleado_id=&anio= | `{total, usados, pendientes, desglose{...}}` (solo aprobadas). **Antes de /:id** |
| GET/POST | /api/personal/ausencias[?empleado_id=&anio=&tipo=] | Lista (admin todas / empleado las suyas) / crear (empleado solo para sí; `dias`=laborables auto) |
| PUT/DELETE | /api/personal/ausencias/:id | Editar / eliminar. **Solo admin** (PUT registra actividad aprobar/rechazar) |
| GET | /api/personal/horas-extra/resumen?empleado_id=&anio= | `{total_horas, horas_pagadas, horas_pendientes, total_pagado, total_pendiente}`. **Antes de /:id** |
| GET/POST | /api/personal/horas-extra[?empleado_id=&anio=&pagada=] | Lista (admin todas / empleado las suyas) / crear (admin puede pasar `empleado_id`). Acepta `hora_inicio`/`hora_fin` (calcula horas), `precio_hora` (→importe), `importe` directo; `horas=0` exige `importe>0` |
| PUT/DELETE | /api/personal/horas-extra/:id | Admin: pago (pagada/importe/fecha_pago) + `hora_inicio`/`hora_fin`/`precio_hora`. Empleado: solo fecha/horas/descripción de las suyas no pagadas; DELETE admin o propio si no pagada |
| GET | /api/personal/resumen-dia?fecha= | **Solo admin**. `{empleados_fichados, en_pausa, ausentes_hoy[], fichajes[]}` (fichajes con entrada/salida/estado/horas/pausas[]) |
| GET | /api/personal/fichajes/exportar?empleado_ids=&meses=&anio= | **Solo admin**. CSV (`;`, BOM UTF-8) de fichajes; `meses`/`empleado_ids` listas por coma (vacío=todos); una fila por día laborable, columnas de pausa dinámicas, TOTAL por empleado; filename según rango. **Antes de /fichajes** |
| GET/POST/PUT/DELETE | /api/ajustes/razones-sociales[/:id] | CRUD razones sociales |
| POST | /api/ajustes/razones-sociales/:id/logo | Multipart campo `logo`; .jpg/.jpeg/.png/.webp/.svg |
| GET/POST/PUT/DELETE | /api/ajustes/estados-reserva[/:id] | CRUD estados de reserva (orden por `orden`). DELETE→409 si `es_sistema=1` o si alguna reserva usa ese nombre |
| GET/PUT | /api/ajustes/smtp | **Solo admin**. Config SMTP (claves smtp_* de `ajustes`). GET enmascara la contraseña; PUT con `smtp_password='••••••••'` conserva la anterior |
| POST | /api/ajustes/smtp/test | **Solo admin**. Envía email de prueba al smtp_user → `{ok}` / `{ok:false,error}` |
| POST | /api/email/enviar-fotos | `{to, subject, mensaje, apartamento_id, foto_ids[]}`. Adjunta las fotos (verifica que son del apto), HTML con logo de razón social. Errores SMTP → `{ok:false,error}` (HTTP 200) |
| GET | /api/ajustes/actividad | **Solo admin**. `?usuario_id=&accion=&limit=200`; orden fecha DESC |
| GET | /api/clientes | `?buscar=&limit=50&offset=`. Búsqueda nombre/apellidos/email/teléfono/DNI; cada fila lleva `num_reservas` |
| GET/POST/PUT/DELETE | /api/clientes[/:id] | CRUD clientes (huéspedes). GET/:id incluye `reservas[]` (historial). DELETE→409 si tiene reservas vinculadas |
| POST | /api/clientes/importar | Multipart `archivo` (export Avantio HTML-as-XLS) → `importClientes`; upsert por id_avantio → `{nuevos, actualizados, errores}` |
| GET/POST/PUT/DELETE | /api/restricciones[/:id] | Periodos de fechas restringidas. GET todos (todos los roles). POST/PUT/DELETE **solo admin**; validan `fecha_fin >= fecha_inicio` (400). No impiden reservas (solo aviso visual) |
| GET/POST/PUT/DELETE | /api/extras/categorias[/:id] | Categorías de extras (icono+nombre). DELETE→409 si tiene items |
| GET | /api/extras/resumen | `{total_items, prestados_ahora, categorias_con_items}` |
| GET | /api/extras/items[/:id] | `?categoria_id=`. Lista con `disponible` (stock − préstamo neto, o null=Ilimitado) + `ubicaciones[]` (apartamentos con préstamo neto>0). GET/:id incluye `movimientos[]` |
| POST/PUT/DELETE | /api/extras/items[/:id] | CRUD artículos (`stock_total` vacío/null = ilimitado). DELETE→409 si hay préstamo sin devolver (neto>0) |
| GET/POST | /api/extras/movimientos | `?item_id=&apartamento_id=`. POST `{item_id, tipo:prestamo\|devolucion, apartamento_id, reserva_id, cantidad, fecha, notas}`; préstamo con stock limitado→409 si supera disponible; `created_by`=usuario |
| DELETE | /api/extras/movimientos/:id | Eliminar movimiento (recalcula stock). **Solo admin** |
| GET | /api/leads/plantillas · POST · PUT/:id · DELETE/:id | Plantillas de email (activas). DELETE→409 si tiene propuestas. **Antes de /:id** |
| GET | /api/leads/resumen | Contadores por estado + `conversion_rate`. **Antes de /:id** |
| GET/POST/PUT/DELETE | /api/leads[/:id] | CRUD leads. GET/:id → `{...lead, propuestas, notas_chat}`. DELETE→409 si estado='reservado' |
| POST | /api/leads/:id/convertir | Crea reserva (nº `LEAD-{id}-{ts}`) con plan 20/80 si precio>0; lead→'reservado' + reserva_id. `{ok, reserva_id, numero_reserva}` |
| POST/DELETE | /api/leads/:id/notas[/:nota_id] | Hilo de notas del lead |
| GET/POST | /api/leads/:id/propuestas | Lista / crear propuesta `{plantilla_id, apartamento_id, precio_propuesto, foto_ids[], email_destino, asunto, mensaje}` |
| POST | /api/leads/:id/propuestas/:prop_id/enviar | Envía la propuesta por email (fotos del apto adjuntas); enviada=1 + lead→'propuesta_enviada'. Errores SMTP → `{ok:false,error}` |
| GET | /api/dashboard | proximos_checkin, reservas_en_curso, proximos_checkout (máx 50 c/u), pagos_pendientes, reservas_entrantes |
| GET | /api/estadisticas/portales | `?anio=`. Ingresos por portal (excluye canceladas): totales, noches, resumen |
| GET | /api/estadisticas/apartamentos | `?anio=[&apartamento_id=]`. Sin id: ingresos+ocupación por apto. Con id: detalle + reservas del año |
| GET | /api/estadisticas/ocupacion | `?anio=`. por_mes[12] + por_tih + resumen. Maneja bisiestos |
| GET | /api/estadisticas/propietarios | `?anio=`. Cashflow precio_cerrado: comprometido/pagado/pendiente/próxima cuota por propietario |
| GET/POST/PUT/DELETE | /api/contratos[/:id] | CRUD contratos + cuotas (transacción). POST/PUT llaman `generarBloqueosContrato` (regenera reservas auto del planning). DELETE→409 si hay cuotas pagadas |
| GET | /api/contratos/resumen-propietario | `?propietario_id=&anio=` (**declarar antes de /:id**) |
| GET | /api/contratos/:id/pdf | Contrato en PDF (pdfkit). **Declarar antes de /:id** |
| GET | /api/contratos/:id/docx | Mismo contrato en Word (.docx) vía librería `docx` (Packer.toBuffer). **Antes de /:id** |
| GET/POST | /api/contratos/:id/fechas-propietario | Fechas de uso del propietario (`contrato_fechas_propietario`). POST `{fecha_inicio, fecha_fin, motivo}` dentro del período del contrato → regenera bloqueos |
| DELETE | /api/contratos/:id/fechas-propietario/:fp_id | Elimina fecha de uso + regenera bloqueos |
| PUT | /api/contratos/:id/cuotas/:cuota_id | Marcar/desmarcar pago; sin fecha→usa hoy; desmarcar limpia fecha |
| GET/POST/DELETE | /api/facturas[/:id] | Lista/ficha/crear/borrar facturas. POST tipos huésped/propietario/autofactura/gastos/mayorista, numera correlativo F-{anio}-NNN en transacción. Tipo `mayorista`: `{razon_social_id, anio, mayorista_pago_ids[]}`, IVA 10%, fija numero_factura en los pagos |
| PUT | /api/facturas/:id | Editar. **Admin**: todos los campos (emisor/receptor/importes + array `lineas` reemplaza líneas y recalcula totales). **No admin**: solo `estado`/`fecha_vencimiento`/`notas` (p. ej. marcar pagada); cualquier otro campo → 403 |
| GET/POST/PUT/DELETE | /api/tarifas/temporadas[/:id] | CRUD temporadas. `?anio=`. POST/PUT validan solape mismo año (409) |
| POST | /api/tarifas/temporadas/copiar | `{anio_origen, anio_destino}`. 409 si destino ya tiene; 29-feb→28 si destino no bisiesto |
| GET/PUT | /api/tarifas/modificadores[/:id] | Modificadores % por tipo. PUT solo porcentaje; tipo A bloqueado (400) |
| GET/POST/PUT/DELETE | /api/tarifas/descuentos[/:id] | CRUD descuentos. `?anio=`. tipos/portales JSON array o null (= todos) |
| GET | /api/tarifas/calcular | `?apartamento_id=&entrada=&salida=[&portal=]` → desglose por noche + descuentos + extras obligatorios + precio_total. 400 `{ok:false}` si falta tarifa en alguna fecha |
| GET | /api/facturas/:id/pdf | PDF pdfkit; `Content-Disposition: attachment` |
| PUT | /api/facturas/:id/anular | Marca estado='anulada' (no borra) |

Todas las rutas `/api/*` salvo `/api/auth/login` pasan por `requireAuth` (header `X-Auth-Token`) → `req.usuario = { id, nombre, username, rol }`.

**Orden en `routes/reservas.js`**: `/sin-asignar`, `/todas`, `/verificar-disponibilidad`, `/entradas-pdf`, `/importar-avantio` deben declararse **antes** de `/:id`.

**Orden en `routes/ventas.js`**: `/visitas/hoy` debe declararse **antes** de `/visitas/:id` (igual que `/resumen` y `/propiedades/importar` van antes de sus `/:id`; y `/propietarios-venta/importar-alquiler` antes de `/propietarios-venta/:id`).

**Orden en `routes/personal.js`**: `/fichajes/estado`, `/fichajes/resumen` y `/fichajes/exportar` antes de la genérica `/fichajes`; `/ausencias/calendario` y `/ausencias/saldo` antes de `/ausencias/:id`; `/horas-extra/resumen` antes de `/horas-extra/:id`.

**Orden en `routes/leads.js`**: `/plantillas`, `/plantillas/:id` y `/resumen` deben declararse **antes** de `/:id`.

**Orden en `routes/clientes.js`**: `/importar` (POST) no colisiona con `/:id` (distinto método), pero mantenerlo declarado junto al resto.

**Orden en `server.js`**: los sub-routers `/api/reservas/:id/pagos` y `/api/reservas/:id/extras` se montan **antes** de `/api/reservas` (igual que `/api/apartamentos/:id/gastos` y `/api/apartamentos/:id/fotos` antes de `/api/apartamentos`) para que `/:id` no capture esos prefijos.

## Modelo de datos

- **propietarios**: ~40 columnas (datos personales, contacto, domicilio, documentación, contables). `notas` = "Observaciones" en UI. `numero_documento` es el canónico (el campo `dni` es legado). `id_avantio` para upsert desde Avantio. `routes/propietarios.js` define `CAMPOS` como único punto de verdad para INSERT/UPDATE. Columnas nuevas: ALTER TABLE via `migrarPropietarios`.
- **apartamentos**: nombre, edificio, `tipo` ('1'|'2'), capacidad, notas. **Ya NO tiene `propietario_id`** (migrado a `apartamento_propietarios`). Ficha ampliada via `COLUMNAS_APARTAMENTOS`: clasificación (`tipo_clasificacion`: A/A+/A++/B/B+/C), orientación, situación, parking, wifi, `en_garantia`, `quitar_planning`, licencia_turistica, NRA, ref_catastral, escalera/piso/puerta, `estado_limpieza` ('limpio'|'sucio', CHECK, def. 'limpio'), `id_avantio` (clave de upsert al importar de Avantio), `direccion`/`numero` (importados de Avantio), `portal_id` (FK a `portales`, ON DELETE SET NULL, vía ALTER en `COLUMNAS_APARTAMENTOS` — asigna el apto a un portal; filtra el planning). Edificio/TIH/bloque ocultos en UI pero conservados en BD.
- **apartamento_propietarios**: relación N:M apartamento ↔ propietarios con histórico. apartamento_id/propietario_id (FK, ON DELETE CASCADE), porcentaje (REAL, los activos deben sumar 100), fecha_inicio (NOT NULL), fecha_fin (null = actual), activo (1=actual, 0=histórico), notas, UNIQUE(apartamento_id, propietario_id, fecha_inicio). El "principal" para compat/facturas = mayor porcentaje (empate → fecha_inicio más antigua). Contratos: con 1 propietario activo se autorrellena `propietario_id`; con varios el POST/PUT exige especificarlo.
- **reservas**: `numero_reserva` (TEXT UNIQUE), nombre_cliente, contrato, edificio, `tih` ('1'|'2'), personas, `entrada`/`salida` (ISO), observaciones, `apartamento_id` (NULL = "Sin asignar"). Campos de gestión: tipo_reserva, fecha_creacion, portal (TEXT por nombre), condicion_cancelacion, atendido_por, hora_entrada/salida, checkin/checkout_estado, precio_base/total/pagado/pendiente (pendiente = total−pagado, calculado en PUT), notas_internas, ocupante, `cliente_id` (FK a `clientes`, ON DELETE SET NULL — vía ALTER en `COLUMNAS_RESERVAS`; lo fija el wizard de Nueva reserva), `contrato_origen_id` (FK a `contratos`, ON DELETE SET NULL — vía ALTER en `COLUMNAS_RESERVAS` + índice creado en database.js; marca las reservas auto-generadas por un contrato, ver `contrato_fechas_propietario`).
- **portales**: nombre (UNIQUE), activo, orden, color (def. `#3b82f6`), imagen_url, `prefijo` (vía ALTER en `COLUMNAS_PORTALES` — prefijo de auto-numeración de reservas, ej. "CA"→CA-0001). Portal se guarda en reservas por **nombre**, no por id. Semilla: Booking.com, Airbnb, Apartplaya, Viajes Himalaya, Web propia, Directo, Otro. Imágenes en `public/uploads/portales/`; al re-subir se borra la anterior.
- **ajustes**: almacén genérico clave/valor. En uso: flag `limpieza_datos_prueba_v1` (marca la limpieza única de datos de prueba ya ejecutada — no borrar, o re-borraría facturas/contratos/pagos reales en el siguiente arranque) + claves `smtp_*` (host/port/user/password/from_name/from_email) de la config de correo saliente, gestionadas en Ajustes → Correo electrónico (defaults en `emailService.SMTP_DEFAULTS`).
- **razones_sociales**: datos de facturación (razon_social, CIF, dirección, IBAN, logo_url). `RS_CAMPOS` en `routes/ajustes.js` como punto de verdad.
- **usuarios**: nombre, username (UNIQUE), password_hash (sha256 sin bcrypt), rol ('administrador'|'usuario'|'limpieza'|'mantenimiento'), activo, ultimo_acceso, token (sesión activa). Admin por defecto: `admin` / `admin1234`. Los roles 'limpieza' y 'mantenimiento' se añadieron ampliando el CHECK vía `migrarUsuariosRol()` (rebuild; el guard mira si el CHECK ya incluye 'mantenimiento'). `routes/usuarios.js` valida contra `ROLES_VALIDOS`.
- **actividad_log**: usuario_id (FK sin ON DELETE — borrar usuario con registros requiere vaciar el log primero), usuario_nombre, accion, entidad, entidad_id, detalle, fecha.
- **contratos**: apartamento_id (FK NOT NULL, ON DELETE RESTRICT), propietario_id (FK nullable), tipo ('precio_cerrado'|'comision'), temporada_inicio/fin, anio, precio_total, porcentaje_comision, aplica_iva, porcentaje_retencion (0/19/24, def. 19), estado ('activo'|'finalizado'|'cancelado'), created_by. Fiscalidad precio_cerrado: total = base + IVA 21% − retención.
- **contrato_cuotas**: contrato_id (FK, ON DELETE CASCADE), numero_cuota, fecha_prevista, importe, pagado, fecha_pago. Suma de importes debe cuadrar con precio_total (±0.01€). PUT de contrato borra y reinserta todas las cuotas.
- **contrato_fechas_propietario**: contrato_id (FK), fecha_inicio/fecha_fin (dentro del período del contrato), motivo. Periodos de uso del propietario. `generarBloqueosContrato(db, contratoId)` (en `routes/contratos.js`, idempotente, transacción) borra las reservas auto del contrato (`contrato_origen_id` o nº legado `BLQ-`/`PROP-`) y las recrea: reservas "Bloqueado" para los tramos del año FUERA de la temporada del contrato + reservas "De propietario" por cada fecha de uso. Se invoca en POST/PUT de contrato y en POST/DELETE de fechas-propietario. Estas reservas aparecen en el planning.
- **catalogo_gastos**: nombre (UNIQUE), precio, descripcion, activo, incluye_iva (informativo; precio lleva IVA 21%).
- **apartamento_gastos**: apartamento_id (FK, ON DELETE CASCADE), catalogo_gasto_id (FK nullable, ON DELETE SET NULL), nombre/precio (**snapshot** al insertar), fecha, notas, cobrado_propietario, created_by. Cambios en catálogo no afectan gastos ya registrados.
- **facturas**: tipo CHECK (huésped/propietario/autofactura/gastos/mayorista; 'mayorista' se añadió ampliando el CHECK vía `migrarFacturasTipo()`), estado CHECK (borrador/emitida/pagada/anulada), numero UNIQUE (F-{anio}-NNN). Snapshot de emisor y receptor. IVA por tipo: propietario/autofactura→del contrato; gastos→21% si algún gasto lleva IVA; huésped→10%; mayorista→10% (alojamiento turístico). PUT de edición: admin todos los campos+líneas; no-admin solo estado/fecha_vencimiento/notas.
- **factura_lineas**: factura_id (FK, ON DELETE CASCADE), descripcion, cantidad, precio_unitario, importe, orden.
- **factura_contador**: anio PK / ultimo_numero. Numeración correlativa sin huecos dentro de la transacción del INSERT de factura.
- **reserva_pagos**: reserva_id (FK, ON DELETE CASCADE), concepto, importe, metodo_pago (CHECK caja/tpv/transferencia, nullable), pagado (0/1), fecha_pago (ISO, null hasta pagar), notas, orden, created_at. Plan de pagos del huésped. Sin migración en database.js (la tabla la crea schema.sql).
- **catalogo_extras**: nombre (UNIQUE), precio, tipo_precio (CHECK unidad/noche/persona, def. 'unidad'), descripcion, activo, `obligatorio` (0/1, via migrarCatalogoExtras — el frontend lo añade automáticamente a las reservas nuevas; /api/tarifas/calcular lo suma al total). Catálogo reutilizable gestionado en Ajustes.
- **reserva_extras**: reserva_id (FK, ON DELETE CASCADE), catalogo_extra_id (FK nullable, ON DELETE SET NULL), nombre/precio_unitario/tipo_precio (**snapshot**), cantidad, importe (calculado: precio×cant ×noches si tipo='noche'), noches (snapshot de noches de la reserva al añadir).
- **temporadas**: nombre, anio, fecha_inicio/fin (ISO, UNIQUE anio+fechas, sin solapes dentro del año), `precio_base_noche` (precio del Tipo A, el que manda), color, orden. Módulo Tarifas.
- **tipo_modificadores**: tipo (UNIQUE: A++/A+/A/B+/B/C), porcentaje (+/− sobre el precio base; A siempre 0, bloqueado en la API), orden. Seed en database.js si la tabla está vacía (A++ +20 … C −30).
- **descuentos**: nombre, porcentaje, fecha_inicio/fin, anio, min_noches (0 = sin mínimo), `tipos`/`portales` (JSON array TEXT, null = aplica a todos), activo, notas. En /calcular solo aplican los que cubren TODAS las noches de la estancia y cumplen condiciones; cada % se aplica sobre el subtotal (no compuestos).
- **apartamento_fotos**: apartamento_id (FK, ON DELETE CASCADE), url, nombre_archivo, descripcion, orden, created_at. Galería del apartamento. Archivos en `public/uploads/apartamentos/{id}/`; el DELETE de foto borra BD + disco. Borrar el apartamento (DELETE /api/apartamentos/:id) cascadea la BD y además borra del disco las fotos + la carpeta (igual el DELETE de tarea de limpieza con `public/uploads/limpieza/{tarea_id}/`).
- **estados_reserva**: nombre (UNIQUE), color (def. `#3b82f6`), orden, activo, `es_sistema` (0/1). Catálogo configurable en Ajustes. Seed en database.js si está vacía: Confirmada/Pendiente/Cancelada (es_sistema=1, no borrables) + Pagada/De propietario/Bloqueado. El select "Tipo de reserva" y el calendario del apartamento leen de aquí.
- **limpieza_log**: apartamento_id (FK, ON DELETE CASCADE), estado_anterior, estado_nuevo, usuario_id (FK), usuario_nombre, fecha. Histórico de cambios de `apartamentos.estado_limpieza`.
- **limpieza_tareas**: apartamento_id (FK CASCADE), fecha (ISO), tipo (checkout/manual/turnover), prioridad (0/1, 1=turnover urgente), estado (pendiente/en_proceso/completada), reserva_checkout_id/reserva_checkin_id (FK SET NULL), asignado_a/asignado_nombre, completado_por/completado_nombre/completado_fecha, notas_limpieza, created_by. Las de checkout/turnover se autogeneran (idempotente) en `GET /api/limpieza/tareas`; las manuales se crean a mano. Solo las `manual`+`pendiente` se pueden borrar.
- **limpieza_fotos**: tarea_id (FK CASCADE), url, nombre_archivo, descripcion. Fotos de reporte en `public/uploads/limpieza/{tarea_id}/`.
- **mantenimiento_tareas**: apartamento_id (FK CASCADE), titulo, descripcion, estado (CHECK urgente/pendiente/en_proceso/completada, def. 'pendiente'), posicion (orden dentro de la columna), reserva_id (FK SET NULL), cliente_nombre/cliente_telefono (snapshot de la reserva al crear; teléfono extraído de observaciones), asignado_a/asignado_nombre, completado_por/completado_nombre/completado_fecha, fecha_creacion, fecha_limite, created_by. Tablero kanban: una "columna" por estado, ordenada por posicion.
- **mantenimiento_notas**: tarea_id (FK CASCADE), texto, usuario_id (FK), usuario_nombre, fecha. Hilo cronológico (chat) de la tarea.
- **mantenimiento_fotos**: tarea_id (FK CASCADE), url, nombre_archivo, descripcion, created_by. Archivos en `public/uploads/mantenimiento/{tarea_id}/`; el DELETE de foto borra BD + disco.
- **propiedades_venta** (módulo Ventas/inmobiliaria): referencia (TEXT UNIQUE NOT NULL, clave de upsert al importar de Idealista), codigo_idealista, tipo, dirección (calle/numero/planta/zona/localidad), precio, dormitorios/banos/metros_cuadrados/metros_utiles, clase_energetica, garaje, num_fotos, estado (CHECK Disponible/Reservada/Vendida/Retirada, def. 'Disponible'), estado_idealista, fecha_alta/fecha_baja, datos del propietario (nombre/apellidos/telefono/email — **snapshot del Excel, no FK a `propietarios`**), descripcion, notas. Datos de la venta cerrada (vía `migrarPropiedadesVenta`, ALTER): fecha_venta, fecha_escritura, precio_venta_final, comprador_nombre/telefono/email. `referencia`, `estado`, `notas`, `descripcion` son del CRM y la importación NO los pisa en UPDATE. `routes/ventas.js` define `PROP_CAMPOS` como punto de verdad. `POST /:id/vender` pone estado='Vendida' y rellena los campos de venta. `propietario_venta_id` (FK a `propietarios_venta`, ON DELETE SET NULL, vía ALTER en `migrarPropiedadesVenta`) vincula el propietario real de la cartera de ventas; los campos `propietario_*` de texto son snapshot del Idealista.
- **propietarios_venta** (módulo Ventas): cartera de propietarios de venta. nombre (NOT NULL), apellidos, telefono/telefono2, email, dni, direccion, ciudad, codigo_postal, notas, `propietario_alquiler_id` (FK a `propietarios`, ON DELETE SET NULL — si se importó de alquileres; UNIQUE de hecho por endpoint: no se importa dos veces). `PRV_CAMPOS` en `routes/ventas.js`. Tabla creada por schema.sql.
- **clientes_compradores**: demanda (compradores). nombre (NOT NULL), apellidos/telefono/email, presupuesto_max, criterios de búsqueda (busca_tipo, busca_dormitorios, busca_zona, busca_linea, busca_frontal, busca_villa), notas, estado (CHECK Nuevo/Contactado/Visitado/En negociación/Compró/Descartado, def. 'Nuevo'), origen, created_by. `CLI_CAMPOS` como punto de verdad. El estado avanza solo al programar/realizar visitas.
- **visitas_venta**: cliente_id + propiedad_id (FK, ON DELETE CASCADE), fecha (NOT NULL), hora, estado (CHECK Programada/Realizada/Cancelada, def. 'Programada'), valoracion, notas, atendido_por, created_by. Tras el refactor N:M, `propiedad_id` queda como **compat** (= 1ª propiedad); las propiedades reales viven en `visitas_propiedades`.
- **visitas_propiedades**: relación N:M visita↔propiedad. visita_id/propiedad_id (FK CASCADE), UNIQUE(visita_id, propiedad_id). Backfill idempotente en `migrarVisitasPropiedades()` (vuelca el `propiedad_id` legado de cada visita sin filas en N:M).
- **visitas_notas**: visita_id (FK CASCADE), texto (NOT NULL), usuario_nombre, fecha. Hilo cronológico (chat) de la visita.
- **mayoristas** (Pagos de Mayoristas): nombre (UNIQUE NOT NULL), cif, direccion, telefono, email, contacto_nombre, notas, activo. Seed: Apartplaya, Viajes Himalaya (si tabla vacía). DELETE→409 si tiene contratos. `MAY_CAMPOS`/`CLI_CAMPOS`-style en `routes/mayoristas.js`.
- **mayorista_contratos**: mayorista_id (FK CASCADE), anio, descripcion, importe_total, estado (CHECK activo/finalizado/cancelado, def. 'activo'), notas. **UNIQUE(mayorista_id, anio)**. La suma del plan de pagos debe cuadrar con importe_total (±0.01€).
- **mayorista_pagos**: contrato_id (FK CASCADE), numero_pago, fecha_prevista, importe, pagado (0/1), fecha_pago, metodo_pago (CHECK transferencia/cheque/efectivo), numero_factura, notas. Plan de pagos del contrato; al facturar (tipo 'mayorista') se anota el numero_factura.
- **empleados** (módulo Personal): `usuario_id` (FK a `usuarios`, UNIQUE, ON DELETE SET NULL — vincula con el login para que pueda fichar), nombre (NOT NULL), apellidos, dni, telefono, email, puesto, fecha_inicio, dias_vacaciones_anio (def. 30), activo, notas. `EMP_CAMPOS` en `routes/personal.js`. `GET /empleados` devuelve solo activos por defecto; `?todos=1` incluye inactivos. Los inactivos se excluyen de calendario de ausencias, resumen-dia y lista de fichajes del día; en horas extra SÍ aparecen (historial).
- **pagos_propietario** (pestaña Pagos propietario de la ficha del alojamiento): apartamento_id (FK CASCADE), concepto (NOT NULL), importe (NOT NULL), fecha (NOT NULL), pagado (0/1), fecha_pago, `factura_id` (FK a `facturas`, ON DELETE SET NULL — al "generar autofactura"), notas, created_by. CRUD en `routes/apartamentos.js`; DELETE→409 si tiene factura. `generar-factura` crea una autofactura (IVA 0%, retención 19%, emisor=propietario activo) vía `crearAutofacturaPago` (exportado por `routes/facturas.js`) y fija `factura_id`. Tabla creada por schema.sql.
- **fichajes**: empleado_id (FK CASCADE), fecha (ISO), tipo (CHECK entrada/pausa/reanudacion/salida), hora ('HH:MM:SS', `time('now','localtime')`), notas. Una fila por evento. El estado del día y las horas se derivan de la secuencia (sin tabla de estado). Tabla creada por schema.sql.
- **ausencias**: empleado_id (FK CASCADE), tipo (CHECK vacaciones/dia_libre/dia_gracia/baja_medica/asuntos_propios), fecha_inicio/fecha_fin, dias (laborables lun-vie, calculado en el backend), estado (CHECK pendiente/aprobada/rechazada, def. 'aprobada'), aprobado_por, notas. Empleado crea pendientes para sí; admin crea/edita/aprueba/rechaza/borra.
- **horas_extra**: empleado_id (FK CASCADE), fecha, horas (REAL), descripcion, pagada (0/1), importe, fecha_pago, `hora_inicio`/`hora_fin` (TEXT, rango horario opcional, vía ALTER en `COLUMNAS_HORAS_EXTRA`/`migrarHorasExtra`), created_by. El empleado apunta las suyas (editables/borrables solo si no pagadas); el admin gestiona el pago. POST/PUT aceptan `hora_inicio`/`hora_fin` (calculan horas), `precio_hora` (→ importe = horas×precio_hora) e `importe` directo. `horas=0` solo es válido con `importe>0` ("Otro concepto").
- **clientes** (módulo Clientes — huéspedes/inquilinos): id_avantio (clave de upsert al importar), nombre (NOT NULL), apellido1/apellido2, fecha_nacimiento, sexo, nacionalidad, dirección (calle/numero/puerta/codigo_postal/ciudad/provincia/pais/region), dni, email/email2, telefono/telefono2/telefono3, idioma, tipo_cliente, cuenta_bancaria, codigo_fiscal, observaciones, cuenta_contable. `CAMPOS` en `routes/clientes.js`. Importación: `importClientes.js` no pisa `observaciones` en UPDATE. Vinculado a reservas vía `reservas.cliente_id`.
- **leads** (módulo Comercial): nombre (NOT NULL), telefono, email, apartamento_id (FK SET NULL) + apartamento_nombre, fecha_entrada/salida, personas, presupuesto, estado (CHECK nuevo/contactado/propuesta_enviada/esperando_respuesta/reservado/descartado, def. 'nuevo'), notas (texto libre), reserva_id (FK SET NULL — al convertir), atendido_por, created_by. `routes/leads.js`.
- **lead_propuestas**: lead_id (FK CASCADE), asunto, mensaje, apartamento_id (FK SET NULL), precio_propuesto, fotos_enviadas (JSON de foto_ids), email_destino, enviada (0/1), fecha_envio, plantilla_id (FK SET NULL), created_by. Propuestas de email enviadas/borrador.
- **lead_plantillas**: nombre (UNIQUE), asunto, cuerpo (con placeholders {nombre}/{apartamento}/{fecha_entrada}/{fecha_salida}/{precio}/{empresa}/{tipo}/{capacidad}/{zona}), activa (0/1). Seed de 2 (Propuesta estándar, Seguimiento) si la tabla está vacía.
- **lead_notas**: lead_id (FK CASCADE), texto, usuario_nombre, fecha. Hilo de notas (chat) del lead; la ficha lo devuelve en `notas_chat` (para no eclipsar la columna texto `notas` del lead).
- **restricciones**: fecha_inicio/fecha_fin (ISO, fin≥inicio), motivo, created_by, created_at. Periodos de fechas restringidas (ferias, sin disponibilidad…). NO impiden reservas: solo bloqueo visual en el planning (fondo rojo + banner) y aviso en Nueva reserva. `routes/restricciones.js` (GET todos; POST/PUT/DELETE solo admin).
- **extras_categorias** (módulo Extras): nombre (UNIQUE NOT NULL), icono (def. '📦'). Seed de 6 si la tabla está vacía (Cunas/Tronas/Ventiladores/Juguetes/Accesibilidad/Otros). DELETE→409 si tiene items.
- **extras_items**: nombre (NOT NULL), categoria_id (FK SET NULL), `stock_total` (INTEGER, **NULL = ilimitado**), descripcion. `disponible` se calcula en la API = stock_total − (Σ préstamos − Σ devoluciones). DELETE→409 si hay préstamo sin devolver.
- **extras_movimientos**: item_id (FK CASCADE), apartamento_id (FK SET NULL), reserva_id (FK SET NULL), cantidad (def. 1), tipo (CHECK prestamo/devolucion), fecha (def. hoy), notas, created_by. Préstamos/devoluciones; las "ubicaciones actuales" = apartamentos con préstamo neto>0. DELETE solo admin.

**Tablas nuevas sin migración**: `reserva_pagos`, `catalogo_extras`, `reserva_extras`, `temporadas`, `tipo_modificadores`, `descuentos`, `apartamento_fotos`, `estados_reserva`, `limpieza_log`, `limpieza_tareas`, `limpieza_fotos`, `mantenimiento_tareas`, `mantenimiento_notas`, `mantenimiento_fotos`, `propiedades_venta`, `clientes_compradores`, `visitas_venta`, `visitas_propiedades`, `visitas_notas`, `propietarios_venta`, `mayoristas`, `mayorista_contratos`, `mayorista_pagos`, `empleados`, `fichajes`, `ausencias`, `horas_extra`, `clientes`, `leads`, `lead_propuestas`, `lead_plantillas`, `lead_notas`, `pagos_propietario`, `restricciones`, `extras_categorias`, `extras_items`, `extras_movimientos` se crean solo vía `CREATE TABLE IF NOT EXISTS` en schema.sql (re-ejecutado cada arranque). No hay entradas en `database.js` porque no existen BD antiguas que migrar con ALTER (salvo: la columna `estado_limpieza` vía ALTER en `COLUMNAS_APARTAMENTOS`; el CHECK de `usuarios.rol` recreando la tabla en `migrarUsuariosRol()`; el CHECK de `facturas.tipo` recreado en `migrarFacturasTipo()`; los campos de venta + `propietario_venta_id` de `propiedades_venta` vía ALTER en `migrarPropiedadesVenta()`; `reservas.cliente_id` vía ALTER en `COLUMNAS_RESERVAS` —REFERENCES exige default NULL implícito, por eso `clientes` se crea en schema.sql antes de `migrarReservas`—; y `portales.prefijo` vía ALTER en `COLUMNAS_PORTALES`; y `horas_extra.hora_inicio`/`hora_fin` vía ALTER en `COLUMNAS_HORAS_EXTRA`/`migrarHorasExtra()`; y el backfill N:M de `visitas_propiedades` en `migrarVisitasPropiedades()`). Seed de `lead_plantillas` en `seedLeadPlantillas()` y de `extras_categorias` en `seedExtrasCategorias()`. `apartamento_propietarios` también la crea schema.sql, pero su migración de datos (volcado desde la antigua columna + DROP de `propietario_id` recreando apartamentos) vive en `migrarRelacionPropietarios()` y es idempotente (no-op si la columna ya no existe).

TIH: guardado como `'1'`/`'2'`, mostrado como "1ª Línea"/"2ª Línea" (`tihTexto`). Fechas en BD en ISO; en UI en DD/MM/AAAA (`fechaES`).

## Reglas de negocio

1. **Los pisos los crea el usuario a mano** (módulo Alojamientos). El Excel no indica a qué piso va cada reserva.
2. **Autoasignación al importar** (solo reservas nuevas): piso libre de la **misma TIH**. No filtra por edificio ni capacidad.
3. **Solape = intervalos medio abiertos**: `A.entrada < B.salida && B.entrada < A.salida`. El turnover (salida = entrada siguiente) NO solapa.
4. Sin piso libre de esa TIH → `apartamento_id = NULL` (bandeja "Sin asignar"), reportado como incidencia. El usuario la coloca con drag & drop.
5. **Upsert por `numero_reserva`**: si existe → UPDATE (conserva `apartamento_id`); si no → crea y autoasigna. Nunca se borran reservas automáticamente.
6. **Drag & drop** (`PUT /mover`): valida solape → 409 si choca. No restringe por TIH. `apartamento_id: null` devuelve a "Sin asignar".
7. **Alta manual**: el wizard de Nueva reserva NO pide nº (lo genera el backend con el prefijo del portal: `{PREFIJO}-NNNN`, o `R-{timestamp}` si el portal no tiene prefijo), ni TIH (se deriva del apartamento elegido, o '1'). Validación de solape en frontend antes de guardar. El nº sigue siendo único e inmutable.
8. **Plan de pagos automático**: al crear una reserva con `precio_total>0` (alta manual o conversión de lead) el backend genera el plan 20%/80% en la misma transacción del INSERT. Ya no hay botón "Generar plan" en la ficha (el endpoint `/pagos/generar-plan` se mantiene por compat).

### Pagos y extras de la ficha de reserva (pestaña Datos)
- **Sección EXTRAS** (encima de PAGOS): tabla de `reserva_extras` + total. Modal Añadir con typeahead del catálogo (solo activos) y resumen en vivo; modal Editar solo cambia cantidad (nombre/precio son snapshot). Recargar extras repinta también PAGOS (el total de extras mueve el cálculo).
- **Sección PAGOS**: resumen `cobrado / total a cobrar`, barra de progreso y aviso de desfase. **Total a cobrar = `precio_total` + `total_extras`**. El campo "Precio" es solo lectura en la ficha; se edita desde el modal de edición (botón Editar de la cabecera, campo que escribe `precio_total`). `precio_base` es legado, ya no se edita desde la UI.
- **Aviso de desfase**: compara `suma de importes de todos los pagos` vs total a cobrar (tolerancia 0,01€). Suma > total → cartel naranja; suma < total con ≥1 pago → cartel azul.
- **Botones**: Añadir pago · 💰 Autocompletar pago (crea "Pago complementario" por la diferencia; toasts si no hay desfase o si los pagos superan el total). El plan 20/80 ya no se genera a mano (es automático al crear la reserva).
- El modal de edición de reserva ya **no** tiene Hora entrada/salida ni Check-out (la sección de la ficha es solo "Check-in").

### Columnas del Excel de importación de reservas
`Reserva | Nombre Cliente | Contrato | Edificio | TIH | Per. | Entrada | Salida | Observaciones`
TIH llega como "1 Línea"/"2 Línea". Cabeceras normalizadas (minúsculas, sin acentos) en `importService.COLUMNAS`.

### Importación de propietarios (`importPropietarios.js`)
Formato Avantio: fila 0 = título "Lista", fila 1 = cabeceras, fila 2+ = datos → se parsea con `sheet_to_json({ header: 1, raw: true })` y `detectarFilaCabeceras` busca la primera fila válida. Upsert: email → numero_documento → id_avantio. Nunca borra. Transacción única (~1635 filas). `Nº cuenta` e `IBAN` mapean a `numero_cuenta` (gana el primero no-nulo).

### Importación de clientes (`importClientes.js`)
Mismo patrón Avantio (HTML disfrazado de XLS; `header:1, raw:true`; `detectarFilaCabeceras`). Mapeo flexible de 27 columnas. Upsert **por `id_avantio`**; en UPDATE NO pisa `observaciones` (campo del CRM). Nunca borra. Son ~3.900 clientes → el listado va paginado (`?limit=&offset=`).

## Gotchas / decisiones técnicas

- **⚠️ NUNCA poner la BD en OneDrive/Dropbox.** OneDrive sincronizaba el `crm.db` en uso y llegó a **restaurar una versión antigua** pisando datos reales. Por eso está en `C:\CRM`. Resetear solo con el servidor parado.
- **WAL — copiar siempre los 3 archivos juntos**: `crm.db`, `crm.db-wal`, `crm.db-shm`. Copiar solo `crm.db` puede perder los últimos cambios (el WAL puede tener datos no volcados; `crm.db` puede verse ~4 KB).
- **SheetJS y fechas**: leer con `xlsx.read(buffer, { raw: true })`. Sin `raw:true`, "02/06/2026" se interpreta como fecha americana MM/DD. **No usar `cellDates:true`.**
- **better-sqlite3 12.x**: síncrono → las rutas no usan async/await para la BD. Elegido por binarios precompilados para Node 24 (evita compilar con Visual Studio). Lanza al hacer bind de `undefined` → el frontend envía siempre todos los campos (string vacío).
- **Migraciones ALTER TABLE**: SQLite no permite DEFAULT con expresión (`datetime('now')`). DEFAULT constantes (`'Confirmada'`, `0`) sí valen. Para columnas de fecha: añadir sin DEFAULT, rellenar con UPDATE las filas viejas, fijar explícitamente en el INSERT.
- **multer 2.x**: memoryStorage + `.single('archivo')` (la 1.x tenía vulnerabilidades).
- **PDF con pdfkit** (no puppeteer): JS puro, sin Chromium, funciona offline. Logo embebido con `fs.readFileSync` **solo si es PNG/JPG** (no SVG/WEBP). Buffer acumulado de eventos `data`/`end`. Contratos además se exportan a **Word (.docx)** con la librería `docx` (`Packer.toBuffer`, tamaños en medios puntos: 20=10pt) en `GET /api/contratos/:id/docx`.
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
