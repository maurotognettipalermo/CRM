// Módulo Reservas: tabla completa, búsqueda, filtros y alta/edición manual de reservas.

const Reservas = (() => {
  let todasReservas = []; // caché para filtrado en cliente
  let apartamentos = [];  // para el selector del formulario
  let busqueda = '';
  let fichaActual = null; // reserva abierta en el panel lateral
  let portalesMap = {};   // { nombre: { color, imagen_url } } para la ficha

  // ---- Estado del wizard de Nueva reserva ----
  let wzClienteModo = 'buscar';  // 'buscar' | 'nuevo'
  let wzCliente = null;          // cliente seleccionado en modo buscar {id, nombre, ...}
  let wzApto = null;             // apartamento seleccionado {id, nombre, tipo}
  let wzPortales = [];           // portales activos (con prefijo)

  // ---- Estado de filtros avanzados (módulo: se mantiene al cambiar de pestaña) ----
  const CLASIFICACIONES = [
    { key: 'A++', clase: 'c-app' }, { key: 'A+', clase: 'c-ap' }, { key: 'A', clase: 'c-a' },
    { key: 'B+', clase: 'c-bp' }, { key: 'B', clase: 'c-b' }, { key: 'C', clase: 'c-c' },
    { key: '__sin__', clase: null }, // Sin clasificar
  ];
  const ESTADOS = ['Confirmada', 'Pendiente', 'Cancelada'];
  const CONDICIONES = [
    { key: 'Reembolsable', label: 'Reembolsable' },
    { key: 'No reembolsable', label: 'No reembolsable' },
    { key: '__sin__', label: 'Sin especificar' },
  ];
  let fClas = new Set(CLASIFICACIONES.map((c) => c.key));   // todas marcadas
  let fEstado = new Set(ESTADOS);                            // todos marcados
  let fCond = new Set(CONDICIONES.map((c) => c.key));        // todas marcadas
  let fPortal = null;                                        // se inicializa al cargar portales
  let fPortalConocido = new Set();                          // claves de portal ya vistas (para añadir nuevos)
  let portalesNombres = [];                                 // nombres de portales para los checkboxes
  let fDesde = '';
  let fHasta = '';
  let pagosData = { pagos: [], total_pagado: 0, total_pendiente: 0, precio_total_reserva: 0 }; // pagos de la ficha
  let extrasData = { extras: [], total_extras: 0 }; // extras de la ficha
  let catalogoExtras = [];  // catálogo de extras activos (para el modal añadir)

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
        API.get('/api/apartamentos?todos=1'),
      ]);
      await cargarPortalesMap();
      sincronizarPortalesFiltro();
      aplicarFiltros();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // Actualiza la lista de portales del filtro y, la primera vez, marca todos por defecto.
  function sincronizarPortalesFiltro() {
    portalesNombres = Object.keys(portalesMap);
    const claves = [...portalesNombres, '__sin__'];
    if (fPortal === null) {
      fPortal = new Set(claves); // por defecto, todos marcados
    } else {
      // Mantén selección previa; añade portales nuevos como marcados.
      for (const k of claves) if (!fPortalConocido.has(k)) fPortal.add(k);
    }
    fPortalConocido = new Set(claves);
    poblarPortalesFiltro();
  }

  // ---- Helpers de clasificación de una reserva ----
  // Clasificación del apartamento de la reserva ('__sin__' si no asignado o sin clasificar).
  function clasDeReserva(r) {
    if (!r.apartamento_id) return '__sin__';
    const apto = apartamentos.find((a) => a.id == r.apartamento_id);
    return (apto && apto.tipo_clasificacion) || '__sin__';
  }

  // ---- ¿Cada grupo de filtros está en su valor por defecto (todo marcado / sin fecha)? ----
  function clasDefault() { return fClas.size === CLASIFICACIONES.length; }
  function estadoDefault() { return fEstado.size === ESTADOS.length; }
  function condDefault() { return fCond.size === CONDICIONES.length; }
  function portalDefault() {
    if (!fPortal) return true;
    const claves = [...portalesNombres, '__sin__'];
    return claves.every((k) => fPortal.has(k));
  }
  function fechaDefault() { return !fDesde && !fHasta; }

  // Número de grupos de filtros activos (distintos al default) — para el badge.
  function filtrosActivos() {
    return [!clasDefault(), !portalDefault(), !estadoDefault(), !condDefault(), !fechaDefault()]
      .filter(Boolean).length;
  }

  // ---- Filtrado en cliente ----
  function filtrar() {
    const aplicaClas = !clasDefault();
    const aplicaPortal = !portalDefault();
    const aplicaEstado = !estadoDefault();
    const aplicaCond = !condDefault();
    return todasReservas.filter((r) => {
      if (busqueda) {
        const q = busqueda.toLowerCase();
        if (
          !r.nombre_cliente?.toLowerCase().includes(q) &&
          !r.numero_reserva?.toLowerCase().includes(q)
        )
          return false;
      }
      if (aplicaClas && !fClas.has(clasDeReserva(r))) return false;
      if (aplicaPortal && !fPortal.has(r.portal || '__sin__')) return false;
      if (aplicaEstado && !fEstado.has(r.tipo_reserva || 'Confirmada')) return false;
      if (aplicaCond && !fCond.has(r.condicion_cancelacion || '__sin__')) return false;
      if (fDesde && (!r.entrada || r.entrada < fDesde)) return false;
      if (fHasta && (!r.entrada || r.entrada > fHasta)) return false;
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
  // Nueva reserva → wizard rediseñado; editar → formulario clásico.
  async function formulario(id) {
    if (id) return formularioEditar(id);
    return formularioNuevo();
  }

  async function formularioEditar(id) {
    let r = {
      numero_reserva: '', nombre_cliente: '', contrato: '', edificio: '',
      tih: '1', apartamento_id: null, entrada: '', salida: '', personas: '', observaciones: '',
      portal: '', precio_total: 0,
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

    // Portales para el select (el cálculo de tarifa puede depender del portal).
    let portales = [];
    try { portales = (await API.getPortales()).filter((p) => p.activo); } catch (e) { portales = []; }
    const nombresPortal = portales.map((p) => p.nombre);
    if (r.portal && !nombresPortal.includes(r.portal)) nombresPortal.unshift(r.portal);
    const portalOpts = '<option value="">— Sin portal —</option>' +
      nombresPortal.map((nm) => `<option${r.portal === nm ? ' selected' : ''}>${esc(nm)}</option>`).join('');

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
      <div id="f-tarifa" class="rsv-trf oculto"></div>
      <div class="fila-campos">
        <div class="campo">
          <label>Portal</label>
          <select id="f-portal">${portalOpts}</select>
        </div>
        <div class="campo">
          <label>Precio (€)</label>
          <input type="number" step="0.01" min="0" id="f-precio" value="${r.precio_total != null && r.precio_total !== 0 ? r.precio_total : ''}">
          <span id="f-precio-badge" class="badge-precio-manual oculto"></span>
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
      programarCalculoTarifa();
    });

    ['f-apartamento-id', 'f-entrada', 'f-salida'].forEach((fid) => {
      document.getElementById(fid).addEventListener('change', () => {
        verificarDisponibilidad(id);
        programarCalculoTarifa();
      });
    });
    document.getElementById('f-portal').addEventListener('change', programarCalculoTarifa);

    // Precio editable siempre: si el usuario lo toca, pasa a "manual" y deja de autorrellenarse.
    tarifaPrecioManual = id ? (Number(r.precio_total) || 0) > 0 : false;
    tarifaCalc = null;
    document.getElementById('f-precio').addEventListener('input', () => {
      tarifaPrecioManual = document.getElementById('f-precio').value !== '';
      if (!tarifaPrecioManual && tarifaCalc) {
        document.getElementById('f-precio').value = tarifaCalc.precio_total;
        tarifaPrecioManual = false;
      }
      actualizarBadgePrecio();
    });

    // Al editar con apartamento y fechas ya asignados, mostrar disponibilidad y tarifa.
    if (id && r.apartamento_id && r.entrada && r.salida) {
      verificarDisponibilidad(id);
      programarCalculoTarifa();
    }

    document.getElementById('f-guardar').addEventListener('click', () => guardar(id));
  }

  // ==================== Wizard de Nueva reserva ====================
  async function formularioNuevo() {
    // Reset de estado del wizard.
    wzClienteModo = 'buscar';
    wzCliente = null;
    wzApto = null;
    tarifaCalc = null;
    tarifaPrecioManual = false;

    try { wzPortales = (await API.getPortales()).filter((p) => p.activo); } catch (e) { wzPortales = []; }
    const portalOpts = '<option value="">— Elegir portal —</option>' +
      wzPortales.map((p) => `<option value="${esc(p.nombre)}">${esc(p.nombre)}</option>`).join('');

    abrirModal(`
      <div class="rsv-wz">
        <h3>Nueva reserva</h3>

        <!-- Portal y apartamento -->
        <div class="rsv-sec">
          <div class="rsv-sec-tit">Portal y apartamento</div>
          <div class="fila-campos">
            <div class="campo">
              <label>Portal *</label>
              <select id="f-portal">${portalOpts}</select>
              <span id="rsv-wz-numhint" class="rsv-wz-hint oculto"></span>
            </div>
            <div class="campo rsv-ta">
              <label>Apartamento</label>
              <input id="rsv-apto-input" class="input-buscar" autocomplete="off" placeholder="Buscar apartamento...">
              <input type="hidden" id="f-apartamento-id">
              <div id="rsv-apto-res" class="rsv-ta-res oculto"></div>
            </div>
          </div>
        </div>

        <!-- Cliente -->
        <div class="rsv-sec">
          <div class="rsv-sec-tit">Cliente</div>
          <div class="rsv-cli-pills">
            <button type="button" class="rsv-pill activo" id="rsv-cli-tab-buscar">🔍 Buscar cliente</button>
            <button type="button" class="rsv-pill" id="rsv-cli-tab-nuevo">＋ Nuevo cliente</button>
          </div>
          <div id="rsv-cli-buscar">
            <div class="rsv-ta">
              <input id="rsv-cli-input" class="input-buscar" autocomplete="off" placeholder="Buscar por nombre, email, teléfono...">
              <div id="rsv-cli-res" class="rsv-ta-res oculto"></div>
            </div>
            <div id="rsv-cli-card" class="rsv-cli-card oculto"></div>
          </div>
          <div id="rsv-cli-nuevo" class="oculto">
            <div class="fila-campos">
              <div class="campo"><label>Nombre *</label><input id="rsv-cli-nombre"></div>
              <div class="campo"><label>Apellido</label><input id="rsv-cli-ape"></div>
            </div>
            <div class="fila-campos">
              <div class="campo"><label>Teléfono</label><input id="rsv-cli-tel"></div>
              <div class="campo"><label>Email</label><input id="rsv-cli-email" type="email"></div>
            </div>
          </div>
        </div>

        <!-- Fechas -->
        <div class="rsv-sec">
          <div class="rsv-sec-tit">Fechas</div>
          <div class="fila-campos">
            <div class="campo"><label>Entrada *</label><input type="date" id="f-entrada"></div>
            <div class="campo"><label>Salida *</label><input type="date" id="f-salida"></div>
          </div>
          <span id="rsv-wz-noches" class="rsv-wz-noches oculto"></span>
          <div id="f-disponibilidad" class="disponibilidad-indicator oculto"></div>
        </div>

        <!-- Precio -->
        <div class="rsv-sec">
          <div class="rsv-sec-tit">Precio</div>
          <div class="campo">
            <label>Precio (€)</label>
            <input type="number" step="0.01" min="0" id="f-precio">
            <span id="f-precio-badge" class="badge-precio-manual oculto"></span>
          </div>
          <div class="campo"><label>Observaciones</label><textarea id="f-observaciones"></textarea></div>
        </div>

        <!-- Desglose de tarifa oculto: alimenta el autorrelleno de precio sin mostrarse. -->
        <div id="f-tarifa" class="rsv-trf rsv-trf-oculta"></div>

        <div class="modal-acciones">
          <button class="btn-sec" id="rsv-wz-cancelar">Cancelar</button>
          <button class="btn-pri" id="rsv-wz-crear">Crear reserva</button>
        </div>
      </div>`);

    // Portal: pista de nº de reserva automático según prefijo.
    const selPortal = document.getElementById('f-portal');
    const numHint = document.getElementById('rsv-wz-numhint');
    function refrescarNumHint() {
      const p = wzPortales.find((x) => x.nombre === selPortal.value);
      if (p && p.prefijo) {
        numHint.textContent = `Nº reserva: ${String(p.prefijo).toUpperCase()}-XXXX (automático)`;
        numHint.classList.remove('oculto');
      } else if (selPortal.value) {
        numHint.textContent = 'Nº reserva: automático';
        numHint.classList.remove('oculto');
      } else {
        numHint.classList.add('oculto');
      }
    }
    selPortal.addEventListener('change', () => { refrescarNumHint(); programarCalculoTarifa(); });

    // Typeahead de apartamento (todos; al elegir guardamos tipo para derivar la TIH).
    const aptoInput = document.getElementById('rsv-apto-input');
    const aptoHidden = document.getElementById('f-apartamento-id');
    const aptoRes = document.getElementById('rsv-apto-res');
    aptoInput.addEventListener('input', () => {
      wzApto = null; aptoHidden.value = '';
      const q = aptoInput.value.trim().toLowerCase();
      renderTAReserva(aptoRes, apartamentos.filter((a) => (a.nombre || '').toLowerCase().includes(q)),
        (a) => `${esc(a.nombre)} <span class="rsv-ta-tih">${tihTexto(a.tipo)}</span>`,
        (a) => {
          wzApto = a; aptoHidden.value = a.id; aptoInput.value = a.nombre; aptoRes.classList.add('oculto');
          verificarDisponibilidad(null); programarCalculoTarifa();
        });
    });

    // Cliente: pills buscar/nuevo.
    document.getElementById('rsv-cli-tab-buscar').addEventListener('click', () => setClienteModo('buscar'));
    document.getElementById('rsv-cli-tab-nuevo').addEventListener('click', () => setClienteModo('nuevo'));

    const cliInput = document.getElementById('rsv-cli-input');
    const cliRes = document.getElementById('rsv-cli-res');
    let cliTimer = null;
    cliInput.addEventListener('input', () => {
      wzCliente = null;
      document.getElementById('rsv-cli-card').classList.add('oculto');
      clearTimeout(cliTimer);
      const q = cliInput.value.trim();
      if (q.length < 2) { cliRes.classList.add('oculto'); return; }
      cliTimer = setTimeout(async () => {
        let lista = [];
        try { lista = await API.get('/api/clientes?buscar=' + encodeURIComponent(q) + '&limit=8'); } catch (e) { lista = []; }
        renderTAReserva(cliRes, lista,
          (c) => `${esc(nombreCli(c))}${c.telefono ? ' · ' + esc(c.telefono) : ''}${c.email ? ' · ' + esc(c.email) : ''}`,
          (c) => { wzCliente = c; cliInput.value = nombreCli(c); cliRes.classList.add('oculto'); pintarCliCard(c); });
      }, 350);
    });

    // Cierre de dropdowns al pulsar fuera.
    document.getElementById('modal-contenido')?.addEventListener('click', (e) => {
      if (!e.target.closest('.rsv-ta')) { aptoRes.classList.add('oculto'); cliRes.classList.add('oculto'); }
    });

    // Fechas → noches + disponibilidad + tarifa.
    ['f-entrada', 'f-salida'].forEach((fid) =>
      document.getElementById(fid).addEventListener('change', () => {
        refrescarNoches(); verificarDisponibilidad(null); programarCalculoTarifa();
      }));

    // Precio manual.
    document.getElementById('f-precio').addEventListener('input', () => {
      tarifaPrecioManual = document.getElementById('f-precio').value !== '';
      actualizarBadgePrecio();
    });

    // Acciones (formulario único).
    document.getElementById('rsv-wz-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('rsv-wz-crear').addEventListener('click', guardarNuevo);
  }

  function nombreCli(c) { return [c.nombre, c.apellido1, c.apellido2].filter(Boolean).join(' '); }

  function setClienteModo(modo) {
    wzClienteModo = modo;
    document.getElementById('rsv-cli-tab-buscar').classList.toggle('activo', modo === 'buscar');
    document.getElementById('rsv-cli-tab-nuevo').classList.toggle('activo', modo === 'nuevo');
    document.getElementById('rsv-cli-buscar').classList.toggle('oculto', modo !== 'buscar');
    document.getElementById('rsv-cli-nuevo').classList.toggle('oculto', modo !== 'nuevo');
  }

  function pintarCliCard(c) {
    const card = document.getElementById('rsv-cli-card');
    if (!card) return;
    const nombre = nombreCli(c);
    card.innerHTML = `
      <span class="rsv-cli-avatar">${(nombre[0] || '?').toUpperCase()}</span>
      <div class="rsv-cli-datos">
        <div class="rsv-cli-nombre">${esc(nombre)}</div>
        <div class="rsv-cli-meta">${[c.telefono, c.email].filter(Boolean).map(esc).join(' · ') || '—'}</div>
      </div>
      <button type="button" class="rsv-cli-quitar" id="rsv-cli-quitar" title="Quitar">✕</button>`;
    card.classList.remove('oculto');
    document.getElementById('rsv-cli-quitar').addEventListener('click', () => {
      wzCliente = null;
      card.classList.add('oculto');
      const inp = document.getElementById('rsv-cli-input');
      if (inp) inp.value = '';
    });
  }

  function refrescarNoches() {
    const e = document.getElementById('f-entrada')?.value;
    const s = document.getElementById('f-salida')?.value;
    const span = document.getElementById('rsv-wz-noches');
    if (!span) return;
    if (e && s && s > e) {
      const n = Math.round((new Date(s) - new Date(e)) / 86400000);
      span.textContent = `${n} noche${n === 1 ? '' : 's'}`;
      span.classList.remove('oculto');
    } else {
      span.classList.add('oculto');
    }
  }

  // Typeahead genérico del módulo Reservas.
  function renderTAReserva(cont, lista, label, onPick) {
    if (!cont) return;
    const items = lista.slice(0, 8);
    if (!items.length) { cont.classList.add('oculto'); cont.innerHTML = ''; return; }
    cont.innerHTML = items.map((it, i) => `<div class="rsv-ta-item" data-i="${i}">${label(it)}</div>`).join('');
    cont.classList.remove('oculto');
    cont.querySelectorAll('.rsv-ta-item').forEach((el) =>
      el.addEventListener('click', () => onPick(items[Number(el.dataset.i)])));
  }

  function validarReserva() {
    const portal = document.getElementById('f-portal')?.value || '';
    const entrada = document.getElementById('f-entrada')?.value || '';
    const salida = document.getElementById('f-salida')?.value || '';
    if (!portal) { toast('Selecciona un portal', 'error'); return false; }
    if (wzClienteModo === 'buscar' && !wzCliente) { toast('Selecciona un cliente o crea uno nuevo', 'error'); return false; }
    if (wzClienteModo === 'nuevo' && !(document.getElementById('rsv-cli-nombre')?.value || '').trim()) {
      toast('El nombre del cliente es obligatorio', 'error'); return false;
    }
    if (!entrada || !salida) { toast('Las fechas de entrada y salida son obligatorias', 'error'); return false; }
    if (entrada >= salida) { toast('La salida debe ser posterior a la entrada', 'error'); return false; }
    const ind = document.getElementById('f-disponibilidad');
    if (ind && ind.classList.contains('disponibilidad-error')) { toast('El apartamento no está disponible en esas fechas', 'error'); return false; }
    return true;
  }

  async function guardarNuevo() {
    if (!validarReserva()) return;
    const botones = document.querySelectorAll('#rsv-wz-crear');
    botones.forEach((b) => { b.disabled = true; });

    try {
      // 1) Cliente: usar el seleccionado o crear uno nuevo.
      let clienteId = wzCliente ? wzCliente.id : null;
      let nombreCliente = wzCliente ? nombreCli(wzCliente) : '';
      if (wzClienteModo === 'nuevo') {
        const nom = (document.getElementById('rsv-cli-nombre')?.value || '').trim();
        const ape = (document.getElementById('rsv-cli-ape')?.value || '').trim();
        const tel = (document.getElementById('rsv-cli-tel')?.value || '').trim();
        const mail = (document.getElementById('rsv-cli-email')?.value || '').trim();
        const nuevo = await API.post('/api/clientes', { nombre: nom, apellido1: ape, telefono: tel, email: mail });
        clienteId = nuevo.id;
        nombreCliente = [nom, ape].filter(Boolean).join(' ');
      }

      const portal = document.getElementById('f-portal')?.value || '';
      const precio = document.getElementById('f-precio')?.value || '';
      // TIH derivada del apartamento elegido (la requiere el backend); por defecto 1ª línea.
      const tih = wzApto && wzApto.tipo ? wzApto.tipo : '1';

      // 2) Crear reserva (sin numero_reserva: lo genera el backend).
      const body = {
        portal,
        apartamento_id: document.getElementById('f-apartamento-id')?.value || null,
        nombre_cliente: nombreCliente,
        cliente_id: clienteId,
        tih,
        entrada: document.getElementById('f-entrada')?.value || '',
        salida: document.getElementById('f-salida')?.value || '',
        precio_total: precio,
        observaciones: document.getElementById('f-observaciones')?.value || '',
      };
      const creada = await API.post('/api/reservas', body);
      // El POST no persiste portal ni cliente_id: se fijan con un PUT posterior.
      await API.put('/api/reservas/' + creada.id, { portal, cliente_id: clienteId });
      await anadirExtrasObligatorios(creada.id);

      cerrarModal();
      await cargar();
      toast(`Reserva ${creada.numero_reserva || ''} creada`.trim(), 'ok');
      if (creada.id) await abrirFicha(creada.id);
    } catch (e) {
      toast(e.message, 'error');
      botones.forEach((b) => { b.disabled = false; });
    }
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

  // ==================== Cálculo automático de tarifa (modal alta/edición) ====================
  let tarifaTimer = null;        // debounce
  let tarifaToken = 0;           // descarta respuestas obsoletas
  let tarifaCalc = null;         // último resultado de /api/tarifas/calcular
  let tarifaPrecioManual = false; // el usuario ha puesto el precio a mano
  let tarifaDesplegado = false;  // desglose largo expandido
  let coloresTemporada = {};     // nombre temporada -> color (por años cargados)
  let coloresAniosCargados = new Set();

  function programarCalculoTarifa() {
    clearTimeout(tarifaTimer);
    tarifaTimer = setTimeout(calcularTarifa, 500);
  }

  // Carga los colores de las temporadas de los años implicados (para tintar las filas).
  async function cargarColoresTemporada(entrada, salida) {
    const anios = [...new Set([entrada.slice(0, 4), salida.slice(0, 4)])];
    for (const a of anios) {
      if (coloresAniosCargados.has(a)) continue;
      try {
        const ts = await API.get(`/api/tarifas/temporadas?anio=${a}`);
        for (const t of ts) coloresTemporada[t.nombre] = t.color;
        coloresAniosCargados.add(a);
      } catch (e) { /* sin colores, filas sin tinte */ }
    }
  }

  // Fondo sutil con el color de la temporada (alpha ~10%).
  function tinteTemporada(nombre) {
    const c = coloresTemporada[nombre];
    return /^#[0-9a-fA-F]{6}$/.test(c || '') ? ` style="background:${c}1a"` : '';
  }

  async function calcularTarifa() {
    const cont = document.getElementById('f-tarifa');
    if (!cont) return;
    const aptId = document.getElementById('f-apartamento-id')?.value;
    const entrada = document.getElementById('f-entrada')?.value;
    const salida = document.getElementById('f-salida')?.value;
    const portal = document.getElementById('f-portal')?.value || '';

    if (!aptId || !entrada || !salida || entrada >= salida) {
      cont.classList.add('oculto');
      cont.innerHTML = '';
      tarifaCalc = null;
      actualizarBadgePrecio();
      return;
    }

    const token = ++tarifaToken;
    cont.classList.remove('oculto');
    cont.innerHTML = '<div class="rsv-trf-cargando"><span class="rsv-trf-spinner"></span> Calculando precio…</div>';

    let data;
    try {
      let url = `/api/tarifas/calcular?apartamento_id=${encodeURIComponent(aptId)}&entrada=${encodeURIComponent(entrada)}&salida=${encodeURIComponent(salida)}`;
      if (portal) url += `&portal=${encodeURIComponent(portal)}`;
      data = await API.get(url);
    } catch (e) {
      if (token !== tarifaToken) return; // llegó tarde, hay otro cálculo en curso
      tarifaCalc = null;
      actualizarBadgePrecio();
      cont.innerHTML = `
        <div class="rsv-trf-aviso">⚠️ ${esc(e.message)}</div>
        <button type="button" class="btn-sec" id="f-trf-reintentar">Calcular de nuevo</button>`;
      document.getElementById('f-trf-reintentar').addEventListener('click', calcularTarifa);
      return;
    }
    if (token !== tarifaToken) return;

    tarifaCalc = data;
    tarifaDesplegado = false;
    await cargarColoresTemporada(entrada, salida);
    if (token !== tarifaToken) return;
    renderTarifa(cont);

    // El cálculo es una sugerencia: solo autorrellena si el usuario no ha puesto precio a mano.
    if (!tarifaPrecioManual) {
      const inp = document.getElementById('f-precio');
      if (inp) inp.value = data.precio_total;
    }
    actualizarBadgePrecio();
  }

  function filaNoche(n) {
    const mod = (Number(n.modificador) || 0);
    const modTxt = mod === 0 ? '—' : (mod > 0 ? '+' : '−') + Math.abs(mod) + '%';
    return `
      <tr${tinteTemporada(n.temporada)}>
        <td>${fechaES(n.fecha)}</td>
        <td>${esc(n.temporada)}</td>
        <td style="text-align:right">${euro(n.precio_base)}</td>
        <td style="text-align:right">${modTxt}</td>
        <td style="text-align:right">${euro(n.precio_final)}</td>
      </tr>`;
  }

  function renderTarifa(cont) {
    const d = tarifaCalc;
    if (!d) return;
    const noches = d.desglose.length;

    let filas;
    if (noches > 7 && !tarifaDesplegado) {
      const ocultas = noches - 5;
      filas = d.desglose.slice(0, 3).map(filaNoche).join('') +
        `<tr class="rsv-trf-mas"><td colspan="5" id="f-trf-mas">… y ${ocultas} noche${ocultas === 1 ? '' : 's'} más (pulsa para ver)</td></tr>` +
        d.desglose.slice(-2).map(filaNoche).join('');
    } else {
      filas = d.desglose.map(filaNoche).join('');
    }

    const lineas = [];
    lineas.push(`<div class="rsv-trf-linea"><span>Subtotal (${noches} noche${noches === 1 ? '' : 's'}):</span><span>${euro(d.subtotal)}</span></div>`);
    for (const x of d.descuentos_aplicados || []) {
      lineas.push(`<div class="rsv-trf-linea rsv-trf-desc"><span>Descuento "${esc(x.nombre)}" (−${x.porcentaje}%):</span><span>−${euro(x.importe)}</span></div>`);
    }
    for (const x of d.extras_obligatorios || []) {
      lineas.push(`<div class="rsv-trf-linea rsv-trf-extra"><span>Extra obligatorio "${esc(x.nombre)}":</span><span>${euro(x.importe)}</span></div>`);
    }

    cont.innerHTML = `
      <table class="rsv-trf-tabla">
        <thead><tr><th>Fecha</th><th>Temporada</th><th style="text-align:right">Precio base</th><th style="text-align:right">Modif.</th><th style="text-align:right">Precio/noche</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
      <div class="rsv-trf-resumen">
        ${lineas.join('')}
        <div class="rsv-trf-linea rsv-trf-total"><span>PRECIO TOTAL:</span><span>${euro(d.precio_total)}</span></div>
      </div>`;

    const mas = document.getElementById('f-trf-mas');
    if (mas) mas.addEventListener('click', () => { tarifaDesplegado = true; renderTarifa(cont); });
  }

  // Badge "Precio manual" si el precio del campo difiere del calculado.
  function actualizarBadgePrecio() {
    const badge = document.getElementById('f-precio-badge');
    const inp = document.getElementById('f-precio');
    if (!badge || !inp) return;
    const calculado = tarifaCalc ? Number(tarifaCalc.precio_total) : null;
    const actual = inp.value === '' ? null : Number(inp.value);
    const difiere = tarifaPrecioManual && calculado != null && actual != null &&
      Math.abs(actual - calculado) > 0.009;
    badge.classList.toggle('oculto', !difiere);
    if (difiere) badge.textContent = `Precio manual (difiere del calculado: ${euro(calculado)})`;
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

    const portal = document.getElementById('f-portal')?.value || '';
    const precio = document.getElementById('f-precio')?.value || '';

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
      precio_total:   precio,
    };

    try {
      if (id) {
        await API.put('/api/reservas/' + id, { ...body, portal, precio_total: precio });
      } else {
        // El POST de reservas recibe el precio para que genere el plan de pagos 20/80
        // automáticamente. El portal se fija con un PUT posterior y los extras obligatorios
        // del catálogo se añaden uno a uno.
        const creada = await API.post('/api/reservas', body);
        if (portal) {
          await API.put('/api/reservas/' + creada.id, { portal, precio_total: precio });
        }
        await anadirExtrasObligatorios(creada.id);
      }
      cerrarModal();
      await cargar();
      toast(id ? 'Reserva actualizada' : 'Reserva creada', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // Añade automáticamente a la reserva recién creada los extras marcados como
  // obligatorios en el catálogo (cantidad 1). No rompe la creación si algo falla.
  async function anadirExtrasObligatorios(reservaId) {
    let catalogo = [];
    try { catalogo = await API.get('/api/catalogo-extras'); } catch (e) { return; }
    const obligatorios = catalogo.filter((c) => c.obligatorio && c.activo);
    for (const c of obligatorios) {
      try {
        await API.post(`/api/reservas/${reservaId}/extras`, { catalogo_extra_id: c.id, cantidad: 1 });
      } catch (e) {
        toast(`No se pudo añadir el extra obligatorio "${c.nombre}"`, 'error');
      }
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

  // ==================== Imprimir entradas del día ====================
  function entIsoLocal(d) {
    const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return z.toISOString().slice(0, 10);
  }
  function entHoy() { return entIsoLocal(new Date()); }
  function entManana() { const d = new Date(); d.setDate(d.getDate() + 1); return entIsoLocal(d); }

  function rangoEntradas() {
    const sel = document.querySelector('input[name="ent-rango"]:checked');
    const v = sel ? sel.value : 'hoy';
    if (v === 'hoy') return { desde: entHoy(), hasta: entHoy() };
    if (v === 'manana') return { desde: entManana(), hasta: entManana() };
    const d = document.getElementById('ent-desde')?.value || '';
    const h = document.getElementById('ent-hasta')?.value || d;
    return { desde: d, hasta: h || d };
  }

  async function actualizarPreviewEntradas() {
    const { desde, hasta } = rangoEntradas();
    const el = document.getElementById('ent-preview');
    if (!el) return;
    if (!desde) { el.textContent = 'Selecciona una fecha'; return; }
    el.textContent = 'Buscando…';
    try {
      const lista = await API.get(`/api/reservas?desde=${desde}&hasta=${hasta}`);
      const n = lista.filter((r) => r.entrada >= desde && r.entrada <= hasta).length;
      el.textContent = `${n} entrada${n === 1 ? '' : 's'} encontrada${n === 1 ? '' : 's'}`;
    } catch (e) { el.textContent = 'No se pudo contar las entradas'; }
  }

  async function descargarEntradas(imprimir) {
    const { desde, hasta } = rangoEntradas();
    if (!desde) return toast('Selecciona una fecha', 'error');
    try {
      const sesion = (typeof Auth !== 'undefined' && Auth.sesion()) || {};
      const r = await fetch(`/api/reservas/entradas-pdf?desde=${desde}&hasta=${hasta}`, {
        headers: { 'X-Auth-Token': sesion.token },
      });
      if (!r.ok) throw new Error('Error al generar PDF');
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      if (imprimir) {
        const w = window.open(url);
        if (w) w.addEventListener('load', () => { try { w.print(); } catch (e) { /* ignore */ } });
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = `entradas-${desde}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) { toast('Error al descargar el PDF', 'error'); }
  }

  function modalEntradas() {
    abrirModal(`
      <h3>Imprimir entradas</h3>
      <div class="campo">
        <label>Fecha</label>
        <div class="rsv-ent-radios">
          <label><input type="radio" name="ent-rango" value="hoy" checked> Hoy</label>
          <label><input type="radio" name="ent-rango" value="manana"> Mañana</label>
          <label><input type="radio" name="ent-rango" value="custom"> Rango personalizado</label>
        </div>
      </div>
      <div id="ent-fechas" class="fila-campos oculto">
        <div class="campo"><label>Desde</label><input type="date" id="ent-desde"></div>
        <div class="campo"><label>Hasta</label><input type="date" id="ent-hasta"></div>
      </div>
      <div id="ent-preview" style="margin:8px 0 4px;font-weight:600;color:var(--nav)">…</div>
      <div class="modal-acciones">
        <button class="btn-sec" id="ent-cancelar">Cancelar</button>
        <button class="btn-sec" id="ent-imprimir">🖨️ Imprimir</button>
        <button class="btn-pri" id="ent-descargar">📥 Descargar PDF</button>
      </div>`);

    const fechas = document.getElementById('ent-fechas');
    document.querySelectorAll('input[name="ent-rango"]').forEach((rb) =>
      rb.addEventListener('change', () => {
        fechas.classList.toggle('oculto', rb.value !== 'custom' || !rb.checked);
        if (document.querySelector('input[name="ent-rango"]:checked').value === 'custom'
          && !document.getElementById('ent-desde').value) {
          document.getElementById('ent-desde').value = entHoy();
          document.getElementById('ent-hasta').value = entHoy();
        }
        actualizarPreviewEntradas();
      }));
    document.getElementById('ent-desde').addEventListener('change', actualizarPreviewEntradas);
    document.getElementById('ent-hasta').addEventListener('change', actualizarPreviewEntradas);
    document.getElementById('ent-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('ent-descargar').addEventListener('click', () => descargarEntradas(false));
    document.getElementById('ent-imprimir').addEventListener('click', () => descargarEntradas(true));
    actualizarPreviewEntradas();
  }

  // ==================== Filtros avanzados (panel desplegable) ====================
  // Inyecta el botón "🔽 Filtros" + panel en la barra de controles, eliminando los
  // filtros antiguos (botones TIH + select de mes) que viven en index.html.
  function construirFiltros() {
    const controles = document.querySelector('#vista-reservas .reservas-controles');
    if (!controles || document.getElementById('rsv-filtros-btn')) return;

    // Eliminar filtros antiguos.
    controles.querySelector('.filtro-tih-btns')?.remove();
    controles.querySelector('#reservas-filtro-mes')?.remove();

    const grupoCheck = (titulo, contId, items) => `
      <div class="rsv-f-grupo">
        <div class="rsv-f-titulo">${titulo}</div>
        <div class="rsv-f-todos" data-todos="${contId}">Seleccionar / deseleccionar todos</div>
        <div class="rsv-f-ops" id="${contId}">${items}</div>
      </div>`;

    const clasItems = CLASIFICACIONES.map((c) => `
      <label class="rsv-f-op"><input type="checkbox" data-grupo="clas" value="${c.key}" checked>
        ${c.key === '__sin__' ? '<span class="rsv-f-op-label">Sin clasificar</span>'
          : `<span class="badge-clasif ${c.clase}">${c.key}</span>`}</label>`).join('');

    const estadoItems = ESTADOS.map((e) => `
      <label class="rsv-f-op"><input type="checkbox" data-grupo="estado" value="${e}" checked>
        <span class="rsv-f-op-label">${e}</span></label>`).join('');

    const condItems = CONDICIONES.map((c) => `
      <label class="rsv-f-op"><input type="checkbox" data-grupo="cond" value="${c.key}" checked>
        <span class="rsv-f-op-label">${c.label}</span></label>`).join('');

    const wrap = document.createElement('div');
    wrap.className = 'rsv-filtros-wrap';
    wrap.innerHTML = `
      <button id="rsv-filtros-btn" class="btn-sec">🔽 Filtros <span id="rsv-filtros-badge" class="rsv-filtros-badge oculto"></span></button>
      <div id="rsv-filtros-panel" class="rsv-filtros-panel oculto">
        ${grupoCheck('Tipo de apartamento', 'rsv-f-clas', clasItems)}
        ${grupoCheck('Portal', 'rsv-f-portales', '')}
        ${grupoCheck('Estado de la reserva', 'rsv-f-estado', estadoItems)}
        ${grupoCheck('Condición de cancelación', 'rsv-f-cond', condItems)}
        <div class="rsv-f-grupo">
          <div class="rsv-f-titulo">Rango de fechas (entrada)</div>
          <div class="rsv-f-fechas">
            <label>Desde<input type="date" id="rsv-f-desde"></label>
            <label>Hasta<input type="date" id="rsv-f-hasta"></label>
          </div>
          <div class="rsv-f-pills">
            <button class="rsv-f-pill" data-rango="mes">Este mes</button>
            <button class="rsv-f-pill" data-rango="30">Próximos 30 días</button>
            <button class="rsv-f-pill" data-rango="anio">Este año</button>
            <button class="rsv-f-pill" data-rango="limpiar">Limpiar</button>
          </div>
        </div>
      </div>`;
    const limpiar = document.createElement('button');
    limpiar.id = 'rsv-limpiar';
    limpiar.className = 'btn-sec rsv-limpiar oculto';
    limpiar.textContent = 'Limpiar filtros';

    controles.appendChild(wrap);
    controles.appendChild(limpiar);

    conectarFiltros(wrap, limpiar);
  }

  // Rellena los checkboxes de portal (tras cargar la lista) respetando la selección actual.
  function poblarPortalesFiltro() {
    const cont = document.getElementById('rsv-f-portales');
    if (!cont) return;
    const items = [
      ...portalesNombres.map((nm) => ({ key: nm, label: nm })),
      { key: '__sin__', label: 'Sin portal' },
    ];
    cont.innerHTML = items.map((it) => `
      <label class="rsv-f-op"><input type="checkbox" data-grupo="portal" value="${esc(it.key)}"${fPortal && fPortal.has(it.key) ? ' checked' : ''}>
        <span class="rsv-f-op-label">${esc(it.label)}</span></label>`).join('');
  }

  function setDeGrupo(grupo) {
    return grupo === 'clas' ? fClas : grupo === 'estado' ? fEstado : grupo === 'cond' ? fCond : fPortal;
  }

  function conectarFiltros(wrap, limpiar) {
    const btn = wrap.querySelector('#rsv-filtros-btn');
    const panel = wrap.querySelector('#rsv-filtros-panel');

    const abrir = (v) => panel.classList.toggle('oculto', !v);
    btn.addEventListener('click', (e) => { e.stopPropagation(); abrir(panel.classList.contains('oculto')); });
    panel.addEventListener('click', (e) => e.stopPropagation());

    // Cerrar al clic fuera o Escape.
    document.addEventListener('click', () => abrir(false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') abrir(false); });

    // Checkboxes (delegación): actualizan el Set del grupo correspondiente.
    panel.addEventListener('change', (e) => {
      const chk = e.target.closest('input[type="checkbox"][data-grupo]');
      if (!chk) return;
      const set = setDeGrupo(chk.dataset.grupo);
      if (chk.checked) set.add(chk.value); else set.delete(chk.value);
      aplicarFiltros();
    });

    // "Seleccionar / deseleccionar todos" por grupo.
    panel.querySelectorAll('.rsv-f-todos').forEach((el) =>
      el.addEventListener('click', () => {
        const cont = document.getElementById(el.dataset.todos);
        const checks = [...cont.querySelectorAll('input[type="checkbox"]')];
        const marcarTodos = !checks.every((c) => c.checked); // si todos marcados -> desmarca
        const set = setDeGrupo(checks[0]?.dataset.grupo);
        if (!set) return;
        checks.forEach((c) => { c.checked = marcarTodos; if (marcarTodos) set.add(c.value); else set.delete(c.value); });
        aplicarFiltros();
      }));

    // Fechas.
    wrap.querySelector('#rsv-f-desde').addEventListener('change', (e) => { fDesde = e.target.value; aplicarFiltros(); });
    wrap.querySelector('#rsv-f-hasta').addEventListener('change', (e) => { fHasta = e.target.value; aplicarFiltros(); });

    wrap.querySelectorAll('.rsv-f-pill').forEach((p) =>
      p.addEventListener('click', () => { aplicarRangoFecha(p.dataset.rango); }));

    limpiar.addEventListener('click', resetFiltros);
  }

  // Atajos de rango de fecha.
  function aplicarRangoFecha(rango) {
    const hoy = new Date();
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (rango === 'mes') {
      fDesde = iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
      fHasta = iso(new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0));
    } else if (rango === '30') {
      fDesde = iso(hoy);
      fHasta = iso(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 30));
    } else if (rango === 'anio') {
      fDesde = `${hoy.getFullYear()}-01-01`;
      fHasta = `${hoy.getFullYear()}-12-31`;
    } else { // limpiar
      fDesde = '';
      fHasta = '';
    }
    const d = document.getElementById('rsv-f-desde');
    const h = document.getElementById('rsv-f-hasta');
    if (d) d.value = fDesde;
    if (h) h.value = fHasta;
    aplicarFiltros();
  }

  // Resetea todos los filtros a su valor por defecto (todo marcado, sin fechas).
  function resetFiltros() {
    fClas = new Set(CLASIFICACIONES.map((c) => c.key));
    fEstado = new Set(ESTADOS);
    fCond = new Set(CONDICIONES.map((c) => c.key));
    fPortal = new Set([...portalesNombres, '__sin__']);
    fDesde = '';
    fHasta = '';
    // Re-marcar todos los checkboxes del panel y limpiar fechas.
    document.querySelectorAll('#rsv-filtros-panel input[type="checkbox"]').forEach((c) => { c.checked = true; });
    const d = document.getElementById('rsv-f-desde');
    const h = document.getElementById('rsv-f-hasta');
    if (d) d.value = '';
    if (h) h.value = '';
    aplicarFiltros();
  }

  // Redibuja la tabla y actualiza el badge del botón + visibilidad de "Limpiar filtros".
  function aplicarFiltros() {
    renderTabla(filtrar());
    const n = filtrosActivos();
    const badge = document.getElementById('rsv-filtros-badge');
    if (badge) { badge.textContent = n; badge.classList.toggle('oculto', n === 0); }
    document.getElementById('rsv-limpiar')?.classList.toggle('oculto', n === 0);
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
      [pagosData, extrasData] = await Promise.all([
        API.get('/api/reservas/' + id + '/pagos'),
        API.get('/api/reservas/' + id + '/extras'),
      ]);
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
      dato('Cliente', (esc(r.cliente_nombre_completo || r.nombre_cliente) || '—') +
        (r.cliente_id ? ` <a class="vta-link rsv-ver-cliente" data-cliente="${r.cliente_id}">Ver ficha del cliente →</a>` : '')) +
      dato('Ocupante', esc(r.ocupante || r.nombre_cliente) || '—') +
      dato('Número ocupantes', (r.personas != null ? r.personas : '—') + ' Adultos');

    const derecha =
      dato('Tipo de reserva', `<span class="badge-rsv ${estadoClase(r.tipo_reserva)}">${esc(r.tipo_reserva) || 'Confirmada'}</span>`) +
      dato('Fecha de creación', fechaCreacionFmt(r.fecha_creacion)) +
      dato('Número de noches', `${n} noche${n === 1 ? '' : 's'}${ultimaNoche ? ` (Última noche: ${fechaES(ultimaNoche)})` : ''}`) +
      dato('Portal', portalDato(r)) +
      dato('Condición de cancelación', esc(r.condicion_cancelacion) || '—') +
      dato('Atendido por', esc(r.atendido_por) || '—');

    const proximamente = '<div class="rsv-proximamente">Próximamente</div>';

    document.getElementById('rsv-cuerpo').innerHTML = `
      <div class="rsv-subpanel activo" data-rsubpanel="datos">
        <div class="rsv-seccion-titulo">Datos</div>
        <div class="rsv-grid"><div>${izquierda}</div><div>${derecha}</div></div>

        <div class="rsv-seccion-titulo">Check-in</div>
        <div class="rsv-grid">
          <div>${dato('Check-in', esc(r.checkin_estado) || 'Pendiente')}</div>
          <div></div>
        </div>

        <div id="rsv-extras-cont"></div>
        <div id="rsv-pagos-cont"></div>
      </div>
      <div class="rsv-subpanel" data-rsubpanel="mensajes">${proximamente}</div>
      <div class="rsv-subpanel" data-rsubpanel="margen">${proximamente}</div>
      <div class="rsv-subpanel" data-rsubpanel="liquidacion">${proximamente}</div>`;

    // Link a la ficha del cliente vinculado.
    document.querySelector('#rsv-cuerpo .rsv-ver-cliente')?.addEventListener('click', (e) => {
      const cid = e.currentTarget.dataset.cliente;
      activarTab('clientes');
      if (typeof ClientesAlquiler !== 'undefined' && ClientesAlquiler.abrirFicha) ClientesAlquiler.abrirFicha(cid);
    });

    pintarExtras();
    pintarPagos();
    activarSubtab('datos');
  }

  // ==================== Sección EXTRAS (dentro de la pestaña Datos) ====================
  const TIPO_EXTRA = { unidad: 'unidad', noche: 'noche', persona: 'persona' };

  function tipoExtraBadge(t) {
    return `<span class="extra-tipo-badge">${TIPO_EXTRA[t] || esc(t || '—')}</span>`;
  }

  function htmlExtras() {
    const total = Number(extrasData.total_extras) || 0;
    const filas = (extrasData.extras || []).map((e) => `
      <tr>
        <td>${esc(e.nombre)}</td>
        <td>${tipoExtraBadge(e.tipo_precio)}</td>
        <td>${e.cantidad}</td>
        <td>${euro(e.importe)}</td>
        <td class="extra-acciones">
          <button class="btn-icono extra-editar" data-id="${e.id}" title="Editar">✏️</button>
          <button class="btn-icono extra-borrar" data-id="${e.id}" title="Eliminar">🗑️</button>
        </td>
      </tr>`).join('');
    const cuerpo = filas || '<tr><td colspan="5" class="extra-vacio">Sin extras añadidos</td></tr>';

    return `
      <div class="rsv-seccion-titulo pago-cabecera">
        <span>EXTRAS</span>
        <span class="pago-resumen">Total extras: ${euro(total)}</span>
      </div>
      <table class="pago-tabla extra-tabla">
        <thead><tr><th>Concepto</th><th>Tipo</th><th>Cantidad</th><th>Importe</th><th></th></tr></thead>
        <tbody>${cuerpo}</tbody>
      </table>
      <div class="pago-botones">
        <button class="btn-sec" id="extra-add">＋ Añadir extra</button>
      </div>`;
  }

  function pintarExtras() {
    const cont = document.getElementById('rsv-extras-cont');
    if (!cont) return;
    cont.innerHTML = htmlExtras();
    cont.querySelector('#extra-add')?.addEventListener('click', modalAnadirExtra);
    cont.querySelectorAll('.extra-editar').forEach((b) =>
      b.addEventListener('click', () => modalEditarExtra(b.dataset.id)));
    cont.querySelectorAll('.extra-borrar').forEach((b) =>
      b.addEventListener('click', () => borrarExtra(b.dataset.id)));
  }

  // Refetch de extras + repintado de extras y pagos (el total de extras afecta al desfase).
  async function recargarExtras() {
    if (!fichaActual) return;
    try {
      extrasData = await API.get('/api/reservas/' + fichaActual.id + '/extras');
    } catch (e) {
      return toast(e.message, 'error');
    }
    pintarExtras();
    pintarPagos();
  }

  async function borrarExtra(id) {
    if (!confirm('¿Eliminar este extra?')) return;
    try {
      await API.del('/api/reservas/' + fichaActual.id + '/extras/' + id);
      await recargarExtras();
      toast('Extra eliminado', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  }

  // Modal añadir extra: typeahead de catálogo (solo activos) + cantidad + resumen en vivo.
  async function modalAnadirExtra() {
    try {
      catalogoExtras = (await API.get('/api/catalogo-extras')).filter((x) => x.activo);
    } catch (e) { return toast(e.message, 'error'); }

    const nNoches = noches(fichaActual.entrada, fichaActual.salida) || 1;
    let seleccionado = null; // extra del catálogo elegido

    abrirModal(`
      <h3>Añadir extra</h3>
      <div class="campo typeahead-campo">
        <label>Extra *</label>
        <input id="ex-buscar" autocomplete="off" placeholder="Escribe para buscar…">
        <div id="ex-sugerencias" class="typeahead-lista oculto"></div>
      </div>
      <div id="ex-info" class="extra-info oculto"></div>
      <div class="campo"><label>Cantidad</label><input type="number" id="ex-cantidad" min="1" step="1" value="1"></div>
      <div id="ex-resumen" class="extra-resumen"></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="ex-cancelar">Cancelar</button>
        <button class="btn-pri" id="ex-guardar">Añadir</button>
      </div>`);

    const inp = document.getElementById('ex-buscar');
    const lista = document.getElementById('ex-sugerencias');
    const info = document.getElementById('ex-info');
    const cantInp = document.getElementById('ex-cantidad');

    const actualizarResumen = () => {
      const res = document.getElementById('ex-resumen');
      if (!seleccionado) { res.textContent = ''; return; }
      const cant = parseInt(cantInp.value, 10) || 0;
      const esNoche = seleccionado.tipo_precio === 'noche';
      const importe = seleccionado.precio * cant * (esNoche ? nNoches : 1);
      res.textContent =
        `${cant} × ${euro(seleccionado.precio)}${esNoche ? ` × ${nNoches} noche${nNoches === 1 ? '' : 's'}` : ''} = ${euro(importe)}`;
    };

    const elegir = (ex) => {
      seleccionado = ex;
      inp.value = ex.nombre;
      lista.classList.add('oculto');
      info.classList.remove('oculto');
      info.innerHTML = `Precio unitario: <strong>${euro(ex.precio)}</strong> · Tipo: ${tipoExtraBadge(ex.tipo_precio)}`;
      actualizarResumen();
    };

    const renderSugerencias = () => {
      const q = inp.value.trim().toLowerCase();
      const matches = catalogoExtras.filter((x) => !q || (x.nombre || '').toLowerCase().includes(q)).slice(0, 8);
      if (!matches.length) { lista.classList.add('oculto'); return; }
      lista.innerHTML = matches
        .map((x) => `<div class="typeahead-item" data-id="${x.id}">${esc(x.nombre)} <span class="typeahead-sub">${euro(x.precio)} · ${TIPO_EXTRA[x.tipo_precio] || ''}</span></div>`)
        .join('');
      lista.classList.remove('oculto');
      lista.querySelectorAll('.typeahead-item').forEach((it) =>
        it.addEventListener('mousedown', (e) => { e.preventDefault(); elegir(catalogoExtras.find((x) => x.id == it.dataset.id)); }));
    };

    inp.addEventListener('input', () => { seleccionado = null; info.classList.add('oculto'); document.getElementById('ex-resumen').textContent = ''; renderSugerencias(); });
    inp.addEventListener('focus', renderSugerencias);
    inp.addEventListener('blur', () => setTimeout(() => lista.classList.add('oculto'), 150));
    cantInp.addEventListener('input', actualizarResumen);

    document.getElementById('ex-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('ex-guardar').addEventListener('click', async () => {
      if (!seleccionado) return toast('Selecciona un extra del catálogo', 'error');
      const cantidad = parseInt(cantInp.value, 10);
      if (!cantidad || cantidad < 1) return toast('La cantidad debe ser al menos 1', 'error');
      try {
        await API.post('/api/reservas/' + fichaActual.id + '/extras', { catalogo_extra_id: seleccionado.id, cantidad });
        cerrarModal();
        await recargarExtras();
        toast('Extra añadido', 'ok');
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  // Modal editar extra: nombre en solo lectura (snapshot) + cantidad editable con recálculo.
  function modalEditarExtra(id) {
    const ex = (extrasData.extras || []).find((x) => x.id == id);
    if (!ex) return;
    const esNoche = ex.tipo_precio === 'noche';
    const nNoches = ex.noches || 1;

    abrirModal(`
      <h3>Editar extra</h3>
      <div class="campo"><label>Extra</label><input value="${esc(ex.nombre)}" readonly class="campo-readonly"></div>
      <div id="ex-info" class="extra-info">Precio unitario: <strong>${euro(ex.precio_unitario)}</strong> · Tipo: ${tipoExtraBadge(ex.tipo_precio)}</div>
      <div class="campo"><label>Cantidad</label><input type="number" id="ex-cantidad" min="1" step="1" value="${ex.cantidad}"></div>
      <div id="ex-resumen" class="extra-resumen"></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="ex-cancelar">Cancelar</button>
        <button class="btn-pri" id="ex-guardar">Guardar</button>
      </div>`);

    const cantInp = document.getElementById('ex-cantidad');
    const actualizarResumen = () => {
      const cant = parseInt(cantInp.value, 10) || 0;
      const importe = ex.precio_unitario * cant * (esNoche ? nNoches : 1);
      document.getElementById('ex-resumen').textContent =
        `${cant} × ${euro(ex.precio_unitario)}${esNoche ? ` × ${nNoches} noche${nNoches === 1 ? '' : 's'}` : ''} = ${euro(importe)}`;
    };
    actualizarResumen();
    cantInp.addEventListener('input', actualizarResumen);

    document.getElementById('ex-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('ex-guardar').addEventListener('click', async () => {
      const cantidad = parseInt(cantInp.value, 10);
      if (!cantidad || cantidad < 1) return toast('La cantidad debe ser al menos 1', 'error');
      try {
        await API.put('/api/reservas/' + fichaActual.id + '/extras/' + id, { cantidad });
        cerrarModal();
        await recargarExtras();
        toast('Extra actualizado', 'ok');
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  // ==================== Sección PAGOS (dentro de la pestaña Datos) ====================
  const METODOS_PAGO = { caja: '💵 Caja', tpv: '💳 TPV', transferencia: '🏦 Transferencia' };

  function metodoBadge(m) {
    if (!m) return '<span class="pago-metodo-badge">—</span>';
    return `<span class="pago-metodo-badge">${METODOS_PAGO[m] || esc(m)}</span>`;
  }
  function estadoPagoBadge(pagado) {
    return pagado
      ? '<span class="pago-estado pago-estado-ok">Pagado</span>'
      : '<span class="pago-estado pago-estado-pend">Pendiente</span>';
  }
  function hoyISO() { return new Date().toISOString().slice(0, 10); }

  // Construye el HTML completo de la sección PAGOS a partir de pagosData.
  function htmlPagos() {
    const precioReserva = Number(pagosData.precio_total_reserva) || 0;
    const totalExtras = Number(extrasData.total_extras) || 0;
    const total = precioReserva + totalExtras; // total a cobrar = precio reserva + extras
    const cobrado = Number(pagosData.total_pagado) || 0;
    const pct = total > 0 ? Math.min(100, Math.round((cobrado / total) * 100)) : 0;

    // Aviso de desfase: suma de TODOS los importes (pagados + pendientes) vs total a cobrar.
    const sumaPagos = (pagosData.pagos || []).reduce((s, p) => s + (Number(p.importe) || 0), 0);
    const diff = sumaPagos - total;
    let aviso = '';
    if (diff > 0.01) {
      aviso = `<div class="pago-aviso pago-aviso-warn">⚠️ Los pagos suman ${euro(diff)} más que el precio de la reserva (desfase: +${euro(diff)})</div>`;
    } else if (diff < -0.01 && (pagosData.pagos || []).length >= 1) {
      aviso = `<div class="pago-aviso pago-aviso-info">ℹ️ Falta planificar ${euro(-diff)} en pagos</div>`;
    }

    const filas = (pagosData.pagos || []).map((p) => `
      <tr>
        <td>${esc(p.concepto)}</td>
        <td>${euro(p.importe)}</td>
        <td>${metodoBadge(p.metodo_pago)}</td>
        <td>${estadoPagoBadge(p.pagado)}</td>
        <td>${p.pagado ? fechaES(p.fecha_pago) : '—'}</td>
        <td class="pago-acciones">
          ${p.pagado ? '' : `<button class="btn-mini pago-cobrar" data-id="${p.id}" title="Marcar pagado">✓ Marcar pagado</button>`}
          <button class="btn-icono pago-editar" data-id="${p.id}" title="Editar">✏️</button>
          <button class="btn-icono pago-borrar" data-id="${p.id}" title="Eliminar">🗑️</button>
        </td>
      </tr>`).join('');

    const cuerpoTabla = filas || '<tr><td colspan="6" class="pago-vacio">Sin pagos registrados.</td></tr>';

    return `
      <div class="rsv-seccion-titulo pago-cabecera">
        <span>PAGOS</span>
        <span class="pago-resumen">${euro(cobrado)} / ${euro(total)}</span>
      </div>
      <div class="pago-barra"><div class="pago-barra-fill" style="width:${pct}%"></div></div>
      ${aviso}

      <div class="pago-precio-inline">
        <span class="pago-precio-label">Precio:</span>
        <span class="pago-precio-val">${euro(precioReserva)}</span>
        ${totalExtras > 0 ? `<span class="pago-precio-label">+ Extras:</span><span class="pago-precio-val">${euro(totalExtras)}</span><span class="pago-precio-label">= Total a cobrar:</span><span class="pago-precio-val">${euro(total)}</span>` : ''}
      </div>

      <table class="pago-tabla">
        <thead><tr>
          <th>Concepto</th><th>Importe</th><th>Método</th><th>Estado</th><th>Fecha pago</th><th></th>
        </tr></thead>
        <tbody>${cuerpoTabla}</tbody>
      </table>

      <div class="pago-botones">
        <button class="btn-sec" id="pago-add">＋ Añadir pago</button>
        <button class="btn-sec" id="pago-autocompletar">💰 Autocompletar pago</button>
      </div>`;
  }

  // Pinta la sección PAGOS en su contenedor y conecta los eventos.
  function pintarPagos() {
    const cont = document.getElementById('rsv-pagos-cont');
    if (!cont) return;
    cont.innerHTML = htmlPagos();
    conectarPagos();
  }

  // Refetch de pagos + repintado (tras cualquier cambio).
  async function recargarPagos() {
    if (!fichaActual) return;
    try {
      pagosData = await API.get('/api/reservas/' + fichaActual.id + '/pagos');
    } catch (e) {
      return toast(e.message, 'error');
    }
    pintarPagos();
  }

  function conectarPagos() {
    const cont = document.getElementById('rsv-pagos-cont');
    if (!cont) return;

    cont.querySelector('#pago-add')?.addEventListener('click', () => modalPago(null));
    cont.querySelector('#pago-autocompletar')?.addEventListener('click', autocompletarPago);

    cont.querySelectorAll('.pago-cobrar').forEach((b) =>
      b.addEventListener('click', () => modalCobrar(b.dataset.id)));
    cont.querySelectorAll('.pago-editar').forEach((b) =>
      b.addEventListener('click', () => modalPago(b.dataset.id)));
    cont.querySelectorAll('.pago-borrar').forEach((b) =>
      b.addEventListener('click', () => borrarPago(b.dataset.id)));
  }

  // Crea un pago "complementario" por la diferencia entre el total a cobrar y la suma de pagos.
  async function autocompletarPago() {
    const totalACobrar = (Number(pagosData.precio_total_reserva) || 0) + (Number(extrasData.total_extras) || 0);
    const sumaPagos = (pagosData.pagos || []).reduce((s, p) => s + (Number(p.importe) || 0), 0);
    const diff = totalACobrar - sumaPagos;

    if (diff < -0.01) return toast('Los pagos superan el total a cobrar', 'error');
    if (diff <= 0.01) return toast('No hay desfase que ajustar', 'ok');

    try {
      await API.post('/api/reservas/' + fichaActual.id + '/pagos', {
        concepto: 'Pago complementario',
        importe: diff,
        metodo_pago: null,
        pagado: 0,
        fecha_pago: null,
      });
      await recargarPagos();
      toast('Pago de ' + euro(diff) + ' añadido', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function borrarPago(id) {
    if (!confirm('¿Eliminar este pago?')) return;
    try {
      await API.del('/api/reservas/' + fichaActual.id + '/pagos/' + id);
      await recargarPagos();
      toast('Pago eliminado', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  }

  // Mini modal "Marcar pagado": fecha (hoy por defecto) + método.
  function modalCobrar(id) {
    const optMet = Object.entries(METODOS_PAGO)
      .map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
    abrirModal(`
      <h3>Marcar pago como cobrado</h3>
      <div class="fila-campos">
        <div class="campo"><label>Fecha de pago</label><input type="date" id="pc-fecha" value="${hoyISO()}"></div>
        <div class="campo"><label>Método de pago</label><select id="pc-metodo">${optMet}</select></div>
      </div>
      <div class="modal-acciones">
        <button class="btn-sec" id="pc-cancelar">Cancelar</button>
        <button class="btn-pri" id="pc-guardar">Marcar pagado</button>
      </div>`);
    document.getElementById('pc-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('pc-guardar').addEventListener('click', async () => {
      const body = {
        pagado: 1,
        fecha_pago: document.getElementById('pc-fecha').value || hoyISO(),
        metodo_pago: document.getElementById('pc-metodo').value,
      };
      try {
        await API.put('/api/reservas/' + fichaActual.id + '/pagos/' + id, body);
        cerrarModal();
        await recargarPagos();
        toast('Pago marcado como cobrado', 'ok');
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  // Modal añadir/editar pago.
  function modalPago(id) {
    const p = id ? (pagosData.pagos || []).find((x) => x.id == id) : null;
    const concepto = p ? p.concepto : 'Pago';
    const importe = p ? p.importe : '';
    const optMet = '<option value="">— Sin método —</option>' +
      Object.entries(METODOS_PAGO)
        .map(([v, t]) => `<option value="${v}"${p && p.metodo_pago === v ? ' selected' : ''}>${t}</option>`)
        .join('');
    const pagado = p ? !!p.pagado : false;

    abrirModal(`
      <h3>${id ? 'Editar' : 'Añadir'} pago</h3>
      <div class="fila-campos">
        <div class="campo"><label>Concepto *</label><input id="pm-concepto" value="${esc(concepto)}"></div>
        <div class="campo"><label>Importe (€) *</label><input type="number" step="0.01" id="pm-importe" value="${importe}"></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Método de pago</label><select id="pm-metodo">${optMet}</select></div>
        <div class="campo pago-toggle-campo">
          <label><input type="checkbox" id="pm-pagado"${pagado ? ' checked' : ''}> Marcar como pagado</label>
        </div>
      </div>
      <div class="fila-campos" id="pm-fecha-fila"${pagado ? '' : ' style="display:none"'}>
        <div class="campo"><label>Fecha de pago</label><input type="date" id="pm-fecha" value="${p && p.fecha_pago ? esc(p.fecha_pago) : hoyISO()}"></div>
        <div class="campo"></div>
      </div>
      <div class="campo"><label>Notas</label><textarea id="pm-notas">${esc(p ? p.notas : '')}</textarea></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="pm-cancelar">Cancelar</button>
        <button class="btn-pri" id="pm-guardar">Guardar</button>
      </div>`);

    const chk = document.getElementById('pm-pagado');
    chk.addEventListener('change', () => {
      document.getElementById('pm-fecha-fila').style.display = chk.checked ? '' : 'none';
    });
    document.getElementById('pm-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('pm-guardar').addEventListener('click', async () => {
      const concepto = (document.getElementById('pm-concepto').value || '').trim();
      const importeVal = document.getElementById('pm-importe').value;
      if (!concepto) return toast('El concepto es obligatorio', 'error');
      if (importeVal === '' || isNaN(parseFloat(importeVal))) return toast('El importe es obligatorio', 'error');
      const pagadoChk = document.getElementById('pm-pagado').checked;
      const body = {
        concepto,
        importe: parseFloat(importeVal),
        metodo_pago: document.getElementById('pm-metodo').value || null,
        pagado: pagadoChk ? 1 : 0,
        fecha_pago: pagadoChk ? (document.getElementById('pm-fecha').value || hoyISO()) : null,
        notas: document.getElementById('pm-notas').value || null,
      };
      try {
        if (id) await API.put('/api/reservas/' + fichaActual.id + '/pagos/' + id, body);
        else await API.post('/api/reservas/' + fichaActual.id + '/pagos', body);
        cerrarModal();
        await recargarPagos();
        toast(id ? 'Pago actualizado' : 'Pago añadido', 'ok');
      } catch (e) { toast(e.message, 'error'); }
    });
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

    // Tipo de reserva: opciones dinámicas desde los estados configurables (solo activos).
    // Se conserva el valor actual aunque su estado esté inactivo o ya no exista.
    let estados = [];
    try { estados = (await API.get('/api/ajustes/estados-reserva')).filter((e) => e.activo); }
    catch (e) { /* seguimos con lista vacía */ }
    const tipoActual = r.tipo_reserva || 'Confirmada';
    const nombresEstado = estados.map((e) => e.nombre);
    if (!nombresEstado.includes(tipoActual)) nombresEstado.unshift(tipoActual);
    const optTipo = nombresEstado.length
      ? selOpts(nombresEstado, tipoActual)
      : selOpts(['Confirmada', 'Pendiente', 'Cancelada'], tipoActual);

    abrirModal(`
      <h3>Editar reserva #${esc(r.numero_reserva || r.id)}</h3>
      <div class="fila-campos">
        <div class="campo"><label>Tipo de reserva</label>
          <select id="fr-tipo">${optTipo}</select></div>
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
        <div class="campo"><label>Check-in</label><select id="fr-checkin">${selOpts(['Pendiente', 'Asignado', 'Completado'], r.checkin_estado || 'Pendiente')}</select></div>
        <div class="campo"><label>Precio (€)</label><input type="number" step="0.01" id="fr-precio" value="${r.precio_total ?? 0}"></div>
      </div>
      <div class="campo"><label>Notas internas</label><textarea id="fr-notas">${esc(r.notas_internas)}</textarea></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="fr-cancelar">Cancelar</button>
        <button class="btn-pri" id="fr-guardar">Guardar</button>
      </div>`);
    document.querySelector('.modal').classList.add('modal-ancho');

    document.getElementById('fr-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('fr-guardar').addEventListener('click', async () => {
      const body = {
        tipo_reserva: document.getElementById('fr-tipo').value,
        portal: document.getElementById('fr-portal').value,
        condicion_cancelacion: document.getElementById('fr-condicion').value,
        ocupante: document.getElementById('fr-ocupante').value,
        checkin_estado: document.getElementById('fr-checkin').value,
        precio_total: document.getElementById('fr-precio').value,
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
    construirFiltros();
    const btnNueva = document.getElementById('btn-nueva-reserva');
    btnNueva.addEventListener('click', () => formulario(null));
    // Botón "Entradas del día" junto a Nueva reserva (inyectado por JS).
    if (!document.getElementById('btn-entradas-dia')) {
      const b = document.createElement('button');
      b.id = 'btn-entradas-dia';
      b.className = 'btn-sec';
      b.textContent = '🖨️ Entradas del día';
      btnNueva.insertAdjacentElement('beforebegin', b);
      b.addEventListener('click', modalEntradas);
    }

    document.getElementById('reservas-buscar').addEventListener('input', (e) => {
      busqueda = e.target.value;
      aplicarFiltros();
    });
  }

  return { init, cargar, abrirFicha };
})();
