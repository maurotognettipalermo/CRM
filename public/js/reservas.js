// Módulo Reservas: tabla completa, búsqueda, filtros y alta/edición manual de reservas.

const Reservas = (() => {
  let todasReservas = []; // caché para filtrado en cliente
  let apartamentos = [];  // para el selector del formulario
  let filtroTih = '';
  let filtroMes = '';
  let busqueda = '';
  let fichaActual = null; // reserva abierta en el panel lateral
  let portalesMap = {};   // { nombre: { color, imagen_url } } para la ficha

  // Construye el mapa de portales (API.getPortales está cacheado: solo una llamada real).
  async function cargarPortalesMap() {
    try {
      const portales = await API.getPortales();
      portalesMap = {};
      for (const p of portales) portalesMap[p.nombre] = { color: p.color, imagen_url: p.imagen_url };
    } catch (e) { /* mantenemos el mapa como esté */ }
  }

  // ---- Carga ----
  async function cargar() {
    try {
      [todasReservas, apartamentos] = await Promise.all([
        API.get('/api/reservas/todas'),
        API.get('/api/apartamentos'),
      ]);
      await cargarPortalesMap();
      renderTabla(filtrar());
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ---- Filtrado en cliente ----
  function filtrar() {
    return todasReservas.filter((r) => {
      if (filtroTih && r.tih !== filtroTih) return false;
      if (filtroMes) {
        const [anio, mes] = filtroMes.split('-').map(Number);
        const inicio = `${anio}-${String(mes).padStart(2, '0')}-01`;
        const nextM = mes === 12 ? 1 : mes + 1;
        const nextY = mes === 12 ? anio + 1 : anio;
        const fin = `${nextY}-${String(nextM).padStart(2, '0')}-01`;
        if (!(r.entrada < fin && r.salida > inicio)) return false;
      }
      if (busqueda) {
        const q = busqueda.toLowerCase();
        if (
          !r.nombre_cliente?.toLowerCase().includes(q) &&
          !r.numero_reserva?.toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }

  // Celda "Portal" de la tabla: logo + nombre, o círculo de color + nombre, o guión.
  function portalCelda(r) {
    if (!r.portal) return '—';
    const info = portalesMap[r.portal] || {};
    if (info.imagen_url) {
      return `<span class="portal-val"><img class="portal-cel-logo" src="${esc(info.imagen_url)}" alt="" onerror="this.style.display='none';this.onerror=null"> ${esc(r.portal)}</span>`;
    }
    if (info.color) {
      return `<span class="portal-val"><span class="portal-cel-color" style="background:${esc(info.color)}"></span> ${esc(r.portal)}</span>`;
    }
    return esc(r.portal);
  }

  // Inserta el <th>Portal</th> en la cabecera (la tabla vive en index.html, que no tocamos).
  function asegurarColumnaPortal() {
    const tr = document.querySelector('#tabla-reservas thead tr');
    if (!tr || tr.querySelector('.th-portal')) return;
    const obs = Array.from(tr.querySelectorAll('th'))
      .find((th) => th.textContent.trim().toLowerCase() === 'observaciones');
    const th = document.createElement('th');
    th.className = 'th-portal';
    th.textContent = 'Portal';
    if (obs) tr.insertBefore(th, obs); else tr.appendChild(th);
  }

  // ---- Render tabla ----
  function renderTabla(lista) {
    const tbody = document.querySelector('#tabla-reservas tbody');
    tbody.innerHTML = '';
    if (lista.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="10" style="color:#6b7280;text-align:center;padding:24px">No hay reservas con los filtros actuales.</td></tr>';
      return;
    }
    for (const r of lista) {
      const tr = document.createElement('tr');
      tr.dataset.ficha = r.id;
      const aptoNombre = r.apartamento_nombre
        ? esc(r.apartamento_nombre)
        : '<span style="color:#6b7280">Sin asignar</span>';
      tr.innerHTML = `
        <td><span class="enlace-fila">${esc(r.numero_reserva)}</span></td>
        <td>${esc(r.nombre_cliente)}</td>
        <td>${aptoNombre}</td>
        <td>${fechaES(r.entrada)}</td>
        <td>${fechaES(r.salida)}</td>
        <td>${r.personas ?? '—'}</td>
        <td>${tihTexto(r.tih)}</td>
        <td>${portalCelda(r)}</td>
        <td class="obs-celda">${esc(r.observaciones)}</td>
        <td class="acciones">
          <button class="btn-mini" data-editar="${r.id}">Editar</button>
          <button class="btn-mini" data-borrar="${r.id}">Eliminar</button>
        </td>`;
      tbody.appendChild(tr);
    }
    // Clic en la fila -> ficha en panel lateral (salvo en los botones de acción).
    tbody.querySelectorAll('tr[data-ficha]').forEach((tr) =>
      tr.addEventListener('click', (e) => {
        if (e.target.closest('[data-editar]') || e.target.closest('[data-borrar]')) return;
        abrirFicha(tr.dataset.ficha);
      })
    );
    tbody.querySelectorAll('[data-editar]').forEach((el) =>
      el.addEventListener('click', (e) => { e.stopPropagation(); formulario(el.dataset.editar); })
    );
    tbody.querySelectorAll('[data-borrar]').forEach((el) =>
      el.addEventListener('click', (e) => { e.stopPropagation(); borrar(el.dataset.borrar); })
    );
  }

  // ---- Formulario alta/edición ----
  async function formulario(id) {
    let r = {
      numero_reserva: '', nombre_cliente: '', contrato: '', edificio: '',
      tih: '1', apartamento_id: null, entrada: '', salida: '', personas: '', observaciones: '',
    };
    if (id) {
      try {
        r = await API.get('/api/reservas/' + id);
      } catch (e) {
        return toast(e.message, 'error');
      }
    }

    const tihOpts = ['1', '2']
      .map((v) => `<option value="${v}"${r.tih == v ? ' selected' : ''}>${tihTexto(v)}</option>`)
      .join('');

    abrirModal(`
      <h3>${id ? 'Editar' : 'Nueva'} reserva</h3>
      <div class="fila-campos">
        <div class="campo">
          <label>Nº Reserva *</label>
          <input id="f-num-reserva" value="${esc(r.numero_reserva)}"${id ? ' readonly class="campo-readonly"' : ''}>
        </div>
        <div class="campo">
          <label>Nombre Cliente *</label>
          <input id="f-nombre-cliente" value="${esc(r.nombre_cliente)}">
        </div>
      </div>
      <div class="fila-campos">
        <div class="campo">
          <label>Contrato</label>
          <input id="f-contrato" value="${esc(r.contrato)}">
        </div>
        <div class="campo">
          <label>Edificio</label>
          <input id="f-edificio" value="${esc(r.edificio)}">
        </div>
      </div>
      <div class="fila-campos">
        <div class="campo">
          <label>TIH *</label>
          <select id="f-tih">${tihOpts}</select>
        </div>
        <div class="campo">
          <label>Apartamento</label>
          <select id="f-apartamento-id"></select>
        </div>
      </div>
      <div class="fila-campos">
        <div class="campo">
          <label>Entrada *</label>
          <input type="date" id="f-entrada" value="${r.entrada || ''}">
        </div>
        <div class="campo">
          <label>Salida *</label>
          <input type="date" id="f-salida" value="${r.salida || ''}">
        </div>
      </div>
      <div class="campo">
        <label>Personas</label>
        <input type="number" id="f-personas" min="1" value="${r.personas ?? ''}">
      </div>
      <div class="campo">
        <label>Observaciones</label>
        <textarea id="f-observaciones">${esc(r.observaciones)}</textarea>
      </div>
      <div id="f-disponibilidad" class="disponibilidad-indicator oculto"></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="f-cancelar">Cancelar</button>
        <button class="btn-pri" id="f-guardar">Guardar</button>
      </div>`);

    actualizarSelectorApto(r.tih, r.apartamento_id);

    document.getElementById('f-cancelar').addEventListener('click', cerrarModal);

    document.getElementById('f-tih').addEventListener('change', () => {
      actualizarSelectorApto(document.getElementById('f-tih').value, null);
      verificarDisponibilidad(id);
    });

    ['f-apartamento-id', 'f-entrada', 'f-salida'].forEach((fid) => {
      document.getElementById(fid).addEventListener('change', () => verificarDisponibilidad(id));
    });

    // Al editar con apartamento y fechas ya asignados, mostrar disponibilidad inmediatamente.
    if (id && r.apartamento_id && r.entrada && r.salida) {
      verificarDisponibilidad(id);
    }

    document.getElementById('f-guardar').addEventListener('click', () => guardar(id));
  }

  // Rellena el select de apartamentos filtrado por TIH; pre-selecciona selectedId si se proporciona.
  function actualizarSelectorApto(tih, selectedId) {
    const sel = document.getElementById('f-apartamento-id');
    if (!sel) return;
    const filtrados = apartamentos.filter((a) => a.tipo === String(tih));
    sel.innerHTML =
      '<option value="">— Sin asignar —</option>' +
      filtrados
        .map((a) => `<option value="${a.id}"${a.id == selectedId ? ' selected' : ''}>${esc(a.nombre)}</option>`)
        .join('');
  }

  // Consulta el endpoint y actualiza el indicador visual de disponibilidad.
  async function verificarDisponibilidad(editId) {
    const aptId  = document.getElementById('f-apartamento-id')?.value;
    const entrada = document.getElementById('f-entrada')?.value;
    const salida  = document.getElementById('f-salida')?.value;
    const ind = document.getElementById('f-disponibilidad');
    const btn = document.getElementById('f-guardar');
    if (!ind) return;

    // Sin apartamento o sin fechas no hay nada que comprobar.
    if (!aptId || !entrada || !salida) {
      ind.className = 'disponibilidad-indicator oculto';
      if (btn) btn.disabled = false;
      return;
    }

    if (entrada >= salida) {
      ind.className = 'disponibilidad-indicator disponibilidad-aviso';
      ind.textContent = 'La fecha de salida debe ser posterior a la de entrada.';
      if (btn) btn.disabled = true;
      return;
    }

    try {
      let url = `/api/reservas/verificar-disponibilidad?apartamento_id=${encodeURIComponent(aptId)}&entrada=${encodeURIComponent(entrada)}&salida=${encodeURIComponent(salida)}`;
      if (editId) url += `&excluir_reserva_id=${encodeURIComponent(editId)}`;
      const result = await API.get(url);

      if (result.disponible) {
        ind.className = 'disponibilidad-indicator disponibilidad-ok';
        ind.innerHTML = '&#10003;&nbsp;Disponible para esas fechas';
        if (btn) btn.disabled = false;
      } else {
        const c = result.conflicto;
        ind.className = 'disponibilidad-indicator disponibilidad-error';
        ind.innerHTML = `&#10007;&nbsp;Fechas ocupadas por: <strong>${esc(c.nombre_cliente)}</strong> (${fechaES(c.entrada)} – ${fechaES(c.salida)})`;
        if (btn) btn.disabled = true;
      }
    } catch (e) {
      ind.className = 'disponibilidad-indicator oculto';
      if (btn) btn.disabled = false;
    }
  }

  // ---- Guardar (crear o editar) ----
  async function guardar(id) {
    const numReserva   = (document.getElementById('f-num-reserva')?.value || '').trim();
    const nombreCliente = (document.getElementById('f-nombre-cliente')?.value || '').trim();
    const entrada      = document.getElementById('f-entrada')?.value || '';
    const salida       = document.getElementById('f-salida')?.value || '';
    const personasRaw  = parseInt(document.getElementById('f-personas')?.value, 10);

    if (!numReserva)    return toast('El número de reserva es obligatorio', 'error');
    if (!nombreCliente) return toast('El nombre del cliente es obligatorio', 'error');
    if (!entrada)       return toast('La fecha de entrada es obligatoria', 'error');
    if (!salida)        return toast('La fecha de salida es obligatoria', 'error');
    if (entrada >= salida) return toast('La salida debe ser posterior a la entrada', 'error');

    const body = {
      numero_reserva: numReserva,
      nombre_cliente: nombreCliente,
      contrato:       document.getElementById('f-contrato')?.value || '',
      edificio:       document.getElementById('f-edificio')?.value || '',
      tih:            document.getElementById('f-tih')?.value || '',
      apartamento_id: document.getElementById('f-apartamento-id')?.value || null,
      entrada,
      salida,
      personas:       isNaN(personasRaw) ? null : personasRaw,
      observaciones:  document.getElementById('f-observaciones')?.value || '',
    };

    try {
      if (id) await API.put('/api/reservas/' + id, body);
      else    await API.post('/api/reservas', body);
      cerrarModal();
      await cargar();
      toast(id ? 'Reserva actualizada' : 'Reserva creada', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ---- Borrar ----
  async function borrar(id) {
    const res = todasReservas.find((r) => r.id == id);
    if (!confirm(`¿Eliminar la reserva "${res?.numero_reserva || id}"? Esta acción no se puede deshacer.`))
      return;
    try {
      await API.del('/api/reservas/' + id);
      await cargar();
      toast('Reserva eliminada', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ---- Selector de meses: últimos 24 meses + próximos 12 ----
  function generarOpcionesMeses() {
    const ahora = new Date();
    const opts = ['<option value="">Todos los meses</option>'];
    for (let i = -24; i <= 12; i++) {
      const d = new Date(ahora.getFullYear(), ahora.getMonth() + i, 1);
      const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
      opts.push(`<option value="${v}">${label.charAt(0).toUpperCase() + label.slice(1)}</option>`);
    }
    return opts.join('');
  }

  // ==================== Panel lateral (ficha de reserva) ====================
  const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

  function diaSemana(iso) {
    if (!iso) return '';
    return DIAS_SEMANA[new Date(iso + 'T00:00:00').getDay()];
  }
  function addDiasISO(iso, n) {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + n);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }
  function noches(entrada, salida) {
    if (!entrada || !salida) return 0;
    return Math.round((new Date(salida + 'T00:00:00') - new Date(entrada + 'T00:00:00')) / 86400000);
  }
  function fechaHoraDia(iso, hora) {
    if (!iso) return '—';
    return `${fechaES(iso)}${hora ? ' ' + hora : ''} (${diaSemana(iso)})`;
  }
  function fechaCreacionFmt(s) {
    if (!s) return '—';
    return fechaES(String(s).split(' ')[0]);
  }
  function euro(v) {
    return (Number(v) || 0).toFixed(2).replace('.', ',') + ' €';
  }
  function estadoClase(tipo) {
    const t = (tipo || '').toLowerCase();
    return t === 'pendiente' ? 'pendiente' : t === 'cancelada' ? 'cancelada' : 'confirmada';
  }

  // Crea (una sola vez) el DOM del panel lateral y conecta sus eventos.
  function crearPanel() {
    if (document.getElementById('rsv-panel')) return;
    const fondo = document.createElement('div');
    fondo.id = 'rsv-panel-fondo';
    fondo.className = 'panel-fondo';
    const panel = document.createElement('aside');
    panel.id = 'rsv-panel';
    panel.className = 'panel-lateral';
    panel.innerHTML = `
      <header class="panel-cabecera">
        <div class="rsv-titulo-grupo">
          <h3 id="rsv-titulo">Reserva</h3>
          <span id="rsv-estado" class="badge-rsv"></span>
        </div>
        <div class="panel-cabecera-acciones">
          <button id="rsv-editar" class="btn-sec">Editar</button>
          <button id="rsv-cerrar" class="panel-cerrar" title="Cerrar">&times;</button>
        </div>
      </header>
      <div class="rsv-subtabs" id="rsv-subtabs">
        <button class="rsv-subtab activo" data-rsub="datos">Datos</button>
        <button class="rsv-subtab" data-rsub="mensajes">Mensajes</button>
        <button class="rsv-subtab" data-rsub="margen">Margen comercial</button>
        <button class="rsv-subtab" data-rsub="liquidacion">Liquidación propietario</button>
      </div>
      <div id="rsv-cuerpo" class="panel-cuerpo"></div>`;
    document.body.appendChild(fondo);
    document.body.appendChild(panel);

    fondo.addEventListener('click', cerrarPanel);
    panel.querySelector('#rsv-cerrar').addEventListener('click', cerrarPanel);
    panel.querySelector('#rsv-editar').addEventListener('click', () => { if (fichaActual) formularioFicha(); });
    panel.querySelectorAll('.rsv-subtab').forEach((b) =>
      b.addEventListener('click', () => activarSubtab(b.dataset.rsub))
    );
    // Fase de captura: evaluamos el estado ANTES de que el handler de Escape de app.js
    // (fase de burbuja) cierre el modal. Así, con el modal de edición abierto, Escape solo
    // cierra el modal; si no hay modal, cierra el panel.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const modalAbierto = !document.getElementById('modal-fondo').classList.contains('oculto');
      if (!modalAbierto && panel.classList.contains('abierto')) cerrarPanel();
    }, true);
  }

  function activarSubtab(sub) {
    document.querySelectorAll('#rsv-subtabs .rsv-subtab').forEach((b) =>
      b.classList.toggle('activo', b.dataset.rsub === sub));
    document.querySelectorAll('#rsv-cuerpo .rsv-subpanel').forEach((p) =>
      p.classList.toggle('activo', p.dataset.rsubpanel === sub));
  }

  function abrirPanel() {
    document.getElementById('rsv-panel-fondo').classList.add('abierto');
    document.getElementById('rsv-panel').classList.add('abierto');
  }
  function cerrarPanel() {
    document.getElementById('rsv-panel-fondo').classList.remove('abierto');
    document.getElementById('rsv-panel').classList.remove('abierto');
    fichaActual = null;
  }

  async function abrirFicha(id) {
    crearPanel();
    try {
      fichaActual = await API.get('/api/reservas/' + id);
      await cargarPortalesMap();
    } catch (e) {
      return toast(e.message, 'error');
    }
    renderFicha();
    abrirPanel();
  }

  function dato(etq, val, clase) {
    return `<div class="rsv-dato"><div class="etq">${etq}</div><div class="val${clase ? ' ' + clase : ''}">${val}</div></div>`;
  }

  // Valor del campo Portal: logo + nombre, o círculo de color + nombre, o solo texto.
  function portalDato(r) {
    if (!r.portal) return '—';
    const info = portalesMap[r.portal] || {};
    if (info.imagen_url) {
      return `<span class="portal-val"><img class="portal-val-logo" src="${esc(info.imagen_url)}" alt="" onerror="this.style.display='none';this.onerror=null"> ${esc(r.portal)}</span>`;
    }
    if (info.color) {
      return `<span class="portal-val"><span class="portal-val-color" style="background:${esc(info.color)}"></span> ${esc(r.portal)}</span>`;
    }
    return esc(r.portal);
  }

  function renderFicha() {
    const r = fichaActual;
    document.getElementById('rsv-titulo').textContent = 'Reserva #' + (r.numero_reserva || r.id);
    const est = document.getElementById('rsv-estado');
    est.textContent = r.tipo_reserva || 'Confirmada';
    est.className = 'badge-rsv ' + estadoClase(r.tipo_reserva);

    const n = noches(r.entrada, r.salida);
    const ultimaNoche = r.salida ? addDiasISO(r.salida, -1) : null;
    const apto = r.apartamento_nombre
      ? esc(r.apartamento_nombre)
      : '<span class="rsv-vacio">Sin asignar</span>';

    const izquierda =
      dato('Alojamiento', apto) +
      dato('Fecha entrada', fechaHoraDia(r.entrada, r.hora_entrada)) +
      dato('Fecha salida', fechaHoraDia(r.salida, r.hora_salida)) +
      dato('Cliente', esc(r.nombre_cliente) || '—') +
      dato('Ocupante', esc(r.ocupante || r.nombre_cliente) || '—') +
      dato('Número ocupantes', (r.personas != null ? r.personas : '—') + ' Adultos');

    const derecha =
      dato('Tipo de reserva', `<span class="badge-rsv ${estadoClase(r.tipo_reserva)}">${esc(r.tipo_reserva) || 'Confirmada'}</span>`) +
      dato('Fecha de creación', fechaCreacionFmt(r.fecha_creacion)) +
      dato('Número de noches', `${n} noche${n === 1 ? '' : 's'}${ultimaNoche ? ` (Última noche: ${fechaES(ultimaNoche)})` : ''}`) +
      dato('Portal', portalDato(r)) +
      dato('Condición de cancelación', esc(r.condicion_cancelacion) || '—') +
      dato('Atendido por', esc(r.atendido_por) || '—');

    const importes = `
      <table class="rsv-importes">
        <thead><tr><th>Item</th><th>Precio base (IVA incl.)</th><th>Cantidad</th><th>Precio IVA incl.</th></tr></thead>
        <tbody>
          <tr><td>Alojamiento</td><td>${euro(r.precio_base)}</td><td>${n} noche${n === 1 ? '' : 's'}</td><td>${euro(r.precio_total)}</td></tr>
          <tr class="rsv-bold"><td>Subtotal de alojamiento</td><td></td><td></td><td>${euro(r.precio_total)}</td></tr>
          <tr class="rsv-bold rsv-total"><td>TOTAL</td><td></td><td></td><td>${euro(r.precio_total)}</td></tr>
          <tr><td>Pagado</td><td></td><td></td><td>${euro(r.pagado)}</td></tr>
          <tr class="rsv-pendiente"><td>Pendiente</td><td></td><td></td><td>${euro(r.pendiente)}</td></tr>
        </tbody>
      </table>`;

    const proximamente = '<div class="rsv-proximamente">Próximamente</div>';

    document.getElementById('rsv-cuerpo').innerHTML = `
      <div class="rsv-subpanel activo" data-rsubpanel="datos">
        <div class="rsv-seccion-titulo">Datos</div>
        <div class="rsv-grid"><div>${izquierda}</div><div>${derecha}</div></div>

        <div class="rsv-seccion-titulo">Check-in / Check-out</div>
        <div class="rsv-grid">
          <div>${dato('Check-in', esc(r.checkin_estado) || 'Pendiente')}</div>
          <div>${dato('Check-out', esc(r.checkout_estado) || 'Pendiente')}</div>
        </div>

        <div class="rsv-seccion-titulo">Importes</div>
        ${importes}
      </div>
      <div class="rsv-subpanel" data-rsubpanel="mensajes">${proximamente}</div>
      <div class="rsv-subpanel" data-rsubpanel="margen">${proximamente}</div>
      <div class="rsv-subpanel" data-rsubpanel="liquidacion">${proximamente}</div>`;

    activarSubtab('datos');
  }

  // ---- Modal de edición de la ficha (campos de gestión) ----
  async function formularioFicha() {
    const r = fichaActual;
    let portales = [];
    try { portales = await API.get('/api/portales'); } catch (e) { /* seguimos con lista vacía */ }

    const nombres = portales.map((p) => p.nombre);
    if (r.portal && !nombres.includes(r.portal)) nombres.unshift(r.portal);
    const optPortal = '<option value="">— Sin portal —</option>' +
      nombres.map((nm) => `<option${r.portal === nm ? ' selected' : ''}>${esc(nm)}</option>`).join('');

    const selOpts = (valores, actual) =>
      valores.map((v) => `<option${actual === v ? ' selected' : ''}>${v}</option>`).join('');

    abrirModal(`
      <h3>Editar reserva #${esc(r.numero_reserva || r.id)}</h3>
      <div class="fila-campos">
        <div class="campo"><label>Tipo de reserva</label>
          <select id="fr-tipo">${selOpts(['Confirmada', 'Pendiente', 'Cancelada'], r.tipo_reserva || 'Confirmada')}</select></div>
        <div class="campo"><label>Portal</label><select id="fr-portal">${optPortal}</select></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Condición de cancelación</label>
          <select id="fr-condicion">
            <option value=""${!r.condicion_cancelacion ? ' selected' : ''}>—</option>
            <option${r.condicion_cancelacion === 'Reembolsable' ? ' selected' : ''}>Reembolsable</option>
            <option${r.condicion_cancelacion === 'No reembolsable' ? ' selected' : ''}>No reembolsable</option>
          </select></div>
        <div class="campo"><label>Ocupante</label><input id="fr-ocupante" value="${esc(r.ocupante)}"></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Hora entrada</label><input type="time" id="fr-hora-entrada" value="${esc(r.hora_entrada) || '17:00'}"></div>
        <div class="campo"><label>Hora salida</label><input type="time" id="fr-hora-salida" value="${esc(r.hora_salida) || '10:00'}"></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Check-in</label><select id="fr-checkin">${selOpts(['Pendiente', 'Asignado', 'Completado'], r.checkin_estado || 'Pendiente')}</select></div>
        <div class="campo"><label>Check-out</label><select id="fr-checkout">${selOpts(['Pendiente', 'Asignado', 'Completado'], r.checkout_estado || 'Pendiente')}</select></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Precio base (€)</label><input type="number" step="0.01" id="fr-precio-base" value="${r.precio_base ?? 0}"></div>
        <div class="campo"><label>Precio total (€)</label><input type="number" step="0.01" id="fr-precio-total" value="${r.precio_total ?? 0}"></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Pagado (€)</label><input type="number" step="0.01" id="fr-pagado" value="${r.pagado ?? 0}"></div>
        <div class="campo"><label>Pendiente (€)</label><input id="fr-pendiente" class="campo-readonly" readonly></div>
      </div>
      <div class="campo"><label>Notas internas</label><textarea id="fr-notas">${esc(r.notas_internas)}</textarea></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="fr-cancelar">Cancelar</button>
        <button class="btn-pri" id="fr-guardar">Guardar</button>
      </div>`);
    document.querySelector('.modal').classList.add('modal-ancho');

    const recalcular = () => {
      const tot = parseFloat(document.getElementById('fr-precio-total').value) || 0;
      const pag = parseFloat(document.getElementById('fr-pagado').value) || 0;
      document.getElementById('fr-pendiente').value = (tot - pag).toFixed(2);
    };
    recalcular();
    document.getElementById('fr-precio-total').addEventListener('input', recalcular);
    document.getElementById('fr-pagado').addEventListener('input', recalcular);

    document.getElementById('fr-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('fr-guardar').addEventListener('click', async () => {
      const body = {
        tipo_reserva: document.getElementById('fr-tipo').value,
        portal: document.getElementById('fr-portal').value,
        condicion_cancelacion: document.getElementById('fr-condicion').value,
        ocupante: document.getElementById('fr-ocupante').value,
        hora_entrada: document.getElementById('fr-hora-entrada').value,
        hora_salida: document.getElementById('fr-hora-salida').value,
        checkin_estado: document.getElementById('fr-checkin').value,
        checkout_estado: document.getElementById('fr-checkout').value,
        precio_base: document.getElementById('fr-precio-base').value,
        precio_total: document.getElementById('fr-precio-total').value,
        pagado: document.getElementById('fr-pagado').value,
        notas_internas: document.getElementById('fr-notas').value,
      };
      try {
        await API.put('/api/reservas/' + r.id, body);
        cerrarModal();
        await abrirFicha(r.id); // recarga datos del panel
        await cargar();         // refresca la tabla
        toast('Reserva actualizada', 'ok');
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  // ---- Init ----
  function init() {
    crearPanel();
    asegurarColumnaPortal();
    document.getElementById('btn-nueva-reserva').addEventListener('click', () => formulario(null));

    document.getElementById('reservas-filtro-mes').innerHTML = generarOpcionesMeses();

    document.getElementById('reservas-buscar').addEventListener('input', (e) => {
      busqueda = e.target.value;
      renderTabla(filtrar());
    });

    document.querySelectorAll('.btn-filtro-tih-res').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.btn-filtro-tih-res').forEach((b) => b.classList.remove('activo'));
        btn.classList.add('activo');
        filtroTih = btn.dataset.val;
        renderTabla(filtrar());
      });
    });

    document.getElementById('reservas-filtro-mes').addEventListener('change', (e) => {
      filtroMes = e.target.value;
      renderTabla(filtrar());
    });
  }

  return { init, cargar };
})();
