// Módulo Captación: pipeline de pisos candidatos a captar como propietarios nuevos.
// Independiente de Comercial/Leads (leads.js), que es captación de clientes/inquilinos.
// Listado con filtro por fase + buscador libre, ficha en panel lateral con selector de
// fase (pide motivo si pasa a Descartado) y conversión a Alojamiento real.

const Captacion = (() => {
  const FASES = [
    { v: 'contactado', l: 'Contactado', c: 'lead-bdg-contactado' },
    { v: 'interesado', l: 'Interesado', c: 'lead-bdg-interesado' },
    { v: 'captado', l: 'Captado', c: 'lead-bdg-captado' },
    { v: 'descartado', l: 'Descartado', c: 'lead-bdg-descartado' },
  ];

  let captaciones = [];
  let fichaActual = null;
  let busqueda = '';
  let fFase = '';
  let usuariosCache = [];

  // ==================== Helpers ====================
  function val(id) { const el = document.getElementById(id); return el ? el.value : ''; }
  function faseMeta(v) { return FASES.find((f) => f.v === v) || FASES[0]; }
  function faseBadge(v) {
    const m = faseMeta(v);
    return `<span class="lead-bdg ${m.c}">${esc(m.l)}</span>`;
  }
  function dato(etq, valor) {
    return `<div class="campo-ficha"><div class="etq">${etq}</div><div class="val">${valor}</div></div>`;
  }
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
    return fechaES(String(iso).slice(0, 10));
  }

  // ==================== Init ====================
  function init() {
    document.getElementById('cap-buscar')?.addEventListener('input', (e) => { busqueda = e.target.value; renderTabla(); });
    document.getElementById('cap-f-fase')?.addEventListener('change', (e) => { fFase = e.target.value; renderTabla(); });
    document.getElementById('cap-nuevo')?.addEventListener('click', () => modalCaptacion(null));
  }

  async function cargar() {
    await Promise.all([cargarCaptaciones(), cargarUsuarios()]);
  }

  async function cargarUsuarios() {
    if (usuariosCache.length) return;
    try { usuariosCache = await API.get('/api/usuarios'); } catch (e) { usuariosCache = []; }
  }

  async function cargarCaptaciones() {
    const tbody = document.querySelector('#tabla-captaciones tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="vta-cargando">Cargando…</td></tr>';
    try {
      captaciones = await API.get('/api/captaciones');
    } catch (e) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="vta-cargando">No se pudieron cargar las captaciones.</td></tr>';
      return toast(e.message, 'error');
    }
    renderTabla();
  }

  // ==================== Tabla + filtros ====================
  function filtrados() {
    const q = busqueda.trim().toLowerCase();
    return captaciones.filter((c) => {
      if (fFase && c.fase !== fFase) return false;
      if (q) {
        const txt = `${c.nombre_piso || ''} ${c.direccion || ''} ${c.propietario_nombre || ''} ${c.propietario_telefono || ''} ${c.propietario_email || ''}`.toLowerCase();
        if (!txt.includes(q)) return false;
      }
      return true;
    });
  }

  function renderTabla() {
    const tbody = document.querySelector('#tabla-captaciones tbody');
    if (!tbody) return;
    const lista = filtrados();
    const cont = document.getElementById('cap-contador');
    if (cont) {
      cont.textContent = lista.length === captaciones.length
        ? `${lista.length} captación${lista.length === 1 ? '' : 'es'}`
        : `${lista.length} de ${captaciones.length} captaciones`;
    }

    if (!captaciones.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="vta-vacio">No hay captaciones todavía. Crea la primera con «＋ Nueva captación».</td></tr>';
      return;
    }
    if (!lista.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="vta-vacio">Ninguna captación coincide con los filtros.</td></tr>';
      return;
    }
    tbody.innerHTML = lista.map(filaHTML).join('');

    tbody.querySelectorAll('tr[data-ficha]').forEach((tr) =>
      tr.addEventListener('click', (e) => {
        if (e.target.closest('[data-editar]') || e.target.closest('[data-borrar]')) return;
        abrirFicha(tr.dataset.ficha);
      }));
    tbody.querySelectorAll('[data-editar]').forEach((b) =>
      b.addEventListener('click', (e) => { e.stopPropagation(); modalCaptacion(captaciones.find((c) => c.id == b.dataset.editar)); }));
    tbody.querySelectorAll('[data-borrar]').forEach((b) =>
      b.addEventListener('click', (e) => { e.stopPropagation(); borrar(captaciones.find((c) => c.id == b.dataset.borrar)); }));
  }

  function filaHTML(c) {
    return `
      <tr data-ficha="${c.id}">
        <td><strong>${esc(c.nombre_piso) || '<span class="vta-muted">Sin nombre</span>'}</strong>${c.direccion ? `<br><span class="vta-muted">${esc(c.direccion)}</span>` : ''}</td>
        <td>${esc(c.propietario_nombre)}</td>
        <td>${faseBadge(c.fase)}</td>
        <td>${esc(c.fuente) || '<span class="vta-muted">—</span>'}</td>
        <td title="${esc(c.updated_at || '')}">${relativo(c.updated_at)}</td>
        <td class="vta-acciones">
          <button class="btn-icono" data-editar="${c.id}" title="Editar">✏️</button>
          <button class="btn-icono" data-borrar="${c.id}" title="Eliminar">🗑</button>
        </td>
      </tr>`;
  }

  async function borrar(c) {
    if (!c) return;
    if (!confirm(`¿Eliminar la captación de "${c.propietario_nombre}"?`)) return;
    try {
      await API.del('/api/captaciones/' + c.id);
      await cargarCaptaciones();
      toast('Captación eliminada', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  }

  // ==================== Panel lateral (ficha) ====================
  function crearPanel() {
    if (document.getElementById('cap-panel')) return;
    const fondo = document.createElement('div');
    fondo.id = 'cap-panel-fondo';
    fondo.className = 'panel-fondo';
    const panel = document.createElement('aside');
    panel.id = 'cap-panel';
    panel.className = 'panel-lateral';
    panel.setAttribute('aria-label', 'Ficha de captación');
    panel.innerHTML = `
      <header class="panel-cabecera">
        <div class="rsv-titulo-grupo">
          <h3 id="cap-d-titulo">Captación</h3>
          <span id="cap-d-badge"></span>
        </div>
        <div class="panel-cabecera-acciones">
          <div class="vta-estado-drop">
            <button id="cap-d-fase" class="btn-sec">Cambiar fase ▾</button>
            <div id="cap-d-fase-menu" class="vta-estado-menu oculto"></div>
          </div>
          <button id="cap-d-convertir" class="btn-pri">🏠 Convertir en Alojamiento</button>
          <button id="cap-d-editar" class="btn-sec">✏️ Editar</button>
          <button id="cap-d-cerrar" class="panel-cerrar" title="Cerrar">&times;</button>
        </div>
      </header>
      <div id="cap-d-cuerpo" class="panel-cuerpo"></div>`;
    document.body.appendChild(fondo);
    document.body.appendChild(panel);
    fondo.addEventListener('click', cerrarPanel);
    panel.querySelector('#cap-d-cerrar').addEventListener('click', cerrarPanel);
    panel.querySelector('#cap-d-editar').addEventListener('click', () => { if (fichaActual) modalCaptacion(fichaActual); });
    panel.querySelector('#cap-d-convertir').addEventListener('click', () => { if (fichaActual) convertir(fichaActual); });

    const menu = panel.querySelector('#cap-d-fase-menu');
    menu.innerHTML = FASES.map((f) => `<button class="vta-estado-op" data-fase="${f.v}">${faseBadge(f.v)}</button>`).join('');
    panel.querySelector('#cap-d-fase').addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('oculto'); });
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('[data-fase]');
      if (!b) return;
      menu.classList.add('oculto');
      cambiarFase(b.dataset.fase);
    });
    document.addEventListener('click', () => menu.classList.add('oculto'));
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const modalAbierto = !document.getElementById('modal-fondo').classList.contains('oculto');
      if (!modalAbierto && panel.classList.contains('abierto')) cerrarPanel();
    }, true);
  }
  function abrirPanel() {
    document.getElementById('cap-panel-fondo').classList.add('abierto');
    document.getElementById('cap-panel').classList.add('abierto');
  }
  function cerrarPanel() {
    document.getElementById('cap-panel-fondo')?.classList.remove('abierto');
    document.getElementById('cap-panel')?.classList.remove('abierto');
    fichaActual = null;
  }

  async function abrirFicha(id) {
    crearPanel();
    let d;
    try { d = await API.get('/api/captaciones/' + id); }
    catch (e) { return toast(e.message, 'error'); }
    fichaActual = d;
    pintarCabecera(d);
    renderCuerpo(d);
    abrirPanel();
  }
  async function recargarFicha() {
    if (!fichaActual) return;
    const id = fichaActual.id;
    try { fichaActual = await API.get('/api/captaciones/' + id); } catch (e) { return; }
    pintarCabecera(fichaActual);
    renderCuerpo(fichaActual);
  }
  function pintarCabecera(d) {
    document.getElementById('cap-d-titulo').textContent = d.nombre_piso || d.propietario_nombre || 'Captación';
    document.getElementById('cap-d-badge').innerHTML = faseBadge(d.fase);
    const conv = document.getElementById('cap-d-convertir');
    if (conv) conv.classList.toggle('oculto', d.fase === 'descartado' || !!d.apartamento_id);
  }

  async function cambiarFase(fase) {
    if (!fichaActual) return;
    if (fase === 'descartado') return modalMotivoDescarte(fichaActual);
    try {
      await API.put('/api/captaciones/' + fichaActual.id, { fase });
      fichaActual.fase = fase;
      pintarCabecera(fichaActual);
      toast('Fase actualizada a ' + faseMeta(fase).l, 'ok');
      cargarCaptaciones();
    } catch (e) { toast(e.message, 'error'); }
  }

  function modalMotivoDescarte(c) {
    abrirModal(`
      <h3>Descartar captación</h3>
      <div class="campo"><label>Motivo *</label><textarea id="cap-md-motivo" rows="3">${esc(c.motivo_descarte) || ''}</textarea></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="cap-md-cancelar">Cancelar</button>
        <button class="btn-pri" id="cap-md-guardar">Descartar</button>
      </div>`);
    document.getElementById('cap-md-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('cap-md-guardar').addEventListener('click', async () => {
      const motivo = val('cap-md-motivo').trim();
      if (!motivo) return toast('El motivo es obligatorio', 'error');
      try {
        await API.put('/api/captaciones/' + c.id, { fase: 'descartado', motivo_descarte: motivo });
        cerrarModal();
        toast('Captación descartada', 'ok');
        await cargarCaptaciones();
        if (fichaActual && fichaActual.id === c.id) await recargarFicha();
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  function renderCuerpo(d) {
    let banner = '';
    if (d.apartamento_id) {
      banner = `<div class="lead-banner-reservado">🏠 Convertida en alojamiento
        <a class="lead-banner-link" data-apto="${d.apartamento_id}">Ver ficha</a></div>`;
    }
    const datos = `
      <div class="vta-d-seccion">
        <div class="vta-d-titulo-sec">🏠 Piso candidato</div>
        <div class="vta-d-grid">
          ${dato('Nombre / referencia', esc(d.nombre_piso) || '—')}
          ${dato('Dirección', esc(d.direccion) || '—')}
          ${dato('m²', d.m2 != null ? esc(d.m2) : '—')}
          ${dato('Capacidad', d.capacidad != null ? esc(d.capacidad) : '—')}
        </div>
      </div>
      <div class="vta-d-seccion">
        <div class="vta-d-titulo-sec">👤 Propietario potencial</div>
        <div class="vta-d-grid">
          ${dato('Nombre', esc(d.propietario_nombre) || '—')}
          ${dato('Teléfono', d.propietario_telefono ? `<a class="vta-link" href="tel:${esc(d.propietario_telefono)}">${esc(d.propietario_telefono)}</a>` : '—')}
          ${dato('Email', d.propietario_email ? `<a class="vta-link" href="mailto:${esc(d.propietario_email)}">${esc(d.propietario_email)}</a>` : '—')}
          ${dato('Fuente', esc(d.fuente) || '—')}
          ${dato('Atendido por', esc(d.atendido_por) || '—')}
        </div>
        ${d.fase === 'descartado' && d.motivo_descarte ? `<div class="lead-d-notas-campo">Motivo de descarte: ${esc(d.motivo_descarte)}</div>` : ''}
        ${d.notas ? `<div class="lead-d-notas-campo">${esc(d.notas).replace(/\n/g, '<br>')}</div>` : ''}
      </div>`;

    const cuerpo = document.getElementById('cap-d-cuerpo');
    cuerpo.innerHTML = banner + datos;
    cuerpo.querySelector('[data-apto]')?.addEventListener('click', () => {
      activarTab('alojamientos');
      if (typeof Alojamientos !== 'undefined' && Alojamientos.abrirFicha) Alojamientos.abrirFicha(d.apartamento_id);
    });
  }

  async function convertir(c) {
    if (!confirm(`Se creará un propietario y un alojamiento nuevos a partir de "${c.propietario_nombre}". ¿Continuar?`)) return;
    try {
      const r = await API.post('/api/captaciones/' + c.id + '/convertir', {});
      toast('Captación convertida en alojamiento', 'ok');
      cerrarPanel();
      await cargarCaptaciones();
      activarTab('alojamientos');
      if (typeof Alojamientos !== 'undefined' && Alojamientos.abrirFicha) Alojamientos.abrirFicha(r.apartamento_id);
    } catch (e) { toast(e.message, 'error'); }
  }

  // ==================== Modal alta/edición ====================
  function modalCaptacion(c) {
    const ed = !!c;
    const opcionesFuente = ['Referido', 'Idealista', 'Panfleto', 'Redes sociales', 'Otro']
      .map((f) => `<option value="${f}">`).join('');
    const opcionesUsuario = usuariosCache.map((u) => u.nombre || u.username).filter(Boolean);
    const datalistUsuarios = opcionesUsuario.map((n) => `<option value="${esc(n)}">`).join('');
    abrirModal(`
      <h3>${ed ? 'Editar captación' : 'Nueva captación'}</h3>
      <div class="vta-modal-sub">Piso candidato</div>
      <div class="fila-campos">
        <div class="campo"><label>Nombre / referencia</label><input id="cf-nombre_piso" value="${ed ? esc(c.nombre_piso) || '' : ''}"></div>
        <div class="campo"><label>Dirección</label><input id="cf-direccion" value="${ed ? esc(c.direccion) || '' : ''}"></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>m²</label><input type="number" id="cf-m2" min="0" step="0.01" value="${ed && c.m2 != null ? esc(c.m2) : ''}"></div>
        <div class="campo"><label>Capacidad</label><input type="number" id="cf-capacidad" min="0" value="${ed && c.capacidad != null ? esc(c.capacidad) : ''}"></div>
      </div>
      <div class="vta-modal-sub">Propietario potencial</div>
      <div class="campo"><label>Nombre *</label><input id="cf-propietario_nombre" value="${ed ? esc(c.propietario_nombre) || '' : ''}"></div>
      <div class="fila-campos">
        <div class="campo"><label>Teléfono</label><input id="cf-propietario_telefono" value="${ed ? esc(c.propietario_telefono) || '' : ''}"></div>
        <div class="campo"><label>Email</label><input type="email" id="cf-propietario_email" value="${ed ? esc(c.propietario_email) || '' : ''}"></div>
      </div>
      <div class="fila-campos">
        <div class="campo">
          <label>Fuente</label>
          <input id="cf-fuente" list="cf-fuente-opts" value="${ed ? esc(c.fuente) || '' : ''}" placeholder="Referido, Idealista...">
          <datalist id="cf-fuente-opts">${opcionesFuente}</datalist>
        </div>
        <div class="campo">
          <label>Atendido por</label>
          <input id="cf-atendido_por" list="cf-atendido-opts" value="${ed ? esc(c.atendido_por) || '' : ''}">
          <datalist id="cf-atendido-opts">${datalistUsuarios}</datalist>
        </div>
      </div>
      <div class="campo"><label>Notas</label><textarea id="cf-notas" rows="3">${ed ? esc(c.notas) || '' : ''}</textarea></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="cf-cancelar">Cancelar</button>
        <button class="btn-pri" id="cf-guardar">${ed ? 'Guardar cambios' : 'Crear captación'}</button>
      </div>`);
    document.getElementById('cf-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('cf-guardar').addEventListener('click', () => guardarCaptacion(ed ? c.id : null));
  }

  async function guardarCaptacion(id) {
    const propietarioNombre = val('cf-propietario_nombre').trim();
    if (!propietarioNombre) return toast('El nombre del propietario potencial es obligatorio', 'error');
    const cuerpo = {
      nombre_piso: val('cf-nombre_piso').trim(),
      direccion: val('cf-direccion').trim(),
      m2: val('cf-m2'),
      capacidad: val('cf-capacidad'),
      propietario_nombre: propietarioNombre,
      propietario_telefono: val('cf-propietario_telefono').trim(),
      propietario_email: val('cf-propietario_email').trim(),
      fuente: val('cf-fuente').trim(),
      atendido_por: val('cf-atendido_por').trim(),
      notas: val('cf-notas'),
    };
    const btn = document.getElementById('cf-guardar');
    btn.disabled = true;
    try {
      if (id) {
        await API.put('/api/captaciones/' + id, cuerpo);
        toast('Captación actualizada', 'ok');
      } else {
        await API.post('/api/captaciones', cuerpo);
        toast('Captación creada', 'ok');
      }
      cerrarModal();
      await cargarCaptaciones();
      if (id && fichaActual && fichaActual.id === id) await recargarFicha();
    } catch (e) {
      toast(e.message, 'error');
      btn.disabled = false;
    }
  }

  return { init, cargar, abrirFicha };
})();
