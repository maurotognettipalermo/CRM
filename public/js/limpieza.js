// Módulo Limpieza: tareas del día (cards), completar con reporte y alta manual.
// Reportes se añadirán en una tarea posterior. Pensado mobile-first.

const Limpieza = (() => {
  let fecha = hoyISO();
  let tareas = [];          // tareas del día cargadas
  let busqueda = '';
  let usuarios = [];        // para el modal de asignación (cargado bajo demanda)
  let apartamentos = [];    // para el typeahead de "Añadir piso"
  let subirSel = [];        // File[] pendientes en el modal de completar

  // ---- Estado de la sub-pestaña Reportes ----
  let repConstruido = false;
  let reportes = [];
  let repBusqueda = '';
  let repDesde = '';
  let repHasta = '';
  let repLbFotos = [];      // fotos abiertas en el lightbox de reportes
  let repLbIdx = -1;
  let fEstado = 'todos';    // filtro de estado de Tareas del día: todos / pendientes / completadas

  function hoyISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function masDiasISO(iso, n) {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function horaDe(s) { return s ? String(s).slice(11, 16) : ''; }

  function clasifBadge(c) {
    if (!c) return '';
    const m = { 'A++': 'c-app', 'A+': 'c-ap', 'A': 'c-a', 'B+': 'c-bp', 'B': 'c-b', 'C': 'c-c' };
    return `<span class="badge-clasif ${m[c] || 'c-c'}">${esc(c)}</span>`;
  }
  function estadoBadge(e) {
    const map = {
      pendiente: ['Pendiente', 'limp-bdg-pend'],
      en_proceso: ['En proceso', 'limp-bdg-proc'],
      completada: ['Completada ✓', 'limp-bdg-comp'],
    };
    const x = map[e] || map.pendiente;
    return `<span class="limp-bdg ${x[1]}">${x[0]}</span>`;
  }

  // ==================== Carga ====================
  async function cargar() {
    const inp = document.getElementById('limp-fecha');
    if (inp && !inp.value) inp.value = fecha;
    await cargarTareas();
  }

  async function cargarTareas() {
    const lista = document.getElementById('limp-lista');
    if (lista) lista.innerHTML = '<div class="limp-cargando">Cargando tareas…</div>';
    let resumen;
    try {
      [tareas, resumen] = await Promise.all([
        API.get(`/api/limpieza/tareas?fecha=${fecha}`),
        API.get(`/api/limpieza/resumen?fecha=${fecha}`),
      ]);
    } catch (e) {
      if (lista) lista.innerHTML = `<div class="limp-cargando">No se pudieron cargar las tareas.</div>`;
      return toast(e.message, 'error');
    }
    renderResumen(resumen);
    renderLista();
  }

  function renderResumen(r) {
    const cont = document.getElementById('limp-resumen');
    if (!cont) return;
    const card = (icono, valor, label, clase) =>
      `<div class="limp-mini ${clase}"><div class="limp-mini-ico">${icono}</div><div class="limp-mini-val">${valor}</div><div class="limp-mini-lbl">${label}</div></div>`;
    cont.innerHTML =
      card('📋', r.total || 0, 'Total tareas', 'limp-mini-azul') +
      card('🔴', r.pendientes || 0, 'Pendientes', 'limp-mini-rojo') +
      card('✅', r.completadas || 0, 'Completadas', 'limp-mini-verde') +
      card('⚡', r.turnovers || 0, 'Turnovers', 'limp-mini-naranja');
  }

  // Orden: turnover pendiente → checkout pendiente → manual pendiente → completadas.
  function rangoOrden(t) {
    if (t.estado === 'completada') return 100;
    if (t.tipo === 'turnover' || t.prioridad === 1) return 0;
    if (t.tipo === 'checkout') return 1;
    return 2; // manual
  }

  function renderLista() {
    const cont = document.getElementById('limp-lista');
    if (!cont) return;
    const q = busqueda.trim().toLowerCase();
    const lista = tareas
      .filter((t) => !q || (t.apartamento_nombre || '').toLowerCase().includes(q))
      .filter((t) => {
        if (fEstado === 'pendientes') return t.estado !== 'completada'; // pendiente + en proceso
        if (fEstado === 'completadas') return t.estado === 'completada';
        return true;
      })
      .slice()
      .sort((a, b) => rangoOrden(a) - rangoOrden(b) || (a.apartamento_nombre || '').localeCompare(b.apartamento_nombre || ''));

    if (!tareas.length) {
      cont.innerHTML = '<div class="limp-vacio">No hay tareas de limpieza para este día.</div>';
      return;
    }
    if (!lista.length) {
      cont.innerHTML = '<div class="limp-vacio">Ningún apartamento coincide con la búsqueda.</div>';
      return;
    }
    cont.innerHTML = lista.map(cardHTML).join('');

    cont.querySelectorAll('[data-completar]').forEach((b) =>
      b.addEventListener('click', () => modalCompletar(tareas.find((t) => t.id == b.dataset.completar))));
    cont.querySelectorAll('[data-asignar]').forEach((b) =>
      b.addEventListener('click', () => modalAsignar(tareas.find((t) => t.id == b.dataset.asignar))));
    cont.querySelectorAll('[data-notas]').forEach((b) =>
      b.addEventListener('click', () => modalNotas(tareas.find((t) => t.id == b.dataset.notas))));
  }

  function cardHTML(t) {
    const esTurnover = t.tipo === 'turnover' || t.prioridad === 1;
    const completada = t.estado === 'completada';
    const claseBorde = completada ? 'limp-card-comp'
      : esTurnover ? 'limp-card-turnover'
      : t.tipo === 'manual' ? 'limp-card-manual' : 'limp-card-checkout';

    const banner = esTurnover && !completada
      ? '<div class="limp-banner-urgente">⚡ TURNOVER URGENTE — Entra huésped hoy</div>' : '';

    const sale = t.checkout_cliente
      ? `<div class="limp-linea limp-sale">↗ Sale: <strong>${esc(t.checkout_cliente)}</strong>${t.hora_checkout ? ` (${esc(t.hora_checkout)})` : ''}</div>` : '';
    const entra = t.checkin_cliente
      ? `<div class="limp-linea limp-entra">↘ Entra: <strong>${esc(t.checkin_cliente)}</strong>${t.hora_checkin ? ` (${esc(t.hora_checkin)})` : ''}</div>` : '';

    const asignado = `<div class="limp-linea limp-asignado">Asignado a: ${t.asignado_nombre ? esc(t.asignado_nombre) : '<span class="limp-muted">Sin asignar</span>'}</div>`;

    let pieCompletada = '';
    if (completada) {
      const hora = horaDe(t.completado_fecha);
      pieCompletada = `<div class="limp-completado">Limpiado por: ${esc(t.completado_nombre) || '—'}${hora ? ` a las ${hora}` : ''}</div>`;
    }

    const tieneNotas = t.notas_limpieza && String(t.notas_limpieza).trim();
    const acciones = completada
      ? (tieneNotas ? `<button class="btn-sec limp-btn" data-notas="${t.id}">📝 Notas</button>` : '')
      : `
        <button class="btn-pri limp-btn limp-btn-limpio" data-completar="${t.id}">✅ Marcar limpio</button>
        <button class="btn-sec limp-btn" data-asignar="${t.id}">👤 Asignar</button>
        ${tieneNotas ? `<button class="btn-sec limp-btn" data-notas="${t.id}">📝 Notas</button>` : ''}`;

    return `
      <div class="limp-card ${claseBorde}${completada ? ' limp-card-completada' : ''}">
        ${banner}
        <div class="limp-card-top">
          <span class="limp-tipo-tag">${esTurnover ? '⚡ TURNOVER' : t.tipo === 'manual' ? '🧹 MANUAL' : '↗ CHECKOUT'}</span>
          ${estadoBadge(t.estado)}
        </div>
        <div class="limp-card-nombre">🏠 ${esc(t.apartamento_nombre)} ${clasifBadge(t.tipo_clasificacion)}</div>
        ${sale}${entra}
        ${asignado}
        ${pieCompletada}
        ${acciones ? `<div class="limp-card-acciones">${acciones}</div>` : ''}
      </div>`;
  }

  // ==================== Modal completar ====================
  function modalCompletar(t) {
    if (!t) return;
    subirSel = [];
    abrirModal(`
      <h3>✅ Limpieza de ${esc(t.apartamento_nombre)}</h3>
      <div class="campo">
        <label>Notas / incidencias</label>
        <textarea id="lc-notas" rows="4" placeholder="¿Todo bien? Si hay algo que reportar escríbelo aquí...">${esc(t.notas_limpieza)}</textarea>
      </div>
      <div class="campo">
        <label>Fotos (opcional, hasta 5)</label>
        <div class="alo-dropzone" id="lc-dz">
          <div class="alo-dropzone-icono">📷</div>
          <div>Arrastra fotos aquí o <strong>haz clic para seleccionar</strong></div>
          <input type="file" id="lc-file" accept=".jpg,.jpeg,.png,.webp" multiple hidden>
        </div>
        <div class="alo-preview" id="lc-preview"></div>
      </div>
      <div class="modal-acciones">
        <button class="btn-sec" id="lc-cancelar">Cancelar</button>
        <button class="btn-pri limp-btn-completar" id="lc-completar">✅ Completar limpieza</button>
      </div>`);

    const dz = document.getElementById('lc-dz');
    const input = document.getElementById('lc-file');
    dz.addEventListener('click', () => input.click());
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('arrastrando'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('arrastrando'));
    dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('arrastrando'); anadirFotos(e.dataTransfer.files); });
    input.addEventListener('change', () => anadirFotos(input.files));

    document.getElementById('lc-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('lc-completar').addEventListener('click', () => completar(t));
  }

  const EXT_FOTO = ['jpg', 'jpeg', 'png', 'webp'];
  function anadirFotos(fileList) {
    const nuevos = Array.from(fileList).filter((f) => EXT_FOTO.includes((f.name.split('.').pop() || '').toLowerCase()));
    if (Array.from(fileList).length && !nuevos.length) toast('Formato no admitido (solo JPG, PNG, WEBP)', 'error');
    for (const f of nuevos) {
      if (subirSel.length >= 5) { toast('Máximo 5 fotos', 'aviso'); break; }
      subirSel.push(f);
    }
    renderPreview();
  }
  function renderPreview() {
    const cont = document.getElementById('lc-preview');
    if (!cont) return;
    cont.innerHTML = '';
    subirSel.forEach((file, i) => {
      const div = document.createElement('div');
      div.className = 'alo-preview-item';
      div.innerHTML = '<img alt=""><button class="alo-preview-quitar" title="Quitar">✕</button>';
      const reader = new FileReader();
      reader.onload = (e) => { div.querySelector('img').src = e.target.result; };
      reader.readAsDataURL(file);
      div.querySelector('.alo-preview-quitar').addEventListener('click', () => { subirSel.splice(i, 1); renderPreview(); });
      cont.appendChild(div);
    });
  }

  async function completar(t) {
    const btn = document.getElementById('lc-completar');
    const btnCancel = document.getElementById('lc-cancelar');
    btn.disabled = true; btnCancel.disabled = true;
    btn.textContent = 'Completando…';
    try {
      if (subirSel.length) {
        const fd = new FormData();
        subirSel.forEach((f) => fd.append('fotos', f));
        const r = await fetch(`/api/limpieza/tareas/${t.id}/fotos`, { method: 'POST', body: fd, headers: authHeaders() });
        if (!r.ok) {
          let msg = 'Error al subir fotos';
          try { msg = (await r.json()).error || msg; } catch (e) {}
          throw new Error(msg);
        }
      }
      await API.post(`/api/limpieza/tareas/${t.id}/completar`, { notas_limpieza: val('lc-notas') });
      cerrarModal();
      await cargarTareas();
      toast(`Apartamento ${t.apartamento_nombre} marcado como limpio`, 'ok');
    } catch (e) {
      toast(e.message, 'error');
      btn.disabled = false; btnCancel.disabled = false;
      btn.textContent = '✅ Completar limpieza';
    }
  }

  // ==================== Modal asignar ====================
  async function modalAsignar(t) {
    if (!t) return;
    if (!usuarios.length) {
      try { usuarios = await API.get('/api/usuarios'); } catch (e) { usuarios = []; }
    }
    const opts = '<option value="">— Sin asignar —</option>' +
      usuarios.map((u) => `<option value="${u.id}"${t.asignado_a == u.id ? ' selected' : ''}>${esc(u.nombre)}</option>`).join('');
    abrirModal(`
      <h3>Asignar limpieza</h3>
      <div class="campo"><label>Apartamento</label><input value="${esc(t.apartamento_nombre)}" disabled></div>
      <div class="campo"><label>Asignar a</label><select id="la-user" class="select-filtro" style="width:100%">${opts}</select></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="la-cancelar">Cancelar</button>
        <button class="btn-pri" id="la-guardar">Guardar</button>
      </div>`);
    document.getElementById('la-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('la-guardar').addEventListener('click', async () => {
      try {
        await API.put(`/api/limpieza/tareas/${t.id}`, { asignado_a: val('la-user') || null });
        cerrarModal();
        await cargarTareas();
        toast('Tarea asignada', 'ok');
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  // ==================== Modal notas/detalle ====================
  async function modalNotas(t) {
    if (!t) return;
    let d;
    try { d = await API.get(`/api/limpieza/tareas/${t.id}/detalle`); }
    catch (e) { return toast(e.message, 'error'); }
    const fotos = (d.fotos || []).map((f) => `<img src="${esc(f.url)}" class="limp-rep-foto" alt="">`).join('');
    abrirModal(`
      <h3>${esc(t.apartamento_nombre)}</h3>
      <div class="campo"><label>Notas / incidencias</label>
        <div class="limp-notas-texto">${d.notas_limpieza ? esc(d.notas_limpieza).replace(/\n/g, '<br>') : '—'}</div></div>
      ${fotos ? `<div class="campo"><label>Fotos de reporte</label><div class="limp-rep-fotos">${fotos}</div></div>` : ''}
      <div class="modal-acciones"><button class="btn-pri" id="ln-cerrar">Cerrar</button></div>`);
    document.getElementById('ln-cerrar').addEventListener('click', cerrarModal);
  }

  // ==================== Modal añadir pisos (selección múltiple) ====================
  let addSel = new Set();   // ids de apartamentos seleccionados
  let addBusca = '';

  function estadoLimp(a) { return a.estado_limpieza === 'sucio' ? 'sucio' : 'limpio'; }

  async function modalAddPiso() {
    try { apartamentos = await API.get('/api/apartamentos?todos=1'); } catch (e) { apartamentos = []; }
    if (!usuarios.length) { try { usuarios = await API.get('/api/usuarios'); } catch (e) { usuarios = []; } }
    addSel = new Set();
    addBusca = '';
    // Solo usuarios activos; los de rol limpieza primero.
    const usrOrden = usuarios.slice().sort((a, b) =>
      (b.rol === 'limpieza') - (a.rol === 'limpieza') || (a.nombre || '').localeCompare(b.nombre || ''));
    const optUsr = '<option value="">— Sin asignar —</option>' +
      usrOrden.filter((u) => u.activo).map((u) =>
        `<option value="${u.id}">${esc(u.nombre)}${u.rol === 'limpieza' ? ' (limpieza)' : ''}</option>`).join('');

    abrirModal(`
      <h3>Asignar pisos para limpieza</h3>
      <div class="campo">
        <input type="search" id="ad-buscar" class="input-buscar" style="width:100%" placeholder="Buscar apartamento..." autocomplete="off">
      </div>
      <div class="add-botonera">
        <button type="button" class="btn-sec" id="ad-sucios">Seleccionar sucios</button>
        <button type="button" class="btn-sec" id="ad-todos">Seleccionar todos</button>
        <button type="button" class="btn-sec" id="ad-ninguno">Deseleccionar todos</button>
      </div>
      <div class="add-lista" id="ad-lista"></div>
      <div class="add-contador" id="ad-contador">0 apartamentos seleccionados</div>

      <div class="fila-campos">
        <div class="campo"><label>Fecha</label><input type="date" id="ad-fecha" value="${fecha}"></div>
        <div class="campo"><label>Asignar a</label><select id="ad-asignar" class="select-filtro" style="width:100%">${optUsr}</select></div>
      </div>
      <div class="campo"><label>Notas generales</label><textarea id="ad-notas" placeholder="Se copian a todas las tareas (opcional)"></textarea></div>
      <div class="add-progreso oculto" id="ad-progreso"><div class="add-progreso-barra" id="ad-progreso-barra"></div></div>

      <div class="modal-acciones">
        <button class="btn-sec" id="ad-cancelar">Cancelar</button>
        <button class="btn-pri add-btn-crear" id="ad-guardar">Crear 0 tareas de limpieza</button>
      </div>`);
    document.querySelector('.modal').classList.add('modal-ancho');

    renderAddLista();
    document.getElementById('ad-buscar').addEventListener('input', (e) => { addBusca = e.target.value; renderAddLista(); });
    document.getElementById('ad-sucios').addEventListener('click', () => {
      apartamentos.forEach((a) => { if (estadoLimp(a) === 'sucio') addSel.add(a.id); });
      renderAddLista();
    });
    document.getElementById('ad-todos').addEventListener('click', () => {
      apartamentos.forEach((a) => addSel.add(a.id));
      renderAddLista();
    });
    document.getElementById('ad-ninguno').addEventListener('click', () => { addSel.clear(); renderAddLista(); });
    document.getElementById('ad-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('ad-guardar').addEventListener('click', crearTareasMultiple);
  }

  function renderAddLista() {
    const cont = document.getElementById('ad-lista');
    if (!cont) return;
    const q = addBusca.trim().toLowerCase();
    const lista = apartamentos.filter((a) => !q || (a.nombre || '').toLowerCase().includes(q));
    if (!lista.length) {
      cont.innerHTML = '<div class="add-vacio">Sin apartamentos.</div>';
    } else {
      cont.innerHTML = lista.map((a) => {
        const sucio = estadoLimp(a) === 'sucio';
        const clasif = a.tipo_clasificacion ? `<span class="badge-clasif ${{ 'A++': 'c-app', 'A+': 'c-ap', 'A': 'c-a', 'B+': 'c-bp', 'B': 'c-b', 'C': 'c-c' }[a.tipo_clasificacion] || 'c-c'}">${esc(a.tipo_clasificacion)}</span>` : '';
        return `
          <label class="add-fila${sucio ? ' add-fila-sucio' : ''}">
            <input type="checkbox" data-ap="${a.id}"${addSel.has(a.id) ? ' checked' : ''}>
            <span class="add-fila-nombre">${esc(a.nombre)}</span>
            ${clasif}
            <span class="add-fila-estado">${sucio ? '🔴 Sucio' : '🟢 Limpio'}</span>
          </label>`;
      }).join('');
      cont.querySelectorAll('input[data-ap]').forEach((c) =>
        c.addEventListener('change', () => {
          const id = Number(c.dataset.ap);
          if (c.checked) addSel.add(id); else addSel.delete(id);
          actualizarAddContador();
        }));
    }
    actualizarAddContador();
  }

  function actualizarAddContador() {
    const n = addSel.size;
    const cont = document.getElementById('ad-contador');
    if (cont) cont.textContent = `${n} apartamento${n === 1 ? '' : 's'} seleccionado${n === 1 ? '' : 's'}`;
    const btn = document.getElementById('ad-guardar');
    if (btn && !btn.dataset.creando) { btn.textContent = `Crear ${n} tarea${n === 1 ? '' : 's'} de limpieza`; btn.disabled = n === 0; }
  }

  async function crearTareasMultiple() {
    const ids = [...addSel];
    if (!ids.length) return toast('Selecciona al menos un apartamento', 'aviso');
    const f = val('ad-fecha');
    if (!f) return toast('La fecha es obligatoria', 'error');
    const notas = val('ad-notas');
    const asignadoId = val('ad-asignar');
    const asignadoNombre = asignadoId ? (usuarios.find((u) => String(u.id) === String(asignadoId)) || {}).nombre : '';

    const btn = document.getElementById('ad-guardar');
    const btnCancel = document.getElementById('ad-cancelar');
    btn.dataset.creando = '1';
    btn.disabled = true; btnCancel.disabled = true;
    const prog = document.getElementById('ad-progreso');
    const barra = document.getElementById('ad-progreso-barra');
    if (prog) prog.classList.remove('oculto');

    let creadas = 0;
    // Secuencial para no saturar el servidor.
    for (let i = 0; i < ids.length; i++) {
      btn.textContent = `Creando tarea ${i + 1} de ${ids.length}...`;
      if (barra) barra.style.width = Math.round(((i) / ids.length) * 100) + '%';
      try {
        await API.post('/api/limpieza/tareas', { apartamento_id: ids[i], fecha: f, notas, asignado_a: asignadoId || null });
        creadas++;
      } catch (e) { /* continúa con el resto */ }
    }
    if (barra) barra.style.width = '100%';

    cerrarModal();
    if (f === fecha) await cargarTareas();
    const dest = asignadoNombre ? ` y asignadas a ${asignadoNombre}` : '';
    toast(`${creadas} tarea${creadas === 1 ? '' : 's'} de limpieza creada${creadas === 1 ? '' : 's'}${dest}`, creadas ? 'ok' : 'error');
  }

  // ==================== Sub-pestaña Reportes ====================
  function fmtFechaHora(s) {
    if (!s) return '—';
    const [d, t] = String(s).split(' ');
    const p = d.split('-');
    if (p.length !== 3) return s;
    return `${p[2]}/${p[1]}/${p[0]}${t ? ' ' + t.slice(0, 5) : ''}`;
  }
  const RE_INCIDENCIA = /\brot[ao]s?\b|rotura|incidencia|aver[ií]a|estropea|da[ñn]ad|da[ñn]o|mancha|falta|rompe|no funciona|defectuos/i;

  // Inyecta la UI de la sub-pestaña Reportes (filtros + lista) una sola vez.
  function construirReportes() {
    if (repConstruido) return;
    const panel = document.querySelector('#vista-limpieza .sub-panel[data-panel-sub="reportes"]');
    if (!panel) return;
    repHasta = hoyISO();
    repDesde = masDiasISO(hoyISO(), -7);
    panel.innerHTML = `
      <div class="limp-cab">
        <div class="limp-cab-fecha">
          <label class="limp-rep-fecha-lbl">Desde<input type="date" id="rep-desde" class="input-fecha" value="${repDesde}"></label>
          <label class="limp-rep-fecha-lbl">Hasta<input type="date" id="rep-hasta" class="input-fecha" value="${repHasta}"></label>
        </div>
        <div class="limp-rep-pills">
          <button class="rsv-f-pill" data-rango="hoy">Hoy</button>
          <button class="rsv-f-pill" data-rango="semana">Última semana</button>
          <button class="rsv-f-pill" data-rango="mes">Último mes</button>
        </div>
      </div>
      <input type="search" id="rep-buscar" class="input-buscar limp-buscar" placeholder="Buscar apartamento...">
      <div id="rep-contador" class="limp-rep-contador"></div>
      <div id="rep-lista" class="limp-lista"></div>`;

    document.getElementById('rep-desde').addEventListener('change', (e) => { repDesde = e.target.value; cargarReportes(); });
    document.getElementById('rep-hasta').addEventListener('change', (e) => { repHasta = e.target.value; cargarReportes(); });
    document.getElementById('rep-buscar').addEventListener('input', (e) => { repBusqueda = e.target.value; renderReportes(); });
    panel.querySelectorAll('.limp-rep-pills .rsv-f-pill').forEach((p) =>
      p.addEventListener('click', () => aplicarRangoReportes(p.dataset.rango)));
    repConstruido = true;
  }

  function aplicarRangoReportes(rango) {
    const hoy = hoyISO();
    if (rango === 'hoy') { repDesde = hoy; repHasta = hoy; }
    else if (rango === 'semana') { repDesde = masDiasISO(hoy, -7); repHasta = hoy; }
    else if (rango === 'mes') { repDesde = masDiasISO(hoy, -30); repHasta = hoy; }
    const d = document.getElementById('rep-desde'); if (d) d.value = repDesde;
    const h = document.getElementById('rep-hasta'); if (h) h.value = repHasta;
    cargarReportes();
  }

  function skeletonReportes() {
    return '<div class="limp-rep-sk"></div>'.repeat(4);
  }

  async function cargarReportes() {
    const lista = document.getElementById('rep-lista');
    if (lista) lista.innerHTML = skeletonReportes();
    const qs = new URLSearchParams();
    if (repDesde) qs.set('desde', repDesde);
    if (repHasta) qs.set('hasta', repHasta);
    try {
      reportes = await API.get('/api/limpieza/reportes?' + qs.toString());
    } catch (e) {
      if (lista) lista.innerHTML = '<div class="limp-vacio">No se pudieron cargar los reportes.</div>';
      return toast(e.message, 'error');
    }
    // El endpoint devuelve num_fotos pero no las urls: cargar el detalle de los que tienen fotos.
    await Promise.all(reportes.map(async (r) => {
      if (r.num_fotos > 0) {
        try { const d = await API.get(`/api/limpieza/tareas/${r.id}/detalle`); r.fotos = d.fotos || []; }
        catch (e) { r.fotos = []; }
      } else { r.fotos = []; }
    }));
    renderReportes();
  }

  function renderReportes() {
    const cont = document.getElementById('rep-lista');
    const contador = document.getElementById('rep-contador');
    if (!cont) return;
    const q = repBusqueda.trim().toLowerCase();
    const lista = reportes.filter((r) => !q || (r.apartamento_nombre || '').toLowerCase().includes(q));
    if (contador) contador.textContent = `${lista.length} reporte${lista.length === 1 ? '' : 's'} encontrado${lista.length === 1 ? '' : 's'}`;
    if (!lista.length) {
      cont.innerHTML = '<div class="limp-vacio">No hay reportes con incidencias en este rango.</div>';
      return;
    }
    cont.innerHTML = lista.map(repCardHTML).join('');

    cont.querySelectorAll('[data-vermas]').forEach((b) => {
      const nota = b.previousElementSibling;
      // Oculta "ver más" si la nota no desborda las 3 líneas.
      if (nota && nota.scrollHeight <= nota.clientHeight + 2) { b.style.display = 'none'; return; }
      b.addEventListener('click', () => {
        const exp = nota.classList.toggle('expandida');
        b.textContent = exp ? 'ver menos' : 'ver más…';
      });
    });
    cont.querySelectorAll('[data-rep-thumb]').forEach((img) =>
      img.addEventListener('click', () => {
        const r = reportes.find((x) => x.id == img.dataset.repThumb);
        abrirLbRep(r ? r.fotos : [], Number(img.dataset.idx));
      }));
    cont.querySelectorAll('[data-rep-detalle]').forEach((b) =>
      b.addEventListener('click', () => modalReporte(reportes.find((r) => r.id == b.dataset.repDetalle))));
  }

  function repCardHTML(r) {
    const fotos = r.fotos || [];
    const thumbs = fotos.slice(0, 3).map((f, i) =>
      `<img src="${esc(f.url)}" class="limp-rep-thumb" data-rep-thumb="${r.id}" data-idx="${i}" alt="">`).join('');
    const masFotos = fotos.length > 3 ? `<span class="limp-rep-mas">+${fotos.length - 3} más</span>` : '';
    const nota = r.notas_limpieza && String(r.notas_limpieza).trim();
    const notaHTML = nota
      ? `<div class="limp-rep-nota-wrap">
           <div class="limp-rep-nota">${esc(r.notas_limpieza).replace(/\n/g, '<br>')}</div>
           <button class="limp-rep-vermas" data-vermas>ver más…</button>
         </div>` : '';
    const fotosHTML = fotos.length
      ? `<div class="limp-rep-fotoline">📷 ${fotos.length} foto${fotos.length === 1 ? '' : 's'} adjunta${fotos.length === 1 ? '' : 's'}</div>
         <div class="limp-rep-thumbs">${thumbs}${masFotos}</div>` : '';

    return `
      <div class="limp-card limp-card-comp">
        <div class="limp-card-nombre">🏠 ${esc(r.apartamento_nombre)} ${clasifBadge(r.tipo_clasificacion)}</div>
        <div class="limp-rep-meta">📅 ${fmtFechaHora(r.completado_fecha)}</div>
        <div class="limp-rep-meta">👤 Limpiado por: ${esc(r.completado_nombre) || '—'}</div>
        ${nota ? '<div class="limp-rep-nota-lbl">📝 Nota:</div>' : ''}
        ${notaHTML}
        ${fotosHTML}
        <div class="limp-card-acciones">
          <button class="btn-sec limp-btn" data-rep-detalle="${r.id}">Ver detalle completo</button>
        </div>
      </div>`;
  }

  // ---- Modal detalle de reporte ----
  async function modalReporte(r) {
    if (!r) return;
    let d;
    try { d = await API.get(`/api/limpieza/tareas/${r.id}/detalle`); }
    catch (e) { return toast(e.message, 'error'); }
    const fotos = d.fotos || [];
    repLbFotos = fotos;

    const tipoTxt = d.tipo === 'turnover' ? '⚡ Turnover' : d.tipo === 'manual' ? '🧹 Manual' : '↗ Checkout';
    const sale = d.reserva_checkout
      ? `<div class="limp-linea">↗ Salió: <strong>${esc(d.reserva_checkout.nombre_cliente)}</strong></div>` : '';
    const entra = d.reserva_checkin
      ? `<div class="limp-linea">↘ Entró: <strong>${esc(d.reserva_checkin.nombre_cliente)}</strong></div>` : '';
    const galeria = fotos.length
      ? `<div class="campo"><label>Fotos (${fotos.length})</label>
           <div class="limp-rep-galeria">${fotos.map((f, i) => `<img src="${esc(f.url)}" class="limp-rep-gfoto" data-lbidx="${i}" alt="">`).join('')}</div></div>`
      : '';
    const hayIncidencia = d.notas_limpieza && RE_INCIDENCIA.test(d.notas_limpieza);
    const btnGasto = hayIncidencia
      ? '<button class="btn-sec" id="rep-crear-gasto">🔧 Crear gasto</button>' : '';

    abrirModal(`
      <h3>🏠 ${esc(d.apartamento_nombre)} ${clasifBadge(d.tipo_clasificacion)}</h3>
      <div class="limp-rep-meta">📅 ${fmtFechaHora(d.completado_fecha)} · ${tipoTxt}</div>
      ${sale}${entra}
      <div class="limp-linea">👤 Limpiado por: <strong>${esc(d.completado_nombre) || '—'}</strong></div>
      <div class="campo"><label>Nota / incidencias</label>
        <div class="limp-notas-texto">${d.notas_limpieza ? esc(d.notas_limpieza).replace(/\n/g, '<br>') : '—'}</div></div>
      ${galeria}
      <div class="modal-acciones">
        ${btnGasto}
        <button class="btn-pri" id="rep-cerrar">Cerrar</button>
      </div>`);
    document.querySelector('.modal').classList.add('modal-ancho');

    document.getElementById('rep-cerrar').addEventListener('click', cerrarModal);
    document.querySelectorAll('.limp-rep-gfoto').forEach((img) =>
      img.addEventListener('click', () => abrirLbRep(fotos, Number(img.dataset.lbidx))));
    const bg = document.getElementById('rep-crear-gasto');
    if (bg) bg.addEventListener('click', () => {
      cerrarModal();
      if (typeof activarTab === 'function') activarTab('alojamientos');
      if (typeof Alojamientos !== 'undefined' && Alojamientos.abrirFicha) Alojamientos.abrirFicha(d.apartamento_id);
      toast('Abre la pestaña Gastos del alojamiento para registrar el gasto', 'aviso');
    });
  }

  // ---- Lightbox de reportes (mismas clases visuales que la galería) ----
  function abrirLbRep(fotos, idx) {
    if (!fotos || !fotos.length) return;
    repLbFotos = fotos;
    repLbIdx = idx;
    let box = document.getElementById('limp-lightbox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'limp-lightbox';
      box.className = 'alo-lightbox';
      box.innerHTML = `
        <button class="alo-lb-cerrar" data-lb="cerrar" title="Cerrar">✕</button>
        <button class="alo-lb-nav alo-lb-prev" data-lb="prev" title="Anterior">◀</button>
        <figure class="alo-lb-fig"><img id="limp-lb-img" src="" alt=""><figcaption id="limp-lb-cap"></figcaption></figure>
        <button class="alo-lb-nav alo-lb-next" data-lb="next" title="Siguiente">▶</button>`;
      document.body.appendChild(box);
      box.addEventListener('click', (e) => {
        const acc = e.target.closest('[data-lb]');
        if (acc) { const a = acc.dataset.lb; if (a === 'cerrar') cerrarLbRep(); else navLbRep(a === 'next' ? 1 : -1); return; }
        if (e.target === box) cerrarLbRep();
      });
      document.addEventListener('keydown', lbRepKeys, true);
    }
    pintarLbRep();
    box.classList.add('abierto');
  }
  function pintarLbRep() {
    const f = repLbFotos[repLbIdx];
    if (!f) return cerrarLbRep();
    const img = document.getElementById('limp-lb-img');
    const cap = document.getElementById('limp-lb-cap');
    if (img) img.src = f.url;
    if (cap) cap.textContent = f.descripcion || '';
    const box = document.getElementById('limp-lightbox');
    if (box) {
      const vis = repLbFotos.length > 1 ? 'visible' : 'hidden';
      box.querySelector('.alo-lb-prev').style.visibility = vis;
      box.querySelector('.alo-lb-next').style.visibility = vis;
    }
  }
  function navLbRep(delta) {
    if (!repLbFotos.length) return;
    repLbIdx = (repLbIdx + delta + repLbFotos.length) % repLbFotos.length;
    pintarLbRep();
  }
  function cerrarLbRep() {
    const box = document.getElementById('limp-lightbox');
    if (box) box.classList.remove('abierto');
    repLbIdx = -1;
  }
  function lbRepKeys(e) {
    const box = document.getElementById('limp-lightbox');
    if (!box || !box.classList.contains('abierto')) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrarLbRep(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); navLbRep(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); navLbRep(-1); }
  }

  // ==================== Init ====================
  function val(id) { const el = document.getElementById(id); return el ? el.value : ''; }

  function init() {
    const inp = document.getElementById('limp-fecha');
    if (inp) {
      inp.value = fecha;
      inp.addEventListener('change', (e) => { fecha = e.target.value || hoyISO(); cargarTareas(); });
    }
    document.getElementById('limp-hoy')?.addEventListener('click', () => { fecha = hoyISO(); if (inp) inp.value = fecha; cargarTareas(); });
    document.getElementById('limp-manana')?.addEventListener('click', () => { fecha = masDiasISO(hoyISO(), 1); if (inp) inp.value = fecha; cargarTareas(); });
    // El rol limpieza no crea tareas: solo marca limpio y reporta. Ocultar "Añadir pisos".
    const btnAdd = document.getElementById('limp-add');
    if (btnAdd) {
      if ((Auth.sesion() || {}).rol === 'limpieza') btnAdd.classList.add('oculto');
      else btnAdd.addEventListener('click', modalAddPiso);
    }
    document.getElementById('limp-buscar')?.addEventListener('input', (e) => { busqueda = e.target.value; renderLista(); });

    // Filtro pill por estado, inyectado junto al buscador (estilo del planning).
    const buscar = document.getElementById('limp-buscar');
    if (buscar && !document.getElementById('limp-estado-filtro')) {
      const pills = document.createElement('div');
      pills.id = 'limp-estado-filtro';
      pills.className = 'filtro-tih-btns limp-estado-filtro';
      pills.innerHTML = `
        <button class="btn-filtro-tih activo" data-est="todos">Todos</button>
        <button class="btn-filtro-tih" data-est="pendientes">🔴 Pendientes</button>
        <button class="btn-filtro-tih" data-est="completadas">✅ Completadas</button>`;
      buscar.insertAdjacentElement('afterend', pills);
      pills.querySelectorAll('.btn-filtro-tih').forEach((b) =>
        b.addEventListener('click', () => {
          fEstado = b.dataset.est;
          pills.querySelectorAll('.btn-filtro-tih').forEach((x) => x.classList.toggle('activo', x === b));
          renderLista();
        }));
    }

    // Sub-pestañas Tareas / Reportes.
    document.querySelectorAll('#limp-subtabs .subtab').forEach((b) =>
      b.addEventListener('click', () => {
        document.querySelectorAll('#limp-subtabs .subtab').forEach((x) => x.classList.toggle('activo', x === b));
        document.querySelectorAll('#vista-limpieza .sub-panel').forEach((p) =>
          p.classList.toggle('activo', p.dataset.panelSub === b.dataset.sub));
        if (b.dataset.sub === 'reportes') { construirReportes(); cargarReportes(); }
      }));
  }

  return { init, cargar };
})();
