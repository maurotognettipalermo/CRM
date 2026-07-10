// Módulo Planning: grid mensual de apartamentos x días, barras de reserva,
// drag & drop, filtro por tipo de clasificación, importación e bandeja "Sin asignar".

const Planning = (() => {
  // Vista continua de días (estilo Avantio). El nº de días visibles se calcula
  // según el ancho disponible; las columnas no se atan a un mes fijo.
  const ANCHO_DIA = 28;   // px por columna de día (debe coincidir con .dia width en el CSS)
  const CELDA_APTO = 160; // px de la columna izquierda fija (debe coincidir con .celda-apto width)
  const MIN_DIAS = 7;     // nunca mostramos menos de una semana

  let fechaInicio = hoy(); // primer día visible (Date a medianoche local)
  let fechaFin = null;     // null = modo automático (ancho de pantalla); con valor = rango fijo elegido por el usuario
  let nDias = 30;          // nº de columnas de día (recalculado según ancho, o fijo si hay fechaFin)
  let arrastrando = null;  // { reservaId }
  let resizeTimer = null;
  let portalesMap = {};    // { nombre: { color, imagen_url } } para colorear las barras

  // Filtro por tipo de clasificación (cliente, sobre los apartamentos ya cargados).
  const TIPOS_CLAS = [
    { key: 'A++', clase: 'c-app' },
    { key: 'A+', clase: 'c-ap' },
    { key: 'A', clase: 'c-a' },
    { key: 'B+', clase: 'c-bp' },
    { key: 'B', clase: 'c-b' },
    { key: 'C', clase: 'c-c' },
    { key: '__sin__', clase: null }, // Sin clasificar
  ];
  let tiposSel = new Set(TIPOS_CLAS.map((t) => t.key)); // por defecto, todos marcados
  let portalSel = null;        // id del portal seleccionado (null = todos)
  let portalesFiltroListos = false; // el select de portal ya se pobló
  let apartamentosCache = [];  // apartamentos cargados (para filtrar sin re-fetch)
  let reservasCache = [];
  let desdeCache = '';
  let menuCelda = null;            // menú contextual abierto sobre una celda vacía
  let bloqueoColor = '#7f1d1d';    // color del estado "Bloqueado" (estados_reserva); rojo oscuro por defecto
  let restriccionesActivas = [];   // [{ fecha_inicio, fecha_fin, motivo }] — bloqueo visual + banner

  // Restricción que cubre un día ISO (inclusiva en ambos extremos), o null.
  function restriccionDe(diaISO) {
    return restriccionesActivas.find((r) => r.fecha_inicio <= diaISO && diaISO <= r.fecha_fin) || null;
  }

  // Calculadora de precios (panel lateral izquierdo). Cachés de tarifas.
  let pcModificadores = null;      // [{ tipo, porcentaje }]
  const pcTempPorAnio = {};        // { anio: [{ fecha_inicio, fecha_fin, precio_base_noche }] }
  let pcPanelCreado = false;
  // Tipos de la calculadora (clase = color de badge, igual que en las fichas).
  const PC_TIPOS = [
    { tipo: 'A++', clase: 'c-app' },
    { tipo: 'A+', clase: 'c-ap' },
    { tipo: 'A', clase: 'c-a' },
    { tipo: 'B+', clase: 'c-bp' },
    { tipo: 'B', clase: 'c-b' },
    { tipo: 'C', clase: 'c-c' },
  ];
  const pcTiposSel = new Set(['A']); // por defecto solo A

  const MESES_ABREV = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const MESES_LARGO = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const DOW_LETRA = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

  // ---- Utilidades de fecha ----
  function hoy() {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }
  function iso(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }
  function addDias(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  }
  function diffDias(isoA, isoB) {
    // días enteros entre dos fechas ISO (B - A)
    const a = new Date(isoA + 'T00:00:00');
    const b = new Date(isoB + 'T00:00:00');
    return Math.round((b - a) / 86400000);
  }

  // ---- Cálculo de columnas ----
  // Cuántas columnas de día caben en el ancho disponible del contenedor.
  function calcularDias() {
    const scroll = document.querySelector('#vista-planning .planning-scroll');
    const ancho = scroll ? scroll.clientWidth : 0;
    const disponible = ancho - CELDA_APTO;
    const n = Math.floor(disponible / ANCHO_DIA);
    return Math.max(MIN_DIAS, n || MIN_DIAS);
  }

  // nº de columnas a usar: si hay un rango personalizado (fechaFin), su longitud fija;
  // si no, el cálculo automático de siempre según el ancho disponible.
  function nDiasActual() {
    if (fechaFin) return diffDias(iso(fechaInicio), iso(fechaFin)) + 1;
    return calcularDias();
  }

  // Construye la lista de columnas de día y la tabla de offsets en píxeles de
  // cada día, usada para posicionar las barras. El nombre del mes va como label
  // encima del día 1 (no es una columna del grid).
  // xDia[i] = x del día i; xDia[nDias] = ancho total del grid.
  function construirColumnas() {
    const cols = [];
    const xDia = new Array(nDias + 1);
    let x = 0;
    let mesPrev = null;
    for (let i = 0; i < nDias; i++) {
      const fecha = addDias(fechaInicio, i);
      const mes = fecha.getMonth();
      const cambioMes = mesPrev !== null && mes !== mesPrev; // frontera real de mes (día 1)
      xDia[i] = x;
      cols.push({
        tipo: 'dia',
        iso: iso(fecha),
        dia: fecha.getDate(),
        dow: fecha.getDay(),
        mes,
        anio: fecha.getFullYear(),
        cambioMes,
        // El nombre del mes va como label ENCIMA del día 1 (y del primer día visible,
        // para tener contexto). No ocupa columna del grid.
        mostrarMes: fecha.getDate() === 1 || i === 0,
      });
      x += ANCHO_DIA;
      mesPrev = mes;
    }
    xDia[nDias] = x;
    return { cols, xDia, anchoTotal: x };
  }

  // ---- Carga y render ----
  async function cargar() {
    nDias = nDiasActual();
    const desde = iso(fechaInicio);
    const hasta = iso(addDias(fechaInicio, nDias - 1)); // último día visible (inclusive)

    const [apartamentos, reservas, sinAsignar, portales, restricciones] = await Promise.all([
      API.get('/api/apartamentos'),
      API.get('/api/reservas?' + new URLSearchParams({ desde, hasta }).toString()),
      API.get('/api/reservas/sin-asignar'),
      API.getPortales(),
      API.get('/api/restricciones').catch(() => []),
    ]);

    restriccionesActivas = restricciones || [];

    portalesMap = {};
    for (const p of portales) portalesMap[p.nombre] = { color: p.color, imagen_url: p.imagen_url };
    poblarFiltroPortal(portales);

    apartamentosCache = apartamentos;
    reservasCache = reservas;
    desdeCache = desde;

    render(filtrarApartamentos(apartamentos), reservas, desde);
    renderSinAsignar(sinAsignar);
  }

  // Filtra por tipo de clasificación y por portal seleccionado (los sin clasificar -> '__sin__').
  function filtrarApartamentos(lista) {
    return lista.filter((a) =>
      tiposSel.has(a.tipo_clasificacion || '__sin__')
      && (portalSel === null || a.portal_id === portalSel));
  }

  // Re-renderiza el grid con el filtro actual, sin volver a pedir datos al backend.
  function reaplicarFiltro() {
    render(filtrarApartamentos(apartamentosCache), reservasCache, desdeCache);
  }

  function render(apartamentos, reservas, desdeISO) {
    const cont = document.getElementById('planning');
    cont.innerHTML = '';

    actualizarBannerRestricciones(desdeISO, iso(addDias(fechaInicio, nDias - 1)));

    const hoyISO = iso(hoy());
    const { cols, xDia, anchoTotal } = construirColumnas();

    // Cabecera: nº de día + letra del día de la semana + label de mes sobre el día 1.
    const cab = document.createElement('div');
    cab.className = 'fila-planning fila-cabecera';
    let cabHTML = '<div class="celda-apto">Apartamento</div>' +
      `<div class="dias" style="width:${anchoTotal}px">`;
    for (const col of cols) {
      const clases = ['dia'];
      if (col.dow === 0 || col.dow === 6) clases.push('finde');
      if (col.iso === hoyISO) clases.push('hoy');
      if (col.cambioMes) clases.push('cambio-mes');
      if (restriccionDe(col.iso)) clases.push('planning-celda-restringida');
      const mesLbl = col.mostrarMes ? `<span class="mes-label">${MESES_LARGO[col.mes]} ${col.anio}</span>` : '';
      cabHTML += `<div class="${clases.join(' ')}">${mesLbl}<span class="dia-num">${col.dia}</span><span class="dia-dow">${DOW_LETRA[col.dow]}</span></div>`;
    }
    cabHTML += '</div>';
    cab.innerHTML = cabHTML;
    cont.appendChild(cab);

    if (apartamentos.length === 0) {
      const aviso = document.createElement('div');
      aviso.style.padding = '20px';
      aviso.style.color = '#6b7280';
      aviso.textContent =
        'No hay alojamientos. Crea apartamentos en la pestaña "Alojamientos" para verlos aquí.';
      cont.appendChild(aviso);
      return;
    }

    // Agrupar reservas por apartamento.
    const porApto = {};
    for (const r of reservas) {
      if (r.apartamento_id == null) continue;
      (porApto[r.apartamento_id] = porApto[r.apartamento_id] || []).push(r);
    }

    for (const apto of apartamentos) {
      const fila = document.createElement('div');
      fila.className = 'fila-planning fila-aptos';
      fila.dataset.apartamentoId = apto.id;

      const meta = apto.edificio || '';
      const celda = document.createElement('div');
      celda.className = 'celda-apto';
      celda.innerHTML =
        `<span class="apto-nombre" data-id="${apto.id}">${esc(apto.nombre)}</span>` +
        `<span class="apto-meta">${esc(meta)}</span>`;
      celda.querySelector('.apto-nombre').addEventListener('click', () => {
        if (typeof Alojamientos !== 'undefined') Alojamientos.abrirFicha(apto.id);
      });
      fila.appendChild(celda);

      const dias = document.createElement('div');
      dias.className = 'dias';
      dias.style.width = anchoTotal + 'px';

      // celdas de fondo (rejilla, findes, columna de hoy y frontera de mes)
      for (const col of cols) {
        const c = document.createElement('div');
        c.className = 'dia' +
          (col.dow === 0 || col.dow === 6 ? ' finde' : '') +
          (col.iso === hoyISO ? ' hoy-col' : '') +
          (col.cambioMes ? ' cambio-mes' : '') +
          (restriccionDe(col.iso) ? ' planning-celda-restringida' : '');
        c.dataset.iso = col.iso;
        c.addEventListener('click', (e) => abrirMenuCelda(e, apto.id, col.iso));
        dias.appendChild(c);
      }

      // barras (posición por offset en días desde la fecha de inicio de la vista;
      // recortadas a [0, nDias] si la reserva empieza antes o acaba después)
      for (const r of porApto[apto.id] || []) {
        let startIdx = diffDias(desdeISO, r.entrada);
        let endIdx = diffDias(desdeISO, r.salida); // salida = checkout, exclusivo
        startIdx = Math.max(0, Math.min(startIdx, nDias));
        endIdx = Math.max(0, Math.min(endIdx, nDias));
        if (endIdx <= startIdx) continue;

        const left = xDia[startIdx];
        const ancho = xDia[endIdx] - left;

        const portalInfo = r.portal ? portalesMap[r.portal] : null;
        const esBloqueo = (r.tipo_reserva || '').toLowerCase() === 'bloqueado';

        const barra = document.createElement('div');
        barra.className = 'barra-reserva barra-reserva-normal' + (esBloqueo ? ' barra-bloqueo' : '');
        if (esBloqueo) {
          // Rayas diagonales con el color del estado "Bloqueado" (rojo oscuro por defecto).
          barra.style.setProperty('--bloq-color', bloqueoColor);
          barra.style.setProperty('--bloq-dark', oscurecer(bloqueoColor));
        } else if (portalInfo && portalInfo.color) {
          // Color del portal si lo tiene; si no, se queda el color neutro por defecto (clase barra-reserva-normal).
          barra.style.background = portalInfo.color;
        }
        barra.style.left = left + 1 + 'px';
        barra.style.width = ancho - 2 + 'px';
        const texto = esBloqueo ? esc(r.observaciones || 'BLOQUEADO') : esc(r.nombre_cliente || r.numero_reserva);
        const logo = !esBloqueo && portalInfo && portalInfo.imagen_url
          ? `<img class="barra-logo" src="${esc(portalInfo.imagen_url)}" alt="" onerror="this.style.display='none';this.onerror=null">`
          : '';
        barra.innerHTML = `${logo}<span class="barra-texto">${texto}</span>`;
        barra.title = `${r.nombre_cliente || ''} (${fechaES(r.entrada)} → ${fechaES(r.salida)})`;
        barra.draggable = true;
        barra.dataset.reservaId = r.id;
        barra.addEventListener('click', () => abrirFichaReserva(r.id));
        barra.addEventListener('dragstart', (e) => {
          arrastrando = { reservaId: r.id, apartamentoOrigenId: apto.id };
          e.dataTransfer.effectAllowed = 'move';
        });
        dias.appendChild(barra);
      }

      fila.appendChild(dias);
      activarDrop(fila, apto.id);
      cont.appendChild(fila);
    }
  }

  // Banner de aviso sobre las restricciones que se solapan con el rango visible.
  // Se inyecta una vez encima del scroll del planning y se actualiza al navegar.
  function actualizarBannerRestricciones(desdeISO, hastaISO) {
    let banner = document.getElementById('planning-restricciones');
    if (!banner) {
      const scroll = document.querySelector('#vista-planning .planning-scroll');
      if (!scroll) return;
      banner = document.createElement('div');
      banner.id = 'planning-restricciones';
      banner.className = 'planning-restricciones-banner oculto';
      scroll.parentNode.insertBefore(banner, scroll);
    }
    // Restricciones que solapan [desdeISO, hastaISO] (intervalos inclusivos).
    const enRango = restriccionesActivas.filter((r) => r.fecha_inicio <= hastaISO && r.fecha_fin >= desdeISO);
    if (!enRango.length) { banner.classList.add('oculto'); banner.innerHTML = ''; return; }
    const partes = enRango
      .slice()
      .sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio))
      .map((r) => `${fechaCorta(r.fecha_inicio)} al ${fechaCorta(r.fecha_fin)}${r.motivo ? ' (' + esc(r.motivo) + ')' : ''}`)
      .join(' · ');
    banner.innerHTML = `⚠️ OJO — RESTRICCIONES: ${partes}`;
    banner.classList.remove('oculto');
  }

  // ISO YYYY-MM-DD -> DD/MM (para el banner, compacto).
  function fechaCorta(isoStr) {
    const p = String(isoStr || '').split('-');
    return p.length === 3 ? `${p[2]}/${p[1]}` : String(isoStr);
  }

  // Drop sobre una fila de apartamento -> mover reserva a ese apartamento.
  function activarDrop(fila, apartamentoId) {
    fila.addEventListener('dragover', (e) => {
      if (!arrastrando) return;
      e.preventDefault();
      fila.classList.add('drop-activo');
    });
    fila.addEventListener('dragleave', () => fila.classList.remove('drop-activo'));
    fila.addEventListener('drop', async (e) => {
      e.preventDefault();
      fila.classList.remove('drop-activo');
      if (!arrastrando) return;
      const id = arrastrando.reservaId;
      const origenId = arrastrando.apartamentoOrigenId;
      arrastrando = null;
      if (origenId != null && origenId !== apartamentoId) {
        const aptoOrigen = apartamentosCache.find((a) => a.id === origenId);
        const aptoDestino = apartamentosCache.find((a) => a.id === apartamentoId);
        const tipoOrigen = aptoOrigen && aptoOrigen.tipo_clasificacion;
        const tipoDestino = aptoDestino && aptoDestino.tipo_clasificacion;
        if (tipoOrigen && tipoDestino && tipoOrigen !== tipoDestino) {
          const ok = confirm(`El apartamento de destino es tipo ${tipoDestino} y la reserva viene de un ${tipoOrigen}. ¿Quieres moverla igualmente?`);
          if (!ok) return;
        }
      }
      try {
        await API.put(`/api/reservas/${id}/mover`, { apartamento_id: apartamentoId });
        await cargar();
        toast('Reserva movida', 'ok');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  // ---- Bandeja Sin asignar ----
  function renderSinAsignar(lista) {
    const cont = document.getElementById('sin-asignar');
    const items = document.getElementById('sin-asignar-lista');
    document.getElementById('sin-asignar-conteo').textContent = `(${lista.length})`;
    items.innerHTML = '';
    if (lista.length === 0) {
      cont.classList.add('oculto');
      return;
    }
    cont.classList.remove('oculto');
    for (const r of lista) {
      const chip = document.createElement('div');
      chip.className = 'chip-reserva';
      chip.textContent = `${r.nombre_cliente || r.numero_reserva} (${fechaES(r.entrada)}→${fechaES(r.salida)})`;
      chip.draggable = true;
      chip.dataset.reservaId = r.id;
      chip.addEventListener('click', () => abrirFichaReserva(r.id));
      chip.addEventListener('dragstart', (e) => {
        arrastrando = { reservaId: r.id };
        e.dataTransfer.effectAllowed = 'move';
      });
      items.appendChild(chip);
    }
    // Permitir soltar aquí para devolver a "Sin asignar".
    cont.ondragover = (e) => {
      if (arrastrando) e.preventDefault();
    };
    cont.ondrop = async (e) => {
      e.preventDefault();
      if (!arrastrando) return;
      const id = arrastrando.reservaId;
      arrastrando = null;
      try {
        await API.put(`/api/reservas/${id}/mover`, { apartamento_id: null });
        await cargar();
        toast('Reserva devuelta a Sin asignar', 'ok');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  // ---- Ficha de reserva ----
  async function abrirFichaReserva(id) {
    let r;
    try {
      r = await API.get('/api/reservas/' + id);
    } catch (e) {
      return toast(e.message, 'error');
    }
    const html = `
      <h3>Reserva ${esc(r.numero_reserva)}</h3>
      ${dato('Cliente', r.nombre_cliente)}
      ${dato('Edificio', r.edificio)}
      ${dato('Personas', r.personas)}
      ${dato('Entrada', fechaES(r.entrada))}
      ${dato('Salida', fechaES(r.salida))}
      ${dato('Apartamento', r.apartamento_nombre || 'Sin asignar')}
      ${dato('Contrato', r.contrato)}
      ${dato('Observaciones', r.observaciones)}
      <div class="modal-acciones">
        <button class="btn-peligro" id="btn-borrar-reserva">Eliminar reserva</button>
      </div>`;
    abrirModal(html);
    document.getElementById('btn-borrar-reserva').addEventListener('click', async () => {
      if (!confirm('¿Eliminar definitivamente esta reserva?')) return;
      try {
        await API.del('/api/reservas/' + id);
        cerrarModal();
        await cargar();
        toast('Reserva eliminada', 'ok');
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  function dato(etq, val) {
    return `<div class="ficha-dato"><div class="etq">${etq}</div><div class="val">${esc(val) || '—'}</div></div>`;
  }

  // ---- Importación ----
  function configurarImportacion() {
    const btn = document.getElementById('btn-importar');
    const input = document.getElementById('input-archivo');
    btn.addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      toast('Importando archivo…', 'ok');
      try {
        const res = await API.subirArchivo('/api/importar', file);
        mostrarResumenImport(res);
        await cargar();
      } catch (e) {
        toast(e.message, 'error');
      } finally {
        input.value = '';
      }
    });
  }

  function mostrarResumenImport(res) {
    let html = `<h3>Resultado de la importación</h3>
      <p><strong>${res.nuevas}</strong> nuevas · <strong>${res.actualizadas}</strong> actualizadas · <strong>${res.errores.length}</strong> con incidencia</p>`;
    if (res.errores.length) {
      html += '<div class="resumen-import"><strong>Incidencias:</strong><ul>';
      for (const e of res.errores) {
        html += `<li class="err">Fila ${e.fila}${e.numero_reserva ? ' (Reserva ' + esc(e.numero_reserva) + ')' : ''}: ${esc(e.motivo)}</li>`;
      }
      html += '</ul></div>';
    }
    html += '<div class="modal-acciones"><button class="btn-pri" id="cerrar-resumen">Aceptar</button></div>';
    abrirModal(html);
    document.getElementById('cerrar-resumen').addEventListener('click', cerrarModal);
  }

  // ---- Filtro de clasificación (dropdown multiselección) ----
  function construirFiltroClasificacion() {
    const cont = document.getElementById('filtro-tih');
    if (!cont) return;
    cont.classList.remove('filtro-tih-btns');
    cont.classList.add('cls-filtro');
    cont.innerHTML = `
      <button type="button" class="btn-sec cls-filtro-btn" id="cls-filtro-btn" aria-haspopup="true" aria-expanded="false">
        <span id="cls-filtro-label">Tipo: Todos</span><span class="cls-flecha">▾</span>
      </button>
      <div class="cls-dropdown oculto" id="cls-dropdown">
        <div class="cls-todos" id="cls-todos"></div>
        ${TIPOS_CLAS.map((t) => `
          <label class="cls-op">
            <input type="checkbox" data-tipo="${t.key}" checked>
            ${t.key === '__sin__'
              ? '<span class="cls-op-label">Sin clasificar</span>'
              : `<span class="badge-clasif ${t.clase}">${t.key}</span>`}
          </label>`).join('')}
      </div>`;

    const btn = document.getElementById('cls-filtro-btn');
    const dd = document.getElementById('cls-dropdown');
    const abrir = (v) => {
      dd.classList.toggle('oculto', !v);
      cont.classList.toggle('abierto', v);
      btn.setAttribute('aria-expanded', v ? 'true' : 'false');
    };
    btn.addEventListener('click', (e) => { e.stopPropagation(); abrir(dd.classList.contains('oculto')); });
    dd.addEventListener('click', (e) => e.stopPropagation());
    dd.querySelectorAll('input[data-tipo]').forEach((cb) =>
      cb.addEventListener('change', () => {
        if (cb.checked) tiposSel.add(cb.dataset.tipo); else tiposSel.delete(cb.dataset.tipo);
        actualizarLabelClasif();
        actualizarToggleTodos();
        reaplicarFiltro();
      }));

    // Opción "Seleccionar / Deseleccionar todos".
    const todos = document.getElementById('cls-todos');
    todos.addEventListener('click', (e) => {
      e.stopPropagation();
      const marcar = todos.dataset.modo === 'sel'; // 'sel' -> marcar todos
      tiposSel = new Set(marcar ? TIPOS_CLAS.map((t) => t.key) : []);
      dd.querySelectorAll('input[data-tipo]').forEach((cb) => { cb.checked = marcar; });
      actualizarLabelClasif();
      actualizarToggleTodos();
      reaplicarFiltro();
    });

    document.addEventListener('click', () => abrir(false));     // cerrar al hacer clic fuera
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') abrir(false); });
    actualizarLabelClasif();
    actualizarToggleTodos();
  }

  // Texto/modo de la fila "todos" según cuántos tipos haya marcados.
  function actualizarToggleTodos() {
    const el = document.getElementById('cls-todos');
    if (!el) return;
    const todosMarcados = TIPOS_CLAS.every((t) => tiposSel.has(t.key));
    el.textContent = todosMarcados ? '✗ Deseleccionar todos' : '✓ Seleccionar todos';
    el.dataset.modo = todosMarcados ? 'des' : 'sel';
  }

  function actualizarLabelClasif() {
    const label = document.getElementById('cls-filtro-label');
    if (!label) return;
    const sel = TIPOS_CLAS.filter((t) => tiposSel.has(t.key));
    let txt;
    if (sel.length === TIPOS_CLAS.length) txt = 'Todos';
    else if (sel.length === 0) txt = 'Ninguno';
    else txt = sel.map((t) => (t.key === '__sin__' ? 'Sin clasificar' : t.key)).join(', ');
    label.textContent = 'Tipo: ' + txt;
  }

  // ---- Filtro de portal (select, sobre los apartamentos ya cargados) ----
  function construirFiltroPortal() {
    const filtros = document.querySelector('#vista-planning .filtros');
    if (!filtros || document.getElementById('filtro-portal')) return;
    const sel = document.createElement('select');
    sel.id = 'filtro-portal';
    sel.className = 'select-filtro';
    sel.innerHTML = '<option value="">Todos los portales</option>';
    // Insertar tras el filtro de clasificación (antes del botón Importar).
    const importar = document.getElementById('btn-importar');
    if (importar) filtros.insertBefore(sel, importar); else filtros.appendChild(sel);
    sel.addEventListener('change', () => {
      portalSel = sel.value ? Number(sel.value) : null;
      reaplicarFiltro();
    });
  }

  // Rellena las opciones del select con los portales activos (una sola vez).
  function poblarFiltroPortal(portales) {
    const sel = document.getElementById('filtro-portal');
    if (!sel || portalesFiltroListos) return;
    const activos = (portales || []).filter((p) => p.activo == null || p.activo);
    for (const p of activos) {
      const op = document.createElement('option');
      op.value = p.id;
      op.textContent = p.nombre;
      sel.appendChild(op);
    }
    portalesFiltroListos = true;
  }

  // ---- Menú contextual de celda vacía + creación de reserva/bloqueo ----
  function isoMas(isoStr, n) {
    const d = new Date(isoStr + 'T00:00:00');
    return iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
  }

  // Oscurece un color hex (#rrggbb) multiplicando sus canales (para la banda de las rayas).
  function oscurecer(hex, f = 0.62) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#5a1414';
    const n = parseInt(m[1], 16);
    const r = Math.round(((n >> 16) & 255) * f);
    const g = Math.round(((n >> 8) & 255) * f);
    const b = Math.round((n & 255) * f);
    return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  function cerrarMenuCelda() {
    if (!menuCelda) return;
    menuCelda.remove();
    menuCelda = null;
    document.removeEventListener('click', cerrarMenuCelda);
    document.removeEventListener('keydown', escMenuCelda);
  }
  function escMenuCelda(e) { if (e.key === 'Escape') cerrarMenuCelda(); }

  function abrirMenuCelda(ev, aptoId, fechaIso) {
    ev.stopPropagation();
    cerrarMenuCelda();
    const m = document.createElement('div');
    m.className = 'planning-ctx-menu';
    m.innerHTML = `
      <button type="button" class="pcm-op" data-acc="reserva">📋 Crear reserva</button>
      <button type="button" class="pcm-op" data-acc="bloqueo">🔒 Crear bloqueo</button>`;
    document.body.appendChild(m);
    // Posición junto al cursor, ajustada si se sale de la pantalla.
    let x = ev.clientX + 4;
    let y = ev.clientY + 4;
    if (x + m.offsetWidth > window.innerWidth) x = window.innerWidth - m.offsetWidth - 8;
    if (y + m.offsetHeight > window.innerHeight) y = window.innerHeight - m.offsetHeight - 8;
    m.style.left = Math.max(4, x) + 'px';
    m.style.top = Math.max(4, y) + 'px';
    m.querySelector('[data-acc="reserva"]').addEventListener('click', (e) => { e.stopPropagation(); cerrarMenuCelda(); crearReservaEn(aptoId, fechaIso); });
    m.querySelector('[data-acc="bloqueo"]').addEventListener('click', (e) => { e.stopPropagation(); cerrarMenuCelda(); modalBloqueo(aptoId, fechaIso); });
    menuCelda = m;
    setTimeout(() => {
      document.addEventListener('click', cerrarMenuCelda);
      document.addEventListener('keydown', escMenuCelda);
    }, 0);
  }

  // Espera (con reintentos) a que exista un elemento por id y ejecuta cb.
  function esperarElemento(id, intentos, cb) {
    const el = document.getElementById(id);
    if (el) return cb(el);
    if (intentos <= 0) return;
    setTimeout(() => esperarElemento(id, intentos - 1, cb), 40);
  }

  // Abre el modal de Nueva reserva (módulo Reservas) y preselecciona apto + fechas.
  function crearReservaEn(aptoId, fechaIso) {
    const btn = document.getElementById('btn-nueva-reserva');
    if (!btn) return toast('No se pudo abrir Nueva reserva', 'error');
    btn.click(); // dispara formularioNuevo() del módulo Reservas
    const salidaIso = isoMas(fechaIso, 7);
    const apto = apartamentosCache.find((a) => a.id === aptoId);
    esperarElemento('f-entrada', 40, () => {
      const ent = document.getElementById('f-entrada');
      const sal = document.getElementById('f-salida');
      const aptoHidden = document.getElementById('f-apartamento-id');
      const aptoInput = document.getElementById('rsv-apto-input');
      if (ent) ent.value = fechaIso;
      if (sal) sal.value = salidaIso;
      if (aptoHidden) aptoHidden.value = aptoId;
      if (aptoInput && apto) aptoInput.value = apto.nombre;
      // Disparar el recálculo de noches/disponibilidad/tarifa del formulario.
      if (ent) ent.dispatchEvent(new Event('change'));
    });
  }

  // Modal "Crear bloqueo": fechas + selección múltiple de apartamentos + motivo.
  function modalBloqueo(aptoPre, fechaIso) {
    const aptos = apartamentosCache.slice();
    const sel = new Set(aptoPre != null ? [aptoPre] : []);
    const finIso = isoMas(fechaIso, 1);

    abrirModal(`
      <h3>Crear bloqueo</h3>
      <div class="blq-sec-tit">Fechas</div>
      <div class="fila-campos">
        <div class="campo"><label>Fecha inicio *</label><input type="date" id="blq-inicio" value="${fechaIso}"></div>
        <div class="campo"><label>Fecha fin *</label><input type="date" id="blq-fin" value="${finIso}"></div>
      </div>
      <span id="blq-noches" class="blq-noches"></span>
      <div class="blq-sec-tit">Apartamentos</div>
      <input id="blq-buscar" class="input-buscar" autocomplete="off" placeholder="Buscar apartamento...">
      <div class="blq-toolbar">
        <button type="button" class="btn-sec" id="blq-sel-todos">Seleccionar todos</button>
        <button type="button" class="btn-sec" id="blq-desel">Deseleccionar todos</button>
        <span class="blq-conteo" id="blq-conteo"></span>
      </div>
      <div class="blq-lista" id="blq-lista"></div>
      <div class="blq-sec-tit">Motivo (opcional)</div>
      <textarea id="blq-motivo" placeholder="Uso propietario, Obras, Mantenimiento..."></textarea>
      <div id="blq-progreso" class="blq-progreso oculto">
        <div class="blq-prog-barra"><div class="blq-prog-fill" id="blq-prog-fill"></div></div>
        <span class="blq-prog-txt" id="blq-prog-txt"></span>
      </div>
      <div class="modal-acciones">
        <button class="btn-sec" id="blq-cancelar">Cancelar</button>
        <button class="btn-pri" id="blq-crear">🔒 Crear bloqueo</button>
      </div>`);

    const lista = document.getElementById('blq-lista');
    const conteo = document.getElementById('blq-conteo');
    const buscar = document.getElementById('blq-buscar');

    const visibles = () => {
      const q = buscar.value.trim().toLowerCase();
      return aptos.filter((a) => (a.nombre || '').toLowerCase().includes(q));
    };
    const pintarLista = () => {
      lista.innerHTML = visibles().map((a) => `
        <label class="blq-op">
          <input type="checkbox" value="${a.id}"${sel.has(a.id) ? ' checked' : ''}>
          <span>${esc(a.nombre)}${a.edificio ? ` <span class="blq-meta">${esc(a.edificio)}</span>` : ''}</span>
        </label>`).join('') || '<div class="blq-vacio">Sin resultados</div>';
      lista.querySelectorAll('input[type="checkbox"]').forEach((cb) =>
        cb.addEventListener('change', () => {
          const id = Number(cb.value);
          if (cb.checked) sel.add(id); else sel.delete(id);
          actualizarConteo();
        }));
    };
    const actualizarConteo = () => { conteo.textContent = `${sel.size} apartamento${sel.size === 1 ? '' : 's'} seleccionado${sel.size === 1 ? '' : 's'}`; };
    const actualizarNoches = () => {
      const ini = document.getElementById('blq-inicio').value;
      const fin = document.getElementById('blq-fin').value;
      const n = ini && fin ? diffDias(ini, fin) : 0;
      const el = document.getElementById('blq-noches');
      el.textContent = n > 0 ? `${n} noche${n === 1 ? '' : 's'}` : '';
    };

    buscar.addEventListener('input', pintarLista);
    document.getElementById('blq-sel-todos').addEventListener('click', () => { visibles().forEach((a) => sel.add(a.id)); pintarLista(); actualizarConteo(); });
    document.getElementById('blq-desel').addEventListener('click', () => { visibles().forEach((a) => sel.delete(a.id)); pintarLista(); actualizarConteo(); });
    ['blq-inicio', 'blq-fin'].forEach((id) => document.getElementById(id).addEventListener('change', actualizarNoches));
    document.getElementById('blq-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('blq-crear').addEventListener('click', () => crearBloqueo(sel));

    pintarLista();
    actualizarConteo();
    actualizarNoches();
  }

  async function crearBloqueo(sel) {
    const inicio = document.getElementById('blq-inicio').value;
    const fin = document.getElementById('blq-fin').value;
    if (!inicio || !fin) return toast('Indica fecha inicio y fin', 'error');
    if (diffDias(inicio, fin) <= 0) return toast('La fecha fin debe ser posterior a la de inicio', 'error');
    if (sel.size === 0) return toast('Selecciona al menos un apartamento', 'error');

    const motivo = document.getElementById('blq-motivo').value.trim();
    const ids = [...sel];
    const btn = document.getElementById('blq-crear');
    btn.disabled = true;
    const prog = document.getElementById('blq-progreso');
    const fill = document.getElementById('blq-prog-fill');
    const txt = document.getElementById('blq-prog-txt');
    prog.classList.remove('oculto');

    let ok = 0;
    for (let i = 0; i < ids.length; i++) {
      txt.textContent = `Creando bloqueo ${i + 1} de ${ids.length}...`;
      fill.style.width = Math.round((i / ids.length) * 100) + '%';
      try {
        await API.post('/api/reservas', {
          numero_reserva: '', nombre_cliente: 'BLOQUEADO', portal: '',
          apartamento_id: ids[i], entrada: inicio, salida: fin,
          tipo_reserva: 'Bloqueado', observaciones: motivo,
        });
        ok++;
      } catch (e) { /* continúa con el resto */ }
    }
    fill.style.width = '100%';
    cerrarModal();
    await cargar();
    toast(`${ok} bloqueo${ok === 1 ? '' : 's'} creado${ok === 1 ? '' : 's'}`, ok ? 'ok' : 'error');
  }

  // ---- Init ----
  function sincronizarInput() {
    const input = document.getElementById('fecha-inicio');
    if (input) input.value = iso(fechaInicio);
    const inputFin = document.getElementById('fecha-fin');
    if (inputFin) inputFin.value = fechaFin ? iso(fechaFin) : '';
    const btnLimpiar = document.getElementById('fecha-fin-limpiar');
    if (btnLimpiar) btnLimpiar.classList.toggle('oculto', !fechaFin);
  }

  function init() {
    const inputFecha = document.getElementById('fecha-inicio');
    sincronizarInput();
    inputFecha.addEventListener('change', () => {
      if (!inputFecha.value) return;
      const [y, m, d] = inputFecha.value.split('-').map(Number);
      fechaInicio = new Date(y, m - 1, d);
      cargar();
    });

    const inputFin = document.getElementById('fecha-fin');
    inputFin.addEventListener('change', () => {
      if (!inputFin.value) return;
      const [y, m, d] = inputFin.value.split('-').map(Number);
      const nueva = new Date(y, m - 1, d);
      if (nueva < fechaInicio) {
        toast('La fecha fin no puede ser anterior a la fecha inicio', 'error');
        sincronizarInput();
        return;
      }
      fechaFin = nueva;
      sincronizarInput();
      cargar();
    });
    document.getElementById('fecha-fin-limpiar').addEventListener('click', () => {
      fechaFin = null;
      sincronizarInput();
      cargar();
    });

    document.getElementById('nav-anterior').addEventListener('click', () => {
      fechaInicio = addDias(fechaInicio, -7);
      if (fechaFin) fechaFin = addDias(fechaFin, -7);
      sincronizarInput();
      cargar();
    });
    document.getElementById('nav-siguiente').addEventListener('click', () => {
      fechaInicio = addDias(fechaInicio, 7);
      if (fechaFin) fechaFin = addDias(fechaFin, 7);
      sincronizarInput();
      cargar();
    });
    document.getElementById('nav-hoy').addEventListener('click', () => {
      const longitud = fechaFin ? diffDias(iso(fechaInicio), iso(fechaFin)) : null;
      fechaInicio = hoy();
      if (fechaFin) fechaFin = addDias(fechaInicio, longitud);
      sincronizarInput();
      cargar();
    });

    construirFiltroClasificacion();
    construirFiltroPortal();

    // Color del estado "Bloqueado" para las barras de bloqueo (no bloquea el render).
    API.get('/api/ajustes/estados-reserva').then((ests) => {
      const b = (ests || []).find((e) => (e.nombre || '').toLowerCase() === 'bloqueado');
      if (b && b.color) bloqueoColor = b.color;
    }).catch(() => { /* se mantiene el rojo oscuro por defecto */ });

    // Recalcular el nº de días visibles cuando cambia el ancho del contenedor.
    // Con un rango personalizado activo (fechaFin), el nº de columnas lo manda el rango
    // elegido, no el ancho de pantalla: no se recalcula por resize, el usuario hace scroll.
    nDias = nDiasActual();
    const scroll = document.querySelector('#vista-planning .planning-scroll');
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (fechaFin) return;
        if (calcularDias() !== nDias) cargar();
      }, 150);
    };
    if (scroll && 'ResizeObserver' in window) {
      new ResizeObserver(onResize).observe(scroll);
    } else {
      window.addEventListener('resize', onResize);
    }

    configurarImportacion();
    inyectarBotonPrecios();
  }

  // ==================== Calculadora de precios (panel lateral) ====================

  // Formato europeo garantizado: miles con punto, decimales con coma → "1.210,00 €".
  function eurosPC(n) {
    const num = Number(n) || 0;
    const [ent, dec] = num.toFixed(2).split('.');
    const miles = ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${miles},${dec} €`;
  }

  // Inyecta el botón "💲 Precios" en la barra de controles (idempotente).
  function inyectarBotonPrecios() {
    const filtros = document.querySelector('#vista-planning .barra-herramientas .filtros');
    if (!filtros || document.getElementById('btn-precios')) return;
    const btn = document.createElement('button');
    btn.id = 'btn-precios';
    btn.className = 'btn-sec';
    btn.textContent = '💲 Precios';
    btn.addEventListener('click', abrirPanelPrecios);
    filtros.insertBefore(btn, filtros.firstChild);
  }

  // Crea el panel lateral una sola vez (overlay fixed, fuera de <main>).
  function crearPanelPrecios() {
    if (pcPanelCreado) return;
    pcPanelCreado = true;
    const panel = document.createElement('aside');
    panel.id = 'pc-panel';
    panel.className = 'pc-panel';
    const pills = PC_TIPOS.map((t) =>
      `<button type="button" class="pc-pill ${t.clase}${pcTiposSel.has(t.tipo) ? ' sel' : ''}" data-tipo="${t.tipo}">${t.tipo}</button>`
    ).join('');
    panel.innerHTML = `
      <div class="pc-head">
        <span class="pc-titulo">Calculadora de precios</span>
        <button class="pc-cerrar" id="pc-cerrar" title="Cerrar">&times;</button>
      </div>
      <div class="pc-cuerpo">
        <div class="pc-campo">
          <span>Tipo de apartamento</span>
          <div class="pc-pills" id="pc-tipos">${pills}</div>
        </div>
        <label class="pc-campo">
          <span>Fecha entrada</span>
          <input type="date" id="pc-entrada">
        </label>
        <label class="pc-campo">
          <span>Fecha salida</span>
          <input type="date" id="pc-salida">
        </label>
        <button type="button" class="pc-limpiar" id="pc-limpiar">Limpiar selección</button>
        <div class="pc-sep"></div>
        <div class="pc-resultado" id="pc-resultado"></div>
      </div>`;
    document.body.appendChild(panel);

    panel.querySelector('#pc-cerrar').addEventListener('click', cerrarPanelPrecios);
    panel.querySelectorAll('#pc-tipos .pc-pill').forEach((p) =>
      p.addEventListener('click', () => {
        const t = p.dataset.tipo;
        if (pcTiposSel.has(t)) pcTiposSel.delete(t); else pcTiposSel.add(t);
        p.classList.toggle('sel');
        calcularPrecioPanel();
      }));
    ['change', 'input'].forEach((ev) => {
      panel.querySelector('#pc-entrada').addEventListener(ev, calcularPrecioPanel);
      panel.querySelector('#pc-salida').addEventListener(ev, calcularPrecioPanel);
    });
    panel.querySelector('#pc-limpiar').addEventListener('click', limpiarCalculadora);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panel.classList.contains('abierto')) cerrarPanelPrecios();
    });
  }

  function abrirPanelPrecios() {
    crearPanelPrecios();
    document.getElementById('pc-panel').classList.add('abierto');
    // Pre-carga los modificadores (una vez); las temporadas se cargan por año al calcular.
    if (!pcModificadores) {
      API.get('/api/tarifas/modificadores')
        .then((m) => { pcModificadores = m || []; calcularPrecioPanel(); })
        .catch(() => { pcModificadores = []; });
    }
  }

  function cerrarPanelPrecios() {
    const p = document.getElementById('pc-panel');
    if (p) p.classList.remove('abierto');
  }

  // Restablece la calculadora a los valores por defecto (solo tipo A, sin fechas).
  function limpiarCalculadora() {
    pcTiposSel.clear();
    pcTiposSel.add('A');
    document.querySelectorAll('#pc-tipos .pc-pill').forEach((p) =>
      p.classList.toggle('sel', p.dataset.tipo === 'A'));
    const e = document.getElementById('pc-entrada');
    const s = document.getElementById('pc-salida');
    if (e) e.value = '';
    if (s) s.value = '';
    const r = document.getElementById('pc-resultado');
    if (r) r.innerHTML = '';
  }

  // Asegura tener en caché las temporadas de un año (devuelve la lista).
  async function temporadasDeAnio(anio) {
    if (pcTempPorAnio[anio]) return pcTempPorAnio[anio];
    try { pcTempPorAnio[anio] = await API.get('/api/tarifas/temporadas?anio=' + anio); }
    catch (e) { pcTempPorAnio[anio] = []; }
    return pcTempPorAnio[anio];
  }

  // ISO (YYYY-MM-DD) -> "DD/MM" para la cabecera del resultado.
  function pcCorta(d) {
    const p = String(d).split('-');
    return p.length === 3 ? `${p[2]}/${p[1]}` : d;
  }

  // Calcula el total en el frontend para cada tipo seleccionado: por cada noche busca la
  // temporada que la cubre y aplica el modificador del tipo (base × (1 + porcentaje/100)).
  async function calcularPrecioPanel() {
    const cont = document.getElementById('pc-resultado');
    if (!cont) return;
    const entrada = document.getElementById('pc-entrada').value;
    const salida = document.getElementById('pc-salida').value;

    if (!entrada || !salida) { cont.innerHTML = ''; return; }
    if (!pcTiposSel.size) {
      cont.innerHTML = '<div class="pc-aviso">Selecciona al menos un tipo de apartamento</div>';
      return;
    }
    const noches = diffDias(entrada, salida);
    if (noches <= 0) {
      cont.innerHTML = '<div class="pc-aviso">⚠️ La fecha de salida debe ser posterior a la de entrada</div>';
      return;
    }

    if (!pcModificadores) pcModificadores = await API.get('/api/tarifas/modificadores').catch(() => []);

    // Pre-carga las temporadas de todos los años que toca la estancia.
    const anios = new Set();
    for (let i = 0; i < noches; i++) {
      anios.add(addDias(new Date(entrada + 'T00:00:00'), i).getFullYear());
    }
    for (const a of anios) await temporadasDeAnio(a);

    // Precio base de cada noche (null si no hay temporada).
    const bases = [];
    let sinTarifa = 0;
    for (let i = 0; i < noches; i++) {
      const dia = addDias(new Date(entrada + 'T00:00:00'), i);
      const diaISO = iso(dia);
      const temps = pcTempPorAnio[dia.getFullYear()] || [];
      const t = temps.find((x) => x.fecha_inicio <= diaISO && diaISO <= x.fecha_fin);
      if (!t) { sinTarifa++; bases.push(null); } else bases.push(Number(t.precio_base_noche) || 0);
    }

    // Una card por tipo seleccionado, en el orden A++ … C.
    const filas = PC_TIPOS.filter((t) => pcTiposSel.has(t.tipo)).map((t) => {
      const mod = (pcModificadores || []).find((m) => m.tipo === t.tipo);
      const pct = mod ? Number(mod.porcentaje) || 0 : 0;
      let total = 0;
      let conTarifa = 0;
      bases.forEach((b) => { if (b != null) { total += b * (1 + pct / 100); conTarifa++; } });
      const porNoche = conTarifa ? Math.round(total / conTarifa) : 0;
      return `
        <div class="pc-card">
          <span class="badge-clasif ${t.clase} pc-card-badge">${t.tipo}</span>
          <span class="pc-card-total">${eurosPC(total)}</span>
          <span class="pc-card-noche">${porNoche} €/noche</span>
        </div>`;
    }).join('');

    const aviso = sinTarifa > 0
      ? `<div class="pc-aviso">⚠️ Hay días sin tarifa configurada (${sinTarifa} de ${noches})</div>`
      : '';
    cont.innerHTML = `
      <div class="pc-res-cab"><span class="pc-luna">🌙</span> ${noches} noche${noches === 1 ? '' : 's'} · ${pcCorta(entrada)} → ${pcCorta(salida)}</div>
      <div class="pc-cards">${filas}</div>
      ${aviso}`;
  }

  return { init, cargar };
})();
