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
    const tih = document.querySelector('#filtro-tih .activo').dataset.val;

    const qs = (extra) => {
      const p = new URLSearchParams();
      if (tih) p.set('tih', tih);
      for (const [k, v] of Object.entries(extra || {})) p.set(k, v);
      return p.toString();
    };

    const [apartamentos, reservas, sinAsignar, portales] = await Promise.all([
      API.get('/api/apartamentos?' + qs()),
      API.get('/api/reservas?' + qs({ desde, hasta })),
      API.get('/api/reservas/sin-asignar?' + qs()),
      API.getPortales(),
    ]);

    portalesMap = {};
    for (const p of portales) portalesMap[p.nombre] = { color: p.color, imagen_url: p.imagen_url };

    render(apartamentos, reservas, desde);
    renderSinAsignar(sinAsignar);
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

    document.querySelectorAll('#filtro-tih .btn-filtro-tih').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#filtro-tih .btn-filtro-tih').forEach(b => b.classList.remove('activo'));
        btn.classList.add('activo');
        cargar();
      });
    });

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
