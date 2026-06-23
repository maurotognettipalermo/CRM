// Módulo Ajustes: razones sociales (tarjetas + modal), usuarios y registro de actividad.

const Ajustes = (() => {
  // Descripción del rol bajo el select (solo para los roles de acceso restringido).
  const ROL_DESC = {
    limpieza: 'Solo acceso al módulo de limpieza',
    mantenimiento: 'Solo acceso al módulo de mantenimiento',
  };

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
  let catalogoLista = [];
  let catBuscar = '';
  let extrasLista = [];
  let extraBuscar = '';
  let estadosLista = [];

  // Etiqueta legible del tipo de precio de un extra.
  const TIPO_EXTRA_LABEL = { unidad: 'por unidad', noche: 'por noche', persona: 'por persona' };
  function tipoExtraBadge(t) {
    return `<span class="badge-tipo-extra">${TIPO_EXTRA_LABEL[t] || esc(t || '—')}</span>`;
  }

  // ---- Utilidades ----
  function euro(n) {
    return (Number(n) || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }
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
    // Las sub-pestañas Actividad y Correo electrónico solo existen para administradores.
    document.getElementById('subtab-actividad').classList.toggle('oculto', !Auth.esAdmin());
    document.getElementById('subtab-smtp')?.classList.toggle('oculto', !Auth.esAdmin());
    await cargarRazones();
    await cargarUsuarios();
    await cargarPortales();
    await cargarCatalogoGastos();
    await cargarCatalogoExtras();
    await cargarEstadosReserva();
    await cargarPlanning();
    if (Auth.esAdmin()) await cargarActividad();
    if (Auth.esAdmin()) await cargarSmtp();
  }

  // ==================== Catálogo de gastos ====================
  // La sub-pestaña y su panel se inyectan por JS (no se toca index.html).
  function inyectarCatalogoGastos() {
    if (document.querySelector('#ajustes-subtabs [data-sub="catalogo"]')) return;
    const subtabs = document.getElementById('ajustes-subtabs');
    const btn = document.createElement('button');
    btn.className = 'subtab';
    btn.dataset.sub = 'catalogo';
    btn.textContent = 'Catálogo de gastos';
    subtabs.appendChild(btn);

    const panel = document.createElement('div');
    panel.className = 'sub-panel';
    panel.dataset.panelSub = 'catalogo';
    panel.innerHTML = `
      <div class="sub-panel-head">
        <span class="sub-panel-titulo">Catálogo de gastos</span>
        <div class="cat-head-acciones">
          <input type="text" id="cat-buscar" class="input-buscar" placeholder="Buscar concepto…">
          <button id="btn-nuevo-concepto" class="btn-pri">＋ Nuevo concepto</button>
        </div>
      </div>
      <div class="tabla-scroll">
        <table class="tabla" id="tabla-catalogo">
          <thead>
            <tr><th>Concepto</th><th>Precio</th><th>Descripción</th><th>Estado</th><th></th></tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>`;
    document.querySelector('#vista-ajustes .ajustes-scroll').appendChild(panel);
    document.getElementById('btn-nuevo-concepto').addEventListener('click', () => formularioConcepto(null));
    document.getElementById('cat-buscar').addEventListener('input', (e) => { catBuscar = e.target.value; renderCatalogo(); });
  }

  async function cargarCatalogoGastos() {
    try { catalogoLista = await API.get('/api/catalogo-gastos'); }
    catch (e) { return toast(e.message, 'error'); }
    renderCatalogo();
  }

  function renderCatalogo() {
    const tbody = document.querySelector('#tabla-catalogo tbody');
    if (!tbody) return;
    const q = catBuscar.trim().toLowerCase();
    const lista = catalogoLista.filter((c) => !q || (c.nombre || '').toLowerCase().includes(q));
    tbody.innerHTML = '';
    if (!lista.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="color:#6b7280;text-align:center;padding:24px">Sin conceptos.</td></tr>';
      return;
    }
    for (const c of lista) {
      const estado = c.activo
        ? '<span class="badge-estado activo">Activo</span>'
        : '<span class="badge-estado neutro">Inactivo</span>';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${esc(c.nombre)}</td>
        <td>${euro(c.precio)}</td>
        <td>${esc(c.descripcion) || '—'}</td>
        <td>${estado}</td>
        <td class="acciones">
          <button class="btn-mini" data-editar-c="${c.id}" title="Editar">✏️</button>
          <button class="btn-mini" data-borrar-c="${c.id}" title="Eliminar">🗑️</button>
        </td>`;
      tbody.appendChild(tr);
    }
    tbody.querySelectorAll('[data-editar-c]').forEach((b) =>
      b.addEventListener('click', () => formularioConcepto(catalogoLista.find((x) => x.id == b.dataset.editarC))));
    tbody.querySelectorAll('[data-borrar-c]').forEach((b) =>
      b.addEventListener('click', () => borrarConcepto(b.dataset.borrarC)));
  }

  function formularioConcepto(c) {
    c = c || {};
    const esNuevo = !c.id;
    const activoChecked = c.activo === undefined ? true : !!c.activo;
    abrirModal(`
      <h3>${esNuevo ? 'Nuevo' : 'Editar'} concepto</h3>
      <div class="campo"><label>Nombre *</label><input id="c-nombre" value="${esc(c.nombre)}"></div>
      <div class="campo"><label>Precio (€) *</label><input id="c-precio" type="number" step="0.01" min="0" value="${c.precio != null ? c.precio : ''}"></div>
      <div class="campo"><label>Descripción</label><textarea id="c-desc">${esc(c.descripcion)}</textarea></div>
      <div class="campo">
        <label class="toggle-campo"><input type="checkbox" id="c-iva"${c.incluye_iva ? ' checked' : ''}><span>Incluye IVA (21%)</span></label>
        <div id="c-iva-desglose" style="font-size:12px;color:var(--muted);margin-top:6px"></div>
      </div>
      <div class="campo"><label>Estado</label>
        <label class="toggle-campo"><input type="checkbox" id="c-activo"${activoChecked ? ' checked' : ''}><span>Activo</span></label>
      </div>
      <div class="modal-acciones">
        <button class="btn-sec" id="c-cancelar">Cancelar</button>
        <button class="btn-pri" id="c-guardar">Guardar</button>
      </div>`);

    const actualizarDesglose = () => {
      const el = document.getElementById('c-iva-desglose');
      if (!document.getElementById('c-iva').checked) { el.textContent = ''; return; }
      const base = parseFloat(document.getElementById('c-precio').value) || 0;
      const iva = base * 0.21;
      el.textContent = `Base: ${euro(base)} + IVA 21%: ${euro(iva)} = Total: ${euro(base + iva)}`;
    };
    actualizarDesglose();
    document.getElementById('c-precio').addEventListener('input', actualizarDesglose);
    document.getElementById('c-iva').addEventListener('change', actualizarDesglose);

    document.getElementById('c-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('c-guardar').addEventListener('click', async () => {
      const nombre = document.getElementById('c-nombre').value.trim();
      if (!nombre) return toast('El nombre es obligatorio', 'error');
      const precioRaw = document.getElementById('c-precio').value;
      if (precioRaw === '' || isNaN(parseFloat(precioRaw))) return toast('El precio es obligatorio', 'error');
      const body = {
        nombre,
        precio: parseFloat(precioRaw),
        descripcion: document.getElementById('c-desc').value,
        activo: document.getElementById('c-activo').checked ? 1 : 0,
        incluye_iva: document.getElementById('c-iva').checked ? 1 : 0,
      };
      try {
        if (esNuevo) await API.post('/api/catalogo-gastos', body);
        else await API.put('/api/catalogo-gastos/' + c.id, body);
        cerrarModal();
        await cargarCatalogoGastos();
        toast('Concepto guardado', 'ok');
      } catch (e) {
        if (e.status === 409) toast('Ya existe un concepto con ese nombre', 'error');
        else toast(e.message, 'error');
      }
    });
  }

  async function borrarConcepto(id) {
    const c = catalogoLista.find((x) => x.id == id);
    if (!confirm(`¿Eliminar el concepto "${c ? c.nombre : id}"?`)) return;
    try {
      await API.del('/api/catalogo-gastos/' + id);
      await cargarCatalogoGastos();
      toast('Concepto eliminado', 'ok');
    } catch (e) {
      if (e.status === 409) toast('Este concepto tiene gastos registrados y no puede eliminarse', 'error');
      else toast(e.message, 'error');
    }
  }

  // ==================== Catálogo de extras ====================
  // La sub-pestaña y su panel se inyectan por JS (no se toca index.html).
  function inyectarCatalogoExtras() {
    if (document.querySelector('#ajustes-subtabs [data-sub="extras"]')) return;
    const subtabs = document.getElementById('ajustes-subtabs');
    const btn = document.createElement('button');
    btn.className = 'subtab';
    btn.dataset.sub = 'extras';
    btn.textContent = 'Catálogo de extras';
    subtabs.appendChild(btn);

    const panel = document.createElement('div');
    panel.className = 'sub-panel';
    panel.dataset.panelSub = 'extras';
    panel.innerHTML = `
      <div class="sub-panel-head">
        <span class="sub-panel-titulo">Catálogo de extras</span>
        <div class="cat-head-acciones">
          <input type="text" id="extra-buscar" class="input-buscar" placeholder="Buscar extra…">
          <button id="btn-nuevo-extra" class="btn-pri">＋ Nuevo extra</button>
        </div>
      </div>
      <div class="tabla-scroll">
        <table class="tabla" id="tabla-extras">
          <thead>
            <tr><th>Nombre</th><th>Precio</th><th>Tipo precio</th><th>Descripción</th><th>Estado</th><th></th></tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>`;
    document.querySelector('#vista-ajustes .ajustes-scroll').appendChild(panel);
    document.getElementById('btn-nuevo-extra').addEventListener('click', () => formularioExtra(null));
    document.getElementById('extra-buscar').addEventListener('input', (e) => { extraBuscar = e.target.value; renderCatalogoExtras(); });
  }

  async function cargarCatalogoExtras() {
    try { extrasLista = await API.get('/api/catalogo-extras'); }
    catch (e) { return toast(e.message, 'error'); }
    renderCatalogoExtras();
  }

  function renderCatalogoExtras() {
    const tbody = document.querySelector('#tabla-extras tbody');
    if (!tbody) return;
    const q = extraBuscar.trim().toLowerCase();
    const lista = extrasLista.filter((c) => !q || (c.nombre || '').toLowerCase().includes(q));
    tbody.innerHTML = '';
    if (!lista.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="color:#6b7280;text-align:center;padding:24px">Sin extras.</td></tr>';
      return;
    }
    for (const c of lista) {
      const estado = c.activo
        ? '<span class="badge-estado activo">Activo</span>'
        : '<span class="badge-estado neutro">Inactivo</span>';
      const obligatorio = c.obligatorio ? ' <span class="badge-obligatorio">Obligatorio</span>' : '';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${esc(c.nombre)}${obligatorio}</td>
        <td>${euro(c.precio)}</td>
        <td>${tipoExtraBadge(c.tipo_precio)}</td>
        <td>${esc(c.descripcion) || '—'}</td>
        <td>${estado}</td>
        <td class="acciones">
          <button class="btn-mini" data-editar-e="${c.id}" title="Editar">✏️</button>
          <button class="btn-mini" data-borrar-e="${c.id}" title="Eliminar">🗑️</button>
        </td>`;
      tbody.appendChild(tr);
    }
    tbody.querySelectorAll('[data-editar-e]').forEach((b) =>
      b.addEventListener('click', () => formularioExtra(extrasLista.find((x) => x.id == b.dataset.editarE))));
    tbody.querySelectorAll('[data-borrar-e]').forEach((b) =>
      b.addEventListener('click', () => borrarExtra(b.dataset.borrarE)));
  }

  function formularioExtra(c) {
    c = c || {};
    const esNuevo = !c.id;
    const activoChecked = c.activo === undefined ? true : !!c.activo;
    const tipo = c.tipo_precio || 'unidad';
    const radio = (val, label) =>
      `<label class="radio-campo"><input type="radio" name="e-tipo" value="${val}"${tipo === val ? ' checked' : ''}><span>${label}</span></label>`;
    abrirModal(`
      <h3>${esNuevo ? 'Nuevo' : 'Editar'} extra</h3>
      <div class="campo"><label>Nombre *</label><input id="e-nombre" value="${esc(c.nombre)}"></div>
      <div class="campo"><label>Precio (€) *</label><input id="e-precio" type="number" step="0.01" min="0" value="${c.precio != null ? c.precio : ''}"></div>
      <div class="campo"><label>Tipo de precio</label>
        <div class="radio-grupo">${radio('unidad', 'Por unidad')}${radio('noche', 'Por noche')}${radio('persona', 'Por persona')}</div>
      </div>
      <div class="campo"><label>Descripción</label><textarea id="e-desc">${esc(c.descripcion)}</textarea></div>
      <div class="campo"><label>Estado</label>
        <label class="toggle-campo"><input type="checkbox" id="e-activo"${activoChecked ? ' checked' : ''}><span>Activo</span></label>
      </div>
      <div class="campo">
        <label class="toggle-campo"><input type="checkbox" id="e-obligatorio"${c.obligatorio ? ' checked' : ''}><span>Extra obligatorio</span></label>
        <div id="e-obligatorio-aviso" class="e-obligatorio-aviso${c.obligatorio ? '' : ' oculto'}">Este extra se añadirá automáticamente a todas las reservas nuevas</div>
      </div>
      <div class="modal-acciones">
        <button class="btn-sec" id="e-cancelar">Cancelar</button>
        <button class="btn-pri" id="e-guardar">Guardar</button>
      </div>`);

    document.getElementById('e-obligatorio').addEventListener('change', (e) =>
      document.getElementById('e-obligatorio-aviso').classList.toggle('oculto', !e.target.checked));
    document.getElementById('e-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('e-guardar').addEventListener('click', async () => {
      const nombre = document.getElementById('e-nombre').value.trim();
      if (!nombre) return toast('El nombre es obligatorio', 'error');
      const precioRaw = document.getElementById('e-precio').value;
      if (precioRaw === '' || isNaN(parseFloat(precioRaw))) return toast('El precio es obligatorio', 'error');
      const body = {
        nombre,
        precio: parseFloat(precioRaw),
        tipo_precio: (document.querySelector('input[name="e-tipo"]:checked') || {}).value || 'unidad',
        descripcion: document.getElementById('e-desc').value,
        activo: document.getElementById('e-activo').checked ? 1 : 0,
        obligatorio: document.getElementById('e-obligatorio').checked ? 1 : 0,
      };
      try {
        if (esNuevo) await API.post('/api/catalogo-extras', body);
        else await API.put('/api/catalogo-extras/' + c.id, body);
        cerrarModal();
        await cargarCatalogoExtras();
        toast('Extra guardado', 'ok');
      } catch (e) {
        if (e.status === 409) toast('Ya existe un extra con ese nombre', 'error');
        else toast(e.message, 'error');
      }
    });
  }

  async function borrarExtra(id) {
    const c = extrasLista.find((x) => x.id == id);
    if (!confirm(`¿Eliminar el extra "${c ? c.nombre : id}"?`)) return;
    try {
      await API.del('/api/catalogo-extras/' + id);
      await cargarCatalogoExtras();
      toast('Extra eliminado', 'ok');
    } catch (e) {
      if (e.status === 409) toast('Este extra tiene reservas asociadas y no puede eliminarse', 'error');
      else toast(e.message, 'error');
    }
  }

  // ==================== Estados de reserva ====================
  // La sub-pestaña y su panel se inyectan por JS (no se toca index.html).
  function inyectarEstadosReserva() {
    if (document.querySelector('#ajustes-subtabs [data-sub="estados"]')) return;
    const subtabs = document.getElementById('ajustes-subtabs');
    const btn = document.createElement('button');
    btn.className = 'subtab';
    btn.dataset.sub = 'estados';
    btn.textContent = 'Estados de reserva';
    subtabs.appendChild(btn);

    const panel = document.createElement('div');
    panel.className = 'sub-panel';
    panel.dataset.panelSub = 'estados';
    panel.innerHTML = `
      <div class="sub-panel-head">
        <span class="sub-panel-titulo">Estados de reserva</span>
        <button id="btn-nuevo-estado" class="btn-pri">＋ Nuevo estado</button>
      </div>
      <div class="tabla-scroll">
        <table class="tabla" id="tabla-estados">
          <thead>
            <tr><th class="col-logo">Color</th><th>Nombre</th><th>Sistema</th><th>Estado</th><th></th></tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>`;
    document.querySelector('#vista-ajustes .ajustes-scroll').appendChild(panel);
    document.getElementById('btn-nuevo-estado').addEventListener('click', () => formularioEstado(null));
  }

  async function cargarEstadosReserva() {
    try { estadosLista = await API.get('/api/ajustes/estados-reserva'); }
    catch (e) { return toast(e.message, 'error'); }
    renderEstadosReserva();
  }

  function renderEstadosReserva() {
    const tbody = document.querySelector('#tabla-estados tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!estadosLista.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="color:#6b7280;text-align:center;padding:24px">Sin estados.</td></tr>';
      return;
    }
    for (const e of estadosLista) {
      const estado = e.activo
        ? '<span class="badge-estado activo">Activo</span>'
        : '<span class="badge-estado neutro">Inactivo</span>';
      const sistema = e.es_sistema ? '<span class="badge-estado neutro">Sistema</span>' : '—';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="cel-logo"><span class="estado-color-cuadro" style="background:${esc(e.color)}"></span></td>
        <td>${esc(e.nombre)}</td>
        <td>${sistema}</td>
        <td>${estado}</td>
        <td class="acciones">
          <button class="btn-mini" data-editar-est="${e.id}" title="Editar">✏️</button>
          ${e.es_sistema ? '' : `<button class="btn-mini" data-borrar-est="${e.id}" title="Eliminar">🗑️</button>`}
        </td>`;
      tbody.appendChild(tr);
    }
    tbody.querySelectorAll('[data-editar-est]').forEach((b) =>
      b.addEventListener('click', () => formularioEstado(estadosLista.find((x) => x.id == b.dataset.editarEst))));
    tbody.querySelectorAll('[data-borrar-est]').forEach((b) =>
      b.addEventListener('click', () => borrarEstado(b.dataset.borrarEst)));
  }

  function formularioEstado(e) {
    e = e || {};
    const esNuevo = !e.id;
    const esSistema = !!e.es_sistema;
    const activoChecked = e.activo === undefined ? true : !!e.activo;
    const color = e.color || '#3b82f6';
    abrirModal(`
      <h3>${esNuevo ? 'Nuevo' : 'Editar'} estado de reserva</h3>
      <div class="campo"><label>Nombre *</label><input id="est-nombre" value="${esc(e.nombre)}"></div>
      <div class="campo">
        <label>Color</label>
        <input type="color" id="est-color" value="${esc(color)}">
        <span id="est-color-preview" class="badge-rsv" style="margin-left:10px;background:${esc(color)};color:#fff">${esc(e.nombre) || 'Estado'}</span>
      </div>
      <div class="campo"><label>Estado</label>
        <label class="toggle-campo"><input type="checkbox" id="est-activo"${activoChecked ? ' checked' : ''}><span>Activo</span></label>
      </div>
      ${esSistema ? '<div class="e-obligatorio-aviso">⚠️ Este es un estado del sistema y no puede eliminarse</div>' : ''}
      <div class="modal-acciones">
        <button class="btn-sec" id="est-cancelar">Cancelar</button>
        <button class="btn-pri" id="est-guardar">Guardar</button>
      </div>`);

    const actualizarPreview = () => {
      const prev = document.getElementById('est-color-preview');
      prev.style.background = document.getElementById('est-color').value;
      prev.textContent = document.getElementById('est-nombre').value.trim() || 'Estado';
    };
    document.getElementById('est-color').addEventListener('input', actualizarPreview);
    document.getElementById('est-nombre').addEventListener('input', actualizarPreview);

    document.getElementById('est-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('est-guardar').addEventListener('click', async () => {
      const nombre = document.getElementById('est-nombre').value.trim();
      if (!nombre) return toast('El nombre es obligatorio', 'error');
      const body = {
        nombre,
        color: document.getElementById('est-color').value,
        activo: document.getElementById('est-activo').checked ? 1 : 0,
      };
      try {
        if (esNuevo) await API.post('/api/ajustes/estados-reserva', body);
        else await API.put('/api/ajustes/estados-reserva/' + e.id, body);
        cerrarModal();
        await cargarEstadosReserva();
        toast('Estado guardado', 'ok');
      } catch (err) {
        if (err.status === 409) toast('Ya existe un estado con ese nombre', 'error');
        else toast(err.message, 'error');
      }
    });
  }

  async function borrarEstado(id) {
    const e = estadosLista.find((x) => x.id == id);
    if (!confirm(`¿Eliminar el estado "${e ? e.nombre : id}"?`)) return;
    try {
      await API.del('/api/ajustes/estados-reserva/' + id);
      await cargarEstadosReserva();
      toast('Estado eliminado', 'ok');
    } catch (err) {
      if (err.status === 409) toast(err.message || 'No se puede eliminar este estado', 'error');
      else toast(err.message, 'error');
    }
  }

  // ==================== Correo electrónico (SMTP, solo admin) ====================
  // La sub-pestaña y su panel se inyectan por JS (no se toca index.html).
  function inyectarSmtp() {
    if (document.querySelector('#ajustes-subtabs [data-sub="smtp"]')) return;
    const subtabs = document.getElementById('ajustes-subtabs');
    const btn = document.createElement('button');
    btn.className = 'subtab';
    btn.id = 'subtab-smtp';
    btn.dataset.sub = 'smtp';
    btn.textContent = 'Correo electrónico ✉️';
    subtabs.appendChild(btn);

    const panel = document.createElement('div');
    panel.className = 'sub-panel';
    panel.dataset.panelSub = 'smtp';
    panel.innerHTML = `
      <div class="sub-panel-head">
        <span class="sub-panel-titulo">Configuración de correo saliente</span>
      </div>
      <div class="ajustes-grid">
        <div class="ajuste-campo"><label>Servidor SMTP</label><input type="text" id="smtp-host" placeholder="smtp.gmail.com"></div>
        <div class="ajuste-campo"><label>Puerto</label><input type="number" id="smtp-port" placeholder="587"></div>
        <div class="ajuste-campo"><label>Usuario</label><input type="email" id="smtp-user" placeholder="reservas@hectorinmobiliaria.com" autocomplete="off"></div>
        <div class="ajuste-campo"><label>Contraseña</label>
          <div class="input-con-icono">
            <input id="smtp-password" type="password" autocomplete="new-password">
            <button type="button" class="btn-ojo" id="smtp-ojo" title="Mostrar/ocultar">👁</button>
          </div>
        </div>
        <div class="ajuste-campo"><label>Nombre del remitente</label><input type="text" id="smtp-from-name" placeholder="Inmobiliaria Héctor"></div>
        <div class="ajuste-campo"><label>Email del remitente</label><input type="email" id="smtp-from-email" placeholder="reservas@hectorinmobiliaria.com" autocomplete="off"></div>
      </div>
      <div class="alo-em-aviso" style="max-width:640px">ℹ️ Para Gmail necesitas una contraseña de aplicación. Genérala en myaccount.google.com → Seguridad → Contraseñas de aplicaciones</div>
      <div class="modal-acciones" style="justify-content:flex-start">
        <button class="btn-pri" id="smtp-guardar">Guardar configuración</button>
        <button class="btn-sec" id="smtp-test">📧 Enviar email de prueba</button>
      </div>`;
    document.querySelector('#vista-ajustes .ajustes-scroll').appendChild(panel);

    document.getElementById('smtp-ojo').addEventListener('click', () => {
      const inp = document.getElementById('smtp-password');
      inp.type = inp.type === 'password' ? 'text' : 'password';
    });
    document.getElementById('smtp-guardar').addEventListener('click', guardarSmtp);
    document.getElementById('smtp-test').addEventListener('click', enviarPruebaSmtp);
  }

  async function cargarSmtp() {
    let cfg;
    try { cfg = await API.get('/api/ajustes/smtp'); }
    catch (e) { return toast(e.message, 'error'); }
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v != null ? v : ''; };
    set('smtp-host', cfg.smtp_host);
    set('smtp-port', cfg.smtp_port);
    set('smtp-user', cfg.smtp_user);
    set('smtp-password', cfg.smtp_password); // '••••••••' si hay guardada, '' si no
    set('smtp-from-name', cfg.smtp_from_name);
    set('smtp-from-email', cfg.smtp_from_email);
  }

  async function guardarSmtp() {
    const v = (id) => (document.getElementById(id) || {}).value || '';
    const body = {
      smtp_host: v('smtp-host'),
      smtp_port: v('smtp-port'),
      smtp_user: v('smtp-user'),
      smtp_password: v('smtp-password'), // si es la máscara, el backend conserva la anterior
      smtp_from_name: v('smtp-from-name'),
      smtp_from_email: v('smtp-from-email'),
    };
    try {
      await API.put('/api/ajustes/smtp', body);
      toast('Configuración guardada', 'ok');
      await cargarSmtp(); // re-enmascara la contraseña recién guardada
    } catch (e) { toast(e.message, 'error'); }
  }

  async function enviarPruebaSmtp() {
    const btn = document.getElementById('smtp-test');
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Enviando…';
    try {
      const r = await API.post('/api/ajustes/smtp/test', {});
      if (r && r.ok) toast('Email de prueba enviado correctamente', 'ok');
      else toast(r && r.error ? r.error : 'No se pudo enviar el email de prueba', 'error');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
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
      API.invalidarPortales();
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
      <div class="campo">
        <label>Prefijo</label>
        <input id="p-prefijo" value="${esc(portal.prefijo || '')}" placeholder="ej: CA, B, H">
        <div style="font-size:12px;color:var(--muted);margin-top:4px">Se usa para generar automáticamente los números de reserva (ej: CA-0001)</div>
      </div>
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
      const prefijo = document.getElementById('p-prefijo').value.trim();
      if (!nombre) return toast('El nombre es obligatorio', 'error');
      try {
        let id = portal.id;
        if (esNuevo) {
          const res = await API.post('/api/portales', { nombre, prefijo });
          id = res.id;
        }
        await API.put('/api/portales/' + id, { nombre, color: colorVal, activo, prefijo });
        if (archivoLogo) await subirImagenPortal(id, archivoLogo);
        API.invalidarPortales();
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
      API.invalidarPortales();
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
    for (const rs of lista) {
      const card = document.createElement('div');
      card.className = 'razon-card';
      const linea = (etq, v) => v ? `<div class="razon-dato"><span>${etq}:</span> ${esc(v)}</div>` : '';
      const logo = rs.logo_url
        ? `<img class="razon-logo" src="${esc(rs.logo_url)}" alt="" onerror="this.style.display='none'">`
        : `<span class="razon-logo-inicial" style="background:${colorAvatar(rs.razon_social)}">${esc(inicial(rs.razon_social))}</span>`;
      const esPred = !!rs.predeterminada;
      // Banner de predeterminada en una fila propia arriba de la tarjeta (no rompe la
      // alineación del título). Las no predeterminadas llevan el botón en acciones.
      const bannerPred = esPred
        ? '<div class="razon-card-pred" style="display:inline-block;background:#10b981;color:#fff;font-weight:600;padding:3px 10px;border-radius:12px;font-size:12px;white-space:nowrap;margin-bottom:10px">⭐ Predeterminada</div>'
        : '';
      const btnPred = esPred
        ? ''
        : `<button class="btn-mini" data-pred-rs="${rs.id}" title="Marcar como predeterminada">Marcar como predeterminada</button>`;
      card.innerHTML = `
        ${bannerPred}
        <div class="razon-card-head">
          <div class="razon-card-titulo">
            ${logo}
            <span class="razon-nombre">${esc(rs.razon_social) || '(sin nombre)'}</span>
          </div>
        </div>
        ${linea('CIF/NIF', rs.cif_nif)}
        ${linea('Email', rs.email_contacto)}
        ${linea('Teléfono', rs.telefono)}
        ${linea('Ciudad', rs.ciudad)}
        <div class="razon-card-acciones">
          ${btnPred}
          <button class="btn-mini" data-editar-rs="${rs.id}" title="Editar">✏️</button>
          <button class="btn-mini" data-borrar-rs="${rs.id}" title="Eliminar">🗑️</button>
        </div>`;
      cont.appendChild(card);
    }
    cont.querySelectorAll('[data-editar-rs]').forEach((b) =>
      b.addEventListener('click', () => formularioRazon(lista.find((x) => x.id == b.dataset.editarRs))));
    cont.querySelectorAll('[data-borrar-rs]').forEach((b) =>
      b.addEventListener('click', () => borrarRazon(b.dataset.borrarRs)));
    cont.querySelectorAll('[data-pred-rs]').forEach((b) =>
      b.addEventListener('click', () => marcarPredeterminada(b.dataset.predRs)));
  }

  // Marca una razón social como predeterminada (desmarca el resto en el backend).
  async function marcarPredeterminada(id) {
    try {
      await API.put('/api/ajustes/razones-sociales/' + id + '/predeterminada', {});
      await cargarRazones();
      toast('Razón social predeterminada actualizada', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function formularioRazon(rs) {
    rs = rs || {};
    const esNueva = !rs.id;
    let archivoLogo = null;                  // File pendiente de subir (se sube al guardar)
    let archivoFirma = null;                 // ídem para la firma/sello
    const logoUrlActual = rs.logo_url || null;
    const firmaUrlActual = rs.firma_url || null;
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
      <div class="ajustes-seccion-titulo">Logo</div>
      <div class="campo">
        <div id="rs-logo-zona"></div>
        <input type="file" id="rs-logo-input" accept=".jpg,.jpeg,.png,.webp,.svg" hidden>
      </div>
      <div class="ajustes-seccion-titulo">Firma y sello</div>
      <div class="campo">
        <div id="rs-firma-zona"></div>
        <input type="file" id="rs-firma-input" accept=".jpg,.jpeg,.png,.webp,.svg" hidden>
        <div class="alo-em-aviso" style="max-width:640px">ℹ️ Se inserta en el recuadro de firma del PDF del contrato (PNG o JPG)</div>
      </div>
      <div class="modal-acciones">
        <button class="btn-sec" id="rs-cancelar">Cancelar</button>
        <button class="btn-pri" id="rs-guardar">Guardar</button>
      </div>`);
    document.querySelector('.modal').classList.add('modal-ancho');

    // Zona de logo: imagen actual/preview + "Cambiar", o dropzone si no hay imagen.
    const input = document.getElementById('rs-logo-input');
    const renderZonaLogo = (previewSrc) => {
      const zona = document.getElementById('rs-logo-zona');
      const src = previewSrc || logoUrlActual;
      if (src) {
        zona.innerHTML = `<img class="razon-logo-modal" src="${esc(src)}" alt=""><button type="button" class="btn-sec" id="rs-logo-cambiar" style="margin-left:10px">Cambiar</button>`;
        zona.querySelector('#rs-logo-cambiar').addEventListener('click', () => input.click());
      } else {
        zona.innerHTML = '<div class="portal-dropzone" id="rs-dropzone"><span class="dz-icono">⬆</span><span>Subir logo</span></div>';
        const dz = zona.querySelector('#rs-dropzone');
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

    // Zona de firma/sello: misma mecánica que el logo.
    const inputFirma = document.getElementById('rs-firma-input');
    const renderZonaFirma = (previewSrc) => {
      const zona = document.getElementById('rs-firma-zona');
      const src = previewSrc || firmaUrlActual;
      if (src) {
        zona.innerHTML = `<img class="razon-logo-modal" src="${esc(src)}" alt=""><button type="button" class="btn-sec" id="rs-firma-cambiar" style="margin-left:10px">Cambiar</button>`;
        zona.querySelector('#rs-firma-cambiar').addEventListener('click', () => inputFirma.click());
      } else {
        zona.innerHTML = '<div class="portal-dropzone" id="rs-firma-dropzone"><span class="dz-icono">⬆</span><span>Subir firma/sello</span></div>';
        const dz = zona.querySelector('#rs-firma-dropzone');
        dz.addEventListener('click', () => inputFirma.click());
        ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('dz-activo'); }));
        ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('dz-activo'); }));
        dz.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) seleccionarFirma(f); });
      }
    };
    const seleccionarFirma = (file) => {
      archivoFirma = file;
      const reader = new FileReader();
      reader.onload = () => renderZonaFirma(reader.result);
      reader.readAsDataURL(file);
    };
    inputFirma.addEventListener('change', () => { if (inputFirma.files[0]) seleccionarFirma(inputFirma.files[0]); });
    renderZonaFirma(null);

    document.getElementById('rs-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('rs-guardar').addEventListener('click', async () => {
      const body = {};
      document.querySelectorAll('#modal-contenido [data-rs]').forEach((el) => { body[el.dataset.rs] = el.value; });
      try {
        let id = rs.id;
        if (esNueva) { const res = await API.post('/api/ajustes/razones-sociales', body); id = res.id; }
        else await API.put('/api/ajustes/razones-sociales/' + id, body);
        if (archivoLogo) await subirLogoRazon(id, archivoLogo);
        if (archivoFirma) await subirFirmaRazon(id, archivoFirma);
        cerrarModal();
        await cargarRazones();
        toast('Razón social guardada', 'ok');
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  // Sube la firma/sello de una razón social (campo "firma", igual patrón que el logo).
  async function subirFirmaRazon(id, file) {
    const fd = new FormData();
    fd.append('firma', file);
    const s = Auth.sesion() || {};
    const r = await fetch('/api/ajustes/razones-sociales/' + id + '/firma', {
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

  // Sube el logo de una razón social (campo "logo", igual patrón que los portales).
  async function subirLogoRazon(id, file) {
    const fd = new FormData();
    fd.append('logo', file);
    const s = Auth.sesion() || {};
    const r = await fetch('/api/ajustes/razones-sociales/' + id + '/logo', {
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
            <option value="limpieza"${u.rol === 'limpieza' ? ' selected' : ''}>Limpieza</option>
            <option value="mantenimiento"${u.rol === 'mantenimiento' ? ' selected' : ''}>Mantenimiento</option>
          </select>
          <div id="u-rol-desc" class="u-rol-desc${ROL_DESC[u.rol] ? '' : ' oculto'}">${ROL_DESC[u.rol] || ''}</div>
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
    document.getElementById('u-rol').addEventListener('change', (e) => {
      const desc = ROL_DESC[e.target.value] || '';
      const el = document.getElementById('u-rol-desc');
      el.textContent = desc;
      el.classList.toggle('oculto', !desc);
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
  // ==================== Planning (asignación de apartamentos a portales) ====================
  let planningAptos = []; // todos los apartamentos (con portal_id y portal_nombre)

  function inyectarPlanning() {
    if (document.querySelector('#ajustes-subtabs [data-sub="planning"]')) return;
    const subtabs = document.getElementById('ajustes-subtabs');
    const btn = document.createElement('button');
    btn.className = 'subtab';
    btn.dataset.sub = 'planning';
    btn.textContent = 'Planning 📅';
    subtabs.appendChild(btn);

    const panel = document.createElement('div');
    panel.className = 'sub-panel';
    panel.dataset.panelSub = 'planning';
    panel.innerHTML = `
      <div class="sub-panel-head">
        <span class="sub-panel-titulo">Apartamentos por portal</span>
      </div>
      <p class="sub-vacio" style="margin:0 0 14px">Asigna cada apartamento a un portal para poder filtrarlos en el Planning.</p>
      <div id="planning-secciones"></div>`;
    document.querySelector('#vista-ajustes .ajustes-scroll').appendChild(panel);
  }

  async function cargarPlanning() {
    try { planningAptos = await API.get('/api/apartamentos?todos=1'); }
    catch (e) { return toast(e.message, 'error'); }
    renderPlanning();
  }

  function logoPortal(p) {
    return p.imagen_url
      ? `<img class="portal-logo-mini" src="${esc(p.imagen_url)}" alt="">`
      : `<span class="portal-logo-inicial" style="background:${esc(p.color) || '#3b82f6'}">${esc(inicial(p.nombre))}</span>`;
  }

  function chipApto(a, portalId) {
    // portalId null => chip de "sin portal" (sin botón de quitar).
    const quitar = portalId != null
      ? `<button class="plan-chip-x" data-quitar="${a.id}" title="Desasignar">✕</button>` : '';
    return `<span class="plan-chip">${esc(a.nombre)}${quitar}</span>`;
  }

  function renderPlanning() {
    const cont = document.getElementById('planning-secciones');
    if (!cont) return;
    const activos = portalesLista.filter((p) => p.activo);
    let html = '';

    activos.forEach((p) => {
      const aptos = planningAptos.filter((a) => a.portal_id === p.id);
      html += `
        <div class="plan-seccion">
          <div class="plan-seccion-head">
            <span class="plan-portal-nombre">${logoPortal(p)} ${esc(p.nombre)}</span>
            <span class="plan-contador">${aptos.length}</span>
            <button class="btn-sec plan-asignar" data-portal="${p.id}">＋ Asignar apartamentos</button>
          </div>
          <div class="plan-chips">
            ${aptos.length ? aptos.map((a) => chipApto(a, p.id)).join('') : '<span class="sub-vacio">Ningún apartamento asignado.</span>'}
          </div>
        </div>`;
    });

    // Sección "Sin portal".
    const sinPortal = planningAptos.filter((a) => a.portal_id == null);
    html += `
      <div class="plan-seccion plan-seccion-sin">
        <div class="plan-seccion-head">
          <span class="plan-portal-nombre">Sin portal</span>
          <span class="plan-contador">${sinPortal.length}</span>
        </div>
        <div class="plan-chips">
          ${sinPortal.length ? sinPortal.map((a) => chipApto(a, null)).join('') : '<span class="sub-vacio">Todos los apartamentos tienen portal.</span>'}
        </div>
      </div>`;

    cont.innerHTML = html;
    cont.querySelectorAll('[data-portal]').forEach((b) =>
      b.addEventListener('click', () => modalAsignarPortal(Number(b.dataset.portal))));
    cont.querySelectorAll('[data-quitar]').forEach((b) =>
      b.addEventListener('click', () => desasignarPortal(Number(b.dataset.quitar))));
  }

  function modalAsignarPortal(portalId) {
    const portal = portalesLista.find((p) => p.id === portalId);
    if (!portal) return;
    const disponibles = planningAptos.filter((a) => a.portal_id == null);
    abrirModal(`
      <h3>Asignar apartamentos a ${esc(portal.nombre)}</h3>
      ${disponibles.length
        ? `<input type="text" id="plan-buscar" class="input-buscar" placeholder="Buscar apartamento..." style="margin-bottom:10px;width:100%;box-sizing:border-box">
           <div class="plan-check-lista">
             ${disponibles.map((a) => `
               <label class="plan-check" data-nombre="${esc(a.nombre.toLowerCase())}"><input type="checkbox" value="${a.id}"> ${esc(a.nombre)}${a.edificio ? ` <span class="sub-vacio">(${esc(a.edificio)})</span>` : ''}</label>`).join('')}
           </div>`
        : '<p class="sub-vacio">No hay apartamentos sin portal asignado.</p>'}
      <div class="modal-acciones">
        <button class="btn-sec" id="plan-cancelar">Cancelar</button>
        ${disponibles.length ? '<button class="btn-pri" id="plan-guardar">Asignar</button>' : ''}
      </div>`);
    document.getElementById('plan-cancelar').addEventListener('click', cerrarModal);
    const buscar = document.getElementById('plan-buscar');
    if (buscar) buscar.addEventListener('input', () => {
      const q = buscar.value.trim().toLowerCase();
      document.querySelectorAll('.plan-check-lista .plan-check').forEach((l) => {
        l.style.display = l.dataset.nombre.includes(q) ? '' : 'none';
      });
    });
    const guardar = document.getElementById('plan-guardar');
    if (guardar) guardar.addEventListener('click', () => guardarAsignacion(portalId));
  }

  async function guardarAsignacion(portalId) {
    const ids = Array.from(document.querySelectorAll('.plan-check input:checked')).map((c) => Number(c.value));
    if (!ids.length) return toast('Selecciona al menos un apartamento', 'error');
    const btn = document.getElementById('plan-guardar');
    btn.disabled = true;
    try {
      for (const id of ids) await API.put('/api/apartamentos/' + id, { portal_id: portalId });
      cerrarModal();
      await cargarPlanning();
      toast(`${ids.length} apartamento${ids.length === 1 ? '' : 's'} asignado${ids.length === 1 ? '' : 's'}`, 'ok');
    } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
  }

  async function desasignarPortal(aptoId) {
    try {
      await API.put('/api/apartamentos/' + aptoId, { portal_id: null });
      await cargarPlanning();
      toast('Apartamento desasignado', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  }

  function init() {
    inyectarPortales();        // 4ª sub-pestaña (antes de enlazar los clics)
    inyectarCatalogoGastos();  // 5ª sub-pestaña
    inyectarCatalogoExtras();  // 6ª sub-pestaña
    inyectarEstadosReserva();  // 7ª sub-pestaña
    inyectarSmtp();            // 8ª sub-pestaña (solo admin)
    inyectarPlanning();        // 9ª sub-pestaña
    document.querySelectorAll('#ajustes-subtabs .subtab').forEach((b) =>
      b.addEventListener('click', () => activarSub(b.dataset.sub)));
    document.getElementById('btn-nueva-razon').addEventListener('click', () => formularioRazon(null));
    document.getElementById('btn-nuevo-usuario').addEventListener('click', () => formularioUsuario(null));
    document.getElementById('filtro-act-usuario').addEventListener('change', refrescarActividad);
    document.getElementById('filtro-act-accion').addEventListener('change', refrescarActividad);
  }

  return { init, cargar };
})();
