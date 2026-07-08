// Módulo Ventas (inmobiliaria). Resumen + sub-pestañas Propiedades y Clientes
// (tabla con filtros, ficha en panel lateral, alta/edición; importación de Idealista
// en Propiedades; sugerencias y programación de visitas en Clientes). Visitas: placeholder.

const Ventas = (() => {
  let propiedades = [];        // propiedades cargadas
  let fichaActual = null;      // propiedad abierta en el panel
  let busqueda = '';
  let subSel = [];             // File pendiente en el modal de importar

  function esAdmin() { return (((typeof Auth !== 'undefined' && Auth.sesion && Auth.sesion()) || {}).rol) === 'administrador'; }

  // Filtros de la sub-pestaña Propiedades.
  const ESTADOS = ['Disponible', 'Reservada', 'Vendida', 'Retirada'];
  // Las Vendidas viven en la sub-pestaña "Vendidos"; no se filtran ni listan aquí.
  const ESTADOS_FILTRO = ['Disponible', 'Reservada', 'Retirada'];
  const TIPOS = ['Piso', 'Ático', 'Casa', 'Villa', 'Otros'];
  let fEstado = new Set(ESTADOS_FILTRO);
  let fTipo = new Set();        // vacío = todos los tipos
  let fPrecioMin = '';
  let fPrecioMax = '';
  let fDorm = '';              // '', '1','2','3','4' (4 = 4+)

  // Estado de la sub-pestaña Clientes.
  const ESTADOS_CLI = ['Nuevo', 'Contactado', 'Visitado', 'En negociación', 'Compró', 'Descartado'];
  const TIPOS_CLI = ['Piso', 'Ático', 'Casa', 'Villa'];
  let clientes = [];
  let clienteFicha = null;     // cliente abierto en el panel
  let cliConstruido = false;
  let cliBusqueda = '';
  let fEstadoCli = new Set(ESTADOS_CLI);
  let fTipoCli = new Set();     // vacío = todos
  let fPresMin = '';
  let fPresMax = '';

  // Estado de la sub-pestaña Propietarios (cartera de ventas).
  let propvent = [];           // propietarios de venta cargados
  let prvFicha = null;         // propietario abierto en el panel
  let prvConstruido = false;
  let prvBusqueda = '';
  let prvCache = [];           // caché para el typeahead del modal de propiedad
  let prvCacheOk = false;
  let vfPropVentaId = null;    // propietario_venta_id seleccionado en el modal de propiedad
  let autConstruido = false;   // sub-pestaña Arras ya construida
  let autPrv = [];             // propietarios de venta (typeahead vendedor)
  let autCli = [];             // clientes compradores (typeahead comprador)
  let autProps = [];           // propiedades de venta (typeahead inmueble)
  let autvConstruido = false;  // sub-pestaña Autorización ya construida
  let autvRazones = [];        // razones sociales (select)
  let facturasCache = null;    // caché de /api/facturas para el modal de asignar comisión

  // ==================== Helpers ====================
  function euro(n) {
    if (n === null || n === undefined || n === '') return '—';
    const v = Math.round(Number(n));
    if (!isFinite(v)) return '—';
    return v.toLocaleString('de-DE') + ' €';
  }
  function estadoBadge(e) {
    const map = {
      Disponible: 'vta-bdg-disp', Reservada: 'vta-bdg-res',
      Vendida: 'vta-bdg-vend', Retirada: 'vta-bdg-ret',
    };
    return `<span class="vta-bdg ${map[e] || 'vta-bdg-ret'}">${esc(e || '—')}</span>`;
  }
  function textoFacEstado(e) {
    return { borrador: 'Borrador', emitida: 'Emitida', parcialmente_pagada: 'Parcialmente pagada', pagada: 'Pagada', anulada: 'Anulada' }[e] || e || '—';
  }
  function badgeFacEstado(e) {
    if (!e) return '';
    return `<span class="badge-fac-estado be-${e}">${textoFacEstado(e)}</span>`;
  }
  // Aviso si comprador + vendedor no cuadra con el total de comisión (margen 0.01 por redondeo).
  function comisionAvisoHTML(totalV, compV, vendV) {
    const total = totalV === '' || totalV === null || totalV === undefined ? null : parseFloat(totalV);
    if (total === null || isNaN(total)) return '';
    const comp = parseFloat(compV) || 0;
    const vend = parseFloat(vendV) || 0;
    const suma = comp + vend;
    const diff = suma - total;
    if (Math.abs(diff) <= 0.01) return '';
    return `<div class="pago-aviso pago-aviso-warn">⚠️ Comprador + vendedor (${euro(suma)}) no coincide con el total (${euro(total)}) — diferencia de ${euro(Math.abs(diff))}</div>`;
  }
  // Aviso si el importe de la factura ya asignada a un lado no coincide con su comisión planificada.
  function avisoFacturaVsComisionHTML(facturaId, facturaTotal, comisionV) {
    if (!facturaId) return '';
    if (comisionV === '' || comisionV === null || comisionV === undefined) return '';
    const comision = parseFloat(comisionV);
    if (isNaN(comision)) return '';
    const factura = Number(facturaTotal) || 0;
    if (Math.abs(factura - comision) <= 0.01) return '';
    return `<div class="pago-aviso pago-aviso-warn">⚠️ La factura asignada (${euro(factura)}) no coincide con la comisión planificada (${euro(comision)})</div>`;
  }
  function val(id) { const el = document.getElementById(id); return el ? el.value : ''; }
  function visitasRealizadas(p) {
    if (!Array.isArray(p.visitas)) return p._visitas_realizadas || 0;
    return p.visitas.filter((v) => v.estado === 'Realizada').length;
  }

  // ==================== Carga ====================
  async function cargar() {
    await Promise.all([cargarResumen(), cargarPropiedades()]);
  }

  async function cargarResumen() {
    let r;
    try { r = await API.get('/api/ventas/resumen'); } catch (e) { return; }
    const cont = document.getElementById('vta-resumen');
    if (!cont) return;
    const card = (ico, valor, lbl, clase) =>
      `<div class="vta-mini ${clase}"><div class="vta-mini-ico">${ico}</div><div class="vta-mini-val">${valor}</div><div class="vta-mini-lbl">${lbl}</div></div>`;
    cont.innerHTML =
      card('🏠', r.propiedades_disponibles || 0, 'Disponibles', 'vta-mini-azul') +
      card('👤', r.clientes_activos || 0, 'Clientes activos', 'vta-mini-verde') +
      card('📅', r.visitas_hoy || 0, 'Visitas hoy', 'vta-mini-naranja') +
      card('💰', r.propiedades_vendidas || 0, 'Ventas', 'vta-mini-morado');
  }

  async function cargarPropiedades() {
    const tbody = document.querySelector('#tabla-propiedades tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="11" class="vta-cargando">Cargando propiedades…</td></tr>';
    try {
      propiedades = await API.get('/api/ventas/propiedades');
    } catch (e) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="11" class="vta-cargando">No se pudieron cargar las propiedades.</td></tr>';
      return toast(e.message, 'error');
    }
    renderTabla();
  }

  // ==================== Tabla + filtros ====================
  function filtradas() {
    const q = busqueda.trim().toLowerCase();
    return propiedades.filter((p) => {
      if (p.estado === 'Vendida') return false; // las vendidas van en la pestaña Vendidos
      if (!fEstado.has(p.estado)) return false;
      if (fTipo.size) {
        const t = TIPOS.includes(p.tipo) ? p.tipo : 'Otros';
        if (!fTipo.has(t)) return false;
      }
      if (fPrecioMin !== '' && Number(p.precio) < Number(fPrecioMin)) return false;
      if (fPrecioMax !== '' && Number(p.precio) > Number(fPrecioMax)) return false;
      if (fDorm !== '') {
        const d = Number(p.dormitorios) || 0;
        if (fDorm === '4') { if (d < 4) return false; }
        else if (d !== Number(fDorm)) return false;
      }
      if (q) {
        const txt = `${p.referencia || ''} ${p.calle || ''} ${p.zona || ''} ${p.localidad || ''}`.toLowerCase();
        if (!txt.includes(q)) return false;
      }
      return true;
    });
  }

  function renderTabla() {
    const tbody = document.querySelector('#tabla-propiedades tbody');
    if (!tbody) return;
    const lista = filtradas();
    actualizarContador(lista.length);
    actualizarBadgeFiltros();

    if (!propiedades.length) {
      tbody.innerHTML = '<tr><td colspan="12" class="vta-vacio">No hay propiedades. Importa el Excel de Idealista o crea una nueva.</td></tr>';
      return;
    }
    if (!lista.length) {
      tbody.innerHTML = '<tr><td colspan="12" class="vta-vacio">Ninguna propiedad coincide con los filtros.</td></tr>';
      return;
    }
    tbody.innerHTML = lista.map(filaHTML).join('');

    tbody.querySelectorAll('tr[data-ficha]').forEach((tr) =>
      tr.addEventListener('click', (e) => {
        if (e.target.closest('[data-editar]') || e.target.closest('[data-borrar]') || e.target.closest('[data-ref]')) return;
        abrirFicha(tr.dataset.ficha);
      }));
    tbody.querySelectorAll('[data-ref]').forEach((a) =>
      a.addEventListener('click', (e) => { e.stopPropagation(); abrirFicha(a.dataset.ref); }));
    tbody.querySelectorAll('[data-editar]').forEach((b) =>
      b.addEventListener('click', (e) => { e.stopPropagation(); modalFormulario(propiedades.find((p) => p.id == b.dataset.editar)); }));
    tbody.querySelectorAll('[data-borrar]').forEach((b) =>
      b.addEventListener('click', (e) => { e.stopPropagation(); borrar(propiedades.find((p) => p.id == b.dataset.borrar)); }));
    tbody.querySelectorAll('[data-vender]').forEach((b) =>
      b.addEventListener('click', (e) => { e.stopPropagation(); modalVender(propiedades.find((p) => p.id == b.dataset.vender)); }));
  }

  function filaHTML(p) {
    const dir = [p.calle, p.numero].filter(Boolean).join(' ') || '—';
    const nv = visitasRealizadas(p);
    const visitasCel = nv > 0 ? `<span class="vta-visitas-badge">${nv}</span>` : '<span class="vta-muted">0</span>';
    const btnVender = p.estado !== 'Vendida'
      ? `<button class="btn-icono" data-vender="${p.id}" title="Marcar como vendida">🏷️</button>` : '';
    return `
      <tr data-ficha="${p.id}">
        <td><a class="vta-ref" data-ref="${p.id}">${esc(p.referencia)}</a></td>
        <td>${esc(p.apartamento_nombre) || '—'}</td>
        <td>${esc(p.tipo) || '—'}</td>
        <td>${esc(dir)}</td>
        <td>${esc(p.zona) || '—'}</td>
        <td class="vta-precio">${euro(p.precio)}</td>
        <td>${p.dormitorios ?? '—'}</td>
        <td>${p.banos ?? '—'}</td>
        <td>${p.metros_cuadrados ?? '—'}</td>
        <td>${estadoBadge(p.estado)}</td>
        <td>${visitasCel}</td>
        <td class="vta-acciones">
          ${btnVender}
          <button class="btn-icono" data-editar="${p.id}" title="Editar">✏️</button>
          <button class="btn-icono" data-borrar="${p.id}" title="Eliminar">🗑</button>
        </td>
      </tr>`;
  }

  function actualizarContador(n) {
    const c = document.getElementById('vta-prop-contador');
    if (c) c.textContent = `${n} propiedad${n === 1 ? '' : 'es'}`;
  }

  function nFiltrosActivos() {
    let n = 0;
    if (fEstado.size !== ESTADOS_FILTRO.length) n++;
    if (fTipo.size) n++;
    if (fPrecioMin !== '' || fPrecioMax !== '') n++;
    if (fDorm !== '') n++;
    return n;
  }
  function actualizarBadgeFiltros() {
    const b = document.getElementById('vta-filtros-badge');
    if (!b) return;
    const n = nFiltrosActivos();
    b.textContent = n;
    b.classList.toggle('oculto', n === 0);
  }

  function construirFiltros() {
    const panel = document.getElementById('vta-filtros-panel');
    if (!panel || panel.dataset.listo) return;
    const estItems = ESTADOS_FILTRO.map((e) =>
      `<label class="rsv-f-op"><input type="checkbox" data-f="estado" value="${e}" checked><span class="rsv-f-op-label">${e}</span></label>`).join('');
    const tipoItems = TIPOS.map((t) =>
      `<label class="rsv-f-op"><input type="checkbox" data-f="tipo" value="${t}"><span class="rsv-f-op-label">${t}</span></label>`).join('');
    panel.innerHTML = `
      <div class="rsv-f-grupo">
        <div class="rsv-f-titulo">Estado</div>
        <div class="rsv-f-ops">${estItems}</div>
      </div>
      <div class="rsv-f-grupo">
        <div class="rsv-f-titulo">Tipo</div>
        <div class="rsv-f-ops">${tipoItems}</div>
      </div>
      <div class="rsv-f-grupo">
        <div class="rsv-f-titulo">Rango de precio (€)</div>
        <div class="vta-f-precio">
          <input type="number" id="vta-f-pmin" class="input-fecha" placeholder="Desde" min="0">
          <input type="number" id="vta-f-pmax" class="input-fecha" placeholder="Hasta" min="0">
        </div>
      </div>
      <div class="rsv-f-grupo">
        <div class="rsv-f-titulo">Dormitorios</div>
        <select id="vta-f-dorm" class="select-filtro">
          <option value="">Todos</option><option value="1">1</option><option value="2">2</option>
          <option value="3">3</option><option value="4">4+</option>
        </select>
      </div>
      <div class="rsv-f-grupo"><button id="vta-f-limpiar" class="btn-sec">Limpiar filtros</button></div>`;
    panel.dataset.listo = '1';

    panel.addEventListener('change', (e) => {
      const chk = e.target.closest('input[type="checkbox"][data-f]');
      if (!chk) return;
      const set = chk.dataset.f === 'estado' ? fEstado : fTipo;
      if (chk.checked) set.add(chk.value); else set.delete(chk.value);
      renderTabla();
    });
    panel.querySelector('#vta-f-pmin').addEventListener('input', (e) => { fPrecioMin = e.target.value; renderTabla(); });
    panel.querySelector('#vta-f-pmax').addEventListener('input', (e) => { fPrecioMax = e.target.value; renderTabla(); });
    panel.querySelector('#vta-f-dorm').addEventListener('change', (e) => { fDorm = e.target.value; renderTabla(); });
    panel.querySelector('#vta-f-limpiar').addEventListener('click', resetFiltros);
  }

  function resetFiltros() {
    fEstado = new Set(ESTADOS_FILTRO);
    fTipo = new Set();
    fPrecioMin = ''; fPrecioMax = ''; fDorm = '';
    const panel = document.getElementById('vta-filtros-panel');
    if (panel) {
      panel.querySelectorAll('input[data-f="estado"]').forEach((c) => { c.checked = true; });
      panel.querySelectorAll('input[data-f="tipo"]').forEach((c) => { c.checked = false; });
      const pmin = panel.querySelector('#vta-f-pmin'); if (pmin) pmin.value = '';
      const pmax = panel.querySelector('#vta-f-pmax'); if (pmax) pmax.value = '';
      const dorm = panel.querySelector('#vta-f-dorm'); if (dorm) dorm.value = '';
    }
    renderTabla();
  }

  // ==================== Panel lateral (ficha) ====================
  function crearPanel() {
    if (document.getElementById('vta-panel')) return;
    const fondo = document.createElement('div');
    fondo.id = 'vta-panel-fondo';
    fondo.className = 'panel-fondo';
    const panel = document.createElement('aside');
    panel.id = 'vta-panel';
    panel.className = 'panel-lateral';
    panel.setAttribute('aria-label', 'Ficha de propiedad');
    panel.innerHTML = `
      <header class="panel-cabecera">
        <div class="rsv-titulo-grupo">
          <h3 id="vta-d-titulo">Propiedad</h3>
          <span id="vta-d-badges"></span>
        </div>
        <div class="panel-cabecera-acciones">
          <button id="vta-d-editar" class="btn-sec">✏️ Editar</button>
          <button id="vta-d-cerrar" class="panel-cerrar" title="Cerrar">&times;</button>
        </div>
      </header>
      <div id="vta-d-cuerpo" class="panel-cuerpo"></div>`;
    document.body.appendChild(fondo);
    document.body.appendChild(panel);
    fondo.addEventListener('click', cerrarPanel);
    panel.querySelector('#vta-d-cerrar').addEventListener('click', cerrarPanel);
    panel.querySelector('#vta-d-editar').addEventListener('click', () => { if (fichaActual) modalFormulario(fichaActual); });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const modalAbierto = !document.getElementById('modal-fondo').classList.contains('oculto');
      if (!modalAbierto && panel.classList.contains('abierto')) cerrarPanel();
    }, true);
  }
  function abrirPanel() {
    document.getElementById('vta-panel-fondo').classList.add('abierto');
    document.getElementById('vta-panel').classList.add('abierto');
  }
  function cerrarPanel() {
    document.getElementById('vta-panel-fondo')?.classList.remove('abierto');
    document.getElementById('vta-panel')?.classList.remove('abierto');
    fichaActual = null;
  }

  async function abrirFicha(id) {
    crearPanel();
    let d;
    try { d = await API.get('/api/ventas/propiedades/' + id); }
    catch (e) { return toast(e.message, 'error'); }
    fichaActual = d;
    document.getElementById('vta-d-titulo').textContent = d.referencia || 'Propiedad';
    document.getElementById('vta-d-badges').innerHTML =
      `${d.tipo ? `<span class="vta-badge-tipo">${esc(d.tipo)}</span>` : ''} ${estadoBadge(d.estado)}`;
    renderCuerpo(d);
    abrirPanel();
  }
  // Recarga la ficha tras editar sin cerrar el panel.
  async function recargarFicha() {
    if (!fichaActual) return;
    await abrirFicha(fichaActual.id);
  }

  function dato(etq, valor) {
    return `<div class="campo-ficha"><div class="etq">${etq}</div><div class="val">${valor}</div></div>`;
  }

  function renderCuerpo(d) {
    const datos = `
      <div class="vta-d-seccion">
        ${d.apartamento_nombre ? `<div style="font-size:18px;font-weight:700;color:#1a1a2e;margin-bottom:8px">${esc(d.apartamento_nombre)}</div>` : ''}
        <div class="vta-d-precio">${euro(d.precio)}</div>
        <div class="vta-d-grid">
          ${dato('Apartamento', esc(d.apartamento_nombre) || '—')}
          ${dato('Referencia', esc(d.referencia) || '—')}
          ${dato('Código Idealista', esc(d.codigo_idealista) || '—')}
          ${dato('Tipo', esc(d.tipo) || '—')}
          ${dato('Estado', estadoBadge(d.estado))}
          ${dato('Dirección', esc([d.calle, d.numero].filter(Boolean).join(' ')) || '—')}
          ${dato('Planta', esc(d.planta) || '—')}
          ${dato('Zona', esc(d.zona) || '—')}
          ${dato('Localidad', esc(d.localidad) || '—')}
          ${dato('Dormitorios', d.dormitorios ?? '—')}
          ${dato('Baños', d.banos ?? '—')}
          ${dato('m² totales', d.metros_cuadrados ?? '—')}
          ${dato('m² útiles', d.metros_utiles ?? '—')}
          ${dato('Clase energética', esc(d.clase_energetica) || '—')}
          ${dato('Garaje', esc(d.garaje) || '—')}
          ${dato('Fotos en Idealista', d.num_fotos ?? 0)}
          ${dato('Estado Idealista', esc(d.estado_idealista) || '—')}
          ${dato('Fecha alta', fechaES(d.fecha_alta))}
          ${dato('Fecha baja', fechaES(d.fecha_baja))}
        </div>
      </div>`;

    let propietario;
    if (d.propietario_venta_id) {
      // Propietario vinculado de la cartera de ventas.
      const nomPV = [d.pv_nombre, d.pv_apellidos].filter(Boolean).join(' ') || '—';
      propietario = `
        <div class="vta-d-seccion">
          <div class="vta-d-titulo-sec">👤 Propietario <span class="vta-bdg vta-bdg-prv">🔗 Cartera de ventas</span></div>
          <div class="vta-d-cli-nombre">${esc(nomPV)}</div>
          ${d.pv_telefono ? `<div class="vta-d-linea">📞 <a class="vta-link" href="tel:${esc(d.pv_telefono)}">${esc(d.pv_telefono)}</a></div>` : ''}
          ${d.pv_email ? `<div class="vta-d-linea">✉️ <a class="vta-link" href="mailto:${esc(d.pv_email)}">${esc(d.pv_email)}</a></div>` : ''}
          ${d.pv_dni ? `<div class="vta-d-linea">🪪 ${esc(d.pv_dni)}</div>` : ''}
          <div class="vta-d-guardar-wrap"><button class="btn-sec" id="vta-d-ver-prv">Ver ficha</button></div>
        </div>`;
    } else {
      // Datos del propietario en texto plano (snapshot del Idealista).
      const nomProp = [d.propietario_nombre, d.propietario_apellidos].filter(Boolean).join(' ') || '—';
      propietario = `
        <div class="vta-d-seccion">
          <div class="vta-d-titulo-sec">👤 Propietario</div>
          <div class="vta-d-cli-nombre">${esc(nomProp)}</div>
          ${d.propietario_telefono ? `<div class="vta-d-linea">📞 <a class="vta-link" href="tel:${esc(d.propietario_telefono)}">${esc(d.propietario_telefono)}</a></div>` : ''}
          ${d.propietario_email ? `<div class="vta-d-linea">✉️ <a class="vta-link" href="mailto:${esc(d.propietario_email)}">${esc(d.propietario_email)}</a></div>` : ''}
        </div>`;
    }

    const notas = `
      <div class="vta-d-seccion">
        <div class="vta-d-titulo-sec">📝 Notas y descripción</div>
        <label class="vta-d-etq2">Descripción</label>
        <textarea id="vta-d-desc" class="vta-d-textarea" rows="3" placeholder="Descripción de la propiedad...">${esc(d.descripcion)}</textarea>
        <label class="vta-d-etq2">Notas internas</label>
        <textarea id="vta-d-notas" class="vta-d-textarea" rows="3" placeholder="Notas internas (no se exportan)...">${esc(d.notas)}</textarea>
        <div class="vta-d-guardar-wrap"><button class="btn-pri" id="vta-d-guardar-notas">Guardar</button></div>
      </div>`;

    const visitas = (d.visitas || []).map((v) => `
      <div class="vta-visita-item">
        <div class="vta-visita-top">
          <span class="vta-visita-fecha">${fechaES(v.fecha)}${v.hora ? ' · ' + esc(v.hora) : ''}</span>
          <span class="vta-bdg vta-bdg-visita">${esc(v.estado)}</span>
        </div>
        <div class="vta-visita-cli">👤 ${esc([v.cliente_nombre, v.cliente_apellidos].filter(Boolean).join(' '))}</div>
        ${v.valoracion ? `<div class="vta-visita-val">⭐ ${esc(v.valoracion)}</div>` : ''}
      </div>`).join('') || '<div class="vta-muted">Sin visitas registradas</div>';
    const histVisitas = `
      <div class="vta-d-seccion">
        <div class="vta-d-titulo-sec">📅 Historial de visitas</div>
        ${visitas}
      </div>`;

    // Sección DATOS DE VENTA (solo si está vendida), destacada arriba del todo.
    let ventaSec = '';
    if (d.estado === 'Vendida') {
      const dif = difVenta(d.precio, d.precio_venta_final);
      const tel = d.comprador_telefono ? `📞 <a class="vta-link" href="tel:${esc(d.comprador_telefono)}">${esc(d.comprador_telefono)}</a>` : '';
      const email = d.comprador_email ? `✉️ <a class="vta-link" href="mailto:${esc(d.comprador_email)}">${esc(d.comprador_email)}</a>` : '';
      const escritura = d.fecha_escritura
        ? `<div class="vta-d-linea">📜 Escriturada el ${fechaES(d.fecha_escritura)}${esAdmin() ? ` <button class="btn-icono" id="vta-add-escritura" title="Editar fecha de escrituración">✏️</button>` : ''}</div>`
        : `<div class="vta-d-linea" style="color:#f59e0b;font-weight:600">⏳ Pendiente de escriturar
             <button class="btn-sec" id="vta-add-escritura" style="margin-left:8px;padding:2px 8px">＋ Añadir fecha</button></div>`;

      const comisionHTML = (lado, facturaId, numero, estadoFac, total) => facturaId
        ? `<div class="vta-d-linea">
             ${esc(numero)} ${badgeFacEstado(estadoFac)} ${euro(total)}
             <button class="btn-mini" data-quitar-comision="${lado}" style="margin-left:8px">🗑️ Quitar</button>
           </div>`
        : `<div class="vta-d-linea vta-muted">
             Sin factura asignada
             <button class="btn-sec" data-asignar-comision="${lado}" style="margin-left:8px;padding:2px 8px">＋ Asignar factura</button>
           </div>`;

      ventaSec = `
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px;margin-bottom:20px">
          <div class="vta-d-titulo-sec" style="border:none;color:#047857">💰 Datos de venta</div>
          <div style="font-size:26px;font-weight:700;color:#047857;line-height:1.1">${euro(d.precio_venta_final)}</div>
          <div style="font-size:13px;font-weight:600;margin-top:2px;color:${dif.color}">${dif.texto} respecto al precio de anuncio (${euro(d.precio)})</div>
          <div class="vta-d-grid" style="margin-top:10px">
            ${dato('Comprador', esc(d.comprador_nombre) || '—')}
            ${dato('Fecha de venta', fechaES(d.fecha_venta))}
          </div>
          ${tel ? `<div class="vta-d-linea">${tel}</div>` : ''}
          ${email ? `<div class="vta-d-linea">${email}</div>` : ''}
          ${escritura}
          <div class="vta-d-titulo-sec" style="border:none;color:#047857;margin-top:10px">Comisión de la venta</div>
          <div class="fila-campos" style="margin-top:4px">
            <div class="campo"><label>Total</label><input type="number" step="0.01" id="vta-com-total" value="${d.comision_total ?? ''}"></div>
            <div class="campo"><label>Comprador</label><input type="number" step="0.01" id="vta-com-comprador" value="${d.comision_comprador ?? ''}"></div>
            <div class="campo"><label>Vendedor</label><input type="number" step="0.01" id="vta-com-vendedor" value="${d.comision_vendedor ?? ''}"></div>
          </div>
          <div id="vta-com-aviso">${comisionAvisoHTML(d.comision_total, d.comision_comprador, d.comision_vendedor)}</div>
          <div class="vta-d-guardar-wrap"><button class="btn-sec" id="vta-com-guardar" style="padding:2px 8px">Guardar</button></div>
          <div class="vta-d-titulo-sec" style="border:none;color:#047857;margin-top:10px">Comisión comprador</div>
          ${comisionHTML('comprador', d.factura_comprador_id, d.fc_numero, d.fc_estado, d.fc_total)}
          <div id="vta-com-aviso-comprador">${avisoFacturaVsComisionHTML(d.factura_comprador_id, d.fc_total, d.comision_comprador)}</div>
          <div class="vta-d-titulo-sec" style="border:none;color:#047857;margin-top:10px">Comisión vendedor</div>
          ${comisionHTML('vendedor', d.factura_vendedor_id, d.fv_numero, d.fv_estado, d.fv_total)}
          <div id="vta-com-aviso-vendedor">${avisoFacturaVsComisionHTML(d.factura_vendedor_id, d.fv_total, d.comision_vendedor)}</div>
        </div>`;
    }

    document.getElementById('vta-d-cuerpo').innerHTML = ventaSec + datos + propietario + notas + histVisitas;

    const btnEscritura = document.getElementById('vta-add-escritura');
    if (btnEscritura) btnEscritura.addEventListener('click', () => modalAnadirEscritura(d));

    document.getElementById('vta-d-cuerpo').querySelectorAll('[data-quitar-comision]').forEach((b) => b.addEventListener('click', async () => {
      const lado = b.dataset.quitarComision;
      if (!confirm('¿Quitar la factura de comisión asignada?')) return;
      try {
        await API.put('/api/ventas/propiedades/' + d.id, {
          [lado === 'comprador' ? 'factura_comprador_id' : 'factura_vendedor_id']: null,
        });
        await recargarFicha();
        toast('Factura desasignada', 'ok');
      } catch (e) { toast(e.message, 'error'); }
    }));

    document.getElementById('vta-d-cuerpo').querySelectorAll('[data-asignar-comision]').forEach((b) =>
      b.addEventListener('click', () => modalAsignarFactura(d.id, b.dataset.asignarComision)));

    const btnVerPrv = document.getElementById('vta-d-ver-prv');
    if (btnVerPrv) btnVerPrv.addEventListener('click', () => abrirFichaPropvent(d.propietario_venta_id));

    document.getElementById('vta-d-guardar-notas').addEventListener('click', async () => {
      const btn = document.getElementById('vta-d-guardar-notas');
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        await API.put('/api/ventas/propiedades/' + d.id, {
          descripcion: val('vta-d-desc'), notas: val('vta-d-notas'),
        });
        toast('Guardado', 'ok');
        fichaActual.descripcion = val('vta-d-desc');
        fichaActual.notas = val('vta-d-notas');
      } catch (e) { toast(e.message, 'error'); }
      finally { btn.disabled = false; btn.textContent = 'Guardar'; }
    });

    const inputsCom = ['vta-com-total', 'vta-com-comprador', 'vta-com-vendedor']
      .map((id) => document.getElementById(id)).filter(Boolean);
    const recalcularAvisoComision = () => {
      const aviso = document.getElementById('vta-com-aviso');
      if (aviso) aviso.innerHTML = comisionAvisoHTML(val('vta-com-total'), val('vta-com-comprador'), val('vta-com-vendedor'));
      const avisoComp = document.getElementById('vta-com-aviso-comprador');
      if (avisoComp) avisoComp.innerHTML = avisoFacturaVsComisionHTML(d.factura_comprador_id, d.fc_total, val('vta-com-comprador'));
      const avisoVend = document.getElementById('vta-com-aviso-vendedor');
      if (avisoVend) avisoVend.innerHTML = avisoFacturaVsComisionHTML(d.factura_vendedor_id, d.fv_total, val('vta-com-vendedor'));
    };
    inputsCom.forEach((el) => el.addEventListener('input', recalcularAvisoComision));

    const btnCom = document.getElementById('vta-com-guardar');
    if (btnCom) btnCom.addEventListener('click', async () => {
      btnCom.disabled = true; btnCom.textContent = 'Guardando…';
      try {
        await API.put('/api/ventas/propiedades/' + d.id, {
          comision_total: val('vta-com-total'),
          comision_comprador: val('vta-com-comprador'),
          comision_vendedor: val('vta-com-vendedor'),
        });
        toast('Comisión guardada', 'ok');
        fichaActual.comision_total = val('vta-com-total');
        fichaActual.comision_comprador = val('vta-com-comprador');
        fichaActual.comision_vendedor = val('vta-com-vendedor');
      } catch (e) { toast(e.message, 'error'); }
      finally { btnCom.disabled = false; btnCom.textContent = 'Guardar'; }
    });
  }

  // ==================== Modal nueva / editar ====================
  async function modalFormulario(p) {
    const esNueva = !p;
    p = p || {};
    vfPropVentaId = p.propietario_venta_id || null;
    await cargarPrvCache();
    const optTipo = ['', 'Piso', 'Ático', 'Casa', 'Villa', 'Otros']
      .map((t) => `<option value="${t}"${(p.tipo || '') === t ? ' selected' : ''}>${t || '— Tipo —'}</option>`).join('');
    const optEstado = ESTADOS.map((e) => `<option value="${e}"${(p.estado || 'Disponible') === e ? ' selected' : ''}>${e}</option>`).join('');

    abrirModal(`
      <h3>${esNueva ? '＋ Nueva propiedad' : '✏️ Editar propiedad'}</h3>
      <div class="campo"><label>Nombre del apartamento</label><input id="vf-apartamento_nombre" value="${esc(p.apartamento_nombre)}"></div>
      <div class="fila-campos">
        <div class="campo"><label>Referencia${esNueva ? '' : ' *'}</label><input id="vf-referencia" value="${esc(p.referencia)}"${esNueva ? ' disabled placeholder="Se asignará automáticamente al guardar"' : ''}></div>
        <div class="campo"><label>Tipo</label><select id="vf-tipo">${optTipo}</select></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Calle</label><input id="vf-calle" value="${esc(p.calle)}"></div>
        <div class="campo"><label>Número</label><input id="vf-numero" value="${esc(p.numero)}"></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Planta</label><input id="vf-planta" value="${esc(p.planta)}"></div>
        <div class="campo"><label>Nº de puerta</label><input id="vf-numero_puerta" value="${esc(p.numero_puerta)}"></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Zona</label><input id="vf-zona" value="${esc(p.zona)}"></div>
        <div class="campo"><label>Localidad</label><input id="vf-localidad" value="${esc(p.localidad)}"></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Precio (€)</label><input id="vf-precio" type="number" min="0" value="${p.precio ?? ''}"></div>
        <div class="campo"><label>Estado</label><select id="vf-estado">${optEstado}</select></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Dormitorios</label><input id="vf-dormitorios" type="number" min="0" value="${p.dormitorios ?? ''}"></div>
        <div class="campo"><label>Baños</label><input id="vf-banos" type="number" min="0" value="${p.banos ?? ''}"></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>m² totales</label><input id="vf-metros_cuadrados" type="number" min="0" value="${p.metros_cuadrados ?? ''}"></div>
        <div class="campo"><label>m² útiles</label><input id="vf-metros_utiles" type="number" min="0" value="${p.metros_utiles ?? ''}"></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Clase energética</label><input id="vf-clase_energetica" value="${esc(p.clase_energetica)}"></div>
        <div class="campo"><label>Garaje</label><input id="vf-garaje" value="${esc(p.garaje)}"></div>
      </div>
      <div class="vta-modal-sub">Propietario</div>
      <div class="campo vta-ta">
        <label>Propietario de la cartera de ventas</label>
        <input id="vf-prv-input" class="input-buscar" autocomplete="off" placeholder="Buscar propietario por nombre, teléfono o email...">
        <div id="vf-prv-res" class="vta-ta-res oculto"></div>
        <div id="vf-prv-sel" class="vta-prv-sel oculto"></div>
      </div>
      <div class="vta-modal-nota">Datos del propietario en Idealista (solo referencia, no es el vínculo):</div>
      <div class="fila-campos">
        <div class="campo"><label>Nombre</label><input id="vf-propietario_nombre" value="${esc(p.propietario_nombre)}"></div>
        <div class="campo"><label>Apellidos</label><input id="vf-propietario_apellidos" value="${esc(p.propietario_apellidos)}"></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Teléfono</label><input id="vf-propietario_telefono" value="${esc(p.propietario_telefono)}"></div>
        <div class="campo"><label>Email</label><input id="vf-propietario_email" value="${esc(p.propietario_email)}"></div>
      </div>
      <div class="campo"><label>Descripción</label><textarea id="vf-descripcion" rows="2">${esc(p.descripcion)}</textarea></div>
      <div class="campo"><label>Notas internas</label><textarea id="vf-notas" rows="2">${esc(p.notas)}</textarea></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="vf-cancelar">Cancelar</button>
        <button class="btn-pri" id="vf-guardar">${esNueva ? 'Crear' : 'Guardar'}</button>
      </div>`);
    document.querySelector('.modal').classList.add('modal-ancho');
    document.getElementById('vf-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('vf-guardar').addEventListener('click', () => guardar(esNueva ? null : p.id));

    // Typeahead de propietario de la cartera de ventas.
    const prvInp = document.getElementById('vf-prv-input');
    const prvRes = document.getElementById('vf-prv-res');
    const setPrvSel = (pv) => {
      const sel = document.getElementById('vf-prv-sel');
      if (pv) {
        vfPropVentaId = pv.id;
        prvInp.classList.add('oculto');
        sel.classList.remove('oculto');
        sel.innerHTML = `🔗 <strong>${esc([pv.nombre, pv.apellidos].filter(Boolean).join(' '))}</strong>
          ${pv.telefono ? '· ' + esc(pv.telefono) : ''}
          <button type="button" class="btn-sec vta-prv-quitar" id="vf-prv-quitar">Quitar</button>`;
        document.getElementById('vf-prv-quitar').addEventListener('click', () => setPrvSel(null));
      } else {
        vfPropVentaId = null;
        sel.classList.add('oculto'); sel.innerHTML = '';
        prvInp.classList.remove('oculto'); prvInp.value = '';
      }
    };
    prvInp.addEventListener('input', () => {
      const q = prvInp.value.trim().toLowerCase();
      renderTA(prvRes,
        prvCache.filter((pv) => `${pv.nombre} ${pv.apellidos || ''} ${pv.telefono || ''} ${pv.email || ''}`.toLowerCase().includes(q)),
        (pv) => `${esc([pv.nombre, pv.apellidos].filter(Boolean).join(' '))}${pv.telefono ? ' · ' + esc(pv.telefono) : ''}`,
        (pv) => { setPrvSel(pv); prvRes.classList.add('oculto'); });
    });
    document.getElementById('modal-contenido')?.addEventListener('click', (e) => {
      if (!e.target.closest('.vta-ta')) prvRes.classList.add('oculto');
    });
    if (vfPropVentaId) {
      const actual = prvCache.find((pv) => pv.id == vfPropVentaId);
      if (actual) setPrvSel(actual);
    }
  }

  // Carga el catálogo de propietarios de venta para el typeahead (cacheado).
  async function cargarPrvCache() {
    if (prvCacheOk) return;
    try { prvCache = await API.get('/api/ventas/propietarios-venta'); prvCacheOk = true; }
    catch (e) { prvCache = prvCache || []; }
  }

  const CAMPOS_FORM = [
    'apartamento_nombre',
    'referencia', 'tipo', 'calle', 'numero', 'planta', 'numero_puerta', 'zona', 'localidad', 'precio', 'estado',
    'dormitorios', 'banos', 'metros_cuadrados', 'metros_utiles', 'clase_energetica', 'garaje',
    'propietario_nombre', 'propietario_apellidos', 'propietario_telefono', 'propietario_email',
    'descripcion', 'notas',
  ];

  async function guardar(id) {
    const referencia = val('vf-referencia').trim();
    if (id && !referencia) return toast('La referencia es obligatoria', 'error');
    const body = {};
    for (const c of CAMPOS_FORM) body[c] = val('vf-' + c);
    if (referencia) body.referencia = referencia; else delete body.referencia; // nueva sin referencia -> la genera el backend
    body.propietario_venta_id = vfPropVentaId; // null = sin vínculo

    const btn = document.getElementById('vf-guardar');
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      let creada = null;
      if (id) await API.put('/api/ventas/propiedades/' + id, body);
      else creada = await API.post('/api/ventas/propiedades', body);
      cerrarModal();
      await cargarPropiedades();
      cargarResumen();
      if (fichaActual && id && fichaActual.id === id) await recargarFicha();
      toast(id ? 'Propiedad actualizada' : `Propiedad creada: ${creada.referencia}`, 'ok');
    } catch (e) {
      toast(e.message, 'error');
      btn.disabled = false; btn.textContent = id ? 'Guardar' : 'Crear';
    }
  }

  async function borrar(p) {
    if (!p) return;
    if (!confirm(`¿Eliminar la propiedad ${p.referencia}?`)) return;
    try {
      await API.del('/api/ventas/propiedades/' + p.id);
      await cargarPropiedades();
      cargarResumen();
      toast('Propiedad eliminada', 'ok');
    } catch (e) {
      toast(e.message, 'error'); // 409 → "tiene visitas registradas"
    }
  }

  // ==================== Modal importar Idealista ====================
  function modalImportar() {
    subSel = [];
    abrirModal(`
      <h3>📥 Importar de Idealista</h3>
      <div class="vta-import-aviso">ℹ️ Las notas y el estado de las propiedades existentes no se sobrescriben.</div>
      <div class="alo-dropzone" id="vi-dz">
        <div class="alo-dropzone-icono">📄</div>
        <div>Arrastra el Excel aquí o <strong>haz clic para seleccionar</strong> (.xlsx / .xls)</div>
        <input type="file" id="vi-file" accept=".xlsx,.xls" hidden>
      </div>
      <div id="vi-nombre" class="vta-import-nombre"></div>
      <div id="vi-resultado" class="vta-import-resultado oculto"></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="vi-cancelar">Cerrar</button>
        <button class="btn-pri" id="vi-importar" disabled>Importar</button>
      </div>`);

    const dz = document.getElementById('vi-dz');
    const input = document.getElementById('vi-file');
    dz.addEventListener('click', () => input.click());
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('arrastrando'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('arrastrando'));
    dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('arrastrando'); elegir(e.dataTransfer.files); });
    input.addEventListener('change', () => elegir(input.files));
    document.getElementById('vi-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('vi-importar').addEventListener('click', importar);
  }

  function elegir(fileList) {
    const f = Array.from(fileList)[0];
    if (!f) return;
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (!['xlsx', 'xls'].includes(ext)) return toast('Formato no admitido (solo .xlsx / .xls)', 'error');
    subSel = [f];
    const nombre = document.getElementById('vi-nombre');
    if (nombre) nombre.textContent = '📄 ' + f.name;
    document.getElementById('vi-importar').disabled = false;
  }

  async function importar() {
    if (!subSel.length) return;
    const btn = document.getElementById('vi-importar');
    const cancelar = document.getElementById('vi-cancelar');
    btn.disabled = true; cancelar.disabled = true;
    btn.innerHTML = '<span class="vta-spinner"></span> Importando propiedades…';
    try {
      const fd = new FormData();
      fd.append('archivo', subSel[0]);
      const r = await fetch('/api/ventas/propiedades/importar', { method: 'POST', body: fd, headers: authHeaders() });
      if (!r.ok) {
        let msg = 'Error al importar';
        try { msg = (await r.json()).error || msg; } catch (e) {}
        throw new Error(msg);
      }
      const res = await r.json();
      mostrarResultado(res);
      await cargarPropiedades();
      cargarResumen();
    } catch (e) {
      toast(e.message, 'error');
      btn.disabled = false; cancelar.disabled = false; btn.textContent = 'Importar';
    }
  }

  function mostrarResultado(res) {
    const cont = document.getElementById('vi-resultado');
    const btn = document.getElementById('vi-importar');
    const cancelar = document.getElementById('vi-cancelar');
    const errores = res.errores || [];
    const erroresHTML = errores.length
      ? `<div class="vta-import-errores"><strong>${errores.length} error(es):</strong><ul>${errores.slice(0, 20).map((e) =>
          `<li>Fila ${e.fila}${e.referencia ? ' (' + esc(e.referencia) + ')' : ''}: ${esc(e.motivo)}</li>`).join('')}</ul></div>`
      : '';
    if (cont) {
      cont.classList.remove('oculto');
      cont.innerHTML = `
        <div class="vta-import-ok">✅ Importación completada</div>
        <div class="vta-import-stats">
          <span><strong>${res.nuevas || 0}</strong> nuevas</span>
          <span><strong>${res.actualizadas || 0}</strong> actualizadas</span>
          <span><strong>${errores.length}</strong> errores</span>
        </div>
        ${erroresHTML}`;
    }
    if (btn) { btn.classList.add('oculto'); }
    if (cancelar) { cancelar.disabled = false; cancelar.textContent = 'Cerrar'; }
    toast(`${res.nuevas || 0} nuevas · ${res.actualizadas || 0} actualizadas`, 'ok');
  }

  // ============================================================
  //                    SUB-PESTAÑA CLIENTES
  // ============================================================
  function estadoCliBadge(e) {
    const map = {
      'Nuevo': 'vta-bdg-cli-nuevo', 'Contactado': 'vta-bdg-cli-cont',
      'Visitado': 'vta-bdg-cli-vis', 'En negociación': 'vta-bdg-cli-neg',
      'Compró': 'vta-bdg-cli-compro', 'Descartado': 'vta-bdg-cli-desc',
    };
    return `<span class="vta-bdg ${map[e] || 'vta-bdg-cli-nuevo'}">${esc(e || '—')}</span>`;
  }

  // Resumen compacto de las preferencias de búsqueda.
  function resumenBusca(c) {
    const parts = [];
    if (c.busca_tipo && c.busca_tipo !== 'Indiferente') parts.push(c.busca_tipo);
    if (c.busca_dormitorios) parts.push(`${c.busca_dormitorios} dorm`);
    if (c.busca_zona) parts.push(c.busca_zona);
    if (c.busca_linea && c.busca_linea !== 'Indiferente') parts.push(c.busca_linea);
    if (c.busca_frontal) parts.push('frontal');
    if (c.busca_villa) parts.push('villa/casa');
    let s = parts.join(', ');
    if (c.presupuesto_max) s += (s ? ', ' : '') + 'máx ' + euro(c.presupuesto_max);
    return s || '—';
  }

  // ---- Carga ----
  async function cargarClientes() {
    // Acotado a #vista-ventas: hay otra tabla con id="tabla-clientes" (módulo Clientes/huéspedes).
    const tbody = document.querySelector('#vista-ventas #tabla-clientes tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="vta-cargando">Cargando clientes…</td></tr>';
    try {
      // Una sola llamada extra para contar visitas realizadas por cliente.
      const [cls, visR] = await Promise.all([
        API.get('/api/ventas/clientes'),
        API.get('/api/ventas/visitas?estado=Realizada'),
      ]);
      const cnt = {};
      visR.forEach((v) => { cnt[v.cliente_id] = (cnt[v.cliente_id] || 0) + 1; });
      clientes = cls.map((c) => ({ ...c, _visitas_realizadas: cnt[c.id] || 0 }));
    } catch (e) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="vta-cargando">No se pudieron cargar los clientes.</td></tr>';
      return toast(e.message, 'error');
    }
    renderTablaCli();
  }

  // ---- Tabla + filtros ----
  function filtradasCli() {
    const q = cliBusqueda.trim().toLowerCase();
    return clientes.filter((c) => {
      if (!fEstadoCli.has(c.estado)) return false;
      if (fTipoCli.size) {
        if (!c.busca_tipo || !fTipoCli.has(c.busca_tipo)) return false;
      }
      if (fPresMin !== '' && Number(c.presupuesto_max || 0) < Number(fPresMin)) return false;
      if (fPresMax !== '' && Number(c.presupuesto_max || 0) > Number(fPresMax)) return false;
      if (q) {
        const txt = `${c.nombre || ''} ${c.apellidos || ''} ${c.email || ''} ${c.telefono || ''}`.toLowerCase();
        if (!txt.includes(q)) return false;
      }
      return true;
    });
  }

  function renderTablaCli() {
    const tbody = document.querySelector('#vista-ventas #tabla-clientes tbody');
    if (!tbody) return;
    const lista = filtradasCli();
    const cont = document.getElementById('vcl-contador');
    if (cont) cont.textContent = `${lista.length} cliente${lista.length === 1 ? '' : 's'}`;
    actualizarBadgeCli();

    if (!clientes.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="vta-vacio">No hay clientes. Crea el primero con “＋ Nuevo cliente”.</td></tr>';
      return;
    }
    if (!lista.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="vta-vacio">Ningún cliente coincide con los filtros.</td></tr>';
      return;
    }
    tbody.innerHTML = lista.map(filaCliHTML).join('');

    tbody.querySelectorAll('tr[data-ficha]').forEach((tr) =>
      tr.addEventListener('click', (e) => {
        if (e.target.closest('[data-editar]') || e.target.closest('[data-borrar]') || e.target.closest('[data-nom]')) return;
        abrirFichaCli(tr.dataset.ficha);
      }));
    tbody.querySelectorAll('[data-nom]').forEach((a) =>
      a.addEventListener('click', (e) => { e.stopPropagation(); abrirFichaCli(a.dataset.nom); }));
    tbody.querySelectorAll('[data-editar]').forEach((b) =>
      b.addEventListener('click', (e) => { e.stopPropagation(); modalCliente(clientes.find((c) => c.id == b.dataset.editar)); }));
    tbody.querySelectorAll('[data-borrar]').forEach((b) =>
      b.addEventListener('click', (e) => { e.stopPropagation(); borrarCliente(clientes.find((c) => c.id == b.dataset.borrar)); }));
  }

  function filaCliHTML(c) {
    const nom = [c.nombre, c.apellidos].filter(Boolean).join(' ');
    const nv = c._visitas_realizadas || 0;
    const visitasCel = nv > 0 ? `<span class="vta-visitas-badge">${nv}</span>` : '<span class="vta-muted">0</span>';
    return `
      <tr data-ficha="${c.id}">
        <td><a class="vta-ref" data-nom="${c.id}">${esc(nom)}</a></td>
        <td>${esc(c.telefono) || '—'}</td>
        <td>${esc(c.email) || '—'}</td>
        <td class="vta-busca-cel">${esc(resumenBusca(c))}</td>
        <td class="vta-precio">${euro(c.presupuesto_max)}</td>
        <td>${visitasCel}</td>
        <td>${estadoCliBadge(c.estado)}</td>
        <td class="vta-acciones">
          <button class="btn-icono" data-editar="${c.id}" title="Editar">✏️</button>
          <button class="btn-icono" data-borrar="${c.id}" title="Eliminar">🗑</button>
        </td>
      </tr>`;
  }

  function nFiltrosCli() {
    let n = 0;
    if (fEstadoCli.size !== ESTADOS_CLI.length) n++;
    if (fTipoCli.size) n++;
    if (fPresMin !== '' || fPresMax !== '') n++;
    return n;
  }
  function actualizarBadgeCli() {
    const b = document.getElementById('vcl-filtros-badge');
    if (!b) return;
    const n = nFiltrosCli();
    b.textContent = n;
    b.classList.toggle('oculto', n === 0);
  }

  // ---- Construye la UI de la sub-pestaña (una vez) ----
  function construirClientes() {
    if (cliConstruido) return;
    const panel = document.querySelector('#vista-ventas .sub-panel[data-panel-sub="clientes"]');
    if (!panel) return;
    panel.innerHTML = `
      <div class="barra-herramientas vta-prop-cab">
        <div class="reservas-controles">
          <input type="search" id="vcl-buscar" class="input-buscar" placeholder="Buscar por nombre, email, teléfono..." autocomplete="off">
          <div class="rsv-filtros-wrap">
            <button id="vcl-filtros-btn" class="btn-sec">🔽 Filtros <span id="vcl-filtros-badge" class="rsv-filtros-badge oculto"></span></button>
            <div id="vcl-filtros-panel" class="rsv-filtros-panel oculto"></div>
          </div>
          <span id="vcl-contador" class="alo-contador"></span>
        </div>
        <div class="vta-prop-acciones"><button id="vcl-nuevo" class="btn-pri">＋ Nuevo cliente</button></div>
      </div>
      <div class="tabla-scroll">
        <table class="tabla" id="tabla-clientes">
          <thead><tr>
            <th>Nombre</th><th>Teléfono</th><th>Email</th><th>Busca</th>
            <th>Presupuesto</th><th>Visitas</th><th>Estado</th><th></th>
          </tr></thead>
          <tbody></tbody>
        </table>
      </div>`;

    // Filtros.
    const fpanel = document.getElementById('vcl-filtros-panel');
    const estItems = ESTADOS_CLI.map((e) =>
      `<label class="rsv-f-op"><input type="checkbox" data-f="estado" value="${e}" checked><span class="rsv-f-op-label">${e}</span></label>`).join('');
    const tipoItems = TIPOS_CLI.map((t) =>
      `<label class="rsv-f-op"><input type="checkbox" data-f="tipo" value="${t}"><span class="rsv-f-op-label">${t}</span></label>`).join('');
    fpanel.innerHTML = `
      <div class="rsv-f-grupo"><div class="rsv-f-titulo">Estado</div><div class="rsv-f-ops">${estItems}</div></div>
      <div class="rsv-f-grupo"><div class="rsv-f-titulo">Qué busca · Tipo</div><div class="rsv-f-ops">${tipoItems}</div></div>
      <div class="rsv-f-grupo">
        <div class="rsv-f-titulo">Presupuesto (€)</div>
        <div class="vta-f-precio">
          <input type="number" id="vcl-f-pmin" class="input-fecha" placeholder="Desde" min="0">
          <input type="number" id="vcl-f-pmax" class="input-fecha" placeholder="Hasta" min="0">
        </div>
      </div>
      <div class="rsv-f-grupo"><button id="vcl-f-limpiar" class="btn-sec">Limpiar filtros</button></div>`;

    fpanel.addEventListener('change', (e) => {
      const chk = e.target.closest('input[type="checkbox"][data-f]');
      if (!chk) return;
      const set = chk.dataset.f === 'estado' ? fEstadoCli : fTipoCli;
      if (chk.checked) set.add(chk.value); else set.delete(chk.value);
      renderTablaCli();
    });
    fpanel.querySelector('#vcl-f-pmin').addEventListener('input', (e) => { fPresMin = e.target.value; renderTablaCli(); });
    fpanel.querySelector('#vcl-f-pmax').addEventListener('input', (e) => { fPresMax = e.target.value; renderTablaCli(); });
    fpanel.querySelector('#vcl-f-limpiar').addEventListener('click', () => {
      fEstadoCli = new Set(ESTADOS_CLI); fTipoCli = new Set(); fPresMin = ''; fPresMax = '';
      fpanel.querySelectorAll('input[data-f="estado"]').forEach((c) => { c.checked = true; });
      fpanel.querySelectorAll('input[data-f="tipo"]').forEach((c) => { c.checked = false; });
      fpanel.querySelector('#vcl-f-pmin').value = ''; fpanel.querySelector('#vcl-f-pmax').value = '';
      renderTablaCli();
    });

    // Toggle del panel.
    const fbtn = document.getElementById('vcl-filtros-btn');
    const abrir = (v) => fpanel.classList.toggle('oculto', !v);
    fbtn.addEventListener('click', (e) => { e.stopPropagation(); abrir(fpanel.classList.contains('oculto')); });
    fpanel.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => abrir(false));

    document.getElementById('vcl-buscar').addEventListener('input', (e) => { cliBusqueda = e.target.value; renderTablaCli(); });
    document.getElementById('vcl-nuevo').addEventListener('click', () => modalCliente(null));

    cliConstruido = true;
  }

  // ---- Panel lateral (ficha de cliente) ----
  function crearPanelCli() {
    if (document.getElementById('vcl-panel')) return;
    const fondo = document.createElement('div');
    fondo.id = 'vcl-panel-fondo';
    fondo.className = 'panel-fondo';
    const panel = document.createElement('aside');
    panel.id = 'vcl-panel';
    panel.className = 'panel-lateral';
    panel.setAttribute('aria-label', 'Ficha de cliente');
    panel.innerHTML = `
      <header class="panel-cabecera">
        <div class="rsv-titulo-grupo">
          <h3 id="vcl-d-titulo">Cliente</h3>
          <span id="vcl-d-badge"></span>
        </div>
        <div class="panel-cabecera-acciones">
          <div class="vta-estado-drop">
            <button id="vcl-d-estado" class="btn-sec">Cambiar estado ▾</button>
            <div id="vcl-d-estado-menu" class="vta-estado-menu oculto"></div>
          </div>
          <button id="vcl-d-editar" class="btn-sec">✏️ Editar</button>
          <button id="vcl-d-cerrar" class="panel-cerrar" title="Cerrar">&times;</button>
        </div>
      </header>
      <div id="vcl-d-cuerpo" class="panel-cuerpo"></div>`;
    document.body.appendChild(fondo);
    document.body.appendChild(panel);
    fondo.addEventListener('click', cerrarPanelCli);
    panel.querySelector('#vcl-d-cerrar').addEventListener('click', cerrarPanelCli);
    panel.querySelector('#vcl-d-editar').addEventListener('click', () => { if (clienteFicha) modalCliente(clienteFicha); });

    const menu = panel.querySelector('#vcl-d-estado-menu');
    menu.innerHTML = ESTADOS_CLI.map((e) => `<button class="vta-estado-op" data-est="${e}">${estadoCliBadge(e)}</button>`).join('');
    panel.querySelector('#vcl-d-estado').addEventListener('click', (e) => {
      e.stopPropagation(); menu.classList.toggle('oculto');
    });
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('[data-est]');
      if (!b) return;
      menu.classList.add('oculto');
      cambiarEstadoCli(b.dataset.est);
    });
    document.addEventListener('click', () => menu.classList.add('oculto'));
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const modalAbierto = !document.getElementById('modal-fondo').classList.contains('oculto');
      if (!modalAbierto && panel.classList.contains('abierto')) cerrarPanelCli();
    }, true);
  }
  function abrirPanelCli() {
    document.getElementById('vcl-panel-fondo').classList.add('abierto');
    document.getElementById('vcl-panel').classList.add('abierto');
  }
  function cerrarPanelCli() {
    document.getElementById('vcl-panel-fondo')?.classList.remove('abierto');
    document.getElementById('vcl-panel')?.classList.remove('abierto');
    clienteFicha = null;
  }

  async function abrirFichaCli(id) {
    crearPanelCli();
    let d;
    try { d = await API.get('/api/ventas/clientes/' + id); }
    catch (e) { return toast(e.message, 'error'); }
    clienteFicha = d;
    document.getElementById('vcl-d-titulo').textContent = [d.nombre, d.apellidos].filter(Boolean).join(' ') || 'Cliente';
    document.getElementById('vcl-d-badge').innerHTML = estadoCliBadge(d.estado);
    renderCuerpoCli(d);
    abrirPanelCli();
    cargarSugerencias(d);
  }
  async function recargarFichaCli() {
    if (!clienteFicha) return;
    const id = clienteFicha.id;
    try { clienteFicha = await API.get('/api/ventas/clientes/' + id); }
    catch (e) { return; }
    document.getElementById('vcl-d-titulo').textContent = [clienteFicha.nombre, clienteFicha.apellidos].filter(Boolean).join(' ') || 'Cliente';
    document.getElementById('vcl-d-badge').innerHTML = estadoCliBadge(clienteFicha.estado);
    renderCuerpoCli(clienteFicha);
    cargarSugerencias(clienteFicha);
  }

  async function cambiarEstadoCli(estado) {
    if (!clienteFicha) return;
    try {
      await API.put('/api/ventas/clientes/' + clienteFicha.id, { estado });
      clienteFicha.estado = estado;
      document.getElementById('vcl-d-badge').innerHTML = estadoCliBadge(estado);
      toast('Estado actualizado a ' + estado, 'ok');
      cargarClientes();
    } catch (e) { toast(e.message, 'error'); }
  }

  function renderCuerpoCli(d) {
    // DATOS PERSONALES
    const datos = `
      <div class="vta-d-seccion">
        <div class="vta-d-titulo-sec">👤 Datos personales</div>
        <div class="vta-d-grid">
          ${dato('Nombre', esc(d.nombre) || '—')}
          ${dato('Apellidos', esc(d.apellidos) || '—')}
          ${dato('Teléfono', d.telefono ? `<a class="vta-link" href="tel:${esc(d.telefono)}">${esc(d.telefono)}</a>` : '—')}
          ${dato('Email', d.email ? `<a class="vta-link" href="mailto:${esc(d.email)}">${esc(d.email)}</a>` : '—')}
          ${dato('Origen', esc(d.origen) || '—')}
          ${dato('Fecha alta', fechaES((d.created_at || '').slice(0, 10)))}
        </div>
      </div>`;

    // QUÉ BUSCA
    const chips = [];
    if (d.busca_tipo && d.busca_tipo !== 'Indiferente') chips.push(`<span class="vta-busca-chip">${esc(d.busca_tipo)}</span>`);
    if (d.busca_dormitorios) chips.push(`<span class="vta-busca-chip">${esc(d.busca_dormitorios)} dormitorios</span>`);
    if (d.busca_zona) chips.push(`<span class="vta-busca-chip">📍 ${esc(d.busca_zona)}</span>`);
    if (d.busca_linea && d.busca_linea !== 'Indiferente') chips.push(`<span class="vta-busca-chip">${esc(d.busca_linea)}</span>`);
    if (d.busca_frontal) chips.push('<span class="vta-busca-chip vta-chip-on">Frontal</span>');
    if (d.busca_villa) chips.push('<span class="vta-busca-chip vta-chip-on">Villa/Casa</span>');
    const busca = `
      <div class="vta-d-seccion">
        <div class="vta-d-titulo-sec">🔎 Qué busca</div>
        <div class="vta-busca-chips">${chips.join('') || '<span class="vta-muted">Sin preferencias definidas</span>'}</div>
        ${d.presupuesto_max ? `<div class="vta-busca-pres">Hasta <strong>${euro(d.presupuesto_max)}</strong></div>` : ''}
      </div>`;

    // PROPIEDADES SUGERIDAS (relleno asíncrono)
    const sugeridas = `
      <div class="vta-d-seccion">
        <div class="vta-d-titulo-sec">🏠 Propiedades sugeridas</div>
        <div id="vcl-sugeridas"><div class="vta-muted">Buscando coincidencias…</div></div>
      </div>`;

    // HISTORIAL DE VISITAS
    const visitas = (d.visitas || []).map((v) => `
      <div class="vta-visita-item">
        <div class="vta-visita-top">
          <span class="vta-visita-fecha">${fechaES(v.fecha)}${v.hora ? ' · ' + esc(v.hora) : ''}</span>
          <span class="vta-bdg ${visitaBadgeClase(v.estado)}">${esc(v.estado)}</span>
        </div>
        <div class="vta-visita-cli">🏠 ${propsResumen(v)}</div>
        ${v.valoracion ? `<div class="vta-visita-val"><em>⭐ ${esc(v.valoracion)}</em></div>` : ''}
      </div>`).join('') || '<div class="vta-muted">Sin visitas registradas</div>';
    const histVisitas = `
      <div class="vta-d-seccion"><div class="vta-d-titulo-sec">📅 Historial de visitas</div>${visitas}</div>`;

    // NOTAS
    const notas = `
      <div class="vta-d-seccion">
        <div class="vta-d-titulo-sec">📝 Notas</div>
        <textarea id="vcl-d-notas" class="vta-d-textarea" rows="3" placeholder="Notas del cliente...">${esc(d.notas)}</textarea>
        <div class="vta-d-guardar-wrap"><button class="btn-pri" id="vcl-d-guardar-notas">Guardar</button></div>
      </div>`;

    document.getElementById('vcl-d-cuerpo').innerHTML = datos + busca + sugeridas + histVisitas + notas;

    document.getElementById('vcl-d-guardar-notas').addEventListener('click', async () => {
      const btn = document.getElementById('vcl-d-guardar-notas');
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        await API.put('/api/ventas/clientes/' + d.id, { notas: val('vcl-d-notas') });
        clienteFicha.notas = val('vcl-d-notas');
        toast('Guardado', 'ok');
      } catch (e) { toast(e.message, 'error'); }
      finally { btn.disabled = false; btn.textContent = 'Guardar'; }
    });
  }

  function visitaBadgeClase(e) {
    return e === 'Realizada' ? 'vta-bdg-disp' : e === 'Cancelada' ? 'vta-bdg-cli-desc' : 'vta-bdg-visita';
  }

  // Carga propiedades disponibles y muestra hasta 5 que cumplan las preferencias.
  async function cargarSugerencias(c) {
    const cont = document.getElementById('vcl-sugeridas');
    if (!cont) return;
    let disponibles;
    try { disponibles = await API.get('/api/ventas/propiedades?estado=Disponible'); }
    catch (e) { cont.innerHTML = '<div class="vta-muted">No se pudieron cargar las sugerencias.</div>'; return; }

    const match = disponibles.filter((p) => {
      if (c.busca_tipo && c.busca_tipo !== 'Indiferente' && p.tipo !== c.busca_tipo) return false;
      if (c.busca_dormitorios && (Number(p.dormitorios) || 0) < Number(c.busca_dormitorios)) return false;
      if (c.presupuesto_max && Number(p.precio || 0) > Number(c.presupuesto_max)) return false;
      return true;
    }).slice(0, 5);

    if (!match.length) {
      cont.innerHTML = '<div class="vta-muted">No hay propiedades que coincidan con las preferencias</div>';
      return;
    }
    cont.innerHTML = match.map((p) => `
      <div class="vta-sug-card">
        <div class="vta-sug-info">
          <div class="vta-sug-ref">${esc(p.referencia)} <span class="vta-sug-precio">${euro(p.precio)}</span></div>
          <div class="vta-sug-detalle">${esc(p.calle) || '—'} · ${p.dormitorios ?? '—'} dorm · ${p.metros_cuadrados ?? '—'} m²</div>
        </div>
        <button class="btn-sec vta-sug-btn" data-visita="${p.id}">📅 Programar visita</button>
      </div>`).join('');
    cont.querySelectorAll('[data-visita]').forEach((b) =>
      b.addEventListener('click', () => modalProgramarVisita(c, match.find((p) => p.id == b.dataset.visita))));
  }

  // ---- Modal programar visita (cliente + propiedad prerellenados) ----
  function modalProgramarVisita(cliente, prop) {
    if (!cliente || !prop) return;
    const hoy = new Date();
    const hoyISO = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
    abrirModal(`
      <h3>📅 Programar visita</h3>
      <div class="vta-pv-resumen">
        <div>👤 <strong>${esc([cliente.nombre, cliente.apellidos].filter(Boolean).join(' '))}</strong></div>
        <div>🏠 <strong>${esc(prop.referencia)}</strong> · ${esc(prop.calle) || '—'} · ${euro(prop.precio)}</div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Fecha *</label><input type="date" id="pv-fecha" value="${hoyISO}"></div>
        <div class="campo"><label>Hora</label><input type="time" id="pv-hora"></div>
      </div>
      <div class="campo"><label>Atendido por</label><input id="pv-atendido"></div>
      <div class="campo"><label>Notas</label><textarea id="pv-notas" rows="2"></textarea></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="pv-cancelar">Cancelar</button>
        <button class="btn-pri" id="pv-guardar">Programar</button>
      </div>`);
    document.getElementById('pv-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('pv-guardar').addEventListener('click', async () => {
      const fecha = val('pv-fecha');
      if (!fecha) return toast('La fecha es obligatoria', 'error');
      const btn = document.getElementById('pv-guardar');
      btn.disabled = true; btn.textContent = 'Programando…';
      try {
        await API.post('/api/ventas/visitas', {
          cliente_id: cliente.id, propiedad_id: prop.id, fecha,
          hora: val('pv-hora'), atendido_por: val('pv-atendido'), notas: val('pv-notas'),
        });
        cerrarModal();
        toast('Visita programada', 'ok');
        if (clienteFicha && clienteFicha.id === cliente.id) await recargarFichaCli();
        cargarClientes();
      } catch (e) {
        toast(e.message, 'error'); // 409 si ya existe esa visita en esa fecha
        btn.disabled = false; btn.textContent = 'Programar';
      }
    });
  }

  // ---- Modal nuevo / editar cliente ----
  // onSaved(nuevoId): callback opcional tras crear (lo usa Nueva visita para preseleccionar).
  function modalCliente(c, onSaved) {
    const esNuevo = !c;
    c = c || {};
    const selOrigen = ['', 'Idealista', 'Llamada', 'Referido', 'Oficina', 'Otro']
      .map((o) => `<option value="${o}"${(c.origen || '') === o ? ' selected' : ''}>${o || '— Origen —'}</option>`).join('');
    const selTipo = ['Indiferente', 'Piso', 'Ático', 'Casa', 'Villa']
      .map((t) => `<option value="${t}"${(c.busca_tipo || 'Indiferente') === t ? ' selected' : ''}>${t}</option>`).join('');
    const selDorm = [['', 'Indiferente'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4+']]
      .map(([v, l]) => `<option value="${v}"${String(c.busca_dormitorios || '') === v ? ' selected' : ''}>${l}</option>`).join('');
    const selLinea = ['Indiferente', '1ª Línea', '2ª Línea']
      .map((l) => `<option value="${l}"${(c.busca_linea || 'Indiferente') === l ? ' selected' : ''}>${l}</option>`).join('');

    abrirModal(`
      <h3>${esNuevo ? '＋ Nuevo cliente' : '✏️ Editar cliente'}</h3>
      <div class="vta-modal-sub">Datos personales</div>
      <div class="fila-campos">
        <div class="campo"><label>Nombre *</label><input id="cf-nombre" value="${esc(c.nombre)}"></div>
        <div class="campo"><label>Apellidos</label><input id="cf-apellidos" value="${esc(c.apellidos)}"></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Teléfono</label><input id="cf-telefono" value="${esc(c.telefono)}"></div>
        <div class="campo"><label>Email</label><input id="cf-email" value="${esc(c.email)}"></div>
      </div>
      <div class="campo"><label>Origen</label><select id="cf-origen">${selOrigen}</select></div>
      <div class="campo"><label>Notas</label><textarea id="cf-notas" rows="2">${esc(c.notas)}</textarea></div>
      <div class="vta-modal-sub">Qué busca</div>
      <div class="fila-campos">
        <div class="campo"><label>Tipo preferido</label><select id="cf-busca_tipo">${selTipo}</select></div>
        <div class="campo"><label>Dormitorios</label><select id="cf-busca_dormitorios">${selDorm}</select></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Zona</label><input id="cf-busca_zona" value="${esc(c.busca_zona)}"></div>
        <div class="campo"><label>Línea</label><select id="cf-busca_linea">${selLinea}</select></div>
      </div>
      <div class="fila-campos">
        <label class="toggle-campo"><input type="checkbox" id="cf-busca_frontal"${c.busca_frontal ? ' checked' : ''}><span>Busca frontal</span></label>
        <label class="toggle-campo"><input type="checkbox" id="cf-busca_villa"${c.busca_villa ? ' checked' : ''}><span>Busca villa o casa independiente</span></label>
      </div>
      <div class="campo"><label>Presupuesto máximo (€)</label><input type="number" min="0" id="cf-presupuesto_max" value="${c.presupuesto_max ?? ''}"></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="cf-cancelar">Cancelar</button>
        <button class="btn-pri" id="cf-guardar">${esNuevo ? 'Crear' : 'Guardar'}</button>
      </div>`);
    document.querySelector('.modal').classList.add('modal-ancho');
    document.getElementById('cf-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('cf-guardar').addEventListener('click', () => guardarCliente(esNuevo ? null : c.id, onSaved));
  }

  async function guardarCliente(id, onSaved) {
    const nombre = val('cf-nombre').trim();
    if (!nombre) return toast('El nombre es obligatorio', 'error');
    const chk = (idc) => { const el = document.getElementById(idc); return el && el.checked ? 1 : 0; };
    const tipo = val('cf-busca_tipo');
    const linea = val('cf-busca_linea');
    const body = {
      nombre,
      apellidos: val('cf-apellidos'),
      telefono: val('cf-telefono'),
      email: val('cf-email'),
      origen: val('cf-origen'),
      notas: val('cf-notas'),
      busca_tipo: tipo === 'Indiferente' ? '' : tipo,
      busca_dormitorios: val('cf-busca_dormitorios'),
      busca_zona: val('cf-busca_zona'),
      busca_linea: linea === 'Indiferente' ? '' : linea,
      busca_frontal: chk('cf-busca_frontal'),
      busca_villa: chk('cf-busca_villa'),
      presupuesto_max: val('cf-presupuesto_max'),
    };
    const btn = document.getElementById('cf-guardar');
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      let nuevoId = null;
      if (id) await API.put('/api/ventas/clientes/' + id, body);
      else { const r = await API.post('/api/ventas/clientes', body); nuevoId = r && r.id; }
      cerrarModal();
      if (cliConstruido) await cargarClientes();
      cargarResumen();
      if (clienteFicha && id && clienteFicha.id === id) await recargarFichaCli();
      toast(id ? 'Cliente actualizado' : 'Cliente creado', 'ok');
      if (!id && nuevoId && typeof onSaved === 'function') onSaved(nuevoId);
    } catch (e) {
      toast(e.message, 'error');
      btn.disabled = false; btn.textContent = id ? 'Guardar' : 'Crear';
    }
  }

  async function borrarCliente(c) {
    if (!c) return;
    if (!confirm(`¿Eliminar el cliente ${[c.nombre, c.apellidos].filter(Boolean).join(' ')}?`)) return;
    try {
      await API.del('/api/ventas/clientes/' + c.id);
      await cargarClientes();
      cargarResumen();
      toast('Cliente eliminado', 'ok');
    } catch (e) { toast(e.message, 'error'); } // 409 si tiene visitas
  }

  // ============================================================
  //                    SUB-PESTAÑA VISITAS
  // ============================================================
  let visitas = [];
  let visConstruido = false;
  let visModo = 'dia';            // 'dia' | 'semana' | 'mes'
  let visFecha = hoyStr();        // día seleccionado (modo 'dia')
  let visBusqueda = '';
  let visEstado = '';             // '' = todas
  // Estado del modal Nueva visita (para restaurar selección al crear cliente nuevo).
  let nvCliente = null;
  let nvProps = [];               // propiedades seleccionadas (multi-select)
  let nvClientesCache = [];
  let nvPropsCache = [];
  let nvUsuarios = [];
  let nvFechaPre = null;          // fecha preseleccionada (clic en celda del calendario)

  function hoyStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function isoDe(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function rangoVisitas() {
    if (visModo === 'dia') return [visFecha, visFecha];
    const t = new Date();
    if (visModo === 'semana') {
      const dow = (t.getDay() + 6) % 7; // Lun=0
      const lun = new Date(t); lun.setDate(t.getDate() - dow);
      const dom = new Date(lun); dom.setDate(lun.getDate() + 6);
      return [isoDe(lun), isoDe(dom)];
    }
    const ini = new Date(t.getFullYear(), t.getMonth(), 1);
    const fin = new Date(t.getFullYear(), t.getMonth() + 1, 0);
    return [isoDe(ini), isoDe(fin)];
  }

  function visitaBadge(e) {
    return `<span class="vta-bdg ${visitaBadgeClase(e)}">${esc(e)}</span>`;
  }
  function valoracionBadge(v) {
    if (!v) return '';
    const m = {
      'Le encantó': 'vta-bdg-disp', 'Interesado': 'vta-bdg-visita',
      'Indiferente': 'vta-bdg-cli-nuevo', 'No le gustó': 'vta-bdg-cli-desc',
    };
    return `<span class="vta-bdg ${m[v] || 'vta-bdg-cli-nuevo'}">${esc(v)}</span>`;
  }

  async function cargarVisitas() {
    const tbody = document.querySelector('#tabla-visitas tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="vta-cargando">Cargando visitas…</td></tr>';
    try { visitas = await API.get('/api/ventas/visitas'); }
    catch (e) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="vta-cargando">No se pudieron cargar las visitas.</td></tr>';
      return toast(e.message, 'error');
    }
    renderVisitas();
    renderVisitasHoy();
  }

  function clienteNomVis(v) { return [v.cliente_nombre, v.cliente_apellidos].filter(Boolean).join(' '); }

  // Propiedades de una visita (N:M). Cae al campo compat si el array no viene.
  function propsDeV(v) {
    if (Array.isArray(v.propiedades) && v.propiedades.length) return v.propiedades;
    if (v.propiedad_id) return [{ id: v.propiedad_id, referencia: v.propiedad_referencia, calle: v.propiedad_calle, precio: v.propiedad_precio }];
    return [];
  }
  // ¿Alguna propiedad de la visita está ya vendida?
  function visitaVendida(v) { return propsDeV(v).some((p) => p.estado === 'Vendida'); }
  // Resumen de refs: "A417, A381 +1 más" si hay más de 2.
  function propsResumen(v) {
    const refs = propsDeV(v).map((p) => p.referencia).filter(Boolean);
    if (!refs.length) return '—';
    if (refs.length <= 2) return refs.map(esc).join(', ');
    return `${esc(refs[0])}, ${esc(refs[1])} <span class="vta-muted">+${refs.length - 2} más</span>`;
  }

  function renderVisitas() {
    const tbody = document.querySelector('#tabla-visitas tbody');
    if (!tbody) return;
    const [desde, hasta] = rangoVisitas();
    const q = visBusqueda.trim().toLowerCase();
    const lista = visitas.filter((v) => {
      if (v.fecha < desde || v.fecha > hasta) return false;
      if (visEstado && v.estado !== visEstado) return false;
      if (q) {
        const txt = `${clienteNomVis(v)} ${propsDeV(v).map((p) => `${p.referencia || ''} ${p.calle || ''}`).join(' ')}`.toLowerCase();
        if (!txt.includes(q)) return false;
      }
      return true;
    });

    if (!lista.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="vta-vacio">No hay visitas en este periodo.</td></tr>';
      return;
    }
    tbody.innerHTML = lista.map((v) => `
      <tr data-detalle="${v.id}">
        <td>${fechaES(v.fecha)}</td>
        <td>${esc(v.hora) || '—'}</td>
        <td><a class="vta-ref" data-cli="${v.cliente_id}">${esc(clienteNomVis(v))}</a></td>
        <td>${propsResumen(v)}</td>
        <td>${v.estado === 'Realizada' ? valoracionBadge(v.valoracion) : '—'}</td>
        <td>${visitaVendida(v) ? '<span class="vta-bdg vta-bdg-disp">Venta cerrada</span>' : visitaBadge(v.estado)}</td>
        <td class="vta-acciones">
          <button class="btn-icono" data-editar="${v.id}" title="Editar">✏️</button>
          ${v.estado === 'Programada' ? `<button class="btn-icono" data-realizar="${v.id}" title="Marcar realizada">✅</button>` : ''}
          ${v.estado === 'Realizada' && !visitaVendida(v) ? `<button class="btn-icono" data-convertir="${v.id}" title="Convertir a venta">💰</button>` : ''}
          <button class="btn-icono" data-borrar="${v.id}" title="Eliminar">🗑</button>
        </td>
      </tr>`).join('');

    tbody.querySelectorAll('tr[data-detalle]').forEach((tr) =>
      tr.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target.closest('[data-cli]') || e.target.closest('[data-prop]')) return;
        modalDetalleVisita(tr.dataset.detalle);
      }));
    tbody.querySelectorAll('[data-cli]').forEach((a) =>
      a.addEventListener('click', (e) => { e.stopPropagation(); irACliente(a.dataset.cli); }));
    tbody.querySelectorAll('[data-prop]').forEach((a) =>
      a.addEventListener('click', (e) => { e.stopPropagation(); abrirFicha(a.dataset.prop); }));
    tbody.querySelectorAll('[data-editar]').forEach((b) =>
      b.addEventListener('click', (e) => { e.stopPropagation(); modalEditarVisita(visitas.find((v) => v.id == b.dataset.editar)); }));
    tbody.querySelectorAll('[data-realizar]').forEach((b) =>
      b.addEventListener('click', (e) => { e.stopPropagation(); modalRealizar(visitas.find((v) => v.id == b.dataset.realizar)); }));
    tbody.querySelectorAll('[data-convertir]').forEach((b) =>
      b.addEventListener('click', (e) => { e.stopPropagation(); modalConvertirVenta(visitas.find((v) => v.id == b.dataset.convertir)); }));
    tbody.querySelectorAll('[data-borrar]').forEach((b) =>
      b.addEventListener('click', (e) => { e.stopPropagation(); borrarVisita(visitas.find((v) => v.id == b.dataset.borrar)); }));
  }

  // Sección destacada "Visitas de hoy" (solo cuando el modo es día y el día es hoy).
  async function renderVisitasHoy() {
    const cont = document.getElementById('vvi-hoy');
    if (!cont) return;
    if (!(visModo === 'dia' && visFecha === hoyStr())) { cont.innerHTML = ''; return; }
    let hoy;
    try { hoy = await API.get('/api/ventas/visitas/hoy'); }
    catch (e) { cont.innerHTML = ''; return; }
    if (!hoy.length) {
      cont.innerHTML = '<div class="vta-vis-hoy-titulo">Visitas de hoy</div><div class="vta-muted vta-vis-hoy-vacio">Sin visitas programadas para hoy</div>';
      return;
    }
    cont.innerHTML = '<div class="vta-vis-hoy-titulo">Visitas de hoy</div>' +
      '<div class="vta-vis-hoy-grid">' + hoy.map(cardHoyHTML).join('') + '</div>';
    cont.querySelectorAll('[data-realizar]').forEach((b) =>
      b.addEventListener('click', () => modalRealizar(hoy.find((v) => v.id == b.dataset.realizar))));
    cont.querySelectorAll('[data-cancelar]').forEach((b) =>
      b.addEventListener('click', () => cancelarVisita(hoy.find((v) => v.id == b.dataset.cancelar))));
  }

  function cardHoyHTML(v) {
    const tel = v.cliente_telefono
      ? ` — 📞 <a class="vta-link" href="tel:${esc(v.cliente_telefono)}">${esc(v.cliente_telefono)}</a>` : '';
    return `
      <div class="vta-hoy-card">
        <div class="vta-hoy-top">
          <span class="vta-hoy-hora">📅 ${esc(v.hora) || 'Sin hora'}</span>
          ${visitaBadge(v.estado)}
        </div>
        <div class="vta-hoy-cli">👤 ${esc(clienteNomVis(v))}${tel}</div>
        <div class="vta-hoy-prop">🏠 ${esc(v.propiedad_referencia)}${v.propiedad_calle ? ' — ' + esc(v.propiedad_calle) : ''} · ${euro(v.propiedad_precio)}</div>
        ${v.atendido_por ? `<div class="vta-hoy-aten">Atendido por: ${esc(v.atendido_por)}</div>` : ''}
        <div class="vta-hoy-acc">
          <button class="btn-pri vta-hoy-btn" data-realizar="${v.id}">✅ Marcar realizada</button>
          <button class="btn-sec vta-hoy-btn" data-cancelar="${v.id}">❌ Cancelar</button>
        </div>
      </div>`;
  }

  function irACliente(id) {
    const tab = document.querySelector('#vta-subtabs .subtab[data-sub="clientes"]');
    if (tab) tab.click();
    abrirFichaCli(id);
  }

  // ---- Marcar realizada ----
  function modalRealizar(v) {
    if (!v) return;
    abrirModal(`
      <h3>✅ Marcar visita como realizada</h3>
      <div class="vta-pv-resumen">
        <div>👤 <strong>${esc(clienteNomVis(v))}</strong></div>
        <div>🏠 <strong>${esc(v.propiedad_referencia)}</strong>${v.propiedad_calle ? ' · ' + esc(v.propiedad_calle) : ''}</div>
      </div>
      <div class="campo"><label>Valoración</label>
        <select id="vr-valoracion">
          <option value="">— Sin valorar —</option>
          <option value="Le encantó">Le encantó</option>
          <option value="Interesado">Interesado</option>
          <option value="Indiferente">Indiferente</option>
          <option value="No le gustó">No le gustó</option>
        </select></div>
      <div class="campo"><label>Notas</label>
        <textarea id="vr-notas" rows="3" placeholder="¿Cómo fue la visita? ¿Qué comentó el cliente?"></textarea></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="vr-cancelar">Cancelar</button>
        <button class="btn-pri" id="vr-guardar">Guardar</button>
      </div>`);
    document.getElementById('vr-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('vr-guardar').addEventListener('click', async () => {
      const btn = document.getElementById('vr-guardar');
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        await API.post(`/api/ventas/visitas/${v.id}/realizar`, { valoracion: val('vr-valoracion'), notas: val('vr-notas') });
        cerrarModal();
        await cargarVisitas();
        cargarResumen();
        toast('Visita marcada como realizada', 'ok');
      } catch (e) {
        toast(e.message, 'error');
        btn.disabled = false; btn.textContent = 'Guardar';
      }
    });
  }

  // ---- Convertir visita a venta ----
  async function modalConvertirVenta(v) {
    if (!v) return;
    const props = propsDeV(v).filter((p) => p.estado !== 'Vendida'); // candidatas a vender
    if (!props.length) return toast('No hay propiedades disponibles para vender en esta visita', 'error');

    let cli = null;
    try { cli = await API.get('/api/ventas/clientes/' + v.cliente_id); } catch (e) { cli = null; }
    const cliNombre = cli ? [cli.nombre, cli.apellidos].filter(Boolean).join(' ') : clienteNomVis(v);
    const cliTel = (cli && cli.telefono) || v.cliente_telefono || '';
    const cliEmail = (cli && cli.email) || '';

    const unica = props.length === 1;
    const propLinea = (p) => `${esc(p.referencia)} — ${esc(p.calle) || '—'}${p.planta ? ', Planta ' + esc(p.planta) : ''} — ${euro(p.precio)}`;
    const selectorHTML = unica
      ? `<div class="vta-pv-resumen"><div>🏠 <strong>${propLinea(props[0])}</strong></div></div>
         <input type="hidden" id="cv-prop" value="${props[0].id}" data-precio="${props[0].precio}">`
      : `<div class="campo"><label>¿Qué propiedad se ha vendido?</label>
          <div class="cv-prop-lista" style="display:flex;flex-direction:column;gap:6px;margin-top:4px">
          ${props.map((p, i) => `
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="radio" name="cv-prop" value="${p.id}" data-precio="${p.precio}"${i === 0 ? ' checked' : ''}>
              <span>${propLinea(p)} <span class="vta-muted">(precio publicado)</span></span></label>`).join('')}
          </div></div>`;

    abrirModal(`
      <h3>💰 Convertir visita a venta</h3>
      ${selectorHTML}
      <div class="fila-campos">
        <div class="campo"><label>Precio de venta final (€) *</label><input type="number" step="0.01" min="0" id="cv-precio"></div>
        <div class="campo"><label>Diferencia vs. publicado</label><div id="cv-diff" style="padding-top:8px;font-weight:600">—</div></div>
      </div>
      <div class="campo"><label>Comprador</label>
        <div style="display:flex;gap:16px;margin:4px 0 8px;flex-wrap:wrap">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="radio" name="cv-modo" value="cliente" checked> Usar datos del cliente de la visita</label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="radio" name="cv-modo" value="manual"> Introducir manualmente</label>
        </div>
      </div>
      <div id="cv-cliente" class="vta-pv-resumen">
        <div>👤 <strong>${esc(cliNombre) || '—'}</strong></div>
        ${cliTel ? `<div>📞 ${esc(cliTel)}</div>` : ''}
        ${cliEmail ? `<div>✉️ ${esc(cliEmail)}</div>` : ''}
      </div>
      <div id="cv-manual" style="display:none">
        <div class="fila-campos">
          <div class="campo"><label>Nombre</label><input id="cv-m-nombre" value="${esc(cliNombre)}"></div>
          <div class="campo"><label>Teléfono</label><input id="cv-m-tel" value="${esc(cliTel)}"></div>
        </div>
        <div class="campo"><label>Email</label><input id="cv-m-email" value="${esc(cliEmail)}"></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Fecha de venta</label><input type="date" id="cv-fventa" value="${hoyStr()}"></div>
        <div class="campo"><label>Fecha de escrituración</label><input type="date" id="cv-fescritura"></div>
      </div>
      <div class="modal-acciones">
        <button class="btn-sec" id="cv-cancelar">Cancelar</button>
        <button class="btn-pri" id="cv-guardar">💰 Registrar venta</button>
      </div>`);
    document.querySelector('.modal').classList.add('modal-ancho');

    const selRadio = () => document.querySelector('input[name="cv-prop"]:checked') || document.getElementById('cv-prop');
    const precioPub = () => { const r = selRadio(); return r ? Number(r.dataset.precio) : 0; };
    const selId = () => { const r = selRadio(); return r ? Number(r.value) : null; };
    const recalc = () => {
      const diff = document.getElementById('cv-diff');
      const fin = parseFloat(val('cv-precio'));
      if (isNaN(fin)) { diff.textContent = '—'; diff.style.color = 'var(--muted)'; return; }
      const d = fin - precioPub();
      const pct = precioPub() > 0 ? (d / precioPub()) * 100 : 0;
      const signo = d > 0 ? '+' : d < 0 ? '−' : '';
      diff.textContent = `${signo}${euro(Math.abs(d))} (${signo}${Math.abs(pct).toFixed(1)}%)`;
      diff.style.color = d < 0 ? 'var(--red)' : d > 0 ? 'var(--green)' : 'var(--muted)';
    };

    document.querySelectorAll('input[name="cv-prop"]').forEach((r) =>
      r.addEventListener('change', () => { document.getElementById('cv-precio').value = r.dataset.precio; recalc(); }));
    document.getElementById('cv-precio').value = precioPub();
    recalc();
    document.getElementById('cv-precio').addEventListener('input', recalc);

    document.querySelectorAll('input[name="cv-modo"]').forEach((r) =>
      r.addEventListener('change', () => {
        const manual = document.querySelector('input[name="cv-modo"]:checked').value === 'manual';
        document.getElementById('cv-cliente').style.display = manual ? 'none' : '';
        document.getElementById('cv-manual').style.display = manual ? '' : 'none';
      }));

    document.getElementById('cv-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('cv-guardar').addEventListener('click', async () => {
      const propId = selId();
      if (propId === null) return toast('Selecciona la propiedad vendida', 'error');
      const precio = parseFloat(val('cv-precio'));
      if (isNaN(precio) || precio <= 0) return toast('Indica el precio de venta final', 'error');
      const manual = document.querySelector('input[name="cv-modo"]:checked').value === 'manual';
      const body = {
        propiedad_id: propId,
        precio_venta_final: precio,
        fecha_venta: val('cv-fventa'),
        fecha_escritura: val('cv-fescritura'),
        comprador_nombre: manual ? val('cv-m-nombre') : cliNombre,
        comprador_telefono: manual ? val('cv-m-tel') : cliTel,
        comprador_email: manual ? val('cv-m-email') : cliEmail,
      };
      const btn = document.getElementById('cv-guardar');
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        const r = await API.post(`/api/ventas/visitas/${v.id}/convertir-venta`, body);
        cerrarModal();
        await cargarVisitas();
        cargarResumen();
        toast(`Venta registrada — ${r.referencia} vendida por ${euro(r.precio_venta_final)}`, 'ok');
      } catch (e) {
        toast(e.message, 'error');
        btn.disabled = false; btn.textContent = '💰 Registrar venta';
      }
    });
  }

  async function cancelarVisita(v) {
    if (!v) return;
    if (!confirm('¿Cancelar esta visita?')) return;
    try {
      await API.put('/api/ventas/visitas/' + v.id, { estado: 'Cancelada' });
      await cargarVisitas();
      cargarResumen();
      toast('Visita cancelada', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function borrarVisita(v) {
    if (!v) return;
    if (!confirm('¿Eliminar esta visita?')) return;
    try {
      await API.del('/api/ventas/visitas/' + v.id);
      await cargarVisitas();
      cargarResumen();
      toast('Visita eliminada', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  }

  // ---- Editar visita (estado / valoración / fecha / hora / propiedades) ----
  async function modalEditarVisita(v) {
    if (!v) return;
    // Propiedades actuales de la visita (N:M); cae al campo compat si no vienen.
    let veProps = propsDeV(v).map((p) => ({ id: p.id, referencia: p.referencia, calle: p.calle, precio: p.precio }));
    // Catálogo de propiedades buscables; añade las actuales si no están (pueden no estar Disponibles).
    let cache = [];
    try { cache = await API.get('/api/ventas/propiedades?estado=Disponible'); }
    catch (e) { return toast(e.message, 'error'); }
    for (const p of veProps) {
      if (!cache.some((c) => c.id === p.id)) cache = [p, ...cache];
    }

    const selEstado = ['Programada', 'Realizada', 'Cancelada']
      .map((e) => `<option value="${e}"${v.estado === e ? ' selected' : ''}>${e}</option>`).join('');
    const selVal = ['', 'Le encantó', 'Interesado', 'Indiferente', 'No le gustó']
      .map((o) => `<option value="${o}"${(v.valoracion || '') === o ? ' selected' : ''}>${o || '— Sin valorar —'}</option>`).join('');
    abrirModal(`
      <h3>✏️ Editar visita</h3>
      <div class="vta-pv-resumen">
        <div>👤 <strong>${esc(clienteNomVis(v))}</strong></div>
      </div>
      ${selectorPropsHTML()}
      <div class="fila-campos">
        <div class="campo"><label>Fecha</label><input type="date" id="ve-fecha" value="${esc(v.fecha)}"></div>
        <div class="campo"><label>Hora</label><input type="time" id="ve-hora" value="${esc(v.hora)}"></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Estado</label><select id="ve-estado">${selEstado}</select></div>
        <div class="campo"><label>Valoración</label><select id="ve-valoracion">${selVal}</select></div>
      </div>
      <div class="campo"><label>Atendido por</label><input id="ve-atendido" value="${esc(v.atendido_por)}"></div>
      <div class="campo"><label>Notas</label><textarea id="ve-notas" rows="2">${esc(v.notas)}</textarea></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="ve-cancelar">Cancelar</button>
        <button class="btn-pri" id="ve-guardar">Guardar</button>
      </div>`);

    montarSelectorProps(cache, () => veProps, (a) => { veProps = a; });
    document.getElementById('modal-contenido').addEventListener('click', (e) => {
      if (!e.target.closest('.vta-ta')) {
        const pr = document.getElementById('nv-prop-res');
        if (pr) pr.classList.add('oculto');
      }
    });

    document.getElementById('ve-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('ve-guardar').addEventListener('click', async () => {
      if (!veProps.length) return toast('Selecciona al menos una propiedad', 'error');
      const btn = document.getElementById('ve-guardar');
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        await API.put('/api/ventas/visitas/' + v.id, {
          propiedad_ids: veProps.map((p) => p.id),
          fecha: val('ve-fecha'), hora: val('ve-hora'), estado: val('ve-estado'),
          valoracion: val('ve-valoracion'), atendido_por: val('ve-atendido'), notas: val('ve-notas'),
        });
        cerrarModal();
        await cargarVisitas();
        toast('Visita actualizada', 'ok');
      } catch (e) {
        toast(e.message, 'error');
        btn.disabled = false; btn.textContent = 'Guardar';
      }
    });
  }

  // ---- Modal detalle de visita (con notas tipo chat) ----
  async function modalDetalleVisita(id) {
    let v, cli;
    try {
      v = await API.get('/api/ventas/visitas/' + id);
      cli = await API.get('/api/ventas/clientes/' + v.cliente_id).catch(() => null);
    } catch (e) { return toast(e.message, 'error'); }

    const buscaTxt = cli ? resumenBusca(cli) : '—';
    const notasHTML = (v.notas_lista_render = (v.notas || []).map((n) => `
      <div class="vta-nota">
        <div class="vta-nota-cab"><strong>${esc(n.usuario_nombre) || 'Usuario'}</strong>
          <span class="vta-nota-fecha">${fmtFechaHora(n.fecha)}</span></div>
        <div class="vta-nota-texto">${esc(n.texto).replace(/\n/g, '<br>')}</div>
      </div>`).join('')) || '<div class="vta-muted">Sin notas todavía.</div>';

    abrirModal(`
      <h3>Visita · ${fechaES(v.fecha)}${v.hora ? ' ' + esc(v.hora) : ''}</h3>
      <div class="vta-det-grid">
        <div class="vta-det-col">
          <div class="vta-d-titulo-sec">Datos de la visita</div>
          <div class="vta-det-linea">Estado: ${visitaBadge(v.estado)}${visitaVendida(v) ? ' <span class="vta-bdg vta-bdg-disp">Vendida ✓</span>' : ''}</div>
          <div class="vta-det-linea">Fecha: ${fechaES(v.fecha)}${v.hora ? ' · ' + esc(v.hora) : ''}</div>
          <div class="vta-det-linea">Atendido por: ${esc(v.atendido_por) || '—'}</div>
          ${v.estado === 'Realizada' ? `<div class="vta-det-linea">Valoración: ${valoracionBadge(v.valoracion) || '—'}</div>` : ''}
        </div>
        <div class="vta-det-col">
          <div class="vta-d-titulo-sec">Cliente</div>
          <div class="vta-det-linea"><strong>${esc(clienteNomVis(v))}</strong></div>
          ${v.cliente_telefono ? `<div class="vta-det-linea">📞 <a class="vta-link" href="tel:${esc(v.cliente_telefono)}">${esc(v.cliente_telefono)}</a></div>` : ''}
          ${cli && cli.email ? `<div class="vta-det-linea">✉️ <a class="vta-link" href="mailto:${esc(cli.email)}">${esc(cli.email)}</a></div>` : ''}
          <div class="vta-det-linea vta-muted">Busca: ${esc(buscaTxt)}</div>
        </div>
        <div class="vta-det-col">
          <div class="vta-d-titulo-sec">Propiedades</div>
          ${propsDeV(v).map((p) => `
            <div style="border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;margin-bottom:6px">
              <div style="font-weight:600;color:#1e293b">${esc(p.referencia)}</div>
              <div style="font-size:12px;color:#64748b">${esc(p.calle) || '—'}</div>
              <div style="font-size:13px;color:#2563eb;font-weight:600">${euro(p.precio)}</div>
            </div>`).join('') || '<div class="vta-det-linea">—</div>'}
        </div>
      </div>
      <div class="vta-d-titulo-sec" style="margin-top:14px">📝 Notas</div>
      <div class="vta-notas-lista" id="vd-notas">${notasHTML}</div>
      <div class="vta-nota-input">
        <textarea id="vd-nota-texto" rows="2" placeholder="Añadir una nota..."></textarea>
        <button class="btn-pri" id="vd-nota-enviar">Enviar</button>
      </div>
      <div class="modal-acciones">
        ${v.estado === 'Realizada' && !visitaVendida(v) ? '<button class="btn-pri" id="vd-convertir">💰 Convertir a venta</button>' : ''}
        <button class="btn-sec" id="vd-cerrar">Cerrar</button>
      </div>`);
    document.querySelector('.modal').classList.add('modal-ancho');
    document.getElementById('vd-cerrar').addEventListener('click', cerrarModal);
    const btnConv = document.getElementById('vd-convertir');
    if (btnConv) btnConv.addEventListener('click', () => modalConvertirVenta(v));

    const enviar = async () => {
      const ta = document.getElementById('vd-nota-texto');
      const texto = (ta.value || '').trim();
      if (!texto) return;
      const btn = document.getElementById('vd-nota-enviar');
      btn.disabled = true;
      try {
        await API.post(`/api/ventas/visitas/${id}/notas`, { texto });
        modalDetalleVisita(id); // recarga el modal con la nota nueva
      } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
    };
    document.getElementById('vd-nota-enviar').addEventListener('click', enviar);
    document.getElementById('vd-nota-texto').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); }
    });
  }

  // ---- Selector múltiple de propiedades (reutilizado en nueva / editar visita) ----
  // Usa ids fijos nv-prop-* para heredar el CSS; los modales nunca coexisten.
  function selectorPropsHTML() {
    return `
      <div class="campo vta-ta">
        <label>Propiedades *</label>
        <div id="nv-prop-pills" class="vta-nv-pills" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px"></div>
        <input id="nv-prop-input" class="input-buscar" autocomplete="off" placeholder="Buscar propiedad por referencia o calle...">
        <div id="nv-prop-res" class="vta-ta-res oculto"></div>
        <div id="nv-prop-contador" class="vta-nv-contador" style="font-size:12px;color:#6b7280;margin-top:4px"></div>
      </div>`;
  }

  // cache = propiedades buscables; getSel/setSel acceden al array de seleccionadas.
  function montarSelectorProps(cache, getSel, setSel) {
    const propInput = document.getElementById('nv-prop-input');
    const propRes = document.getElementById('nv-prop-res');
    const propPills = document.getElementById('nv-prop-pills');
    const propContador = document.getElementById('nv-prop-contador');

    // Pinta las propiedades seleccionadas como pills + actualiza el contador.
    function pintarProps() {
      const sel = getSel();
      propPills.innerHTML = sel.map((p) =>
        `<span class="vta-nv-pill" data-id="${p.id}" style="display:inline-flex;align-items:center;gap:5px;background:#eef2ff;color:#3730a3;border:1px solid #c7d2fe;border-radius:14px;padding:3px 6px 3px 10px;font-size:13px">${esc(p.referencia)} <button type="button" class="vta-nv-pill-x" data-quitar="${p.id}" style="border:0;background:none;color:#6366f1;cursor:pointer;font-size:13px;line-height:1;padding:0">✕</button></span>`).join('');
      propContador.textContent = sel.length
        ? `${sel.length} propiedad${sel.length === 1 ? '' : 'es'} seleccionada${sel.length === 1 ? '' : 's'}`
        : '';
      propPills.querySelectorAll('[data-quitar]').forEach((b) =>
        b.addEventListener('click', () => {
          setSel(getSel().filter((p) => p.id !== Number(b.dataset.quitar)));
          pintarProps();
          if (propInput.value.trim().length >= 2) renderResultados();
        }));
    }

    // Lista de resultados con checkbox (solo con ≥2 caracteres).
    function renderResultados() {
      const q = propInput.value.trim().toLowerCase();
      if (q.length < 2) { propRes.classList.add('oculto'); propRes.innerHTML = ''; return; }
      const items = cache.filter((p) =>
        `${p.referencia} ${p.calle || ''}`.toLowerCase().includes(q)).slice(0, 12);
      if (!items.length) { propRes.classList.add('oculto'); propRes.innerHTML = ''; return; }
      const sel = getSel();
      propRes.innerHTML = items.map((p) => {
        const marcada = sel.some((s) => s.id === p.id);
        return `<label class="vta-ta-item vta-nv-check" style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" data-pid="${p.id}"${marcada ? ' checked' : ''}> ${esc(p.referencia)} · ${esc(p.calle) || '—'} · ${euro(p.precio)}</label>`;
      }).join('');
      propRes.classList.remove('oculto');
      propRes.querySelectorAll('input[data-pid]').forEach((chk) =>
        chk.addEventListener('change', () => {
          const pid = Number(chk.dataset.pid);
          const prop = cache.find((p) => p.id === pid);
          if (chk.checked) { if (!getSel().some((s) => s.id === pid)) setSel([...getSel(), prop]); }
          else { setSel(getSel().filter((p) => p.id !== pid)); }
          pintarProps();
        }));
    }

    propInput.addEventListener('input', renderResultados);
    pintarProps();
  }

  // ---- Modal nueva visita (typeahead cliente + propiedad) ----
  async function modalNuevaVisita() {
    // Carga de catálogos (clientes, propiedades disponibles, usuarios) bajo demanda.
    try {
      const [cls, props, usr] = await Promise.all([
        API.get('/api/ventas/clientes'),
        API.get('/api/ventas/propiedades?estado=Disponible'),
        API.get('/api/usuarios').catch(() => []),
      ]);
      nvClientesCache = cls; nvPropsCache = props; nvUsuarios = usr;
    } catch (e) { return toast(e.message, 'error'); }

    const optUsr = '<option value="">— Sin asignar —</option>' +
      nvUsuarios.filter((u) => u.activo).map((u) => `<option value="${esc(u.nombre)}">${esc(u.nombre)}</option>`).join('');
    const hoy = nvFechaPre || hoyStr();
    nvFechaPre = null;

    abrirModal(`
      <h3>📅 Nueva visita</h3>
      <div class="campo vta-ta">
        <label>Cliente *</label>
        <input id="nv-cli-input" class="input-buscar" autocomplete="off" placeholder="Buscar cliente..." value="${nvCliente ? esc([nvCliente.nombre, nvCliente.apellidos].filter(Boolean).join(' ')) : ''}">
        <div id="nv-cli-res" class="vta-ta-res oculto"></div>
        <button type="button" class="btn-sec vta-nv-crear" id="nv-cli-crear">＋ Crear cliente nuevo</button>
      </div>
      ${selectorPropsHTML()}
      <div class="fila-campos">
        <div class="campo"><label>Fecha *</label><input type="date" id="nv-fecha" value="${hoy}"></div>
        <div class="campo"><label>Hora</label><input type="time" id="nv-hora"></div>
      </div>
      <div class="campo"><label>Atendido por</label><select id="nv-atendido">${optUsr}</select></div>
      <div class="campo"><label>Notas</label><textarea id="nv-notas" rows="2"></textarea></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="nv-cancelar">Cancelar</button>
        <button class="btn-pri" id="nv-guardar">Programar</button>
      </div>`);

    const cliInput = document.getElementById('nv-cli-input');
    const cliRes = document.getElementById('nv-cli-res');
    cliInput.addEventListener('input', () => { nvCliente = null; renderTA(cliRes, nvClientesCache.filter((c) =>
      `${c.nombre} ${c.apellidos || ''} ${c.telefono || ''} ${c.email || ''}`.toLowerCase().includes(cliInput.value.trim().toLowerCase())),
      (c) => `${esc([c.nombre, c.apellidos].filter(Boolean).join(' '))}${c.telefono ? ' · ' + esc(c.telefono) : ''}`,
      (c) => { nvCliente = c; cliInput.value = [c.nombre, c.apellidos].filter(Boolean).join(' '); cliRes.classList.add('oculto'); }); });

    montarSelectorProps(nvPropsCache, () => nvProps, (a) => { nvProps = a; });

    document.getElementById('modal-contenido').addEventListener('click', (e) => {
      if (!e.target.closest('.vta-ta')) {
        cliRes.classList.add('oculto');
        const pr = document.getElementById('nv-prop-res');
        if (pr) pr.classList.add('oculto');
      }
    });

    document.getElementById('nv-cli-crear').addEventListener('click', () => {
      // Abre el modal de cliente; al crear, vuelve a Nueva visita con ese cliente preseleccionado.
      modalCliente(null, async (nuevoId) => {
        try { nvCliente = await API.get('/api/ventas/clientes/' + nuevoId); } catch (e) {}
        modalNuevaVisita();
      });
    });

    document.getElementById('nv-cancelar').addEventListener('click', () => { nvCliente = null; nvProps = []; cerrarModal(); });
    document.getElementById('nv-guardar').addEventListener('click', guardarNuevaVisita);
  }

  // Typeahead genérico: pinta resultados y cablea la selección.
  function renderTA(cont, lista, label, onPick) {
    if (!cont) return;
    const items = lista.slice(0, 8);
    if (!items.length) { cont.classList.add('oculto'); cont.innerHTML = ''; return; }
    cont.innerHTML = items.map((it, i) => `<div class="vta-ta-item" data-i="${i}">${label(it)}</div>`).join('');
    cont.classList.remove('oculto');
    cont.querySelectorAll('.vta-ta-item').forEach((el) =>
      el.addEventListener('click', () => onPick(items[Number(el.dataset.i)])));
  }

  async function guardarNuevaVisita() {
    if (!nvCliente) return toast('Selecciona un cliente', 'error');
    if (!nvProps.length) return toast('Selecciona al menos una propiedad', 'error');
    const fecha = val('nv-fecha');
    if (!fecha) return toast('La fecha es obligatoria', 'error');
    const btn = document.getElementById('nv-guardar');
    btn.disabled = true; btn.textContent = 'Programando…';
    try {
      await API.post('/api/ventas/visitas', {
        cliente_id: nvCliente.id, propiedad_ids: nvProps.map((p) => p.id), fecha,
        hora: val('nv-hora'), atendido_por: val('nv-atendido'), notas: val('nv-notas'),
      });
      const n = nvProps.length;
      nvCliente = null; nvProps = [];
      cerrarModal();
      await cargarVisitas();
      cargarResumen();
      toast(n > 1 ? `Visita programada (${n} propiedades)` : 'Visita programada', 'ok');
    } catch (e) {
      toast(e.message, 'error'); // 409 si ya existe
      btn.disabled = false; btn.textContent = 'Programar';
    }
  }

  // ---- Construye la UI de Visitas (una vez) ----
  function construirVisitas() {
    if (visConstruido) return;
    const panel = document.querySelector('#vista-ventas .sub-panel[data-panel-sub="visitas"]');
    if (!panel) return;
    panel.innerHTML = `
      <div class="barra-herramientas vta-vis-cab">
        <div class="reservas-controles">
          <input type="date" id="vvi-fecha" class="input-fecha" value="${visFecha}">
          <div class="filtro-tih-btns" id="vvi-rango">
            <button class="btn-filtro-tih activo" data-rango="dia">Hoy</button>
            <button class="btn-filtro-tih" data-rango="semana">Esta semana</button>
            <button class="btn-filtro-tih" data-rango="mes">Este mes</button>
          </div>
          <input type="search" id="vvi-buscar" class="input-buscar" placeholder="Buscar por cliente o propiedad..." autocomplete="off">
          <div class="filtro-tih-btns" id="vvi-estado">
            <button class="btn-filtro-tih activo" data-est="">Todas</button>
            <button class="btn-filtro-tih" data-est="Programada">Programadas</button>
            <button class="btn-filtro-tih" data-est="Realizada">Realizadas</button>
            <button class="btn-filtro-tih" data-est="Cancelada">Canceladas</button>
          </div>
        </div>
        <div class="vta-prop-acciones"><button id="vvi-nueva" class="btn-pri">＋ Nueva visita</button></div>
      </div>
      <div id="vvi-hoy" class="vta-vis-hoy"></div>
      <div class="tabla-scroll">
        <table class="tabla" id="tabla-visitas">
          <thead><tr>
            <th>Fecha</th><th>Hora</th><th>Cliente</th><th>Propiedad</th><th>Valoración</th><th>Estado</th><th></th>
          </tr></thead>
          <tbody></tbody>
        </table>
      </div>`;

    const fechaInp = document.getElementById('vvi-fecha');
    fechaInp.addEventListener('change', (e) => {
      visFecha = e.target.value || hoyStr();
      visModo = 'dia';
      document.querySelectorAll('#vvi-rango .btn-filtro-tih').forEach((x) => x.classList.toggle('activo', x.dataset.rango === 'dia'));
      cargarVisitas();
    });
    document.querySelectorAll('#vvi-rango .btn-filtro-tih').forEach((b) =>
      b.addEventListener('click', () => {
        visModo = b.dataset.rango;
        if (visModo === 'dia') { visFecha = hoyStr(); fechaInp.value = visFecha; }
        document.querySelectorAll('#vvi-rango .btn-filtro-tih').forEach((x) => x.classList.toggle('activo', x === b));
        cargarVisitas();
      }));
    document.querySelectorAll('#vvi-estado .btn-filtro-tih').forEach((b) =>
      b.addEventListener('click', () => {
        visEstado = b.dataset.est;
        document.querySelectorAll('#vvi-estado .btn-filtro-tih').forEach((x) => x.classList.toggle('activo', x === b));
        renderVisitas();
      }));
    document.getElementById('vvi-buscar').addEventListener('input', (e) => { visBusqueda = e.target.value; renderVisitas(); });
    document.getElementById('vvi-nueva').addEventListener('click', () => { nvCliente = null; nvProps = []; modalNuevaVisita(); });

    visConstruido = true;
  }

  // Formato fecha+hora para las notas (igual que en mantenimiento).
  function fmtFechaHora(s) {
    if (!s) return '—';
    const [d, t] = String(s).split(' ');
    const p = d.split('-');
    if (p.length !== 3) return s;
    return `${p[2]}/${p[1]}/${p[0]}${t ? ' ' + t.slice(0, 5) : ''}`;
  }

  // ============================================================
  //                    SUB-PESTAÑA CALENDARIO
  // ============================================================
  let calConstruido = false;
  let calVisitas = [];            // todas las visitas (se filtran por mes en cliente)
  const _calIni = new Date();
  let calAnio = _calIni.getFullYear();
  let calMes = _calIni.getMonth(); // 0-11

  const CAL_MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const CAL_DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

  function hoyPartes() {
    const d = new Date();
    return { a: d.getFullYear(), m: d.getMonth(), d: d.getDate() };
  }
  function apellidoCorto(v) {
    return (v.cliente_apellidos || v.cliente_nombre || '').trim() || '—';
  }
  function puntoEstado(e) {
    return `<span class="vca-punto ${visitaBadgeClase(e)}"></span>`;
  }

  function construirCalendario() {
    if (calConstruido) return;
    const panel = document.querySelector('#vista-ventas .sub-panel[data-panel-sub="calendario"]');
    if (!panel) return;
    panel.innerHTML = `
      <div class="barra-herramientas vca-cab">
        <div class="vca-nav">
          <button class="btn-sec vca-flecha" id="vca-prev" title="Mes anterior">◀</button>
          <span class="vca-titulo" id="vca-titulo"></span>
          <button class="btn-sec vca-flecha" id="vca-next" title="Mes siguiente">▶</button>
          <button class="btn-sec" id="vca-hoy">Hoy</button>
        </div>
        <div class="vca-leyenda">
          <span class="vta-bdg vta-bdg-visita">Programada</span>
          <span class="vta-bdg vta-bdg-disp">Realizada</span>
          <span class="vta-bdg vta-bdg-cli-desc">Cancelada</span>
        </div>
      </div>
      <div class="vca-grid-wrap">
        <div class="vca-semana vca-cab-dias">${CAL_DIAS.map((d) => `<div class="vca-dia-cab">${d}</div>`).join('')}</div>
        <div id="vca-grid"></div>
      </div>
      <div id="vca-lista" class="vca-lista"></div>`;

    panel.querySelector('#vca-prev').addEventListener('click', () => moverMes(-1));
    panel.querySelector('#vca-next').addEventListener('click', () => moverMes(1));
    panel.querySelector('#vca-hoy').addEventListener('click', () => {
      const h = hoyPartes(); calAnio = h.a; calMes = h.m; renderCalendario();
    });
    calConstruido = true;
  }

  function moverMes(delta) {
    calMes += delta;
    if (calMes < 0) { calMes = 11; calAnio--; }
    else if (calMes > 11) { calMes = 0; calAnio++; }
    renderCalendario();
  }

  async function cargarCalendario() {
    // No tocamos backend: cargamos todas las visitas y filtramos por mes en el cliente.
    try { calVisitas = await API.get('/api/ventas/visitas'); }
    catch (e) { return toast(e.message, 'error'); }
    renderCalendario();
  }

  // Agrupa las visitas del mes mostrado por día (ISO -> [visitas] ordenadas por hora).
  function visitasPorDia() {
    const mesStr = `${calAnio}-${String(calMes + 1).padStart(2, '0')}`;
    const porDia = {};
    calVisitas.forEach((v) => {
      if (!v.fecha || String(v.fecha).slice(0, 7) !== mesStr) return;
      (porDia[v.fecha] = porDia[v.fecha] || []).push(v);
    });
    Object.values(porDia).forEach((arr) =>
      arr.sort((a, b) => String(a.hora || '').localeCompare(String(b.hora || ''))));
    return porDia;
  }

  function renderCalendario() {
    const titulo = document.getElementById('vca-titulo');
    if (titulo) titulo.textContent = `${CAL_MESES[calMes]} ${calAnio}`;
    const porDia = visitasPorDia();
    renderGrid(porDia);
    renderLista(porDia);
  }

  function renderGrid(porDia) {
    const grid = document.getElementById('vca-grid');
    if (!grid) return;
    const hoy = hoyPartes();
    const offset = (new Date(calAnio, calMes, 1).getDay() + 6) % 7; // Lun=0
    const diasMes = new Date(calAnio, calMes + 1, 0).getDate();

    const celdas = [];
    for (let i = 0; i < offset; i++) celdas.push('<div class="vca-celda vca-relleno"></div>');
    for (let d = 1; d <= diasMes; d++) {
      const iso = `${calAnio}-${String(calMes + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dow = (offset + d - 1) % 7;
      const finde = dow >= 5;
      const esHoy = (calAnio === hoy.a && calMes === hoy.m && d === hoy.d);
      const vis = porDia[iso] || [];
      const cards = vis.slice(0, 3).map((v) => `
        <div class="vca-mini" data-vis="${v.id}" title="${esc(clienteNomVis(v))} · ${esc(v.propiedad_referencia)}">
          ${puntoEstado(v.estado)}<span class="vca-mini-hora">${esc(v.hora) || ''}</span><span class="vca-mini-nom">${esc(apellidoCorto(v))}</span>
        </div>`).join('');
      const resto = vis.length - Math.min(vis.length, 3);
      const mas = resto > 0 ? `<div class="vca-mas" data-mas="${iso}">+${resto} más</div>` : '';
      celdas.push(`
        <div class="vca-celda${finde ? ' vca-finde' : ''}${esHoy ? ' vca-hoy' : ''}" data-dia="${iso}">
          <div class="vca-num">${d}</div>
          <div class="vca-visitas">${cards}${mas}</div>
        </div>`);
    }
    while (celdas.length % 7 !== 0) celdas.push('<div class="vca-celda vca-relleno"></div>');

    let html = '';
    for (let i = 0; i < celdas.length; i += 7) html += `<div class="vca-semana">${celdas.slice(i, i + 7).join('')}</div>`;
    grid.innerHTML = html;

    grid.querySelectorAll('.vca-mini').forEach((el) =>
      el.addEventListener('click', (e) => { e.stopPropagation(); modalDetalleVisita(el.dataset.vis); }));
    grid.querySelectorAll('.vca-mas').forEach((el) =>
      el.addEventListener('click', (e) => { e.stopPropagation(); abrirPopoverDia(el, porDia[el.dataset.mas] || []); }));
    grid.querySelectorAll('.vca-celda[data-dia]').forEach((el) =>
      el.addEventListener('click', () => nuevaVisitaEnFecha(el.dataset.dia)));
  }

  // Modo lista (móvil): solo días con visitas.
  function renderLista(porDia) {
    const cont = document.getElementById('vca-lista');
    if (!cont) return;
    const dias = Object.keys(porDia).sort();
    if (!dias.length) {
      cont.innerHTML = '<div class="vta-muted vca-lista-vacia">No hay visitas este mes.</div>';
      return;
    }
    cont.innerHTML = dias.map((iso) => `
      <div class="vca-lista-dia">
        <div class="vca-lista-fecha">${fechaES(iso)}</div>
        ${porDia[iso].map((v) => `
          <div class="vca-lista-item" data-vis="${v.id}">
            ${puntoEstado(v.estado)}
            <span class="vca-mini-hora">${esc(v.hora) || '—'}</span>
            <span class="vca-lista-nom">${esc(clienteNomVis(v))}</span>
            <span class="vca-lista-ref">${esc(v.propiedad_referencia)}</span>
            ${visitaBadge(v.estado)}
          </div>`).join('')}
      </div>`).join('');
    cont.querySelectorAll('[data-vis]').forEach((el) =>
      el.addEventListener('click', () => modalDetalleVisita(el.dataset.vis)));
  }

  function nuevaVisitaEnFecha(iso) {
    nvCliente = null; nvProps = []; nvFechaPre = iso;
    modalNuevaVisita();
  }

  // Popover con todas las visitas de un día (botón "+X más").
  function cerrarPopoverCal() { document.getElementById('vca-popover')?.remove(); }
  function abrirPopoverDia(anchor, visitas) {
    cerrarPopoverCal();
    const pop = document.createElement('div');
    pop.id = 'vca-popover';
    pop.className = 'vca-popover';
    pop.innerHTML = `
      <div class="vca-pop-titulo">${fechaES(anchor.dataset.mas)} · ${visitas.length} visita${visitas.length === 1 ? '' : 's'}</div>
      ${visitas.map((v) => `
        <div class="vca-pop-item" data-vis="${v.id}">
          ${puntoEstado(v.estado)}<span class="vca-mini-hora">${esc(v.hora) || '—'}</span>
          <span class="vca-pop-nom">${esc(clienteNomVis(v))}</span>
          <span class="vca-pop-ref">${esc(v.propiedad_referencia)}</span>
        </div>`).join('')}`;
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.top = `${Math.min(r.bottom + 4, window.innerHeight - pop.offsetHeight - 8)}px`;
    pop.style.left = `${Math.min(r.left, window.innerWidth - pop.offsetWidth - 8)}px`;
    pop.querySelectorAll('[data-vis]').forEach((el) =>
      el.addEventListener('click', () => { cerrarPopoverCal(); modalDetalleVisita(el.dataset.vis); }));
    setTimeout(() => document.addEventListener('click', cerrarPopoverCal, { once: true }), 0);
  }

  // ============================================================
  //                    VENTA DE PROPIEDAD
  // ============================================================
  // Diferencia precio venta vs anuncio: { texto con signo, color }.
  function difVenta(anuncio, venta) {
    const d = (Number(venta) || 0) - (Number(anuncio) || 0);
    const abs = Math.abs(Math.round(d)).toLocaleString('de-DE') + ' €';
    if (d > 0) return { texto: '+' + abs, color: '#10b981', valor: d };
    if (d < 0) return { texto: '−' + abs, color: '#ef4444', valor: d };
    return { texto: '0 €', color: '#6b7280', valor: 0 };
  }

  async function modalVender(p) {
    if (!p) return;
    const dir = [p.calle, p.numero].filter(Boolean).join(' ') || p.zona || '';
    let vvClienteId = null;          // cliente comprador seleccionado (modo "existente")
    let vvClientes = [];             // catálogo de clientes para el typeahead

    abrirModal(`
      <h3>🏷️ Marcar como vendida</h3>
      <div class="vta-pv-resumen"><div>🏠 <strong>${esc(p.referencia)}</strong>${dir ? ' — ' + esc(dir) : ''}</div></div>
      <div class="campo"><label>Precio de venta final (€)</label><input type="number" min="0" id="vv-precio" value="${p.precio ?? ''}"></div>
      <div class="vta-modal-sub">Comprador</div>
      <div class="fila-campos" style="gap:16px">
        <label style="display:flex;align-items:center;gap:6px;font-size:14px"><input type="radio" name="vv-modo" value="cliente" checked> Seleccionar cliente existente</label>
        <label style="display:flex;align-items:center;gap:6px;font-size:14px"><input type="radio" name="vv-modo" value="manual"> Introducir manualmente</label>
      </div>
      <div class="campo vta-ta" id="vv-ta-wrap">
        <label>Buscar cliente</label>
        <input id="vv-cli-input" class="input-buscar" autocomplete="off" placeholder="Buscar por nombre, teléfono o email...">
        <div id="vv-cli-res" class="vta-ta-res oculto"></div>
      </div>
      <div class="campo"><label>Nombre</label><input id="vv-comp-nombre"></div>
      <div class="fila-campos">
        <div class="campo"><label>Teléfono</label><input id="vv-comp-tel"></div>
        <div class="campo"><label>Email</label><input id="vv-comp-email"></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Fecha de venta</label><input type="date" id="vv-fventa" value="${hoyStr()}"></div>
        <div class="campo"><label>Fecha de escrituración (opcional)</label><input type="date" id="vv-fescritura"></div>
      </div>
      <div class="modal-acciones">
        <button class="btn-sec" id="vv-cancelar">Cancelar</button>
        <button class="btn-pri" id="vv-guardar">Marcar vendida</button>
      </div>`);

    const inpNombre = document.getElementById('vv-comp-nombre');
    const inpTel = document.getElementById('vv-comp-tel');
    const inpEmail = document.getElementById('vv-comp-email');
    const taWrap = document.getElementById('vv-ta-wrap');
    const cliInput = document.getElementById('vv-cli-input');
    const cliRes = document.getElementById('vv-cli-res');

    // Campos del comprador en modo lectura (cliente existente) o editable (manual).
    function setLectura(ro) {
      [inpNombre, inpTel, inpEmail].forEach((el) => { el.readOnly = ro; el.style.background = ro ? '#f3f4f6' : ''; });
    }
    function limpiarComprador() {
      vvClienteId = null; inpNombre.value = ''; inpTel.value = ''; inpEmail.value = '';
    }
    function aplicarModo(modo) {
      limpiarComprador();
      cliInput.value = ''; cliRes.classList.add('oculto');
      taWrap.classList.toggle('oculto', modo !== 'cliente');
      setLectura(modo === 'cliente'); // existente: lectura hasta elegir; manual: editable
    }

    // Carga el catálogo de clientes para el typeahead.
    try { vvClientes = await API.get('/api/ventas/clientes'); } catch (e) { vvClientes = []; }

    document.querySelectorAll('input[name="vv-modo"]').forEach((r) =>
      r.addEventListener('change', () => aplicarModo(r.value)));

    cliInput.addEventListener('input', () => {
      vvClienteId = null; inpNombre.value = ''; inpTel.value = ''; inpEmail.value = '';
      const q = cliInput.value.trim().toLowerCase();
      renderTA(cliRes,
        vvClientes.filter((c) => `${c.nombre} ${c.apellidos || ''} ${c.telefono || ''} ${c.email || ''}`.toLowerCase().includes(q)),
        (c) => `${esc([c.nombre, c.apellidos].filter(Boolean).join(' '))}${c.telefono ? ' · ' + esc(c.telefono) : ''}`,
        (c) => {
          vvClienteId = c.id;
          cliInput.value = [c.nombre, c.apellidos].filter(Boolean).join(' ');
          inpNombre.value = [c.nombre, c.apellidos].filter(Boolean).join(' ');
          inpTel.value = c.telefono || '';
          inpEmail.value = c.email || '';
          cliRes.classList.add('oculto');
        });
    });

    aplicarModo('cliente'); // estado inicial

    document.getElementById('modal-contenido')?.addEventListener('click', (e) => {
      if (!e.target.closest('.vta-ta')) cliRes.classList.add('oculto');
    });

    document.getElementById('vv-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('vv-guardar').addEventListener('click', async () => {
      const btn = document.getElementById('vv-guardar');
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        await API.post(`/api/ventas/propiedades/${p.id}/vender`, {
          precio_venta_final: val('vv-precio'),
          comprador_nombre: val('vv-comp-nombre'),
          comprador_telefono: val('vv-comp-tel'),
          comprador_email: val('vv-comp-email'),
          fecha_venta: val('vv-fventa'),
          fecha_escritura: val('vv-fescritura'),
        });
        // Cliente existente: marcarlo como "Compró" (no rompe la venta si falla).
        if (vvClienteId) {
          try { await API.put('/api/ventas/clientes/' + vvClienteId, { estado: 'Compró' }); } catch (e) { /* venta ya guardada */ }
        }
        cerrarModal();
        await cargarPropiedades(); // la propiedad desaparece de la tabla principal
        cargarResumen();
        if (vendConstruido) cargarVendidos();
        toast('Propiedad vendida — movida a pestaña Vendidos', 'ok');
      } catch (e) { toast(e.message, 'error'); btn.disabled = false; btn.textContent = 'Marcar vendida'; }
    });
  }

  // Mini-modal para añadir la fecha de escrituración desde la ficha de una vendida.
  function modalAnadirEscritura(d) {
    const editando = !!d.fecha_escritura;
    abrirModal(`
      <h3>📜 ${editando ? 'Editar' : 'Añadir'} fecha de escrituración</h3>
      <div class="vta-pv-resumen"><div>🏠 <strong>${esc(d.referencia)}</strong></div></div>
      <div class="campo"><label>Fecha de escrituración</label><input type="date" id="vesc-fecha" value="${editando ? d.fecha_escritura : hoyStr()}"></div>
      <div class="modal-acciones">
        ${editando ? `<button class="btn-sec" id="vesc-quitar" style="margin-right:auto">🗑️ Quitar fecha</button>` : ''}
        <button class="btn-sec" id="vesc-cancelar">Cancelar</button>
        <button class="btn-pri" id="vesc-guardar">Guardar</button>
      </div>`);
    document.getElementById('vesc-cancelar').addEventListener('click', cerrarModal);
    const btnQuitar = document.getElementById('vesc-quitar');
    if (btnQuitar) btnQuitar.addEventListener('click', async () => {
      if (!confirm('¿Quitar la fecha de escrituración? La propiedad volverá a quedar pendiente de escriturar.')) return;
      try {
        await API.put('/api/ventas/propiedades/' + d.id, { fecha_escritura: null });
        cerrarModal();
        toast('Fecha de escrituración eliminada', 'ok');
        await abrirFicha(d.id);
        if (vendConstruido) cargarVendidos();
      } catch (e) { toast(e.message, 'error'); }
    });
    document.getElementById('vesc-guardar').addEventListener('click', async () => {
      try {
        await API.put('/api/ventas/propiedades/' + d.id, { fecha_escritura: val('vesc-fecha') });
        cerrarModal();
        toast('Fecha de escrituración guardada', 'ok');
        await abrirFicha(d.id);
        if (vendConstruido) cargarVendidos();
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  // Carga (cacheada) el listado de facturas para el buscador de asignar comisión.
  async function ensureFacturas() {
    if (!facturasCache) facturasCache = await API.get('/api/facturas');
    return facturasCache;
  }

  // Modal para buscar una factura ya existente y asignarla como comisión de comprador/vendedor.
  async function modalAsignarFactura(propiedadId, lado) {
    let facturas;
    try { facturas = await ensureFacturas(); } catch (e) { return toast(e.message, 'error'); }

    abrirModal(`
      <h3>＋ Asignar factura (${lado === 'comprador' ? 'comprador' : 'vendedor'})</h3>
      <div class="campo vta-ta">
        <label>Buscar por número o receptor</label>
        <input id="vaf-input" class="input-buscar" autocomplete="off" placeholder="Número o nombre del receptor...">
        <div id="vaf-res" class="vta-ta-res"></div>
      </div>
      <div class="modal-acciones">
        <button class="btn-sec" id="vaf-cancelar">Cancelar</button>
      </div>`);

    const input = document.getElementById('vaf-input');
    const cont = document.getElementById('vaf-res');

    const pintar = (lista) => {
      const items = lista.slice(0, 20);
      if (!items.length) { cont.innerHTML = '<div class="vta-ta-item" style="cursor:default;color:#9ca3af">Sin resultados</div>'; return; }
      cont.innerHTML = items.map((f) => `
        <div class="vta-ta-item" data-id="${f.id}">
          <strong>${esc(f.numero)}</strong> ${badgeFacEstado(f.estado)}
          <div style="font-size:12px;color:#6b7280">${esc(f.receptor_nombre) || '—'} · ${euro(f.total)}</div>
        </div>`).join('');
      cont.querySelectorAll('.vta-ta-item[data-id]').forEach((el) =>
        el.addEventListener('click', async () => {
          const facturaId = Number(el.dataset.id);
          try {
            await API.put('/api/ventas/propiedades/' + propiedadId, {
              [lado === 'comprador' ? 'factura_comprador_id' : 'factura_vendedor_id']: facturaId,
            });
            cerrarModal();
            await recargarFicha();
            toast('Factura asignada', 'ok');
          } catch (e) { toast(e.message, 'error'); }
        }));
    };

    pintar(facturas); // sin texto de búsqueda: muestra las más recientes (ya vienen ordenadas del backend)

    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      pintar(q ? facturas.filter((f) =>
        (f.numero || '').toLowerCase().includes(q) || (f.receptor_nombre || '').toLowerCase().includes(q)) : facturas);
    });

    document.getElementById('vaf-cancelar').addEventListener('click', cerrarModal);
  }

  // ============================================================
  //                    SUB-PESTAÑA VENDIDOS
  // ============================================================
  let vendidos = [];           // todas las propiedades Vendida
  let vendConstruido = false;
  let vendBusqueda = '';
  let vendAnio = new Date().getFullYear();

  function anioDe(iso) { return iso ? String(iso).slice(0, 4) : ''; }

  function construirVendidos() {
    if (vendConstruido) return;
    const panel = document.querySelector('#vista-ventas .sub-panel[data-panel-sub="vendidos"]');
    if (!panel) return;
    panel.innerHTML = `
      <div class="barra-herramientas vta-prop-cab">
        <div class="reservas-controles">
          <input type="search" id="vnd-buscar" class="input-buscar" placeholder="Buscar por referencia, calle, comprador..." autocomplete="off">
          <select id="vnd-anio" class="select-filtro"></select>
          <span id="vnd-contador" class="alo-contador"></span>
        </div>
        <div id="vnd-resumen" style="margin-left:auto;font-size:14px;color:var(--muted)"></div>
      </div>
      <div class="tabla-scroll">
        <table class="tabla" id="tabla-vendidos">
          <thead><tr>
            <th>Ref.</th><th>Apartamento</th><th>Precio anuncio</th><th>Precio venta</th>
            <th>Comprador</th><th>Fecha venta</th><th>Escritura</th><th>Comisión</th><th></th>
          </tr></thead>
          <tbody></tbody>
        </table>
      </div>`;
    document.getElementById('vnd-buscar').addEventListener('input', (e) => { vendBusqueda = e.target.value; renderVendidos(); });
    document.getElementById('vnd-anio').addEventListener('change', (e) => { vendAnio = e.target.value; renderVendidos(); });
    vendConstruido = true;
  }

  async function cargarVendidos() {
    const tbody = document.querySelector('#tabla-vendidos tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="9" class="vta-cargando">Cargando vendidos…</td></tr>';
    try { vendidos = await API.get('/api/ventas/propiedades?estado=Vendida'); }
    catch (e) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="9" class="vta-cargando">No se pudieron cargar las propiedades vendidas.</td></tr>';
      return toast(e.message, 'error');
    }
    renderVendidos();
  }

  function pintarSelectAnios() {
    const sel = document.getElementById('vnd-anio');
    if (!sel) return;
    const anios = new Set(vendidos.map((p) => anioDe(p.fecha_venta)).filter(Boolean));
    anios.add(String(new Date().getFullYear()));
    const lista = [...anios].sort((a, b) => b.localeCompare(a));
    if (!lista.includes(String(vendAnio))) vendAnio = lista[0];
    sel.innerHTML = lista.map((a) => `<option value="${a}"${String(vendAnio) === a ? ' selected' : ''}>${a}</option>`).join('');
  }

  function renderVendidos() {
    pintarSelectAnios();
    const tbody = document.querySelector('#tabla-vendidos tbody');
    if (!tbody) return;

    const delAnio = vendidos.filter((p) => anioDe(p.fecha_venta) === String(vendAnio));
    const q = vendBusqueda.trim().toLowerCase();
    const lista = delAnio.filter((p) => {
      if (!q) return true;
      return `${p.referencia || ''} ${p.apartamento_nombre || ''} ${p.calle || ''} ${p.comprador_nombre || ''}`.toLowerCase().includes(q);
    });

    const cont = document.getElementById('vnd-contador');
    if (cont) cont.textContent = `${delAnio.length} propiedad${delAnio.length === 1 ? '' : 'es'} vendida${delAnio.length === 1 ? '' : 's'} en ${vendAnio}`;
    const volumen = delAnio.reduce((s, p) => s + (Number(p.precio_venta_final) || 0), 0);
    const res = document.getElementById('vnd-resumen');
    if (res) res.innerHTML = `Volumen total: <strong>${euro(volumen)}</strong>`;

    if (!delAnio.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="vta-vacio">Sin propiedades vendidas en ' + vendAnio + '.</td></tr>';
      return;
    }
    if (!lista.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="vta-vacio">Ninguna coincide con la búsqueda.</td></tr>';
      return;
    }
    tbody.innerHTML = lista.map((p) => {
      const escritura = p.fecha_escritura
        ? fechaES(p.fecha_escritura)
        : '<span class="vta-bdg" style="background:#fffbeb;color:#b45309">Pendiente</span>';
      const sinFactura = '<span class="badge-fac-estado" style="background:#f3f4f6;color:#9ca3af">Sin factura</span>';
      const badgesComision = `
        <span title="Comprador">${p.fc_estado ? badgeFacEstado(p.fc_estado) : sinFactura}</span>
        <span title="Vendedor">${p.fv_estado ? badgeFacEstado(p.fv_estado) : sinFactura}</span>`;

      // total: comision_total si está rellenada; si no, se estima con las facturas ya asignadas.
      const cobrado = (Number(p.fc_pagado) || 0) + (Number(p.fv_pagado) || 0);
      let total = null, estimado = false;
      const comisionCompVend = ['comision_comprador', 'comision_vendedor']
        .map((c) => p[c]).filter((v) => v !== null && v !== undefined && v !== '');
      let tituloEstimado = '';
      if (p.comision_total !== null && p.comision_total !== undefined && p.comision_total !== '') {
        total = Number(p.comision_total);
      } else if (p.factura_comprador_id || p.factura_vendedor_id) {
        total = (Number(p.fc_total) || 0) + (Number(p.fv_total) || 0);
        estimado = true;
        tituloEstimado = 'Estimado a partir de las facturas asignadas';
      } else if (comisionCompVend.length) {
        total = comisionCompVend.reduce((s, v) => s + (Number(v) || 0), 0);
        estimado = true;
        tituloEstimado = 'Estimado a partir del reparto comprador/vendedor';
      }
      let progresoComision = '<div class="vta-muted" style="font-size:12px;margin-top:2px">—</div>';
      if (total !== null) {
        const colorCobrado = total > 0 && cobrado >= total - 0.01 ? 'var(--green)' : cobrado > 0 ? '#b45309' : '#9ca3af';
        const pct = total > 0 ? Math.min(100, Math.round((cobrado / total) * 100)) : 0;
        const tituloTotal = estimado ? ` title="${esc(tituloEstimado)}"` : '';
        progresoComision = `
          <div style="font-size:12px;font-weight:600;margin-top:2px;color:${colorCobrado}">${euro(cobrado)} <span${tituloTotal} style="color:var(--muted);font-weight:400">/ ${euro(total)}${estimado ? ' *' : ''}</span></div>
          <div class="pago-barra" style="margin:2px 0 0;width:90px"><div class="pago-barra-fill" style="width:${pct}%"></div></div>`;
      }
      const comisiones = badgesComision + progresoComision;
      return `
        <tr data-ficha="${p.id}">
          <td><a class="vta-ref" data-ref="${p.id}">${esc(p.referencia)}</a></td>
          <td>${esc(p.apartamento_nombre) || '—'}</td>
          <td class="vta-precio">${euro(p.precio)}</td>
          <td class="vta-precio">${euro(p.precio_venta_final)}</td>
          <td>${esc(p.comprador_nombre) || '—'}</td>
          <td>${fechaES(p.fecha_venta)}</td>
          <td>${escritura}</td>
          <td>${comisiones}</td>
          <td class="vta-acciones">
            <button class="btn-icono" data-editar="${p.id}" title="Editar">✏️</button>
          </td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('tr[data-ficha]').forEach((tr) =>
      tr.addEventListener('click', (e) => {
        if (e.target.closest('[data-editar]') || e.target.closest('[data-ref]')) return;
        abrirFicha(tr.dataset.ficha);
      }));
    tbody.querySelectorAll('[data-ref]').forEach((a) =>
      a.addEventListener('click', (e) => { e.stopPropagation(); abrirFicha(a.dataset.ref); }));
    tbody.querySelectorAll('[data-editar]').forEach((b) =>
      b.addEventListener('click', (e) => { e.stopPropagation(); modalFormulario(vendidos.find((p) => p.id == b.dataset.editar)); }));
  }

  // ============================================================
  //                    SUB-PESTAÑA PROPIETARIOS
  // ============================================================
  function nomPrv(p) { return [p.nombre, p.apellidos].filter(Boolean).join(' '); }

  // ---- Construye la UI (una vez) ----
  function construirPropvent() {
    if (prvConstruido) return;
    const panel = document.querySelector('#vista-ventas .sub-panel[data-panel-sub="propietarios"]');
    if (!panel) return;
    panel.innerHTML = `
      <div class="barra-herramientas vta-prop-cab">
        <div class="reservas-controles">
          <input type="search" id="prv-buscar" class="input-buscar" placeholder="Buscar por nombre, teléfono, email..." autocomplete="off">
          <span id="prv-contador" class="alo-contador"></span>
        </div>
        <div class="vta-prop-acciones">
          <button id="prv-importar" class="btn-sec">📥 Importar de alquileres</button>
          <button id="prv-nuevo" class="btn-pri">＋ Nuevo propietario</button>
        </div>
      </div>
      <div class="tabla-scroll">
        <table class="tabla" id="tabla-propvent">
          <thead><tr>
            <th>Nombre</th><th>Teléfono</th><th>Email</th><th>DNI</th><th>Propiedades</th><th></th>
          </tr></thead>
          <tbody></tbody>
        </table>
      </div>`;
    document.getElementById('prv-buscar').addEventListener('input', (e) => { prvBusqueda = e.target.value; renderTablaPrv(); });
    document.getElementById('prv-nuevo').addEventListener('click', () => modalPropvent(null));
    document.getElementById('prv-importar').addEventListener('click', modalImportarAlquiler);
    prvConstruido = true;
  }

  // ---- Carga + tabla ----
  async function cargarPropvent() {
    const tbody = document.querySelector('#tabla-propvent tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="vta-cargando">Cargando propietarios…</td></tr>';
    try { propvent = await API.get('/api/ventas/propietarios-venta'); }
    catch (e) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="vta-cargando">No se pudieron cargar los propietarios.</td></tr>';
      return toast(e.message, 'error');
    }
    renderTablaPrv();
  }

  function filtradasPrv() {
    const q = prvBusqueda.trim().toLowerCase();
    if (!q) return propvent;
    return propvent.filter((p) =>
      `${p.nombre || ''} ${p.apellidos || ''} ${p.email || ''} ${p.telefono || ''} ${p.dni || ''}`.toLowerCase().includes(q));
  }

  function renderTablaPrv() {
    const tbody = document.querySelector('#tabla-propvent tbody');
    if (!tbody) return;
    const lista = filtradasPrv();
    const cont = document.getElementById('prv-contador');
    if (cont) cont.textContent = `${lista.length} propietario${lista.length === 1 ? '' : 's'}`;

    if (!propvent.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="vta-vacio">No hay propietarios. Crea uno nuevo o impórtalo de alquileres.</td></tr>';
      return;
    }
    if (!lista.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="vta-vacio">Ningún propietario coincide con la búsqueda.</td></tr>';
      return;
    }
    tbody.innerHTML = lista.map((p) => {
      const np = p.num_propiedades || 0;
      const propCel = np > 0 ? `<span class="vta-visitas-badge">${np}</span>` : '<span class="vta-muted">0</span>';
      return `
        <tr data-ficha="${p.id}">
          <td><a class="vta-ref" data-nom="${p.id}">${esc(nomPrv(p)) || '—'}</a>${p.propietario_alquiler_id ? ' <span class="vta-bdg vta-bdg-prv" title="Importado de alquileres">🔗</span>' : ''}</td>
          <td>${esc(p.telefono) || '—'}</td>
          <td>${esc(p.email) || '—'}</td>
          <td>${esc(p.dni) || '—'}</td>
          <td>${propCel}</td>
          <td class="vta-acciones">
            <button class="btn-icono" data-editar="${p.id}" title="Editar">✏️</button>
            <button class="btn-icono" data-borrar="${p.id}" title="Eliminar">🗑</button>
          </td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('tr[data-ficha]').forEach((tr) =>
      tr.addEventListener('click', (e) => {
        if (e.target.closest('[data-editar]') || e.target.closest('[data-borrar]') || e.target.closest('[data-nom]')) return;
        abrirFichaPropvent(tr.dataset.ficha);
      }));
    tbody.querySelectorAll('[data-nom]').forEach((a) =>
      a.addEventListener('click', (e) => { e.stopPropagation(); abrirFichaPropvent(a.dataset.nom); }));
    tbody.querySelectorAll('[data-editar]').forEach((b) =>
      b.addEventListener('click', (e) => { e.stopPropagation(); modalPropvent(propvent.find((p) => p.id == b.dataset.editar)); }));
    tbody.querySelectorAll('[data-borrar]').forEach((b) =>
      b.addEventListener('click', (e) => { e.stopPropagation(); borrarPropvent(propvent.find((p) => p.id == b.dataset.borrar)); }));
  }

  // ---- Panel lateral (ficha) ----
  function crearPanelPrv() {
    if (document.getElementById('prv-panel')) return;
    const fondo = document.createElement('div');
    fondo.id = 'prv-panel-fondo';
    fondo.className = 'panel-fondo';
    const panel = document.createElement('aside');
    panel.id = 'prv-panel';
    panel.className = 'panel-lateral';
    panel.setAttribute('aria-label', 'Ficha de propietario');
    panel.innerHTML = `
      <header class="panel-cabecera">
        <div class="rsv-titulo-grupo">
          <h3 id="prv-d-titulo">Propietario</h3>
          <span id="prv-d-badge"></span>
        </div>
        <div class="panel-cabecera-acciones">
          <button id="prv-d-editar" class="btn-sec">✏️ Editar</button>
          <button id="prv-d-cerrar" class="panel-cerrar" title="Cerrar">&times;</button>
        </div>
      </header>
      <div id="prv-d-cuerpo" class="panel-cuerpo"></div>`;
    document.body.appendChild(fondo);
    document.body.appendChild(panel);
    fondo.addEventListener('click', cerrarPanelPrv);
    panel.querySelector('#prv-d-cerrar').addEventListener('click', cerrarPanelPrv);
    panel.querySelector('#prv-d-editar').addEventListener('click', () => { if (prvFicha) modalPropvent(prvFicha); });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const modalAbierto = !document.getElementById('modal-fondo').classList.contains('oculto');
      if (!modalAbierto && panel.classList.contains('abierto')) cerrarPanelPrv();
    }, true);
  }
  function abrirPanelPrv() {
    document.getElementById('prv-panel-fondo').classList.add('abierto');
    document.getElementById('prv-panel').classList.add('abierto');
  }
  function cerrarPanelPrv() {
    document.getElementById('prv-panel-fondo')?.classList.remove('abierto');
    document.getElementById('prv-panel')?.classList.remove('abierto');
    prvFicha = null;
  }

  async function abrirFichaPropvent(id) {
    crearPanelPrv();
    let d;
    try { d = await API.get('/api/ventas/propietarios-venta/' + id); }
    catch (e) { return toast(e.message, 'error'); }
    prvFicha = d;
    document.getElementById('prv-d-titulo').textContent = nomPrv(d) || 'Propietario';
    document.getElementById('prv-d-badge').innerHTML = d.propietario_alquiler_id
      ? '<span class="vta-bdg vta-bdg-prv">🔗 Importado de alquileres</span>' : '';
    renderCuerpoPrv(d);
    abrirPanelPrv();
  }

  function renderCuerpoPrv(d) {
    const datos = `
      <div class="vta-d-seccion">
        <div class="vta-d-titulo-sec">👤 Datos personales</div>
        <div class="vta-d-grid">
          ${dato('Nombre', esc(d.nombre) || '—')}
          ${dato('Apellidos', esc(d.apellidos) || '—')}
          ${dato('Teléfono', d.telefono ? `<a class="vta-link" href="tel:${esc(d.telefono)}">${esc(d.telefono)}</a>` : '—')}
          ${dato('Teléfono 2', d.telefono2 ? `<a class="vta-link" href="tel:${esc(d.telefono2)}">${esc(d.telefono2)}</a>` : '—')}
          ${dato('Email', d.email ? `<a class="vta-link" href="mailto:${esc(d.email)}">${esc(d.email)}</a>` : '—')}
          ${dato('DNI', esc(d.dni) || '—')}
          ${dato('Dirección', esc(d.direccion) || '—')}
          ${dato('Ciudad', esc(d.ciudad) || '—')}
          ${dato('Código postal', esc(d.codigo_postal) || '—')}
        </div>
      </div>`;

    const props = (d.propiedades || []).map((p) => {
      const dir = [p.calle, p.numero].filter(Boolean).join(' ') || p.zona || '';
      return `
        <div class="vta-sug-card" data-prop="${p.id}" style="cursor:pointer">
          <div class="vta-sug-info">
            <div class="vta-sug-ref">${esc(p.referencia)} <span class="vta-sug-precio">${euro(p.precio)}</span></div>
            <div class="vta-sug-detalle">${esc(dir) || '—'}</div>
          </div>
          ${estadoBadge(p.estado)}
        </div>`;
    }).join('') || '<div class="vta-muted">Sin propiedades asociadas</div>';
    const propsSec = `
      <div class="vta-d-seccion">
        <div class="vta-d-titulo-sec">🏠 Propiedades en venta</div>
        ${props}
      </div>`;

    const notas = `
      <div class="vta-d-seccion">
        <div class="vta-d-titulo-sec">📝 Notas</div>
        <textarea id="prv-d-notas" class="vta-d-textarea" rows="3" placeholder="Notas del propietario...">${esc(d.notas)}</textarea>
        <div class="vta-d-guardar-wrap"><button class="btn-pri" id="prv-d-guardar-notas">Guardar</button></div>
      </div>`;

    document.getElementById('prv-d-cuerpo').innerHTML = datos + propsSec + notas;

    document.querySelectorAll('#prv-d-cuerpo [data-prop]').forEach((el) =>
      el.addEventListener('click', () => abrirFicha(el.dataset.prop)));

    document.getElementById('prv-d-guardar-notas').addEventListener('click', async () => {
      const btn = document.getElementById('prv-d-guardar-notas');
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        await API.put('/api/ventas/propietarios-venta/' + d.id, { notas: val('prv-d-notas') });
        prvFicha.notas = val('prv-d-notas');
        toast('Guardado', 'ok');
      } catch (e) { toast(e.message, 'error'); }
      finally { btn.disabled = false; btn.textContent = 'Guardar'; }
    });
  }

  // ---- Modal nuevo / editar ----
  function modalPropvent(p) {
    const esNuevo = !p;
    p = p || {};
    abrirModal(`
      <h3>${esNuevo ? '＋ Nuevo propietario' : '✏️ Editar propietario'}</h3>
      <div class="fila-campos">
        <div class="campo"><label>Nombre *</label><input id="prf-nombre" value="${esc(p.nombre)}"></div>
        <div class="campo"><label>Apellidos</label><input id="prf-apellidos" value="${esc(p.apellidos)}"></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Teléfono</label><input id="prf-telefono" value="${esc(p.telefono)}"></div>
        <div class="campo"><label>Teléfono 2</label><input id="prf-telefono2" value="${esc(p.telefono2)}"></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Email</label><input id="prf-email" value="${esc(p.email)}"></div>
        <div class="campo"><label>DNI</label><input id="prf-dni" value="${esc(p.dni)}"></div>
      </div>
      <div class="campo"><label>Dirección</label><input id="prf-direccion" value="${esc(p.direccion)}"></div>
      <div class="fila-campos">
        <div class="campo"><label>Ciudad</label><input id="prf-ciudad" value="${esc(p.ciudad)}"></div>
        <div class="campo"><label>Código postal</label><input id="prf-codigo_postal" value="${esc(p.codigo_postal)}"></div>
      </div>
      <div class="campo"><label>Notas</label><textarea id="prf-notas" rows="2">${esc(p.notas)}</textarea></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="prf-cancelar">Cancelar</button>
        <button class="btn-pri" id="prf-guardar">${esNuevo ? 'Crear' : 'Guardar'}</button>
      </div>`);
    document.querySelector('.modal').classList.add('modal-ancho');
    document.getElementById('prf-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('prf-guardar').addEventListener('click', () => guardarPropvent(esNuevo ? null : p.id));
  }

  const CAMPOS_PRV = ['nombre', 'apellidos', 'telefono', 'telefono2', 'email', 'dni', 'direccion', 'ciudad', 'codigo_postal', 'notas'];

  async function guardarPropvent(id) {
    const nombre = val('prf-nombre').trim();
    if (!nombre) return toast('El nombre es obligatorio', 'error');
    const body = {};
    for (const c of CAMPOS_PRV) body[c] = val('prf-' + c);
    body.nombre = nombre;
    const btn = document.getElementById('prf-guardar');
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      if (id) await API.put('/api/ventas/propietarios-venta/' + id, body);
      else await API.post('/api/ventas/propietarios-venta', body);
      cerrarModal();
      prvCacheOk = false; // invalida la caché del typeahead de propiedad
      if (prvConstruido) await cargarPropvent();
      if (prvFicha && id && prvFicha.id === id) await abrirFichaPropvent(id);
      toast(id ? 'Propietario actualizado' : 'Propietario creado', 'ok');
    } catch (e) {
      toast(e.message, 'error');
      btn.disabled = false; btn.textContent = id ? 'Guardar' : 'Crear';
    }
  }

  async function borrarPropvent(p) {
    if (!p) return;
    if (!confirm(`¿Eliminar el propietario ${nomPrv(p)}?`)) return;
    try {
      await API.del('/api/ventas/propietarios-venta/' + p.id);
      await cargarPropvent();
      toast('Propietario eliminado', 'ok');
    } catch (e) { toast(e.message, 'error'); } // 409 si tiene propiedades
  }

  // ---- Modal importar de alquileres (typeahead sobre /api/propietarios) ----
  function modalImportarAlquiler() {
    let elegido = null;        // propietario de alquiler seleccionado
    let catalogo = [];         // propietarios de alquiler
    abrirModal(`
      <h3>📥 Importar de alquileres</h3>
      <div class="vta-import-aviso">ℹ️ Copia los datos de un propietario de alquiler a la cartera de ventas.</div>
      <div class="campo vta-ta">
        <label>Buscar propietario de alquiler</label>
        <input id="pia-input" class="input-buscar" autocomplete="off" placeholder="Buscar por nombre, teléfono o email...">
        <div id="pia-res" class="vta-ta-res oculto"></div>
      </div>
      <div id="pia-preview" class="vta-import-resultado oculto"></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="pia-cancelar">Cancelar</button>
        <button class="btn-pri" id="pia-importar" disabled>Importar</button>
      </div>`);

    const input = document.getElementById('pia-input');
    const res = document.getElementById('pia-res');
    const preview = document.getElementById('pia-preview');
    const btn = document.getElementById('pia-importar');

    const mostrarPreview = (p) => {
      const dni = p.numero_documento || p.dni || '';
      const nom = [p.nombre, p.apellidos, p.segundo_apellido].filter(Boolean).join(' ');
      preview.classList.remove('oculto');
      preview.innerHTML = `
        <div class="vta-d-titulo-sec" style="border:none">Se importará:</div>
        <div class="vta-d-grid">
          ${dato('Nombre', esc(nom) || '—')}
          ${dato('Teléfono', esc(p.telefono) || '—')}
          ${dato('Email', esc(p.email) || '—')}
          ${dato('DNI', esc(dni) || '—')}
        </div>`;
      btn.disabled = false;
    };

    input.addEventListener('input', async () => {
      elegido = null; btn.disabled = true; preview.classList.add('oculto');
      const q = input.value.trim().toLowerCase();
      if (!catalogo.length) {
        try { catalogo = await API.get('/api/propietarios'); } catch (e) { return toast(e.message, 'error'); }
      }
      renderTA(res,
        catalogo.filter((p) => `${p.nombre || ''} ${p.apellidos || ''} ${p.telefono || ''} ${p.email || ''}`.toLowerCase().includes(q)),
        (p) => `${esc([p.nombre, p.apellidos].filter(Boolean).join(' '))}${p.telefono ? ' · ' + esc(p.telefono) : ''}`,
        (p) => { elegido = p; input.value = [p.nombre, p.apellidos].filter(Boolean).join(' '); res.classList.add('oculto'); mostrarPreview(p); });
    });
    document.getElementById('modal-contenido')?.addEventListener('click', (e) => {
      if (!e.target.closest('.vta-ta')) res.classList.add('oculto');
    });

    document.getElementById('pia-cancelar').addEventListener('click', cerrarModal);
    btn.addEventListener('click', async () => {
      if (!elegido) return toast('Selecciona un propietario', 'error');
      btn.disabled = true; btn.textContent = 'Importando…';
      try {
        await API.post('/api/ventas/propietarios-venta/importar-alquiler', { propietario_id: elegido.id });
        cerrarModal();
        prvCacheOk = false;
        if (prvConstruido) await cargarPropvent();
        toast('Propietario importado', 'ok');
      } catch (e) {
        toast(e.message, 'error'); // 409 → "Este propietario ya fue importado"
        btn.disabled = false; btn.textContent = 'Importar';
      }
    });
  }

  // ==================== Init ====================
  // ==================== Sub-pestaña Arras ====================
  async function construirAutorizacion() {
    if (autConstruido) return;
    const panel = document.querySelector('#vista-ventas .sub-panel[data-panel-sub="arras"]');
    if (!panel) return;
    autConstruido = true;

    // Catálogos para los typeaheads (una vez).
    try {
      const [prv, cli, props, razones] = await Promise.all([
        API.get('/api/ventas/propietarios-venta').catch(() => []),
        API.get('/api/ventas/clientes').catch(() => []),
        API.get('/api/ventas/propiedades').catch(() => []),
        API.get('/api/ajustes/razones-sociales').catch(() => []),
      ]);
      autPrv = prv; autCli = cli; autProps = props; autvRazones = razones;
    } catch (e) { autPrv = []; autCli = []; autProps = []; autvRazones = []; }

    const docOpts = ['DNI', 'NIE', 'Pasaporte'].map((d) => `<option value="${d}">${d}</option>`).join('');
    const rsPrincipal = autvRazones.find((r) => r.predeterminada) || autvRazones[0];
    const rsOpts = autvRazones.map((r) =>
      `<option value="${r.id}"${rsPrincipal && r.id === rsPrincipal.id ? ' selected' : ''}>${esc(r.razon_social)}</option>`).join('');

    panel.innerHTML = `
      <div class="aut-form">
        <div class="aut-sec-tit">Razón social</div>
        <div class="fila-campos" style="align-items:center">
          <div class="campo"><label>Razón social emisora</label><select id="aut-razon">${rsOpts}</select></div>
          <img id="aut-razon-logo" alt="" style="max-height:60px;max-width:160px;object-fit:contain;display:none">
        </div>
        <div class="aut-sec-tit">Parte vendedora</div>
        <div class="campo vta-ta">
          <label>Nombre completo</label>
          <input id="aut-v-nombre" class="input-buscar" autocomplete="off" placeholder="Buscar propietario de venta...">
          <div id="aut-v-res" class="vta-ta-res oculto"></div>
        </div>
        <div class="fila-campos">
          <div class="campo"><label>Tipo documento</label><select id="aut-v-tipodoc">${docOpts}</select></div>
          <div class="campo"><label>Número documento</label><input id="aut-v-numdoc"></div>
        </div>
        <div class="campo"><label>Dirección</label><input id="aut-v-dir"></div>
        <div class="fila-campos">
          <div class="campo"><label>Ciudad</label><input id="aut-v-ciudad"></div>
          <div class="campo"><label>Provincia</label><input id="aut-v-prov"></div>
        </div>
        <div class="campo">
          <button type="button" class="btn-mini" id="aut-v2-toggle">+ Añadir otra persona</button>
        </div>
        <div class="oculto" id="aut-v2-bloque">
          <div class="campo"><label>Nombre completo</label><input id="aut-v2-nombre"></div>
          <div class="fila-campos">
            <div class="campo"><label>Tipo documento</label><select id="aut-v2-tipodoc">${docOpts}</select></div>
            <div class="campo"><label>Número documento</label><input id="aut-v2-numdoc"></div>
          </div>
          <div class="campo"><button type="button" class="btn-mini" id="aut-v2-quitar">🗑️ Quitar</button></div>
        </div>

        <div class="aut-sec-tit">Parte compradora</div>
        <div class="campo vta-ta">
          <label>Nombre completo</label>
          <input id="aut-c-nombre" class="input-buscar" autocomplete="off" placeholder="Buscar cliente comprador...">
          <div id="aut-c-res" class="vta-ta-res oculto"></div>
        </div>
        <div class="fila-campos">
          <div class="campo"><label>Tipo documento</label><select id="aut-c-tipodoc">${docOpts}</select></div>
          <div class="campo"><label>Número documento</label><input id="aut-c-numdoc"></div>
        </div>
        <div class="campo"><label>Dirección</label><input id="aut-c-dir"></div>
        <div class="fila-campos">
          <div class="campo"><label>Ciudad</label><input id="aut-c-ciudad"></div>
          <div class="campo"><label>Provincia</label><input id="aut-c-prov"></div>
        </div>
        <div class="campo">
          <button type="button" class="btn-mini" id="aut-c2-toggle">+ Añadir otra persona</button>
        </div>
        <div class="oculto" id="aut-c2-bloque">
          <div class="campo"><label>Nombre completo</label><input id="aut-c2-nombre"></div>
          <div class="fila-campos">
            <div class="campo"><label>Tipo documento</label><select id="aut-c2-tipodoc">${docOpts}</select></div>
            <div class="campo"><label>Número documento</label><input id="aut-c2-numdoc"></div>
          </div>
          <div class="campo"><button type="button" class="btn-mini" id="aut-c2-quitar">🗑️ Quitar</button></div>
        </div>

        <div class="aut-sec-tit">Inmueble</div>
        <div class="campo vta-ta">
          <label>Referencia de propiedad</label>
          <input id="aut-i-ref" class="input-buscar" autocomplete="off" placeholder="Buscar por referencia o calle...">
          <div id="aut-i-ref-res" class="vta-ta-res oculto"></div>
        </div>
        <div id="aut-i-card" class="oculto" style="margin:0 0 10px;padding:8px 12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;font-size:13px;font-weight:600;color:#1e40af"></div>
        <div class="campo vta-ta">
          <label>Edificio</label>
          <input id="aut-i-edificio" class="input-buscar" autocomplete="off" placeholder="Buscar propiedad de venta...">
          <div id="aut-i-res" class="vta-ta-res oculto"></div>
        </div>
        <div class="fila-campos">
          <div class="campo"><label>Planta</label><input id="aut-i-planta"></div>
          <div class="campo"><label>Número puerta</label><input id="aut-i-puerta"></div>
        </div>
        <div class="fila-campos">
          <div class="campo"><label>Número parking</label><input id="aut-i-parking"></div>
          <div class="campo"><label>Número trastero</label><input id="aut-i-trastero"></div>
        </div>

        <div class="aut-sec-tit">Condiciones económicas</div>
        <div class="fila-campos">
          <div class="campo"><label>Precio de venta (€)</label><input type="number" step="0.01" id="aut-e-precio"></div>
          <div class="campo"><label>Señal (€)</label><input type="number" step="0.01" id="aut-e-senal" value="3000"></div>
        </div>
        <div class="fila-campos">
          <div class="campo"><label>Resto a pagar (€)</label><input id="aut-e-resto" class="campo-readonly" readonly></div>
          <div class="campo"><label>Fecha límite escrituración</label><input type="date" id="aut-e-fecha"></div>
        </div>
        <div class="fila-campos">
          <div class="campo"><label>Comisión (%)</label><input type="number" step="0.01" id="aut-e-comision-pct" value="3"></div>
          <div class="campo"><label>Importe comisión (€)</label><input type="number" step="0.01" id="aut-e-comision"></div>
        </div>
        <div class="campo">
          <label>IVA de la comisión</label>
          <div id="aut-iva-pills" style="display:inline-flex;gap:6px;border:1px solid #d1d5db;border-radius:999px;padding:3px;background:#f9fafb">
            <button type="button" class="aut-pill" data-iva="0">Más IVA</button>
            <button type="button" class="aut-pill" data-iva="1">IVA incluido</button>
          </div>
        </div>

        <div class="aut-acciones">
          <button class="btn-pri" id="aut-descargar">📥 Descargar PDF</button>
          <button class="btn-sec" id="aut-descargar-word">📄 Descargar Word</button>
          <button class="btn-sec" id="aut-imprimir">🖨️ Imprimir</button>
          <button class="btn-sec" id="aut-limpiar">Limpiar formulario</button>
        </div>
      </div>`;

    // --- Typeahead vendedor (propietarios de venta) ---
    const vIn = document.getElementById('aut-v-nombre');
    const vRes = document.getElementById('aut-v-res');
    vIn.addEventListener('input', () => renderTA(vRes,
      autPrv.filter((p) => `${p.nombre} ${p.apellidos || ''} ${p.dni || ''}`.toLowerCase().includes(vIn.value.trim().toLowerCase())),
      (p) => `${esc([p.nombre, p.apellidos].filter(Boolean).join(' '))}${p.dni ? ' · ' + esc(p.dni) : ''}`,
      (p) => {
        vIn.value = [p.nombre, p.apellidos].filter(Boolean).join(' ');
        setVal('aut-v-numdoc', p.dni || '');
        setVal('aut-v-dir', p.direccion || '');
        setVal('aut-v-ciudad', p.ciudad || '');
        vRes.classList.add('oculto');
      }));

    // --- Typeahead comprador (clientes compradores) ---
    const cIn = document.getElementById('aut-c-nombre');
    const cRes = document.getElementById('aut-c-res');
    cIn.addEventListener('input', () => renderTA(cRes,
      autCli.filter((c) => `${c.nombre} ${c.apellidos || ''} ${c.telefono || ''} ${c.email || ''}`.toLowerCase().includes(cIn.value.trim().toLowerCase())),
      (c) => `${esc([c.nombre, c.apellidos].filter(Boolean).join(' '))}${c.telefono ? ' · ' + esc(c.telefono) : ''}`,
      (c) => {
        cIn.value = [c.nombre, c.apellidos].filter(Boolean).join(' ');
        cRes.classList.add('oculto');
      }));

    // --- Typeahead referencia de propiedad (autorrellena todo el formulario) ---
    const refIn = document.getElementById('aut-i-ref');
    const refRes = document.getElementById('aut-i-ref-res');
    refIn.addEventListener('input', () => renderTA(refRes,
      autProps.filter((p) => `${p.referencia || ''} ${p.calle || ''} ${p.zona || ''}`.toLowerCase().includes(refIn.value.trim().toLowerCase())),
      (p) => `${esc(p.referencia || '')} · ${esc(p.calle) || '—'}${p.precio ? ' · ' + euro(p.precio) : ''}`,
      (p) => { refIn.value = p.referencia || ''; refRes.classList.add('oculto'); autofillPropiedad(p); }));

    // --- Typeahead inmueble (propiedades de venta) ---
    const iIn = document.getElementById('aut-i-edificio');
    const iRes = document.getElementById('aut-i-res');
    iIn.addEventListener('input', () => renderTA(iRes,
      autProps.filter((p) => `${p.referencia || ''} ${p.calle || ''} ${p.zona || ''}`.toLowerCase().includes(iIn.value.trim().toLowerCase())),
      (p) => `${esc(p.referencia || '')} · ${esc(p.calle) || '—'}${p.precio ? ' · ' + euro(p.precio) : ''}`,
      (p) => {
        iIn.value = p.calle || p.referencia || '';
        setVal('aut-i-planta', p.planta || '');
        setVal('aut-i-puerta', p.numero_puerta || '');
        if (p.precio != null) { setVal('aut-e-precio', p.precio); calcResto(); calcComision(); }
        iRes.classList.add('oculto');
      }));

    // Cerrar dropdowns al hacer clic fuera.
    panel.addEventListener('click', (e) => {
      if (!e.target.closest('.vta-ta')) { vRes.classList.add('oculto'); cRes.classList.add('oculto'); iRes.classList.add('oculto'); refRes.classList.add('oculto'); }
    });

    // Segunda persona (vendedora/compradora) — mismo bloque toggle/quitar para ambas.
    const wireSegundaPersona = (prefijo) => {
      const toggle = document.getElementById(`aut-${prefijo}2-toggle`);
      const bloque = document.getElementById(`aut-${prefijo}2-bloque`);
      toggle.addEventListener('click', () => {
        bloque.classList.remove('oculto');
        toggle.parentElement.classList.add('oculto');
      });
      document.getElementById(`aut-${prefijo}2-quitar`).addEventListener('click', () => {
        setVal(`aut-${prefijo}2-nombre`, '');
        setVal(`aut-${prefijo}2-numdoc`, '');
        document.getElementById(`aut-${prefijo}2-tipodoc`).value = 'DNI';
        bloque.classList.add('oculto');
        toggle.parentElement.classList.remove('oculto');
      });
    };
    wireSegundaPersona('v');
    wireSegundaPersona('c');

    // Resto a pagar = precio − señal (en vivo).
    document.getElementById('aut-e-precio').addEventListener('input', () => { calcResto(); calcComision(); });
    document.getElementById('aut-e-senal').addEventListener('input', calcResto);
    document.getElementById('aut-e-comision-pct').addEventListener('input', calcComision);

    // Pills de IVA (radio estilizado tipo switch).
    document.querySelectorAll('#aut-iva-pills .aut-pill').forEach((p) =>
      p.addEventListener('click', () => pintarIvaPills(p.dataset.iva === '1')));
    pintarIvaPills(false); // por defecto "Más IVA"

    // Razón social → preview de logo.
    const rsSel = document.getElementById('aut-razon');
    const pintarLogo = () => {
      const r = autvRazones.find((x) => String(x.id) === String(rsSel.value));
      const img = document.getElementById('aut-razon-logo');
      if (r && r.logo_url) { img.src = r.logo_url; img.style.display = ''; } else { img.style.display = 'none'; }
    };
    if (rsSel) { rsSel.addEventListener('change', pintarLogo); pintarLogo(); }

    document.getElementById('aut-descargar').addEventListener('click', () => generarAutorizacion('descargar'));
    document.getElementById('aut-descargar-word').addEventListener('click', () => generarAutorizacionWord());
    document.getElementById('aut-imprimir').addEventListener('click', () => generarAutorizacion('imprimir'));
    document.getElementById('aut-limpiar').addEventListener('click', limpiarAutorizacion);

    calcResto();
    calcComision();
  }

  function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v == null ? '' : v; }

  // Autorrellena todo el formulario a partir de una propiedad de venta seleccionada.
  function autofillPropiedad(p) {
    // Inmueble.
    setVal('aut-i-edificio', p.calle || p.zona || p.referencia || '');
    setVal('aut-i-planta', p.planta || '');
    setVal('aut-i-puerta', p.numero_puerta || '');
    if (p.precio != null) setVal('aut-e-precio', p.precio);
    calcResto();

    // Parte vendedora: propietario de venta vinculado (propietario_venta_id).
    const prv = p.propietario_venta_id != null
      ? autPrv.find((x) => String(x.id) === String(p.propietario_venta_id)) : null;
    if (prv) {
      setVal('aut-v-nombre', [prv.nombre, prv.apellidos].filter(Boolean).join(' '));
      setVal('aut-v-numdoc', prv.dni || '');
      setVal('aut-v-dir', prv.direccion || '');
      setVal('aut-v-ciudad', prv.ciudad || '');
      setVal('aut-v-prov', prv.provincia || '');
    }

    // Parte compradora: solo si la propiedad está vendida y tiene comprador snapshot.
    if (p.estado === 'Vendida' && p.comprador_nombre) {
      setVal('aut-c-nombre', p.comprador_nombre);
    }

    // Card resumen de la propiedad.
    const card = document.getElementById('aut-i-card');
    if (card) {
      const partes = [
        `Ref: ${p.referencia || '—'}`,
        [p.calle || '', p.planta ? 'Planta ' + p.planta : ''].filter(Boolean).join(', '),
        p.precio != null ? euro(p.precio) : '',
      ].filter(Boolean);
      card.textContent = partes.join(' — ');
      card.classList.remove('oculto');
    }
  }

  function calcResto() {
    const precio = parseFloat(val('aut-e-precio')) || 0;
    const senal = parseFloat(val('aut-e-senal')) || 0;
    setVal('aut-e-resto', (precio - senal).toFixed(2));
  }

  // Importe comisión = precio × % / 100 (editable después).
  function calcComision() {
    const precio = parseFloat(val('aut-e-precio')) || 0;
    const pct = parseFloat(val('aut-e-comision-pct')) || 0;
    setVal('aut-e-comision', (precio * pct / 100).toFixed(2));
  }

  // Pinta los pills de IVA (activo = azul oscuro, texto blanco).
  function pintarIvaPills(incluido) {
    document.querySelectorAll('#aut-iva-pills .aut-pill').forEach((p) => {
      const activo = (p.dataset.iva === '1') === incluido;
      p.style.cssText = 'border:0;border-radius:999px;padding:6px 14px;font-size:13px;font-weight:600;cursor:pointer;' +
        (activo ? 'background:#1a1a2e;color:#fff' : 'background:transparent;color:#374151');
      p.dataset.activo = activo ? '1' : '0';
    });
  }
  function ivaIncluido() {
    const p = document.querySelector('#aut-iva-pills .aut-pill[data-activo="1"]');
    return p ? p.dataset.iva === '1' : false;
  }

  function limpiarAutorizacion() {
    ['aut-v-nombre', 'aut-v-numdoc', 'aut-v-dir', 'aut-v-ciudad', 'aut-v-prov',
      'aut-v2-nombre', 'aut-v2-numdoc',
      'aut-c-nombre', 'aut-c-numdoc', 'aut-c-dir', 'aut-c-ciudad', 'aut-c-prov',
      'aut-c2-nombre', 'aut-c2-numdoc',
      'aut-i-edificio', 'aut-i-planta', 'aut-i-puerta', 'aut-i-parking', 'aut-i-trastero',
      'aut-e-precio', 'aut-e-comision', 'aut-e-fecha'].forEach((id) => setVal(id, ''));
    setVal('aut-e-senal', '3000');
    setVal('aut-e-comision-pct', '3');
    document.getElementById('aut-v-tipodoc').value = 'DNI';
    document.getElementById('aut-c-tipodoc').value = 'DNI';
    document.getElementById('aut-v2-tipodoc').value = 'DNI';
    document.getElementById('aut-c2-tipodoc').value = 'DNI';
    document.getElementById('aut-v2-bloque').classList.add('oculto');
    document.getElementById('aut-v2-toggle').parentElement.classList.remove('oculto');
    document.getElementById('aut-c2-bloque').classList.add('oculto');
    document.getElementById('aut-c2-toggle').parentElement.classList.remove('oculto');
    pintarIvaPills(false);
    calcResto();
  }

  function bodyAutorizacion() {
    const nombreV2 = val('aut-v2-nombre').trim();
    const nombreC2 = val('aut-c2-nombre').trim();
    return {
      nombre_vendedor: val('aut-v-nombre'),
      documento_identidad_vendedor: val('aut-v-tipodoc'),
      dni_vendedor: val('aut-v-numdoc'),
      direccion_vendedor: val('aut-v-dir'),
      ciudad_vendedor: val('aut-v-ciudad'),
      provincia_vendedor: val('aut-v-prov'),
      nombre_vendedor_2: nombreV2,
      documento_identidad_vendedor_2: nombreV2 ? val('aut-v2-tipodoc') : '',
      dni_vendedor_2: nombreV2 ? val('aut-v2-numdoc') : '',
      nombre_comprador: val('aut-c-nombre'),
      documento_identidad_comprador: val('aut-c-tipodoc'),
      dni_comprador: val('aut-c-numdoc'),
      direccion_comprador: val('aut-c-dir'),
      ciudad_comprador: val('aut-c-ciudad'),
      provincia_comprador: val('aut-c-prov'),
      nombre_comprador_2: nombreC2,
      documento_identidad_comprador_2: nombreC2 ? val('aut-c2-tipodoc') : '',
      dni_comprador_2: nombreC2 ? val('aut-c2-numdoc') : '',
      edificio: val('aut-i-edificio'),
      planta: val('aut-i-planta'),
      numero_puerta: val('aut-i-puerta'),
      numero_parking: val('aut-i-parking'),
      numero_trastero: val('aut-i-trastero'),
      precio_venta: parseFloat(val('aut-e-precio')) || 0,
      senal: parseFloat(val('aut-e-senal')) || 0,
      resto_pago: parseFloat(val('aut-e-resto')) || 0,
      fecha_escritura: val('aut-e-fecha'),
      porcentaje_comision: parseFloat(val('aut-e-comision-pct')) || 0,
      importe_comision: parseFloat(val('aut-e-comision')) || 0,
      iva_incluido: ivaIncluido(),
      razon_social_id: parseInt(val('aut-razon'), 10) || null,
    };
  }

  async function generarAutorizacion(modo) {
    const btnId = modo === 'imprimir' ? 'aut-imprimir' : 'aut-descargar';
    const btn = document.getElementById(btnId);
    if (btn) btn.disabled = true;
    try {
      const r = await fetch('/api/ventas/autorizacion-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(bodyAutorizacion()),
      });
      if (!r.ok) throw new Error('No se pudo generar el PDF');
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      if (modo === 'imprimir') {
        const w = window.open(url, '_blank');
        if (w) w.addEventListener('load', () => { try { w.print(); } catch (e) {} });
      } else {
        const a = document.createElement('a');
        a.href = url; a.download = 'autorizacion-venta.pdf';
        document.body.appendChild(a); a.click(); a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function generarAutorizacionWord() {
    const btn = document.getElementById('aut-descargar-word');
    if (btn) btn.disabled = true;
    try {
      const r = await fetch('/api/ventas/autorizacion-docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(bodyAutorizacion()),
      });
      if (!r.ok) throw new Error('No se pudo generar el Word');
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'autorizacion-venta.docx';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ==================== Sub-pestaña Autorización (mandato de venta) ====================
  async function construirAutVenta() {
    if (autvConstruido) return;
    const panel = document.querySelector('#vista-ventas .sub-panel[data-panel-sub="autorizacion"]');
    if (!panel) return;
    autvConstruido = true;

    try {
      const [prv, props, razones] = await Promise.all([
        API.get('/api/ventas/propietarios-venta').catch(() => []),
        API.get('/api/ventas/propiedades').catch(() => []),
        API.get('/api/ajustes/razones-sociales').catch(() => []),
      ]);
      autPrv = prv; autProps = props; autvRazones = razones;
    } catch (e) { autPrv = []; autProps = []; autvRazones = []; }

    const civilOpts = ['Soltero/a', 'Casado/a', 'Divorciado/a', 'Viudo/a']
      .map((c) => `<option value="${c}">${c}</option>`).join('');
    // Razón social por defecto: la predeterminada si está marcada, si no la primera.
    const principal = autvRazones.find((r) => r.predeterminada) || autvRazones[0];
    const rsOpts = autvRazones.map((r) =>
      `<option value="${esc(r.razon_social)}"${principal && r.id === principal.id ? ' selected' : ''}>${esc(r.razon_social)}</option>`).join('');

    panel.innerHTML = `
      <div class="aut-form">
        <div class="aut-sec-tit">Vendedor</div>
        <div class="campo vta-ta">
          <label>Nombre completo</label>
          <input id="autv-nombre" class="input-buscar" autocomplete="off" placeholder="Buscar propietario de venta...">
          <div id="autv-res" class="vta-ta-res oculto"></div>
        </div>
        <div class="fila-campos">
          <div class="campo"><label>Estado civil</label><select id="autv-civil">${civilOpts}</select></div>
          <div class="campo"><label>DNI</label><input id="autv-dni"></div>
        </div>
        <div class="campo"><label>Dirección</label><input id="autv-dir"></div>
        <div class="fila-campos">
          <div class="campo"><label>Ciudad</label><input id="autv-ciudad"></div>
          <div class="campo"><label>Provincia</label><input id="autv-prov"></div>
        </div>
        <div class="campo"><label>Teléfono</label><input id="autv-tel"></div>

        <div class="aut-sec-tit">Inmueble</div>
        <div class="campo vta-ta">
          <label>Referencia propiedad</label>
          <input id="autv-ref" class="input-buscar" autocomplete="off" placeholder="Buscar por referencia o calle...">
          <div id="autv-ref-res" class="vta-ta-res oculto"></div>
        </div>
        <div id="autv-card" class="oculto" style="margin:0 0 10px;padding:8px 12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;font-size:13px;font-weight:600;color:#1e40af"></div>
        <div class="fila-campos">
          <div class="campo"><label>Edificio</label><input id="autv-edificio"></div>
          <div class="campo"><label>Planta</label><input id="autv-planta"></div>
          <div class="campo"><label>Puerta</label><input id="autv-puerta"></div>
        </div>
        <div class="campo"><label>Precio de venta (€)</label><input type="number" step="0.01" id="autv-precio"></div>

        <div class="aut-sec-tit">Condiciones</div>
        <div class="fila-campos">
          <div class="campo"><label>Porcentaje comisión (%)</label><input type="number" step="0.01" id="autv-comision" value="3"></div>
          <div class="campo"><label>Razón social</label><select id="autv-razon">${rsOpts}</select></div>
        </div>
        <div class="campo"><label>Fecha del documento</label><input type="date" id="autv-fecha" value="${hoyStr()}"></div>

        <div class="aut-acciones">
          <button class="btn-pri" id="autv-descargar">📥 Descargar PDF</button>
          <button class="btn-sec" id="autv-descargar-word">📄 Descargar Word</button>
          <button class="btn-sec" id="autv-limpiar">Limpiar formulario</button>
        </div>
      </div>`;

    // Typeahead vendedor.
    const vIn = document.getElementById('autv-nombre');
    const vRes = document.getElementById('autv-res');
    vIn.addEventListener('input', () => renderTA(vRes,
      autPrv.filter((p) => `${p.nombre} ${p.apellidos || ''} ${p.dni || ''}`.toLowerCase().includes(vIn.value.trim().toLowerCase())),
      (p) => `${esc([p.nombre, p.apellidos].filter(Boolean).join(' '))}${p.dni ? ' · ' + esc(p.dni) : ''}`,
      (p) => {
        vIn.value = [p.nombre, p.apellidos].filter(Boolean).join(' ');
        setVal('autv-dni', p.dni || '');
        setVal('autv-dir', p.direccion || '');
        setVal('autv-ciudad', p.ciudad || '');
        setVal('autv-prov', p.provincia || '');
        setVal('autv-tel', p.telefono || '');
        vRes.classList.add('oculto');
      }));

    // Typeahead referencia de propiedad.
    const rIn = document.getElementById('autv-ref');
    const rRes = document.getElementById('autv-ref-res');
    rIn.addEventListener('input', () => renderTA(rRes,
      autProps.filter((p) => `${p.referencia || ''} ${p.calle || ''} ${p.zona || ''}`.toLowerCase().includes(rIn.value.trim().toLowerCase())),
      (p) => `${esc(p.referencia || '')} · ${esc(p.calle) || '—'}${p.precio ? ' · ' + euro(p.precio) : ''}`,
      (p) => {
        rIn.value = p.referencia || '';
        setVal('autv-edificio', p.calle || p.zona || p.referencia || '');
        setVal('autv-planta', p.planta || '');
        setVal('autv-puerta', p.numero_puerta || '');
        if (p.precio != null) setVal('autv-precio', p.precio);
        const card = document.getElementById('autv-card');
        if (card) {
          const partes = [
            `Ref: ${p.referencia || '—'}`,
            [p.calle || '', p.planta ? 'Planta ' + p.planta : ''].filter(Boolean).join(', '),
            p.precio != null ? euro(p.precio) : '',
          ].filter(Boolean);
          card.textContent = partes.join(' — ');
          card.classList.remove('oculto');
        }
        rRes.classList.add('oculto');
      }));

    panel.addEventListener('click', (e) => {
      if (!e.target.closest('.vta-ta')) { vRes.classList.add('oculto'); rRes.classList.add('oculto'); }
    });

    document.getElementById('autv-descargar').addEventListener('click', generarAutVenta);
    document.getElementById('autv-descargar-word').addEventListener('click', generarAutVentaWord);
    document.getElementById('autv-limpiar').addEventListener('click', limpiarAutVenta);
  }

  function limpiarAutVenta() {
    ['autv-nombre', 'autv-dni', 'autv-dir', 'autv-ciudad', 'autv-prov', 'autv-tel',
      'autv-ref', 'autv-edificio', 'autv-planta', 'autv-puerta', 'autv-precio'].forEach((id) => setVal(id, ''));
    setVal('autv-comision', '3');
    setVal('autv-fecha', hoyStr());
    const civil = document.getElementById('autv-civil');
    if (civil) civil.selectedIndex = 0;
    const card = document.getElementById('autv-card');
    if (card) { card.classList.add('oculto'); card.textContent = ''; }
  }

  function bodyAutVenta() {
    return {
      nombre_vendedor: val('autv-nombre'),
      estado_civil: val('autv-civil'),
      dni_vendedor: val('autv-dni'),
      direccion_vendedor: val('autv-dir'),
      ciudad_vendedor: val('autv-ciudad'),
      provincia_vendedor: val('autv-prov'),
      telefono_vendedor: val('autv-tel'),
      edificio: val('autv-edificio'),
      planta: val('autv-planta'),
      puerta: val('autv-puerta'),
      precio_venta: parseFloat(val('autv-precio')) || 0,
      porcentaje_comision: parseFloat(val('autv-comision')) || 0,
      razon_social: val('autv-razon'),
      fecha_documento: val('autv-fecha'),
    };
  }

  async function generarAutVenta() {
    const btn = document.getElementById('autv-descargar');
    if (btn) btn.disabled = true;
    try {
      const r = await fetch('/api/ventas/autorizacion-venta-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(bodyAutVenta()),
      });
      if (!r.ok) throw new Error('No se pudo generar el PDF');
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'autorizacion-venta.pdf';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function generarAutVentaWord() {
    const btn = document.getElementById('autv-descargar-word');
    if (btn) btn.disabled = true;
    try {
      const r = await fetch('/api/ventas/autorizacion-venta-docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(bodyAutVenta()),
      });
      if (!r.ok) throw new Error('No se pudo generar el Word');
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'autorizacion-venta.docx';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function init() {
    construirFiltros();

    // Inyecta la columna "Apartamento" en la cabecera (la tabla está en index.html).
    const thead = document.querySelector('#tabla-propiedades thead tr');
    if (thead && !thead.querySelector('.vta-th-apto')) {
      const thRef = thead.querySelector('th');
      const th = document.createElement('th');
      th.className = 'vta-th-apto';
      th.textContent = 'Apartamento';
      if (thRef) thRef.insertAdjacentElement('afterend', th); else thead.appendChild(th);
    }

    document.getElementById('vta-buscar')?.addEventListener('input', (e) => { busqueda = e.target.value; renderTabla(); });
    document.getElementById('vta-nueva')?.addEventListener('click', () => modalFormulario(null));
    document.getElementById('vta-importar')?.addEventListener('click', modalImportar);

    // Toggle del panel de filtros.
    const fbtn = document.getElementById('vta-filtros-btn');
    const fpanel = document.getElementById('vta-filtros-panel');
    if (fbtn && fpanel) {
      const abrir = (v) => fpanel.classList.toggle('oculto', !v);
      fbtn.addEventListener('click', (e) => { e.stopPropagation(); abrir(fpanel.classList.contains('oculto')); });
      fpanel.addEventListener('click', (e) => e.stopPropagation());
      document.addEventListener('click', () => abrir(false));
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') abrir(false); });
    }

    // Inyecta las sub-pestañas Calendario y Vendidos (no están en index.html).
    const subtabs = document.getElementById('vta-subtabs');
    const scroll = document.querySelector('#vista-ventas .vta-scroll');
    const inyectarSub = (sub, etiqueta) => {
      if (subtabs && !subtabs.querySelector(`[data-sub="${sub}"]`)) {
        const btn = document.createElement('button');
        btn.className = 'subtab';
        btn.dataset.sub = sub;
        btn.textContent = etiqueta;
        subtabs.appendChild(btn);
      }
      if (scroll && !scroll.querySelector(`[data-panel-sub="${sub}"]`)) {
        const panel = document.createElement('div');
        panel.className = 'sub-panel';
        panel.dataset.panelSub = sub;
        scroll.appendChild(panel);
      }
    };
    inyectarSub('calendario', 'Calendario');
    inyectarSub('vendidos', 'Vendidos');
    inyectarSub('arras', 'Arras');
    inyectarSub('autorizacion', 'Autorización');

    // Sub-pestañas Propiedades / Clientes / Visitas / Calendario / Vendidos.
    document.querySelectorAll('#vta-subtabs .subtab').forEach((b) =>
      b.addEventListener('click', () => {
        document.querySelectorAll('#vta-subtabs .subtab').forEach((x) => x.classList.toggle('activo', x === b));
        document.querySelectorAll('#vista-ventas .sub-panel').forEach((p) =>
          p.classList.toggle('activo', p.dataset.panelSub === b.dataset.sub));
        if (b.dataset.sub === 'clientes') { construirClientes(); cargarClientes(); }
        if (b.dataset.sub === 'propietarios') { construirPropvent(); cargarPropvent(); }
        if (b.dataset.sub === 'visitas') { construirVisitas(); cargarVisitas(); }
        if (b.dataset.sub === 'calendario') { construirCalendario(); cargarCalendario(); }
        if (b.dataset.sub === 'vendidos') { construirVendidos(); cargarVendidos(); }
        if (b.dataset.sub === 'arras') { construirAutorizacion(); }
        if (b.dataset.sub === 'autorizacion') { construirAutVenta(); }
      }));
  }

  return { init, cargar, abrirFicha };
})();
