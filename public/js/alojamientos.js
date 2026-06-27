// Módulo Alojamientos: tabla, alta/edición/borrado y ficha en panel lateral (2 pestañas:
// Alojamiento / Propietario). El panel se crea por JS (como reservas/contratos).

const Alojamientos = (() => {
  let fichaActual = null;      // apartamento abierto en el panel
  let propietarios = [];       // lista para el typeahead del modal "Añadir propietario"
  let propSelId = null;        // propietario seleccionado en ese modal
  let taMatches = [];          // resultados del typeahead
  let taIndex = -1;            // opción resaltada
  let propTabCargada = false;  // pestaña Propietario ya renderizada para esta ficha
  let relaciones = [];         // relaciones propietario (activas+históricas) de la ficha abierta

  // ---- Estado de la pestaña Gastos ----
  const ANIOS_GASTO = [2024, 2025, 2026];
  let gastoAnio = new Date().getFullYear();
  let gastosCargados = false;  // ya cargada la lista de gastos para esta ficha
  let gastoCatList = [];       // catálogo de gastos activos (para el typeahead del modal)
  let gastoCatSel = null;      // concepto seleccionado en el modal
  let gtaMatches = [];         // resultados typeahead de concepto
  let gtaIndex = -1;

  // ---- Estado de la pestaña Pagos propietario ----
  let pagoAnio = new Date().getFullYear();
  let pagosCargados = false;   // ya cargada la lista de pagos para esta ficha
  let pagosLista = [];         // pagos del apartamento abierto

  // ---- Estado de la pestaña Galería ----
  let galeriaFotos = [];       // fotos del apartamento abierto
  let galeriaCargada = false;  // ya cargada la galería para esta ficha
  let lightboxIdx = -1;        // índice de la foto abierta en el lightbox
  let dragFotoId = null;       // foto que se está arrastrando (reordenar)
  // Typeahead de cliente del modal "Enviar por email".
  let emailReservas = [];
  let emClientes = [];         // candidatos {nombre, email} únicos
  let emtaMatches = [];
  let emtaIndex = -1;

  // ---- Estado de la pestaña Calendario ----
  const ANIOS_CAL = [2024, 2025, 2026, 2027];
  let calAnio = new Date().getFullYear();
  let calCargado = false;      // ya cargado el calendario para esta ficha
  let calEstados = {};         // { nombreEstado: color }
  let calEstadosActivos = [];  // estados activos (para la leyenda)
  let calPortales = {};        // { nombrePortal: color } para los badges de la tabla de reservas
  const ANIOS_MANT = [2024, 2025, 2026];
  let mantAnio = new Date().getFullYear();
  let mantCargado = false;     // ya cargada la pestaña Mantenimiento para esta ficha
  const CAL_COLOR_DEFECTO = '#9ca3af';
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const DIAS_CAB = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

  const ORIENTACIONES = ['Norte', 'Sur', 'Este', 'Oeste', 'Sureste', 'Suroeste', 'Noreste', 'Noroeste'];
  const SITUACIONES = ['Frontal', 'Lateral Principio', 'Lateral Medio', 'Lateral Final'];
  const CLASIFICACIONES = ['A', 'A+', 'A++', 'B', 'B+', 'C'];

  // ---- Estado de filtros (módulo: se mantiene al cambiar de pestaña) ----
  let todos = [];          // caché de todos los apartamentos para filtrar en cliente
  let busqueda = '';
  // Tipo de apartamento (orden de presentación) con su clase de badge.
  const CLASIF_FILTRO = [
    { key: 'A++', clase: 'c-app' }, { key: 'A+', clase: 'c-ap' }, { key: 'A', clase: 'c-a' },
    { key: 'B+', clase: 'c-bp' }, { key: 'B', clase: 'c-b' }, { key: 'C', clase: 'c-c' },
    { key: '__sin__', clase: null }, // Sin clasificar
  ];
  const LIMPIEZA_FILTRO = [
    { key: 'limpio', label: '🟢 Limpio' },
    { key: 'sucio', label: '🔴 Sucio' },
  ];
  let fClas = new Set(CLASIF_FILTRO.map((c) => c.key)); // todas marcadas
  let fLimp = new Set(LIMPIEZA_FILTRO.map((c) => c.key)); // todas marcadas
  let fProp = 'todos';     // todos / con / sin
  let fPlanning = 'todos'; // todos / visible / excluido

  // ---- Formato ----
  function euro(n) { return (Number(n) || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'; }
  function num(n) { return (Number(n) || 0).toLocaleString('es-ES'); }
  function pct1(n) { return (Number(n) || 0).toFixed(1) + '%'; }
  function nombrePropFull(p) { return [p.nombre, p.apellidos, p.segundo_apellido].filter(Boolean).join(' '); }
  function v(x) { return esc(x) || '—'; }

  // ---- Badges ----
  function badgeTih(t) {
    const tt = String(t) === '2' ? '2' : '1';
    return `<span class="badge-tih-mini tih-${tt}">${tihTexto(tt)}</span>`;
  }
  function badgeClasif(c) {
    if (!c) return '—';
    const map = { 'A++': 'c-app', 'A+': 'c-ap', 'A': 'c-a', 'B+': 'c-bp', 'B': 'c-b', 'C': 'c-c' };
    return `<span class="badge-clasif ${map[c] || 'c-c'}">${esc(c)}</span>`;
  }
  function badgesCabecera(a) {
    let h = a.tipo_clasificacion ? badgeClasif(a.tipo_clasificacion) : '';
    if (a.quitar_planning) h += ' <span class="badge-estado inactivo">Sin planning</span>';
    return h;
  }

  // ==================== Tabla ====================
  async function cargar() {
    // ?todos=1: el módulo de Alojamientos necesita TODOS (incluidos los fuera del planning).
    todos = await API.get('/api/apartamentos?todos=1');
    construirFiltros();
    asegurarColumnaLimpieza();
    aplicarFiltros();
  }

  // Ajusta la cabecera (la tabla vive en index.html): quita la columna "Edificio" e
  // inserta el <th>Limpieza</th>. Idempotente.
  function asegurarColumnaLimpieza() {
    const tr = document.querySelector('#tabla-alojamientos thead tr');
    if (!tr) return;
    // Quitar "Edificio", "Notas" y "Capacidad" (una sola vez).
    Array.from(tr.querySelectorAll('th'))
      .filter((th) => ['edificio', 'notas', 'capacidad'].includes(th.textContent.trim().toLowerCase()))
      .forEach((th) => th.remove());
    if (!tr.querySelector('.th-planning')) {
      const ths = Array.from(tr.querySelectorAll('th'));
      const th = document.createElement('th');
      th.className = 'th-planning';
      th.textContent = 'Planning';
      tr.insertBefore(th, ths[ths.length - 1]); // antes de la columna de acciones
    }
    if (!tr.querySelector('.th-limpieza')) {
      const th = document.createElement('th');
      th.className = 'th-limpieza';
      th.textContent = 'Limpieza';
      tr.appendChild(th); // al final del todo, después de Acciones
    }
  }

  // Badge de visibilidad en el planning para la tabla.
  function planningCelda(a) {
    return a.quitar_planning
      ? '<span class="badge-estado inactivo">Oculto</span>'
      : '<span class="badge-estado activo">Visible</span>';
  }

  // ---- Indicador de limpieza (compartido ficha + tabla) ----
  function limpiezaBadgeHTML(estado, clic) {
    const sucio = estado === 'sucio';
    const cls = `alo-limp-badge ${sucio ? 'sucio' : 'limpio'}${clic ? ' alo-limp-clic' : ''}`;
    return `<span class="${cls}"${clic ? ' title="Clic para cambiar estado de limpieza"' : ''}><span class="alo-limp-punto"></span>${sucio ? 'Sucio' : 'Limpio'}</span>`;
  }

  // Celda de limpieza para la tabla (badge clicable que alterna el estado).
  function limpiezaCelda(a) {
    const estado = limpDeApto(a);
    const sucio = estado === 'sucio';
    return `<span class="alo-limp-badge alo-limp-clic ${sucio ? 'sucio' : 'limpio'}" data-limp="${a.id}" data-limp-estado="${estado}" title="Clic para cambiar estado de limpieza"><span class="alo-limp-punto"></span>${sucio ? 'Sucio' : 'Limpio'}</span>`;
  }

  // Alterna el estado de limpieza. limpio→sucio pide confirmación; sucio→limpio no.
  async function cambiarLimpieza(id, estadoActual) {
    const nuevo = estadoActual === 'sucio' ? 'limpio' : 'sucio';
    if (nuevo === 'sucio' && !confirm('¿Marcar como sucio?')) return;
    try {
      await API.put(`/api/apartamentos/${id}/limpieza`, { estado_limpieza: nuevo });
    } catch (e) { return toast(e.message, 'error'); }
    // Actualiza la caché de la tabla y repinta.
    const apt = todos.find((a) => String(a.id) === String(id));
    if (apt) apt.estado_limpieza = nuevo;
    aplicarFiltros();
    // Actualiza el indicador de la ficha si está abierta para ese apartamento.
    if (fichaActual && String(fichaActual.id) === String(id)) {
      fichaActual.estado_limpieza = nuevo;
      const ind = document.getElementById('alo-limp-indicador');
      if (ind) ind.innerHTML = limpiezaBadgeHTML(nuevo, true);
    }
    toast(nuevo === 'sucio' ? 'Marcado como sucio' : 'Marcado como limpio', 'ok');
  }

  // Clasificación de un apartamento ('__sin__' si no tiene).
  function clasDeApto(a) { return a.tipo_clasificacion || '__sin__'; }
  // Estado de limpieza ('limpio' por defecto si está vacío).
  function limpDeApto(a) { return a.estado_limpieza === 'sucio' ? 'sucio' : 'limpio'; }
  function tieneProp(a) { return (a.propietarios || []).length > 0; }

  // ---- ¿Cada grupo está en su valor por defecto? ----
  function clasDefault() { return fClas.size === CLASIF_FILTRO.length; }
  function limpDefault() { return fLimp.size === LIMPIEZA_FILTRO.length; }

  // Número de grupos de filtros activos (distintos al default) — para el badge.
  function filtrosActivos() {
    return [!clasDefault(), !limpDefault(), fProp !== 'todos', fPlanning !== 'todos']
      .filter(Boolean).length;
  }

  // ---- Filtrado en cliente (búsqueda + filtros, combinados) ----
  function filtrar() {
    const aplicaClas = !clasDefault();
    const aplicaLimp = !limpDefault();
    const q = busqueda.toLowerCase();
    return todos.filter((a) => {
      if (q && !(a.nombre || '').toLowerCase().includes(q)) return false;
      if (aplicaClas && !fClas.has(clasDeApto(a))) return false;
      if (aplicaLimp && !fLimp.has(limpDeApto(a))) return false;
      if (fProp === 'con' && !tieneProp(a)) return false;
      if (fProp === 'sin' && tieneProp(a)) return false;
      if (fPlanning === 'visible' && a.quitar_planning) return false;
      if (fPlanning === 'excluido' && !a.quitar_planning) return false;
      return true;
    });
  }

  function renderTabla(lista) {
    const tbody = document.querySelector('#tabla-alojamientos tbody');
    tbody.innerHTML = '';
    if (!todos.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="color:#6b7280">No hay alojamientos todavía.</td></tr>';
      return;
    }
    if (!lista.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="color:#6b7280;text-align:center;padding:24px">No hay alojamientos con los filtros actuales.</td></tr>';
      return;
    }
    for (const a of lista) {
      // Propietarios activos (relación N:M) separados por coma.
      const propietario = (a.propietarios || [])
        .map((p) => [p.nombre, p.apellidos].filter(Boolean).join(' '))
        .join(', ');
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="enlace-fila" data-ficha="${a.id}">${esc(a.nombre)}</span></td>
        <td>${badgeClasif(a.tipo_clasificacion)}</td>
        <td>${esc(propietario) || '—'}</td>
        <td>${planningCelda(a)}</td>
        <td class="acciones">
          <button class="btn-mini" data-editar="${a.id}">Editar</button>
          <button class="btn-mini" data-borrar="${a.id}">Eliminar</button>
        </td>
        <td>${limpiezaCelda(a)}</td>`;
      tbody.appendChild(tr);
    }
    tbody.querySelectorAll('[data-limp]').forEach((el) =>
      el.addEventListener('click', (e) => { e.stopPropagation(); cambiarLimpieza(el.dataset.limp, el.dataset.limpEstado); }));
    tbody.querySelectorAll('[data-ficha]').forEach((el) =>
      el.addEventListener('click', () => abrirFicha(el.dataset.ficha)));
    tbody.querySelectorAll('[data-editar]').forEach((el) =>
      el.addEventListener('click', () => formulario(el.dataset.editar)));
    tbody.querySelectorAll('[data-borrar]').forEach((el) =>
      el.addEventListener('click', () => borrar(el.dataset.borrar)));
  }

  // Redibuja la tabla + actualiza badge, "Limpiar filtros" y contador "Mostrando X de Y".
  function aplicarFiltros() {
    const lista = filtrar();
    renderTabla(lista);
    const n = filtrosActivos();
    const badge = document.getElementById('alo-filtros-badge');
    if (badge) { badge.textContent = n; badge.classList.toggle('oculto', n === 0); }
    document.getElementById('alo-limpiar')?.classList.toggle('oculto', n === 0 && !busqueda);
    const cont = document.getElementById('alo-contador');
    if (cont) cont.textContent = `Mostrando ${lista.length} de ${todos.length} alojamientos`;
  }

  // ==================== Barra de filtros (inyectada por JS) ====================
  function construirFiltros() {
    const vista = document.getElementById('vista-alojamientos');
    if (!vista || document.getElementById('alo-filtros-btn')) return;
    const barraHerr = vista.querySelector('.barra-herramientas');
    const tablaScroll = vista.querySelector('.tabla-scroll');
    if (!barraHerr || !tablaScroll) return;

    const grupoCheck = (titulo, contId, items) => `
      <div class="rsv-f-grupo">
        <div class="rsv-f-titulo">${titulo}</div>
        <div class="rsv-f-todos" data-todos="${contId}">Seleccionar / deseleccionar todos</div>
        <div class="rsv-f-ops" id="${contId}">${items}</div>
      </div>`;

    const clasItems = CLASIF_FILTRO.map((c) => `
      <label class="rsv-f-op"><input type="checkbox" data-grupo="clas" value="${c.key}" checked>
        ${c.key === '__sin__' ? '<span class="rsv-f-op-label">Sin clasificar</span>'
          : `<span class="badge-clasif ${c.clase}">${c.key}</span>`}</label>`).join('');

    const limpItems = LIMPIEZA_FILTRO.map((c) => `
      <label class="rsv-f-op"><input type="checkbox" data-grupo="limp" value="${c.key}" checked>
        <span class="rsv-f-op-label">${c.label}</span></label>`).join('');

    const barra = document.createElement('div');
    barra.className = 'reservas-controles alo-controles';
    barra.innerHTML = `
      <input type="search" id="alo-buscar" class="input-buscar" placeholder="Buscar por nombre..." autocomplete="off">
      <div class="rsv-filtros-wrap">
        <button id="alo-filtros-btn" class="btn-sec">🔽 Filtros <span id="alo-filtros-badge" class="rsv-filtros-badge oculto"></span></button>
        <div id="alo-filtros-panel" class="rsv-filtros-panel oculto">
          ${grupoCheck('Tipo de apartamento', 'alo-f-clas', clasItems)}
          ${grupoCheck('Estado de limpieza', 'alo-f-limp', limpItems)}
          <div class="rsv-f-grupo">
            <div class="rsv-f-titulo">Tiene propietario</div>
            <select id="alo-f-prop" class="select-filtro">
              <option value="todos">Todos</option>
              <option value="con">Con propietario</option>
              <option value="sin">Sin propietario</option>
            </select>
          </div>
          <div class="rsv-f-grupo">
            <div class="rsv-f-titulo">Visible en planning</div>
            <select id="alo-f-planning" class="select-filtro">
              <option value="todos">Todos</option>
              <option value="visible">Visible</option>
              <option value="excluido">Excluido</option>
            </select>
          </div>
        </div>
      </div>
      <button id="alo-limpiar" class="btn-sec rsv-limpiar oculto">Limpiar filtros</button>`;

    const contador = document.createElement('div');
    contador.id = 'alo-contador';
    contador.className = 'alo-contador';

    vista.insertBefore(barra, tablaScroll);
    vista.insertBefore(contador, tablaScroll);

    conectarFiltros(barra);
  }

  function setDeGrupo(grupo) { return grupo === 'clas' ? fClas : fLimp; }

  function conectarFiltros(barra) {
    const btn = barra.querySelector('#alo-filtros-btn');
    const panel = barra.querySelector('#alo-filtros-panel');

    const abrir = (v) => panel.classList.toggle('oculto', !v);
    btn.addEventListener('click', (e) => { e.stopPropagation(); abrir(panel.classList.contains('oculto')); });
    panel.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => abrir(false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') abrir(false); });

    // Buscador en tiempo real.
    barra.querySelector('#alo-buscar').addEventListener('input', (e) => {
      busqueda = e.target.value.trim();
      aplicarFiltros();
    });

    // Checkboxes (delegación): actualizan el Set del grupo correspondiente.
    panel.addEventListener('change', (e) => {
      const chk = e.target.closest('input[type="checkbox"][data-grupo]');
      if (!chk) return;
      const set = setDeGrupo(chk.dataset.grupo);
      if (chk.checked) set.add(chk.value); else set.delete(chk.value);
      aplicarFiltros();
    });

    // "Seleccionar / deseleccionar todos" por grupo.
    panel.querySelectorAll('.rsv-f-todos').forEach((el) =>
      el.addEventListener('click', () => {
        const cont = document.getElementById(el.dataset.todos);
        const checks = [...cont.querySelectorAll('input[type="checkbox"]')];
        const marcarTodos = !checks.every((c) => c.checked);
        const set = setDeGrupo(checks[0]?.dataset.grupo);
        if (!set) return;
        checks.forEach((c) => { c.checked = marcarTodos; if (marcarTodos) set.add(c.value); else set.delete(c.value); });
        aplicarFiltros();
      }));

    // Single selects.
    panel.querySelector('#alo-f-prop').addEventListener('change', (e) => { fProp = e.target.value; aplicarFiltros(); });
    panel.querySelector('#alo-f-planning').addEventListener('change', (e) => { fPlanning = e.target.value; aplicarFiltros(); });

    barra.querySelector('#alo-limpiar').addEventListener('click', resetFiltros);
  }

  function resetFiltros() {
    fClas = new Set(CLASIF_FILTRO.map((c) => c.key));
    fLimp = new Set(LIMPIEZA_FILTRO.map((c) => c.key));
    fProp = 'todos';
    fPlanning = 'todos';
    busqueda = '';
    document.querySelectorAll('#alo-filtros-panel input[type="checkbox"]').forEach((c) => { c.checked = true; });
    const selProp = document.getElementById('alo-f-prop'); if (selProp) selProp.value = 'todos';
    const selPlan = document.getElementById('alo-f-planning'); if (selPlan) selPlan.value = 'todos';
    const buscar = document.getElementById('alo-buscar'); if (buscar) buscar.value = '';
    aplicarFiltros();
  }

  // ==================== Panel lateral ====================
  function crearPanel() {
    if (document.getElementById('alo-panel')) return;
    const fondo = document.createElement('div');
    fondo.id = 'alo-panel-fondo';
    fondo.className = 'panel-fondo';
    const panel = document.createElement('aside');
    panel.id = 'alo-panel';
    panel.className = 'panel-lateral';
    panel.setAttribute('aria-label', 'Ficha de alojamiento');
    panel.innerHTML = `
      <header class="panel-cabecera">
        <div class="rsv-titulo-grupo">
          <h3 id="alo-titulo">Alojamiento</h3>
          <span id="alo-badges"></span>
        </div>
        <div class="panel-cabecera-acciones">
          <button id="alo-editar" class="btn-sec">Editar</button>
          <button id="alo-cerrar" class="panel-cerrar" title="Cerrar">&times;</button>
        </div>
      </header>
      <div class="rsv-subtabs" id="alo-subtabs">
        <button class="rsv-subtab activo" data-asub="alojamiento">Alojamiento</button>
        <button class="rsv-subtab" data-asub="propietario">Propietario</button>
        <button class="rsv-subtab" data-asub="gastos">Gastos</button>
        <button class="rsv-subtab" data-asub="pagos">💳 Pagos propietario</button>
        <button class="rsv-subtab" data-asub="galeria">Galería</button>
        <button class="rsv-subtab" data-asub="calendario">Calendario</button>
        <button class="rsv-subtab" data-asub="mantenimiento">Mantenimiento</button>
      </div>
      <div id="alo-cuerpo" class="panel-cuerpo"></div>`;
    document.body.appendChild(fondo);
    document.body.appendChild(panel);

    fondo.addEventListener('click', cerrarPanel);
    panel.querySelector('#alo-cerrar').addEventListener('click', cerrarPanel);
    panel.querySelector('#alo-editar').addEventListener('click', () => { if (fichaActual) formulario(fichaActual.id); });
    panel.querySelectorAll('.rsv-subtab').forEach((b) =>
      b.addEventListener('click', () => activarSub(b.dataset.asub)));
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const modalAbierto = !document.getElementById('modal-fondo').classList.contains('oculto');
      const lightboxAbierto = document.getElementById('alo-lightbox')?.classList.contains('abierto');
      const popLimp = document.getElementById('alo-limp-pop');
      const popAbierto = popLimp && !popLimp.classList.contains('oculto');
      if (popAbierto) { e.stopPropagation(); cerrarHistLimpieza(); return; }
      if (!modalAbierto && !lightboxAbierto && panel.classList.contains('abierto')) cerrarPanel();
    }, true);
  }
  function abrirPanel() {
    document.getElementById('alo-panel-fondo').classList.add('abierto');
    document.getElementById('alo-panel').classList.add('abierto');
  }
  function cerrarPanel() {
    document.getElementById('alo-panel-fondo').classList.remove('abierto');
    document.getElementById('alo-panel').classList.remove('abierto');
    fichaActual = null;
  }
  function activarSub(sub) {
    document.querySelectorAll('#alo-subtabs .rsv-subtab').forEach((b) =>
      b.classList.toggle('activo', b.dataset.asub === sub));
    document.querySelectorAll('#alo-cuerpo .rsv-subpanel').forEach((p) =>
      p.classList.toggle('activo', p.dataset.asubpanel === sub));
    if (sub === 'propietario' && !propTabCargada) renderPropietario();
    if (sub === 'gastos' && !gastosCargados) cargarGastos();
    if (sub === 'pagos' && !pagosCargados) cargarPagos();
    if (sub === 'galeria' && !galeriaCargada) cargarGaleria();
    if (sub === 'calendario' && !calCargado) cargarCalendario();
    if (sub === 'mantenimiento' && !mantCargado) cargarMantenimiento();
  }

  async function abrirFicha(id) {
    crearPanel();
    try {
      fichaActual = await API.get('/api/apartamentos/' + id);
    } catch (e) {
      return toast(e.message, 'error');
    }
    propTabCargada = false;
    gastosCargados = false;
    pagosCargados = false;
    galeriaCargada = false;
    calCargado = false;
    mantCargado = false;
    if (!ANIOS_GASTO.includes(gastoAnio)) gastoAnio = ANIOS_GASTO[ANIOS_GASTO.length - 1];
    if (!ANIOS_GASTO.includes(pagoAnio)) pagoAnio = ANIOS_GASTO[ANIOS_GASTO.length - 1];
    document.getElementById('alo-titulo').textContent = fichaActual.nombre || 'Alojamiento';
    document.getElementById('alo-badges').innerHTML = badgesCabecera(fichaActual);
    renderCuerpo();
    activarSub('alojamiento');
    abrirPanel();
    cargarRecaudacion(fichaActual.id);
  }

  function dato(etq, valor, anchoTotal) {
    return `<div class="campo-ficha${anchoTotal ? ' ancho-total' : ''}"><div class="etq">${etq}</div><div class="val">${valor}</div></div>`;
  }

  function renderCuerpo() {
    document.getElementById('alo-cuerpo').innerHTML = `
      <div class="rsv-subpanel activo" data-asubpanel="alojamiento">${alojamientoHTML()}</div>
      <div class="rsv-subpanel" data-asubpanel="propietario"><div id="alo-prop-cont"></div></div>
      <div class="rsv-subpanel" data-asubpanel="gastos">${gastosShellHTML()}</div>
      <div class="rsv-subpanel" data-asubpanel="pagos">${pagosShellHTML()}</div>
      <div class="rsv-subpanel" data-asubpanel="galeria">${galeriaShellHTML()}</div>
      <div class="rsv-subpanel" data-asubpanel="calendario">${calendarioShellHTML()}</div>
      <div class="rsv-subpanel" data-asubpanel="mantenimiento">${mantenimientoShellHTML()}</div>`;

    const wt = document.querySelector('#alo-cuerpo [data-wifi-toggle]');
    if (wt) wt.addEventListener('click', () => {
      const s = document.getElementById('alo-wifi');
      const real = s.dataset.val || '';
      if (s.dataset.shown === '1') { s.textContent = real ? '••••••••' : '—'; s.dataset.shown = '0'; }
      else { s.textContent = real || '—'; s.dataset.shown = '1'; }
    });

    const selAnio = document.getElementById('alo-gasto-anio');
    if (selAnio) selAnio.addEventListener('change', (e) => { gastoAnio = Number(e.target.value); cargarGastos(); });
    const btnAdd = document.getElementById('alo-gasto-add');
    if (btnAdd) btnAdd.addEventListener('click', modalAnadirGasto);

    const pagoSelAnio = document.getElementById('alo-pago-anio');
    if (pagoSelAnio) pagoSelAnio.addEventListener('change', (e) => { pagoAnio = Number(e.target.value); cargarPagos(); });
    const pagoAdd = document.getElementById('alo-pago-add');
    if (pagoAdd) pagoAdd.addEventListener('click', modalAnadirPago);

    const calSelAnio = document.getElementById('alo-cal-anio');
    if (calSelAnio) calSelAnio.addEventListener('change', (e) => { calAnio = Number(e.target.value); cargarCalendario(); });

    const mantSelAnio = document.getElementById('alo-mant-anio');
    if (mantSelAnio) mantSelAnio.addEventListener('change', (e) => { mantAnio = Number(e.target.value); cargarMantenimiento(); });
    const mantAdd = document.getElementById('alo-mant-add');
    if (mantAdd) mantAdd.addEventListener('click', () => {
      if (fichaActual && typeof Mantenimiento !== 'undefined' && Mantenimiento.nuevaTareaPara) {
        Mantenimiento.nuevaTareaPara(fichaActual.id);
      }
    });

    const limpInd = document.getElementById('alo-limp-indicador');
    if (limpInd) limpInd.addEventListener('click', () => { if (fichaActual) cambiarLimpieza(fichaActual.id, limpDeApto(fichaActual)); });
    const limpHist = document.getElementById('alo-limp-hist-btn');
    if (limpHist) limpHist.addEventListener('click', (e) => { e.stopPropagation(); toggleHistLimpieza(); });
  }

  // ---- Historial de limpieza (popover) ----
  function fechaHoraLog(s) {
    if (!s) return '—';
    const [d, t] = String(s).split(' ');
    const p = d.split('-');
    if (p.length !== 3) return s;
    return `${p[2]}/${p[1]}/${p[0]}${t ? ' ' + t.slice(0, 5) : ''}`;
  }
  async function toggleHistLimpieza() {
    const pop = document.getElementById('alo-limp-pop');
    if (!pop) return;
    if (!pop.classList.contains('oculto')) { cerrarHistLimpieza(); return; }
    pop.innerHTML = '<div class="alo-limp-pop-cargando">Cargando…</div>';
    pop.classList.remove('oculto');
    setTimeout(() => document.addEventListener('click', cerrarHistFuera), 0);
    let log = [];
    try { log = await API.get(`/api/apartamentos/${fichaActual.id}/limpieza-log`); }
    catch (e) { log = []; }
    if (pop.classList.contains('oculto')) return; // se cerró mientras cargaba
    renderHistLimpieza(log);
  }
  function renderHistLimpieza(log) {
    const pop = document.getElementById('alo-limp-pop');
    if (!pop) return;
    if (!log.length) { pop.innerHTML = '<div class="alo-limp-pop-vacio">Sin cambios registrados</div>'; return; }
    const items = log.slice(0, 20).map((l) => {
      const sucio = l.estado_nuevo === 'sucio';
      return `<div class="alo-limp-pop-item">${sucio ? '🔴' : '🟢'} ${sucio ? 'Sucio' : 'Limpio'} — ${esc(l.usuario_nombre) || '—'} — ${fechaHoraLog(l.fecha)}</div>`;
    }).join('');
    pop.innerHTML = items;
  }
  function cerrarHistLimpieza() {
    const pop = document.getElementById('alo-limp-pop');
    if (pop) pop.classList.add('oculto');
    document.removeEventListener('click', cerrarHistFuera);
  }
  function cerrarHistFuera(e) {
    const wrap = document.querySelector('.alo-limp-wrap');
    if (wrap && !wrap.contains(e.target)) cerrarHistLimpieza();
  }

  function wifiDato(a) {
    const val = a.pwd_wifi || '';
    const masked = val ? '••••••••' : '—';
    const btn = val ? ' <button type="button" class="alo-wifi-btn" data-wifi-toggle title="Mostrar/ocultar">👁</button>' : '';
    return `<div class="campo-ficha"><div class="etq">Pwd Wifi</div><div class="val"><span id="alo-wifi" data-val="${esc(val)}" data-shown="0">${masked}</span>${btn}</div></div>`;
  }

  function alojamientoHTML() {
    const a = fichaActual;
    const generales = [
      dato('Nombre', v(a.nombre)),
      dato('Tipo clasificación', a.tipo_clasificacion ? badgeClasif(a.tipo_clasificacion) : '—'),
      dato('Orientación', v(a.orientacion)), dato('Situación', v(a.situacion)),
      dato('Escalera', v(a.escalera)), dato('Piso', v(a.piso)),
      dato('Puerta', v(a.puerta)),
      dato('Capacidad', a.capacidad != null && a.capacidad !== '' ? a.capacidad : '—'), dato('Parking', v(a.parking)),
      dato('Ref. Catastral', v(a.ref_catastral)), dato('Licencia Turística', v(a.licencia_turistica)),
      dato('NRA', v(a.nra)), wifiDato(a),
    ].join('');

    const planning = a.quitar_planning
      ? '<span class="badge-estado inactivo">Excluido del planning</span>'
      : '<span class="badge-estado activo">Visible en planning</span>';

    const estadoLimp = limpDeApto(a);
    return `
      <div class="ficha-seccion-head">
        <div class="ficha-seccion-titulo">Datos generales</div>
        <div class="alo-limp-wrap">
          <span id="alo-limp-indicador" class="alo-limp-clic-cont">${limpiezaBadgeHTML(estadoLimp, true)}</span>
          <button id="alo-limp-hist-btn" class="alo-limp-hist-btn" title="Ver historial">🕐</button>
          <div id="alo-limp-pop" class="alo-limp-pop oculto"></div>
        </div>
      </div>
      <div class="ficha-grid">${generales}</div>

      <div class="ficha-seccion-titulo">Configuración</div>
      <div class="ficha-grid">
        ${dato('Quitar planning', planning)}
        ${dato('Notas', a.notas ? esc(a.notas) : '—', true)}
      </div>

      <div class="ficha-seccion-titulo">Recaudación del año (${new Date().getFullYear()})</div>
      <div id="alo-recaudacion"><div class="alo-mini-cards">${skeletonMini()}</div></div>`;
  }

  function miniCard(valor, label) {
    return `<div class="alo-mini-card"><div class="alo-mini-valor">${valor}</div><div class="alo-mini-label">${esc(label)}</div></div>`;
  }
  function skeletonMini() {
    return '<div class="alo-mini-card"><span class="skeleton sk-linea" style="width:60%;display:block"></span><span class="skeleton sk-linea" style="width:80%;display:block;margin-top:8px"></span></div>'.repeat(4);
  }

  async function cargarRecaudacion(id) {
    const anio = new Date().getFullYear();
    let data;
    try {
      data = await API.get(`/api/estadisticas/apartamentos?anio=${anio}&apartamento_id=${id}`);
    } catch (e) {
      const c = document.getElementById('alo-recaudacion');
      if (c) c.innerHTML = '<div style="color:var(--muted);padding:8px 0">No se pudo cargar la recaudación.</div>';
      return;
    }
    const c = document.getElementById('alo-recaudacion');
    if (!c || !fichaActual || String(fichaActual.id) !== String(id)) return; // la ficha cambió
    const ap = data.apartamento || {};
    if (!ap.total_reservas) {
      c.innerHTML = `<div style="color:var(--muted);padding:8px 0">Sin reservas en ${anio}</div>`;
      return;
    }
    c.innerHTML = `
      <div class="alo-mini-cards">
        ${miniCard(num(ap.total_reservas), 'Reservas')}
        ${miniCard(num(ap.noches_ocupadas), 'Noches ocupadas')}
        ${miniCard(pct1(ap.porcentaje_ocupacion), '% Ocupación')}
        ${miniCard(euro(ap.ingresos_netos), 'Ingresos netos')}
      </div>`;
  }

  // ==================== Pestaña Propietario: gestión N:M con histórico ====================
  function nombreRel(r) { return [r.nombre, r.apellidos].filter(Boolean).join(' '); }
  function inicialRel(r) { return (r.nombre || r.apellidos || '?').trim().charAt(0).toUpperCase(); }
  // Color estable a partir del nombre (hash -> matiz HSL, igual que en propietarios.js).
  function colorAvatarRel(r) {
    const s = (r.nombre || '') + (r.apellidos || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
    return `hsl(${Math.abs(h) % 360}, 52%, 52%)`;
  }
  function pctTxt(n) { return (Number(n) || 0).toLocaleString('es-ES', { maximumFractionDigits: 2 }) + '%'; }
  function sumaActivos() {
    return relaciones.filter((r) => r.activo === 1).reduce((s, r) => s + (Number(r.porcentaje) || 0), 0);
  }
  // Clase de color según la suma de porcentajes: ok (=100) / aviso (<100) / error (>100).
  function clasePorSuma(suma) {
    if (Math.abs(suma - 100) <= 0.01) return 'ok';
    return suma < 100 ? 'aviso' : 'error';
  }

  async function renderPropietario() {
    const cont = document.getElementById('alo-prop-cont');
    if (!cont) return;
    const id = fichaActual && fichaActual.id;
    if (id == null) return;
    cont.innerHTML = '<div style="color:var(--muted);padding:8px 0">Cargando propietarios…</div>';
    try {
      relaciones = await API.get(`/api/apartamentos/${id}/propietarios`);
    } catch (e) {
      cont.innerHTML = '<div style="color:var(--muted);padding:8px 0">No se pudieron cargar los propietarios.</div>';
      return;
    }
    if (!fichaActual || String(fichaActual.id) !== String(id)) return; // la ficha cambió
    propTabCargada = true;

    const activos = relaciones.filter((r) => r.activo === 1);
    const historico = relaciones.filter((r) => r.activo !== 1)
      .sort((a, b) => String(b.fecha_fin || '').localeCompare(String(a.fecha_fin || '')));
    const suma = sumaActivos();
    const clase = clasePorSuma(suma);

    const cards = activos.map((r) => `
      <div class="alo-prop-card">
        <span class="avatar" style="background:${colorAvatarRel(r)}">${esc(inicialRel(r))}</span>
        <div class="alo-prop-info">
          <div class="alo-prop-nombre">${esc(nombreRel(r))}</div>
          <div class="alo-prop-sub">${[r.email, r.telefono].filter(Boolean).map(esc).join(' · ') || '—'}</div>
          <div class="alo-prop-sub">Desde ${fechaES(r.fecha_inicio)}</div>
        </div>
        <span class="alo-prop-pct ${clase}">${pctTxt(r.porcentaje)}</span>
        <div class="alo-prop-acciones">
          <button class="btn-mini" data-ver-prop="${r.propietario_id}">Ver ficha</button>
          <button class="btn-mini" data-editar-rel="${r.id}" title="Editar porcentaje">✏️</button>
          <button class="btn-mini" data-cerrar-rel="${r.id}" title="Cerrar relación">🔒</button>
        </div>
      </div>`).join('');

    const aviso = (activos.length && clase !== 'ok')
      ? `<div class="alo-prop-aviso">⚠️ Los porcentajes actuales suman ${pctTxt(suma).replace('%', '')}%, deben sumar 100%</div>`
      : '';

    const histCards = historico.map((r) => `
      <div class="alo-prop-card hist">
        <span class="avatar" style="background:${colorAvatarRel(r)}">${esc(inicialRel(r))}</span>
        <div class="alo-prop-info">
          <div class="alo-prop-nombre">${esc(nombreRel(r))}</div>
          <div class="alo-prop-sub">Desde ${fechaES(r.fecha_inicio)}${r.fecha_fin ? ' hasta ' + fechaES(r.fecha_fin) : ''}</div>
        </div>
        <span class="alo-prop-pct hist">${pctTxt(r.porcentaje)}</span>
        <div class="alo-prop-acciones">
          <button class="btn-mini" data-ver-prop="${r.propietario_id}">Ver ficha</button>
        </div>
      </div>`).join('');

    const histHTML = historico.length ? `
      <button class="alo-prop-hist-btn" id="alo-hist-toggle">▶ Ver histórico (${historico.length} anterior${historico.length === 1 ? '' : 'es'})</button>
      <div id="alo-hist-lista" class="oculto">${histCards}</div>` : '';

    cont.innerHTML = `
      <div class="alo-prop-head">
        <div class="alo-prop-titulo">Propietarios <span class="alo-prop-count">${activos.length}</span></div>
        <button class="btn-pri" id="alo-prop-add">＋ Añadir propietario</button>
      </div>
      <div class="ficha-seccion-titulo">Propietarios actuales</div>
      ${aviso}
      ${cards || '<div style="color:var(--muted);padding:8px 0">Sin propietarios asignados</div>'}
      ${histHTML ? '<div class="ficha-seccion-titulo">Histórico</div>' + histHTML : ''}`;

    document.getElementById('alo-prop-add').addEventListener('click', modalAnadirPropietario);
    const ht = document.getElementById('alo-hist-toggle');
    if (ht) ht.addEventListener('click', () => {
      const lista = document.getElementById('alo-hist-lista');
      const abierto = !lista.classList.toggle('oculto');
      ht.textContent = `${abierto ? '▼ Ocultar' : '▶ Ver'} histórico (${historico.length} anterior${historico.length === 1 ? '' : 'es'})`;
    });
    cont.querySelectorAll('[data-ver-prop]').forEach((b) =>
      b.addEventListener('click', () => {
        cerrarPanel();
        if (typeof activarTab === 'function') activarTab('propietarios');
        if (typeof Propietarios !== 'undefined' && Propietarios.abrirFicha) Propietarios.abrirFicha(b.dataset.verProp);
      }));
    cont.querySelectorAll('[data-editar-rel]').forEach((b) =>
      b.addEventListener('click', () => modalEditarPorcentaje(Number(b.dataset.editarRel))));
    cont.querySelectorAll('[data-cerrar-rel]').forEach((b) =>
      b.addEventListener('click', () => modalCerrarRelacion(Number(b.dataset.cerrarRel))));
  }

  // Tras cambiar relaciones: repinta la pestaña y refresca la tabla (columna Propietario).
  async function refrescarRelaciones() {
    await renderPropietario();
    cargar();
  }

  // ---- Modal "Añadir propietario" ----
  async function modalAnadirPropietario() {
    const apto = fichaActual;
    try { propietarios = await API.get('/api/propietarios'); } catch (e) { propietarios = []; }
    propSelId = null;
    const suma = sumaActivos();
    const hayActivos = relaciones.some((r) => r.activo === 1);
    const sugerido = hayActivos ? Math.max(0, Math.round((100 - suma) * 100) / 100) : 100;
    const hoy = new Date().toISOString().slice(0, 10);

    abrirModal(`
      <h3>Añadir propietario</h3>
      <div class="campo cnt-typeahead">
        <label>Propietario *</label>
        <input id="ap-buscar" placeholder="Buscar propietario..." autocomplete="off">
        <div class="cnt-ta-dropdown oculto" id="ap-dropdown"></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Porcentaje (%)</label><input type="number" id="ap-pct" step="0.01" min="0.01" max="100" value="${sugerido}"></div>
        <div class="campo"><label>Fecha inicio</label><input type="date" id="ap-fecha" value="${hoy}"></div>
      </div>
      <div class="campo"><label>Notas</label><textarea id="ap-notas"></textarea></div>
      <div id="ap-resumen" class="alo-prop-resumen"></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="ap-cancelar">Cancelar</button>
        <button class="btn-pri" id="ap-guardar">Guardar</button>
      </div>`);

    initRelTypeahead();
    const actualizarResumen = () => {
      const el = document.getElementById('ap-resumen');
      const pct = parseFloat(document.getElementById('ap-pct').value) || 0;
      const nueva = suma + pct;
      el.className = 'alo-prop-resumen ' + clasePorSuma(nueva);
      el.textContent = `Con este propietario la suma quedará en ${pctTxt(nueva).replace('%', '')}%`;
    };
    document.getElementById('ap-pct').addEventListener('input', actualizarResumen);
    actualizarResumen();
    document.getElementById('ap-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('ap-guardar').addEventListener('click', async () => {
      if (!propSelId) return toast('Selecciona un propietario', 'error');
      const body = {
        propietario_id: propSelId,
        porcentaje: val('ap-pct'),
        fecha_inicio: val('ap-fecha'),
        notas: val('ap-notas'),
      };
      try {
        const r = await API.post(`/api/apartamentos/${apto.id}/propietarios`, body);
        cerrarModal();
        if (r && r.aviso) toast(r.aviso, 'aviso');
        else toast('Propietario añadido', 'ok');
        await refrescarRelaciones();
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  // ---- Modal "Editar %" ----
  function modalEditarPorcentaje(relId) {
    const rel = relaciones.find((r) => r.id === relId);
    if (!rel) return;
    const sumaOtros = sumaActivos() - (Number(rel.porcentaje) || 0);

    abrirModal(`
      <h3>Editar porcentaje</h3>
      <div class="campo"><label>Propietario</label><input value="${esc(nombreRel(rel))}" disabled></div>
      <div class="campo"><label>Porcentaje (%)</label><input type="number" id="ep-pct" step="0.01" min="0.01" max="100" value="${rel.porcentaje}"></div>
      <div class="campo"><label>Notas</label><textarea id="ep-notas">${esc(rel.notas)}</textarea></div>
      <div id="ep-resumen" class="alo-prop-resumen"></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="ep-cancelar">Cancelar</button>
        <button class="btn-pri" id="ep-guardar">Guardar</button>
      </div>`);

    const actualizarResumen = () => {
      const el = document.getElementById('ep-resumen');
      const pct = parseFloat(document.getElementById('ep-pct').value) || 0;
      const nueva = sumaOtros + pct;
      el.className = 'alo-prop-resumen ' + clasePorSuma(nueva);
      el.textContent = `Con este cambio la suma quedará en ${pctTxt(nueva).replace('%', '')}%`;
    };
    document.getElementById('ep-pct').addEventListener('input', actualizarResumen);
    actualizarResumen();
    document.getElementById('ep-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('ep-guardar').addEventListener('click', async () => {
      try {
        await API.put(`/api/apartamentos/${fichaActual.id}/propietarios/${relId}`, {
          porcentaje: val('ep-pct'),
          notas: val('ep-notas'),
        });
        cerrarModal();
        toast('Relación actualizada', 'ok');
        await refrescarRelaciones();
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  // ---- Modal "Cerrar relación" ----
  function modalCerrarRelacion(relId) {
    const rel = relaciones.find((r) => r.id === relId);
    if (!rel) return;
    const hoy = new Date().toISOString().slice(0, 10);

    abrirModal(`
      <h3>Cerrar relación</h3>
      <p>Vas a cerrar la relación de <strong>${esc(nombreRel(rel))}</strong> con este apartamento.</p>
      <div class="campo"><label>Fecha fin</label><input type="date" id="cr-fecha" value="${hoy}"></div>
      <div class="alo-prop-aviso">⚠️ Esta acción moverá al propietario al histórico. Si es el único propietario activo, el apartamento quedará sin propietario.</div>
      <div class="modal-acciones">
        <button class="btn-sec" id="cr-cancelar">Cancelar</button>
        <button class="btn-peligro" id="cr-confirmar">Confirmar cierre</button>
      </div>`);

    document.getElementById('cr-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('cr-confirmar').addEventListener('click', async () => {
      try {
        await API.post(`/api/apartamentos/${fichaActual.id}/propietarios/${relId}/cerrar`, {
          fecha_fin: val('cr-fecha'),
        });
        cerrarModal();
        toast('Relación cerrada', 'ok');
        await refrescarRelaciones();
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  // ---- Typeahead de propietario (modal "Añadir propietario") ----
  function initRelTypeahead() {
    const input = document.getElementById('ap-buscar');
    input.addEventListener('input', () => {
      propSelId = null;
      const q = input.value.trim();
      if (q.length < 2) { cerrarRelDrop(); return; }
      taMatches = buscarProp(q);
      taIndex = -1;
      renderRelDrop();
    });
    input.addEventListener('keydown', (e) => {
      const dd = document.getElementById('ap-dropdown');
      const abierto = dd && !dd.classList.contains('oculto');
      if (e.key === 'ArrowDown') { if (!abierto) return; e.preventDefault(); taIndex = Math.min(taIndex + 1, taMatches.length - 1); renderRelDrop(); scrollRel(); }
      else if (e.key === 'ArrowUp') { if (!abierto) return; e.preventDefault(); taIndex = Math.max(taIndex - 1, 0); renderRelDrop(); scrollRel(); }
      else if (e.key === 'Enter') { if (abierto && taIndex >= 0 && taMatches[taIndex]) { e.preventDefault(); seleccionarRelProp(taMatches[taIndex].id); } }
      else if (e.key === 'Escape') { if (abierto) { e.preventDefault(); e.stopPropagation(); cerrarRelDrop(); } }
    });
    input.addEventListener('blur', () => setTimeout(cerrarRelDrop, 120));
  }
  function buscarProp(q) {
    const s = q.toLowerCase();
    return propietarios.filter((p) =>
      nombrePropFull(p).toLowerCase().includes(s) || (p.email || '').toLowerCase().includes(s));
  }
  function renderRelDrop() {
    const dd = document.getElementById('ap-dropdown');
    if (!dd) return;
    if (!taMatches.length) { dd.innerHTML = '<div class="cnt-ta-vacio">Sin resultados</div>'; dd.classList.remove('oculto'); return; }
    dd.innerHTML = taMatches.map((p, i) => `
      <div class="cnt-ta-op${i === taIndex ? ' activo' : ''}" data-id="${p.id}">
        <span class="cnt-ta-nombre">${esc(nombrePropFull(p))}${p.email ? ` <span class="cnt-ta-edif">${esc(p.email)}</span>` : ''}</span>
      </div>`).join('');
    dd.classList.remove('oculto');
    dd.querySelectorAll('.cnt-ta-op').forEach((op) =>
      op.addEventListener('mousedown', (e) => { e.preventDefault(); seleccionarRelProp(Number(op.dataset.id)); }));
  }
  function scrollRel() {
    const act = document.querySelector('#ap-dropdown .cnt-ta-op.activo');
    if (act) act.scrollIntoView({ block: 'nearest' });
  }
  function seleccionarRelProp(pid) {
    propSelId = pid;
    const p = propietarios.find((x) => x.id === pid);
    document.getElementById('ap-buscar').value = p ? nombrePropFull(p) : '';
    cerrarRelDrop();
  }
  function cerrarRelDrop() {
    const dd = document.getElementById('ap-dropdown');
    if (dd) dd.classList.add('oculto');
    taIndex = -1;
  }

  // ==================== Pestaña Gastos ====================
  function gastosShellHTML() {
    const opts = ANIOS_GASTO.map((a) => `<option value="${a}"${a === gastoAnio ? ' selected' : ''}>${a}</option>`).join('');
    return `
      <div class="alo-gastos-head">
        <div class="alo-gastos-head-left">
          <select id="alo-gasto-anio" class="select-filtro">${opts}</select>
          <span id="alo-gasto-total" class="alo-gasto-total-badge">Total ${gastoAnio}: ${euro(0)}</span>
        </div>
        <button id="alo-gasto-add" class="btn-pri">＋ Añadir gasto</button>
      </div>
      <div id="alo-gastos-tabla"></div>`;
  }

  function skeletonGastos() {
    return '<div style="display:flex;flex-direction:column;gap:10px">' +
      '<span class="skeleton sk-bloque"></span>'.repeat(4) + '</div>';
  }

  async function cargarGastos() {
    const id = fichaActual && fichaActual.id;
    if (id == null) return;
    gastosCargados = true;
    const cont = document.getElementById('alo-gastos-tabla');
    if (cont) cont.innerHTML = skeletonGastos();
    let data;
    try {
      data = await API.get(`/api/apartamentos/${id}/gastos?anio=${gastoAnio}`);
    } catch (e) {
      if (cont) cont.innerHTML = '<div style="color:var(--muted);padding:8px 0">No se pudieron cargar los gastos.</div>';
      return;
    }
    if (!fichaActual || String(fichaActual.id) !== String(id)) return; // la ficha cambió
    renderGastos(data);
  }

  function renderGastos(data) {
    const { gastos = [], total_anio = 0 } = data || {};
    const badge = document.getElementById('alo-gasto-total');
    if (badge) badge.textContent = `Total ${gastoAnio}: ${euro(total_anio)}`;
    const cont = document.getElementById('alo-gastos-tabla');
    if (!cont) return;
    if (!gastos.length) {
      cont.innerHTML = `<div style="color:var(--muted);padding:8px 0">Sin gastos registrados en ${gastoAnio}</div>`;
      return;
    }
    const filas = gastos.map((g) => {
      const cobrado = g.cobrado_propietario
        ? '<span class="badge-estado activo">Cobrado ✓</span>'
        : '<span class="badge-estado" style="background:#fff7ed;color:#c2410c">Pendiente</span>';
      const notas = g.notas ? ` <span class="alo-gasto-notas">${esc(g.notas)}</span>` : '';
      return `
        <tr>
          <td>${fechaES(g.fecha)}</td>
          <td>${esc(g.nombre)}${notas}</td>
          <td style="text-align:right;white-space:nowrap">${euro(g.precio)}</td>
          <td>${cobrado}</td>
          <td class="acciones">
            <button class="btn-mini" data-toggle-cobrado="${g.id}" data-estado="${g.cobrado_propietario ? 1 : 0}">${g.cobrado_propietario ? 'Desmarcar' : 'Marcar cobrado'}</button>
            <button class="btn-mini" data-borrar-gasto="${g.id}">Eliminar</button>
          </td>
        </tr>`;
    }).join('');
    cont.innerHTML = `
      <div class="tabla-scroll">
        <table class="tabla">
          <thead><tr><th>Fecha</th><th>Concepto</th><th style="text-align:right">Importe</th><th>Cobrado al propietario</th><th></th></tr></thead>
          <tbody>${filas}</tbody>
          <tfoot><tr class="est-fila-total"><td colspan="2">Total</td><td style="text-align:right;white-space:nowrap">${euro(total_anio)}</td><td colspan="2"></td></tr></tfoot>
        </table>
      </div>`;
    cont.querySelectorAll('[data-toggle-cobrado]').forEach((b) =>
      b.addEventListener('click', () => toggleCobrado(b.dataset.toggleCobrado, b.dataset.estado === '1')));
    cont.querySelectorAll('[data-borrar-gasto]').forEach((b) =>
      b.addEventListener('click', () => borrarGasto(b.dataset.borrarGasto)));
  }

  async function toggleCobrado(gastoId, estadoActual) {
    try {
      await API.put(`/api/apartamentos/${fichaActual.id}/gastos/${gastoId}`, { cobrado_propietario: estadoActual ? 0 : 1 });
      await cargarGastos();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function borrarGasto(gastoId) {
    if (!confirm('¿Eliminar este gasto?')) return;
    try {
      await API.del(`/api/apartamentos/${fichaActual.id}/gastos/${gastoId}`);
      await cargarGastos();
      toast('Gasto eliminado', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ---- Modal "Añadir gasto" ----
  async function modalAnadirGasto() {
    const apto = fichaActual;
    try { gastoCatList = (await API.get('/api/catalogo-gastos')).filter((c) => c.activo); }
    catch (e) { gastoCatList = []; }
    gastoCatSel = null;
    const hoy = new Date().toISOString().slice(0, 10);

    abrirModal(`
      <h3>Añadir gasto</h3>
      <div class="campo cnt-typeahead">
        <label>Concepto *</label>
        <input id="ag-concepto-buscar" placeholder="Buscar concepto..." autocomplete="off">
        <div class="cnt-ta-dropdown oculto" id="ag-concepto-dropdown"></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Fecha *</label><input type="date" id="ag-fecha" value="${hoy}"></div>
        <div class="campo">
          <label>Importe (€)</label>
          <input type="number" step="0.01" min="0" id="ag-importe" value="">
          <div id="ag-iva-desglose" style="font-size:12px;color:var(--muted);margin-top:6px"></div>
        </div>
      </div>
      <div class="campo"><label>Notas</label><textarea id="ag-notas"></textarea></div>
      <label class="toggle-campo"><input type="checkbox" id="ag-cobrado"><span>Cobrado al propietario</span></label>
      <div class="modal-acciones">
        <button class="btn-sec" id="ag-cancelar">Cancelar</button>
        <button class="btn-pri" id="ag-guardar">Guardar</button>
      </div>`);

    initConceptoTypeahead();
    document.getElementById('ag-importe').addEventListener('input', actualizarGastoIvaDesglose);
    document.getElementById('ag-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('ag-guardar').addEventListener('click', async () => {
      if (!gastoCatSel) return toast('Selecciona un concepto', 'error');
      const fecha = val('ag-fecha');
      if (!fecha) return toast('La fecha es obligatoria', 'error');
      const body = {
        catalogo_gasto_id: gastoCatSel,
        fecha,
        precio: val('ag-importe'),
        notas: val('ag-notas'),
        cobrado_propietario: document.getElementById('ag-cobrado').checked ? 1 : 0,
      };
      try {
        await API.post(`/api/apartamentos/${apto.id}/gastos`, body);
        cerrarModal();
        await cargarGastos();
        toast('Gasto añadido', 'ok');
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  // ---- Typeahead de concepto (modal de gasto) ----
  function initConceptoTypeahead() {
    const input = document.getElementById('ag-concepto-buscar');
    input.addEventListener('input', () => {
      gastoCatSel = null;
      actualizarGastoIvaDesglose(); // sin concepto seleccionado, se oculta
      const q = input.value.trim().toLowerCase();
      if (q.length < 2) { cerrarConceptoDrop(); return; }
      gtaMatches = gastoCatList.filter((c) => (c.nombre || '').toLowerCase().includes(q));
      gtaIndex = -1;
      renderConceptoDrop();
    });
    input.addEventListener('keydown', (e) => {
      const dd = document.getElementById('ag-concepto-dropdown');
      const abierto = dd && !dd.classList.contains('oculto');
      if (e.key === 'ArrowDown') { if (!abierto) return; e.preventDefault(); gtaIndex = Math.min(gtaIndex + 1, gtaMatches.length - 1); renderConceptoDrop(); }
      else if (e.key === 'ArrowUp') { if (!abierto) return; e.preventDefault(); gtaIndex = Math.max(gtaIndex - 1, 0); renderConceptoDrop(); }
      else if (e.key === 'Enter') { if (abierto && gtaIndex >= 0 && gtaMatches[gtaIndex]) { e.preventDefault(); seleccionarConcepto(gtaMatches[gtaIndex].id); } }
      else if (e.key === 'Escape') { if (abierto) { e.preventDefault(); e.stopPropagation(); cerrarConceptoDrop(); } }
    });
    input.addEventListener('blur', () => setTimeout(cerrarConceptoDrop, 120));
  }
  function renderConceptoDrop() {
    const dd = document.getElementById('ag-concepto-dropdown');
    if (!dd) return;
    if (!gtaMatches.length) { dd.innerHTML = '<div class="cnt-ta-vacio">Sin resultados</div>'; dd.classList.remove('oculto'); return; }
    dd.innerHTML = gtaMatches.map((c, i) => `
      <div class="cnt-ta-op${i === gtaIndex ? ' activo' : ''}" data-id="${c.id}">
        <span class="cnt-ta-nombre">${esc(c.nombre)}</span>
        <span class="cnt-ta-edif">${euro(c.precio)}</span>
      </div>`).join('');
    dd.classList.remove('oculto');
    dd.querySelectorAll('.cnt-ta-op').forEach((op) =>
      op.addEventListener('mousedown', (e) => { e.preventDefault(); seleccionarConcepto(Number(op.dataset.id)); }));
  }
  function seleccionarConcepto(id) {
    gastoCatSel = id;
    const c = gastoCatList.find((x) => x.id === id);
    document.getElementById('ag-concepto-buscar').value = c ? c.nombre : '';
    if (c) document.getElementById('ag-importe').value = c.precio; // autocompleta el precio
    cerrarConceptoDrop();
    actualizarGastoIvaDesglose();
  }

  // Desglose de IVA bajo el importe (solo si el concepto seleccionado incluye IVA).
  function actualizarGastoIvaDesglose() {
    const el = document.getElementById('ag-iva-desglose');
    if (!el) return;
    const c = gastoCatList.find((x) => x.id === gastoCatSel);
    if (!c || !c.incluye_iva) { el.textContent = ''; return; }
    const base = parseFloat(document.getElementById('ag-importe').value) || 0;
    el.textContent = `Base: ${euro(base)} + IVA 21%: ${euro(base * 0.21)}`;
  }
  function cerrarConceptoDrop() {
    const dd = document.getElementById('ag-concepto-dropdown');
    if (dd) dd.classList.add('oculto');
    gtaIndex = -1;
  }

  // ==================== Pestaña Pagos propietario ====================
  function pagosShellHTML() {
    const opts = ANIOS_GASTO.map((a) => `<option value="${a}"${a === pagoAnio ? ' selected' : ''}>${a}</option>`).join('');
    return `
      <div class="alo-gastos-head">
        <div class="alo-gastos-head-left">
          <select id="alo-pago-anio" class="select-filtro">${opts}</select>
        </div>
        <button id="alo-pago-add" class="btn-pri">＋ Añadir pago</button>
      </div>
      <div id="alo-pagos-minis"></div>
      <div id="alo-pagos-tabla"></div>`;
  }

  function pagosMiniCardsHTML(pagado, pendiente, total) {
    const card = (bg, bd, col, ico, lbl, val) =>
      `<div style="flex:1;min-width:120px;background:${bg};border:1px solid ${bd};border-radius:10px;padding:10px 12px">
         <div style="font-size:12px;color:${col}">${ico} ${lbl}</div>
         <div style="font-size:18px;font-weight:700;color:${col}">${euro(val)}</div>
       </div>`;
    return `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
      ${card('#f0fdf4', '#dcfce7', '#047857', '✅', 'Total pagado', pagado)}
      ${card('#fff7ed', '#fed7aa', '#c2410c', '⏳', 'Pendiente de pago', pendiente)}
      ${card('#eff6ff', '#dbeafe', '#2563eb', '💰', `Total ${pagoAnio}`, total)}
    </div>`;
  }

  async function cargarPagos() {
    const id = fichaActual && fichaActual.id;
    if (id == null) return;
    pagosCargados = true;
    const cont = document.getElementById('alo-pagos-tabla');
    if (cont) cont.innerHTML = skeletonGastos();
    let data;
    try {
      data = await API.get(`/api/apartamentos/${id}/pagos-propietario?anio=${pagoAnio}`);
    } catch (e) {
      if (cont) cont.innerHTML = '<div style="color:var(--muted);padding:8px 0">No se pudieron cargar los pagos.</div>';
      return;
    }
    if (!fichaActual || String(fichaActual.id) !== String(id)) return; // la ficha cambió
    pagosLista = data || [];
    renderPagos();
  }

  function renderPagos() {
    const minis = document.getElementById('alo-pagos-minis');
    const cont = document.getElementById('alo-pagos-tabla');
    const totPagado = pagosLista.filter((p) => p.pagado).reduce((s, p) => s + Number(p.importe || 0), 0);
    const totPend = pagosLista.filter((p) => !p.pagado).reduce((s, p) => s + Number(p.importe || 0), 0);
    const totAnio = totPagado + totPend;
    if (minis) minis.innerHTML = pagosMiniCardsHTML(totPagado, totPend, totAnio);
    if (!cont) return;
    if (!pagosLista.length) {
      cont.innerHTML = `<div style="color:var(--muted);padding:8px 0">Sin pagos registrados en ${pagoAnio}</div>`;
      return;
    }
    const filas = pagosLista.map((p) => {
      const estado = p.pagado
        ? '<span class="badge-estado activo">Pagado ✓</span>'
        : '<span class="badge-estado" style="background:#fff7ed;color:#c2410c">Pendiente</span>';
      const factura = p.factura_id
        ? `<a class="vta-ref" data-ver-factura="${p.factura_id}" style="cursor:pointer">${esc(p.factura_numero) || 'Ver factura'}</a>`
        : `<button class="btn-mini" data-generar-factura="${p.id}">🧾 Generar autofactura</button>`;
      const acc = [`<button class="btn-mini" data-editar-pago="${p.id}">Editar</button>`];
      if (!p.pagado) acc.push(`<button class="btn-mini" data-marcar-pago="${p.id}">Marcar pagado</button>`);
      if (!p.factura_id) acc.push(`<button class="btn-mini" data-borrar-pago="${p.id}">Eliminar</button>`);
      const notas = p.notas ? ` <span class="alo-gasto-notas">${esc(p.notas)}</span>` : '';
      return `
        <tr>
          <td>${fechaES(p.fecha)}</td>
          <td>${esc(p.concepto)}${notas}</td>
          <td style="text-align:right;white-space:nowrap">${euro(p.importe)}</td>
          <td>${estado}</td>
          <td>${factura}</td>
          <td class="acciones">${acc.join('')}</td>
        </tr>`;
    }).join('');
    cont.innerHTML = `
      <div class="tabla-scroll">
        <table class="tabla">
          <thead><tr><th>Fecha</th><th>Concepto</th><th style="text-align:right">Importe</th><th>Estado</th><th>Factura</th><th></th></tr></thead>
          <tbody>${filas}</tbody>
          <tfoot><tr class="est-fila-total"><td colspan="2">Total ${pagoAnio}</td><td style="text-align:right;white-space:nowrap">${euro(totAnio)}</td><td colspan="3"></td></tr></tfoot>
        </table>
      </div>`;
    cont.querySelectorAll('[data-ver-factura]').forEach((b) =>
      b.addEventListener('click', () => irAFactura(b.dataset.verFactura)));
    cont.querySelectorAll('[data-generar-factura]').forEach((b) =>
      b.addEventListener('click', () => generarFacturaPago(b.dataset.generarFactura)));
    cont.querySelectorAll('[data-editar-pago]').forEach((b) =>
      b.addEventListener('click', () => modalEditarPago(pagosLista.find((x) => String(x.id) === b.dataset.editarPago))));
    cont.querySelectorAll('[data-marcar-pago]').forEach((b) =>
      b.addEventListener('click', () => modalMarcarPagado(pagosLista.find((x) => String(x.id) === b.dataset.marcarPago))));
    cont.querySelectorAll('[data-borrar-pago]').forEach((b) =>
      b.addEventListener('click', () => borrarPago(b.dataset.borrarPago)));
  }

  // Navega a Facturación y abre la factura.
  function irAFactura(facturaId) {
    if (typeof activarTab === 'function') activarTab('facturacion');
    if (typeof Facturas !== 'undefined' && Facturas.abrirFicha) Facturas.abrirFicha(facturaId);
  }

  async function generarFacturaPago(pagoId) {
    if (!confirm('¿Generar autofactura de este pago? (IVA 0%, retención 19%)')) return;
    try {
      const r = await API.post(`/api/apartamentos/${fichaActual.id}/pagos-propietario/${pagoId}/generar-factura`, {});
      await cargarPagos();
      toast('Autofactura ' + (r.numero_factura || '') + ' generada', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function borrarPago(pagoId) {
    if (!confirm('¿Eliminar este pago?')) return;
    try {
      await API.del(`/api/apartamentos/${fichaActual.id}/pagos-propietario/${pagoId}`);
      await cargarPagos();
      toast('Pago eliminado', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ---- Modal "Añadir pago" ----
  function modalAnadirPago() {
    const apto = fichaActual;
    const hoy = new Date().toISOString().slice(0, 10);
    abrirModal(`
      <h3>Añadir pago a propietario</h3>
      <div class="campo"><label>Concepto *</label><input id="pp-concepto" placeholder="Ej: Suministro luz julio, Comunidad, IBI"></div>
      <div class="fila-campos">
        <div class="campo"><label>Importe (€) *</label><input type="number" step="0.01" min="0" id="pp-importe"></div>
        <div class="campo"><label>Fecha *</label><input type="date" id="pp-fecha" value="${hoy}"></div>
      </div>
      <div class="campo"><label>Notas</label><textarea id="pp-notas"></textarea></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="pp-cancelar">Cancelar</button>
        <button class="btn-pri" id="pp-guardar">Guardar</button>
      </div>`);
    document.getElementById('pp-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('pp-guardar').addEventListener('click', async () => {
      const concepto = val('pp-concepto').trim();
      if (!concepto) return toast('El concepto es obligatorio', 'error');
      const importe = parseFloat(val('pp-importe'));
      if (isNaN(importe) || importe <= 0) return toast('Indica un importe mayor que 0', 'error');
      const fecha = val('pp-fecha');
      if (!fecha) return toast('La fecha es obligatoria', 'error');
      try {
        await API.post(`/api/apartamentos/${apto.id}/pagos-propietario`, { concepto, importe, fecha, notas: val('pp-notas') });
        cerrarModal();
        await cargarPagos();
        toast('Pago añadido', 'ok');
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  // ---- Modal "Editar pago" (incluye toggle Pagado + fecha de pago) ----
  function modalEditarPago(pago) {
    if (!pago) return;
    const hoy = new Date().toISOString().slice(0, 10);
    abrirModal(`
      <h3>Editar pago</h3>
      <div class="campo"><label>Concepto *</label><input id="pe-concepto" value="${esc(pago.concepto)}"></div>
      <div class="fila-campos">
        <div class="campo"><label>Importe (€) *</label><input type="number" step="0.01" min="0" id="pe-importe" value="${pago.importe ?? ''}"></div>
        <div class="campo"><label>Fecha *</label><input type="date" id="pe-fecha" value="${esc(pago.fecha) || hoy}"></div>
      </div>
      <div class="campo"><label>Notas</label><textarea id="pe-notas">${esc(pago.notas)}</textarea></div>
      <label class="toggle-campo"><input type="checkbox" id="pe-pagado"${pago.pagado ? ' checked' : ''}><span>Pagado</span></label>
      <div class="campo" id="pe-fpago-wrap" style="${pago.pagado ? '' : 'display:none'}"><label>Fecha de pago</label><input type="date" id="pe-fpago" value="${esc(pago.fecha_pago) || hoy}"></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="pe-cancelar">Cancelar</button>
        <button class="btn-pri" id="pe-guardar">Guardar</button>
      </div>`);
    const chk = document.getElementById('pe-pagado');
    chk.addEventListener('change', () => {
      document.getElementById('pe-fpago-wrap').style.display = chk.checked ? '' : 'none';
    });
    document.getElementById('pe-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('pe-guardar').addEventListener('click', async () => {
      const concepto = val('pe-concepto').trim();
      if (!concepto) return toast('El concepto es obligatorio', 'error');
      const importe = parseFloat(val('pe-importe'));
      if (isNaN(importe) || importe <= 0) return toast('Indica un importe mayor que 0', 'error');
      const fecha = val('pe-fecha');
      if (!fecha) return toast('La fecha es obligatoria', 'error');
      const pagado = chk.checked ? 1 : 0;
      const body = { concepto, importe, fecha, notas: val('pe-notas'), pagado, fecha_pago: pagado ? val('pe-fpago') : null };
      try {
        await API.put(`/api/apartamentos/${fichaActual.id}/pagos-propietario/${pago.id}`, body);
        cerrarModal();
        await cargarPagos();
        toast('Pago actualizado', 'ok');
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  // ---- Mini modal "Marcar pagado" ----
  function modalMarcarPagado(pago) {
    if (!pago) return;
    const hoy = new Date().toISOString().slice(0, 10);
    abrirModal(`
      <h3>Marcar como pagado</h3>
      <div class="vta-pv-resumen"><div>${esc(pago.concepto)} · <strong>${euro(pago.importe)}</strong></div></div>
      <div class="campo"><label>Fecha de pago</label><input type="date" id="pm-fpago" value="${esc(pago.fecha_pago) || hoy}"></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="pm-cancelar">Cancelar</button>
        <button class="btn-pri" id="pm-guardar">Confirmar</button>
      </div>`);
    document.getElementById('pm-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('pm-guardar').addEventListener('click', async () => {
      try {
        await API.put(`/api/apartamentos/${fichaActual.id}/pagos-propietario/${pago.id}`, { pagado: 1, fecha_pago: val('pm-fpago') });
        cerrarModal();
        await cargarPagos();
        toast('Pago marcado como pagado', 'ok');
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  // ==================== Pestaña Galería ====================
  function galeriaShellHTML() {
    return `
      <div class="alo-gal-head">
        <div class="alo-gal-titulo">Galería de fotos <span id="alo-gal-count" class="alo-prop-count">0</span></div>
        <div class="alo-gal-acciones">
          <button id="alo-gal-subir" class="btn-pri">＋ Subir fotos</button>
          <button id="alo-gal-email" class="btn-sec" disabled>📧 Enviar por email</button>
        </div>
      </div>
      <div id="alo-gal-grid"></div>`;
  }

  function skeletonGaleria() {
    return '<div class="alo-gal-grid">' +
      '<div class="alo-gal-item"><span class="skeleton" style="display:block;aspect-ratio:1;border-radius:6px"></span></div>'.repeat(6) +
      '</div>';
  }

  async function cargarGaleria() {
    const id = fichaActual && fichaActual.id;
    if (id == null) return;
    galeriaCargada = true;
    const grid = document.getElementById('alo-gal-grid');
    if (grid) grid.innerHTML = skeletonGaleria();
    try {
      galeriaFotos = await API.get(`/api/apartamentos/${id}/fotos`);
    } catch (e) {
      if (grid) grid.innerHTML = '<div style="color:var(--muted);padding:8px 0">No se pudieron cargar las fotos.</div>';
      return;
    }
    if (!fichaActual || String(fichaActual.id) !== String(id)) return; // la ficha cambió
    renderGaleria();
    // Enlazar botones de cabecera (existen siempre en el shell).
    const bSubir = document.getElementById('alo-gal-subir');
    const bEmail = document.getElementById('alo-gal-email');
    if (bSubir) bSubir.onclick = modalSubirFotos;
    if (bEmail) bEmail.onclick = modalEnviarEmail;
  }

  function renderGaleria() {
    const grid = document.getElementById('alo-gal-grid');
    const count = document.getElementById('alo-gal-count');
    const bEmail = document.getElementById('alo-gal-email');
    if (count) count.textContent = galeriaFotos.length;
    if (bEmail) bEmail.disabled = galeriaFotos.length === 0;
    if (!grid) return;

    if (!galeriaFotos.length) {
      grid.innerHTML = `
        <div class="alo-gal-vacio" id="alo-gal-dropvacio">
          <div class="alo-gal-vacio-icono">📷</div>
          <div>Arrastra fotos aquí o pulsa <strong>Subir fotos</strong></div>
        </div>`;
      const dz = document.getElementById('alo-gal-dropvacio');
      if (dz) conectarDropEnZona(dz);
      return;
    }

    grid.innerHTML = '<div class="alo-gal-grid">' + galeriaFotos.map((f, i) => `
      <div class="alo-gal-celda">
        <div class="alo-gal-item" draggable="true" data-foto="${f.id}" data-idx="${i}">
          <img src="${esc(f.url)}" alt="${esc(f.descripcion || '')}" loading="lazy">
          <div class="alo-gal-overlay">
            <button class="alo-gal-ov-btn" data-borrar-foto="${f.id}" title="Eliminar">🗑</button>
            <button class="alo-gal-ov-btn" data-editar-foto="${f.id}" title="Editar descripción">✏️</button>
          </div>
        </div>
        ${f.descripcion ? `<div class="alo-gal-desc">${esc(f.descripcion)}</div>` : ''}
      </div>`).join('') + '</div>';

    // Clic en imagen → lightbox (ignora clics en botones del overlay).
    grid.querySelectorAll('.alo-gal-item').forEach((it) => {
      it.querySelector('img').addEventListener('click', () => abrirLightbox(Number(it.dataset.idx)));
      conectarDragItem(it);
    });
    grid.querySelectorAll('[data-borrar-foto]').forEach((b) =>
      b.addEventListener('click', (e) => { e.stopPropagation(); eliminarFoto(Number(b.dataset.borrarFoto)); }));
    grid.querySelectorAll('[data-editar-foto]').forEach((b) =>
      b.addEventListener('click', (e) => { e.stopPropagation(); modalEditarDescripcion(Number(b.dataset.editarFoto)); }));
  }

  // ---- Drag & drop para reordenar ----
  function conectarDragItem(it) {
    it.addEventListener('dragstart', (e) => { dragFotoId = Number(it.dataset.foto); it.classList.add('arrastrando'); e.dataTransfer.effectAllowed = 'move'; });
    it.addEventListener('dragend', () => { dragFotoId = null; it.classList.remove('arrastrando'); document.querySelectorAll('.alo-gal-item.drop-target').forEach((x) => x.classList.remove('drop-target')); });
    it.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; it.classList.add('drop-target'); });
    it.addEventListener('dragleave', () => it.classList.remove('drop-target'));
    it.addEventListener('drop', (e) => {
      e.preventDefault();
      it.classList.remove('drop-target');
      const destinoId = Number(it.dataset.foto);
      if (dragFotoId == null || dragFotoId === destinoId) return;
      reordenarFotos(dragFotoId, destinoId);
    });
  }

  async function reordenarFotos(origenId, destinoId) {
    const arr = galeriaFotos.slice();
    const iO = arr.findIndex((f) => f.id === origenId);
    const iD = arr.findIndex((f) => f.id === destinoId);
    if (iO < 0 || iD < 0) return;
    const [movida] = arr.splice(iO, 1);
    arr.splice(iD, 0, movida);
    galeriaFotos = arr;
    renderGaleria(); // feedback inmediato
    try {
      await API.post(`/api/apartamentos/${fichaActual.id}/fotos/reordenar`, { orden: arr.map((f) => f.id) });
    } catch (e) {
      toast(e.message, 'error');
      cargarGaleria(); // revertir desde servidor
    }
  }

  // ---- Lightbox ----
  function abrirLightbox(idx) {
    lightboxIdx = idx;
    let box = document.getElementById('alo-lightbox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'alo-lightbox';
      box.className = 'alo-lightbox';
      box.innerHTML = `
        <button class="alo-lb-cerrar" data-lb="cerrar" title="Cerrar">✕</button>
        <button class="alo-lb-nav alo-lb-prev" data-lb="prev" title="Anterior">◀</button>
        <figure class="alo-lb-fig"><img id="alo-lb-img" src="" alt=""><figcaption id="alo-lb-cap"></figcaption></figure>
        <button class="alo-lb-nav alo-lb-next" data-lb="next" title="Siguiente">▶</button>`;
      document.body.appendChild(box);
      box.addEventListener('click', (e) => {
        const acc = e.target.closest('[data-lb]');
        if (acc) { const a = acc.dataset.lb; if (a === 'cerrar') cerrarLightbox(); else navLightbox(a === 'next' ? 1 : -1); return; }
        if (e.target === box) cerrarLightbox(); // clic en el fondo cierra
      });
      document.addEventListener('keydown', lightboxKeys, true);
    }
    pintarLightbox();
    box.classList.add('abierto');
  }
  function pintarLightbox() {
    const f = galeriaFotos[lightboxIdx];
    if (!f) return cerrarLightbox();
    const img = document.getElementById('alo-lb-img');
    const cap = document.getElementById('alo-lb-cap');
    if (img) img.src = f.url;
    if (cap) cap.textContent = f.descripcion || '';
    const box = document.getElementById('alo-lightbox');
    if (box) {
      box.querySelector('.alo-lb-prev').style.visibility = galeriaFotos.length > 1 ? 'visible' : 'hidden';
      box.querySelector('.alo-lb-next').style.visibility = galeriaFotos.length > 1 ? 'visible' : 'hidden';
    }
  }
  function navLightbox(delta) {
    if (!galeriaFotos.length) return;
    lightboxIdx = (lightboxIdx + delta + galeriaFotos.length) % galeriaFotos.length;
    pintarLightbox();
  }
  function cerrarLightbox() {
    const box = document.getElementById('alo-lightbox');
    if (box) box.classList.remove('abierto');
    lightboxIdx = -1;
  }
  function lightboxKeys(e) {
    const box = document.getElementById('alo-lightbox');
    if (!box || !box.classList.contains('abierto')) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrarLightbox(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); navLightbox(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); navLightbox(-1); }
  }

  // ---- Eliminar / editar descripción ----
  async function eliminarFoto(id) {
    if (!confirm('¿Eliminar esta foto?')) return;
    try {
      await API.del(`/api/apartamentos/${fichaActual.id}/fotos/${id}`);
      toast('Foto eliminada', 'ok');
      await cargarGaleria();
    } catch (e) { toast(e.message, 'error'); }
  }

  function modalEditarDescripcion(id) {
    const f = galeriaFotos.find((x) => x.id === id);
    if (!f) return;
    abrirModal(`
      <h3>Editar descripción</h3>
      <div class="campo"><label>Descripción</label><textarea id="ed-desc">${esc(f.descripcion)}</textarea></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="ed-cancelar">Cancelar</button>
        <button class="btn-pri" id="ed-guardar">Guardar</button>
      </div>`);
    document.getElementById('ed-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('ed-guardar').addEventListener('click', async () => {
      try {
        await API.put(`/api/apartamentos/${fichaActual.id}/fotos/${id}`, { descripcion: val('ed-desc') });
        cerrarModal();
        await cargarGaleria();
        toast('Descripción guardada', 'ok');
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  // ---- Subir fotos (dropzone + preview + barra de progreso) ----
  let subirSeleccion = []; // File[] pendientes
  function modalSubirFotos() {
    subirSeleccion = [];
    abrirModal(`
      <h3>Subir fotos</h3>
      <div class="alo-dropzone" id="alo-dropzone">
        <div class="alo-dropzone-icono">📷</div>
        <div>Arrastra fotos aquí o <strong>haz clic para seleccionar</strong></div>
        <div class="alo-dropzone-sub">Hasta 10 a la vez · JPG, PNG, WEBP</div>
        <input type="file" id="alo-file-input" accept=".jpg,.jpeg,.png,.webp" multiple hidden>
      </div>
      <div id="alo-preview" class="alo-preview"></div>
      <div id="alo-progreso" class="alo-progreso oculto"><div class="alo-progreso-barra" id="alo-progreso-barra"></div></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="alo-sub-cancelar">Cancelar</button>
        <button class="btn-pri" id="alo-sub-guardar" disabled>Subir</button>
      </div>`);

    const dz = document.getElementById('alo-dropzone');
    const input = document.getElementById('alo-file-input');
    dz.addEventListener('click', () => input.click());
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('arrastrando'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('arrastrando'));
    dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('arrastrando'); anadirArchivos(e.dataTransfer.files); });
    input.addEventListener('change', () => anadirArchivos(input.files));

    document.getElementById('alo-sub-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('alo-sub-guardar').addEventListener('click', subirFotos);
  }

  const EXT_FOTO = ['jpg', 'jpeg', 'png', 'webp'];
  function anadirArchivos(fileList) {
    const nuevos = Array.from(fileList).filter((f) => EXT_FOTO.includes((f.name.split('.').pop() || '').toLowerCase()));
    if (Array.from(fileList).length && !nuevos.length) toast('Formato no admitido (solo JPG, PNG, WEBP)', 'error');
    for (const f of nuevos) {
      if (subirSeleccion.length >= 10) { toast('Máximo 10 fotos a la vez', 'aviso'); break; }
      subirSeleccion.push(f);
    }
    renderPreview();
  }
  function renderPreview() {
    const cont = document.getElementById('alo-preview');
    const btn = document.getElementById('alo-sub-guardar');
    if (!cont) return;
    if (btn) { btn.disabled = subirSeleccion.length === 0; btn.textContent = subirSeleccion.length ? `Subir ${subirSeleccion.length}` : 'Subir'; }
    cont.innerHTML = '';
    subirSeleccion.forEach((file, i) => {
      const div = document.createElement('div');
      div.className = 'alo-preview-item';
      div.innerHTML = `<img alt=""><button class="alo-preview-quitar" title="Quitar">✕</button>`;
      const reader = new FileReader();
      reader.onload = (e) => { div.querySelector('img').src = e.target.result; };
      reader.readAsDataURL(file);
      div.querySelector('.alo-preview-quitar').addEventListener('click', () => { subirSeleccion.splice(i, 1); renderPreview(); });
      cont.appendChild(div);
    });
  }
  function subirFotos() {
    if (!subirSeleccion.length) return;
    const fd = new FormData();
    subirSeleccion.forEach((f) => fd.append('fotos', f));
    const barraCont = document.getElementById('alo-progreso');
    const barra = document.getElementById('alo-progreso-barra');
    if (barraCont) barraCont.classList.remove('oculto');
    document.getElementById('alo-sub-guardar').disabled = true;
    document.getElementById('alo-sub-cancelar').disabled = true;

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/apartamentos/${fichaActual.id}/fotos`);
    const h = authHeaders();
    for (const k in h) xhr.setRequestHeader(k, h[k]);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && barra) barra.style.width = Math.round((e.loaded / e.total) * 100) + '%'; };
    xhr.onload = async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const n = subirSeleccion.length;
        cerrarModal();
        await cargarGaleria();
        toast(`${n} foto${n === 1 ? '' : 's'} subida${n === 1 ? '' : 's'}`, 'ok');
      } else {
        let msg = 'Error al subir';
        try { msg = JSON.parse(xhr.responseText).error || msg; } catch (e) {}
        toast(msg, 'error');
        document.getElementById('alo-sub-guardar').disabled = false;
        document.getElementById('alo-sub-cancelar').disabled = false;
        if (barraCont) barraCont.classList.add('oculto');
      }
    };
    xhr.onerror = () => { toast('Error de red al subir', 'error'); document.getElementById('alo-sub-cancelar').disabled = false; };
    xhr.send(fd);
  }

  // ---- Enviar por email (mailto) + descargar ----
  async function modalEnviarEmail() {
    if (!galeriaFotos.length) return;
    const apto = fichaActual;
    // Razón social principal (la primera) para la firma; reservas para el typeahead.
    let razon = '';
    try {
      const rs = await API.get('/api/ajustes/razones-sociales');
      if (rs && rs.length) razon = rs[0].razon_social || rs[0].nombre_comercial || '';
    } catch (e) { /* opcional */ }
    try { emailReservas = await API.get('/api/reservas/todas'); } catch (e) { emailReservas = []; }
    // Candidatos únicos por email (o por nombre si no hay email).
    const vistos = new Set();
    emClientes = [];
    for (const r of emailReservas) {
      const nombre = r.nombre_cliente || r.ocupante || '';
      const email = r.email || r.email_cliente || '';
      if (!nombre && !email) continue;
      const clave = (email || nombre).toLowerCase();
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      emClientes.push({ nombre, email });
    }

    const asunto = `Fotos del apartamento ${apto.nombre || ''}`.trim();
    const mensaje = `Buenos días,\n\nLe adjuntamos las fotos del apartamento ${apto.nombre || ''} para su consulta.\n\nUn saludo,\n${razon}`;

    const thumbs = galeriaFotos.map((f) => `
      <label class="alo-em-thumb">
        <input type="checkbox" data-em-foto="${f.id}" checked>
        <img src="${esc(f.url)}" alt="">
      </label>`).join('');

    abrirModal(`
      <h3>📧 Enviar fotos por email</h3>
      <div class="campo">
        <label>Destinatario *</label>
        <div class="alo-em-radios">
          <label><input type="radio" name="em-modo" value="manual" checked> Email manual</label>
          <label><input type="radio" name="em-modo" value="cliente"> Buscar cliente</label>
        </div>
        <input type="email" id="em-email" placeholder="correo@ejemplo.com" autocomplete="off">
        <div class="cnt-typeahead oculto" id="em-cliente-wrap" style="margin-top:8px">
          <input id="em-cliente-buscar" placeholder="Buscar cliente por nombre o email..." autocomplete="off">
          <div class="cnt-ta-dropdown oculto" id="em-cliente-dropdown"></div>
        </div>
      </div>
      <div class="campo"><label>Asunto</label><input id="em-asunto" value="${esc(asunto)}"></div>
      <div class="campo"><label>Mensaje</label><textarea id="em-mensaje" rows="7">${esc(mensaje)}</textarea></div>
      <div class="campo">
        <label>Fotos a enviar <span id="em-contador" class="alo-em-contador"></span></label>
        <div class="alo-em-thumbs">${thumbs}</div>
      </div>
      <div class="modal-acciones">
        <button class="btn-sec" id="em-cancelar">Cancelar</button>
        <button class="btn-pri" id="em-enviar">📧 Enviar</button>
      </div>`);
    document.querySelector('.modal').classList.add('modal-ancho');

    // Alternar manual / cliente.
    const wrapCli = document.getElementById('em-cliente-wrap');
    const inputEmail = document.getElementById('em-email');
    document.querySelectorAll('input[name="em-modo"]').forEach((rb) =>
      rb.addEventListener('change', () => {
        const cliente = rb.value === 'cliente' && rb.checked;
        wrapCli.classList.toggle('oculto', !cliente);
        inputEmail.classList.toggle('oculto', cliente);
      }));

    // Contador de fotos seleccionadas.
    const actualizarContador = () => {
      const sel = fotosSeleccionadasEmail().length;
      const el = document.getElementById('em-contador');
      if (el) el.textContent = `${sel} de ${galeriaFotos.length} fotos seleccionadas`;
    };
    document.querySelectorAll('[data-em-foto]').forEach((c) => c.addEventListener('change', actualizarContador));
    actualizarContador();

    initEmailTypeahead();
    document.getElementById('em-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('em-enviar').addEventListener('click', enviarFotosEmail);
  }

  function fotosSeleccionadasEmail() {
    const ids = Array.from(document.querySelectorAll('[data-em-foto]:checked')).map((c) => Number(c.dataset.emFoto));
    return galeriaFotos.filter((f) => ids.includes(f.id));
  }

  // Envía las fotos seleccionadas por email (POST /api/email/enviar-fotos).
  async function enviarFotosEmail() {
    const inputEmail = document.getElementById('em-email');
    const to = (inputEmail.value || '').trim();
    if (!to) return toast('Indica un email de destino', 'error');
    const fotos = fotosSeleccionadasEmail();
    if (!fotos.length) return toast('Selecciona al menos una foto', 'aviso');

    const btn = document.getElementById('em-enviar');
    const btnCancel = document.getElementById('em-cancelar');
    const original = btn.innerHTML;
    btn.disabled = true;
    btnCancel.disabled = true;
    btn.innerHTML = `<span class="alo-spinner"></span> Enviando email con ${fotos.length} foto${fotos.length === 1 ? '' : 's'}...`;

    try {
      const r = await API.post('/api/email/enviar-fotos', {
        to,
        subject: val('em-asunto'),
        mensaje: val('em-mensaje'),
        apartamento_id: fichaActual.id,
        foto_ids: fotos.map((f) => f.id),
      });
      // El backend devuelve {ok:false, error} con HTTP 200 en fallos de SMTP.
      if (r && r.ok === false) throw new Error(r.error || 'No se pudo enviar el email');
      cerrarModal();
      toast(`Email enviado correctamente a ${to}`, 'ok');
    } catch (e) {
      let msg = e.message || 'No se pudo enviar el email';
      if (/smtp|auth|login|credential|contrase|535|534/i.test(msg)) {
        msg += '. Revisa la configuración de correo en Ajustes';
      }
      toast(msg, 'error');
      btn.disabled = false;
      btnCancel.disabled = false;
      btn.innerHTML = original;
    }
  }

  // ---- Typeahead de cliente (modal email) ----
  function initEmailTypeahead() {
    const input = document.getElementById('em-cliente-buscar');
    if (!input) return;
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      if (q.length < 2) { cerrarEmailDrop(); return; }
      emtaMatches = emClientes.filter((c) =>
        c.nombre.toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q)).slice(0, 30);
      emtaIndex = -1;
      renderEmailDrop();
    });
    input.addEventListener('keydown', (e) => {
      const dd = document.getElementById('em-cliente-dropdown');
      const abierto = dd && !dd.classList.contains('oculto');
      if (e.key === 'ArrowDown') { if (!abierto) return; e.preventDefault(); emtaIndex = Math.min(emtaIndex + 1, emtaMatches.length - 1); renderEmailDrop(); }
      else if (e.key === 'ArrowUp') { if (!abierto) return; e.preventDefault(); emtaIndex = Math.max(emtaIndex - 1, 0); renderEmailDrop(); }
      else if (e.key === 'Enter') { if (abierto && emtaIndex >= 0 && emtaMatches[emtaIndex]) { e.preventDefault(); seleccionarCliente(emtaIndex); } }
      else if (e.key === 'Escape') { if (abierto) { e.preventDefault(); e.stopPropagation(); cerrarEmailDrop(); } }
    });
    input.addEventListener('blur', () => setTimeout(cerrarEmailDrop, 120));
  }
  function renderEmailDrop() {
    const dd = document.getElementById('em-cliente-dropdown');
    if (!dd) return;
    if (!emtaMatches.length) { dd.innerHTML = '<div class="cnt-ta-vacio">Sin resultados</div>'; dd.classList.remove('oculto'); return; }
    dd.innerHTML = emtaMatches.map((c, i) => `
      <div class="cnt-ta-op${i === emtaIndex ? ' activo' : ''}" data-idx="${i}">
        <span class="cnt-ta-nombre">${esc(c.nombre || '(sin nombre)')}${c.email ? ` <span class="cnt-ta-edif">${esc(c.email)}</span>` : ' <span class="cnt-ta-edif">sin email</span>'}</span>
      </div>`).join('');
    dd.classList.remove('oculto');
    dd.querySelectorAll('.cnt-ta-op').forEach((op) =>
      op.addEventListener('mousedown', (e) => { e.preventDefault(); seleccionarCliente(Number(op.dataset.idx)); }));
  }
  function seleccionarCliente(i) {
    const c = emtaMatches[i];
    if (!c) return;
    document.getElementById('em-cliente-buscar').value = c.nombre + (c.email ? ` <${c.email}>` : '');
    const inputEmail = document.getElementById('em-email');
    if (c.email) { inputEmail.value = c.email; }
    else toast('Esa reserva no tiene email guardado; escríbelo manualmente', 'aviso');
    cerrarEmailDrop();
  }
  function cerrarEmailDrop() {
    const dd = document.getElementById('em-cliente-dropdown');
    if (dd) dd.classList.add('oculto');
    emtaIndex = -1;
  }

  // Soltar fotos sobre la zona vacía de la galería → abre el modal de subida ya con archivos.
  function conectarDropEnZona(zona) {
    zona.addEventListener('dragover', (e) => { e.preventDefault(); zona.classList.add('arrastrando'); });
    zona.addEventListener('dragleave', () => zona.classList.remove('arrastrando'));
    zona.addEventListener('drop', (e) => {
      e.preventDefault();
      zona.classList.remove('arrastrando');
      modalSubirFotos();
      anadirArchivos(e.dataTransfer.files);
    });
  }

  // ==================== Pestaña Calendario ====================
  // ==================== Pestaña Mantenimiento ====================
  function mantenimientoShellHTML() {
    if (!ANIOS_MANT.includes(mantAnio)) mantAnio = new Date().getFullYear();
    const opts = ANIOS_MANT.map((a) => `<option value="${a}"${a === mantAnio ? ' selected' : ''}>${a}</option>`).join('');
    return `
      <div class="alo-mant-head">
        <div class="alo-mant-head-left">
          <select id="alo-mant-anio" class="select-filtro">${opts}</select>
          <span id="alo-mant-resumen" class="alo-mant-resumen-badge">—</span>
        </div>
        <button id="alo-mant-add" class="btn-pri">＋ Nueva tarea</button>
      </div>
      <div id="alo-mant-lista"></div>`;
  }

  function mantEstadoBadge(e) {
    const m = {
      urgente:    ['🔴 Urgente', 'mant-bdg-urg'],
      pendiente:  ['📋 Por hacer', 'mant-bdg-pend'],
      en_proceso: ['🔄 En proceso', 'mant-bdg-proc'],
      completada: ['✅ Hecho', 'mant-bdg-hecho'],
    };
    const x = m[e] || m.pendiente;
    return `<span class="mant-bdg ${x[1]}">${x[0]}</span>`;
  }

  async function cargarMantenimiento() {
    const id = fichaActual && fichaActual.id;
    if (id == null) return;
    mantCargado = true;
    const cont = document.getElementById('alo-mant-lista');
    if (cont) cont.innerHTML = '<div style="color:var(--muted);padding:12px 0">Cargando tareas…</div>';
    let data;
    try {
      data = await API.get(`/api/mantenimiento/historial?apartamento_id=${id}&anio=${mantAnio}`);
    } catch (e) {
      if (cont) cont.innerHTML = '<div style="color:var(--muted);padding:8px 0">No se pudieron cargar las tareas.</div>';
      return;
    }
    const r = data.resumen || {};
    const completadas = r.completadas || 0;
    const pendientes = (r.total || 0) - completadas;
    const badge = document.getElementById('alo-mant-resumen');
    if (badge) badge.textContent = `${r.total || 0} tareas — ${completadas} completadas — ${pendientes} pendientes`;
    renderMantenimientoLista(data.tareas || []);
  }

  function renderMantenimientoLista(tareas) {
    const cont = document.getElementById('alo-mant-lista');
    if (!cont) return;
    if (!tareas.length) {
      cont.innerHTML = `<div class="alo-mant-vacio">Sin incidencias registradas en ${mantAnio}</div>`;
      return;
    }
    cont.innerHTML = tareas.map((t) => {
      const nn = t.notas ? t.notas.length : 0;
      const nf = t.num_fotos || 0;
      const cliente = t.cliente_nombre ? `<div class="alo-mant-card-cli">👤 Cliente: ${esc(t.cliente_nombre)}</div>` : '';
      const fechaCreada = fechaES((t.fecha_creacion || '').slice(0, 10));
      const completada = t.estado === 'completada' && t.completado_fecha
        ? ` → Completada ${fechaES((t.completado_fecha || '').slice(0, 10))}` : '';
      return `
        <div class="alo-mant-card">
          <div class="alo-mant-card-top">
            ${mantEstadoBadge(t.estado)}
            <a class="alo-mant-card-tit mant-link" data-mant-tarea="${t.id}">${esc(t.titulo)}</a>
          </div>
          ${cliente}
          <div class="alo-mant-card-meta">📝 ${nn} nota${nn === 1 ? '' : 's'} · 📷 ${nf} foto${nf === 1 ? '' : 's'}</div>
          <div class="alo-mant-card-fechas">📅 ${fechaCreada}${completada}</div>
        </div>`;
    }).join('');

    cont.querySelectorAll('[data-mant-tarea]').forEach((a) =>
      a.addEventListener('click', () => {
        const tid = a.dataset.mantTarea;
        cerrarPanel();
        if (typeof activarTab === 'function') activarTab('mantenimiento');
        if (typeof Mantenimiento !== 'undefined' && Mantenimiento.abrirDetalle) Mantenimiento.abrirDetalle(tid);
      }));
  }

  function calendarioShellHTML() {
    if (!ANIOS_CAL.includes(calAnio)) calAnio = new Date().getFullYear();
    const opts = ANIOS_CAL.map((a) => `<option value="${a}"${a === calAnio ? ' selected' : ''}>${a}</option>`).join('');
    return `
      <div class="alo-cal-head">
        <select id="alo-cal-anio" class="select-filtro">${opts}</select>
        <div id="alo-cal-leyenda" class="alo-cal-leyenda"></div>
      </div>
      <div id="alo-cal-grid"></div>
      <div id="alo-cal-resumen"></div>
      <div id="alo-cal-reservas"></div>`;
  }

  // ---- Helpers de fecha (locales del calendario) ----
  function pad2(n) { return String(n).padStart(2, '0'); }
  function isoYMD(y, m, d) { return `${y}-${pad2(m)}-${pad2(d)}`; }
  function diasDelMes(y, m) { return new Date(y, m, 0).getDate(); }    // m 1-based
  function primerDiaLunes(y, m) { return (new Date(y, m - 1, 1).getDay() + 6) % 7; } // Lun=0
  function esBisiesto(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }

  async function cargarCalendario() {
    const id = fichaActual && fichaActual.id;
    if (id == null) return;
    calCargado = true;
    const grid = document.getElementById('alo-cal-grid');
    if (grid) grid.innerHTML = '<div style="color:var(--muted);padding:12px 0">Cargando calendario…</div>';

    // Estados configurables → mapa nombre→color (solo activos para la leyenda;
    // los inactivos siguen pintando si alguna reserva los usa, vía el mapa completo).
    try {
      const estados = await API.get('/api/ajustes/estados-reserva');
      calEstados = {};
      for (const e of estados) calEstados[e.nombre] = e.color;
      calEstadosActivos = estados.filter((e) => e.activo);
    } catch (e) { calEstados = {}; calEstadosActivos = []; }

    // Colores de portal para los badges de la tabla de reservas (caché en memoria).
    try {
      const portales = await API.getPortales();
      calPortales = {};
      for (const p of portales) calPortales[p.nombre] = p.color;
    } catch (e) { calPortales = {}; }

    let reservas = [];
    try {
      reservas = await API.get(`/api/reservas?desde=${calAnio}-01-01&hasta=${calAnio}-12-31`);
    } catch (e) {
      if (grid) grid.innerHTML = '<div style="color:var(--muted);padding:12px 0">No se pudo cargar el calendario.</div>';
      return;
    }
    if (!fichaActual || String(fichaActual.id) !== String(id)) return; // la ficha cambió
    // El endpoint no filtra por apartamento → filtramos en cliente.
    reservas = reservas.filter((r) => String(r.apartamento_id) === String(id));

    const ocupacion = construirOcupacion(reservas);
    renderLeyenda();
    renderMeses(ocupacion);
    renderResumen(ocupacion);
    renderReservasAnio(reservas);
  }

  // Estilo inline del badge (la tarea solo permite tocar este archivo).
  const ALO_RSV_BADGE = 'display:inline-block;color:#fff;font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;white-space:nowrap';

  // Tabla "Reservas del año": reutiliza las reservas ya cargadas para el calendario.
  function renderReservasAnio(reservas) {
    const cont = document.getElementById('alo-cal-reservas');
    if (!cont) return;

    const EXCLUIDOS = ['Cancelada', 'Bloqueado'];
    const lista = (reservas || [])
      .filter((r) => r.entrada && r.salida && !EXCLUIDOS.includes(r.tipo_reserva || ''))
      .sort((a, b) => String(a.entrada).localeCompare(String(b.entrada)));

    const titulo = '<div class="rsv-seccion-titulo">Reservas del año</div>';
    if (!lista.length) {
      cont.innerHTML = `${titulo}<div class="cnt-vacio">Sin reservas confirmadas en ${calAnio}.</div>`;
      return;
    }

    let totalNoches = 0;
    let totalEur = 0;
    const filas = lista.map((r) => {
      const noches = Math.max(0, Math.round((new Date(r.salida + 'T00:00:00') - new Date(r.entrada + 'T00:00:00')) / 86400000));
      const precio = (r.pagado != null && Number(r.pagado) > 0) ? Number(r.pagado) : (Number(r.precio_total) || 0);
      totalNoches += noches;
      totalEur += precio;

      const estado = r.tipo_reserva || 'Sin estado';
      const colEstado = calEstados[estado] || CAL_COLOR_DEFECTO;
      const badgeEstado = `<span style="${ALO_RSV_BADGE};background:${esc(colEstado)}">${esc(estado)}</span>`;

      const portal = r.portal || '';
      const colPortal = calPortales[portal];
      const badgePortal = portal
        ? `<span style="${ALO_RSV_BADGE};background:${esc(colPortal || CAL_COLOR_DEFECTO)}">${esc(portal)}</span>`
        : '<span style="color:var(--muted)">—</span>';

      return `
        <tr data-reserva="${r.id}" style="cursor:pointer">
          <td><strong>${esc(r.nombre_cliente || '—')}</strong></td>
          <td>${badgePortal}</td>
          <td>${fechaES(r.entrada)}</td>
          <td>${fechaES(r.salida)}</td>
          <td>${noches}</td>
          <td>${euro(precio)}</td>
          <td>${badgeEstado}</td>
        </tr>`;
    }).join('');

    cont.innerHTML = `
      ${titulo}
      <div class="tabla-scroll">
        <table class="tabla">
          <thead><tr><th>Cliente</th><th>Portal</th><th>Entrada</th><th>Salida</th><th>Noches</th><th>Precio</th><th>Estado</th></tr></thead>
          <tbody>${filas}</tbody>
          <tfoot>
            <tr style="font-weight:700;border-top:2px solid var(--border)">
              <td colspan="4">${lista.length} reserva${lista.length === 1 ? '' : 's'} en ${calAnio}</td>
              <td>${totalNoches}</td>
              <td>${euro(totalEur)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>`;

    cont.querySelectorAll('tr[data-reserva]').forEach((tr) =>
      tr.addEventListener('click', () => {
        const rid = tr.dataset.reserva;
        cerrarPanel();
        if (typeof activarTab === 'function') activarTab('reservas');
        if (typeof Reservas !== 'undefined' && Reservas.abrirFicha) Reservas.abrirFicha(rid);
      }));
  }

  // Mapa 'YYYY-MM-DD' → { reserva, color, estado } para los días ocupados (entrada..salida-1).
  function construirOcupacion(reservas) {
    const map = new Map();
    for (const r of reservas) {
      if (!r.entrada || !r.salida) continue;
      const estado = r.tipo_reserva || '';
      const color = calEstados[estado] || CAL_COLOR_DEFECTO;
      const d = new Date(r.entrada + 'T00:00:00');
      const fin = new Date(r.salida + 'T00:00:00');
      while (d < fin) {
        const key = isoYMD(d.getFullYear(), d.getMonth() + 1, d.getDate());
        map.set(key, { reserva: r, color, estado: estado || 'Sin estado' });
        d.setDate(d.getDate() + 1);
      }
    }
    return map;
  }

  function renderLeyenda() {
    const cont = document.getElementById('alo-cal-leyenda');
    if (!cont) return;
    const items = (calEstadosActivos || []).map((e) =>
      `<span class="alo-cal-ley-item"><span class="alo-cal-ley-color" style="background:${esc(e.color)}"></span>${esc(e.nombre)}</span>`).join('');
    cont.innerHTML = items +
      `<span class="alo-cal-ley-item"><span class="alo-cal-ley-color" style="background:${CAL_COLOR_DEFECTO}"></span>Sin estado</span>`;
  }

  function renderMeses(ocupacion) {
    const grid = document.getElementById('alo-cal-grid');
    if (!grid) return;
    const hoyISO = (() => { const n = new Date(); return isoYMD(n.getFullYear(), n.getMonth() + 1, n.getDate()); })();
    let html = '<div class="alo-cal-meses">';
    for (let m = 1; m <= 12; m++) html += mesHTML(calAnio, m, ocupacion, hoyISO);
    html += '</div>';
    grid.innerHTML = html;

    grid.querySelectorAll('.alo-cal-dia.ocupado').forEach((cel) =>
      cel.addEventListener('click', () => {
        const rid = cel.dataset.reserva;
        if (!rid) return;
        cerrarPanel();
        if (typeof activarTab === 'function') activarTab('reservas');
        if (typeof Reservas !== 'undefined' && Reservas.abrirFicha) Reservas.abrirFicha(rid);
      }));
  }

  function mesHTML(y, m, ocupacion, hoyISO) {
    const total = diasDelMes(y, m);
    const offset = primerDiaLunes(y, m);
    let celdas = '';
    for (let i = 0; i < offset; i++) celdas += '<td class="alo-cal-dia vacio"></td>';
    for (let d = 1; d <= total; d++) {
      const iso = isoYMD(y, m, d);
      const occ = ocupacion.get(iso);
      const esHoy = iso === hoyISO ? ' hoy' : '';
      if (occ) {
        const r = occ.reserva;
        const tip = `${r.nombre_cliente || 'Reserva'} · ${fechaES(r.entrada)}–${fechaES(r.salida)} · ${occ.estado}`;
        celdas += `<td class="alo-cal-dia ocupado${esHoy}" style="background:${esc(occ.color)}" data-reserva="${r.id}" title="${esc(tip)}">${d}</td>`;
      } else {
        celdas += `<td class="alo-cal-dia${esHoy}">${d}</td>`;
      }
      if ((offset + d) % 7 === 0) celdas += '</tr><tr>';
    }
    return `
      <div class="alo-cal-mes">
        <div class="alo-cal-mes-titulo">${MESES[m - 1]}</div>
        <table class="alo-cal-tabla">
          <thead><tr>${DIAS_CAB.map((x) => `<th>${x}</th>`).join('')}</tr></thead>
          <tbody><tr>${celdas}</tr></tbody>
        </table>
      </div>`;
  }

  function renderResumen(ocupacion) {
    const cont = document.getElementById('alo-cal-resumen');
    if (!cont) return;
    // Noches ocupadas dentro del año seleccionado.
    let nochesOcup = 0;
    const prefijo = `${calAnio}-`;
    for (const k of ocupacion.keys()) if (k.startsWith(prefijo)) nochesOcup++;
    const totalAnio = esBisiesto(calAnio) ? 366 : 365;
    const pct = totalAnio ? (nochesOcup / totalAnio) * 100 : 0;
    cont.innerHTML = `
      <div class="alo-cal-resumen-fila">
        <span><strong>${nochesOcup}</strong> / ${totalAnio} noches ocupadas</span>
        <span class="alo-cal-resumen-pct">${pct1(pct)}</span>
      </div>
      <div class="alo-cal-barra"><div class="alo-cal-barra-fill" style="width:${Math.min(pct, 100)}%"></div></div>`;
  }

  // ==================== Modal alta / edición ====================
  function selOpts(valores, actual) {
    return '<option value="">—</option>' +
      valores.map((x) => `<option value="${esc(x)}"${actual === x ? ' selected' : ''}>${esc(x)}</option>`).join('');
  }

  async function formulario(id) {
    let a = {
      nombre: '', edificio: '', tipo: '', capacidad: '', notas: '',
      tipo_clasificacion: '', orientacion: '', situacion: '', bloque: '', escalera: '', piso: '', puerta: '',
      parking: '', ref_catastral: '', licencia_turistica: '', nra: '', pwd_wifi: '',
      en_garantia: 0, quitar_planning: 0,
    };
    if (id) {
      try { a = await API.get('/api/apartamentos/' + id); }
      catch (e) { return toast(e.message, 'error'); }
    }

    abrirModal(`
      <h3>${id ? 'Editar' : 'Nuevo'} alojamiento</h3>

      <div class="ficha-seccion-titulo">Datos del alojamiento</div>
      <div class="campo"><label>Nombre *</label><input id="f-nombre" value="${esc(a.nombre)}"></div>
      <div class="fila-campos">
        <div class="campo"><label>Tipo clasificación</label><select id="f-clasif">${selOpts(CLASIFICACIONES, a.tipo_clasificacion)}</select></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Orientación</label><select id="f-orientacion">${selOpts(ORIENTACIONES, a.orientacion)}</select></div>
        <div class="campo"><label>Situación</label><select id="f-situacion">${selOpts(SITUACIONES, a.situacion)}</select></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Escalera</label><input id="f-escalera" value="${esc(a.escalera)}"></div>
        <div class="campo"><label>Piso</label><input id="f-piso" value="${esc(a.piso)}"></div>
        <div class="campo"><label>Puerta</label><input id="f-puerta" value="${esc(a.puerta)}"></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Capacidad</label><input id="f-capacidad" type="number" min="0" value="${esc(a.capacidad)}"></div>
        <div class="campo"><label>Parking</label><input id="f-parking" value="${esc(a.parking)}"></div>
        <div class="campo"><label>Ref. Catastral</label><input id="f-ref-catastral" value="${esc(a.ref_catastral)}"></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Licencia Turística</label><input id="f-licencia" value="${esc(a.licencia_turistica)}"></div>
        <div class="campo"><label>NRA</label><input id="f-nra" value="${esc(a.nra)}"></div>
        <div class="campo"><label>Pwd Wifi</label><input id="f-pwd-wifi" value="${esc(a.pwd_wifi)}"></div>
      </div>
      <div class="alo-prop-info-modal">ℹ️ Los propietarios se gestionan desde la ficha del alojamiento → pestaña Propietario</div>
      <div class="campo"><label>Notas</label><textarea id="f-notas">${esc(a.notas)}</textarea></div>

      <div class="ficha-seccion-titulo">Configuración</div>
      <label class="alo-switch"><input type="checkbox" id="f-en-garantia"${a.en_garantia ? ' checked' : ''}><span class="alo-switch-track"></span> En garantía (precio cerrado)</label>
      <label class="alo-switch"><input type="checkbox" id="f-quitar-planning"${a.quitar_planning ? ' checked' : ''}><span class="alo-switch-track"></span> Quitar del planning</label>
      <div id="f-qp-aviso" class="alo-qp-aviso${a.quitar_planning ? '' : ' oculto'}">⚠️ Este apartamento no aparecerá en el planning</div>

      <div class="modal-acciones">
        <button class="btn-sec" id="f-cancelar">Cancelar</button>
        <button class="btn-pri" id="f-guardar">Guardar</button>
      </div>`);
    document.querySelector('.modal').classList.add('modal-ancho');

    document.getElementById('f-quitar-planning').addEventListener('change', (e) =>
      document.getElementById('f-qp-aviso').classList.toggle('oculto', !e.target.checked));
    document.getElementById('f-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('f-guardar').addEventListener('click', () => guardar(id));
  }

  async function guardar(id) {
    const nombre = val('f-nombre').trim();
    if (!nombre) return toast('El nombre es obligatorio', 'error');
    const body = {
      nombre,
      capacidad: val('f-capacidad'),
      notas: val('f-notas'),
      tipo_clasificacion: val('f-clasif'),
      orientacion: val('f-orientacion'),
      situacion: val('f-situacion'),
      escalera: val('f-escalera'),
      piso: val('f-piso'),
      puerta: val('f-puerta'),
      parking: val('f-parking'),
      ref_catastral: val('f-ref-catastral'),
      licencia_turistica: val('f-licencia'),
      nra: val('f-nra'),
      pwd_wifi: val('f-pwd-wifi'),
      en_garantia: document.getElementById('f-en-garantia').checked ? 1 : 0,
      quitar_planning: document.getElementById('f-quitar-planning').checked ? 1 : 0,
    };
    try {
      if (id) await API.put('/api/apartamentos/' + id, body);
      else await API.post('/api/apartamentos', body);
      cerrarModal();
      await cargar();
      if (typeof Planning !== 'undefined') Planning.cargar();
      if (id && fichaActual && String(fichaActual.id) === String(id)) await abrirFicha(id);
      toast('Alojamiento guardado', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ---- Borrar ----
  async function borrar(id) {
    if (!confirm('¿Eliminar este alojamiento? Sus reservas quedarán "Sin asignar".')) return;
    try {
      await API.del('/api/apartamentos/' + id);
      await cargar();
      if (typeof Planning !== 'undefined') Planning.cargar();
      toast('Alojamiento eliminado', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function val(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
  }

  // ==================== Modal importar (Avantio) ====================
  let importFile = null;
  function modalImportar() {
    importFile = null;
    abrirModal(`
      <h3>📥 Importar alojamientos desde Avantio</h3>
      <p class="lead-conv-info">ℹ️ Los apartamentos existentes conservan sus notas y configuración.</p>
      <div id="alo-imp-dz" class="cli-dropzone">
        <div class="cli-dz-texto">Arrastra aquí el archivo .xls/.xlsx o haz clic para elegirlo</div>
        <div id="alo-imp-nombre" class="cli-dz-nombre"></div>
        <input type="file" id="alo-imp-file" accept=".xls,.xlsx" hidden>
      </div>
      <div id="alo-imp-resultado" class="cli-imp-resultado oculto"></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="alo-imp-cancelar">Cerrar</button>
        <button class="btn-pri" id="alo-imp-guardar" disabled>Importar</button>
      </div>`);
    const dz = document.getElementById('alo-imp-dz');
    const input = document.getElementById('alo-imp-file');
    const elegir = (f) => {
      importFile = f || null;
      document.getElementById('alo-imp-nombre').textContent = f ? f.name : '';
      document.getElementById('alo-imp-guardar').disabled = !f;
    };
    dz.addEventListener('click', () => input.click());
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('arrastrando'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('arrastrando'));
    dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('arrastrando'); elegir(e.dataTransfer.files[0]); });
    input.addEventListener('change', () => elegir(input.files[0]));
    document.getElementById('alo-imp-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('alo-imp-guardar').addEventListener('click', importar);
  }

  async function importar() {
    if (!importFile) return;
    const btn = document.getElementById('alo-imp-guardar');
    const res = document.getElementById('alo-imp-resultado');
    btn.disabled = true; btn.textContent = 'Importando…';
    res.className = 'cli-imp-resultado';
    res.innerHTML = '<span class="rsv-trf-spinner"></span> Importando alojamientos…';
    try {
      const fd = new FormData();
      fd.append('archivo', importFile);
      const r = await fetch('/api/apartamentos/importar', { method: 'POST', body: fd, headers: authHeaders() });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Error al importar');
      const errs = (data.errores || []).length;
      res.innerHTML = `✅ <strong>${data.nuevos}</strong> nuevos, <strong>${data.actualizados}</strong> actualizados, <strong>${data.propietarios_vinculados}</strong> propietarios vinculados${errs ? `, <strong>${errs}</strong> errores` : ''}.`;
      toast('Importación completada', 'ok');
      await cargar();
      if (typeof Planning !== 'undefined') Planning.cargar();
    } catch (e) {
      res.innerHTML = `⚠️ ${esc(e.message)}`;
      toast(e.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Importar';
    }
  }

  function init() {
    crearPanel();
    document.getElementById('btn-nuevo-alojamiento').addEventListener('click', () => formulario(null));
    // Botón "Importar desde Avantio" junto a "Nuevo alojamiento" (inyectado por JS).
    const barra = document.querySelector('#vista-alojamientos .barra-herramientas');
    if (barra && !document.getElementById('btn-importar-alojamientos')) {
      const btn = document.createElement('button');
      btn.id = 'btn-importar-alojamientos';
      btn.className = 'btn-sec';
      btn.textContent = '📥 Importar desde Avantio';
      barra.appendChild(btn);
      btn.addEventListener('click', modalImportar);
    }
  }

  return { init, cargar, abrirFicha, formulario };
})();
