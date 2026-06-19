// Módulo Planning: grid mensual de apartamentos x días, barras de reserva,
// drag & drop, filtro por TIH, importación e bandeja "Sin asignar".

const Planning = (() => {
  // Vista continua de días (estilo Avantio). El nº de días visibles se calcula
  // según el ancho disponible; las columnas no se atan a un mes fijo.
  const ANCHO_DIA = 28;   // px por columna de día (debe coincidir con .dia width en el CSS)
  const ANCHO_SEP = 32;   // px por columna separadora de mes (debe coincidir con .col-sep-mes width)
  const CELDA_APTO = 160; // px de la columna izquierda fija (debe coincidir con .celda-apto width)
  const MIN_DIAS = 7;     // nunca mostramos menos de una semana

  let fechaInicio = hoy(); // primer día visible (Date a medianoche local)
  let nDias = 30;          // nº de columnas de día (recalculado según ancho)
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

  const MESES_ABREV = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
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

  // Construye la lista de columnas (días + separadores de mes) y la tabla de
  // offsets en píxeles de cada día, usada para posicionar las barras.
  // xDia[i] = x del día i; xDia[nDias] = ancho total del grid.
  function construirColumnas() {
    const cols = [];
    const xDia = new Array(nDias + 1);
    let x = 0;
    let mesPrev = null;
    for (let i = 0; i < nDias; i++) {
      const fecha = addDias(fechaInicio, i);
      const mes = fecha.getMonth();
      const cambioMes = mesPrev !== null && mes !== mesPrev;
      if (cambioMes) {
        // Columna separadora decorativa (no cuenta como día).
        cols.push({ tipo: 'sep', etiqueta: MESES_ABREV[mes] });
        x += ANCHO_SEP;
      }
      xDia[i] = x;
      cols.push({
        tipo: 'dia',
        iso: iso(fecha),
        dia: fecha.getDate(),
        dow: fecha.getDay(),
        cambioMes,
      });
      x += ANCHO_DIA;
      mesPrev = mes;
    }
    xDia[nDias] = x;
    return { cols, xDia, anchoTotal: x };
  }

  // ---- Carga y render ----
  async function cargar() {
    nDias = calcularDias();
    const desde = iso(fechaInicio);
    const hasta = iso(addDias(fechaInicio, nDias - 1)); // último día visible (inclusive)

    const [apartamentos, reservas, sinAsignar, portales] = await Promise.all([
      API.get('/api/apartamentos'),
      API.get('/api/reservas?' + new URLSearchParams({ desde, hasta }).toString()),
      API.get('/api/reservas/sin-asignar'),
      API.getPortales(),
    ]);

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

    const hoyISO = iso(hoy());
    const { cols, xDia, anchoTotal } = construirColumnas();

    // Cabecera: nº de día + letra del día de la semana, con separadores de mes.
    const cab = document.createElement('div');
    cab.className = 'fila-planning fila-cabecera';
    let cabHTML = '<div class="celda-apto">Apartamento</div>' +
      `<div class="dias" style="width:${anchoTotal}px">`;
    for (const col of cols) {
      if (col.tipo === 'sep') {
        cabHTML += `<div class="col-sep-mes">${col.etiqueta}</div>`;
        continue;
      }
      const clases = ['dia'];
      if (col.dow === 0 || col.dow === 6) clases.push('finde');
      if (col.iso === hoyISO) clases.push('hoy');
      if (col.cambioMes) clases.push('cambio-mes');
      cabHTML += `<div class="${clases.join(' ')}">${col.dia}<br>${DOW_LETRA[col.dow]}</div>`;
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

      const meta = [apto.edificio, tihTexto(apto.tipo)].filter(Boolean).join(' · ');
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

      // celdas de fondo (rejilla, findes, columna de hoy y separadores de mes)
      for (const col of cols) {
        if (col.tipo === 'sep') {
          const s = document.createElement('div');
          s.className = 'col-sep-mes-row';
          dias.appendChild(s);
          continue;
        }
        const c = document.createElement('div');
        c.className = 'dia' +
          (col.dow === 0 || col.dow === 6 ? ' finde' : '') +
          (col.iso === hoyISO ? ' hoy-col' : '') +
          (col.cambioMes ? ' cambio-mes' : '');
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

        const barra = document.createElement('div');
        barra.className = 'barra-reserva tih-' + (r.tih || '1');
        // Color del portal si lo tiene; si no, el color por TIH (clase tih-1/tih-2).
        if (portalInfo && portalInfo.color) barra.style.background = portalInfo.color;
        barra.style.left = left + 1 + 'px';
        barra.style.width = ancho - 2 + 'px';
        const texto = esc(r.nombre_cliente || r.numero_reserva);
        const logo = portalInfo && portalInfo.imagen_url
          ? `<img class="barra-logo" src="${esc(portalInfo.imagen_url)}" alt="" onerror="this.style.display='none';this.onerror=null">`
          : '';
        barra.innerHTML = `${logo}<span class="barra-texto">${texto}</span>`;
        barra.title = `${r.nombre_cliente || ''} (${fechaES(r.entrada)} → ${fechaES(r.salida)})`;
        barra.draggable = true;
        barra.dataset.reservaId = r.id;
        barra.addEventListener('click', () => abrirFichaReserva(r.id));
        barra.addEventListener('dragstart', (e) => {
          arrastrando = { reservaId: r.id };
          e.dataTransfer.effectAllowed = 'move';
        });
        dias.appendChild(barra);
      }

      fila.appendChild(dias);
      activarDrop(fila, apto.id);
      cont.appendChild(fila);
    }
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
      arrastrando = null;
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
      chip.textContent = `${r.nombre_cliente || r.numero_reserva} (${tihTexto(r.tih)}, ${fechaES(r.entrada)}→${fechaES(r.salida)})`;
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
      ${dato('TIH', tihTexto(r.tih))}
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

  // ---- Filtro de clasificación (dropdown multiselección, reemplaza los botones TIH) ----
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

  // ---- Init ----
  function sincronizarInput() {
    const input = document.getElementById('fecha-inicio');
    if (input) input.value = iso(fechaInicio);
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

    document.getElementById('nav-anterior').addEventListener('click', () => {
      fechaInicio = addDias(fechaInicio, -7);
      sincronizarInput();
      cargar();
    });
    document.getElementById('nav-siguiente').addEventListener('click', () => {
      fechaInicio = addDias(fechaInicio, 7);
      sincronizarInput();
      cargar();
    });
    document.getElementById('nav-hoy').addEventListener('click', () => {
      fechaInicio = hoy();
      sincronizarInput();
      cargar();
    });

    construirFiltroClasificacion();
    construirFiltroPortal();

    // Recalcular el nº de días visibles cuando cambia el ancho del contenedor.
    nDias = calcularDias();
    const scroll = document.querySelector('#vista-planning .planning-scroll');
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (calcularDias() !== nDias) cargar();
      }, 150);
    };
    if (scroll && 'ResizeObserver' in window) {
      new ResizeObserver(onResize).observe(scroll);
    } else {
      window.addEventListener('resize', onResize);
    }

    configurarImportacion();
  }

  return { init, cargar };
})();
