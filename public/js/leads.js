// Módulo Comercial (Leads): captación de clientes de alquiler vacacional.
// Resumen + sub-pestañas Leads (tabla con filtros, ficha en panel lateral, alta/edición,
// notas tipo chat, conversión a reserva) y Plantillas (CRUD de plantillas de email con
// placeholders y preview). Las propuestas de email se completan en la Tarea 3.

const Leads = (() => {
  // Estados del lead: valor en BD, etiqueta visible y clase de badge.
  const ESTADOS = [
    { v: 'nuevo', l: 'Nuevo', c: 'lead-bdg-nuevo' },
    { v: 'contactado', l: 'Contactado', c: 'lead-bdg-contactado' },
    { v: 'propuesta_enviada', l: 'Propuesta enviada', c: 'lead-bdg-propuesta' },
    { v: 'esperando_respuesta', l: 'Esperando respuesta', c: 'lead-bdg-esperando' },
    { v: 'reservado', l: 'Reservado', c: 'lead-bdg-reservado' },
    { v: 'descartado', l: 'Descartado', c: 'lead-bdg-descartado' },
  ];

  // Placeholders disponibles en las plantillas de email.
  const PLACEHOLDERS = ['{nombre}', '{apartamento}', '{fecha_entrada}', '{fecha_salida}', '{tipo}', '{capacidad}', '{zona}', '{precio}', '{empresa}'];

  let leads = [];
  let fichaActual = null;       // lead abierto en el panel
  let busqueda = '';
  let fEstado = new Set(ESTADOS.map((e) => e.v));  // todos por defecto
  let fAtendido = '';
  let fDesde = '';
  let fHasta = '';

  let plantillas = [];
  let plConstruido = false;
  let aptosCache = [];          // typeahead de apartamentos
  let aptosOk = false;
  let usuariosCache = [];       // select "atendido por"
  let modalAptoId = null;       // apartamento seleccionado en el modal de lead
  let empresaCache = null;      // razón social principal (placeholder {empresa})

  // ==================== Helpers ====================
  function val(id) { const el = document.getElementById(id); return el ? el.value : ''; }
  function euro(n) {
    if (n === null || n === undefined || n === '') return '—';
    const v = Math.round(Number(n));
    if (!isFinite(v)) return '—';
    return v.toLocaleString('de-DE') + ' €';
  }
  function estadoMeta(v) { return ESTADOS.find((e) => e.v === v) || ESTADOS[0]; }
  function estadoBadge(v) {
    const m = estadoMeta(v);
    return `<span class="lead-bdg ${m.c}">${esc(m.l)}</span>`;
  }
  function inicial(n) { return (String(n || '?').trim()[0] || '?').toUpperCase(); }
  function avatarColor(n) {
    let h = 0; const s = String(n || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return `hsl(${h},55%,55%)`;
  }
  function dato(etq, valor) {
    return `<div class="campo-ficha"><div class="etq">${etq}</div><div class="val">${valor}</div></div>`;
  }
  // Las fechas de auditoría vienen de datetime('now') (UTC): se interpretan como UTC.
  function relativo(iso) {
    if (!iso) return '—';
    const d = new Date(String(iso).replace(' ', 'T') + 'Z');
    if (isNaN(d.getTime())) return fechaES(String(iso).slice(0, 10));
    const seg = Math.floor((Date.now() - d.getTime()) / 1000);
    if (seg < 60) return 'hace un momento';
    const min = Math.floor(seg / 60);
    if (min < 60) return `hace ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return h === 1 ? 'hace 1 hora' : `hace ${h} horas`;
    const dias = Math.floor(h / 24);
    if (dias === 1) return 'ayer';
    if (dias < 7) return `hace ${dias} días`;
    if (dias < 30) { const s = Math.floor(dias / 7); return s === 1 ? 'hace 1 semana' : `hace ${s} semanas`; }
    return fechaES(String(iso).slice(0, 10));
  }
  function fmtFechaHora(iso) {
    if (!iso) return '';
    const d = new Date(String(iso).replace(' ', 'T') + 'Z');
    if (isNaN(d.getTime())) return esc(iso);
    return d.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  // ==================== Init ====================
  function init() {
    // Sub-pestañas.
    const subtabs = document.getElementById('lead-subtabs');
    if (subtabs) {
      subtabs.querySelectorAll('.subtab').forEach((b) =>
        b.addEventListener('click', () => activarSub(b.dataset.sub)));
    }
    document.getElementById('lead-buscar')?.addEventListener('input', (e) => { busqueda = e.target.value; renderTabla(); });
    document.getElementById('lead-nuevo')?.addEventListener('click', () => modalLead(null));

    // Filtros.
    const fBtn = document.getElementById('lead-filtros-btn');
    const fPanel = document.getElementById('lead-filtros-panel');
    if (fBtn && fPanel) {
      fBtn.addEventListener('click', (e) => { e.stopPropagation(); construirFiltros(); fPanel.classList.toggle('oculto'); });
      document.addEventListener('click', (e) => {
        if (!fPanel.contains(e.target) && e.target !== fBtn && !fBtn.contains(e.target)) fPanel.classList.add('oculto');
      });
    }
  }

  function activarSub(sub) {
    document.querySelectorAll('#lead-subtabs .subtab').forEach((b) =>
      b.classList.toggle('activo', b.dataset.sub === sub));
    document.querySelectorAll('#vista-comercial .sub-panel').forEach((p) =>
      p.classList.toggle('activo', p.dataset.panelSub === sub));
    if (sub === 'plantillas') { construirPlantillas(); cargarPlantillas(); }
  }

  // ==================== Carga ====================
  async function cargar() {
    await Promise.all([cargarResumen(), cargarLeads(), cargarUsuarios()]);
  }

  async function cargarUsuarios() {
    if (usuariosCache.length) return;
    try { usuariosCache = await API.get('/api/usuarios'); } catch (e) { usuariosCache = []; }
  }

  async function cargarResumen() {
    let r;
    try { r = await API.get('/api/leads/resumen'); } catch (e) { return; }
    const cont = document.getElementById('lead-resumen');
    if (!cont) return;
    const card = (ico, valor, lbl, clase) =>
      `<div class="vta-mini ${clase}"><div class="vta-mini-ico">${ico}</div><div class="vta-mini-val">${valor}</div><div class="vta-mini-lbl">${lbl}</div></div>`;
    cont.innerHTML =
      card('🔵', r.nuevos || 0, 'Nuevos', 'vta-mini-azul') +
      card('📧', r.propuestas_enviadas || 0, 'Propuestas enviadas', 'vta-mini-naranja') +
      card('⏳', r.esperando || 0, 'Esperando respuesta', 'lead-mini-amarillo') +
      card('✅', r.reservados || 0, 'Reservados', 'vta-mini-verde') +
      card('📊', `${r.conversion_rate || 0}%`, 'Tasa conversión', 'vta-mini-morado');
  }

  async function cargarLeads() {
    const tbody = document.querySelector('#tabla-leads tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="vta-cargando">Cargando leads…</td></tr>';
    try {
      leads = await API.get('/api/leads');
    } catch (e) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="vta-cargando">No se pudieron cargar los leads.</td></tr>';
      return toast(e.message, 'error');
    }
    renderTabla();
  }

  // ==================== Tabla + filtros ====================
  function filtrados() {
    const q = busqueda.trim().toLowerCase();
    return leads.filter((l) => {
      if (!fEstado.has(l.estado)) return false;
      if (fAtendido && l.atendido_por !== fAtendido) return false;
      const f = (l.created_at || '').slice(0, 10);
      if (fDesde && f < fDesde) return false;
      if (fHasta && f > fHasta) return false;
      if (q) {
        const txt = `${l.nombre || ''} ${l.email || ''} ${l.telefono || ''} ${l.apartamento_nombre || ''}`.toLowerCase();
        if (!txt.includes(q)) return false;
      }
      return true;
    });
  }

  function renderTabla() {
    const tbody = document.querySelector('#tabla-leads tbody');
    if (!tbody) return;
    const lista = filtrados();
    actualizarContador(lista.length);
    actualizarBadgeFiltros();

    if (!leads.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="vta-vacio">No hay leads todavía. Crea el primero con «＋ Nuevo lead».</td></tr>';
      return;
    }
    if (!lista.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="vta-vacio">Ningún lead coincide con los filtros.</td></tr>';
      return;
    }
    tbody.innerHTML = lista.map(filaHTML).join('');

    tbody.querySelectorAll('tr[data-ficha]').forEach((tr) =>
      tr.addEventListener('click', (e) => {
        if (e.target.closest('[data-editar]') || e.target.closest('[data-borrar]') || e.target.closest('a')) return;
        abrirFicha(tr.dataset.ficha);
      }));
    tbody.querySelectorAll('[data-editar]').forEach((b) =>
      b.addEventListener('click', (e) => { e.stopPropagation(); modalLead(leads.find((l) => l.id == b.dataset.editar)); }));
    tbody.querySelectorAll('[data-borrar]').forEach((b) =>
      b.addEventListener('click', (e) => { e.stopPropagation(); borrar(leads.find((l) => l.id == b.dataset.borrar)); }));
  }

  function filaHTML(l) {
    const contacto = [
      l.telefono ? `<a class="vta-link" href="tel:${esc(l.telefono)}" title="Llamar">${esc(l.telefono)}</a>` : '',
      l.email ? `<a class="vta-link lead-email-trunc" href="mailto:${esc(l.email)}" title="${esc(l.email)}">${esc(l.email)}</a>` : '',
    ].filter(Boolean).join('<br>') || '<span class="vta-muted">—</span>';
    const apto = l.apartamento_nombre
      ? esc(l.apartamento_nombre)
      : '<span class="vta-muted">Sin definir</span>';
    const fechas = (l.fecha_entrada || l.fecha_salida)
      ? `${fechaES(l.fecha_entrada) || '—'} → ${fechaES(l.fecha_salida) || '—'}`
      : '<span class="vta-muted">—</span>';
    return `
      <tr data-ficha="${l.id}">
        <td><strong class="lead-nombre">${esc(l.nombre)}</strong></td>
        <td class="lead-contacto">${contacto}</td>
        <td>${apto}</td>
        <td>${fechas}</td>
        <td>${estadoBadge(l.estado)}</td>
        <td class="lead-actividad" title="${esc(l.updated_at || '')}">${relativo(l.updated_at)}</td>
        <td class="vta-acciones">
          <button class="btn-icono" data-editar="${l.id}" title="Editar">✏️</button>
          <button class="btn-icono" data-borrar="${l.id}" title="Eliminar">🗑</button>
        </td>
      </tr>`;
  }

  function actualizarContador(n) {
    const c = document.getElementById('lead-contador');
    if (c) c.textContent = `${n} lead${n === 1 ? '' : 's'}`;
  }

  function nFiltrosActivos() {
    let n = 0;
    if (fEstado.size !== ESTADOS.length) n++;
    if (fAtendido) n++;
    if (fDesde || fHasta) n++;
    return n;
  }
  function actualizarBadgeFiltros() {
    const b = document.getElementById('lead-filtros-badge');
    if (!b) return;
    const n = nFiltrosActivos();
    b.textContent = n;
    b.classList.toggle('oculto', n === 0);
  }

  function construirFiltros() {
    const panel = document.getElementById('lead-filtros-panel');
    if (!panel || panel.dataset.listo) return;
    const estItems = ESTADOS.map((e) =>
      `<label class="rsv-f-op"><input type="checkbox" data-f="estado" value="${e.v}" checked><span class="rsv-f-op-label">${e.l}</span></label>`).join('');
    const usrOpts = '<option value="">Todos</option>' +
      usuariosCache.map((u) => `<option value="${esc(u.username)}">${esc(u.nombre || u.username)}</option>`).join('');
    panel.innerHTML = `
      <div class="rsv-f-grupo">
        <div class="rsv-f-titulo">Estado</div>
        <div class="rsv-f-ops">${estItems}</div>
      </div>
      <div class="rsv-f-grupo">
        <div class="rsv-f-titulo">Atendido por</div>
        <select id="lead-f-atendido" class="select-filtro">${usrOpts}</select>
      </div>
      <div class="rsv-f-grupo">
        <div class="rsv-f-titulo">Creado entre</div>
        <div class="vta-f-precio">
          <input type="date" id="lead-f-desde" class="input-fecha">
          <input type="date" id="lead-f-hasta" class="input-fecha">
        </div>
      </div>
      <div class="rsv-f-acciones">
        <button class="btn-sec" id="lead-f-limpiar">Limpiar filtros</button>
      </div>`;

    panel.querySelectorAll('[data-f="estado"]').forEach((cb) =>
      cb.addEventListener('change', () => {
        if (cb.checked) fEstado.add(cb.value); else fEstado.delete(cb.value);
        renderTabla();
      }));
    panel.querySelector('#lead-f-atendido').addEventListener('change', (e) => { fAtendido = e.target.value; renderTabla(); });
    panel.querySelector('#lead-f-desde').addEventListener('change', (e) => { fDesde = e.target.value; renderTabla(); });
    panel.querySelector('#lead-f-hasta').addEventListener('change', (e) => { fHasta = e.target.value; renderTabla(); });
    panel.querySelector('#lead-f-limpiar').addEventListener('click', () => {
      fEstado = new Set(ESTADOS.map((e) => e.v)); fAtendido = ''; fDesde = ''; fHasta = '';
      panel.querySelectorAll('[data-f="estado"]').forEach((cb) => { cb.checked = true; });
      panel.querySelector('#lead-f-atendido').value = '';
      panel.querySelector('#lead-f-desde').value = '';
      panel.querySelector('#lead-f-hasta').value = '';
      renderTabla();
    });
    panel.dataset.listo = '1';
  }

  // ==================== Panel lateral (ficha) ====================
  function crearPanel() {
    if (document.getElementById('lead-panel')) return;
    const fondo = document.createElement('div');
    fondo.id = 'lead-panel-fondo';
    fondo.className = 'panel-fondo';
    const panel = document.createElement('aside');
    panel.id = 'lead-panel';
    panel.className = 'panel-lateral';
    panel.setAttribute('aria-label', 'Ficha de lead');
    panel.innerHTML = `
      <header class="panel-cabecera">
        <div class="rsv-titulo-grupo">
          <h3 id="lead-d-titulo">Lead</h3>
          <span id="lead-d-badge"></span>
        </div>
        <div class="panel-cabecera-acciones">
          <div class="vta-estado-drop">
            <button id="lead-d-estado" class="btn-sec">Cambiar estado ▾</button>
            <div id="lead-d-estado-menu" class="vta-estado-menu oculto"></div>
          </div>
          <button id="lead-d-propuesta" class="btn-sec">📧 Enviar propuesta</button>
          <button id="lead-d-convertir" class="btn-pri">✅ Convertir a reserva</button>
          <button id="lead-d-editar" class="btn-sec">✏️ Editar</button>
          <button id="lead-d-cerrar" class="panel-cerrar" title="Cerrar">&times;</button>
        </div>
      </header>
      <div id="lead-d-cuerpo" class="panel-cuerpo"></div>`;
    document.body.appendChild(fondo);
    document.body.appendChild(panel);
    fondo.addEventListener('click', cerrarPanel);
    panel.querySelector('#lead-d-cerrar').addEventListener('click', cerrarPanel);
    panel.querySelector('#lead-d-editar').addEventListener('click', () => { if (fichaActual) modalLead(fichaActual); });
    panel.querySelector('#lead-d-convertir').addEventListener('click', () => { if (fichaActual) modalConvertir(fichaActual); });
    panel.querySelector('#lead-d-propuesta').addEventListener('click', () => { if (fichaActual) modalPropuesta(fichaActual); });

    const menu = panel.querySelector('#lead-d-estado-menu');
    menu.innerHTML = ESTADOS.map((e) => `<button class="vta-estado-op" data-est="${e.v}">${estadoBadge(e.v)}</button>`).join('');
    panel.querySelector('#lead-d-estado').addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('oculto'); });
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('[data-est]');
      if (!b) return;
      menu.classList.add('oculto');
      cambiarEstado(b.dataset.est);
    });
    document.addEventListener('click', () => menu.classList.add('oculto'));
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const modalAbierto = !document.getElementById('modal-fondo').classList.contains('oculto');
      if (!modalAbierto && panel.classList.contains('abierto')) cerrarPanel();
    }, true);
  }
  function abrirPanel() {
    document.getElementById('lead-panel-fondo').classList.add('abierto');
    document.getElementById('lead-panel').classList.add('abierto');
  }
  function cerrarPanel() {
    document.getElementById('lead-panel-fondo')?.classList.remove('abierto');
    document.getElementById('lead-panel')?.classList.remove('abierto');
    fichaActual = null;
  }

  // La ficha trae el hilo en `notas_chat` (array) y el texto libre en `notas` (sin conflicto).
  function enriquecer(d) {
    d._chat = Array.isArray(d.notas_chat) ? d.notas_chat : [];
    d._notasTexto = typeof d.notas === 'string' ? d.notas : '';
    return d;
  }

  async function abrirFicha(id) {
    crearPanel();
    let d;
    try { d = await API.get('/api/leads/' + id); }
    catch (e) { return toast(e.message, 'error'); }
    fichaActual = enriquecer(d);
    pintarCabecera(fichaActual);
    renderCuerpo(fichaActual);
    abrirPanel();
  }
  async function recargarFicha() {
    if (!fichaActual) return;
    const id = fichaActual.id;
    try { fichaActual = enriquecer(await API.get('/api/leads/' + id)); } catch (e) { return; }
    pintarCabecera(fichaActual);
    renderCuerpo(fichaActual);
  }
  function pintarCabecera(d) {
    document.getElementById('lead-d-titulo').textContent = d.nombre || 'Lead';
    document.getElementById('lead-d-badge').innerHTML = estadoBadge(d.estado);
    // El botón "Convertir" se oculta si ya está reservado.
    const conv = document.getElementById('lead-d-convertir');
    if (conv) conv.classList.toggle('oculto', d.estado === 'reservado');
  }

  async function cambiarEstado(estado) {
    if (!fichaActual) return;
    try {
      await API.put('/api/leads/' + fichaActual.id, { estado });
      fichaActual.estado = estado;
      pintarCabecera(fichaActual);
      toast('Estado actualizado a ' + estadoMeta(estado).l, 'ok');
      cargarLeads(); cargarResumen();
    } catch (e) { toast(e.message, 'error'); }
  }

  function renderCuerpo(d) {
    const sesion = Auth.sesion() || {};

    // Banner si está convertido en reserva.
    let banner = '';
    if (d.estado === 'reservado' && d.reserva_id) {
      banner = `<div class="lead-banner-reservado">✅ Convertido en reserva
        <a class="lead-banner-link" data-reserva="${d.reserva_id}">#${d.reserva_id}</a></div>`;
    }

    // DATOS DEL LEAD
    const aptoVal = d.apartamento_id
      ? `<a class="vta-link" data-apto="${d.apartamento_id}">${esc(d.apartamento_nombre || d.apartamento_nombre_actual || 'Ver apartamento')}</a>`
      : (d.apartamento_nombre ? esc(d.apartamento_nombre) : '<span class="vta-muted">Sin definir</span>');
    const fechas = (d.fecha_entrada || d.fecha_salida)
      ? `${fechaES(d.fecha_entrada) || '—'} → ${fechaES(d.fecha_salida) || '—'}` : '—';
    const datos = `
      <div class="vta-d-seccion">
        <div class="vta-d-titulo-sec">📋 Datos del lead</div>
        <div class="vta-d-grid">
          ${dato('Nombre', esc(d.nombre) || '—')}
          ${dato('Teléfono', d.telefono ? `<a class="vta-link" href="tel:${esc(d.telefono)}">${esc(d.telefono)}</a>` : '—')}
          ${dato('Email', d.email ? `<a class="vta-link" href="mailto:${esc(d.email)}">${esc(d.email)}</a>` : '—')}
          ${dato('Personas', d.personas != null && d.personas !== '' ? esc(d.personas) : '—')}
          ${dato('Apartamento interesado', aptoVal)}
          ${dato('Fechas', fechas)}
          ${dato('Presupuesto', euro(d.presupuesto))}
          ${dato('Atendido por', esc(d.atendido_por) || '—')}
          ${dato('Creado', `${relativo(d.created_at)} <span class="vta-muted">(${fmtFechaHora(d.created_at)})</span>`)}
        </div>
        ${d._notasTexto ? `<div class="lead-d-notas-campo">${esc(d._notasTexto).replace(/\n/g, '<br>')}</div>` : ''}
      </div>`;

    // PROPUESTAS ENVIADAS
    const props = (d.propuestas || []).map((p) => {
      const bdg = p.enviada
        ? `<span class="lead-prop-bdg lead-prop-enviada">Enviada ✓${p.fecha_envio ? ' · ' + fmtFechaHora(p.fecha_envio) : ''}</span>`
        : '<span class="lead-prop-bdg lead-prop-borrador">Borrador</span>';
      const acciones = `
        <button class="btn-icono" data-prop-ver="${p.id}" title="Ver contenido">👁</button>
        ${!p.enviada ? `<button class="btn-icono" data-prop-enviar="${p.id}" title="Enviar ahora">📧</button>` : ''}`;
      return `
        <div class="lead-prop-item">
          <div class="lead-prop-cab">
            <span class="lead-prop-fecha">${fmtFechaHora(p.created_at)}</span>
            <span class="lead-prop-cab-der">${bdg}<span class="lead-prop-acc">${acciones}</span></span>
          </div>
          <div class="lead-prop-asunto">${esc(p.asunto)}</div>
          <div class="lead-prop-meta">${p.precio_propuesto != null ? euro(p.precio_propuesto) : ''}</div>
        </div>`;
    }).join('') || '<div class="vta-muted lead-prop-vacio">Sin propuestas enviadas.</div>';
    const propuestas = `
      <div class="vta-d-seccion">
        <div class="vta-d-titulo-sec">📧 Propuestas enviadas
          <button class="btn-sec lead-prop-nueva" id="lead-d-prop-nueva">📧 Nueva propuesta</button>
        </div>
        <div class="lead-prop-lista">${props}</div>
      </div>`;

    // NOTAS (chat). El hilo viene en d._chat (ver enriquecer()).
    const chat = (d._chat || []).map((n) => {
      const propia = sesion.nombre && n.usuario_nombre === sesion.nombre;
      return `
        <div class="mant-nota ${propia ? 'mant-nota-propia' : 'mant-nota-otro'}">
          <div class="mant-nota-avatar" style="background:${avatarColor(n.usuario_nombre)}">${inicial(n.usuario_nombre)}</div>
          <div class="mant-nota-burbuja">
            <div class="mant-nota-cab">
              <span class="mant-nota-autor">${esc(n.usuario_nombre) || 'Usuario'}</span>
              <span class="mant-nota-fecha">${fmtFechaHora(n.fecha)}</span>
              <button class="mant-nota-del" data-del-nota="${n.id}" title="Borrar nota">🗑</button>
            </div>
            <div class="mant-nota-texto">${esc(n.texto).replace(/\n/g, '<br>')}</div>
          </div>
        </div>`;
    }).join('') || '<div class="mant-muted mant-notas-vacio">Sin notas todavía. Escribe la primera abajo.</div>';
    const notas = `
      <div class="vta-d-seccion">
        <div class="vta-d-titulo-sec">📝 Notas</div>
        <div class="mant-notas-lista" id="lead-notas-lista">${chat}</div>
        <div class="mant-nota-input">
          <textarea id="lead-nota-texto" rows="2" placeholder="Escribe una nota..."></textarea>
          <button class="btn-pri" id="lead-nota-enviar">Enviar</button>
        </div>
      </div>`;

    const cuerpo = document.getElementById('lead-d-cuerpo');
    cuerpo.innerHTML = banner + datos + propuestas + notas;

    // Enlaces.
    cuerpo.querySelector('[data-reserva]')?.addEventListener('click', () => {
      activarTab('reservas');
      if (typeof Reservas !== 'undefined' && Reservas.abrirFicha) Reservas.abrirFicha(d.reserva_id);
    });
    cuerpo.querySelector('[data-apto]')?.addEventListener('click', () => {
      activarTab('alojamientos');
      if (typeof Alojamientos !== 'undefined' && Alojamientos.abrirFicha) Alojamientos.abrirFicha(d.apartamento_id);
    });
    document.getElementById('lead-d-prop-nueva')?.addEventListener('click', () => modalPropuesta(d));
    cuerpo.querySelectorAll('[data-prop-ver]').forEach((b) =>
      b.addEventListener('click', () => verPropuesta((d.propuestas || []).find((p) => p.id == b.dataset.propVer))));
    cuerpo.querySelectorAll('[data-prop-enviar]').forEach((b) =>
      b.addEventListener('click', () => enviarPropuestaExistente((d.propuestas || []).find((p) => p.id == b.dataset.propEnviar))));

    // Notas: enviar + borrar.
    const txt = document.getElementById('lead-nota-texto');
    document.getElementById('lead-nota-enviar')?.addEventListener('click', enviarNota);
    txt?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarNota(); }
    });
    cuerpo.querySelectorAll('[data-del-nota]').forEach((b) =>
      b.addEventListener('click', () => borrarNota(Number(b.dataset.delNota))));
    const lista = document.getElementById('lead-notas-lista');
    if (lista) lista.scrollTop = lista.scrollHeight;
  }

  async function enviarNota() {
    if (!fichaActual) return;
    const ta = document.getElementById('lead-nota-texto');
    const texto = (ta.value || '').trim();
    if (!texto) return;
    try {
      await API.post(`/api/leads/${fichaActual.id}/notas`, { texto });
      ta.value = '';
      await recargarFicha();
    } catch (e) { toast(e.message, 'error'); }
  }
  async function borrarNota(notaId) {
    if (!fichaActual) return;
    try {
      await API.del(`/api/leads/${fichaActual.id}/notas/${notaId}`);
      await recargarFicha();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function borrar(l) {
    if (!l) return;
    if (!confirm(`¿Eliminar el lead "${l.nombre}"?`)) return;
    try {
      await API.del('/api/leads/' + l.id);
      toast('Lead eliminado', 'ok');
      if (fichaActual && fichaActual.id === l.id) cerrarPanel();
      cargarLeads(); cargarResumen();
    } catch (e) { toast(e.message, 'error'); } // 409 si reservado
  }

  // ==================== Typeahead apartamentos ====================
  async function asegurarAptos() {
    if (aptosOk) return;
    try { aptosCache = await API.get('/api/apartamentos?todos=1'); aptosOk = true; }
    catch (e) { aptosCache = []; }
  }
  function renderTA(cont, lista, label, onPick) {
    if (!cont) return;
    const items = lista.slice(0, 8);
    if (!items.length) { cont.classList.add('oculto'); cont.innerHTML = ''; return; }
    cont.innerHTML = items.map((it, i) => `<div class="vta-ta-item" data-i="${i}">${label(it)}</div>`).join('');
    cont.classList.remove('oculto');
    cont.querySelectorAll('.vta-ta-item').forEach((el) =>
      el.addEventListener('click', () => onPick(items[Number(el.dataset.i)])));
  }

  // ==================== Modal alta/edición de lead ====================
  async function modalLead(lead) {
    await asegurarAptos();
    const ed = !!lead;
    modalAptoId = lead ? (lead.apartamento_id || null) : null;
    const aptoNombre = lead && lead.apartamento_id
      ? (aptosCache.find((a) => a.id == lead.apartamento_id) || {}).nombre || lead.apartamento_nombre || ''
      : '';
    const notasTexto = ed ? (lead._notasTexto != null ? lead._notasTexto : (lead.notas || '')) : '';

    abrirModal(`
      <h3>${ed ? 'Editar lead' : 'Nuevo lead'}</h3>
      <div class="campo"><label>Nombre *</label><input id="lf-nombre" value="${ed ? esc(lead.nombre) : ''}"></div>
      <div class="fila-campos">
        <div class="campo"><label>Teléfono</label><input id="lf-telefono" value="${ed ? esc(lead.telefono) || '' : ''}"></div>
        <div class="campo"><label>Email</label><input id="lf-email" type="email" value="${ed ? esc(lead.email) || '' : ''}"></div>
      </div>
      <div class="campo vta-ta">
        <label>Apartamento de interés</label>
        <input id="lf-apto-input" class="input-buscar" autocomplete="off" placeholder="Buscar apartamento..." value="${esc(aptoNombre)}">
        <div id="lf-apto-res" class="vta-ta-res oculto"></div>
        <small class="lead-hint">Déjalo vacío si aún no hay apartamento concreto.</small>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Fecha entrada</label><input type="date" id="lf-entrada" value="${ed ? esc(lead.fecha_entrada) || '' : ''}"></div>
        <div class="campo"><label>Fecha salida</label><input type="date" id="lf-salida" value="${ed ? esc(lead.fecha_salida) || '' : ''}"></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Personas</label><input type="number" id="lf-personas" min="1" value="${ed && lead.personas != null ? esc(lead.personas) : ''}"></div>
        <div class="campo"><label>Presupuesto (€)</label><input type="number" id="lf-presupuesto" min="0" step="0.01" value="${ed && lead.presupuesto != null ? esc(lead.presupuesto) : ''}"></div>
      </div>
      <div class="campo"><label>Notas</label><textarea id="lf-notas" rows="3">${esc(notasTexto)}</textarea></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="lf-cancelar">Cancelar</button>
        <button class="btn-pri" id="lf-guardar">${ed ? 'Guardar cambios' : 'Crear lead'}</button>
      </div>`);

    const aptoInput = document.getElementById('lf-apto-input');
    const aptoRes = document.getElementById('lf-apto-res');
    aptoInput.addEventListener('input', () => {
      modalAptoId = null;
      const q = aptoInput.value.trim().toLowerCase();
      renderTA(aptoRes, aptosCache.filter((a) => (a.nombre || '').toLowerCase().includes(q)),
        (a) => esc(a.nombre),
        (a) => { modalAptoId = a.id; aptoInput.value = a.nombre; aptoRes.classList.add('oculto'); });
    });
    document.getElementById('modal-contenido')?.addEventListener('click', (e) => {
      if (!e.target.closest('.vta-ta')) aptoRes.classList.add('oculto');
    });

    document.getElementById('lf-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('lf-guardar').addEventListener('click', () => guardarLead(ed ? lead.id : null, aptoInput.value.trim()));
  }

  async function guardarLead(id, aptoTexto) {
    const nombre = val('lf-nombre').trim();
    if (!nombre) return toast('El nombre es obligatorio', 'error');
    const cuerpo = {
      nombre,
      telefono: val('lf-telefono').trim(),
      email: val('lf-email').trim(),
      apartamento_id: modalAptoId,
      fecha_entrada: val('lf-entrada'),
      fecha_salida: val('lf-salida'),
      personas: val('lf-personas'),
      presupuesto: val('lf-presupuesto'),
      notas: val('lf-notas'),
    };
    // Si escribió texto pero no eligió de la lista, no mandamos apartamento_id (queda libre).
    if (!modalAptoId) cuerpo.apartamento_id = '';
    const btn = document.getElementById('lf-guardar');
    btn.disabled = true;
    try {
      if (id) {
        await API.put('/api/leads/' + id, cuerpo);
        toast('Lead actualizado', 'ok');
      } else {
        await API.post('/api/leads', cuerpo);
        toast('Lead creado', 'ok');
      }
      cerrarModal();
      await cargarLeads(); cargarResumen();
      if (id && fichaActual && fichaActual.id === id) await recargarFicha();
    } catch (e) {
      toast(e.message, 'error');
      btn.disabled = false;
    }
  }

  // ==================== Modal convertir a reserva ====================
  async function modalConvertir(lead) {
    await asegurarAptos();
    let aptoId = lead.apartamento_id || null;
    const aptoNombre = aptoId ? (aptosCache.find((a) => a.id == aptoId) || {}).nombre || lead.apartamento_nombre || '' : '';
    // Precio por defecto: el de la última propuesta (orden DESC) o el presupuesto del lead.
    const ultimaProp = (lead.propuestas || []).find((p) => p.precio_propuesto != null);
    const precioDef = ultimaProp ? ultimaProp.precio_propuesto : (lead.presupuesto != null ? lead.presupuesto : '');
    const fechasTxt = (lead.fecha_entrada || lead.fecha_salida)
      ? `${fechaES(lead.fecha_entrada) || '—'} → ${fechaES(lead.fecha_salida) || '—'}` : '—';
    abrirModal(`
      <h3>Convertir lead en reserva</h3>
      <div class="lead-conv-datos">
        <div><span class="etq">Cliente</span> <strong>${esc(lead.nombre)}</strong></div>
        <div><span class="etq">Apartamento (lead)</span> ${esc(aptoNombre) || '<span class="vta-muted">Sin definir</span>'}</div>
        <div><span class="etq">Fechas (lead)</span> ${fechasTxt}</div>
        <div><span class="etq">Personas</span> ${lead.personas != null ? esc(lead.personas) : '—'}</div>
      </div>
      <div class="campo vta-ta">
        <label>Apartamento *</label>
        <input id="lc-apto-input" class="input-buscar" autocomplete="off" placeholder="Buscar apartamento..." value="${esc(aptoNombre)}">
        <div id="lc-apto-res" class="vta-ta-res oculto"></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Fecha entrada *</label><input type="date" id="lc-entrada" value="${esc(lead.fecha_entrada) || ''}"></div>
        <div class="campo"><label>Fecha salida *</label><input type="date" id="lc-salida" value="${esc(lead.fecha_salida) || ''}"></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Personas</label><input type="number" id="lc-personas" min="1" value="${lead.personas != null ? esc(lead.personas) : ''}"></div>
        <div class="campo"><label>Precio total (€)</label><input type="number" id="lc-precio" min="0" step="0.01" value="${precioDef !== '' ? esc(precioDef) : ''}"></div>
      </div>
      <div class="campo"><label>Notas</label><textarea id="lc-notas" rows="2" placeholder="Notas sobre la reserva (opcional)"></textarea></div>
      <p class="lead-conv-info">ℹ️ Se creará una reserva nueva y el lead se marcará como «Reservado».</p>
      <div class="modal-acciones">
        <button class="btn-sec" id="lc-cancelar">Cancelar</button>
        <button class="btn-pri" id="lc-guardar">✅ Crear reserva</button>
      </div>`);

    const aptoInput = document.getElementById('lc-apto-input');
    const aptoRes = document.getElementById('lc-apto-res');
    aptoInput.addEventListener('input', () => {
      aptoId = null;
      const q = aptoInput.value.trim().toLowerCase();
      renderTA(aptoRes, aptosCache.filter((a) => (a.nombre || '').toLowerCase().includes(q)),
        (a) => esc(a.nombre),
        (a) => { aptoId = a.id; aptoInput.value = a.nombre; aptoRes.classList.add('oculto'); });
    });
    document.getElementById('modal-contenido')?.addEventListener('click', (e) => {
      if (!e.target.closest('.vta-ta')) aptoRes.classList.add('oculto');
    });

    document.getElementById('lc-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('lc-guardar').addEventListener('click', async () => {
      const entrada = val('lc-entrada'); const salida = val('lc-salida');
      if (!aptoId) return toast('Selecciona un apartamento', 'error');
      if (!entrada || !salida) return toast('Las fechas de entrada y salida son obligatorias', 'error');
      const btn = document.getElementById('lc-guardar');
      btn.disabled = true; btn.textContent = 'Creando…';
      try {
        const r = await API.post(`/api/leads/${lead.id}/convertir`, {
          apartamento_id: aptoId, fecha_entrada: entrada, fecha_salida: salida,
          personas: val('lc-personas'), precio_total: val('lc-precio'),
        });
        // El endpoint de conversión no guarda notas: si las hay, las dejamos como nota del lead.
        const notas = val('lc-notas').trim();
        if (notas) { try { await API.post(`/api/leads/${lead.id}/notas`, { texto: notas }); } catch (e) {} }
        cerrarModal();
        toast(`Lead convertido — Reserva ${r.numero_reserva} creada`, 'ok');
        await cargarLeads(); cargarResumen();
        if (fichaActual && fichaActual.id === lead.id) await recargarFicha();
      } catch (e) {
        toast(e.message, 'error');
        btn.disabled = false; btn.textContent = '✅ Crear reserva';
      }
    });
  }

  // ==================== Envío de propuestas ====================
  async function asegurarEmpresa() {
    if (empresaCache !== null) return;
    try { const rs = await API.get('/api/ajustes/razones-sociales'); empresaCache = (rs && rs[0] && rs[0].razon_social) || ''; }
    catch (e) { empresaCache = ''; }
  }
  async function asegurarPlantillas() {
    if (plantillas.length) return;
    try { plantillas = await API.get('/api/leads/plantillas'); } catch (e) { plantillas = []; }
  }
  async function cargarFotosApto(id) {
    if (!id) return [];
    try { return await API.get(`/api/apartamentos/${id}/fotos`); } catch (e) { return []; }
  }
  async function calcularPrecioApto(id, entrada, salida) {
    if (!id || !entrada || !salida) return null;
    try {
      const r = await API.get(`/api/tarifas/calcular?apartamento_id=${id}&entrada=${entrada}&salida=${salida}`);
      return r && r.precio_total != null ? r.precio_total : null;
    } catch (e) { return null; } // 400 si falta tarifa en alguna fecha
  }
  // Sustituye los placeholders {…} de una plantilla con los datos del contexto.
  function aplicarPlaceholders(texto, ctx) {
    if (!texto) return '';
    return PLACEHOLDERS.reduce((acc, ph) => acc.split(ph).join(ctx[ph] != null ? String(ctx[ph]) : ''), texto);
  }

  async function modalPropuesta(lead) {
    await Promise.all([asegurarAptos(), asegurarEmpresa(), asegurarPlantillas()]);
    const ultimaProp = (lead.propuestas || []).find((p) => p.precio_propuesto != null);
    const st = {
      paso: 1,
      email: lead.email || '',
      aptoId: lead.apartamento_id || null,
      aptoNombre: lead.apartamento_id ? (aptosCache.find((a) => a.id == lead.apartamento_id) || {}).nombre || lead.apartamento_nombre || '' : '',
      precio: ultimaProp ? ultimaProp.precio_propuesto : (lead.presupuesto != null ? lead.presupuesto : ''),
      plantillaId: '',
      asunto: '',
      mensaje: '',
      fotos: [],
      fotosSel: new Set(),
      enviando: false,
    };

    // Carga inicial de fotos y precio del apartamento prerrellenado.
    async function recargarApto() {
      st.fotos = await cargarFotosApto(st.aptoId);
      st.fotosSel = new Set(st.fotos.map((f) => f.id)); // todas marcadas por defecto
      if ((st.precio === '' || st.precio == null) && st.aptoId && lead.fecha_entrada && lead.fecha_salida) {
        const p = await calcularPrecioApto(st.aptoId, lead.fecha_entrada, lead.fecha_salida);
        if (p != null) st.precio = p;
      }
    }
    if (st.aptoId) await recargarApto();

    function ctxPlaceholders() {
      const a = aptosCache.find((x) => x.id == st.aptoId) || {};
      const precioNum = st.precio !== '' && st.precio != null && isFinite(Number(st.precio))
        ? Number(st.precio).toLocaleString('de-DE') : '';
      return {
        '{nombre}': lead.nombre || '',
        '{apartamento}': st.aptoNombre || a.nombre || '',
        '{fecha_entrada}': fechaES(lead.fecha_entrada) || '',
        '{fecha_salida}': fechaES(lead.fecha_salida) || '',
        '{precio}': precioNum,
        '{empresa}': empresaCache || '',
        '{tipo}': a.tipo_clasificacion || '',
        '{capacidad}': a.capacidad != null ? a.capacidad : '',
        '{zona}': a.situacion || a.edificio || '',
      };
    }

    function render() {
      if (st.paso === 1) renderPaso1(); else renderPaso2();
    }

    function renderPaso1() {
      const plOpts = '<option value="">— Elegir plantilla —</option>' +
        plantillas.map((p) => `<option value="${p.id}" ${st.plantillaId == p.id ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('');
      abrirModal(`
        <h3>📧 Enviar propuesta · <span class="vta-muted">paso 1 de 2</span></h3>
        <div class="campo"><label>Email destino *</label><input id="lp-email" type="email" value="${esc(st.email)}" placeholder="cliente@email.com"></div>
        <div class="campo vta-ta">
          <label>Apartamento</label>
          <input id="lp-apto-input" class="input-buscar" autocomplete="off" placeholder="Buscar apartamento..." value="${esc(st.aptoNombre)}">
          <div id="lp-apto-res" class="vta-ta-res oculto"></div>
        </div>
        <div class="fila-campos">
          <div class="campo"><label>Precio propuesto (€)</label><input id="lp-precio" type="number" min="0" step="0.01" value="${st.precio !== '' && st.precio != null ? esc(st.precio) : ''}"></div>
          <div class="campo"><label>Plantilla</label><select id="lp-plantilla">${plOpts}</select></div>
        </div>
        <div class="campo"><label>Asunto</label><input id="lp-asunto" value="${esc(st.asunto)}"></div>
        <div class="campo"><label>Mensaje</label><textarea id="lp-mensaje" rows="9">${esc(st.mensaje)}</textarea></div>
        <div class="modal-acciones">
          <button class="btn-sec" id="lp-cancelar">Cancelar</button>
          <button class="btn-pri" id="lp-siguiente">Siguiente: fotos →</button>
        </div>`);

      const emailEl = document.getElementById('lp-email');
      const precioEl = document.getElementById('lp-precio');
      const asuntoEl = document.getElementById('lp-asunto');
      const mensajeEl = document.getElementById('lp-mensaje');
      emailEl.addEventListener('input', () => { st.email = emailEl.value; });
      precioEl.addEventListener('input', () => { st.precio = precioEl.value; });
      asuntoEl.addEventListener('input', () => { st.asunto = asuntoEl.value; });
      mensajeEl.addEventListener('input', () => { st.mensaje = mensajeEl.value; });

      // Typeahead apartamento.
      const aptoInput = document.getElementById('lp-apto-input');
      const aptoRes = document.getElementById('lp-apto-res');
      aptoInput.addEventListener('input', () => {
        st.aptoId = null; st.aptoNombre = aptoInput.value;
        const q = aptoInput.value.trim().toLowerCase();
        renderTA(aptoRes, aptosCache.filter((a) => (a.nombre || '').toLowerCase().includes(q)),
          (a) => esc(a.nombre),
          async (a) => {
            st.aptoId = a.id; st.aptoNombre = a.nombre; aptoInput.value = a.nombre; aptoRes.classList.add('oculto');
            await recargarApto();
            const pEl = document.getElementById('lp-precio');
            if (pEl && (pEl.value === '' )) { pEl.value = st.precio !== '' && st.precio != null ? st.precio : ''; }
          });
      });
      document.getElementById('modal-contenido')?.addEventListener('click', (e) => {
        if (!e.target.closest('.vta-ta')) aptoRes.classList.add('oculto');
      });

      // Plantilla: rellena asunto + mensaje con placeholders aplicados.
      document.getElementById('lp-plantilla').addEventListener('change', (e) => {
        st.plantillaId = e.target.value;
        const pl = plantillas.find((p) => p.id == st.plantillaId);
        if (!pl) return;
        const ctx = ctxPlaceholders();
        st.asunto = aplicarPlaceholders(pl.asunto, ctx);
        st.mensaje = aplicarPlaceholders(pl.cuerpo, ctx);
        document.getElementById('lp-asunto').value = st.asunto;
        document.getElementById('lp-mensaje').value = st.mensaje;
      });

      document.getElementById('lp-cancelar').addEventListener('click', cerrarModal);
      document.getElementById('lp-siguiente').addEventListener('click', () => {
        if (!st.email.trim()) return toast('Indica el email de destino', 'error');
        if (!st.asunto.trim() || !st.mensaje.trim()) return toast('Asunto y mensaje son obligatorios', 'error');
        st.paso = 2; render();
      });
    }

    function renderPaso2() {
      const n = st.fotos.length;
      const sel = st.fotosSel.size;
      const grid = n
        ? st.fotos.map((f) => `
            <label class="lead-foto-item">
              <input type="checkbox" data-foto="${f.id}" ${st.fotosSel.has(f.id) ? 'checked' : ''}>
              <img src="${esc(f.url)}" alt="">
            </label>`).join('')
        : '<div class="vta-muted">Este apartamento no tiene fotos en la galería.</div>';
      const thumbsPrev = st.fotos.filter((f) => st.fotosSel.has(f.id))
        .map((f) => `<img class="lead-prev-thumb" src="${esc(f.url)}" alt="">`).join('');
      abrirModal(`
        <h3>📧 Enviar propuesta · <span class="vta-muted">paso 2 de 2</span></h3>
        <div class="lead-fotos-cab">
          <span class="vta-d-titulo-sec">Fotos a adjuntar</span>
          <span class="lead-fotos-cont" id="lp-fotos-cont">${sel} de ${n} fotos seleccionadas</span>
        </div>
        <div class="lead-fotos-grid">${grid}</div>
        <div class="lead-prev">
          <div class="vta-d-titulo-sec">Vista previa del email</div>
          <div class="lead-preview-asunto"><strong>Para:</strong> ${esc(st.email)}</div>
          <div class="lead-preview-asunto"><strong>Asunto:</strong> ${esc(st.asunto)}</div>
          <div class="lead-preview-cuerpo">${esc(st.mensaje).replace(/\n/g, '<br>')}</div>
          <div class="lead-prev-thumbs" id="lp-prev-thumbs">${thumbsPrev}</div>
        </div>
        <div class="modal-acciones lead-prop-acciones-modal">
          <button class="btn-sec" id="lp-atras">← Anterior</button>
          <button class="btn-sec" id="lp-borrador">💾 Guardar borrador</button>
          <button class="btn-pri" id="lp-enviar">📧 Enviar ahora</button>
        </div>`);

      document.querySelectorAll('[data-foto]').forEach((cb) =>
        cb.addEventListener('change', () => {
          const id = Number(cb.dataset.foto);
          if (cb.checked) st.fotosSel.add(id); else st.fotosSel.delete(id);
          document.getElementById('lp-fotos-cont').textContent = `${st.fotosSel.size} de ${st.fotos.length} fotos seleccionadas`;
          const tp = document.getElementById('lp-prev-thumbs');
          if (tp) tp.innerHTML = st.fotos.filter((f) => st.fotosSel.has(f.id)).map((f) => `<img class="lead-prev-thumb" src="${esc(f.url)}" alt="">`).join('');
        }));

      document.getElementById('lp-atras').addEventListener('click', () => { st.paso = 1; render(); });
      document.getElementById('lp-borrador').addEventListener('click', () => guardarPropuesta(false));
      document.getElementById('lp-enviar').addEventListener('click', () => guardarPropuesta(true));
    }

    function payload() {
      return {
        plantilla_id: st.plantillaId || null,
        apartamento_id: st.aptoId || null,
        precio_propuesto: st.precio !== '' ? st.precio : null,
        foto_ids: Array.from(st.fotosSel),
        email_destino: st.email.trim(),
        asunto: st.asunto.trim(),
        mensaje: st.mensaje,
      };
    }

    async function guardarPropuesta(enviar) {
      if (!st.email.trim()) { st.paso = 1; render(); return toast('Indica el email de destino', 'error'); }
      if (!st.asunto.trim() || !st.mensaje.trim()) { st.paso = 1; render(); return toast('Asunto y mensaje son obligatorios', 'error'); }
      const btnB = document.getElementById('lp-borrador');
      const btnE = document.getElementById('lp-enviar');
      if (btnB) btnB.disabled = true;
      if (btnE) { btnE.disabled = true; btnE.textContent = enviar ? `Enviando propuesta con ${st.fotosSel.size} fotos…` : 'Guardando…'; }
      try {
        const r = await API.post(`/api/leads/${lead.id}/propuestas`, payload());
        if (enviar) {
          const env = await API.post(`/api/leads/${lead.id}/propuestas/${r.id}/enviar`, { email_destino: st.email.trim() });
          if (env && env.ok === false) {
            const msg = /smtp|auth|conn|email|535|EAUTH|ECONN/i.test(env.error || '')
              ? 'No se pudo enviar: revisa la configuración de correo en Ajustes'
              : (env.error || 'No se pudo enviar el email');
            throw new Error(msg);
          }
          toast(`Propuesta enviada a ${st.email.trim()}`, 'ok');
        } else {
          toast('Borrador guardado', 'ok');
        }
        cerrarModal();
        await cargarLeads(); cargarResumen();
        if (fichaActual && fichaActual.id === lead.id) await recargarFicha();
      } catch (e) {
        toast(e.message, 'error');
        if (btnB) btnB.disabled = false;
        if (btnE) { btnE.disabled = false; btnE.textContent = '📧 Enviar ahora'; }
      }
    }

    render();
  }

  // Enviar una propuesta borrador ya existente (desde la lista de la ficha).
  async function enviarPropuestaExistente(p) {
    if (!p || !fichaActual) return;
    if (!confirm(`¿Enviar la propuesta "${p.asunto}" por email?`)) return;
    try {
      const env = await API.post(`/api/leads/${fichaActual.id}/propuestas/${p.id}/enviar`, {});
      if (env && env.ok === false) {
        const msg = /smtp|auth|conn|email|535|EAUTH|ECONN/i.test(env.error || '')
          ? 'No se pudo enviar: revisa la configuración de correo en Ajustes'
          : (env.error || 'No se pudo enviar el email');
        return toast(msg, 'error');
      }
      toast('Propuesta enviada', 'ok');
      await cargarLeads(); cargarResumen();
      await recargarFicha();
    } catch (e) { toast(e.message, 'error'); }
  }

  // Ver el contenido completo de una propuesta.
  function verPropuesta(p) {
    if (!p) return;
    const estado = p.enviada
      ? `<span class="lead-prop-bdg lead-prop-enviada">Enviada ✓${p.fecha_envio ? ' · ' + fmtFechaHora(p.fecha_envio) : ''}</span>`
      : '<span class="lead-prop-bdg lead-prop-borrador">Borrador</span>';
    let fotoIds = [];
    try { fotoIds = p.fotos_enviadas ? JSON.parse(p.fotos_enviadas) : []; } catch (e) { fotoIds = []; }
    abrirModal(`
      <h3>Propuesta</h3>
      <div class="lead-prop-ver-cab">${estado} ${p.precio_propuesto != null ? '· ' + euro(p.precio_propuesto) : ''}</div>
      <div class="lead-preview-asunto"><strong>Para:</strong> ${esc(p.email_destino) || '—'}</div>
      <div class="lead-preview-asunto"><strong>Asunto:</strong> ${esc(p.asunto)}</div>
      <div class="lead-preview-cuerpo">${esc(p.mensaje).replace(/\n/g, '<br>')}</div>
      ${fotoIds.length ? `<div class="vta-muted lead-prop-ver-fotos">📎 ${fotoIds.length} foto(s) adjunta(s)</div>` : ''}
      <div class="modal-acciones">
        <button class="btn-pri" id="lpv-cerrar">Cerrar</button>
      </div>`);
    document.getElementById('lpv-cerrar').addEventListener('click', cerrarModal);
  }

  // ==================== Sub-pestaña Plantillas ====================
  function construirPlantillas() {
    if (plConstruido) return;
    const panel = document.querySelector('#vista-comercial .sub-panel[data-panel-sub="plantillas"]');
    if (!panel) return;
    panel.innerHTML = `
      <div class="barra-herramientas lead-pl-cab">
        <span class="sub-panel-titulo">Plantillas de email</span>
        <button id="lead-pl-nueva" class="btn-pri">＋ Nueva plantilla</button>
      </div>
      <div class="tabla-scroll">
        <table class="tabla" id="tabla-plantillas">
          <thead><tr><th>Nombre</th><th>Asunto</th><th>Estado</th><th></th></tr></thead>
          <tbody></tbody>
        </table>
      </div>`;
    panel.querySelector('#lead-pl-nueva').addEventListener('click', () => modalPlantilla(null));
    plConstruido = true;
  }

  async function cargarPlantillas() {
    const tbody = document.querySelector('#tabla-plantillas tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="vta-cargando">Cargando…</td></tr>';
    try { plantillas = await API.get('/api/leads/plantillas'); }
    catch (e) { if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="vta-cargando">Error al cargar.</td></tr>'; return; }
    renderPlantillas();
  }
  function renderPlantillas() {
    const tbody = document.querySelector('#tabla-plantillas tbody');
    if (!tbody) return;
    if (!plantillas.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="vta-vacio">No hay plantillas.</td></tr>';
      return;
    }
    tbody.innerHTML = plantillas.map((p) => `
      <tr>
        <td><strong>${esc(p.nombre)}</strong></td>
        <td>${esc(p.asunto)}</td>
        <td>${p.activa ? '<span class="lead-bdg lead-bdg-reservado">Activa</span>' : '<span class="lead-bdg lead-bdg-descartado">Inactiva</span>'}</td>
        <td class="vta-acciones">
          <button class="btn-icono" data-pl-editar="${p.id}" title="Editar">✏️</button>
          <button class="btn-icono" data-pl-borrar="${p.id}" title="Eliminar">🗑</button>
        </td>
      </tr>`).join('');
    tbody.querySelectorAll('[data-pl-editar]').forEach((b) =>
      b.addEventListener('click', () => modalPlantilla(plantillas.find((p) => p.id == b.dataset.plEditar))));
    tbody.querySelectorAll('[data-pl-borrar]').forEach((b) =>
      b.addEventListener('click', () => borrarPlantilla(plantillas.find((p) => p.id == b.dataset.plBorrar))));
  }

  function modalPlantilla(pl) {
    const ed = !!pl;
    const badges = PLACEHOLDERS.map((ph) => `<button type="button" class="lead-ph-badge" data-ph="${ph}">${ph}</button>`).join('');
    abrirModal(`
      <h3>${ed ? 'Editar plantilla' : 'Nueva plantilla'}</h3>
      <div class="campo"><label>Nombre *</label><input id="pl-nombre" value="${ed ? esc(pl.nombre) : ''}"></div>
      <div class="campo"><label>Asunto *</label><input id="pl-asunto" value="${ed ? esc(pl.asunto) : ''}"></div>
      <div class="campo"><label>Cuerpo *</label><textarea id="pl-cuerpo" rows="10">${ed ? esc(pl.cuerpo) : ''}</textarea></div>
      <div class="lead-ph-wrap">
        <span class="lead-ph-titulo">Insertar campo:</span> ${badges}
      </div>
      <label class="lead-toggle"><input type="checkbox" id="pl-activa" ${ed ? (pl.activa ? 'checked' : '') : 'checked'}> Activa</label>
      <div class="modal-acciones">
        <button class="btn-sec" id="pl-preview">👁 Preview</button>
        <button class="btn-sec" id="pl-cancelar">Cancelar</button>
        <button class="btn-pri" id="pl-guardar">${ed ? 'Guardar' : 'Crear'}</button>
      </div>
      <div id="pl-preview-box" class="lead-preview oculto"></div>`);

    // Badges clicables: insertan el placeholder en el último campo enfocado (asunto o cuerpo).
    let ultimoCampo = document.getElementById('pl-cuerpo');
    ['pl-asunto', 'pl-cuerpo'].forEach((id) => {
      document.getElementById(id).addEventListener('focus', (e) => { ultimoCampo = e.target; });
    });
    document.querySelectorAll('.lead-ph-badge').forEach((b) =>
      b.addEventListener('click', () => insertarEnCursor(ultimoCampo, b.dataset.ph)));

    document.getElementById('pl-preview').addEventListener('click', () => previewPlantilla());
    document.getElementById('pl-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('pl-guardar').addEventListener('click', () => guardarPlantilla(ed ? pl.id : null));
  }

  function insertarEnCursor(campo, texto) {
    if (!campo) return;
    const ini = campo.selectionStart ?? campo.value.length;
    const fin = campo.selectionEnd ?? campo.value.length;
    campo.value = campo.value.slice(0, ini) + texto + campo.value.slice(fin);
    const pos = ini + texto.length;
    campo.focus();
    campo.setSelectionRange(pos, pos);
  }

  function previewPlantilla() {
    const ejemplo = {
      '{nombre}': 'Juan Pérez', '{apartamento}': 'Apartamento Marina 3B',
      '{fecha_entrada}': '01/08/2026', '{fecha_salida}': '08/08/2026',
      '{tipo}': 'A+', '{capacidad}': '4', '{zona}': 'Primera línea de playa',
      '{precio}': '850', '{empresa}': 'Mi Inmobiliaria',
    };
    const aplicar = (s) => PLACEHOLDERS.reduce((acc, ph) => acc.split(ph).join(ejemplo[ph] || ph), s || '');
    const asunto = aplicar(val('pl-asunto'));
    const cuerpo = aplicar(val('pl-cuerpo'));
    const box = document.getElementById('pl-preview-box');
    box.innerHTML = `
      <div class="lead-preview-asunto"><strong>Asunto:</strong> ${esc(asunto)}</div>
      <div class="lead-preview-cuerpo">${esc(cuerpo).replace(/\n/g, '<br>')}</div>`;
    box.classList.remove('oculto');
  }

  async function guardarPlantilla(id) {
    const nombre = val('pl-nombre').trim();
    const asunto = val('pl-asunto').trim();
    const cuerpo = val('pl-cuerpo').trim();
    if (!nombre || !asunto || !cuerpo) return toast('Nombre, asunto y cuerpo son obligatorios', 'error');
    const activa = document.getElementById('pl-activa').checked ? 1 : 0;
    const btn = document.getElementById('pl-guardar');
    btn.disabled = true;
    try {
      if (id) await API.put('/api/leads/plantillas/' + id, { nombre, asunto, cuerpo, activa });
      else await API.post('/api/leads/plantillas', { nombre, asunto, cuerpo, activa });
      toast('Plantilla guardada', 'ok');
      cerrarModal();
      cargarPlantillas();
    } catch (e) {
      toast(e.message, 'error'); // 409 nombre duplicado
      btn.disabled = false;
    }
  }

  async function borrarPlantilla(pl) {
    if (!pl) return;
    if (!confirm(`¿Eliminar la plantilla "${pl.nombre}"?`)) return;
    try {
      await API.del('/api/leads/plantillas/' + pl.id);
      toast('Plantilla eliminada', 'ok');
      cargarPlantillas();
    } catch (e) { toast(e.message, 'error'); } // 409 si tiene propuestas
  }

  return { init, cargar, abrirFicha };
})();
