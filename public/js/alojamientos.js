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

  const ORIENTACIONES = ['Norte', 'Sur', 'Este', 'Oeste', 'Sureste', 'Suroeste', 'Noreste', 'Noroeste'];
  const SITUACIONES = ['Frontal', 'Lateral Principio', 'Lateral Medio', 'Lateral Final'];
  const CLASIFICACIONES = ['A', 'A+', 'A++', 'B', 'B+', 'C'];

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
    let h = badgeTih(a.tipo);
    if (a.tipo_clasificacion) h += ' ' + badgeClasif(a.tipo_clasificacion);
    if (a.quitar_planning) h += ' <span class="badge-estado inactivo">Sin planning</span>';
    return h;
  }

  // ==================== Tabla ====================
  async function cargar() {
    // ?todos=1: el módulo de Alojamientos necesita TODOS (incluidos los fuera del planning).
    const lista = await API.get('/api/apartamentos?todos=1');
    const tbody = document.querySelector('#tabla-alojamientos tbody');
    tbody.innerHTML = '';
    if (lista.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="color:#6b7280">No hay alojamientos todavía.</td></tr>';
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
        <td>${esc(a.edificio)}</td>
        <td>${tihTexto(a.tipo)}</td>
        <td>${a.capacidad ?? '—'}</td>
        <td>${esc(propietario) || '—'}</td>
        <td>${esc(a.notas)}</td>
        <td class="acciones">
          <button class="btn-mini" data-editar="${a.id}">Editar</button>
          <button class="btn-mini" data-borrar="${a.id}">Eliminar</button>
        </td>`;
      tbody.appendChild(tr);
    }
    tbody.querySelectorAll('[data-ficha]').forEach((el) =>
      el.addEventListener('click', () => abrirFicha(el.dataset.ficha)));
    tbody.querySelectorAll('[data-editar]').forEach((el) =>
      el.addEventListener('click', () => formulario(el.dataset.editar)));
    tbody.querySelectorAll('[data-borrar]').forEach((el) =>
      el.addEventListener('click', () => borrar(el.dataset.borrar)));
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
      if (!modalAbierto && panel.classList.contains('abierto')) cerrarPanel();
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
    if (!ANIOS_GASTO.includes(gastoAnio)) gastoAnio = ANIOS_GASTO[ANIOS_GASTO.length - 1];
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
      <div class="rsv-subpanel" data-asubpanel="gastos">${gastosShellHTML()}</div>`;

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

    return `
      <div class="ficha-seccion-titulo">Datos generales</div>
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

  function init() {
    crearPanel();
    document.getElementById('btn-nuevo-alojamiento').addEventListener('click', () => formulario(null));
  }

  return { init, cargar, abrirFicha, formulario };
})();
