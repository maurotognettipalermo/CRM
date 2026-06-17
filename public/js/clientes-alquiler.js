// Módulo Clientes (huéspedes/inquilinos de alquiler). Tabla paginada con búsqueda,
// ficha en panel lateral (datos + contacto + dirección + historial de reservas +
// observaciones editables), alta/edición e importación del export de Avantio.
// Nombre del IIFE: ClientesAlquiler (para no confundir con los clientes de Ventas).

const ClientesAlquiler = (() => {
  const LIMIT = 50;
  let clientes = [];
  let pagina = 0;
  let busqueda = '';
  let fichaActual = null;
  let buscarTimer = null;

  // ==================== Helpers ====================
  function val(id) { const el = document.getElementById(id); return el ? el.value : ''; }
  function nombreCompleto(c) { return [c.nombre, c.apellido1, c.apellido2].filter(Boolean).join(' '); }
  function dato(etq, valor) {
    return `<div class="campo-ficha"><div class="etq">${etq}</div><div class="val">${valor}</div></div>`;
  }

  // ==================== Init ====================
  function init() {
    document.getElementById('cli-buscar')?.addEventListener('input', (e) => {
      busqueda = e.target.value;
      clearTimeout(buscarTimer);
      buscarTimer = setTimeout(() => { pagina = 0; cargar(); }, 350);
    });
    document.getElementById('cli-nuevo')?.addEventListener('click', () => modalCliente(null));
    document.getElementById('cli-importar')?.addEventListener('click', modalImportar);
  }

  // ==================== Carga ====================
  async function cargar() {
    const tbody = document.querySelector('#tabla-clientes tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="vta-cargando">Cargando clientes…</td></tr>';
    try {
      const q = `/api/clientes?buscar=${encodeURIComponent(busqueda)}&limit=${LIMIT}&offset=${pagina * LIMIT}`;
      clientes = await API.get(q);
    } catch (e) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="vta-cargando">No se pudieron cargar los clientes.</td></tr>';
      return toast(e.message, 'error');
    }
    render();
  }

  function render() {
    const tbody = document.querySelector('#tabla-clientes tbody');
    if (!tbody) return;
    if (!clientes.length) {
      tbody.innerHTML = pagina === 0
        ? '<tr><td colspan="7" class="vta-vacio">No hay clientes. Importa el archivo de Avantio o crea uno nuevo.</td></tr>'
        : '<tr><td colspan="7" class="vta-vacio">No hay más clientes.</td></tr>';
    } else {
      tbody.innerHTML = clientes.map(filaHTML).join('');
      tbody.querySelectorAll('tr[data-ficha]').forEach((tr) =>
        tr.addEventListener('click', (e) => {
          if (e.target.closest('[data-editar]') || e.target.closest('[data-borrar]') || e.target.closest('a')) return;
          abrirFicha(tr.dataset.ficha);
        }));
      tbody.querySelectorAll('[data-editar]').forEach((b) =>
        b.addEventListener('click', (e) => { e.stopPropagation(); modalCliente(clientes.find((c) => c.id == b.dataset.editar)); }));
      tbody.querySelectorAll('[data-borrar]').forEach((b) =>
        b.addEventListener('click', (e) => { e.stopPropagation(); borrar(clientes.find((c) => c.id == b.dataset.borrar)); }));
    }
    pintarContador();
    pintarPaginacion();
  }

  function filaHTML(c) {
    const tel = c.telefono ? `<a class="vta-link" href="tel:${esc(c.telefono)}">${esc(c.telefono)}</a>` : '<span class="vta-muted">—</span>';
    const mail = c.email ? `<a class="vta-link" href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '<span class="vta-muted">—</span>';
    const nres = c.num_reservas || 0;
    const resCel = nres > 0 ? `<span class="cli-res-badge">${nres}</span>` : '<span class="vta-muted">0</span>';
    return `
      <tr data-ficha="${c.id}">
        <td><strong class="cli-nombre">${esc(nombreCompleto(c)) || '—'}</strong></td>
        <td>${tel}</td>
        <td>${mail}</td>
        <td>${esc(c.dni) || '<span class="vta-muted">—</span>'}</td>
        <td>${esc(c.pais) || '<span class="vta-muted">—</span>'}</td>
        <td>${resCel}</td>
        <td class="vta-acciones">
          <button class="btn-icono" data-editar="${c.id}" title="Editar">✏️</button>
          <button class="btn-icono" data-borrar="${c.id}" title="Eliminar">🗑</button>
        </td>
      </tr>`;
  }

  function pintarContador() {
    const c = document.getElementById('cli-contador');
    if (!c) return;
    const desde = clientes.length ? pagina * LIMIT + 1 : 0;
    const hasta = pagina * LIMIT + clientes.length;
    c.textContent = clientes.length ? `${desde}–${hasta} clientes` : '0 clientes';
  }

  function pintarPaginacion() {
    const cont = document.getElementById('cli-paginacion');
    if (!cont) return;
    const hayPrev = pagina > 0;
    const hayNext = clientes.length === LIMIT; // página llena → probablemente hay más
    if (!hayPrev && !hayNext) { cont.innerHTML = ''; return; }
    cont.innerHTML = `
      <button class="btn-sec" id="cli-prev" ${hayPrev ? '' : 'disabled'}>← Anterior</button>
      <span class="cli-pag-num">Página ${pagina + 1}</span>
      <button class="btn-sec" id="cli-next" ${hayNext ? '' : 'disabled'}>Siguiente →</button>`;
    document.getElementById('cli-prev')?.addEventListener('click', () => { if (pagina > 0) { pagina--; cargar(); } });
    document.getElementById('cli-next')?.addEventListener('click', () => { pagina++; cargar(); });
  }

  // ==================== Panel lateral (ficha) ====================
  function crearPanel() {
    if (document.getElementById('cli-panel')) return;
    const fondo = document.createElement('div');
    fondo.id = 'cli-panel-fondo';
    fondo.className = 'panel-fondo';
    const panel = document.createElement('aside');
    panel.id = 'cli-panel';
    panel.className = 'panel-lateral';
    panel.setAttribute('aria-label', 'Ficha de cliente');
    panel.innerHTML = `
      <header class="panel-cabecera">
        <div class="rsv-titulo-grupo">
          <h3 id="cli-d-titulo">Cliente</h3>
          <span id="cli-d-badge"></span>
        </div>
        <div class="panel-cabecera-acciones">
          <button id="cli-d-editar" class="btn-sec">✏️ Editar</button>
          <button id="cli-d-cerrar" class="panel-cerrar" title="Cerrar">&times;</button>
        </div>
      </header>
      <div id="cli-d-cuerpo" class="panel-cuerpo"></div>`;
    document.body.appendChild(fondo);
    document.body.appendChild(panel);
    fondo.addEventListener('click', cerrarPanel);
    panel.querySelector('#cli-d-cerrar').addEventListener('click', cerrarPanel);
    panel.querySelector('#cli-d-editar').addEventListener('click', () => { if (fichaActual) modalCliente(fichaActual); });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const modalAbierto = !document.getElementById('modal-fondo').classList.contains('oculto');
      if (!modalAbierto && panel.classList.contains('abierto')) cerrarPanel();
    }, true);
  }
  function abrirPanel() {
    document.getElementById('cli-panel-fondo').classList.add('abierto');
    document.getElementById('cli-panel').classList.add('abierto');
  }
  function cerrarPanel() {
    document.getElementById('cli-panel-fondo')?.classList.remove('abierto');
    document.getElementById('cli-panel')?.classList.remove('abierto');
    fichaActual = null;
  }

  async function abrirFicha(id) {
    crearPanel();
    let d;
    try { d = await API.get('/api/clientes/' + id); }
    catch (e) { return toast(e.message, 'error'); }
    fichaActual = d;
    document.getElementById('cli-d-titulo').textContent = nombreCompleto(d) || 'Cliente';
    document.getElementById('cli-d-badge').innerHTML = d.nacionalidad
      ? `<span class="cli-bdg-nac">${esc(d.nacionalidad)}</span>` : '';
    renderCuerpo(d);
    abrirPanel();
  }
  async function recargarFicha() {
    if (!fichaActual) return;
    try { fichaActual = await API.get('/api/clientes/' + fichaActual.id); } catch (e) { return; }
    renderCuerpo(fichaActual);
  }

  function renderCuerpo(d) {
    const personales = `
      <div class="vta-d-seccion">
        <div class="vta-d-titulo-sec">👤 Datos personales</div>
        <div class="vta-d-grid">
          ${dato('Nombre', esc(d.nombre) || '—')}
          ${dato('Primer apellido', esc(d.apellido1) || '—')}
          ${dato('Segundo apellido', esc(d.apellido2) || '—')}
          ${dato('DNI', esc(d.dni) || '—')}
          ${dato('Fecha nacimiento', fechaES(d.fecha_nacimiento) || '—')}
          ${dato('Sexo', esc(d.sexo) || '—')}
          ${dato('Nacionalidad', esc(d.nacionalidad) || '—')}
          ${dato('Idioma', esc(d.idioma) || '—')}
          ${dato('Tipo cliente', esc(d.tipo_cliente) || '—')}
        </div>
      </div>`;

    const contacto = `
      <div class="vta-d-seccion">
        <div class="vta-d-titulo-sec">📞 Contacto</div>
        <div class="vta-d-grid">
          ${dato('Email', d.email ? `<a class="vta-link" href="mailto:${esc(d.email)}">${esc(d.email)}</a>` : '—')}
          ${dato('Email alternativo', d.email2 ? `<a class="vta-link" href="mailto:${esc(d.email2)}">${esc(d.email2)}</a>` : '—')}
          ${dato('Teléfono', d.telefono ? `<a class="vta-link" href="tel:${esc(d.telefono)}">${esc(d.telefono)}</a>` : '—')}
          ${dato('Teléfono alt. 1', d.telefono2 ? `<a class="vta-link" href="tel:${esc(d.telefono2)}">${esc(d.telefono2)}</a>` : '—')}
          ${dato('Teléfono alt. 2', d.telefono3 ? `<a class="vta-link" href="tel:${esc(d.telefono3)}">${esc(d.telefono3)}</a>` : '—')}
        </div>
      </div>`;

    const dir = [d.calle, d.numero, d.puerta].filter(Boolean).join(' ');
    const direccion = `
      <div class="vta-d-seccion">
        <div class="vta-d-titulo-sec">📍 Dirección</div>
        <div class="vta-d-grid">
          ${dato('Domicilio', esc(dir) || '—')}
          ${dato('Código postal', esc(d.codigo_postal) || '—')}
          ${dato('Ciudad', esc(d.ciudad) || '—')}
          ${dato('Provincia', esc(d.provincia) || '—')}
          ${dato('País', esc(d.pais) || '—')}
          ${dato('Región', esc(d.region) || '—')}
        </div>
      </div>`;

    const reservas = (d.reservas || []).map((r) => `
      <div class="cli-res-item" data-reserva="${r.id}">
        <div class="cli-res-cab">
          <span class="cli-res-num">${esc(r.numero_reserva)}</span>
          <span class="cli-res-precio">${r.precio_total != null ? Math.round(r.precio_total).toLocaleString('de-DE') + ' €' : ''}</span>
        </div>
        <div class="cli-res-meta">
          ${esc(r.apartamento_nombre) || 'Sin asignar'} · ${fechaES(r.entrada) || '—'} → ${fechaES(r.salida) || '—'}
          ${r.tipo_reserva ? `· <span class="cli-res-estado">${esc(r.tipo_reserva)}</span>` : ''}
        </div>
      </div>`).join('') || '<div class="vta-muted">Sin reservas registradas.</div>';
    const historial = `
      <div class="vta-d-seccion">
        <div class="vta-d-titulo-sec">📋 Historial de reservas</div>
        <div class="cli-res-lista">${reservas}</div>
      </div>`;

    const observaciones = `
      <div class="vta-d-seccion">
        <div class="vta-d-titulo-sec">📝 Observaciones</div>
        <textarea id="cli-d-obs" class="cli-obs-area" rows="3" placeholder="Sin observaciones...">${esc(d.observaciones) || ''}</textarea>
        <div class="cli-obs-acciones"><button class="btn-sec" id="cli-d-obs-guardar">Guardar observaciones</button></div>
      </div>`;

    const cuerpo = document.getElementById('cli-d-cuerpo');
    cuerpo.innerHTML = personales + contacto + direccion + historial + observaciones;

    cuerpo.querySelectorAll('[data-reserva]').forEach((el) =>
      el.addEventListener('click', () => {
        const rid = el.dataset.reserva;
        activarTab('reservas');
        if (typeof Reservas !== 'undefined' && Reservas.abrirFicha) Reservas.abrirFicha(rid);
      }));
    document.getElementById('cli-d-obs-guardar')?.addEventListener('click', guardarObservaciones);
  }

  async function guardarObservaciones() {
    if (!fichaActual) return;
    const obs = val('cli-d-obs');
    try {
      await API.put('/api/clientes/' + fichaActual.id, { observaciones: obs });
      fichaActual.observaciones = obs;
      toast('Observaciones guardadas', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  }

  // ==================== Modal alta/edición ====================
  function modalCliente(c) {
    const ed = !!c;
    abrirModal(`
      <h3>${ed ? 'Editar cliente' : 'Nuevo cliente'}</h3>
      <div class="fila-campos">
        <div class="campo"><label>Nombre *</label><input id="cf-nombre" value="${ed ? esc(c.nombre) : ''}"></div>
        <div class="campo"><label>Primer apellido</label><input id="cf-ape1" value="${ed ? esc(c.apellido1) || '' : ''}"></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Segundo apellido</label><input id="cf-ape2" value="${ed ? esc(c.apellido2) || '' : ''}"></div>
        <div class="campo"><label>DNI</label><input id="cf-dni" value="${ed ? esc(c.dni) || '' : ''}"></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Teléfono</label><input id="cf-tel" value="${ed ? esc(c.telefono) || '' : ''}"></div>
        <div class="campo"><label>Email</label><input id="cf-email" type="email" value="${ed ? esc(c.email) || '' : ''}"></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>País</label><input id="cf-pais" value="${ed ? esc(c.pais) || '' : ''}"></div>
        <div class="campo"><label>Ciudad</label><input id="cf-ciudad" value="${ed ? esc(c.ciudad) || '' : ''}"></div>
      </div>
      <div class="campo"><label>Observaciones</label><textarea id="cf-obs" rows="3">${ed ? esc(c.observaciones) || '' : ''}</textarea></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="cf-cancelar">Cancelar</button>
        <button class="btn-pri" id="cf-guardar">${ed ? 'Guardar' : 'Crear'}</button>
      </div>`);
    document.getElementById('cf-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('cf-guardar').addEventListener('click', () => guardarCliente(ed ? c.id : null));
  }

  async function guardarCliente(id) {
    const nombre = val('cf-nombre').trim();
    if (!nombre) return toast('El nombre es obligatorio', 'error');
    const body = {
      nombre,
      apellido1: val('cf-ape1'), apellido2: val('cf-ape2'), dni: val('cf-dni'),
      telefono: val('cf-tel'), email: val('cf-email'),
      pais: val('cf-pais'), ciudad: val('cf-ciudad'), observaciones: val('cf-obs'),
    };
    const btn = document.getElementById('cf-guardar');
    btn.disabled = true;
    try {
      if (id) { await API.put('/api/clientes/' + id, body); toast('Cliente actualizado', 'ok'); }
      else { await API.post('/api/clientes', body); toast('Cliente creado', 'ok'); }
      cerrarModal();
      await cargar();
      if (id && fichaActual && fichaActual.id === id) await recargarFicha();
    } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
  }

  // ==================== Modal importar (Avantio) ====================
  let importFile = null;
  function modalImportar() {
    importFile = null;
    abrirModal(`
      <h3>📥 Importar clientes desde Avantio</h3>
      <p class="lead-conv-info">ℹ️ El archivo de Avantio es HTML disfrazado de XLS — el importador lo maneja automáticamente.</p>
      <div id="cli-dz" class="cli-dropzone">
        <div class="cli-dz-texto">Arrastra aquí el archivo .xls/.xlsx o haz clic para elegirlo</div>
        <div id="cli-dz-nombre" class="cli-dz-nombre"></div>
        <input type="file" id="cli-file" accept=".xls,.xlsx" hidden>
      </div>
      <div id="cli-imp-resultado" class="cli-imp-resultado oculto"></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="cli-imp-cancelar">Cerrar</button>
        <button class="btn-pri" id="cli-imp-guardar" disabled>Importar</button>
      </div>`);
    const dz = document.getElementById('cli-dz');
    const input = document.getElementById('cli-file');
    const elegir = (f) => {
      importFile = f || null;
      document.getElementById('cli-dz-nombre').textContent = f ? f.name : '';
      document.getElementById('cli-imp-guardar').disabled = !f;
    };
    dz.addEventListener('click', () => input.click());
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('arrastrando'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('arrastrando'));
    dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('arrastrando'); elegir(e.dataTransfer.files[0]); });
    input.addEventListener('change', () => elegir(input.files[0]));
    document.getElementById('cli-imp-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('cli-imp-guardar').addEventListener('click', importar);
  }

  async function importar() {
    if (!importFile) return;
    const btn = document.getElementById('cli-imp-guardar');
    const res = document.getElementById('cli-imp-resultado');
    btn.disabled = true; btn.textContent = 'Importando…';
    res.className = 'cli-imp-resultado';
    res.innerHTML = '<span class="rsv-trf-spinner"></span> Importando clientes…';
    try {
      const fd = new FormData();
      fd.append('archivo', importFile);
      const r = await fetch('/api/clientes/importar', { method: 'POST', body: fd, headers: authHeaders() });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Error al importar');
      const errs = (data.errores || []).length;
      res.innerHTML = `✅ <strong>${data.nuevos}</strong> nuevos, <strong>${data.actualizados}</strong> actualizados${errs ? `, <strong>${errs}</strong> con errores` : ''}.`;
      toast('Importación completada', 'ok');
      pagina = 0;
      await cargar();
    } catch (e) {
      res.innerHTML = `⚠️ ${esc(e.message)}`;
      toast(e.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Importar';
    }
  }

  // ==================== Borrar ====================
  async function borrar(c) {
    if (!c) return;
    if (!confirm(`¿Eliminar el cliente "${nombreCompleto(c)}"?`)) return;
    try {
      await API.del('/api/clientes/' + c.id);
      toast('Cliente eliminado', 'ok');
      if (fichaActual && fichaActual.id === c.id) cerrarPanel();
      await cargar();
    } catch (e) { toast(e.message, 'error'); } // 409 si tiene reservas
  }

  return { init, cargar, abrirFicha };
})();
