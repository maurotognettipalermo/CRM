// Módulo Personal (RRHH). Sub-pestañas Fichaje | Empleados | Ausencias | Horas extra.
// En esta entrega solo está implementada "Empleados"; el resto son placeholders.

const Personal = (() => {
  let empleados = [];
  let estadoHoy = {};          // empleado_id -> 'trabajando'|'pausa'|'fuera'
  let fichaActual = null;      // empleado abierto en el panel
  let busqueda = '';
  let usuariosCache = [];      // catálogo de usuarios del CRM para el select

  // Estado de la sub-pestaña Fichaje.
  let fichajeConstruido = false;
  let fichajeHoy = [];         // fichajes del empleado hoy
  let fichajeTimer = null;     // setInterval del contador en vivo
  let equipoFecha = '';        // fecha del resumen de equipo (admin)

  // Estado de la sub-pestaña Ausencias.
  let ausConstruido = false;
  let ausAnio = new Date().getFullYear();
  let ausMes = new Date().getMonth() + 1;
  let ausEmpleados = [];
  let ausCalendario = [];      // [{fecha,empleado_id,tipo}]
  let ausLista = [];           // ausencias del año (con rangos)
  let ausSaldos = {};          // empleado_id -> saldo
  let ausFiltroEmp = '';

  // Estado de la sub-pestaña Horas extra.
  let hxConstruido = false;
  let hxAnio = new Date().getFullYear();
  let hxOwnId = undefined;     // id del empleado del usuario logueado (null si no tiene ficha)
  let hxLista = [];            // horas extra propias del año
  let hxEmpleados = [];        // empleados (para el selector admin)
  let hxAdminEmp = '';         // empleado seleccionado en la gestión admin
  let hxAdminAnio = new Date().getFullYear();
  let hxAdminLista = [];

  const ANIO = new Date().getFullYear();

  // Tipos de ausencia (valor, etiqueta, color).
  const AUS_TIPOS = [
    { v: 'vacaciones', l: 'Vacaciones', c: '#10b981' },
    { v: 'dia_libre', l: 'Día libre', c: '#3b82f6' },
    { v: 'dia_gracia', l: 'Día de gracia', c: '#8b5cf6' },
    { v: 'baja_medica', l: 'Baja médica', c: '#ef4444' },
    { v: 'asuntos_propios', l: 'Asuntos propios', c: '#f59e0b' },
  ];
  function ausTipo(v) { return AUS_TIPOS.find((t) => t.v === v) || { l: v, c: '#9ca3af' }; }

  // ==================== Helpers ====================
  function rol() { return (Auth.sesion() || {}).rol; }
  function esAdmin() { return rol() === 'administrador'; }
  function val(id) { const el = document.getElementById(id); return el ? el.value : ''; }

  // Color estable a partir del nombre (para el avatar).
  const AVATAR_COLORES = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#0ea5e9', '#ec4899', '#14b8a6'];
  function colorDe(nombre) {
    let h = 0;
    for (let i = 0; i < (nombre || '').length; i++) h = (h * 31 + nombre.charCodeAt(i)) >>> 0;
    return AVATAR_COLORES[h % AVATAR_COLORES.length];
  }
  function avatarHTML(nombre, tam) {
    const ini = (nombre || '?').trim().charAt(0).toUpperCase() || '?';
    const s = tam || 34;
    return `<span class="per-avatar" style="background:${colorDe(nombre)};width:${s}px;height:${s}px;font-size:${Math.round(s * 0.42)}px">${esc(ini)}</span>`;
  }
  function nom(e) { return [e.nombre, e.apellidos].filter(Boolean).join(' '); }
  function euro(n) {
    if (n === null || n === undefined || n === '') return '0 €';
    return (Math.round(Number(n) * 100) / 100).toLocaleString('de-DE') + ' €';
  }
  function hoyStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  // 'HH:MM[:SS]' -> segundos desde medianoche.
  function hms(h) {
    if (!h) return 0;
    const p = String(h).split(':').map((x) => parseInt(x, 10) || 0);
    return (p[0] || 0) * 3600 + (p[1] || 0) * 60 + (p[2] || 0);
  }
  function ahoraSeg() { const d = new Date(); return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds(); }
  // Duración legible: "4h 32min" (o "4h 32min 05s" si conSeg).
  function fmtDur(sec, conSeg) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (conSeg) return (h > 0 ? `${h}h ${m}min ` : `${m}min `) + `${String(s).padStart(2, '0')}s`;
    return h > 0 ? `${h}h ${m}min` : `${m}min`;
  }
  // Horas decimales -> "Xh Ymin".
  function horasTexto(horasDec) { return fmtDur((Number(horasDec) || 0) * 3600, false); }

  function estadoBadge(est) {
    const map = {
      trabajando: ['per-bdg-trab', 'Trabajando'],
      pausa: ['per-bdg-pausa', 'En pausa'],
      fuera: ['per-bdg-fuera', 'Fuera'],
    };
    const x = map[est] || map.fuera;
    return `<span class="per-bdg ${x[0]}">${x[1]}</span>`;
  }

  // Estado de la secuencia de fichajes del día (igual que en el backend).
  function estadoDe(rows) {
    let e = 'fuera';
    for (const f of rows || []) {
      if (f.tipo === 'entrada' || f.tipo === 'reanudacion') e = 'trabajando';
      else if (f.tipo === 'pausa') e = 'pausa';
      else if (f.tipo === 'salida') e = 'fuera';
    }
    return e;
  }

  // ==================== Carga ====================
  async function cargar() {
    // Activa la sub-pestaña por defecto según el rol y carga su contenido.
    const def = puedeVerEmpleados() ? 'empleados' : 'fichaje';
    activarSub(def);
  }

  function puedeVerEmpleados() { return esAdmin() || rol() === 'usuario'; }

  async function cargarEmpleados() {
    const tbody = document.querySelector('#tabla-empleados tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="vta-cargando">Cargando empleados…</td></tr>';
    try {
      empleados = await API.get('/api/personal/empleados?todos=1');
    } catch (e) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="vta-cargando">No se pudieron cargar los empleados.</td></tr>';
      return toast(e.message, 'error');
    }
    await cargarEstadoHoy();
    renderTabla();
  }

  // Estado de fichaje de hoy por empleado (admin: todos; usuario: solo el suyo).
  async function cargarEstadoHoy() {
    estadoHoy = {};
    try {
      const fichajes = await API.get('/api/personal/fichajes');
      const porEmp = {};
      fichajes.forEach((f) => { (porEmp[f.empleado_id] = porEmp[f.empleado_id] || []).push(f); });
      Object.keys(porEmp).forEach((id) => { estadoHoy[id] = estadoDe(porEmp[id]); });
    } catch (e) { /* sin estado: se mostrará "Fuera" */ }
  }

  // ==================== Tabla ====================
  function filtradas() {
    const q = busqueda.trim().toLowerCase();
    if (!q) return empleados;
    return empleados.filter((e) =>
      `${e.nombre || ''} ${e.apellidos || ''} ${e.puesto || ''} ${e.email || ''} ${e.telefono || ''}`.toLowerCase().includes(q));
  }

  function renderTabla() {
    const tbody = document.querySelector('#tabla-empleados tbody');
    if (!tbody) return;
    const lista = filtradas();
    const cont = document.getElementById('per-contador');
    if (cont) cont.textContent = `${lista.length} empleado${lista.length === 1 ? '' : 's'}`;

    if (!empleados.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="vta-vacio">No hay empleados. Crea el primero con “＋ Nuevo empleado”.</td></tr>';
      return;
    }
    if (!lista.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="vta-vacio">Ningún empleado coincide con la búsqueda.</td></tr>';
      return;
    }
    tbody.innerHTML = lista.map(filaHTML).join('');

    tbody.querySelectorAll('tr[data-ficha]').forEach((tr) =>
      tr.addEventListener('click', (e) => {
        if (e.target.closest('[data-editar]') || e.target.closest('[data-borrar]') || e.target.closest('[data-nom]')) return;
        abrirFicha(tr.dataset.ficha);
      }));
    tbody.querySelectorAll('[data-nom]').forEach((a) =>
      a.addEventListener('click', (e) => { e.stopPropagation(); abrirFicha(a.dataset.nom); }));
    tbody.querySelectorAll('[data-editar]').forEach((b) =>
      b.addEventListener('click', (e) => { e.stopPropagation(); modalEmpleado(empleados.find((x) => x.id == b.dataset.editar)); }));
    tbody.querySelectorAll('[data-borrar]').forEach((b) =>
      b.addEventListener('click', (e) => { e.stopPropagation(); borrar(empleados.find((x) => x.id == b.dataset.borrar)); }));
  }

  function filaHTML(e) {
    const nombre = nom(e);
    const inactivo = e.activo == 0 ? ' <span class="per-bdg per-bdg-inactivo">Inactivo</span>' : '';
    const puesto = e.puesto ? `<span class="per-bdg-puesto">${esc(e.puesto)}</span>` : '<span class="vta-muted">—</span>';
    const est = estadoBadge(estadoHoy[e.id] || 'fuera');
    return `
      <tr data-ficha="${e.id}"${e.activo == 0 ? ' style="background:#f9fafb;color:#9ca3af"' : ''}>
        <td class="per-avatar-cel">${avatarHTML(nombre)}</td>
        <td><a class="vta-ref per-nombre" data-nom="${e.id}">${esc(nombre) || '—'}</a>${inactivo}</td>
        <td>${puesto}</td>
        <td>${esc(e.telefono) || '—'}</td>
        <td>${esc(e.email) || '—'}</td>
        <td>${est}</td>
        <td class="vta-acciones">
          <button class="btn-icono" data-editar="${e.id}" title="Editar">✏️</button>
          <button class="btn-icono" data-borrar="${e.id}" title="Eliminar">🗑</button>
        </td>
      </tr>`;
  }

  // ==================== Panel lateral (ficha) ====================
  function crearPanel() {
    if (document.getElementById('per-panel')) return;
    const fondo = document.createElement('div');
    fondo.id = 'per-panel-fondo';
    fondo.className = 'panel-fondo';
    const panel = document.createElement('aside');
    panel.id = 'per-panel';
    panel.className = 'panel-lateral';
    panel.setAttribute('aria-label', 'Ficha de empleado');
    panel.innerHTML = `
      <header class="panel-cabecera">
        <div class="rsv-titulo-grupo">
          <h3 id="per-d-titulo">Empleado</h3>
          <span id="per-d-badges"></span>
        </div>
        <div class="panel-cabecera-acciones">
          <button id="per-d-editar" class="btn-sec">✏️ Editar</button>
          <button id="per-d-cerrar" class="panel-cerrar" title="Cerrar">&times;</button>
        </div>
      </header>
      <div id="per-d-cuerpo" class="panel-cuerpo"></div>`;
    document.body.appendChild(fondo);
    document.body.appendChild(panel);
    fondo.addEventListener('click', cerrarPanel);
    panel.querySelector('#per-d-cerrar').addEventListener('click', cerrarPanel);
    panel.querySelector('#per-d-editar').addEventListener('click', () => { if (fichaActual) modalEmpleado(fichaActual); });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const modalAbierto = !document.getElementById('modal-fondo').classList.contains('oculto');
      if (!modalAbierto && panel.classList.contains('abierto')) cerrarPanel();
    }, true);
  }
  function abrirPanel() {
    document.getElementById('per-panel-fondo').classList.add('abierto');
    document.getElementById('per-panel').classList.add('abierto');
  }
  function cerrarPanel() {
    document.getElementById('per-panel-fondo')?.classList.remove('abierto');
    document.getElementById('per-panel')?.classList.remove('abierto');
    fichaActual = null;
  }

  function dato(etq, valor) {
    return `<div class="campo-ficha"><div class="etq">${etq}</div><div class="val">${valor}</div></div>`;
  }

  async function abrirFicha(id) {
    crearPanel();
    let d;
    try { d = await API.get('/api/personal/empleados/' + id); }
    catch (e) { return toast(e.message, 'error'); }
    fichaActual = d;
    document.getElementById('per-d-titulo').textContent = nom(d) || 'Empleado';
    const puesto = d.puesto ? `<span class="per-bdg-puesto">${esc(d.puesto)}</span>` : '';
    const act = d.activo == 0
      ? '<span class="per-bdg per-bdg-inactivo">Inactivo</span>'
      : '<span class="per-bdg per-bdg-activo">Activo</span>';
    document.getElementById('per-d-badges').innerHTML = `${puesto} ${act}`;
    renderCuerpo(d);
    abrirPanel();
    cargarResumenFicha(d.id);
  }

  function renderCuerpo(d) {
    const vinc = d.usuario_username
      ? `<span class="vta-bdg per-bdg-vinc">🔗 ${esc(d.usuario_username)}</span>`
      : '<span class="vta-muted">Sin vincular</span>';
    const datos = `
      <div class="vta-d-seccion">
        <div class="vta-d-titulo-sec">👤 Datos personales</div>
        <div class="vta-d-grid">
          ${dato('Nombre', esc(d.nombre) || '—')}
          ${dato('Apellidos', esc(d.apellidos) || '—')}
          ${dato('DNI', esc(d.dni) || '—')}
          ${dato('Puesto', esc(d.puesto) || '—')}
          ${dato('Teléfono', d.telefono ? `<a class="vta-link" href="tel:${esc(d.telefono)}">${esc(d.telefono)}</a>` : '—')}
          ${dato('Email', d.email ? `<a class="vta-link" href="mailto:${esc(d.email)}">${esc(d.email)}</a>` : '—')}
          ${dato('Fecha de inicio', d.fecha_inicio ? fechaES(d.fecha_inicio) : '—')}
          ${dato('Días de vacaciones/año', d.dias_vacaciones_anio ?? 30)}
          ${dato('Usuario CRM', vinc)}
        </div>
        ${d.notas ? `<div class="vta-d-linea" style="margin-top:10px"><strong>Notas:</strong> ${esc(d.notas)}</div>` : ''}
      </div>
      <div class="vta-d-seccion">
        <div class="vta-d-titulo-sec">📊 Resumen ${ANIO}</div>
        <div class="per-mini-grid" id="per-d-resumen">
          <div class="vta-muted">Cargando resumen…</div>
        </div>
      </div>`;
    document.getElementById('per-d-cuerpo').innerHTML = datos;
  }

  // Carga saldo de vacaciones, horas extra y fichajes del mes para la ficha.
  async function cargarResumenFicha(id) {
    const cont = document.getElementById('per-d-resumen');
    if (!cont) return;
    const mesActual = new Date().getMonth() + 1;
    const [saldo, horas, resMes] = await Promise.all([
      API.get(`/api/personal/ausencias/saldo?empleado_id=${id}&anio=${ANIO}`).catch(() => null),
      API.get(`/api/personal/horas-extra/resumen?empleado_id=${id}&anio=${ANIO}`).catch(() => null),
      API.get(`/api/personal/fichajes/resumen?empleado_id=${id}&mes=${mesActual}&anio=${ANIO}`).catch(() => null),
    ]);

    const vacUsados = saldo ? saldo.usados : 0;
    const vacTotal = saldo ? saldo.total : 30;
    const pct = vacTotal ? Math.min(100, Math.round((vacUsados / vacTotal) * 100)) : 0;
    const hePend = horas ? horas.horas_pendientes : 0;
    const hePagado = horas ? horas.total_pagado : 0;
    const diasMes = (resMes && resMes.empleados && resMes.empleados[0]) ? resMes.empleados[0].dias.length : 0;

    const card = (valor, lbl, extra) =>
      `<div class="per-mini">${extra || ''}<div class="per-mini-val">${valor}</div><div class="per-mini-lbl">${lbl}</div></div>`;
    cont.innerHTML =
      card(`${vacUsados}/${vacTotal}`, 'Vacaciones (días)',
        `<div class="per-barra"><div class="per-barra-fill" style="width:${pct}%"></div></div>`) +
      card(`${hePend} h`, 'Horas extra pendientes') +
      card(euro(hePagado), 'Horas extra pagadas') +
      card(`${diasMes}`, 'Fichajes este mes');
  }

  // ==================== Modal nuevo / editar ====================
  async function modalEmpleado(e) {
    const esNuevo = !e;
    e = e || {};
    if (!usuariosCache.length) {
      try { usuariosCache = await API.get('/api/usuarios'); } catch (err) { usuariosCache = []; }
    }
    const optUsr = '<option value="">— Sin vincular —</option>' +
      usuariosCache.map((u) =>
        `<option value="${u.id}"${e.usuario_id == u.id ? ' selected' : ''}>${esc(u.nombre)} (${esc(u.username)})</option>`).join('');

    abrirModal(`
      <h3>${esNuevo ? '＋ Nuevo empleado' : '✏️ Editar empleado'}</h3>
      <div class="fila-campos">
        <div class="campo"><label>Nombre *</label><input id="ef-nombre" value="${esc(e.nombre)}"></div>
        <div class="campo"><label>Apellidos</label><input id="ef-apellidos" value="${esc(e.apellidos)}"></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>DNI</label><input id="ef-dni" value="${esc(e.dni)}"></div>
        <div class="campo"><label>Puesto</label><input id="ef-puesto" value="${esc(e.puesto)}"></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Teléfono</label><input id="ef-telefono" value="${esc(e.telefono)}"></div>
        <div class="campo"><label>Email</label><input id="ef-email" value="${esc(e.email)}"></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Fecha de inicio</label><input type="date" id="ef-fecha_inicio" value="${esc(e.fecha_inicio)}"></div>
        <div class="campo"><label>Días de vacaciones/año</label><input type="number" min="0" id="ef-dias_vacaciones_anio" value="${e.dias_vacaciones_anio ?? 30}"></div>
      </div>
      <div class="campo"><label>Usuario CRM</label><select id="ef-usuario_id">${optUsr}</select></div>
      <label class="toggle-campo"><input type="checkbox" id="ef-activo"${esNuevo || e.activo != 0 ? ' checked' : ''}><span>Empleado activo</span></label>
      <div class="campo"><label>Notas</label><textarea id="ef-notas" rows="2">${esc(e.notas)}</textarea></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="ef-cancelar">Cancelar</button>
        <button class="btn-pri" id="ef-guardar">${esNuevo ? 'Crear' : 'Guardar'}</button>
      </div>`);
    document.querySelector('.modal').classList.add('modal-ancho');
    document.getElementById('ef-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('ef-guardar').addEventListener('click', () => guardar(esNuevo ? null : e.id));
  }

  async function guardar(id) {
    const nombre = val('ef-nombre').trim();
    if (!nombre) return toast('El nombre es obligatorio', 'error');
    const body = {
      nombre,
      apellidos: val('ef-apellidos'),
      dni: val('ef-dni'),
      puesto: val('ef-puesto'),
      telefono: val('ef-telefono'),
      email: val('ef-email'),
      fecha_inicio: val('ef-fecha_inicio'),
      dias_vacaciones_anio: val('ef-dias_vacaciones_anio'),
      usuario_id: val('ef-usuario_id') || null,
      activo: document.getElementById('ef-activo').checked ? 1 : 0,
      notas: val('ef-notas'),
    };
    // Confirmar al pasar un empleado de activo a inactivo.
    if (id) {
      const prev = empleados.find((x) => x.id == id);
      if (prev && prev.activo != 0 && body.activo == 0 &&
          !confirm(`¿Marcar a ${nombre} como inactivo? Dejará de aparecer en fichajes, ausencias y calendario del equipo pero se conservará su historial.`)) {
        return;
      }
    }
    const btn = document.getElementById('ef-guardar');
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      if (id) await API.put('/api/personal/empleados/' + id, body);
      else await API.post('/api/personal/empleados', body);
      cerrarModal();
      await cargarEmpleados();
      if (fichaActual && id && fichaActual.id === id) await abrirFicha(id);
      toast(id ? 'Empleado actualizado' : 'Empleado creado', 'ok');
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false; btn.textContent = id ? 'Guardar' : 'Crear';
    }
  }

  async function borrar(e) {
    if (!e) return;
    if (!confirm(`¿Eliminar al empleado ${nom(e)}?`)) return;
    try {
      await API.del('/api/personal/empleados/' + e.id);
      await cargarEmpleados();
      toast('Empleado eliminado', 'ok');
    } catch (err) {
      toast(err.message, 'error'); // 409 → "tiene fichajes o ausencias"
    }
  }

  // ============================================================
  //                    SUB-PESTAÑA FICHAJE
  // ============================================================
  function saludo() {
    const h = new Date().getHours();
    if (h < 12) return 'Buenos días';
    if (h < 20) return 'Buenas tardes';
    return 'Buenas noches';
  }
  function nombreCorto() {
    const s = Auth.sesion() || {};
    return (s.nombre || s.username || '').split(' ')[0] || '';
  }

  // Cálculo en vivo a partir de los fichajes del día y la hora local actual.
  function calcFichaje(rows) {
    const nowSec = ahoraSeg();
    let estado = 'fuera', total = 0, abierto = null;
    let entradaInicial = null, lastStart = null, pausaStart = null;
    for (const f of rows) {
      const s = hms(f.hora);
      if (f.tipo === 'entrada') { if (!entradaInicial) entradaInicial = f.hora; abierto = s; lastStart = f.hora; estado = 'trabajando'; }
      else if (f.tipo === 'reanudacion') { abierto = s; lastStart = f.hora; estado = 'trabajando'; }
      else if (f.tipo === 'pausa') { if (abierto !== null) { total += s - abierto; abierto = null; } pausaStart = f.hora; estado = 'pausa'; }
      else if (f.tipo === 'salida') { if (abierto !== null) { total += s - abierto; abierto = null; } estado = 'fuera'; }
    }
    let worked = total;
    if (abierto !== null && nowSec > abierto) worked += nowSec - abierto;
    let pauseSec = 0;
    if (estado === 'pausa' && pausaStart) { const ps = hms(pausaStart); if (nowSec > ps) pauseSec = nowSec - ps; }
    return { estado, worked, pauseSec, entradaInicial, lastStart, pausaStart, tuvoFichajes: rows.length > 0 };
  }

  // Construye la estructura de la sub-pestaña (una vez).
  function construirFichaje() {
    if (fichajeConstruido) return;
    const panel = document.querySelector('#vista-personal .sub-panel[data-panel-sub="fichaje"]');
    if (!panel) return;
    panel.innerHTML = `
      <div class="per-fichaje-wrap">
        <div id="per-fichaje-main" class="per-fichaje-main"></div>
        <div id="per-timeline" class="per-timeline"></div>
      </div>
      <div id="per-equipo" class="per-equipo"></div>`;
    fichajeConstruido = true;
  }

  async function cargarFichaje() {
    const main = document.getElementById('per-fichaje-main');
    if (main) main.innerHTML = '<div class="vta-cargando">Cargando…</div>';
    let data;
    try { data = await API.get('/api/personal/fichajes/estado'); }
    catch (e) {
      if (main) main.innerHTML = `<div class="per-sin-ficha">⚠️ ${esc(e.message)}<div class="per-sin-ficha-sub">Pide a un administrador que vincule tu usuario con tu ficha de empleado.</div></div>`;
      document.getElementById('per-timeline').innerHTML = '';
      return;
    }
    fichajeHoy = data.fichajes || [];
    renderFichajePanel();
    renderTimeline();
    if (esAdmin()) {
      if (!equipoFecha) equipoFecha = hoyStr();
      cargarEquipo();
    }
  }

  function renderFichajePanel() {
    const main = document.getElementById('per-fichaje-main');
    if (!main) return;
    if (fichajeTimer) { clearInterval(fichajeTimer); fichajeTimer = null; }
    const c = calcFichaje(fichajeHoy);

    let html = '';
    if (c.estado === 'fuera') {
      const sub = c.tuvoFichajes ? 'Jornada finalizada por hoy' : 'No has fichado hoy todavía';
      html = `
        <div class="per-fic-saludo">${esc(saludo())}, ${esc(nombreCorto())}</div>
        <button class="per-fic-btn per-fic-verde" data-ficha-tipo="entrada">🟢 Fichar entrada</button>
        <div class="per-fic-info">${sub}</div>`;
    } else if (c.estado === 'trabajando') {
      html = `
        <div class="per-fic-estado">Trabajando desde las ${esc((c.lastStart || '').slice(0, 5))}</div>
        <div class="per-fic-timer" id="per-timer">⏱ ${fmtDur(c.worked, true)}</div>
        <div class="per-fic-acciones">
          <button class="per-fic-btn per-fic-naranja" data-ficha-tipo="pausa">⏸ Pausa</button>
          <button class="per-fic-btn per-fic-rojo" data-ficha-tipo="salida">🔴 Fichar salida</button>
        </div>
        <div class="per-fic-info">Tiempo de hoy: <strong id="per-timer-hoy">${fmtDur(c.worked, false)}</strong></div>`;
    } else { // pausa
      html = `
        <div class="per-fic-estado">En pausa desde las ${esc((c.pausaStart || '').slice(0, 5))}</div>
        <div class="per-fic-timer per-fic-timer-pausa" id="per-timer">☕ ${fmtDur(c.pauseSec, true)}</div>
        <button class="per-fic-btn per-fic-azul" data-ficha-tipo="reanudacion">▶ Reanudar trabajo</button>
        <div class="per-fic-info">Tiempo trabajado: <strong id="per-timer-hoy">${fmtDur(c.worked, false)}</strong><br>
          Tiempo en pausa: <strong id="per-timer-pausa">${fmtDur(c.pauseSec, false)}</strong></div>`;
    }
    main.innerHTML = html;

    main.querySelectorAll('[data-ficha-tipo]').forEach((b) =>
      b.addEventListener('click', () => fichar(b.dataset.fichaTipo)));

    if (c.estado === 'trabajando' || c.estado === 'pausa') {
      fichajeTimer = setInterval(actualizarTimers, 1000);
    }
  }

  // Actualiza solo los contadores (sin re-render, para que el tick no parpadee).
  function actualizarTimers() {
    const c = calcFichaje(fichajeHoy);
    const main = document.getElementById('per-timer');
    if (!main) { clearInterval(fichajeTimer); fichajeTimer = null; return; }
    if (c.estado === 'trabajando') {
      main.textContent = '⏱ ' + fmtDur(c.worked, true);
      const hoy = document.getElementById('per-timer-hoy'); if (hoy) hoy.textContent = fmtDur(c.worked, false);
    } else if (c.estado === 'pausa') {
      main.textContent = '☕ ' + fmtDur(c.pauseSec, true);
      const tp = document.getElementById('per-timer-pausa'); if (tp) tp.textContent = fmtDur(c.pauseSec, false);
    }
  }

  const TL_ICONO = { entrada: '🟢', pausa: '⏸', reanudacion: '▶', salida: '🔴' };
  const TL_TXT = { entrada: 'Entrada', pausa: 'Pausa', reanudacion: 'Reanudación', salida: 'Salida' };
  function renderTimeline() {
    const cont = document.getElementById('per-timeline');
    if (!cont) return;
    if (!fichajeHoy.length) { cont.innerHTML = '<div class="per-tl-vacio">Sin fichajes hoy</div>'; return; }
    cont.innerHTML = '<div class="per-tl-titulo">Hoy</div>' + fichajeHoy.map((f, i) => {
      // En una pausa, muestra su duración si ya hubo reanudación.
      let extra = '';
      if (f.tipo === 'pausa') {
        const rean = fichajeHoy.slice(i + 1).find((x) => x.tipo === 'reanudacion');
        if (rean) extra = ` <span class="per-tl-dur">(${fmtDur(hms(rean.hora) - hms(f.hora), false)})</span>`;
      }
      return `
      <div class="per-tl-item">
        <span class="per-tl-hora">${esc((f.hora || '').slice(0, 5))}</span>
        <span class="per-tl-punto">${TL_ICONO[f.tipo] || '•'}</span>
        <span class="per-tl-tipo">${TL_TXT[f.tipo] || esc(f.tipo)}${extra}</span>
      </div>`;
    }).join('');
  }

  async function fichar(tipo) {
    const botones = document.querySelectorAll('#per-fichaje-main [data-ficha-tipo]');
    botones.forEach((b) => { b.disabled = true; });
    try {
      await API.post('/api/personal/fichajes', { tipo });
      await cargarFichaje();
      const main = document.getElementById('per-fichaje-main');
      if (main) { main.classList.add('per-confirm'); setTimeout(() => main.classList.remove('per-confirm'), 700); }
      toast('Fichaje registrado', 'ok');
    } catch (e) {
      toast(e.message, 'error');
      botones.forEach((b) => { b.disabled = false; });
    }
  }

  // ---- Resumen del equipo (solo admin) ----
  // Detalle de pausas: "14:00 — 14:45 (45min)" por pausa; "en curso" si sin reanudación.
  function detallePausas(pausas) {
    if (!pausas || !pausas.length) return '—';
    return pausas.map((p) => {
      if (!p.fin) return `<div class="per-pausa-linea"><span class="per-bdg per-bdg-pausa">${esc(p.inicio)} — en curso</span></div>`;
      const dur = fmtDur(hms(p.fin) - hms(p.inicio), false);
      return `<div class="per-pausa-linea">${esc(p.inicio)} — ${esc(p.fin)} <span class="per-tl-dur">(${dur})</span></div>`;
    }).join('');
  }

  function equipoEstadoBadge(f) {
    if (f.estado === 'trabajando') return '<span class="per-bdg per-bdg-trab">Trabajando</span>';
    if (f.estado === 'pausa') return '<span class="per-bdg per-bdg-pausa">Pausa</span>';
    if (f.salida) return '<span class="per-bdg per-bdg-fuera">Finalizado</span>';
    return '<span class="per-bdg per-bdg-fuera">Fuera</span>';
  }

  async function cargarEquipo() {
    const cont = document.getElementById('per-equipo');
    if (!cont) return;
    let r;
    try { r = await API.get('/api/personal/resumen-dia?fecha=' + encodeURIComponent(equipoFecha)); }
    catch (e) { cont.innerHTML = ''; return; }

    const filasFichaje = (r.fichajes || []).map((f) => `
      <tr>
        <td data-lbl="Empleado">${esc(f.empleado_nombre)}</td>
        <td data-lbl="Entrada">${esc(f.entrada) || '—'}</td>
        <td data-lbl="Pausas" class="per-eq-pausas">${detallePausas(f.pausas)}</td>
        <td data-lbl="Salida">${esc(f.salida) || '—'}</td>
        <td data-lbl="Estado">${equipoEstadoBadge(f)}</td>
        <td data-lbl="Horas">${horasTexto(f.horas)}</td>
      </tr>`).join('');
    const filasAusentes = (r.ausentes_hoy || []).map((a) => `
      <tr class="per-eq-ausente">
        <td data-lbl="Empleado">${esc(a.empleado_nombre)}</td>
        <td data-lbl="Entrada">—</td><td data-lbl="Pausas">—</td><td data-lbl="Salida">—</td>
        <td data-lbl="Estado"><span class="per-bdg per-bdg-ausente">${esc(a.tipo)}</span></td>
        <td data-lbl="Horas">—</td>
      </tr>`).join('');
    const cuerpo = (filasFichaje + filasAusentes) ||
      '<tr><td colspan="6" class="vta-vacio">Nadie ha fichado este día.</td></tr>';

    const card = (ico, valor, lbl, clase) =>
      `<div class="per-eq-mini ${clase}"><div class="per-eq-mini-ico">${ico}</div><div class="per-eq-mini-val">${valor}</div><div class="per-eq-mini-lbl">${lbl}</div></div>`;

    cont.innerHTML = `
      <div class="per-eq-sep"><span>Resumen del equipo</span></div>
      <div class="per-eq-cab">
        <label class="per-eq-fecha-lbl">Fecha
          <input type="date" id="per-eq-fecha" class="input-fecha" value="${esc(equipoFecha)}">
        </label>
        <button id="per-eq-exportar" class="btn-sec">📥 Exportar fichajes</button>
      </div>
      <div class="per-eq-minis">
        ${card('👥', r.empleados_fichados || 0, 'Fichados', 'per-eq-verde')}
        ${card('☕', r.en_pausa || 0, 'En pausa', 'per-eq-naranja')}
        ${card('🏖️', (r.ausentes_hoy || []).length, 'Ausentes', 'per-eq-rojo')}
      </div>
      <div class="tabla-scroll">
        <table class="tabla per-eq-tabla">
          <thead><tr><th>Empleado</th><th>Entrada</th><th>Pausas</th><th>Salida</th><th>Estado</th><th>Horas</th></tr></thead>
          <tbody>${cuerpo}</tbody>
        </table>
      </div>`;
    document.getElementById('per-eq-fecha').addEventListener('change', (e) => {
      equipoFecha = e.target.value || hoyStr();
      cargarEquipo();
    });
    document.getElementById('per-eq-exportar').addEventListener('click', modalExportarFichajes);
  }

  const MESES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  // Modal de exportación de fichajes a CSV (admin): empleados y meses múltiples.
  async function modalExportarFichajes() {
    let emps = [];
    try { emps = await API.get('/api/personal/empleados'); } catch (e) { /* lista vacía */ }
    const mesAhora = new Date().getMonth() + 1;

    const empItems = emps.map((e) =>
      `<label class="pex-chk">
        <input type="checkbox" class="pex-emp" value="${e.id}" checked>
        <span>${esc(nom(e))}${e.puesto ? ` <span class="pex-puesto">· ${esc(e.puesto)}</span>` : ''}</span>
      </label>`).join('') || '<div class="pex-vacio">No hay empleados.</div>';

    const mesItems = MESES_CORTO.map((m, i) =>
      `<label class="pex-chk">
        <input type="checkbox" class="pex-mes" value="${i + 1}"${(i + 1) === mesAhora ? ' checked' : ''}>
        <span>${m}</span>
      </label>`).join('');

    abrirModal(`
      <h3>📥 Exportar fichajes</h3>
      <div class="pex-sec">
        <div class="pex-titulo">Empleados</div>
        <label class="pex-chk pex-chk-all"><input type="checkbox" id="pex-emp-all" checked><span>Seleccionar todos</span></label>
        <div id="pex-emp-lista" class="pex-emp-lista">${empItems}</div>
        <div id="pex-emp-cont" class="pex-cont"></div>
      </div>
      <div class="pex-sec">
        <div class="pex-titulo">Meses</div>
        <label class="pex-chk pex-chk-all"><input type="checkbox" id="pex-mes-all"><span>Todo el año</span></label>
        <div class="pex-meses-grid">${mesItems}</div>
        <div class="pex-trimestres">
          <button type="button" class="btn-sec pex-tri" data-tri="1">1er trim.</button>
          <button type="button" class="btn-sec pex-tri" data-tri="2">2º trim.</button>
          <button type="button" class="btn-sec pex-tri" data-tri="3">3er trim.</button>
          <button type="button" class="btn-sec pex-tri" data-tri="4">4º trim.</button>
        </div>
      </div>
      <div class="pex-sec">
        <div class="pex-titulo">Año</div>
        <select id="pex-anio" class="pex-anio">${optAnios(new Date().getFullYear())}</select>
      </div>
      <div class="modal-acciones">
        <button class="btn-sec" id="pex-cancelar">Cancelar</button>
        <button class="btn-pri" id="pex-descargar">📥 Descargar CSV</button>
      </div>`);
    document.querySelector('.modal').classList.add('pex-modal');

    const empAll = document.getElementById('pex-emp-all');
    const empChks = () => Array.from(document.querySelectorAll('.pex-emp'));
    const mesAll = document.getElementById('pex-mes-all');
    const mesChks = () => Array.from(document.querySelectorAll('.pex-mes'));

    const refrescarEmp = () => {
      const chk = empChks(); const n = chk.filter((c) => c.checked).length;
      document.getElementById('pex-emp-cont').textContent = `${n} empleado${n === 1 ? '' : 's'} seleccionado${n === 1 ? '' : 's'}`;
      empAll.checked = n === chk.length && n > 0;
      empAll.indeterminate = n > 0 && n < chk.length;
    };
    const refrescarMes = () => {
      const chk = mesChks(); const n = chk.filter((c) => c.checked).length;
      mesAll.checked = n === 12;
      mesAll.indeterminate = n > 0 && n < 12;
    };

    empAll.addEventListener('change', () => { empChks().forEach((c) => { c.checked = empAll.checked; }); refrescarEmp(); });
    document.getElementById('pex-emp-lista').addEventListener('change', refrescarEmp);
    mesAll.addEventListener('change', () => { mesChks().forEach((c) => { c.checked = mesAll.checked; }); refrescarMes(); });
    document.querySelectorAll('.pex-mes').forEach((c) => c.addEventListener('change', refrescarMes));
    document.querySelectorAll('[data-tri]').forEach((b) =>
      b.addEventListener('click', () => {
        const t = Number(b.dataset.tri);
        const ini = (t - 1) * 3 + 1, fin = ini + 2;
        mesChks().forEach((c) => { const v = Number(c.value); c.checked = v >= ini && v <= fin; });
        refrescarMes();
      }));

    refrescarEmp(); refrescarMes();
    document.getElementById('pex-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('pex-descargar').addEventListener('click', descargarFichajesCSV);
  }

  async function descargarFichajesCSV() {
    const anio = val('pex-anio');
    const ids = Array.from(document.querySelectorAll('.pex-emp')).filter((c) => c.checked).map((c) => c.value);
    const meses = Array.from(document.querySelectorAll('.pex-mes')).filter((c) => c.checked).map((c) => Number(c.value)).sort((a, b) => a - b);
    if (!ids.length) return toast('Selecciona al menos un empleado', 'error');
    if (!meses.length) return toast('Selecciona al menos un mes', 'error');
    const todos = ids.length === document.querySelectorAll('.pex-emp').length;

    const btn = document.getElementById('pex-descargar');
    btn.disabled = true; btn.textContent = 'Generando…';
    try {
      let url = `/api/personal/fichajes/exportar?anio=${anio}&meses=${meses.join(',')}`;
      if (!todos) url += `&empleado_ids=${ids.join(',')}`;
      const r = await fetch(url, { headers: { 'X-Auth-Token': Auth.sesion().token } });
      if (!r.ok) {
        let msg = 'No se pudo exportar';
        try { msg = (await r.json()).error || msg; } catch (e) {}
        throw new Error(msg);
      }
      const blob = await r.blob();
      const abbr = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
      const suf = meses.length === 12 ? 'completo'
        : meses.length === 1 ? abbr[meses[0] - 1]
          : `${abbr[meses[0] - 1]}-a-${abbr[meses[meses.length - 1] - 1]}`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `fichajes-${anio}-${suf}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(a.href);
      cerrarModal();
      toast('CSV descargado', 'ok');
    } catch (e) {
      toast(e.message, 'error');
      btn.disabled = false; btn.textContent = '📥 Descargar CSV';
    }
  }

  // ============================================================
  //                    SUB-PESTAÑA AUSENCIAS
  // ============================================================
  const AUS_MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  // Días laborables (lun-vie) entre dos ISO, inclusive (cálculo local para el modal).
  function diasLaborablesLocal(ini, fin) {
    if (!ini || !fin) return 0;
    let a = Date.parse(ini + 'T00:00:00'), b = Date.parse(fin + 'T00:00:00');
    if (isNaN(a) || isNaN(b) || b < a) return 0;
    let n = 0;
    for (let d = a; d <= b; d += 86400000) { const dow = new Date(d).getDay(); if (dow !== 0 && dow !== 6) n++; }
    return n;
  }
  function ddmm(iso) { const p = String(iso).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}` : iso; }
  function miEmpleadoId() {
    const uid = (Auth.sesion() || {}).userId;
    const e = ausEmpleados.find((x) => x.usuario_id == uid);
    return e ? e.id : null;
  }

  function construirAusencias() {
    if (ausConstruido) return;
    const panel = document.querySelector('#vista-personal .sub-panel[data-panel-sub="ausencias"]');
    if (!panel) return;
    const optAnio = [2024, 2025, 2026].map((a) => `<option value="${a}"${a === ausAnio ? ' selected' : ''}>${a}</option>`).join('');
    const optMes = AUS_MESES.map((m, i) => `<option value="${i + 1}"${(i + 1) === ausMes ? ' selected' : ''}>${m}</option>`).join('');
    const leyenda = AUS_TIPOS.map((t) =>
      `<span class="aus-ley-item"><span class="aus-ley-color" style="background:${t.c}"></span>${t.l}</span>`).join('');
    panel.innerHTML = `
      <div class="barra-herramientas aus-cab">
        <div class="reservas-controles">
          <select id="aus-anio" class="select-filtro">${optAnio}</select>
          <select id="aus-mes" class="select-filtro">${optMes}</select>
        </div>
        <div class="vta-prop-acciones"><button id="aus-nueva" class="btn-pri">＋ Nueva ausencia</button></div>
      </div>
      <div class="aus-leyenda">${leyenda}</div>
      <div id="aus-cal" class="aus-cal-wrap"></div>
      <div class="aus-sec-titulo">Saldo de vacaciones ${ausAnio}</div>
      <div id="aus-saldo" class="tabla-scroll"></div>
      <div class="aus-sec-titulo aus-sec-lista">
        <span>Ausencias ${ausAnio}</span>
        <select id="aus-filtro-emp" class="select-filtro"></select>
      </div>
      <div id="aus-lista" class="tabla-scroll"></div>`;

    panel.querySelector('#aus-anio').addEventListener('change', (e) => { ausAnio = Number(e.target.value); cargarAusencias(); });
    panel.querySelector('#aus-mes').addEventListener('change', (e) => { ausMes = Number(e.target.value); renderCalendario(); });
    panel.querySelector('#aus-nueva').addEventListener('click', () => modalAusencia(null));
    panel.querySelector('#aus-filtro-emp').addEventListener('change', (e) => { ausFiltroEmp = e.target.value; renderLista(); });
    ausConstruido = true;
  }

  async function cargarAusencias() {
    try {
      const [emps, cal, lista] = await Promise.all([
        API.get('/api/personal/empleados'),
        API.get(`/api/personal/ausencias/calendario?anio=${ausAnio}&mes=${ausMes}`),
        API.get(`/api/personal/ausencias?anio=${ausAnio}`),
      ]);
      ausEmpleados = emps;
      ausCalendario = cal;
      ausLista = lista;
      const saldos = await Promise.all(emps.map((e) =>
        API.get(`/api/personal/ausencias/saldo?empleado_id=${e.id}&anio=${ausAnio}`).catch(() => null)));
      ausSaldos = {};
      emps.forEach((e, i) => { if (saldos[i]) ausSaldos[e.id] = saldos[i]; });
    } catch (e) { return toast(e.message, 'error'); }
    pintarFiltroEmp();
    renderCalendario();
    renderSaldo();
    renderLista();
  }

  function pintarFiltroEmp() {
    const sel = document.getElementById('aus-filtro-emp');
    if (!sel) return;
    sel.innerHTML = '<option value="">Todos los empleados</option>' +
      ausEmpleados.map((e) => `<option value="${e.id}"${String(ausFiltroEmp) === String(e.id) ? ' selected' : ''}>${esc(nom(e))}</option>`).join('');
  }

  // ---- Calendario mensual (empleados × días) ----
  function renderCalendario() {
    const cont = document.getElementById('aus-cal');
    if (!cont) return;
    // Refresca el calendario del mes seleccionado si cambió el mes sin recargar todo.
    const mesStr = `${ausAnio}-${String(ausMes).padStart(2, '0')}`;
    const diasMes = new Date(ausAnio, ausMes, 0).getDate();
    const hoy = new Date();
    const esMesActual = (hoy.getFullYear() === ausAnio && (hoy.getMonth() + 1) === ausMes);

    // Mapa empleado-día -> tipo (del endpoint calendario, filtrado al mes mostrado).
    const cell = {};
    ausCalendario.forEach((a) => {
      if (String(a.fecha).slice(0, 7) !== mesStr) return;
      cell[`${a.empleado_id}-${parseInt(String(a.fecha).slice(8, 10), 10)}`] = a.tipo;
    });

    if (!ausEmpleados.length) { cont.innerHTML = '<div class="vta-vacio">No hay empleados.</div>'; return; }

    let head = '<th class="aus-cal-emp">Empleado</th>';
    for (let d = 1; d <= diasMes; d++) {
      const dow = new Date(ausAnio, ausMes - 1, d).getDay();
      const finde = dow === 0 || dow === 6;
      const today = esMesActual && d === hoy.getDate();
      head += `<th class="aus-cal-dia${finde ? ' aus-finde' : ''}${today ? ' aus-today' : ''}">${d}</th>`;
    }

    const filas = ausEmpleados.map((e) => {
      const s = ausSaldos[e.id];
      const saldoTxt = s ? `${s.usados}/${s.total}` : '';
      let row = `<td class="aus-cal-emp"><span class="aus-cal-nom">${esc(nom(e))}</span><span class="aus-cal-saldo">${saldoTxt}</span></td>`;
      for (let d = 1; d <= diasMes; d++) {
        const dow = new Date(ausAnio, ausMes - 1, d).getDay();
        const finde = dow === 0 || dow === 6;
        const today = esMesActual && d === hoy.getDate();
        const tipo = cell[`${e.id}-${d}`];
        const iso = `${mesStr}-${String(d).padStart(2, '0')}`;
        let style = '', title = '';
        if (tipo) {
          style = ` style="background:${ausTipo(tipo).c}"`;
          title = ` title="${esc(tooltipAus(e.id, iso, tipo))}"`;
        }
        row += `<td class="aus-cal-cell${finde ? ' aus-finde' : ''}${today ? ' aus-today' : ''}${tipo ? ' aus-cell-on' : ''}"${style}${title}></td>`;
      }
      return `<tr>${row}</tr>`;
    }).join('');

    cont.innerHTML = `<table class="aus-cal-tabla"><thead><tr>${head}</tr></thead><tbody>${filas}</tbody></table>`;
  }

  // Texto del tooltip de una celda pintada, buscando la ausencia que la cubre.
  function tooltipAus(empId, iso, tipo) {
    const a = ausLista.find((x) => x.empleado_id == empId && x.estado !== 'rechazada' && x.fecha_inicio <= iso && x.fecha_fin >= iso);
    if (!a) return ausTipo(tipo).l;
    return `${ausTipo(a.tipo).l} — ${ddmm(a.fecha_inicio)} a ${ddmm(a.fecha_fin)} (${a.dias} días laborables)`;
  }

  // ---- Tabla de saldo por empleado ----
  function renderSaldo() {
    const cont = document.getElementById('aus-saldo');
    if (!cont) return;
    if (!ausEmpleados.length) { cont.innerHTML = ''; return; }
    const tot = { total: 0, vacaciones: 0, dia_libre: 0, dia_gracia: 0, baja_medica: 0, asuntos_propios: 0, usados: 0, pendientes: 0 };
    const filas = ausEmpleados.map((e) => {
      const s = ausSaldos[e.id] || { total: 0, usados: 0, pendientes: 0, desglose: {} };
      const dg = s.desglose || {};
      tot.total += s.total; tot.usados += s.usados; tot.pendientes += s.pendientes;
      ['vacaciones', 'dia_libre', 'dia_gracia', 'baja_medica', 'asuntos_propios'].forEach((k) => { tot[k] += dg[k] || 0; });
      const pct = s.total ? Math.min(100, Math.round((s.usados / s.total) * 100)) : 0;
      return `
        <tr>
          <td data-lbl="Empleado">${esc(nom(e))}</td>
          <td class="aus-desglose" data-lbl="Total">${s.total}</td>
          <td class="aus-desglose" data-lbl="Vacaciones">${dg.vacaciones || 0}</td>
          <td class="aus-desglose" data-lbl="Días libres">${dg.dia_libre || 0}</td>
          <td class="aus-desglose" data-lbl="Días gracia">${dg.dia_gracia || 0}</td>
          <td class="aus-desglose" data-lbl="Baja">${dg.baja_medica || 0}</td>
          <td class="aus-desglose" data-lbl="Asuntos">${dg.asuntos_propios || 0}</td>
          <td data-lbl="Usados"><div class="aus-bar"><div class="aus-bar-fill" style="width:${pct}%"></div></div><span class="aus-bar-txt">${s.usados}/${s.total}</span></td>
          <td data-lbl="Pendientes">${s.pendientes}</td>
        </tr>`;
    }).join('');
    cont.innerHTML = `
      <table class="tabla aus-saldo-tabla">
        <thead><tr>
          <th>Empleado</th><th class="aus-desglose">Total</th><th class="aus-desglose">Vacaciones</th>
          <th class="aus-desglose">Días libres</th><th class="aus-desglose">Días gracia</th>
          <th class="aus-desglose">Baja</th><th class="aus-desglose">Asuntos</th><th>Usados</th><th>Pendientes</th>
        </tr></thead>
        <tbody>${filas}</tbody>
        <tfoot><tr class="aus-tot">
          <td data-lbl="Total equipo">TOTAL</td>
          <td class="aus-desglose">${tot.total}</td><td class="aus-desglose">${tot.vacaciones}</td>
          <td class="aus-desglose">${tot.dia_libre}</td><td class="aus-desglose">${tot.dia_gracia}</td>
          <td class="aus-desglose">${tot.baja_medica}</td><td class="aus-desglose">${tot.asuntos_propios}</td>
          <td data-lbl="Usados">${tot.usados}</td><td data-lbl="Pendientes">${tot.pendientes}</td>
        </tr></tfoot>
      </table>`;
  }

  // ---- Lista de ausencias ----
  function ausEstadoBadge(e) {
    if (e === 'aprobada') return '<span class="per-bdg per-bdg-trab">Aprobada</span>';
    if (e === 'rechazada') return '<span class="per-bdg per-bdg-inactivo">Rechazada</span>';
    return '<span class="per-bdg per-bdg-pausa">Pendiente</span>';
  }
  function ausTipoBadge(t) {
    return `<span class="per-bdg aus-bdg-tipo" style="background:${ausTipo(t).c}">${ausTipo(t).l}</span>`;
  }

  function renderLista() {
    const cont = document.getElementById('aus-lista');
    if (!cont) return;
    const admin = esAdmin();
    let lista = ausLista.slice();
    if (ausFiltroEmp) lista = lista.filter((a) => String(a.empleado_id) === String(ausFiltroEmp));

    if (!lista.length) {
      cont.innerHTML = '<div class="vta-vacio">No hay ausencias registradas para este año.</div>';
      return;
    }
    const filas = lista.map((a) => {
      let acc = '';
      if (admin) {
        acc += `<button class="btn-icono" data-edit="${a.id}" title="Editar">✏️</button>`;
        if (a.estado === 'pendiente') {
          acc += `<button class="btn-icono" data-aprobar="${a.id}" title="Aprobar">✓</button>`;
          acc += `<button class="btn-icono" data-rechazar="${a.id}" title="Rechazar">✗</button>`;
        }
        acc += `<button class="btn-icono" data-borrar="${a.id}" title="Eliminar">🗑</button>`;
      }
      return `
        <tr>
          <td data-lbl="Empleado">${esc([a.empleado_nombre, a.empleado_apellidos].filter(Boolean).join(' '))}</td>
          <td data-lbl="Tipo">${ausTipoBadge(a.tipo)}</td>
          <td data-lbl="Desde">${fechaES(a.fecha_inicio)}</td>
          <td data-lbl="Hasta">${fechaES(a.fecha_fin)}</td>
          <td data-lbl="Días">${a.dias}</td>
          <td data-lbl="Estado">${ausEstadoBadge(a.estado)}</td>
          <td data-lbl="Notas">${esc(a.notas) || '—'}</td>
          <td class="vta-acciones" data-lbl="Acciones">${acc || '—'}</td>
        </tr>`;
    }).join('');
    cont.innerHTML = `
      <table class="tabla aus-lista-tabla">
        <thead><tr>
          <th>Empleado</th><th>Tipo</th><th>Desde</th><th>Hasta</th><th>Días</th><th>Estado</th><th>Notas</th><th></th>
        </tr></thead>
        <tbody>${filas}</tbody>
      </table>`;

    cont.querySelectorAll('[data-edit]').forEach((b) =>
      b.addEventListener('click', () => modalAusencia(ausLista.find((a) => a.id == b.dataset.edit))));
    cont.querySelectorAll('[data-aprobar]').forEach((b) =>
      b.addEventListener('click', () => cambiarEstadoAus(b.dataset.aprobar, 'aprobada')));
    cont.querySelectorAll('[data-rechazar]').forEach((b) =>
      b.addEventListener('click', () => cambiarEstadoAus(b.dataset.rechazar, 'rechazada')));
    cont.querySelectorAll('[data-borrar]').forEach((b) =>
      b.addEventListener('click', () => borrarAusencia(b.dataset.borrar)));
  }

  async function cambiarEstadoAus(id, estado) {
    try {
      await API.put('/api/personal/ausencias/' + id, { estado });
      await cargarAusencias();
      toast(estado === 'aprobada' ? 'Ausencia aprobada' : 'Ausencia rechazada', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function borrarAusencia(id) {
    if (!confirm('¿Eliminar esta ausencia?')) return;
    try {
      await API.del('/api/personal/ausencias/' + id);
      await cargarAusencias();
      toast('Ausencia eliminada', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  }

  // ---- Modal nueva / editar ----
  function modalAusencia(a) {
    const esNuevo = !a;
    a = a || {};
    const admin = esAdmin();
    let optEmp;
    if (admin) {
      optEmp = '<option value="">— Empleado —</option>' +
        ausEmpleados.map((e) => `<option value="${e.id}"${a.empleado_id == e.id ? ' selected' : ''}>${esc(nom(e))}</option>`).join('');
    } else {
      const mi = miEmpleadoId();
      const yo = ausEmpleados.find((e) => e.id === mi);
      if (!yo) return toast('No tienes una ficha de empleado vinculada', 'error');
      optEmp = `<option value="${yo.id}" selected>${esc(nom(yo))}</option>`;
    }
    const optTipo = AUS_TIPOS.map((t) => `<option value="${t.v}"${a.tipo === t.v ? ' selected' : ''}>${t.l}</option>`).join('');

    abrirModal(`
      <h3>${esNuevo ? '＋ Nueva ausencia' : '✏️ Editar ausencia'}</h3>
      <div class="campo"><label>Empleado</label><select id="af-empleado"${admin ? '' : ' disabled'}>${optEmp}</select></div>
      <div class="campo"><label>Tipo</label><select id="af-tipo">${optTipo}</select></div>
      <div class="fila-campos">
        <div class="campo"><label>Fecha inicio</label><input type="date" id="af-ini" value="${esc(a.fecha_inicio)}"></div>
        <div class="campo"><label>Fecha fin</label><input type="date" id="af-fin" value="${esc(a.fecha_fin)}"></div>
      </div>
      <div class="aus-dias-info" id="af-dias">—</div>
      <div class="campo"><label>Notas</label><textarea id="af-notas" rows="2">${esc(a.notas)}</textarea></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="af-cancelar">Cancelar</button>
        <button class="btn-pri" id="af-guardar">${esNuevo ? 'Crear' : 'Guardar'}</button>
      </div>`);
    document.querySelector('.modal').classList.add('modal-ancho');

    const refrescarDias = () => {
      const n = diasLaborablesLocal(val('af-ini'), val('af-fin'));
      document.getElementById('af-dias').textContent = `${n} días laborables (excluye fines de semana)`;
    };
    document.getElementById('af-ini').addEventListener('change', refrescarDias);
    document.getElementById('af-fin').addEventListener('change', refrescarDias);
    refrescarDias();

    document.getElementById('af-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('af-guardar').addEventListener('click', () => guardarAusencia(esNuevo ? null : a.id));
  }

  async function guardarAusencia(id) {
    const empId = val('af-empleado');
    const ini = val('af-ini');
    const fin = val('af-fin');
    if (esAdmin() && !empId) return toast('Selecciona un empleado', 'error');
    if (!ini || !fin) return toast('Indica las fechas de inicio y fin', 'error');
    if (fin < ini) return toast('La fecha de fin no puede ser anterior a la de inicio', 'error');
    const body = { empleado_id: empId, tipo: val('af-tipo'), fecha_inicio: ini, fecha_fin: fin, notas: val('af-notas') };
    const btn = document.getElementById('af-guardar');
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      if (id) await API.put('/api/personal/ausencias/' + id, body);
      else await API.post('/api/personal/ausencias', body);
      cerrarModal();
      await cargarAusencias();
      toast(id ? 'Ausencia actualizada' : 'Ausencia creada', 'ok');
    } catch (e) {
      toast(e.message, 'error');
      btn.disabled = false; btn.textContent = id ? 'Guardar' : 'Crear';
    }
  }

  // ============================================================
  //                    SUB-PESTAÑA HORAS EXTRA
  // ============================================================
  function hxEstadoBadge(pagada) {
    return pagada
      ? '<span class="per-bdg per-bdg-trab">Pagada</span>'
      : '<span class="per-bdg per-bdg-pausa">Pendiente</span>';
  }
  function optAnios(sel) {
    return [2024, 2025, 2026].map((a) => `<option value="${a}"${a === sel ? ' selected' : ''}>${a}</option>`).join('');
  }

  function construirHoras() {
    if (hxConstruido) return;
    const panel = document.querySelector('#vista-personal .sub-panel[data-panel-sub="horas"]');
    if (!panel) return;
    const admin = esAdmin();
    panel.innerHTML = `
      <div class="barra-herramientas aus-cab">
        <h3 class="hx-titulo">Mis horas extra</h3>
        <div class="reservas-controles">
          <select id="hx-anio" class="select-filtro">${optAnios(hxAnio)}</select>
        </div>
        <div class="vta-prop-acciones"><button id="hx-nueva" class="btn-pri">＋ Registrar horas extra</button></div>
      </div>
      <div class="per-eq-minis hx-minis" id="hx-minis"></div>
      <div id="hx-lista" class="tabla-scroll"></div>
      ${admin ? `
        <div class="aus-sec-titulo" style="margin-top:30px">Gestión de horas extra del equipo</div>
        <div class="barra-herramientas aus-cab">
          <div class="reservas-controles">
            <select id="hx-adm-emp" class="select-filtro"></select>
            <select id="hx-adm-anio" class="select-filtro">${optAnios(hxAdminAnio)}</select>
          </div>
          <div class="vta-prop-acciones"><button id="hx-adm-nueva" class="btn-pri">＋ Añadir horas extra</button></div>
        </div>
        <div id="hx-adm-res" class="hx-adm-res"></div>
        <div id="hx-adm-lista" class="tabla-scroll"></div>` : ''}`;

    panel.querySelector('#hx-anio').addEventListener('change', (e) => { hxAnio = Number(e.target.value); cargarMisHoras(); });
    panel.querySelector('#hx-nueva').addEventListener('click', () => modalHoras(null));
    if (admin) {
      panel.querySelector('#hx-adm-emp').addEventListener('change', (e) => { hxAdminEmp = e.target.value; cargarAdminHoras(); });
      panel.querySelector('#hx-adm-anio').addEventListener('change', (e) => { hxAdminAnio = Number(e.target.value); cargarAdminHoras(); });
      panel.querySelector('#hx-adm-nueva').addEventListener('click', () => modalHoras(null, { admin: true, empleadoId: hxAdminEmp }));
    }
    hxConstruido = true;
  }

  async function resolverMiEmpleado() {
    if (hxOwnId !== undefined) return;
    try { const st = await API.get('/api/personal/fichajes/estado'); hxOwnId = st.empleado ? st.empleado.id : null; }
    catch (e) { hxOwnId = null; }
  }

  async function cargarHoras() {
    await resolverMiEmpleado();
    cargarMisHoras();
    if (esAdmin()) {
      try { hxEmpleados = await API.get('/api/personal/empleados?todos=1'); } catch (e) { hxEmpleados = []; }
      const sel = document.getElementById('hx-adm-emp');
      if (sel) {
        sel.innerHTML = '<option value="">— Selecciona empleado —</option>' +
          hxEmpleados.map((e) => `<option value="${e.id}"${String(hxAdminEmp) === String(e.id) ? ' selected' : ''}>${esc(nom(e))}</option>`).join('');
      }
      cargarAdminHoras();
    }
  }

  // ---- Vista propia ----
  async function cargarMisHoras() {
    const tbody = document.getElementById('hx-lista');
    const minis = document.getElementById('hx-minis');
    if (hxOwnId === null) {
      if (minis) minis.innerHTML = '';
      if (tbody) tbody.innerHTML = '<div class="per-sin-ficha">⚠️ No tienes una ficha de empleado vinculada.<div class="per-sin-ficha-sub">Pide a un administrador que te vincule.</div></div>';
      return;
    }
    if (tbody) tbody.innerHTML = '<div class="vta-cargando">Cargando…</div>';
    try {
      const [lista, res] = await Promise.all([
        API.get(`/api/personal/horas-extra?empleado_id=${hxOwnId}&anio=${hxAnio}`),
        API.get(`/api/personal/horas-extra/resumen?empleado_id=${hxOwnId}&anio=${hxAnio}`),
      ]);
      hxLista = lista;
      renderMinis(minis, res);
      renderTablaHoras(tbody, lista, false);
    } catch (e) { if (tbody) tbody.innerHTML = ''; toast(e.message, 'error'); }
  }

  function renderMinis(cont, res) {
    if (!cont) return;
    const card = (ico, valor, lbl, clase) =>
      `<div class="per-eq-mini ${clase}"><div class="per-eq-mini-ico">${ico}</div><div class="per-eq-mini-val">${valor}</div><div class="per-eq-mini-lbl">${lbl}</div></div>`;
    cont.innerHTML =
      card('⏱', `${res.horas_pendientes || 0} h`, 'Horas pendientes', 'per-eq-naranja') +
      card('✅', `${res.horas_pagadas || 0} h`, 'Horas pagadas', 'per-eq-verde') +
      card('💰', euro(res.total_pagado), 'Total cobrado', 'hx-mini-azul');
  }

  // Tabla de horas extra. admin=true añade columna "Pagada en" + acciones admin.
  function renderTablaHoras(cont, lista, admin) {
    if (!cont) return;
    if (!lista.length) {
      cont.innerHTML = '<div class="vta-vacio">No hay horas extra registradas en este periodo.</div>';
      return;
    }
    let totHoras = 0, totPagado = 0;
    const filas = lista.map((h) => {
      totHoras += Number(h.horas) || 0;
      if (h.pagada) totPagado += Number(h.importe) || 0;
      let acc = '';
      if (admin) {
        if (!h.pagada) acc += `<button class="btn-icono" data-pago="${h.id}" title="Registrar pago">💰</button>`;
        else acc += `<button class="btn-icono" data-desmarcar="${h.id}" title="Desmarcar pago">↩️</button>`;
        acc += `<button class="btn-icono" data-borrar="${h.id}" title="Eliminar">🗑</button>`;
      } else if (!h.pagada) {
        acc += `<button class="btn-icono" data-edit="${h.id}" title="Editar">✏️</button>`;
        acc += `<button class="btn-icono" data-borrar="${h.id}" title="Eliminar">🗑</button>`;
      }
      const pagadaEn = admin ? `<td data-lbl="Pagada en">${h.fecha_pago ? fechaES(h.fecha_pago) : '—'}</td>` : '';
      // "Otro concepto" (horas=0): sin horas, el importe se muestra directamente.
      const esOtro = Number(h.horas) === 0;
      const horasCel = esOtro ? '—' : `${h.horas} h`;
      const importeCel = esOtro
        ? euro(h.importe)
        : (h.pagada ? euro(h.importe) : '—');
      return `
        <tr>
          <td data-lbl="Fecha">${fechaES(h.fecha)}</td>
          <td data-lbl="Horas">${horasCel}</td>
          <td data-lbl="Descripción">${esc(h.descripcion) || '—'}</td>
          <td data-lbl="Estado">${hxEstadoBadge(h.pagada)}</td>
          <td data-lbl="Importe">${importeCel}</td>
          ${pagadaEn}
          <td class="vta-acciones" data-lbl="Acciones">${acc || '—'}</td>
        </tr>`;
    }).join('');
    const colPagada = admin ? '<th>Pagada en</th>' : '';
    const colspanTot = admin ? 4 : 3;
    cont.innerHTML = `
      <table class="tabla hx-tabla">
        <thead><tr>
          <th>Fecha</th><th>Horas</th><th>Descripción</th><th>Estado</th><th>Importe</th>${colPagada}<th></th>
        </tr></thead>
        <tbody>${filas}</tbody>
        <tfoot><tr class="aus-tot">
          <td data-lbl="Total">TOTAL</td>
          <td data-lbl="Horas">${Math.round(totHoras * 100) / 100} h</td>
          <td colspan="${colspanTot}"></td>
          <td data-lbl="Pagado">${euro(totPagado)}</td>
        </tr></tfoot>
      </table>`;

    // Wiring (propias).
    cont.querySelectorAll('[data-edit]').forEach((b) =>
      b.addEventListener('click', () => modalHoras(buscarHora(b.dataset.edit))));
    cont.querySelectorAll('[data-pago]').forEach((b) =>
      b.addEventListener('click', () => modalPago(buscarHora(b.dataset.pago))));
    cont.querySelectorAll('[data-desmarcar]').forEach((b) =>
      b.addEventListener('click', () => desmarcarPago(b.dataset.desmarcar)));
    cont.querySelectorAll('[data-borrar]').forEach((b) =>
      b.addEventListener('click', () => borrarHoras(b.dataset.borrar)));
  }

  function buscarHora(id) {
    return hxLista.find((h) => h.id == id) || hxAdminLista.find((h) => h.id == id);
  }

  // ---- Vista admin (gestión del equipo) ----
  async function cargarAdminHoras() {
    const tbody = document.getElementById('hx-adm-lista');
    const res = document.getElementById('hx-adm-res');
    if (!tbody) return;
    if (!hxAdminEmp) {
      tbody.innerHTML = '<div class="vta-vacio">Selecciona un empleado para ver sus horas extra.</div>';
      if (res) res.innerHTML = '';
      return;
    }
    tbody.innerHTML = '<div class="vta-cargando">Cargando…</div>';
    try {
      const [lista, resumen] = await Promise.all([
        API.get(`/api/personal/horas-extra?empleado_id=${hxAdminEmp}&anio=${hxAdminAnio}`),
        API.get(`/api/personal/horas-extra/resumen?empleado_id=${hxAdminEmp}&anio=${hxAdminAnio}`),
      ]);
      hxAdminLista = lista;
      if (res) res.innerHTML =
        `Total: <strong>${resumen.total_horas || 0} h</strong> · Pendientes: <strong>${resumen.horas_pendientes || 0} h</strong> · ` +
        `Pagadas: <strong>${resumen.horas_pagadas || 0} h</strong> · Total cobrado: <strong>${euro(resumen.total_pagado)}</strong>`;
      renderTablaHoras(tbody, lista, true);
    } catch (e) { tbody.innerHTML = ''; toast(e.message, 'error'); }
  }

  // Recarga la(s) vista(s) que correspondan tras un cambio.
  async function recargarHoras() {
    await cargarMisHoras();
    if (esAdmin() && hxAdminEmp) await cargarAdminHoras();
  }

  // ---- Modos de entrada de horas (compartido entre modales) ----
  // Modo "directo": Horas + Precio/h. Modo "horario": Hora inicio/fin (→ horas) + Precio/h.
  // `opts.importe` añade un campo Importe (€) editable que se autorrellena con horas×precio.

  // 'HH:MM' inicio/fin → horas decimales (2 dec). null si rango inválido.
  function horasRango(ini, fin) {
    const seg = (t) => { const p = String(t).split(':').map(Number); return (p[0] || 0) * 3600 + (p[1] || 0) * 60; };
    if (!ini || !fin) return null;
    const a = seg(ini), b = seg(fin);
    if (isNaN(a) || isNaN(b) || b <= a) return null;
    return Math.round(((b - a) / 3600) * 100) / 100;
  }
  function fmtHoras(h) {
    const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    return mm ? `${hh}h ${mm}min` : `${hh}h`;
  }

  // HTML del bloque de modos. `prefix` evita colisiones de id entre modales.
  function modoHorasHTML(prefix, h, opts) {
    opts = opts || {};
    const importeCampo = opts.importe
      ? `<div class="campo"><label>Importe (€) *</label><input type="number" step="0.01" min="0" id="${prefix}-importe" value="${h.importe ?? ''}"></div>`
      : '';
    const radioOtro = opts.otro
      ? `<label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="radio" name="${prefix}-modo" value="otro"> Otro concepto</label>`
      : '';
    const bloqueOtro = opts.otro
      ? `<div data-modo="otro" style="display:none">
           <div class="campo"><label>Importe (€) *</label><input type="number" step="0.01" min="0" id="${prefix}-otro-importe"></div>
           <div style="font-size:12px;color:var(--muted);margin:2px 0 8px">Sin cálculo de horas. La descripción es obligatoria.</div>
         </div>`
      : '';
    return `
      <div class="hx-modos" style="display:flex;gap:16px;margin:6px 0 10px;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="radio" name="${prefix}-modo" value="directo" checked> Horas directas</label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="radio" name="${prefix}-modo" value="horario"> Por horario</label>
        ${radioOtro}
      </div>
      <div data-modo="directo">
        <div class="fila-campos">
          <div class="campo"><label>Horas</label><input type="number" step="0.5" min="0" id="${prefix}-horas" value="${h.horas ?? ''}"></div>
          <div class="campo"><label>Precio por hora (€)</label><input type="number" step="0.01" min="0" id="${prefix}-precio" placeholder="Ej: 12"></div>
        </div>
      </div>
      <div data-modo="horario" style="display:none">
        <div class="fila-campos">
          <div class="campo"><label>Hora inicio</label><input type="time" id="${prefix}-hini" value="${esc(h.hora_inicio) || ''}"></div>
          <div class="campo"><label>Hora fin</label><input type="time" id="${prefix}-hfin" value="${esc(h.hora_fin) || ''}"></div>
          <div class="campo"><label>Precio por hora (€)</label><input type="number" step="0.01" min="0" id="${prefix}-precio2" placeholder="Ej: 12"></div>
        </div>
      </div>
      ${bloqueOtro}
      <div class="hx-calc" id="${prefix}-calc" style="margin:2px 0 8px;color:var(--blue);font-weight:600;min-height:18px"></div>
      ${importeCampo}`;
  }

  // Conecta los listeners de recálculo en vivo. `opts.importe` autorrellena el campo importe.
  function wireModoHoras(prefix, opts) {
    opts = opts || {};
    const calc = document.getElementById(prefix + '-calc');
    const sync = () => {
      const modo = (document.querySelector(`input[name="${prefix}-modo"]:checked`) || {}).value || 'directo';
      // Mostrar/ocultar el bloque del modo activo (solo dentro de este modal).
      const root = calc ? calc.closest('.modal') : document;
      root.querySelectorAll('[data-modo]').forEach((d) => { d.style.display = d.dataset.modo === modo ? '' : 'none'; });

      let horas = null, precio = null;
      if (modo === 'horario') {
        horas = horasRango(val(prefix + '-hini'), val(prefix + '-hfin'));
        precio = parseFloat(val(prefix + '-precio2'));
      } else {
        const n = parseFloat(val(prefix + '-horas'));
        horas = isNaN(n) ? null : n;
        precio = parseFloat(val(prefix + '-precio'));
      }
      if (isNaN(precio)) precio = null;

      let txt = '';
      if (horas !== null) {
        txt = fmtHoras(horas);
        if (precio !== null) {
          const total = Math.round(horas * precio * 100) / 100;
          txt += ` · ${horas}h × ${precio}€ = ${euro(total)}`;
          if (opts.importe) { const inp = document.getElementById(prefix + '-importe'); if (inp) inp.value = total; }
        }
      } else if (modo === 'horario') {
        txt = 'Indica hora inicio y fin';
      }
      if (calc) calc.textContent = txt;
    };
    const root = calc ? calc.closest('.modal') : document;
    root.querySelectorAll(`input[name="${prefix}-modo"]`).forEach((r) => r.addEventListener('change', sync));
    [`${prefix}-horas`, `${prefix}-precio`, `${prefix}-hini`, `${prefix}-hfin`, `${prefix}-precio2`].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', sync);
    });
    sync();
  }

  // Lee el modo activo. Devuelve { horas, hora_inicio?, hora_fin?, precio_hora?, error }.
  function leerModoHoras(prefix) {
    const modo = (document.querySelector(`input[name="${prefix}-modo"]:checked`) || {}).value || 'directo';
    if (modo === 'otro') {
      const importe = parseFloat(val(prefix + '-otro-importe'));
      if (isNaN(importe) || importe <= 0) return { error: 'Indica un importe mayor que 0' };
      return { horas: 0, importe, otro: true };
    }
    if (modo === 'horario') {
      const ini = val(prefix + '-hini'), fin = val(prefix + '-hfin');
      if (!ini || !fin) return { error: 'Indica la hora de inicio y de fin' };
      const horas = horasRango(ini, fin);
      if (horas === null) return { error: 'El rango horario no es válido (la hora fin debe ser posterior)' };
      const precio = parseFloat(val(prefix + '-precio2'));
      return { horas, hora_inicio: ini, hora_fin: fin, precio_hora: isNaN(precio) ? null : precio };
    }
    const horas = parseFloat(val(prefix + '-horas'));
    if (isNaN(horas) || horas <= 0) return { error: 'Indica un número de horas mayor que 0' };
    const precio = parseFloat(val(prefix + '-precio'));
    return { horas, precio_hora: isNaN(precio) ? null : precio };
  }

  // ---- Modales ----
  // opts.admin = true → muestra selector de empleado (admin registra para otro empleado).
  function modalHoras(h, opts) {
    opts = opts || {};
    const esNuevo = !h;
    h = h || {};
    const empSel = opts.admin
      ? `<div class="campo"><label>Empleado *</label>
           <select id="hxf-emp" class="select-filtro" style="width:100%">${hxEmpleados.map((e) => `<option value="${e.id}"${String(opts.empleadoId) === String(e.id) ? ' selected' : ''}>${esc(nom(e))}</option>`).join('')}</select>
         </div>`
      : '';
    abrirModal(`
      <h3>${esNuevo ? '＋ Registrar horas extra' : '✏️ Editar horas extra'}</h3>
      ${empSel}
      <div class="campo"><label>Fecha</label><input type="date" id="hxf-fecha" value="${esc(h.fecha) || hoyStr()}"></div>
      ${modoHorasHTML('hxf', h, { otro: opts.admin })}
      <div class="campo"><label>Descripción</label><textarea id="hxf-desc" rows="2" placeholder="Ej: Limpieza extra apartamento Costa Marina">${esc(h.descripcion)}</textarea></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="hxf-cancelar">Cancelar</button>
        <button class="btn-pri" id="hxf-guardar">${esNuevo ? 'Registrar' : 'Guardar'}</button>
      </div>`);
    document.querySelector('.modal').classList.add('modal-ancho');
    wireModoHoras('hxf');
    document.getElementById('hxf-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('hxf-guardar').addEventListener('click', () => guardarHoras(esNuevo ? null : h.id, opts.admin));
  }

  async function guardarHoras(id, admin) {
    const fecha = val('hxf-fecha');
    if (!fecha) return toast('La fecha es obligatoria', 'error');
    const m = leerModoHoras('hxf');
    if (m.error) return toast(m.error, 'error');
    if (m.otro && !val('hxf-desc').trim()) return toast('La descripción es obligatoria', 'error');
    const body = { fecha, horas: m.horas, descripcion: val('hxf-desc') };
    if (m.hora_inicio) { body.hora_inicio = m.hora_inicio; body.hora_fin = m.hora_fin; }
    if (m.precio_hora != null) body.precio_hora = m.precio_hora;
    if (m.importe != null) body.importe = m.importe;  // modo "Otro concepto"
    if (admin) {
      const emp = val('hxf-emp');
      if (!emp) return toast('Selecciona un empleado', 'error');
      body.empleado_id = emp;
    }
    const btn = document.getElementById('hxf-guardar');
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      if (id) await API.put('/api/personal/horas-extra/' + id, body);
      else await API.post('/api/personal/horas-extra', body);
      cerrarModal();
      await recargarHoras();
      toast(id ? 'Horas extra actualizadas' : 'Horas extra registradas', 'ok');
    } catch (e) {
      toast(e.message, 'error');
      btn.disabled = false; btn.textContent = id ? 'Guardar' : 'Registrar';
    }
  }

  function modalPago(h) {
    if (!h) return;
    abrirModal(`
      <h3>💰 Registrar pago</h3>
      <div class="vta-pv-resumen"><div>${fechaES(h.fecha)} · <strong>${h.horas} h</strong>${h.descripcion ? ' · ' + esc(h.descripcion) : ''}</div></div>
      <div class="fila-campos">
        <div class="campo"><label>Importe (€) *</label><input type="number" step="0.01" min="0" id="hxp-importe" value="${h.importe ?? ''}"></div>
        <div class="campo"><label>Fecha de pago</label><input type="date" id="hxp-fecha" value="${esc(h.fecha_pago) || hoyStr()}"></div>
      </div>
      <div class="modal-acciones">
        <button class="btn-sec" id="hxp-cancelar">Cancelar</button>
        <button class="btn-pri" id="hxp-guardar">Confirmar pago</button>
      </div>`);
    document.getElementById('hxp-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('hxp-guardar').addEventListener('click', async () => {
      const importe = parseFloat(val('hxp-importe'));
      if (isNaN(importe) || importe < 0) return toast('Indica el importe', 'error');
      const btn = document.getElementById('hxp-guardar');
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        await API.put('/api/personal/horas-extra/' + h.id, { pagada: 1, importe, fecha_pago: val('hxp-fecha') });
        cerrarModal();
        await recargarHoras();
        toast('Pago registrado', 'ok');
      } catch (e) { toast(e.message, 'error'); btn.disabled = false; btn.textContent = 'Confirmar pago'; }
    });
  }

  async function desmarcarPago(id) {
    if (!confirm('¿Desmarcar el pago de estas horas extra?')) return;
    try {
      await API.put('/api/personal/horas-extra/' + id, { pagada: 0, importe: null, fecha_pago: null });
      await recargarHoras();
      toast('Pago desmarcado', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function borrarHoras(id) {
    if (!confirm('¿Eliminar este registro de horas extra?')) return;
    try {
      await API.del('/api/personal/horas-extra/' + id);
      await recargarHoras();
      toast('Registro eliminado', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  }

  // ==================== Sub-pestañas ====================
  function activarSub(sub) {
    if (fichajeTimer) { clearInterval(fichajeTimer); fichajeTimer = null; }
    document.querySelectorAll('#per-subtabs .subtab').forEach((b) =>
      b.classList.toggle('activo', b.dataset.sub === sub));
    document.querySelectorAll('#vista-personal .sub-panel').forEach((p) =>
      p.classList.toggle('activo', p.dataset.panelSub === sub));
    if (sub === 'empleados') cargarEmpleados();
    if (sub === 'fichaje') { construirFichaje(); cargarFichaje(); }
    if (sub === 'ausencias') { construirAusencias(); cargarAusencias(); }
    if (sub === 'horas') { construirHoras(); cargarHoras(); }
  }

  // ==================== Init ====================
  function init() {
    // Oculta Empleados y Ausencias para limpieza/mantenimiento (solo ven Fichaje y Horas extra).
    if (!puedeVerEmpleados()) {
      ['empleados', 'ausencias'].forEach((s) => {
        const b = document.querySelector(`#per-subtabs .subtab[data-sub="${s}"]`);
        if (b) b.classList.add('oculto');
      });
    }

    document.querySelectorAll('#per-subtabs .subtab').forEach((b) =>
      b.addEventListener('click', () => activarSub(b.dataset.sub)));

    document.getElementById('per-buscar')?.addEventListener('input', (e) => { busqueda = e.target.value; renderTabla(); });
    document.getElementById('per-nuevo')?.addEventListener('click', () => modalEmpleado(null));
  }

  return { init, cargar, abrirFicha };
})();
