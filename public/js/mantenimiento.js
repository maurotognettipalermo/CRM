// Módulo Mantenimiento: tablero kanban de 4 columnas (urgente / por hacer / en proceso /
// hecho) con drag & drop nativo HTML5, mini-tarjetas de resumen y alta de tareas.
// El panel lateral de detalle se implementa en la Tarea 3 (abrirDetalle es un stub aquí).

const Mantenimiento = (() => {
  let tareas = [];           // tareas cargadas del tablero
  let usuarios = [];         // usuarios para el modal de alta (bajo demanda)
  let apartamentos = [];     // apartamentos para el typeahead (bajo demanda)
  let reservasHoy = [];      // reservas activas hoy, para el preview de huésped
  let dragId = null;         // id de la tarea que se está arrastrando
  let modalAptoId = null;    // apartamento seleccionado en el typeahead del modal

  const COLS = [
    { estado: 'urgente',    titulo: 'URGENTE',    icono: '🔴', clase: 'mant-col-urgente' },
    { estado: 'pendiente',  titulo: 'POR HACER',  icono: '📋', clase: 'mant-col-pendiente' },
    { estado: 'en_proceso', titulo: 'EN PROCESO', icono: '🔄', clase: 'mant-col-proceso' },
    { estado: 'completada', titulo: 'HECHO',      icono: '✅', clase: 'mant-col-hecho' },
  ];

  // Columnas que arrancan colapsadas en móvil.
  const COLAPSADAS_MOVIL = ['en_proceso', 'completada'];
  function esMovil() { return window.matchMedia('(max-width: 767px)').matches; }

  // ---- Utilidades de fecha ----
  function hoyISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function masDiasISO(iso, n) {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function val(id) { const el = document.getElementById(id); return el ? el.value : ''; }

  // Extrae un teléfono del texto de observaciones (misma heurística que el backend).
  function extraerTelefono(texto) {
    if (!texto) return null;
    const s = String(texto);
    const etiquetado = s.match(/(?:tel[eéf]*|tfno|m[oó]vil)\.?\s*:?\s*(\+?[\d][\d\s.\-]{6,}\d)/i);
    if (etiquetado) return etiquetado[1].replace(/[\s.\-]/g, '');
    const internacional = s.match(/\+\d{1,3}[\s.\-]?\d[\d\s.\-]{6,}\d/);
    if (internacional) return internacional[0].replace(/[\s.\-]/g, '');
    const espanol = s.match(/(?<!\d)([679]\d{2}[\s.\-]?\d{3}[\s.\-]?\d{3})(?!\d)/);
    if (espanol) return espanol[1].replace(/[\s.\-]/g, '');
    return null;
  }

  // ==================== Carga ====================
  async function cargar() {
    await Promise.all([cargarResumen(), cargarTareas()]);
  }

  async function cargarResumen() {
    let r;
    try { r = await API.get('/api/mantenimiento/resumen'); } catch (e) { return; }
    const cont = document.getElementById('mant-resumen');
    if (!cont) return;
    const card = (ico, valor, lbl, clase) =>
      `<div class="mant-mini ${clase}"><div class="mant-mini-ico">${ico}</div><div class="mant-mini-val">${valor}</div><div class="mant-mini-lbl">${lbl}</div></div>`;
    cont.innerHTML =
      card('📋', r.total_abiertas || 0, 'Abiertas', 'mant-mini-azul') +
      card('🔴', r.urgentes || 0, 'Urgentes', 'mant-mini-rojo') +
      card('🔄', r.en_proceso || 0, 'En proceso', 'mant-mini-naranja') +
      card('✅', r.completadas_este_mes || 0, 'Completadas este mes', 'mant-mini-verde');
  }

  async function cargarTareas() {
    const cont = document.getElementById('mant-tablero');
    if (cont) cont.innerHTML = '<div class="mant-cargando">Cargando tareas…</div>';
    try {
      tareas = await API.get('/api/mantenimiento/tareas');
    } catch (e) {
      if (cont) cont.innerHTML = '<div class="mant-cargando">No se pudieron cargar las tareas.</div>';
      return toast(e.message, 'error');
    }
    renderTablero();
    enriquecerContadores();
  }

  // El listado no trae el nº de notas/fotos: se completa con el detalle de cada tarea y
  // se repinta el tablero una vez. Escala de oficina (pocas tareas abiertas).
  async function enriquecerContadores() {
    const pend = tareas.filter((t) => t.num_notas === undefined);
    if (!pend.length) return;
    await Promise.all(pend.map(async (t) => {
      try {
        const d = await API.get(`/api/mantenimiento/tareas/${t.id}`);
        t.num_notas = (d.notas || []).length;
        t.num_fotos = (d.fotos || []).length;
      } catch (e) { t.num_notas = 0; t.num_fotos = 0; }
    }));
    renderTablero();
  }

  // ==================== Render del tablero ====================
  function tareasDeColumna(estado) {
    let items = tareas.filter((t) => t.estado === estado);
    if (estado === 'completada') {
      // Solo las completadas en los últimos 30 días.
      const limite = masDiasISO(hoyISO(), -30);
      items = items.filter((t) => (t.completado_fecha || '').slice(0, 10) >= limite);
    }
    return items.slice().sort((a, b) => (a.posicion - b.posicion) || (a.id - b.id));
  }

  function renderTablero() {
    const cont = document.getElementById('mant-tablero');
    if (!cont) return;
    const movil = esMovil();
    cont.innerHTML = COLS.map((c) => {
      const items = tareasDeColumna(c.estado);
      const cards = items.map(cardHTML).join('') || '<div class="mant-col-vacia">Sin tareas</div>';
      // En móvil las columnas EN PROCESO y HECHO arrancan colapsadas (URGENTE y POR HACER
      // expandidas). En escritorio/tablet la clase no se aplica (el cuerpo se ve siempre).
      const colapsada = movil && COLAPSADAS_MOVIL.includes(c.estado) ? ' mant-col-colapsada' : '';
      const plural = items.length === 1 ? '' : 's';
      return `
        <div class="mant-col ${c.clase}${colapsada}">
          <div class="mant-col-cab">
            <span class="mant-col-tit">${c.icono} ${c.titulo}</span>
            <span class="mant-col-count">(${items.length})</span>
          </div>
          <div class="mant-col-hint">${items.length} tarea${plural} oculta${plural} — toca para ver</div>
          <div class="mant-col-body" data-estado="${c.estado}">${cards}</div>
        </div>`;
    }).join('');
    attachDrag();
    attachClicks();
  }

  function cardHTML(t) {
    const completada = t.estado === 'completada';
    const tipo = t.apartamento_tipo
      ? `<span class="mant-badge-tipo">${esc(tihTexto(t.apartamento_tipo))}</span>` : '';

    const cliente = t.cliente_nombre
      ? `<div class="mant-card-cli">👤 ${esc(t.cliente_nombre)}${t.cliente_telefono
          ? ` — 📞 <a href="tel:${esc(t.cliente_telefono)}" class="mant-tel">${esc(t.cliente_telefono)}</a>` : ''}</div>`
      : '';

    const asignado = `<div class="mant-card-asig">👷 ${t.asignado_nombre
      ? esc(t.asignado_nombre) : '<span class="mant-muted">Sin asignar</span>'}</div>`;

    const nn = t.num_notas, nf = t.num_fotos;
    const meta = `<div class="mant-card-meta">📝 ${nn == null ? '·' : nn} nota${nn === 1 ? '' : 's'} · 📷 ${nf == null ? '·' : nf} foto${nf === 1 ? '' : 's'}</div>`;

    const handle = completada ? '' : '<span class="mant-drag" title="Arrastrar para mover">≡</span>';
    const check = completada ? '' : `<button class="mant-check" data-completar="${t.id}" title="Marcar completada">✓</button>`;

    const pie = completada
      ? `<div class="mant-card-comp-pie">✅ ${esc(t.completado_nombre) || '—'} — ${fechaES((t.completado_fecha || '').slice(0, 10))}</div>`
      : `<div class="mant-card-fecha">📅 Creado: ${fechaES((t.fecha_creacion || '').slice(0, 10))}</div>`;

    return `
      <div class="mant-card${completada ? ' mant-card-hecho' : ''}" data-id="${t.id}" draggable="${completada ? 'false' : 'true'}">
        <div class="mant-card-top">${handle}${check}</div>
        <div class="mant-card-titulo">${esc(t.titulo)}</div>
        <div class="mant-card-apto">🏠 ${esc(t.apartamento_nombre)} ${tipo}</div>
        ${cliente}
        ${asignado}
        ${meta}
        ${pie}
      </div>`;
  }

  // ==================== Drag & Drop (HTML5 nativo) ====================
  function attachDrag() {
    const cont = document.getElementById('mant-tablero');
    if (!cont) return;

    cont.querySelectorAll('.mant-card[draggable="true"]').forEach((card) => {
      card.addEventListener('dragstart', (e) => {
        dragId = Number(card.dataset.id);
        card.classList.add('mant-card-drag');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(dragId));
      });
      card.addEventListener('dragend', () => {
        dragId = null;
        cont.querySelectorAll('.mant-card-drag').forEach((c) => c.classList.remove('mant-card-drag'));
        cont.querySelectorAll('.mant-col-drop').forEach((c) => c.classList.remove('mant-col-drop'));
      });
    });

    cont.querySelectorAll('.mant-col-body').forEach((col) => {
      col.addEventListener('dragover', (e) => {
        if (dragId == null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        col.classList.add('mant-col-drop');
      });
      col.addEventListener('dragleave', (e) => {
        if (!col.contains(e.relatedTarget)) col.classList.remove('mant-col-drop');
      });
      col.addEventListener('drop', (e) => {
        e.preventDefault();
        col.classList.remove('mant-col-drop');
        if (dragId == null) return;
        soltar(dragId, col.dataset.estado, calcularIndice(col, e.clientY));
      });
    });
  }

  // Índice de inserción dentro de la columna según la posición vertical del cursor.
  function calcularIndice(col, y) {
    const cards = [...col.querySelectorAll('.mant-card')].filter((c) => Number(c.dataset.id) !== dragId);
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) return i;
    }
    return cards.length;
  }

  async function soltar(id, estado, posicion) {
    try {
      if (estado === 'completada') {
        // Mover a "Hecho" ejecuta la lógica de completar (completado_por + fecha).
        await API.post(`/api/mantenimiento/tareas/${id}/completar`, {});
      } else {
        await API.post(`/api/mantenimiento/tareas/${id}/reordenar`, { posicion, estado });
      }
      await cargar();
    } catch (e) { toast(e.message, 'error'); }
  }

  // ==================== Clics en cards ====================
  function attachClicks() {
    const cont = document.getElementById('mant-tablero');
    if (!cont) return;

    // Colapsar/expandir columna (solo tiene efecto visual en móvil, vía CSS).
    cont.querySelectorAll('.mant-col-cab').forEach((cab) =>
      cab.addEventListener('click', () => cab.parentElement.classList.toggle('mant-col-colapsada')));

    cont.querySelectorAll('[data-completar]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        completarRapido(Number(b.dataset.completar));
      }));

    cont.querySelectorAll('.mant-card').forEach((card) =>
      card.addEventListener('click', (e) => {
        // Ignorar clics en el handle, el botón ✓ y el teléfono.
        if (e.target.closest('.mant-drag') || e.target.closest('.mant-check') || e.target.closest('.mant-tel')) return;
        abrirDetalle(Number(card.dataset.id));
      }));
  }

  async function completarRapido(id) {
    try {
      await API.post(`/api/mantenimiento/tareas/${id}/completar`, {});
      await cargar();
      toast('Tarea marcada como completada', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  }

  // ==================== Panel lateral de detalle ====================
  let detalleActual = null;   // tarea abierta en el panel
  let subirSel = [];          // File[] pendientes en el dropzone del panel
  let lbFotos = [];           // fotos abiertas en el lightbox
  let lbIdx = -1;

  function estadoBadge(e) {
    const m = {
      urgente:    ['🔴 Urgente', 'mant-bdg-urg'],
      pendiente:  ['📋 Por hacer', 'mant-bdg-pend'],
      en_proceso: ['🔄 En proceso', 'mant-bdg-proc'],
      completada: ['✅ Hecho', 'mant-bdg-hecho'],
    };
    const x = m[e] || m.pendiente;
    return `<span class="mant-bdg ${x[1]}">${x[0]}</span>`;
  }
  function inicial(n) { return (String(n || '?').trim()[0] || '?').toUpperCase(); }
  function avatarColor(n) {
    const cols = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#0ea5e9', '#ec4899', '#14b8a6'];
    let h = 0; const s = String(n || '?');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return cols[h % cols.length];
  }
  function fmtFechaHora(s) {
    if (!s) return '—';
    const [d, t] = String(s).split(' ');
    const p = d.split('-');
    if (p.length !== 3) return s;
    return `${p[2]}/${p[1]}/${p[0]}${t ? ' ' + t.slice(0, 5) : ''}`;
  }

  function crearPanelDetalle() {
    if (document.getElementById('mant-panel')) return;
    const fondo = document.createElement('div');
    fondo.id = 'mant-panel-fondo';
    fondo.className = 'panel-fondo';
    const panel = document.createElement('aside');
    panel.id = 'mant-panel';
    panel.className = 'panel-lateral';
    panel.setAttribute('aria-label', 'Detalle de tarea de mantenimiento');
    panel.innerHTML = `
      <header class="panel-cabecera">
        <div class="rsv-titulo-grupo">
          <h3 id="mant-d-titulo">Tarea</h3>
          <span id="mant-d-badge"></span>
        </div>
        <div class="panel-cabecera-acciones">
          <button id="mant-d-editar" class="btn-sec">✏️ Editar</button>
          <button id="mant-d-completar" class="btn-pri">✅ Completar</button>
          <button id="mant-d-cerrar" class="panel-cerrar" title="Cerrar">&times;</button>
        </div>
      </header>
      <div id="mant-d-cuerpo" class="panel-cuerpo"></div>`;
    document.body.appendChild(fondo);
    document.body.appendChild(panel);

    fondo.addEventListener('click', cerrarPanelDetalle);
    panel.querySelector('#mant-d-cerrar').addEventListener('click', cerrarPanelDetalle);
    panel.querySelector('#mant-d-editar').addEventListener('click', () => { if (detalleActual) modalEditar(detalleActual); });
    panel.querySelector('#mant-d-completar').addEventListener('click', completarDesdePanel);
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const lb = document.getElementById('mant-lightbox');
      if (lb && lb.classList.contains('abierto')) { e.stopPropagation(); cerrarLb(); return; }
      const modalAbierto = !document.getElementById('modal-fondo').classList.contains('oculto');
      if (!modalAbierto && panel.classList.contains('abierto')) cerrarPanelDetalle();
    }, true);
  }
  function abrirPanelDetalle() {
    document.getElementById('mant-panel-fondo').classList.add('abierto');
    document.getElementById('mant-panel').classList.add('abierto');
  }
  function cerrarPanelDetalle() {
    document.getElementById('mant-panel-fondo')?.classList.remove('abierto');
    document.getElementById('mant-panel')?.classList.remove('abierto');
    detalleActual = null;
  }

  async function abrirDetalle(id) {
    crearPanelDetalle();
    let d;
    try { d = await API.get(`/api/mantenimiento/tareas/${id}`); }
    catch (e) { return toast(e.message, 'error'); }
    detalleActual = d;
    subirSel = [];
    document.getElementById('mant-d-titulo').textContent = d.titulo || 'Tarea';
    document.getElementById('mant-d-badge').innerHTML = estadoBadge(d.estado);
    document.getElementById('mant-d-completar').classList.toggle('oculto', d.estado === 'completada');
    renderDetalle(d);
    abrirPanelDetalle();
  }

  // Recarga el detalle (tras una mutación) sin cerrar el panel, y repinta el tablero.
  async function recargarDetalle() {
    if (!detalleActual) return;
    const id = detalleActual.id;
    try { detalleActual = await API.get(`/api/mantenimiento/tareas/${id}`); }
    catch (e) { return toast(e.message, 'error'); }
    document.getElementById('mant-d-titulo').textContent = detalleActual.titulo || 'Tarea';
    document.getElementById('mant-d-badge').innerHTML = estadoBadge(detalleActual.estado);
    document.getElementById('mant-d-completar').classList.toggle('oculto', detalleActual.estado === 'completada');
    renderDetalle(detalleActual);
    cargar();  // refresca el tablero de fondo
  }

  function renderDetalle(d) {
    const sesion = (typeof Auth !== 'undefined' && Auth.sesion()) || {};
    const hoy = hoyISO();

    // ---- DATOS ----
    const tipo = d.apartamento_tipo ? `<span class="mant-badge-tipo">${esc(tihTexto(d.apartamento_tipo))}</span>` : '';
    const limitePasada = d.fecha_limite && d.fecha_limite < hoy && d.estado !== 'completada';
    const fechaLimite = d.fecha_limite
      ? `<span class="${limitePasada ? 'mant-limite-pasada' : ''}">${fechaES(d.fecha_limite)}${limitePasada ? ' ⚠️' : ''}</span>` : '—';
    const datos = `
      <div class="mant-d-seccion">
        <div class="mant-d-grid">
          <div class="mant-d-campo"><div class="mant-d-etq">Apartamento</div>
            <div class="mant-d-val"><a class="mant-link" data-ver-apto="${d.apartamento_id}">🏠 ${esc(d.apartamento_nombre)}</a> ${tipo}</div></div>
          <div class="mant-d-campo"><div class="mant-d-etq">Estado</div><div class="mant-d-val">${estadoBadge(d.estado)}</div></div>
          <div class="mant-d-campo"><div class="mant-d-etq">Asignado a</div>
            <div class="mant-d-val">${d.asignado_nombre ? esc(d.asignado_nombre) : '<span class="mant-muted">Sin asignar</span>'}</div></div>
          <div class="mant-d-campo"><div class="mant-d-etq">Fecha creación</div><div class="mant-d-val">${fmtFechaHora(d.fecha_creacion)}</div></div>
          <div class="mant-d-campo"><div class="mant-d-etq">Fecha límite</div><div class="mant-d-val">${fechaLimite}</div></div>
          <div class="mant-d-campo"><div class="mant-d-etq">Creado por</div><div class="mant-d-val">${d.created_by ? esc(d.created_by) : '—'}</div></div>
        </div>
      </div>`;

    // ---- CLIENTE (solo con reserva vinculada) ----
    let cliente = '';
    if (d.reserva) {
      const r = d.reserva;
      const tel = extraerTelefono(r.observaciones);
      // El rol mantenimiento ve nombre/teléfono/estancia pero NO el nº de reserva ni su ficha.
      const esMant = sesion.rol === 'mantenimiento';
      cliente = `
        <div class="mant-d-seccion">
          <div class="mant-d-titulo-sec">👤 Cliente</div>
          <div class="mant-d-cli-nombre">${esc(r.nombre_cliente) || '—'}</div>
          ${tel ? `<div class="mant-d-cli-linea">📞 <a href="tel:${esc(tel)}" class="mant-tel">${esc(tel)}</a></div>` : ''}
          <div class="mant-d-cli-linea">📅 ${fechaES(r.entrada)} → ${fechaES(r.salida)}</div>
          ${!esMant && r.numero_reserva ? `<div class="mant-d-cli-linea">Nº reserva: <a class="mant-link" data-ver-reserva="${r.id}">${esc(r.numero_reserva)}</a></div>` : ''}
        </div>`;
    }

    // ---- DESCRIPCIÓN ----
    const descripcion = `
      <div class="mant-d-seccion">
        <div class="mant-d-titulo-sec">📋 Descripción</div>
        <div class="mant-d-desc">${d.descripcion && String(d.descripcion).trim()
          ? esc(d.descripcion).replace(/\n/g, '<br>') : '<span class="mant-muted">Sin descripción</span>'}</div>
      </div>`;

    // ---- NOTAS (chat) ----
    const notasHTML = (d.notas || []).map((n) => {
      const propia = sesion.id != null && n.usuario_id === sesion.id;
      const puedeBorrar = propia || sesion.rol === 'administrador';
      return `
        <div class="mant-nota ${propia ? 'mant-nota-propia' : 'mant-nota-otro'}">
          <div class="mant-nota-avatar" style="background:${avatarColor(n.usuario_nombre)}">${inicial(n.usuario_nombre)}</div>
          <div class="mant-nota-burbuja">
            <div class="mant-nota-cab">
              <span class="mant-nota-autor">${esc(n.usuario_nombre) || 'Usuario'}</span>
              <span class="mant-nota-fecha">${fmtFechaHora(n.fecha)}</span>
              ${puedeBorrar ? `<button class="mant-nota-del" data-del-nota="${n.id}" title="Borrar nota">🗑</button>` : ''}
            </div>
            <div class="mant-nota-texto">${esc(n.texto).replace(/\n/g, '<br>')}</div>
          </div>
        </div>`;
    }).join('') || '<div class="mant-muted mant-notas-vacio">Sin notas todavía. Escribe la primera abajo.</div>';

    const notas = `
      <div class="mant-d-seccion">
        <div class="mant-d-titulo-sec">📝 Notas</div>
        <div class="mant-notas-lista" id="mant-notas-lista">${notasHTML}</div>
        <div class="mant-nota-input">
          <textarea id="mant-nota-texto" rows="2" placeholder="Escribe una nota..."></textarea>
          <button class="btn-pri" id="mant-nota-enviar">Enviar</button>
        </div>
      </div>`;

    // ---- FOTOS ----
    const fotos = (d.fotos || []);
    const fotosGrid = fotos.map((f, i) => `
      <div class="mant-foto" data-foto-idx="${i}">
        <img src="${esc(f.url)}" alt="" data-lb-idx="${i}">
        <button class="mant-foto-del" data-del-foto="${f.id}" title="Borrar foto">🗑</button>
      </div>`).join('');
    const fotosSec = `
      <div class="mant-d-seccion">
        <div class="mant-d-titulo-sec">📷 Fotos</div>
        <div class="mant-fotos-grid" id="mant-fotos-grid">${fotosGrid || '<div class="mant-muted">Sin fotos.</div>'}</div>
        <div class="alo-dropzone mant-dropzone" id="mant-dz">
          <div class="alo-dropzone-icono">📷</div>
          <div>Arrastra fotos aquí o <strong>haz clic para seleccionar</strong> (hasta 5)</div>
          <input type="file" id="mant-file" accept=".jpg,.jpeg,.png,.webp" multiple hidden>
        </div>
        <div class="alo-preview" id="mant-preview"></div>
        <div class="mant-subir-acc oculto" id="mant-subir-acc">
          <button class="btn-pri" id="mant-subir-btn">＋ Subir fotos</button>
        </div>
      </div>`;

    document.getElementById('mant-d-cuerpo').innerHTML = datos + cliente + descripcion + notas + fotosSec;
    wireDetalle(d, fotos);
  }

  function wireDetalle(d, fotos) {
    const cuerpo = document.getElementById('mant-d-cuerpo');

    // Apartamento → ficha de alojamiento.
    cuerpo.querySelector('[data-ver-apto]')?.addEventListener('click', () => {
      cerrarPanelDetalle();
      if (typeof Alojamientos !== 'undefined' && Alojamientos.abrirFicha) Alojamientos.abrirFicha(d.apartamento_id);
    });
    // Nº reserva → ficha de reserva.
    cuerpo.querySelector('[data-ver-reserva]')?.addEventListener('click', (e) => {
      const rid = e.currentTarget.dataset.verReserva;
      cerrarPanelDetalle();
      if (typeof activarTab === 'function') activarTab('reservas');
      if (typeof Reservas !== 'undefined' && Reservas.abrirFicha) Reservas.abrirFicha(rid);
    });

    // Notas: enviar + borrar.
    const txt = document.getElementById('mant-nota-texto');
    document.getElementById('mant-nota-enviar')?.addEventListener('click', enviarNota);
    txt?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarNota(); }
    });
    cuerpo.querySelectorAll('[data-del-nota]').forEach((b) =>
      b.addEventListener('click', () => borrarNota(Number(b.dataset.delNota))));
    // Scroll de notas al final (flujo conversacional).
    const lista = document.getElementById('mant-notas-lista');
    if (lista) lista.scrollTop = lista.scrollHeight;

    // Fotos: dropzone + lightbox + borrar.
    const dz = document.getElementById('mant-dz');
    const input = document.getElementById('mant-file');
    dz?.addEventListener('click', () => input.click());
    dz?.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('arrastrando'); });
    dz?.addEventListener('dragleave', () => dz.classList.remove('arrastrando'));
    dz?.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('arrastrando'); anadirFotos(e.dataTransfer.files); });
    input?.addEventListener('change', () => anadirFotos(input.files));
    document.getElementById('mant-subir-btn')?.addEventListener('click', subirFotos);
    cuerpo.querySelectorAll('[data-lb-idx]').forEach((img) =>
      img.addEventListener('click', () => abrirLb(fotos, Number(img.dataset.lbIdx))));
    cuerpo.querySelectorAll('[data-del-foto]').forEach((b) =>
      b.addEventListener('click', () => borrarFoto(Number(b.dataset.delFoto))));
  }

  async function enviarNota() {
    const ta = document.getElementById('mant-nota-texto');
    const texto = (ta.value || '').trim();
    if (!texto) return;
    const btn = document.getElementById('mant-nota-enviar');
    btn.disabled = true;
    try {
      await API.post(`/api/mantenimiento/tareas/${detalleActual.id}/notas`, { texto });
      ta.value = '';
      await recargarDetalle();
    } catch (e) { toast(e.message, 'error'); }
    finally { btn.disabled = false; }
  }

  async function borrarNota(notaId) {
    if (!confirm('¿Borrar esta nota?')) return;
    try {
      await API.del(`/api/mantenimiento/tareas/${detalleActual.id}/notas/${notaId}`);
      await recargarDetalle();
    } catch (e) { toast(e.message, 'error'); }
  }

  const EXT_FOTO = ['jpg', 'jpeg', 'png', 'webp'];
  function anadirFotos(fileList) {
    const nuevos = Array.from(fileList).filter((f) => EXT_FOTO.includes((f.name.split('.').pop() || '').toLowerCase()));
    if (Array.from(fileList).length && !nuevos.length) toast('Formato no admitido (solo JPG, PNG, WEBP)', 'error');
    for (const f of nuevos) {
      if (subirSel.length >= 5) { toast('Máximo 5 fotos', 'aviso'); break; }
      subirSel.push(f);
    }
    renderPreviewSubida();
  }
  function renderPreviewSubida() {
    const cont = document.getElementById('mant-preview');
    if (!cont) return;
    cont.innerHTML = '';
    subirSel.forEach((file, i) => {
      const div = document.createElement('div');
      div.className = 'alo-preview-item';
      div.innerHTML = '<img alt=""><button class="alo-preview-quitar" title="Quitar">✕</button>';
      const reader = new FileReader();
      reader.onload = (e) => { div.querySelector('img').src = e.target.result; };
      reader.readAsDataURL(file);
      div.querySelector('.alo-preview-quitar').addEventListener('click', () => { subirSel.splice(i, 1); renderPreviewSubida(); });
      cont.appendChild(div);
    });
    document.getElementById('mant-subir-acc')?.classList.toggle('oculto', !subirSel.length);
  }

  async function subirFotos() {
    if (!subirSel.length) return;
    const btn = document.getElementById('mant-subir-btn');
    btn.disabled = true; btn.textContent = 'Subiendo…';
    try {
      const fd = new FormData();
      subirSel.forEach((f) => fd.append('fotos', f));
      const r = await fetch(`/api/mantenimiento/tareas/${detalleActual.id}/fotos`, { method: 'POST', body: fd, headers: authHeaders() });
      if (!r.ok) {
        let msg = 'Error al subir fotos';
        try { msg = (await r.json()).error || msg; } catch (e) {}
        throw new Error(msg);
      }
      subirSel = [];
      await recargarDetalle();
      toast('Fotos subidas', 'ok');
    } catch (e) {
      toast(e.message, 'error');
      btn.disabled = false; btn.textContent = '＋ Subir fotos';
    }
  }

  async function borrarFoto(fotoId) {
    if (!confirm('¿Borrar esta foto?')) return;
    try {
      await API.del(`/api/mantenimiento/tareas/${detalleActual.id}/fotos/${fotoId}`);
      await recargarDetalle();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function completarDesdePanel() {
    if (!detalleActual) return;
    try {
      await API.post(`/api/mantenimiento/tareas/${detalleActual.id}/completar`, {});
      await recargarDetalle();
      toast('Tarea completada', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  }

  // ---- Modal editar ----
  async function modalEditar(d) {
    if (!usuarios.length) { try { usuarios = await API.get('/api/usuarios'); } catch (e) { usuarios = []; } }
    const optUsr = '<option value="">— Sin asignar —</option>' +
      usuarios.filter((u) => u.activo).map((u) =>
        `<option value="${u.id}"${d.asignado_a == u.id ? ' selected' : ''}>${esc(u.nombre)}</option>`).join('');
    const optEstado = [
      ['urgente', '🔴 Urgente'], ['pendiente', '📋 Por hacer'],
      ['en_proceso', '🔄 En proceso'], ['completada', '✅ Hecho'],
    ].map(([v, l]) => `<option value="${v}"${d.estado === v ? ' selected' : ''}>${l}</option>`).join('');

    abrirModal(`
      <h3>✏️ Editar tarea</h3>
      <div class="campo"><label>Título *</label><input id="me-titulo" value="${esc(d.titulo)}"></div>
      <div class="campo"><label>Descripción</label><textarea id="me-desc" rows="3">${esc(d.descripcion)}</textarea></div>
      <div class="campo"><label>Apartamento</label><input value="${esc(d.apartamento_nombre)}" disabled></div>
      <div class="fila-campos">
        <div class="campo"><label>Estado</label><select id="me-estado">${optEstado}</select></div>
        <div class="campo"><label>Asignar a</label><select id="me-asig">${optUsr}</select></div>
      </div>
      <div class="campo"><label>Fecha límite</label><input type="date" id="me-limite" value="${esc(d.fecha_limite || '')}"></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="me-cancelar">Cancelar</button>
        <button class="btn-pri" id="me-guardar">Guardar</button>
      </div>`);
    document.getElementById('me-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('me-guardar').addEventListener('click', async () => {
      const titulo = val('me-titulo').trim();
      if (!titulo) return toast('El título es obligatorio', 'error');
      const body = {
        titulo,
        descripcion: val('me-desc'),
        estado: val('me-estado'),
        asignado_a: val('me-asig') || null,
        fecha_limite: val('me-limite') || null,
      };
      const btn = document.getElementById('me-guardar');
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        await API.put(`/api/mantenimiento/tareas/${d.id}`, body);
        cerrarModal();
        await recargarDetalle();
        toast('Tarea actualizada', 'ok');
      } catch (e) {
        toast(e.message, 'error');
        btn.disabled = false; btn.textContent = 'Guardar';
      }
    });
  }

  // ---- Lightbox de fotos del panel ----
  function abrirLb(fotos, idx) {
    if (!fotos || !fotos.length) return;
    lbFotos = fotos; lbIdx = idx;
    let box = document.getElementById('mant-lightbox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'mant-lightbox';
      box.className = 'alo-lightbox';
      box.innerHTML = `
        <button class="alo-lb-cerrar" data-lb="cerrar" title="Cerrar">✕</button>
        <button class="alo-lb-nav alo-lb-prev" data-lb="prev" title="Anterior">◀</button>
        <figure class="alo-lb-fig"><img id="mant-lb-img" src="" alt=""></figure>
        <button class="alo-lb-nav alo-lb-next" data-lb="next" title="Siguiente">▶</button>`;
      document.body.appendChild(box);
      box.addEventListener('click', (e) => {
        const acc = e.target.closest('[data-lb]');
        if (acc) { const a = acc.dataset.lb; if (a === 'cerrar') cerrarLb(); else navLb(a === 'next' ? 1 : -1); return; }
        if (e.target === box) cerrarLb();
      });
      document.addEventListener('keydown', (e) => {
        const b = document.getElementById('mant-lightbox');
        if (!b || !b.classList.contains('abierto')) return;
        if (e.key === 'ArrowRight') { e.preventDefault(); navLb(1); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); navLb(-1); }
      }, true);
    }
    pintarLb();
    box.classList.add('abierto');
  }
  function pintarLb() {
    const f = lbFotos[lbIdx];
    if (!f) return cerrarLb();
    const img = document.getElementById('mant-lb-img');
    if (img) img.src = f.url;
    const box = document.getElementById('mant-lightbox');
    if (box) {
      const vis = lbFotos.length > 1 ? 'visible' : 'hidden';
      box.querySelector('.alo-lb-prev').style.visibility = vis;
      box.querySelector('.alo-lb-next').style.visibility = vis;
    }
  }
  function navLb(delta) {
    if (!lbFotos.length) return;
    lbIdx = (lbIdx + delta + lbFotos.length) % lbFotos.length;
    pintarLb();
  }
  function cerrarLb() {
    document.getElementById('mant-lightbox')?.classList.remove('abierto');
    lbIdx = -1;
  }

  // ==================== Modal "Nueva tarea" ====================
  // preAptoId (opcional): preselecciona un apartamento (lo usa la ficha de alojamiento).
  async function abrirModalNueva(preAptoId) {
    if (!apartamentos.length) {
      try { apartamentos = await API.get('/api/apartamentos?todos=1'); } catch (e) { apartamentos = []; }
    }
    if (!usuarios.length) {
      try { usuarios = await API.get('/api/usuarios'); } catch (e) { usuarios = []; }
    }
    // Reservas activas hoy (entrada <= hoy < salida) para el preview de huésped.
    try { const h = hoyISO(); reservasHoy = await API.get(`/api/reservas?desde=${h}&hasta=${h}`); }
    catch (e) { reservasHoy = []; }

    modalAptoId = null;
    const optUsr = '<option value="">— Sin asignar —</option>' +
      usuarios.filter((u) => u.activo).map((u) => `<option value="${u.id}">${esc(u.nombre)}</option>`).join('');

    abrirModal(`
      <h3>🔧 Nueva tarea de mantenimiento</h3>
      <div class="campo"><label>Título *</label><input id="mant-titulo" placeholder="Ej. Grifo del baño roto"></div>
      <div class="campo"><label>Descripción</label><textarea id="mant-desc" rows="3" placeholder="Detalles (opcional)"></textarea></div>
      <div class="campo mant-ta">
        <label>Apartamento *</label>
        <input id="mant-ap-input" class="input-buscar" autocomplete="off" placeholder="Escribe para buscar...">
        <div id="mant-ap-res" class="mant-ta-res oculto"></div>
        <div id="mant-ap-huesped" class="mant-huesped oculto"></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Estado inicial</label>
          <select id="mant-estado"><option value="pendiente">📋 Por hacer</option><option value="urgente">🔴 Urgente</option></select></div>
        <div class="campo"><label>Asignar a</label><select id="mant-asig">${optUsr}</select></div>
      </div>
      <div class="campo"><label>Fecha límite</label><input type="date" id="mant-limite"></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="mant-cancelar">Cancelar</button>
        <button class="btn-pri" id="mant-guardar">Crear tarea</button>
      </div>`);

    const inp = document.getElementById('mant-ap-input');
    inp.addEventListener('input', () => {
      modalAptoId = null;
      document.getElementById('mant-ap-huesped').classList.add('oculto');
      renderTypeahead(inp.value);
    });
    inp.addEventListener('focus', () => renderTypeahead(inp.value));
    // Cerrar la lista de sugerencias al hacer clic fuera del campo.
    document.getElementById('modal-contenido').addEventListener('click', (e) => {
      if (!e.target.closest('.mant-ta')) document.getElementById('mant-ap-res')?.classList.add('oculto');
    });

    document.getElementById('mant-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('mant-guardar').addEventListener('click', guardarNueva);

    if (preAptoId != null) {
      modalAptoId = Number(preAptoId);
      const apto = apartamentos.find((a) => a.id === modalAptoId);
      if (apto) { document.getElementById('mant-ap-input').value = apto.nombre; mostrarHuesped(modalAptoId); }
    }
  }

  function renderTypeahead(q) {
    const res = document.getElementById('mant-ap-res');
    if (!res) return;
    const t = (q || '').trim().toLowerCase();
    const lista = apartamentos.filter((a) => !t || (a.nombre || '').toLowerCase().includes(t)).slice(0, 8);
    if (!lista.length) { res.classList.add('oculto'); res.innerHTML = ''; return; }
    res.innerHTML = lista.map((a) => `<div class="mant-ta-item" data-ap="${a.id}">${esc(a.nombre)}</div>`).join('');
    res.classList.remove('oculto');
    res.querySelectorAll('.mant-ta-item').forEach((it) =>
      it.addEventListener('click', () => {
        modalAptoId = Number(it.dataset.ap);
        const apto = apartamentos.find((a) => a.id === modalAptoId);
        document.getElementById('mant-ap-input').value = apto ? apto.nombre : '';
        res.classList.add('oculto');
        mostrarHuesped(modalAptoId);
      }));
  }

  function mostrarHuesped(aptoId) {
    const div = document.getElementById('mant-ap-huesped');
    if (!div) return;
    const r = reservasHoy.find((x) => x.apartamento_id === aptoId);
    if (!r) { div.classList.add('oculto'); div.innerHTML = ''; return; }
    const tel = extraerTelefono(r.observaciones);
    div.innerHTML = `🏠 Huésped actual: <strong>${esc(r.nombre_cliente)}</strong>${tel ? ` — 📞 ${esc(tel)}` : ''}`;
    div.classList.remove('oculto');
  }

  async function guardarNueva() {
    const titulo = val('mant-titulo').trim();
    if (!titulo) return toast('El título es obligatorio', 'error');
    if (!modalAptoId) return toast('Selecciona un apartamento', 'error');

    const body = {
      apartamento_id: modalAptoId,
      titulo,
      descripcion: val('mant-desc'),
      estado: val('mant-estado') || 'pendiente',
      asignado_a: val('mant-asig') || null,
      fecha_limite: val('mant-limite') || null,
    };
    const btn = document.getElementById('mant-guardar');
    btn.disabled = true; btn.textContent = 'Creando…';
    try {
      await API.post('/api/mantenimiento/tareas', body);
      cerrarModal();
      await cargar();
      toast('Tarea de mantenimiento creada', 'ok');
    } catch (e) {
      toast(e.message, 'error');
      btn.disabled = false; btn.textContent = 'Crear tarea';
    }
  }

  // Al pasar de móvil a escritorio, quita los colapsos para que se vea todo.
  function ajustarColapsoMovil() {
    const cont = document.getElementById('mant-tablero');
    if (!cont || esMovil()) return;
    cont.querySelectorAll('.mant-col-colapsada').forEach((c) => c.classList.remove('mant-col-colapsada'));
  }

  // ==================== Init ====================
  function init() {
    document.getElementById('mant-nueva')?.addEventListener('click', () => abrirModalNueva());
    window.addEventListener('resize', ajustarColapsoMovil);
  }

  // nuevaTareaPara(aptoId): abre el modal de alta con el apartamento preseleccionado.
  function nuevaTareaPara(aptoId) { return abrirModalNueva(aptoId); }

  return { init, cargar, abrirDetalle, nuevaTareaPara };
})();
