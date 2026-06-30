// Módulo Extras: inventario de objetos prestables (cunas, tronas, ventiladores...) con
// stock y movimientos de préstamo/devolución por apartamento. Sub-pestañas Inventario /
// Préstamos / Categorías. IIFE `ExtrasInventario`. UI mobile-first, clases `ext-*`.
const ExtrasInventario = (() => {
  let categorias = [];
  let items = [];
  let apartamentos = [];
  let movimientos = [];
  let catFiltro = '';            // '' = todas
  let movFiltroItem = '';
  let movFiltroApto = '';

  const esAdmin = () => (typeof Auth !== 'undefined') && Auth.esAdmin && Auth.esAdmin();

  // ---- Init / navegación de sub-pestañas ----
  function init() {
    document.querySelectorAll('#ext-subtabs .subtab').forEach((b) =>
      b.addEventListener('click', () => activarSub(b.dataset.sub)));
  }

  function activarSub(sub) {
    document.querySelectorAll('#ext-subtabs .subtab').forEach((b) =>
      b.classList.toggle('activo', b.dataset.sub === sub));
    document.querySelectorAll('#vista-extras .sub-panel').forEach((p) =>
      p.classList.toggle('activo', p.dataset.panelSub === sub));
    if (sub === 'inventario') renderInventario();
    if (sub === 'prestamos') cargarMovimientos();
    if (sub === 'categorias') renderCategorias();
  }

  // ---- Carga ----
  async function cargar() {
    try {
      [categorias, items, apartamentos] = await Promise.all([
        API.get('/api/extras/categorias'),
        API.get('/api/extras/items'),
        API.get('/api/apartamentos?todos=1'),
      ]);
      await cargarResumen();
      renderInventario();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function recargarItems() {
    try { items = await API.get('/api/extras/items' + (catFiltro ? '?categoria_id=' + catFiltro : '')); }
    catch (e) { return toast(e.message, 'error'); }
    await cargarResumen();
    renderInventario();
  }

  async function cargarResumen() {
    let r;
    try { r = await API.get('/api/extras/resumen'); } catch (e) { return; }
    const cont = document.getElementById('ext-resumen');
    if (!cont) return;
    cont.innerHTML = `
      <div class="ext-mini"><span class="ext-mini-num">${r.total_items}</span><span class="ext-mini-lbl">Artículos</span></div>
      <div class="ext-mini"><span class="ext-mini-num">${r.prestados_ahora}</span><span class="ext-mini-lbl">En préstamo</span></div>
      <div class="ext-mini"><span class="ext-mini-num">${r.categorias_con_items}</span><span class="ext-mini-lbl">Categorías con artículos</span></div>`;
  }

  // ==================== Inventario ====================
  function renderInventario() {
    const panel = document.getElementById('ext-panel-inventario');
    if (!panel) return;
    const opts = '<option value="">Todas las categorías</option>' +
      categorias.map((c) => `<option value="${c.id}"${String(c.id) === catFiltro ? ' selected' : ''}>${esc(c.icono)} ${esc(c.nombre)}</option>`).join('');
    const filas = items.length ? items.map(filaItem).join('') :
      '<tr><td colspan="6" class="ext-vacio">Sin artículos. Crea el primero con “＋ Nuevo artículo”.</td></tr>';
    panel.innerHTML = `
      <div class="barra-herramientas ext-barra">
        <select id="ext-cat-filtro" class="input-buscar">${opts}</select>
        <button id="ext-nuevo-item" class="btn-pri">＋ Nuevo artículo</button>
      </div>
      <div class="tabla-scroll">
        <table class="tabla">
          <thead><tr><th>Artículo</th><th>Categoría</th><th>Stock</th><th>Disponible</th><th>Ubicaciones</th><th></th></tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>`;
    document.getElementById('ext-cat-filtro').addEventListener('change', (e) => {
      catFiltro = e.target.value; recargarItems();
    });
    document.getElementById('ext-nuevo-item').addEventListener('click', () => modalItem(null));
    panel.querySelectorAll('[data-prestar]').forEach((b) => b.addEventListener('click', () => modalMovimiento(b.dataset.prestar, 'prestamo')));
    panel.querySelectorAll('[data-devolver]').forEach((b) => b.addEventListener('click', () => modalMovimiento(b.dataset.devolver, 'devolucion')));
    panel.querySelectorAll('[data-editar-item]').forEach((b) => b.addEventListener('click', () => modalItem(items.find((i) => i.id == b.dataset.editarItem))));
    panel.querySelectorAll('[data-borrar-item]').forEach((b) => b.addEventListener('click', () => borrarItem(b.dataset.borrarItem)));
    panel.querySelectorAll('[data-hist-item]').forEach((b) => b.addEventListener('click', () => modalHistorial(b.dataset.histItem)));
  }

  function filaItem(it) {
    const stock = it.stock_total == null ? '<span class="ext-badge-ilim">Ilimitado</span>' : it.stock_total;
    let disp;
    if (it.stock_total == null) disp = '<span class="ext-badge-ilim">Ilimitado</span>';
    else {
      const cls = it.disponible <= 0 ? 'ext-disp-cero' : (it.disponible < it.stock_total ? 'ext-disp-bajo' : 'ext-disp-ok');
      disp = `<span class="${cls}">${it.disponible}</span>`;
    }
    const ubic = (it.ubicaciones || []).length
      ? it.ubicaciones.map((u) => `<span class="ext-ubic">${esc(u.apartamento_nombre || '—')} ×${u.cantidad}</span>`).join(' ')
      : '<span class="ext-ubic-vacio">—</span>';
    const cat = it.categoria_id ? `${esc(it.categoria_icono || '📦')} ${esc(it.categoria_nombre || '')}` : '<span class="ext-ubic-vacio">—</span>';
    return `
      <tr>
        <td><strong>${esc(it.nombre)}</strong>${it.descripcion ? `<div class="ext-desc">${esc(it.descripcion)}</div>` : ''}</td>
        <td>${cat}</td>
        <td>${stock}</td>
        <td>${disp}</td>
        <td>${ubic}</td>
        <td class="acciones ext-acciones">
          <button class="btn-mini ext-btn-prestar" data-prestar="${it.id}" title="Prestar">📤 Prestar</button>
          <button class="btn-mini ext-btn-devolver" data-devolver="${it.id}" title="Devolver">📥 Devolver</button>
          <button class="btn-mini" data-hist-item="${it.id}" title="Historial">🕑</button>
          <button class="btn-mini" data-editar-item="${it.id}" title="Editar">✏️</button>
          <button class="btn-mini" data-borrar-item="${it.id}" title="Eliminar">🗑️</button>
        </td>
      </tr>`;
  }

  function modalItem(it) {
    it = it || {};
    const esNuevo = !it.id;
    const catOpts = '<option value="">— Sin categoría —</option>' +
      categorias.map((c) => `<option value="${c.id}"${it.categoria_id == c.id ? ' selected' : ''}>${esc(c.icono)} ${esc(c.nombre)}</option>`).join('');
    abrirModal(`
      <h3>${esNuevo ? 'Nuevo' : 'Editar'} artículo</h3>
      <div class="campo"><label>Nombre *</label><input id="ext-it-nombre" value="${esc(it.nombre) || ''}"></div>
      <div class="campo"><label>Categoría</label><select id="ext-it-cat">${catOpts}</select></div>
      <div class="campo"><label>Stock total</label><input type="number" min="0" id="ext-it-stock" value="${it.stock_total != null ? it.stock_total : ''}" placeholder="Vacío = ilimitado"></div>
      <div class="campo"><label>Descripción</label><textarea id="ext-it-desc">${esc(it.descripcion) || ''}</textarea></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="ext-it-cancelar">Cancelar</button>
        <button class="btn-pri" id="ext-it-guardar">Guardar</button>
      </div>`);
    document.getElementById('ext-it-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('ext-it-guardar').addEventListener('click', async () => {
      const nombre = document.getElementById('ext-it-nombre').value.trim();
      if (!nombre) return toast('El nombre es obligatorio', 'error');
      const stockRaw = document.getElementById('ext-it-stock').value.trim();
      const body = {
        nombre,
        categoria_id: document.getElementById('ext-it-cat').value || null,
        stock_total: stockRaw === '' ? '' : Number(stockRaw),
        descripcion: document.getElementById('ext-it-desc').value.trim(),
      };
      try {
        if (esNuevo) await API.post('/api/extras/items', body);
        else await API.put('/api/extras/items/' + it.id, body);
        cerrarModal();
        await recargarItems();
        toast('Artículo guardado', 'ok');
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  async function borrarItem(id) {
    const it = items.find((x) => x.id == id);
    if (!confirm(`¿Eliminar el artículo "${it ? it.nombre : id}"? Se borrará también su historial.`)) return;
    try {
      await API.del('/api/extras/items/' + id);
      await recargarItems();
      toast('Artículo eliminado', 'ok');
    } catch (err) {
      if (err.status === 409) toast(err.message, 'error');
      else toast(err.message, 'error');
    }
  }

  // Typeahead de apartamento dentro de un modal abierto. Busca por nombre al escribir 2+
  // caracteres y llama onSelect(id) al elegir. Devuelve un getter del id seleccionado.
  // Reutiliza las clases globales .mant-ta / .mant-ta-res / .mant-ta-item (ya estiladas).
  function montarTypeaheadApto(inputId, resId) {
    let seleccionado = null;
    const inp = document.getElementById(inputId);
    const res = document.getElementById(resId);
    if (!inp || !res) return () => null;
    const render = () => {
      const t = inp.value.trim().toLowerCase();
      if (t.length < 2) { res.classList.add('oculto'); res.innerHTML = ''; return; }
      const lista = apartamentos.filter((a) => (a.nombre || '').toLowerCase().includes(t)).slice(0, 8);
      if (!lista.length) { res.classList.add('oculto'); res.innerHTML = ''; return; }
      res.innerHTML = lista.map((a) => `<div class="mant-ta-item" data-ap="${a.id}">${esc(a.nombre)}</div>`).join('');
      res.classList.remove('oculto');
      res.querySelectorAll('.mant-ta-item').forEach((el) =>
        el.addEventListener('click', () => {
          seleccionado = Number(el.dataset.ap);
          const a = apartamentos.find((x) => x.id === seleccionado);
          inp.value = a ? a.nombre : '';
          res.classList.add('oculto');
        }));
    };
    inp.addEventListener('input', () => { seleccionado = null; render(); });
    inp.addEventListener('focus', render);
    document.getElementById('modal-contenido')?.addEventListener('click', (e) => {
      if (!e.target.closest('.mant-ta')) res.classList.add('oculto');
    });
    return () => seleccionado;
  }

  // Modal de préstamo o devolución de un artículo.
  function modalMovimiento(itemId, tipo) {
    const it = items.find((x) => x.id == itemId);
    const esPrestamo = tipo === 'prestamo';
    const hoy = new Date().toISOString().slice(0, 10);
    const dispTxt = it && it.stock_total != null ? ` (disponible: ${it.disponible})` : '';
    abrirModal(`
      <h3>${esPrestamo ? '📤 Prestar' : '📥 Devolver'} — ${esc(it ? it.nombre : '')}</h3>
      <div class="fila-campos">
        <div class="campo"><label>Cantidad *${dispTxt}</label><input type="number" min="1" id="ext-mv-cant" value="1"></div>
        <div class="campo"><label>Fecha</label><input type="date" id="ext-mv-fecha" value="${hoy}"></div>
      </div>
      <div class="campo mant-ta">
        <label>Apartamento</label>
        <input id="ext-mv-apto-input" class="input-buscar" autocomplete="off" placeholder="Escribe para buscar...">
        <div id="ext-mv-apto-res" class="mant-ta-res oculto"></div>
      </div>
      <div class="campo"><label>Notas</label><textarea id="ext-mv-notas"></textarea></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="ext-mv-cancelar">Cancelar</button>
        <button class="btn-pri" id="ext-mv-guardar">${esPrestamo ? 'Prestar' : 'Devolver'}</button>
      </div>`);
    const getApto = montarTypeaheadApto('ext-mv-apto-input', 'ext-mv-apto-res');
    document.getElementById('ext-mv-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('ext-mv-guardar').addEventListener('click', async () => {
      const cantidad = Number(document.getElementById('ext-mv-cant').value) || 0;
      if (cantidad < 1) return toast('La cantidad debe ser ≥ 1', 'error');
      const body = {
        item_id: itemId, tipo, cantidad,
        apartamento_id: getApto() || null,
        fecha: document.getElementById('ext-mv-fecha').value || null,
        notas: document.getElementById('ext-mv-notas').value.trim(),
      };
      try {
        await API.post('/api/extras/movimientos', body);
        cerrarModal();
        await recargarItems();
        if (document.querySelector('#ext-subtabs .subtab[data-sub="prestamos"].activo')) cargarMovimientos();
        toast(esPrestamo ? 'Préstamo registrado' : 'Devolución registrada', 'ok');
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  async function modalHistorial(itemId) {
    let it;
    try { it = await API.get('/api/extras/items/' + itemId); } catch (e) { return toast(e.message, 'error'); }
    const movs = (it.movimientos || []).map((m) => {
      const destino = m.apartamento_nombre || (m.numero_reserva ? 'Reserva ' + m.numero_reserva : '—');
      const tipoBadge = m.tipo === 'prestamo'
        ? '<span class="ext-badge-prestamo">Préstamo</span>'
        : '<span class="ext-badge-devolucion">Devolución</span>';
      return `<tr><td>${fechaES(m.fecha)}</td><td>${tipoBadge}</td><td>×${m.cantidad}</td><td>${esc(destino)}</td><td>${esc(m.created_by) || '—'}</td><td>${esc(m.notas) || ''}</td></tr>`;
    }).join('') || '<tr><td colspan="6" class="ext-vacio">Sin movimientos.</td></tr>';
    abrirModal(`
      <h3>Historial — ${esc(it.nombre)}</h3>
      <div class="tabla-scroll" style="max-height:50vh">
        <table class="tabla">
          <thead><tr><th>Fecha</th><th>Tipo</th><th>Cant.</th><th>Apartamento/Reserva</th><th>Por</th><th>Notas</th></tr></thead>
          <tbody>${movs}</tbody>
        </table>
      </div>
      <div class="modal-acciones"><button class="btn-sec" id="ext-hist-cerrar">Cerrar</button></div>`);
    document.getElementById('ext-hist-cerrar').addEventListener('click', cerrarModal);
  }

  // ==================== Préstamos (movimientos) ====================
  async function cargarMovimientos() {
    const params = [];
    if (movFiltroItem) params.push('item_id=' + movFiltroItem);
    if (movFiltroApto) params.push('apartamento_id=' + movFiltroApto);
    try { movimientos = await API.get('/api/extras/movimientos' + (params.length ? '?' + params.join('&') : '')); }
    catch (e) { return toast(e.message, 'error'); }
    renderMovimientos();
  }

  function renderMovimientos() {
    const panel = document.getElementById('ext-panel-prestamos');
    if (!panel) return;
    const itemOpts = '<option value="">Todos los artículos</option>' +
      items.map((i) => `<option value="${i.id}"${String(i.id) === movFiltroItem ? ' selected' : ''}>${esc(i.nombre)}</option>`).join('');
    const aptoOpts = '<option value="">Todos los apartamentos</option>' +
      apartamentos.map((a) => `<option value="${a.id}"${String(a.id) === movFiltroApto ? ' selected' : ''}>${esc(a.nombre)}</option>`).join('');
    const filas = movimientos.length ? movimientos.map((m) => {
      const destino = m.apartamento_nombre || (m.numero_reserva ? 'Reserva ' + m.numero_reserva : '—');
      const tipoBadge = m.tipo === 'prestamo'
        ? '<span class="ext-badge-prestamo">Préstamo</span>'
        : '<span class="ext-badge-devolucion">Devolución</span>';
      const borrar = esAdmin() ? `<button class="btn-mini" data-borrar-mov="${m.id}" title="Eliminar">🗑️</button>` : '';
      return `<tr><td>${fechaES(m.fecha)}</td><td><strong>${esc(m.item_nombre)}</strong></td><td>${tipoBadge}</td><td>×${m.cantidad}</td><td>${esc(destino)}</td><td>${esc(m.created_by) || '—'}</td><td>${esc(m.notas) || ''}</td><td class="acciones">${borrar}</td></tr>`;
    }).join('') : '<tr><td colspan="8" class="ext-vacio">Sin movimientos.</td></tr>';
    panel.innerHTML = `
      <div class="barra-herramientas ext-barra">
        <select id="ext-mov-fitem" class="input-buscar">${itemOpts}</select>
        <select id="ext-mov-fapto" class="input-buscar">${aptoOpts}</select>
        <button id="ext-mov-nuevo" class="btn-pri">＋ Registrar movimiento</button>
      </div>
      <div class="tabla-scroll">
        <table class="tabla">
          <thead><tr><th>Fecha</th><th>Artículo</th><th>Tipo</th><th>Cant.</th><th>Apartamento/Reserva</th><th>Por</th><th>Notas</th><th></th></tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>`;
    document.getElementById('ext-mov-fitem').addEventListener('change', (e) => { movFiltroItem = e.target.value; cargarMovimientos(); });
    document.getElementById('ext-mov-fapto').addEventListener('change', (e) => { movFiltroApto = e.target.value; cargarMovimientos(); });
    document.getElementById('ext-mov-nuevo').addEventListener('click', modalMovimientoLibre);
    panel.querySelectorAll('[data-borrar-mov]').forEach((b) => b.addEventListener('click', () => borrarMovimiento(b.dataset.borrarMov)));
  }

  // Registrar un movimiento eligiendo el artículo (desde la pestaña Préstamos).
  function modalMovimientoLibre() {
    const itemOpts = '<option value="">— Artículo —</option>' +
      items.map((i) => `<option value="${i.id}">${esc(i.nombre)}</option>`).join('');
    const aptoOpts = '<option value="">— Apartamento —</option>' +
      apartamentos.map((a) => `<option value="${a.id}">${esc(a.nombre)}</option>`).join('');
    const hoy = new Date().toISOString().slice(0, 10);
    abrirModal(`
      <h3>Registrar movimiento</h3>
      <div class="campo"><label>Artículo *</label><select id="ext-mvl-item">${itemOpts}</select></div>
      <div class="campo"><label>Tipo *</label>
        <select id="ext-mvl-tipo"><option value="prestamo">📤 Préstamo</option><option value="devolucion">📥 Devolución</option></select>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Cantidad *</label><input type="number" min="1" id="ext-mvl-cant" value="1"></div>
        <div class="campo"><label>Fecha</label><input type="date" id="ext-mvl-fecha" value="${hoy}"></div>
      </div>
      <div class="campo"><label>Apartamento</label><select id="ext-mvl-apto">${aptoOpts}</select></div>
      <div class="campo"><label>Notas</label><textarea id="ext-mvl-notas"></textarea></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="ext-mvl-cancelar">Cancelar</button>
        <button class="btn-pri" id="ext-mvl-guardar">Registrar</button>
      </div>`);
    document.getElementById('ext-mvl-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('ext-mvl-guardar').addEventListener('click', async () => {
      const itemId = document.getElementById('ext-mvl-item').value;
      if (!itemId) return toast('Elige un artículo', 'error');
      const cantidad = Number(document.getElementById('ext-mvl-cant').value) || 0;
      if (cantidad < 1) return toast('La cantidad debe ser ≥ 1', 'error');
      const body = {
        item_id: itemId,
        tipo: document.getElementById('ext-mvl-tipo').value,
        cantidad,
        apartamento_id: document.getElementById('ext-mvl-apto').value || null,
        fecha: document.getElementById('ext-mvl-fecha').value || null,
        notas: document.getElementById('ext-mvl-notas').value.trim(),
      };
      try {
        await API.post('/api/extras/movimientos', body);
        cerrarModal();
        await recargarItems();
        cargarMovimientos();
        toast('Movimiento registrado', 'ok');
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  async function borrarMovimiento(id) {
    if (!confirm('¿Eliminar este movimiento? Recalculará el stock.')) return;
    try {
      await API.del('/api/extras/movimientos/' + id);
      await recargarItems();
      cargarMovimientos();
      toast('Movimiento eliminado', 'ok');
    } catch (err) { toast(err.message, 'error'); }
  }

  // ==================== Categorías ====================
  async function renderCategorias() {
    try { categorias = await API.get('/api/extras/categorias'); } catch (e) { return toast(e.message, 'error'); }
    const panel = document.getElementById('ext-panel-categorias');
    if (!panel) return;
    const filas = categorias.length ? categorias.map((c) => `
      <tr>
        <td style="font-size:18px">${esc(c.icono)}</td>
        <td><strong>${esc(c.nombre)}</strong></td>
        <td>${c.num_items}</td>
        <td class="acciones">
          <button class="btn-mini" data-editar-cat="${c.id}" title="Editar">✏️</button>
          ${c.num_items ? '' : `<button class="btn-mini" data-borrar-cat="${c.id}" title="Eliminar">🗑️</button>`}
        </td>
      </tr>`).join('') : '<tr><td colspan="4" class="ext-vacio">Sin categorías.</td></tr>';
    panel.innerHTML = `
      <div class="barra-herramientas ext-barra">
        <button id="ext-cat-nueva" class="btn-pri">＋ Nueva categoría</button>
      </div>
      <div class="tabla-scroll">
        <table class="tabla">
          <thead><tr><th>Icono</th><th>Nombre</th><th>Artículos</th><th></th></tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>`;
    document.getElementById('ext-cat-nueva').addEventListener('click', () => modalCategoria(null));
    panel.querySelectorAll('[data-editar-cat]').forEach((b) => b.addEventListener('click', () => modalCategoria(categorias.find((c) => c.id == b.dataset.editarCat))));
    panel.querySelectorAll('[data-borrar-cat]').forEach((b) => b.addEventListener('click', () => borrarCategoria(b.dataset.borrarCat)));
  }

  function modalCategoria(c) {
    c = c || {};
    const esNuevo = !c.id;
    abrirModal(`
      <h3>${esNuevo ? 'Nueva' : 'Editar'} categoría</h3>
      <div class="fila-campos">
        <div class="campo" style="max-width:90px"><label>Icono</label><input id="ext-cat-icono" value="${esc(c.icono) || '📦'}" maxlength="4"></div>
        <div class="campo"><label>Nombre *</label><input id="ext-cat-nombre" value="${esc(c.nombre) || ''}"></div>
      </div>
      <div class="modal-acciones">
        <button class="btn-sec" id="ext-cat-cancelar">Cancelar</button>
        <button class="btn-pri" id="ext-cat-guardar">Guardar</button>
      </div>`);
    document.getElementById('ext-cat-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('ext-cat-guardar').addEventListener('click', async () => {
      const nombre = document.getElementById('ext-cat-nombre').value.trim();
      if (!nombre) return toast('El nombre es obligatorio', 'error');
      const body = { nombre, icono: document.getElementById('ext-cat-icono').value.trim() || '📦' };
      try {
        if (esNuevo) await API.post('/api/extras/categorias', body);
        else await API.put('/api/extras/categorias/' + c.id, body);
        cerrarModal();
        await renderCategorias();
        await cargarResumen();
        toast('Categoría guardada', 'ok');
      } catch (err) {
        if (err.status === 409) toast('Ya existe una categoría con ese nombre', 'error');
        else toast(err.message, 'error');
      }
    });
  }

  async function borrarCategoria(id) {
    const c = categorias.find((x) => x.id == id);
    if (!confirm(`¿Eliminar la categoría "${c ? c.nombre : id}"?`)) return;
    try {
      await API.del('/api/extras/categorias/' + id);
      await renderCategorias();
      toast('Categoría eliminada', 'ok');
    } catch (err) { toast(err.message, 'error'); }
  }

  return { init, cargar, abrirFicha: modalHistorial };
})();
