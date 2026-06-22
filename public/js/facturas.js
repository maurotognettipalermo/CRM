// Módulo Facturación (window.Facturas). Lista con filtros, ficha en panel lateral y un
// wizard de 2 pasos para emitir facturas (propietario / autofactura / gastos / huésped).
// Patrón IIFE; el panel lateral se crea por JS, como reservas/contratos.

const Facturas = (() => {
  const ANIOS = [2024, 2025, 2026];

  let todas = [];
  let filtroAnio = new Date().getFullYear();
  let filtroTipo = '';
  let filtroEstado = '';
  let filtroRazon = ''; // razon_social_id como string, '' = todas (filtro en cliente)
  let fichaActual = null;

  // Cachés cargadas bajo demanda para el wizard.
  let razonesCache = null;
  let propietariosCache = null;
  let apartamentosCache = null;
  let reservasCache = null;

  let wiz = null; // estado del wizard

  // ---- Formato ----
  function euro(n) { return (Number(n) || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'; }
  function hoyISO() { return new Date().toISOString().slice(0, 10); }
  function tipoTexto(t) {
    return { propietario: 'Propietario', autofactura: 'Autofactura', gastos: 'Gastos', 'huésped': 'Huésped', mayorista: 'Mayorista', libre: 'Libre' }[t] || t;
  }
  function estadoTexto(e) { return (e || '').charAt(0).toUpperCase() + (e || '').slice(1); }
  function badgeTipo(t) { return `<span class="badge-fac-tipo bf-${t === 'huésped' ? 'huesped' : t}">${tipoTexto(t)}</span>`; }
  function badgeEstado(e) { return `<span class="badge-fac-estado be-${e}">${estadoTexto(e)}</span>`; }

  // ==================== Carga + tabla ====================
  async function cargar() {
    const qs = new URLSearchParams({ anio: filtroAnio });
    if (filtroTipo) qs.set('tipo', filtroTipo);
    if (filtroEstado) qs.set('estado', filtroEstado);
    try {
      todas = await API.get('/api/facturas?' + qs.toString());
    } catch (e) {
      return toast(e.message, 'error');
    }
    render();
  }

  function render() {
    const lista = filtroRazon ? todas.filter((f) => String(f.razon_social_id) === filtroRazon) : todas;
    const cont = document.getElementById('fac-contador');
    const total = lista.reduce((s, f) => s + (Number(f.total) || 0), 0);
    if (cont) cont.textContent = `Total: ${lista.length} factura${lista.length === 1 ? '' : 's'} — ${euro(total)}`;

    const tbody = document.querySelector('#tabla-facturas tbody');
    tbody.innerHTML = '';
    if (!lista.length) {
      tbody.innerHTML = '<tr><td colspan="10" style="color:#6b7280;text-align:center;padding:24px">No hay facturas con los filtros actuales.</td></tr>';
      return;
    }
    for (const f of lista) {
      const logo = f.emisor_logo_url ? `<img class="fac-logo-mini" src="${esc(f.emisor_logo_url)}" alt="" onerror="this.style.display='none'"> ` : '';
      const accVer = `<button class="btn-mini" data-ver="${f.id}" data-numero="${esc(f.numero)}" title="Ver PDF">👁</button>`;
      const accPagar = (f.estado !== 'pagada' && f.estado !== 'anulada') ? `<button class="btn-mini" data-pagar="${f.id}" title="Marcar pagada">✓</button>` : '';
      const accAnular = (f.estado !== 'anulada') ? `<button class="btn-mini" data-anular="${f.id}" title="Anular">⊘</button>` : '';
      const accBorrar = (f.estado === 'borrador') ? `<button class="btn-mini" data-borrar="${f.id}" title="Eliminar">🗑️</button>` : '';
      const tr = document.createElement('tr');
      tr.dataset.ficha = f.id;
      tr.innerHTML = `
        <td><span class="enlace-fila">${esc(f.numero)}</span></td>
        <td>${badgeTipo(f.tipo)}</td>
        <td>${fechaES(f.fecha_emision)}</td>
        <td><span class="fac-emisor-cel">${logo}${esc(f.emisor_nombre)}</span></td>
        <td>${esc(f.receptor_nombre)}</td>
        <td class="num">${euro(f.base_imponible)}</td>
        <td class="num">${euro(f.importe_iva)}</td>
        <td class="num">${euro(f.total)}</td>
        <td>${badgeEstado(f.estado)}</td>
        <td class="acciones">${accVer}${accPagar}${accAnular}${accBorrar}</td>`;
      tbody.appendChild(tr);
    }
    tbody.querySelectorAll('tr[data-ficha]').forEach((tr) =>
      tr.addEventListener('click', (e) => { if (e.target.closest('button')) return; abrirFicha(tr.dataset.ficha); }));
    tbody.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); descargarPDF(b.dataset.ver, b.dataset.numero); }));
    tbody.querySelectorAll('[data-pagar]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); marcarPagada(b.dataset.pagar); }));
    tbody.querySelectorAll('[data-anular]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); anular(b.dataset.anular); }));
    tbody.querySelectorAll('[data-borrar]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); borrar(b.dataset.borrar); }));
  }

  async function marcarPagada(id) {
    try { await API.put('/api/facturas/' + id, { estado: 'pagada' }); await cargar(); toast('Factura marcada como pagada', 'ok'); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function anular(id) {
    if (!confirm('¿Anular esta factura? No se podrá deshacer.')) return;
    try {
      await API.put('/api/facturas/' + id + '/anular', {});
      await cargar();
      if (fichaActual && String(fichaActual.id) === String(id)) await abrirFicha(id);
      toast('Factura anulada', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  }
  async function borrar(id) {
    if (!confirm('¿Eliminar esta factura en borrador?')) return;
    try { await API.del('/api/facturas/' + id); await cargar(); toast('Factura eliminada', 'ok'); }
    catch (e) { toast(e.message, 'error'); }
  }

  // Descarga via fetch con el token (window.open no envía X-Auth-Token -> 401).
  async function descargarPDF(id, numero) {
    try {
      const sesion = Auth.sesion() || {};
      const response = await fetch(`/api/facturas/${id}/pdf`, {
        headers: { 'X-Auth-Token': sesion.token },
      });
      if (!response.ok) throw new Error('Error al generar PDF');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${numero || 'factura'}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      toast('Error al descargar el PDF', 'error');
    }
  }

  // ==================== Panel lateral (ficha) ====================
  function crearPanel() {
    if (document.getElementById('fac-panel')) return;
    const fondo = document.createElement('div');
    fondo.id = 'fac-panel-fondo';
    fondo.className = 'panel-fondo';
    const panel = document.createElement('aside');
    panel.id = 'fac-panel';
    panel.className = 'panel-lateral';
    panel.setAttribute('aria-label', 'Ficha de factura');
    panel.innerHTML = `
      <header class="panel-cabecera">
        <div class="rsv-titulo-grupo">
          <h3 id="fac-titulo">Factura</h3>
          <span id="fac-badges"></span>
        </div>
        <div class="panel-cabecera-acciones">
          <button id="fac-editar" class="btn-sec oculto">✏️ Editar</button>
          <button id="fac-pdf" class="btn-sec">Descargar PDF</button>
          <button id="fac-anular" class="btn-sec">Anular</button>
          <button id="fac-cerrar" class="panel-cerrar" title="Cerrar">&times;</button>
        </div>
      </header>
      <div id="fac-cuerpo" class="panel-cuerpo"></div>`;
    document.body.appendChild(fondo);
    document.body.appendChild(panel);
    fondo.addEventListener('click', cerrarPanel);
    panel.querySelector('#fac-cerrar').addEventListener('click', cerrarPanel);
    panel.querySelector('#fac-pdf').addEventListener('click', () => { if (fichaActual) descargarPDF(fichaActual.id, fichaActual.numero); });
    panel.querySelector('#fac-anular').addEventListener('click', () => { if (fichaActual) anular(fichaActual.id); });
    panel.querySelector('#fac-editar').addEventListener('click', () => { if (fichaActual) abrirEditar(fichaActual); });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const modalAbierto = !document.getElementById('modal-fondo').classList.contains('oculto');
      if (!modalAbierto && panel.classList.contains('abierto')) cerrarPanel();
    }, true);
  }
  function abrirPanel() {
    document.getElementById('fac-panel-fondo').classList.add('abierto');
    document.getElementById('fac-panel').classList.add('abierto');
  }
  function cerrarPanel() {
    document.getElementById('fac-panel-fondo').classList.remove('abierto');
    document.getElementById('fac-panel').classList.remove('abierto');
    fichaActual = null;
  }

  // ==================== Edición de factura (solo administradores) ====================
  const ESTADOS_FAC = [['borrador', 'Borrador'], ['emitida', 'Emitida'], ['pagada', 'Pagada'], ['anulada', 'Anulada']];
  let edLineas = []; // estado de las líneas en el modal de edición

  function esAdmin() { return (((typeof Auth !== 'undefined' && Auth.sesion && Auth.sesion()) || {}).rol) === 'administrador'; }
  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function fval(id) { const el = document.getElementById(id); return el ? el.value : ''; }

  function abrirEditar(f) {
    if (!f) return;
    edLineas = (f.lineas || []).map((l) => ({
      descripcion: l.descripcion || '',
      cantidad: Number(l.cantidad) || 0,
      precio_unitario: Number(l.precio_unitario) || 0,
      importe: Number(l.importe) || 0,
    }));
    const optEstado = ESTADOS_FAC.map(([v, t]) => `<option value="${v}"${f.estado === v ? ' selected' : ''}>${t}</option>`).join('');
    const sec = 'style="font-weight:700;color:var(--text);margin:18px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--border-soft)"';
    const totFila = 'style="display:flex;justify-content:space-between;align-items:center;padding:6px 0"';
    const pct = 'style="width:64px;padding:4px 6px;margin:0 4px"';

    abrirModal(`
      <h3>✏️ Editar factura ${esc(f.numero)}</h3>
      <div ${sec}>Datos generales</div>
      <div class="fila-campos">
        <div class="campo"><label>Número de factura</label><input value="${esc(f.numero)}" disabled></div>
        <div class="campo"><label>Estado</label><select id="fe-estado">${optEstado}</select></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Fecha emisión</label><input type="date" id="fe-femision" value="${esc(f.fecha_emision)}"></div>
        <div class="campo"><label>Fecha vencimiento</label><input type="date" id="fe-fvenc" value="${esc(f.fecha_vencimiento)}"></div>
      </div>
      <div class="campo"><label>Notas</label><textarea id="fe-notas" rows="2">${esc(f.notas)}</textarea></div>

      <div ${sec}>Emisor</div>
      <div class="campo"><label>Nombre</label><input id="fe-em-nombre" value="${esc(f.emisor_nombre)}"></div>
      <div class="fila-campos">
        <div class="campo"><label>CIF/NIF</label><input id="fe-em-cif" value="${esc(f.emisor_cif)}"></div>
        <div class="campo"><label>Dirección</label><input id="fe-em-dir" value="${esc(f.emisor_direccion)}"></div>
      </div>

      <div ${sec}>Receptor</div>
      <div class="campo"><label>Nombre</label><input id="fe-re-nombre" value="${esc(f.receptor_nombre)}"></div>
      <div class="fila-campos">
        <div class="campo"><label>CIF/NIF</label><input id="fe-re-cif" value="${esc(f.receptor_cif)}"></div>
        <div class="campo"><label>Email</label><input id="fe-re-email" value="${esc(f.receptor_email)}"></div>
      </div>
      <div class="campo"><label>Dirección</label><input id="fe-re-dir" value="${esc(f.receptor_direccion)}"></div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin:18px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--border-soft)">
        <span style="font-weight:700;color:var(--text)">Líneas de factura</span>
        <button class="btn-sec" id="fe-add">＋ Añadir línea</button>
      </div>
      <div class="tabla-scroll">
        <table class="tabla">
          <thead><tr>
            <th>Descripción</th><th class="num">Cantidad</th><th class="num">Precio unit.</th><th class="num">Importe</th><th></th>
          </tr></thead>
          <tbody id="fe-lineas"></tbody>
        </table>
      </div>

      <div ${sec}>Totales</div>
      <div style="max-width:360px;margin-left:auto">
        <div ${totFila}><span>Base imponible</span><strong id="fe-base">—</strong></div>
        <div ${totFila}><span>IVA <input type="number" id="fe-iva" ${pct} min="0" step="0.01" value="${Number(f.porcentaje_iva) || 0}">%</span><strong id="fe-imp-iva">—</strong></div>
        <div ${totFila}><span>Retención <input type="number" id="fe-ret" ${pct} min="0" step="0.01" value="${Number(f.porcentaje_retencion) || 0}">%</span><strong id="fe-imp-ret">—</strong></div>
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-top:2px solid var(--text);margin-top:4px;font-size:18px;font-weight:700"><span>TOTAL</span><strong id="fe-total">—</strong></div>
      </div>

      <div class="modal-acciones">
        <button class="btn-sec" id="fe-cancelar">Cancelar</button>
        <button class="btn-pri" id="fe-guardar">Guardar cambios</button>
      </div>`);
    document.querySelector('.modal')?.classList.add('modal-ancho');

    pintarLineasEdit();
    recalcEdit();
    document.getElementById('fe-iva').addEventListener('input', recalcEdit);
    document.getElementById('fe-ret').addEventListener('input', recalcEdit);
    document.getElementById('fe-add').addEventListener('click', () => {
      edLineas.push({ descripcion: '', cantidad: 1, precio_unitario: 0, importe: 0 });
      pintarLineasEdit(); recalcEdit();
    });
    document.getElementById('fe-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('fe-guardar').addEventListener('click', () => guardarEdicion(f.id));
  }

  function pintarLineasEdit() {
    const tbody = document.getElementById('fe-lineas');
    if (!tbody) return;
    tbody.innerHTML = edLineas.map((l, i) => `
      <tr>
        <td><input data-ed-desc="${i}" style="width:100%" value="${esc(l.descripcion)}"></td>
        <td class="num"><input type="number" data-ed-cant="${i}" style="width:80px;text-align:right" min="0" step="0.01" value="${l.cantidad}"></td>
        <td class="num"><input type="number" data-ed-precio="${i}" style="width:90px;text-align:right" min="0" step="0.01" value="${l.precio_unitario}"></td>
        <td class="num" data-ed-importe="${i}">${euro(l.importe)}</td>
        <td class="acciones"><button class="btn-mini" data-ed-del="${i}" title="Eliminar">🗑</button></td>
      </tr>`).join('') || '<tr><td colspan="5" style="color:#6b7280;text-align:center;padding:14px">Sin líneas. Añade al menos una.</td></tr>';

    tbody.querySelectorAll('[data-ed-desc]').forEach((el) =>
      el.addEventListener('input', () => { edLineas[Number(el.dataset.edDesc)].descripcion = el.value; }));
    tbody.querySelectorAll('[data-ed-cant]').forEach((el) =>
      el.addEventListener('input', () => { actualizarLinea(Number(el.dataset.edCant)); }));
    tbody.querySelectorAll('[data-ed-precio]').forEach((el) =>
      el.addEventListener('input', () => { actualizarLinea(Number(el.dataset.edPrecio)); }));
    tbody.querySelectorAll('[data-ed-del]').forEach((el) =>
      el.addEventListener('click', () => { edLineas.splice(Number(el.dataset.edDel), 1); pintarLineasEdit(); recalcEdit(); }));
  }

  // Recalcula el importe de una línea (cantidad × precio) sin repintar toda la tabla.
  function actualizarLinea(i) {
    const elCant = document.querySelector(`[data-ed-cant="${i}"]`);
    const elPrecio = document.querySelector(`[data-ed-precio="${i}"]`);
    const cant = Number(elCant && elCant.value) || 0;
    const precio = Number(elPrecio && elPrecio.value) || 0;
    edLineas[i].cantidad = cant;
    edLineas[i].precio_unitario = precio;
    edLineas[i].importe = round2(cant * precio);
    const cel = document.querySelector(`[data-ed-importe="${i}"]`);
    if (cel) cel.textContent = euro(edLineas[i].importe);
    recalcEdit();
  }

  function recalcEdit() {
    const base = round2(edLineas.reduce((s, l) => s + (Number(l.importe) || 0), 0));
    const pIva = Number(fval('fe-iva')) || 0;
    const pRet = Number(fval('fe-ret')) || 0;
    const impIva = round2(base * pIva / 100);
    const impRet = round2(base * pRet / 100);
    const total = round2(base + impIva - impRet);
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = euro(v); };
    set('fe-base', base); set('fe-imp-iva', impIva); set('fe-imp-ret', impRet); set('fe-total', total);
  }

  async function guardarEdicion(id) {
    const body = {
      fecha_emision: fval('fe-femision'),
      fecha_vencimiento: fval('fe-fvenc'),
      estado: fval('fe-estado'),
      notas: fval('fe-notas'),
      emisor_nombre: fval('fe-em-nombre'),
      emisor_cif: fval('fe-em-cif'),
      emisor_direccion: fval('fe-em-dir'),
      receptor_nombre: fval('fe-re-nombre'),
      receptor_cif: fval('fe-re-cif'),
      receptor_direccion: fval('fe-re-dir'),
      receptor_email: fval('fe-re-email'),
      porcentaje_iva: Number(fval('fe-iva')) || 0,
      porcentaje_retencion: Number(fval('fe-ret')) || 0,
      lineas: edLineas.map((l, i) => ({
        descripcion: l.descripcion,
        cantidad: Number(l.cantidad) || 0,
        precio_unitario: Number(l.precio_unitario) || 0,
        importe: round2((Number(l.cantidad) || 0) * (Number(l.precio_unitario) || 0)),
        orden: i,
      })),
    };
    const btn = document.getElementById('fe-guardar');
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      await API.put('/api/facturas/' + id, body);
      cerrarModal();
      await cargar();
      if (fichaActual && String(fichaActual.id) === String(id)) await abrirFicha(id);
      toast('Factura actualizada', 'ok');
    } catch (e) {
      // 403 → "Solo los administradores pueden editar facturas"
      toast(e.message, 'error');
      btn.disabled = false; btn.textContent = 'Guardar cambios';
    }
  }

  async function abrirFicha(id) {
    crearPanel();
    try { fichaActual = await API.get('/api/facturas/' + id); }
    catch (e) { return toast(e.message, 'error'); }
    document.getElementById('fac-titulo').textContent = fichaActual.numero || 'Factura';
    document.getElementById('fac-badges').innerHTML = badgeTipo(fichaActual.tipo) + ' ' + badgeEstado(fichaActual.estado);
    document.getElementById('fac-anular').classList.toggle('oculto', fichaActual.estado === 'anulada');
    document.getElementById('fac-editar').classList.toggle('oculto', !esAdmin());
    document.getElementById('fac-cuerpo').innerHTML = fichaHTML(fichaActual);
    abrirPanel();
  }

  function dato(etq, val) { return `<div class="campo-ficha"><div class="etq">${etq}</div><div class="val">${val || '—'}</div></div>`; }

  function fichaHTML(f) {
    const emisor = `
      ${f.emisor_logo_url ? `<img class="fac-ficha-logo" src="${esc(f.emisor_logo_url)}" alt="" onerror="this.style.display='none'">` : ''}
      ${dato('Nombre', esc(f.emisor_nombre))}
      ${dato('CIF/NIF', esc(f.emisor_cif))}
      ${dato('Dirección', esc(f.emisor_direccion))}`;
    const receptor = `
      ${dato('Nombre', esc(f.receptor_nombre))}
      ${dato('CIF/NIF', esc(f.receptor_cif))}
      ${dato('Dirección', esc(f.receptor_direccion))}
      ${dato('Email', esc(f.receptor_email))}`;

    const lineas = (f.lineas || []).map((l) => `
      <tr>
        <td>${esc(l.descripcion)}</td>
        <td class="num">${(Number(l.cantidad) || 0).toLocaleString('es-ES')}</td>
        <td class="num">${euro(l.precio_unitario)}</td>
        <td class="num">${euro(l.importe)}</td>
      </tr>`).join('');

    const ivaRow = f.porcentaje_iva ? `<div class="fac-tot-row"><span>IVA ${f.porcentaje_iva}%</span><span>${euro(f.importe_iva)}</span></div>` : '';
    const retRow = f.porcentaje_retencion ? `<div class="fac-tot-row" style="color:var(--red)"><span>Retención ${f.porcentaje_retencion}%</span><span>−${euro(f.importe_retencion)}</span></div>` : '';

    return `
      <div class="rsv-grid">
        <div>
          <div class="ficha-seccion-titulo">Emisor</div>
          ${emisor}
        </div>
        <div>
          <div class="ficha-seccion-titulo">Receptor</div>
          ${receptor}
        </div>
      </div>

      <div class="ficha-seccion-titulo">Detalles</div>
      <div class="ficha-grid">
        ${dato('Fecha emisión', fechaES(f.fecha_emision))}
        ${dato('Fecha vencimiento', f.fecha_vencimiento ? fechaES(f.fecha_vencimiento) : '—')}
        ${dato('Contrato asociado', f.contrato_id ? '#' + f.contrato_id : '—')}
        ${dato('Apartamento', f.apartamento_id ? '#' + f.apartamento_id : '—')}
        ${dato('Propietario', f.propietario_id ? '#' + f.propietario_id : '—')}
        ${dato('Reserva', f.reserva_id ? '#' + f.reserva_id : '—')}
      </div>
      ${f.notas ? `<div class="campo-ficha ancho-total"><div class="etq">Notas</div><div class="val">${esc(f.notas)}</div></div>` : ''}

      <div class="ficha-seccion-titulo">Líneas de factura</div>
      <div class="tabla-scroll">
        <table class="tabla">
          <thead><tr><th>Descripción</th><th class="num">Cantidad</th><th class="num">Precio unitario</th><th class="num">Importe</th></tr></thead>
          <tbody>${lineas || '<tr><td colspan="4" style="color:#6b7280">Sin líneas</td></tr>'}</tbody>
        </table>
      </div>
      <div class="fac-totales">
        <div class="fac-tot-row"><span>Base imponible</span><span>${euro(f.base_imponible)}</span></div>
        ${ivaRow}
        ${retRow}
        <div class="fac-tot-row fac-tot-total"><span>TOTAL</span><span>${euro(f.total)}</span></div>
      </div>`;
  }

  // ==================== Wizard de nueva factura ====================
  const TIPOS_WIZ = [
    { tipo: 'propietario', icono: '🏠', titulo: 'Propietario', desc: 'Factura de pago garantizado al propietario' },
    { tipo: 'autofactura', icono: '📄', titulo: 'Autofactura', desc: 'Emitida en nombre del propietario hacia nosotros' },
    { tipo: 'gastos', icono: '🔧', titulo: 'Gastos', desc: 'Refacturación de gastos del apartamento al propietario' },
    { tipo: 'huésped', icono: '👤', titulo: 'Huésped', desc: 'Factura de estancia al cliente' },
    { tipo: 'libre', icono: '✏️', titulo: 'Libre', desc: 'Factura personalizada con datos manuales' },
  ];

  async function ensureRazones() { if (!razonesCache) razonesCache = await API.get('/api/ajustes/razones-sociales'); return razonesCache; }
  async function ensurePropietarios() { if (!propietariosCache) propietariosCache = await API.get('/api/propietarios'); return propietariosCache; }
  async function ensureApartamentos() { if (!apartamentosCache) apartamentosCache = await API.get('/api/apartamentos?todos=1'); return apartamentosCache; }
  async function ensureReservas() { if (!reservasCache) reservasCache = await API.get('/api/reservas/todas'); return reservasCache; }

  function nombreProp(p) { return [p.nombre, p.apellidos, p.segundo_apellido].filter(Boolean).join(' '); }

  async function abrirWizard() {
    wiz = {
      paso: 1, tipo: null, razonId: null, anio: filtroAnio,
      propSel: null, contratoSel: null, cuotas: [], cuotaSel: [],
      aptoSel: null, gastos: [], gastoSel: [], reservaSel: null,
      libreLineas: [{ descripcion: '', cantidad: 1, precio_unitario: 0 }], libreIva: 21, libreRet: 0,
    };
    try { await ensureRazones(); } catch (e) { return toast(e.message, 'error'); }
    // Preselección de razón social: única -> esa; si hay varias -> "COSTA AZAHAR..." si existe;
    // en su defecto, la primera de la lista.
    const lista = razonesCache || [];
    if (lista.length === 1) {
      wiz.razonId = lista[0].id;
    } else if (lista.length > 1) {
      const costa = lista.find((r) => r.razon_social === 'COSTA AZAHAR REAL ESTATE SOLUTIONS 2023 SLU');
      wiz.razonId = (costa || lista[0]).id;
    }
    renderWizard();
  }

  function renderWizard() {
    abrirModal(wiz.paso === 1 ? wizardPaso1HTML() : wizardPaso2HTML());
    document.querySelector('.modal').classList.add('modal-ancho');
    if (wiz.paso === 1) wirePaso1(); else wirePaso2();
  }

  function wizardPaso1HTML() {
    const ops = TIPOS_WIZ.map((t) => `
      <div class="fac-tipo-op${wiz.tipo === t.tipo ? ' activo' : ''}" data-tipo="${t.tipo}">
        <span class="fac-tipo-op-icono">${t.icono}</span>
        <div class="fac-tipo-op-titulo">${t.titulo}</div>
        <div class="fac-tipo-op-desc">${t.desc}</div>
      </div>`).join('');
    const razones = (razonesCache || []).map((r) => `<option value="${r.id}"${wiz.razonId === r.id ? ' selected' : ''}>${esc(r.razon_social || r.nombre_comercial || ('Razón #' + r.id))}</option>`).join('');
    return `
      <h3>Nueva factura</h3>
      <div class="fac-wiz-paso">Paso 1 de 2 · Tipo y razón social</div>
      <div class="fac-tipo-grid">${ops}</div>
      <div class="campo">
        <label>Razón social emisora *</label>
        <div style="display:flex;align-items:center;gap:10px">
          <select id="wiz-razon" style="flex:1"><option value="">— Selecciona —</option>${razones}</select>
          <img id="wiz-razon-logo" class="fac-razon-logo oculto" alt="">
        </div>
      </div>
      <div class="modal-acciones">
        <button class="btn-sec" id="wiz-cancelar">Cancelar</button>
        <button class="btn-pri" id="wiz-siguiente">Siguiente →</button>
      </div>`;
  }

  function wirePaso1() {
    document.querySelectorAll('#modal-contenido .fac-tipo-op').forEach((op) =>
      op.addEventListener('click', () => {
        wiz.tipo = op.dataset.tipo;
        document.querySelectorAll('#modal-contenido .fac-tipo-op').forEach((o) => o.classList.toggle('activo', o === op));
      }));
    const sel = document.getElementById('wiz-razon');
    const actualizarLogo = () => {
      wiz.razonId = Number(sel.value) || null;
      const r = (razonesCache || []).find((x) => x.id === wiz.razonId);
      const img = document.getElementById('wiz-razon-logo');
      if (r && r.logo_url) { img.src = r.logo_url; img.classList.remove('oculto'); } else { img.classList.add('oculto'); }
    };
    sel.addEventListener('change', actualizarLogo);
    actualizarLogo();
    document.getElementById('wiz-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('wiz-siguiente').addEventListener('click', () => {
      if (!wiz.tipo) return toast('Selecciona el tipo de factura', 'error');
      if (!wiz.razonId) return toast('Selecciona la razón social emisora', 'error');
      wiz.paso = 2;
      renderWizard();
    });
  }

  function camposFechasHTML() {
    return `
      <div class="fila-campos">
        <div class="campo"><label>Fecha emisión</label><input type="date" id="wiz-fecha" value="${hoyISO()}"></div>
        <div class="campo"><label>Fecha vencimiento</label><input type="date" id="wiz-venc"></div>
      </div>
      <div class="campo"><label>Notas</label><textarea id="wiz-notas"></textarea></div>`;
  }

  function wizardPaso2HTML() {
    let cuerpo = '';
    if (wiz.tipo === 'propietario' || wiz.tipo === 'autofactura') {
      cuerpo = `
        <div class="campo cnt-typeahead">
          <label>Propietario *</label>
          <input id="wiz-prop-buscar" placeholder="Buscar propietario..." autocomplete="off">
          <div class="cnt-ta-dropdown oculto" id="wiz-prop-dd"></div>
        </div>
        <div class="campo"><label>Contrato *</label>
          <select id="wiz-contrato" disabled><option value="">— Selecciona un propietario —</option></select>
        </div>
        <div id="wiz-cuotas"></div>
        <div id="wiz-cuotas-resumen" class="fac-resumen oculto"></div>
        ${camposFechasHTML()}`;
    } else if (wiz.tipo === 'gastos') {
      cuerpo = `
        <div class="campo cnt-typeahead">
          <label>Apartamento *</label>
          <input id="wiz-apto-buscar" placeholder="Buscar apartamento..." autocomplete="off">
          <div class="cnt-ta-dropdown oculto" id="wiz-apto-dd"></div>
        </div>
        <div id="wiz-gastos"></div>
        <div id="wiz-gastos-resumen" class="fac-resumen oculto"></div>
        ${camposFechasHTML()}`;
    } else if (wiz.tipo === 'libre') {
      const ivaOps = [0, 10, 21].map((v) => `<option value="${v}"${wiz.libreIva === v ? ' selected' : ''}>${v}%</option>`).join('');
      const retOps = [0, 19, 24].map((v) => `<option value="${v}"${wiz.libreRet === v ? ' selected' : ''}>${v}%</option>`).join('');
      cuerpo = `
        <div class="ficha-seccion-titulo">Receptor</div>
        <div class="fila-campos">
          <div class="campo"><label>Nombre receptor *</label><input id="wiz-rec-nombre"></div>
          <div class="campo"><label>CIF/NIF</label><input id="wiz-rec-cif"></div>
        </div>
        <div class="fila-campos">
          <div class="campo"><label>Dirección</label><input id="wiz-rec-dir"></div>
          <div class="campo"><label>Email</label><input id="wiz-rec-email"></div>
        </div>
        <div class="fila-campos">
          <div class="campo"><label>Ciudad</label><input id="wiz-rec-ciudad"></div>
          <div class="campo"><label>Código postal</label><input id="wiz-rec-cp"></div>
        </div>
        <div class="ficha-seccion-titulo">Líneas de factura</div>
        <table class="fac-libre-tabla" style="width:100%;border-collapse:collapse;margin-bottom:8px">
          <thead><tr style="text-align:left;color:#6b7280;font-size:13px">
            <th style="padding:4px">Descripción</th><th style="padding:4px;width:78px">Cantidad</th>
            <th style="padding:4px;width:98px">Precio unit.</th><th style="padding:4px;width:90px;text-align:right">Importe</th><th style="width:44px"></th>
          </tr></thead>
          <tbody id="wiz-libre-body"></tbody>
        </table>
        <button type="button" class="btn-sec" id="wiz-libre-add">＋ Añadir línea</button>
        <div class="ficha-seccion-titulo">Fiscalidad</div>
        <div class="fila-campos">
          <div class="campo"><label>IVA %</label><select id="wiz-libre-iva">${ivaOps}</select></div>
          <div class="campo"><label>Retención %</label><select id="wiz-libre-ret">${retOps}</select></div>
        </div>
        <div id="wiz-libre-tot" class="fac-resumen"></div>
        ${camposFechasHTML()}`;
    } else {
      cuerpo = `
        <div class="campo cnt-typeahead">
          <label>Reserva *</label>
          <input id="wiz-res-buscar" placeholder="Buscar por nº reserva o cliente..." autocomplete="off">
          <div class="cnt-ta-dropdown oculto" id="wiz-res-dd"></div>
        </div>
        <div id="wiz-res-info" class="fac-resumen oculto"></div>
        <div class="fac-info-azul">ℹ️ En el futuro estos datos se obtendrán automáticamente del check-in online</div>
        <div class="fila-campos">
          <div class="campo"><label>Nombre receptor *</label><input id="wiz-rec-nombre"></div>
          <div class="campo"><label>CIF/NIF</label><input id="wiz-rec-cif"></div>
        </div>
        <div class="fila-campos">
          <div class="campo"><label>Dirección</label><input id="wiz-rec-dir"></div>
          <div class="campo"><label>Email</label><input id="wiz-rec-email"></div>
        </div>
        <div class="campo"><label>Importe de la estancia (€)</label><input id="wiz-importe" class="campo-readonly" readonly></div>
        ${camposFechasHTML()}`;
    }
    return `
      <h3>Nueva factura — ${tipoTexto(wiz.tipo)}</h3>
      <div class="fac-wiz-paso">Paso 2 de 2 · Datos</div>
      ${cuerpo}
      <div class="modal-acciones">
        <button class="btn-sec" id="wiz-atras">← Anterior</button>
        <span style="flex:1"></span>
        <button class="btn-sec" id="wiz-borrador">Guardar borrador</button>
        <button class="btn-pri" id="wiz-emitir">Emitir factura</button>
      </div>`;
  }

  function wirePaso2() {
    document.getElementById('wiz-atras').addEventListener('click', () => { wiz.paso = 1; renderWizard(); });
    document.getElementById('wiz-emitir').addEventListener('click', () => guardarWizard('emitida'));
    document.getElementById('wiz-borrador').addEventListener('click', () => guardarWizard('borrador'));

    if (wiz.tipo === 'propietario' || wiz.tipo === 'autofactura') wirePropietario();
    else if (wiz.tipo === 'gastos') wireGastos();
    else if (wiz.tipo === 'libre') wireLibre();
    else wireHuesped();
  }

  // ---- Libre ----
  function wireLibre() {
    const body = document.getElementById('wiz-libre-body');
    const impLinea = (l) => euro((Number(l.cantidad) || 0) * (Number(l.precio_unitario) || 0));

    const repintarTot = () => {
      const base = wiz.libreLineas.reduce((s, l) => s + (Number(l.cantidad) || 0) * (Number(l.precio_unitario) || 0), 0);
      const iva = base * wiz.libreIva / 100;
      const ret = base * wiz.libreRet / 100;
      const tot = base + iva - ret;
      const fila = 'display:flex;justify-content:space-between;padding:2px 0';
      document.getElementById('wiz-libre-tot').innerHTML = `
        <div style="${fila}"><span>Base imponible</span><strong>${euro(base)}</strong></div>
        <div style="${fila}"><span>IVA (${wiz.libreIva}%)</span><strong>${euro(iva)}</strong></div>
        ${wiz.libreRet > 0 ? `<div style="${fila}"><span>Retención (${wiz.libreRet}%)</span><strong>−${euro(ret)}</strong></div>` : ''}
        <div style="${fila};font-weight:700;border-top:1px solid var(--border);margin-top:4px;padding-top:4px"><span>TOTAL</span><strong>${euro(tot)}</strong></div>`;
    };

    const repintarBody = () => {
      body.innerHTML = wiz.libreLineas.map((l, i) => `
        <tr>
          <td style="padding:3px"><input class="lib-f" data-k="descripcion" data-i="${i}" value="${esc(l.descripcion || '')}" placeholder="Concepto" style="width:100%"></td>
          <td style="padding:3px"><input class="lib-f" data-k="cantidad" data-i="${i}" type="number" step="0.01" min="0" value="${l.cantidad}" style="width:72px"></td>
          <td style="padding:3px"><input class="lib-f" data-k="precio_unitario" data-i="${i}" type="number" step="0.01" value="${l.precio_unitario}" style="width:92px"></td>
          <td style="padding:3px;text-align:right" id="lib-imp-${i}">${impLinea(l)}</td>
          <td style="padding:3px"><button type="button" class="btn-peligro lib-del" data-i="${i}">🗑</button></td>
        </tr>`).join('');
      body.querySelectorAll('.lib-f').forEach((inp) => inp.addEventListener('input', () => {
        const i = Number(inp.dataset.i);
        wiz.libreLineas[i][inp.dataset.k] = inp.value;
        document.getElementById('lib-imp-' + i).textContent = impLinea(wiz.libreLineas[i]);
        repintarTot();
      }));
      body.querySelectorAll('.lib-del').forEach((btn) => btn.addEventListener('click', () => {
        wiz.libreLineas.splice(Number(btn.dataset.i), 1);
        if (!wiz.libreLineas.length) wiz.libreLineas.push({ descripcion: '', cantidad: 1, precio_unitario: 0 });
        repintarBody(); repintarTot();
      }));
    };

    document.getElementById('wiz-libre-add').addEventListener('click', () => {
      wiz.libreLineas.push({ descripcion: '', cantidad: 1, precio_unitario: 0 });
      repintarBody(); repintarTot();
    });
    document.getElementById('wiz-libre-iva').addEventListener('change', (e) => { wiz.libreIva = Number(e.target.value) || 0; repintarTot(); });
    document.getElementById('wiz-libre-ret').addEventListener('change', (e) => { wiz.libreRet = Number(e.target.value) || 0; repintarTot(); });

    repintarBody();
    repintarTot();
  }

  // ---- Typeahead genérico ----
  function crearTypeahead(inputId, ddId, buscar, render, onSelect, onInput) {
    const input = document.getElementById(inputId);
    const dd = document.getElementById(ddId);
    let matches = [];
    let idx = -1;
    const cerrar = () => { dd.classList.add('oculto'); idx = -1; };
    const pintar = () => {
      if (!matches.length) { dd.innerHTML = '<div class="cnt-ta-vacio">Sin resultados</div>'; dd.classList.remove('oculto'); return; }
      dd.innerHTML = matches.map((m, i) => `<div class="cnt-ta-op${i === idx ? ' activo' : ''}" data-i="${i}">${render(m)}</div>`).join('');
      dd.classList.remove('oculto');
      dd.querySelectorAll('.cnt-ta-op').forEach((op) => op.addEventListener('mousedown', (e) => { e.preventDefault(); cerrar(); onSelect(matches[Number(op.dataset.i)]); }));
    };
    input.addEventListener('input', () => {
      if (onInput) onInput();
      const q = input.value.trim();
      if (q.length < 2) { cerrar(); return; }
      matches = buscar(q).slice(0, 50);
      idx = -1; pintar();
    });
    input.addEventListener('keydown', (e) => {
      const abierto = !dd.classList.contains('oculto');
      if (e.key === 'ArrowDown') { if (!abierto) return; e.preventDefault(); idx = Math.min(idx + 1, matches.length - 1); pintar(); }
      else if (e.key === 'ArrowUp') { if (!abierto) return; e.preventDefault(); idx = Math.max(idx - 1, 0); pintar(); }
      else if (e.key === 'Enter') { if (abierto && idx >= 0 && matches[idx]) { e.preventDefault(); cerrar(); onSelect(matches[idx]); } }
      else if (e.key === 'Escape') { if (abierto) { e.preventDefault(); e.stopPropagation(); cerrar(); } }
    });
    input.addEventListener('blur', () => setTimeout(cerrar, 120));
  }

  // ---- Propietario / autofactura ----
  async function wirePropietario() {
    await ensurePropietarios();
    crearTypeahead('wiz-prop-buscar', 'wiz-prop-dd',
      (q) => propietariosCache.filter((p) => nombreProp(p).toLowerCase().includes(q.toLowerCase()) || (p.email || '').toLowerCase().includes(q.toLowerCase())),
      (p) => `<span class="cnt-ta-nombre">${esc(nombreProp(p))}${p.email ? ` <span class="cnt-ta-edif">${esc(p.email)}</span>` : ''}</span>`,
      async (p) => {
        wiz.propSel = p.id;
        document.getElementById('wiz-prop-buscar').value = nombreProp(p);
        await cargarContratosWiz(p.id);
      },
      () => { wiz.propSel = null; });

    document.getElementById('wiz-contrato').addEventListener('change', (e) => cargarCuotasWiz(Number(e.target.value) || null));
  }

  async function cargarContratosWiz(propId) {
    const sel = document.getElementById('wiz-contrato');
    let lista = [];
    try { lista = await API.get(`/api/contratos?propietario_id=${propId}&anio=${wiz.anio}`); } catch (e) { /* vacío */ }
    lista = lista.filter((c) => c.tipo === 'precio_cerrado'); // solo precio cerrado tiene cuotas
    if (!lista.length) {
      sel.innerHTML = '<option value="">— Sin contratos de precio cerrado este año —</option>';
      sel.disabled = true;
    } else {
      sel.innerHTML = '<option value="">— Selecciona contrato —</option>' + lista.map((c) =>
        `<option value="${c.id}">${esc(c.apartamento_nombre)} · ${fechaES(c.temporada_inicio)}–${fechaES(c.temporada_fin)} · ${euro(c.precio_total)}</option>`).join('');
      sel.disabled = false;
    }
    wiz.contratoSel = null; wiz.cuotas = []; wiz.cuotaSel = [];
    document.getElementById('wiz-cuotas').innerHTML = '';
    document.getElementById('wiz-cuotas-resumen').classList.add('oculto');
  }

  async function cargarCuotasWiz(contratoId) {
    wiz.contratoSel = contratoId;
    wiz.cuotas = []; wiz.cuotaSel = [];
    const cont = document.getElementById('wiz-cuotas');
    if (!contratoId) { cont.innerHTML = ''; document.getElementById('wiz-cuotas-resumen').classList.add('oculto'); return; }
    let c;
    try { c = await API.get('/api/contratos/' + contratoId); } catch (e) { return toast(e.message, 'error'); }
    wiz.cuotas = (c.cuotas || []).filter((q) => !q.pagado); // solo pendientes
    if (!wiz.cuotas.length) {
      cont.innerHTML = '<div class="fac-vacio">Este contrato no tiene cuotas pendientes.</div>';
      document.getElementById('wiz-cuotas-resumen').classList.add('oculto');
      return;
    }
    cont.innerHTML = '<div class="ficha-seccion-titulo">Cuotas pendientes</div>' + wiz.cuotas.map((q) => `
      <label class="fac-check"><input type="checkbox" data-cuota="${q.id}"> Cuota ${q.numero_cuota} — ${fechaES(q.fecha_prevista)} — ${euro(q.importe)} <span class="fac-pend">(Pendiente)</span></label>`).join('');
    cont.querySelectorAll('[data-cuota]').forEach((cb) => cb.addEventListener('change', () => {
      const id = Number(cb.dataset.cuota);
      if (cb.checked) { if (!wiz.cuotaSel.includes(id)) wiz.cuotaSel.push(id); }
      else wiz.cuotaSel = wiz.cuotaSel.filter((x) => x !== id);
      resumenCuotas();
    }));
    resumenCuotas();
  }
  function resumenCuotas() {
    const sel = wiz.cuotas.filter((q) => wiz.cuotaSel.includes(q.id));
    const tot = sel.reduce((s, q) => s + (Number(q.importe) || 0), 0);
    const el = document.getElementById('wiz-cuotas-resumen');
    el.textContent = `${sel.length} cuota(s) seleccionada(s) — ${euro(tot)}`;
    el.classList.remove('oculto');
  }

  // ---- Gastos ----
  async function wireGastos() {
    await ensureApartamentos();
    crearTypeahead('wiz-apto-buscar', 'wiz-apto-dd',
      (q) => apartamentosCache.filter((a) => (a.nombre || '').toLowerCase().includes(q.toLowerCase()) || (a.edificio || '').toLowerCase().includes(q.toLowerCase())),
      (a) => `<span class="cnt-ta-nombre">${esc(a.nombre)}${a.edificio ? ` <span class="cnt-ta-edif">${esc(a.edificio)}</span>` : ''}</span>`,
      async (a) => { wiz.aptoSel = a.id; document.getElementById('wiz-apto-buscar').value = a.nombre; await cargarGastosWiz(a.id); },
      () => { wiz.aptoSel = null; });
  }

  async function cargarGastosWiz(aptoId) {
    wiz.gastos = []; wiz.gastoSel = [];
    const cont = document.getElementById('wiz-gastos');
    let data;
    try { data = await API.get(`/api/apartamentos/${aptoId}/gastos?anio=${wiz.anio}`); } catch (e) { return toast(e.message, 'error'); }
    wiz.gastos = (data.gastos || []).filter((g) => !g.cobrado_propietario); // no cobrados
    if (!wiz.gastos.length) {
      cont.innerHTML = '<div class="fac-vacio">No hay gastos sin cobrar este año.</div>';
      document.getElementById('wiz-gastos-resumen').classList.add('oculto');
      return;
    }
    cont.innerHTML = '<div class="ficha-seccion-titulo">Gastos sin cobrar</div>' + wiz.gastos.map((g) => `
      <label class="fac-check"><input type="checkbox" data-gasto="${g.id}"> ${fechaES(g.fecha)} — ${esc(g.nombre)} — ${euro(g.precio)}</label>`).join('');
    cont.querySelectorAll('[data-gasto]').forEach((cb) => cb.addEventListener('change', () => {
      const id = Number(cb.dataset.gasto);
      if (cb.checked) { if (!wiz.gastoSel.includes(id)) wiz.gastoSel.push(id); }
      else wiz.gastoSel = wiz.gastoSel.filter((x) => x !== id);
      resumenGastos();
    }));
    resumenGastos();
  }
  function resumenGastos() {
    const sel = wiz.gastos.filter((g) => wiz.gastoSel.includes(g.id));
    const tot = sel.reduce((s, g) => s + (Number(g.precio) || 0), 0);
    const el = document.getElementById('wiz-gastos-resumen');
    el.textContent = `${sel.length} gasto(s) seleccionado(s) — ${euro(tot)}`;
    el.classList.remove('oculto');
  }

  // ---- Huésped ----
  async function wireHuesped() {
    await ensureReservas();
    crearTypeahead('wiz-res-buscar', 'wiz-res-dd',
      (q) => reservasCache.filter((r) => (r.numero_reserva || '').toLowerCase().includes(q.toLowerCase()) || (r.nombre_cliente || '').toLowerCase().includes(q.toLowerCase())),
      (r) => `<span class="cnt-ta-nombre">${esc(r.numero_reserva)} — ${esc(r.nombre_cliente)}${r.apartamento_nombre ? ` <span class="cnt-ta-edif">${esc(r.apartamento_nombre)}</span>` : ''}</span>`,
      (r) => {
        wiz.reservaSel = r.id;
        document.getElementById('wiz-res-buscar').value = `${r.numero_reserva} — ${r.nombre_cliente}`;
        const info = document.getElementById('wiz-res-info');
        info.textContent = `${r.apartamento_nombre || 'Sin asignar'} · ${fechaES(r.entrada)} – ${fechaES(r.salida)}`;
        info.classList.remove('oculto');
        document.getElementById('wiz-importe').value = (Number(r.precio_total) || 0).toFixed(2);
        if (!document.getElementById('wiz-rec-nombre').value) document.getElementById('wiz-rec-nombre').value = r.nombre_cliente || '';
      },
      () => { wiz.reservaSel = null; });
  }

  // ---- Guardar ----
  async function guardarWizard(estado) {
    const body = { tipo: wiz.tipo, razon_social_id: wiz.razonId, estado };
    body.fecha_emision = document.getElementById('wiz-fecha').value || hoyISO();
    body.anio = parseInt(body.fecha_emision.slice(0, 4), 10);
    body.fecha_vencimiento = document.getElementById('wiz-venc').value || null;
    body.notas = document.getElementById('wiz-notas').value || '';

    if (wiz.tipo === 'propietario' || wiz.tipo === 'autofactura') {
      if (!wiz.contratoSel) return toast('Selecciona un contrato', 'error');
      if (!wiz.cuotaSel.length) return toast('Selecciona al menos una cuota', 'error');
      body.contrato_id = wiz.contratoSel;
      body.cuota_ids = wiz.cuotaSel;
    } else if (wiz.tipo === 'gastos') {
      if (!wiz.aptoSel) return toast('Selecciona un apartamento', 'error');
      if (!wiz.gastoSel.length) return toast('Selecciona al menos un gasto', 'error');
      body.apartamento_id = wiz.aptoSel;
      body.gasto_ids = wiz.gastoSel;
    } else if (wiz.tipo === 'libre') {
      const nombre = document.getElementById('wiz-rec-nombre').value.trim();
      if (!nombre) return toast('El nombre del receptor es obligatorio', 'error');
      const lineas = wiz.libreLineas
        .map((l) => ({ descripcion: (l.descripcion || '').trim(), cantidad: Number(l.cantidad) || 0, precio_unitario: Number(l.precio_unitario) || 0 }))
        .filter((l) => l.descripcion || l.precio_unitario);
      if (!lineas.length) return toast('Añade al menos una línea de factura', 'error');
      body.receptor_nombre = nombre;
      body.receptor_cif = document.getElementById('wiz-rec-cif').value;
      // Dirección + Ciudad + CP -> "Dirección, CP Ciudad".
      const dir = document.getElementById('wiz-rec-dir').value.trim();
      const ciudad = document.getElementById('wiz-rec-ciudad').value.trim();
      const cp = document.getElementById('wiz-rec-cp').value.trim();
      const cpCiudad = [cp, ciudad].filter(Boolean).join(' ');
      body.receptor_direccion = [dir, cpCiudad].filter(Boolean).join(', ');
      body.receptor_email = document.getElementById('wiz-rec-email').value;
      body.porcentaje_iva = wiz.libreIva;
      body.porcentaje_retencion = wiz.libreRet;
      body.lineas = lineas;
    } else {
      if (!wiz.reservaSel) return toast('Selecciona una reserva', 'error');
      const nombre = document.getElementById('wiz-rec-nombre').value.trim();
      if (!nombre) return toast('El nombre del receptor es obligatorio', 'error');
      body.reserva_id = wiz.reservaSel;
      body.receptor = {
        nombre,
        cif: document.getElementById('wiz-rec-cif').value,
        direccion: document.getElementById('wiz-rec-dir').value,
        email: document.getElementById('wiz-rec-email').value,
      };
    }

    try {
      const res = await API.post('/api/facturas', body);
      cerrarModal();
      await cargar();
      toast(`Factura ${res.numero} ${estado === 'borrador' ? 'guardada como borrador' : 'emitida correctamente'}`, 'ok');
      await abrirFicha(res.id);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ==================== Init ====================
  function poblarAnios() {
    const sel = document.getElementById('fac-filtro-anio');
    if (!sel) return;
    if (!ANIOS.includes(filtroAnio)) filtroAnio = ANIOS[ANIOS.length - 1];
    sel.innerHTML = ANIOS.map((a) => `<option value="${a}"${a === filtroAnio ? ' selected' : ''}>${a}</option>`).join('');
  }

  function init() {
    crearPanel();
    poblarAnios();
    document.getElementById('btn-nueva-factura').addEventListener('click', abrirWizard);
    document.getElementById('fac-filtro-anio').addEventListener('change', (e) => { filtroAnio = Number(e.target.value); cargar().catch((err) => toast(err.message, 'error')); });
    document.getElementById('fac-filtro-tipo').addEventListener('change', (e) => { filtroTipo = e.target.value; cargar().catch((err) => toast(err.message, 'error')); });
    document.getElementById('fac-filtro-estado').addEventListener('change', (e) => { filtroEstado = e.target.value; cargar().catch((err) => toast(err.message, 'error')); });
    inyectarFiltroRazon();
  }

  // Inyecta el select "Razón social" junto a los filtros existentes (filtra en cliente).
  async function inyectarFiltroRazon() {
    const estado = document.getElementById('fac-filtro-estado');
    if (!estado || document.getElementById('fac-filtro-razon')) return;
    const sel = document.createElement('select');
    sel.id = 'fac-filtro-razon';
    sel.className = estado.className || 'select-filtro';
    sel.innerHTML = '<option value="">Todas las razones sociales</option>';
    estado.insertAdjacentElement('afterend', sel);
    sel.addEventListener('change', (e) => { filtroRazon = e.target.value; render(); });
    try {
      const razones = await ensureRazones();
      sel.innerHTML = '<option value="">Todas las razones sociales</option>' +
        razones.map((r) => `<option value="${r.id}">${esc(r.razon_social || r.nombre_comercial || ('Razón #' + r.id))}</option>`).join('');
    } catch (e) { /* sin razones: queda solo "Todas" */ }
  }

  return { init, cargar, abrirFicha };
})();
