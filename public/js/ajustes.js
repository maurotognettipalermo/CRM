// Módulo Ajustes: razones sociales (tarjetas + modal), usuarios y registro de actividad.

const Ajustes = (() => {
  // ---- Campos de razón social (mismo orden que la captura) ----
  const RS_GENERAL = [
    ['razon_social', 'Razón Social'], ['nombre_comercial', 'Nombre comercial'],
    ['cif_nif', 'Nº documento CIF/NIF'], ['direccion', 'Dirección'],
    ['persona_contacto', 'Persona de contacto'], ['numero', 'Número'],
    ['email_contacto', 'Email de contacto'], ['puerta', 'Puerta'],
    ['telefono', 'Teléfono sin prefijo'], ['codigo_postal', 'Código postal'],
    ['fax', 'Fax'], ['ciudad', 'Ciudad'],
    ['iva', 'IVA', 'iva'], ['estado_provincia', 'Estado/Provincia'],
    ['codigo_cnae', 'Código CNAE'], ['pais', 'País'],
    ['iva_intracomunitario', 'IVA intracomunitario'], ['tipo_direccion', 'Tipo de dirección'],
    ['tipo_documento_in', 'Tipo de documento IN'], ['numero_documento_in', 'Nº de documento IN'],
  ];
  const RS_BANCO = [
    ['nombre_banco', 'Nombre del banco'], ['iban', 'IBAN'],
    ['direccion_banco', 'Dirección del banco'], ['codigo_swift', 'Código SWIFT'],
    ['numero_cuenta_ccc', 'Nº de cuenta CCC'],
  ];
  const IVA_OPTS = ['General 21%', 'Reducido 10%', 'Superreducido 4%', 'Exento 0%'];
  const ACCIONES = ['crear', 'editar', 'eliminar', 'importar', 'mover', 'login', 'logout'];

  let usuarios = [];
  let portalesLista = [];

  // ---- Utilidades ----
  function colorAvatar(s) {
    s = s || '';
    let h = 0;
    for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
    return `hsl(${Math.abs(h) % 360}, 52%, 52%)`;
  }
  function inicial(s) { return (s || '?').trim().charAt(0).toUpperCase(); }
  function fechaHora(s) {
    if (!s) return '—';
    const [d, t] = String(s).split(' ');
    const p = d.split('-');
    if (p.length !== 3) return s;
    return `${p[2]}/${p[1]}/${p[0]}${t ? ' ' + t.slice(0, 5) : ''}`;
  }

  // ==================== Sub-pestañas ====================
  function activarSub(sub) {
    document.querySelectorAll('#ajustes-subtabs .subtab').forEach((b) =>
      b.classList.toggle('activo', b.dataset.sub === sub));
    document.querySelectorAll('#vista-ajustes .sub-panel').forEach((p) =>
      p.classList.toggle('activo', p.dataset.panelSub === sub));
  }

  async function cargar() {
    // La sub-pestaña Actividad solo existe para administradores.
    document.getElementById('subtab-actividad').classList.toggle('oculto', !Auth.esAdmin());
    await cargarRazones();
    await cargarUsuarios();
    await cargarPortales();
    if (Auth.esAdmin()) await cargarActividad();
  }

  // ==================== Portales ====================
  // La sub-pestaña Portales y su panel se inyectan por JS (no se toca index.html).
  function inyectarPortales() {
    if (document.querySelector('#ajustes-subtabs [data-sub="portales"]')) return;
    const subtabs = document.getElementById('ajustes-subtabs');
    const btn = document.createElement('button');
    btn.className = 'subtab';
    btn.dataset.sub = 'portales';
    btn.textContent = 'Portales';
    subtabs.appendChild(btn);

    const panel = document.createElement('div');
    panel.className = 'sub-panel';
    panel.dataset.panelSub = 'portales';
    panel.innerHTML = `
      <div class="sub-panel-head">
        <span class="sub-panel-titulo">Portales de venta</span>
        <button id="btn-nuevo-portal" class="btn-pri">＋ Nuevo portal</button>
      </div>
      <div class="tabla-scroll">
        <table class="tabla" id="tabla-portales">
          <thead>
            <tr><th class="col-orden">Orden</th><th class="col-logo">Logo</th><th>Nombre</th><th>Estado</th><th></th></tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>`;
    document.querySelector('#vista-ajustes .ajustes-scroll').appendChild(panel);
    document.getElementById('btn-nuevo-portal').addEventListener('click', () => formularioPortal(null));
  }

  async function cargarPortales() {
    try { portalesLista = await API.get('/api/portales?todos=1'); }
    catch (e) { return toast(e.message, 'error'); }
    renderPortales();
  }

  function renderPortales() {
    const tbody = document.querySelector('#tabla-portales tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (portalesLista.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="color:#6b7280;text-align:center;padding:24px">No hay portales.</td></tr>';
      return;
    }
    portalesLista.forEach((p, i) => {
      const tr = document.createElement('tr');
      const estado = p.activo
        ? '<span class="badge-estado activo">Activo</span>'
        : '<span class="badge-estado neutro">Inactivo</span>';
      const logo = p.imagen_url
        ? `<img class="portal-logo-mini" src="${esc(p.imagen_url)}" alt="">`
        : `<span class="portal-logo-inicial" style="background:${esc(p.color) || '#3b82f6'}">${esc(inicial(p.nombre))}</span>`;
      tr.innerHTML = `
        <td>
          <div class="orden-btns">
            <button class="btn-orden" data-subir="${p.id}" ${i === 0 ? 'disabled' : ''} title="Subir">▲</button>
            <button class="btn-orden" data-bajar="${p.id}" ${i === portalesLista.length - 1 ? 'disabled' : ''} title="Bajar">▼</button>
          </div>
        </td>
        <td class="cel-logo">${logo}</td>
        <td>${esc(p.nombre)}</td>
        <td>${estado}</td>
        <td class="acciones">
          <button class="btn-mini" data-editar-p="${p.id}" title="Editar">✏️</button>
          <button class="btn-mini" data-borrar-p="${p.id}" title="Eliminar">🗑️</button>
        </td>`;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll('[data-subir]').forEach((b) =>
      b.addEventListener('click', () => moverPortal(Number(b.dataset.subir), -1)));
    tbody.querySelectorAll('[data-bajar]').forEach((b) =>
      b.addEventListener('click', () => moverPortal(Number(b.dataset.bajar), 1)));
    tbody.querySelectorAll('[data-editar-p]').forEach((b) =>
      b.addEventListener('click', () => formularioPortal(portalesLista.find((x) => x.id == b.dataset.editarP))));
    tbody.querySelectorAll('[data-borrar-p]').forEach((b) =>
      b.addEventListener('click', () => borrarPortal(b.dataset.borrarP)));
  }

  // Reordena intercambiando el campo orden con el vecino (dir -1 sube, +1 baja).
  async function moverPortal(id, dir) {
    const idx = portalesLista.findIndex((p) => p.id === id);
    const target = portalesLista[idx + dir];
    if (!target) return;
    const p = portalesLista[idx];
    try {
      await API.put('/api/portales/' + p.id, { orden: target.orden });
      await API.put('/api/portales/' + target.id, { orden: p.orden });
      await cargarPortales();
    } catch (e) { toast(e.message, 'error'); }
  }

  // Sube la imagen de un portal (campo "imagen"). No usa API.subirArchivo porque
  // ese helper envía el campo "archivo"; aquí el backend espera "imagen".
  async function subirImagenPortal(id, file) {
    const fd = new FormData();
    fd.append('imagen', file);
    const s = Auth.sesion() || {};
    const r = await fetch('/api/portales/' + id + '/imagen', {
      method: 'POST',
      headers: s.token ? { 'X-Auth-Token': s.token } : {},
      body: fd,
    });
    if (!r.ok) {
      let msg = 'Error ' + r.status;
      try { const d = await r.json(); if (d && d.error) msg = d.error; } catch (e) {}
      throw new Error(msg);
    }
    return r.json();
  }

  function formularioPortal(portal) {
    const esNuevo = !portal;
    portal = portal || {};
    const activoChecked = portal.activo === undefined ? true : !!portal.activo;
    const color = portal.color || '#3b82f6';
    let archivoLogo = null;                 // File pendiente de subir (se sube al guardar)
    const imagenUrlActual = portal.imagen_url || null;

    abrirModal(`
      <h3>${esNuevo ? 'Nuevo' : 'Editar'} portal</h3>
      <div class="campo"><label>Nombre *</label><input id="p-nombre" value="${esc(portal.nombre)}"></div>
      <div class="campo"><label>Estado</label>
        <label class="toggle-campo"><input type="checkbox" id="p-activo"${activoChecked ? ' checked' : ''}><span>Activo</span></label>
      </div>
      <div class="campo">
        <label>Color en el planning</label>
        <input type="color" id="p-color" value="${esc(color)}">
        <div id="p-color-preview" class="portal-color-preview"></div>
      </div>
      <div class="campo">
        <label>Logo del portal</label>
        <div id="p-logo-zona"></div>
        <input type="file" id="p-logo-input" accept=".jpg,.jpeg,.png,.webp,.svg" hidden>
      </div>
      <div class="modal-acciones">
        <button class="btn-sec" id="p-cancelar">Cancelar</button>
        <button class="btn-pri" id="p-guardar">Guardar</button>
      </div>`);

    // Preview del color (barra estilo planning con el nombre encima).
    const actualizarColorPreview = () => {
      const prev = document.getElementById('p-color-preview');
      prev.style.background = document.getElementById('p-color').value;
      prev.textContent = document.getElementById('p-nombre').value.trim() || 'Portal';
    };
    actualizarColorPreview();
    document.getElementById('p-color').addEventListener('input', actualizarColorPreview);
    document.getElementById('p-nombre').addEventListener('input', actualizarColorPreview);

    // Zona de logo: imagen actual/preview + "Cambiar", o dropzone si no hay imagen.
    const input = document.getElementById('p-logo-input');
    const renderZonaLogo = (previewSrc) => {
      const zona = document.getElementById('p-logo-zona');
      const src = previewSrc || imagenUrlActual;
      if (src) {
        zona.innerHTML = `<img class="portal-logo-actual" src="${esc(src)}" alt=""><button type="button" class="btn-sec" id="p-logo-cambiar">Cambiar</button>`;
        zona.querySelector('#p-logo-cambiar').addEventListener('click', () => input.click());
      } else {
        zona.innerHTML = '<div class="portal-dropzone" id="p-dropzone"><span class="dz-icono">⬆</span><span>Subir logo</span></div>';
        const dz = zona.querySelector('#p-dropzone');
        dz.addEventListener('click', () => input.click());
        ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('dz-activo'); }));
        ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('dz-activo'); }));
        dz.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) seleccionarLogo(f); });
      }
    };
    const seleccionarLogo = (file) => {
      archivoLogo = file;
      const reader = new FileReader();
      reader.onload = () => renderZonaLogo(reader.result);
      reader.readAsDataURL(file);
    };
    input.addEventListener('change', () => { if (input.files[0]) seleccionarLogo(input.files[0]); });
    renderZonaLogo(null);

    document.getElementById('p-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('p-guardar').addEventListener('click', async () => {
      const nombre = document.getElementById('p-nombre').value.trim();
      const activo = document.getElementById('p-activo').checked ? 1 : 0;
      const colorVal = document.getElementById('p-color').value;
      if (!nombre) return toast('El nombre es obligatorio', 'error');
      try {
        let id = portal.id;
        if (esNuevo) {
          const res = await API.post('/api/portales', { nombre });
          id = res.id;
        }
        await API.put('/api/portales/' + id, { nombre, color: colorVal, activo });
        if (archivoLogo) await subirImagenPortal(id, archivoLogo);
        cerrarModal();
        await cargarPortales();
        toast('Portal guardado correctamente', 'ok');
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  async function borrarPortal(id) {
    const p = portalesLista.find((x) => x.id == id);
    if (!confirm(`¿Eliminar el portal "${p ? p.nombre : id}"?`)) return;
    try {
      await API.del('/api/portales/' + id);
      await cargarPortales();
      toast('Portal eliminado', 'ok');
    } catch (e) {
      if (e.status === 409) toast('Este portal tiene reservas asociadas y no puede eliminarse', 'error');
      else toast(e.message, 'error');
    }
  }

  // ==================== Razones sociales ====================
  async function cargarRazones() {
    let lista;
    try { lista = await API.get('/api/ajustes/razones-sociales'); }
    catch (e) { return toast(e.message, 'error'); }
    const cont = document.getElementById('razones-cards');
    cont.innerHTML = '';
    if (lista.length === 0) {
      cont.innerHTML = '<p class="sub-vacio">No hay razones sociales. Crea la primera con “＋ Nueva razón social”.</p>';
      return;
    }
    const unica = lista.length === 1;
    for (const rs of lista) {
      const card = document.createElement('div');
      card.className = 'razon-card';
      const linea = (etq, v) => v ? `<div class="razon-dato"><span>${etq}:</span> ${esc(v)}</div>` : '';
      card.innerHTML = `
        <div class="razon-card-head">
          <span class="razon-nombre">${esc(rs.razon_social) || '(sin nombre)'}</span>
          ${unica ? '<span class="badge-principal">Principal</span>' : ''}
        </div>
        ${linea('CIF/NIF', rs.cif_nif)}
        ${linea('Email', rs.email_contacto)}
        ${linea('Teléfono', rs.telefono)}
        ${linea('Ciudad', rs.ciudad)}
        <div class="razon-card-acciones">
          <button class="btn-mini" data-editar-rs="${rs.id}" title="Editar">✏️</button>
          <button class="btn-mini" data-borrar-rs="${rs.id}" title="Eliminar">🗑️</button>
        </div>`;
      cont.appendChild(card);
    }
    cont.querySelectorAll('[data-editar-rs]').forEach((b) =>
      b.addEventListener('click', () => formularioRazon(lista.find((x) => x.id == b.dataset.editarRs))));
    cont.querySelectorAll('[data-borrar-rs]').forEach((b) =>
      b.addEventListener('click', () => borrarRazon(b.dataset.borrarRs)));
  }

  function formularioRazon(rs) {
    rs = rs || {};
    const esNueva = !rs.id;
    const campo = ([key, label, tipo]) => {
      let v = rs[key] != null ? rs[key] : '';
      if (esNueva && key === 'pais' && !v) v = 'España';
      if (tipo === 'iva') {
        return `<div class="ajuste-campo"><label>${label}</label><select data-rs="${key}">` +
          IVA_OPTS.map((o) => `<option${v === o ? ' selected' : ''}>${o}</option>`).join('') +
          '</select></div>';
      }
      return `<div class="ajuste-campo"><label>${label}</label><input type="text" data-rs="${key}" value="${esc(v)}"></div>`;
    };
    abrirModal(`
      <h3>${esNueva ? 'Nueva' : 'Editar'} razón social</h3>
      <div class="ajustes-seccion-titulo">Información general</div>
      <div class="ajustes-grid">${RS_GENERAL.map(campo).join('')}</div>
      <div class="ajustes-seccion-titulo">Datos bancarios</div>
      <div class="ajustes-grid">${RS_BANCO.map(campo).join('')}</div>
      <div class="modal-acciones">
        <button class="btn-sec" id="rs-cancelar">Cancelar</button>
        <button class="btn-pri" id="rs-guardar">Guardar</button>
      </div>`);
    document.querySelector('.modal').classList.add('modal-ancho');
    document.getElementById('rs-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('rs-guardar').addEventListener('click', async () => {
      const body = {};
      document.querySelectorAll('#modal-contenido [data-rs]').forEach((el) => { body[el.dataset.rs] = el.value; });
      try {
        if (esNueva) await API.post('/api/ajustes/razones-sociales', body);
        else await API.put('/api/ajustes/razones-sociales/' + rs.id, body);
        cerrarModal();
        await cargarRazones();
        toast('Razón social guardada', 'ok');
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  async function borrarRazon(id) {
    if (!confirm('¿Eliminar esta razón social?')) return;
    try {
      await API.del('/api/ajustes/razones-sociales/' + id);
      await cargarRazones();
      toast('Razón social eliminada', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  }

  // ==================== Usuarios ====================
  async function cargarUsuarios() {
    try { usuarios = await API.get('/api/usuarios'); }
    catch (e) { return toast(e.message, 'error'); }
    const tbody = document.querySelector('#tabla-usuarios tbody');
    tbody.innerHTML = '';
    const yo = (Auth.sesion() || {}).userId;
    for (const u of usuarios) {
      const tr = document.createElement('tr');
      const rolBadge = u.rol === 'administrador'
        ? '<span class="badge-rol admin">Administrador</span>'
        : '<span class="badge-rol">Usuario</span>';
      const estado = u.activo
        ? '<span class="badge-estado activo">Activo</span>'
        : '<span class="badge-estado inactivo">Inactivo</span>';
      const esYo = u.id === yo;
      tr.innerHTML = `
        <td class="cel-avatar"><span class="avatar" style="background:${colorAvatar(u.nombre)}">${esc(inicial(u.nombre))}</span></td>
        <td>${esc(u.nombre)}${esYo ? ' <span class="cel-sub">(tú)</span>' : ''}</td>
        <td>${esc(u.username)}</td>
        <td>${rolBadge}</td>
        <td>${estado}</td>
        <td>${fechaHora(u.ultimo_acceso)}</td>
        <td class="acciones">
          <button class="btn-mini" data-editar-u="${u.id}">Editar</button>
          ${esYo ? '' : `<button class="btn-mini" data-borrar-u="${u.id}">Eliminar</button>`}
        </td>`;
      tbody.appendChild(tr);
    }
    tbody.querySelectorAll('[data-editar-u]').forEach((b) =>
      b.addEventListener('click', () => formularioUsuario(usuarios.find((x) => x.id == b.dataset.editarU))));
    tbody.querySelectorAll('[data-borrar-u]').forEach((b) =>
      b.addEventListener('click', () => borrarUsuario(b.dataset.borrarU)));
  }

  function formularioUsuario(u) {
    u = u || {};
    const esNuevo = !u.id;
    const esYo = !esNuevo && u.id === (Auth.sesion() || {}).userId;
    abrirModal(`
      <h3>${esNuevo ? 'Nuevo' : 'Editar'} usuario</h3>
      <div class="campo"><label>Nombre *</label><input id="u-nombre" value="${esc(u.nombre)}"></div>
      <div class="campo"><label>Usuario *</label><input id="u-username" value="${esc(u.username)}"></div>
      <div class="campo">
        <label>Contraseña ${esNuevo ? '*' : '(vacío = no cambiar)'}</label>
        <div class="input-con-icono">
          <input id="u-password" type="password" autocomplete="new-password">
          <button type="button" class="btn-ojo" id="u-ojo" title="Mostrar/ocultar">👁</button>
        </div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Rol</label>
          <select id="u-rol">
            <option value="usuario"${u.rol === 'usuario' ? ' selected' : ''}>Usuario</option>
            <option value="administrador"${u.rol === 'administrador' ? ' selected' : ''}>Administrador</option>
          </select>
        </div>
        <div class="campo"><label>Estado</label>
          <label class="toggle-campo">
            <input type="checkbox" id="u-activo"${u.activo || esNuevo ? ' checked' : ''}${esYo ? ' disabled' : ''}>
            <span>Activo</span>
          </label>
        </div>
      </div>
      <div class="modal-acciones">
        <button class="btn-sec" id="u-cancelar">Cancelar</button>
        <button class="btn-pri" id="u-guardar">Guardar</button>
      </div>`);
    document.getElementById('u-ojo').addEventListener('click', () => {
      const inp = document.getElementById('u-password');
      inp.type = inp.type === 'password' ? 'text' : 'password';
    });
    document.getElementById('u-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('u-guardar').addEventListener('click', async () => {
      const body = {
        nombre: document.getElementById('u-nombre').value.trim(),
        username: document.getElementById('u-username').value.trim(),
        password: document.getElementById('u-password').value,
        rol: document.getElementById('u-rol').value,
        activo: document.getElementById('u-activo').checked ? 1 : 0,
      };
      if (!body.nombre) return toast('El nombre es obligatorio', 'error');
      if (!body.username) return toast('El usuario es obligatorio', 'error');
      if (esNuevo && !body.password) return toast('La contraseña es obligatoria', 'error');
      try {
        if (esNuevo) await API.post('/api/usuarios', body);
        else await API.put('/api/usuarios/' + u.id, body);
        cerrarModal();
        await cargarUsuarios();
        toast('Usuario guardado', 'ok');
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  async function borrarUsuario(id) {
    const u = usuarios.find((x) => x.id == id);
    if (!confirm(`¿Eliminar al usuario "${u ? u.nombre : id}"?`)) return;
    try {
      await API.del('/api/usuarios/' + id);
      await cargarUsuarios();
      toast('Usuario eliminado', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  }

  // ==================== Actividad ====================
  function poblarFiltros() {
    const selU = document.getElementById('filtro-act-usuario');
    selU.innerHTML = '<option value="">Todos los usuarios</option>' +
      usuarios.map((u) => `<option value="${u.id}">${esc(u.nombre)}</option>`).join('');
    const selA = document.getElementById('filtro-act-accion');
    selA.innerHTML = '<option value="">Todas las acciones</option>' +
      ACCIONES.map((a) => `<option value="${a}">${a.charAt(0).toUpperCase() + a.slice(1)}</option>`).join('');
  }

  async function cargarActividad() {
    poblarFiltros();
    await refrescarActividad();
  }

  async function refrescarActividad() {
    const usuarioId = document.getElementById('filtro-act-usuario').value;
    const accion = document.getElementById('filtro-act-accion').value;
    const qs = new URLSearchParams({ limit: '200' });
    if (usuarioId) qs.set('usuario_id', usuarioId);
    if (accion) qs.set('accion', accion);
    let lista;
    try { lista = await API.get('/api/ajustes/actividad?' + qs.toString()); }
    catch (e) { return toast(e.message, 'error'); }
    const tbody = document.querySelector('#tabla-actividad tbody');
    tbody.innerHTML = '';
    if (lista.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="color:#6b7280;text-align:center;padding:24px">Sin registros.</td></tr>';
      return;
    }
    for (const a of lista) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${fechaHora(a.fecha)}</td>
        <td>${esc(a.usuario_nombre) || '—'}</td>
        <td><span class="badge-accion accion-${esc(a.accion)}">${esc(a.accion)}</span></td>
        <td>${esc(a.entidad) || '—'}</td>
        <td>${esc(a.detalle) || '—'}</td>`;
      tbody.appendChild(tr);
    }
  }

  // ==================== Init ====================
  function init() {
    inyectarPortales(); // crea la 4ª sub-pestaña antes de enlazar los clics de sub-pestaña
    document.querySelectorAll('#ajustes-subtabs .subtab').forEach((b) =>
      b.addEventListener('click', () => activarSub(b.dataset.sub)));
    document.getElementById('btn-nueva-razon').addEventListener('click', () => formularioRazon(null));
    document.getElementById('btn-nuevo-usuario').addEventListener('click', () => formularioUsuario(null));
    document.getElementById('filtro-act-usuario').addEventListener('change', refrescarActividad);
    document.getElementById('filtro-act-accion').addEventListener('change', refrescarActividad);
  }

  return { init, cargar };
})();
