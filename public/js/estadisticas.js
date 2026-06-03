// Módulo Estadísticas (solo administradores). Cabecera con selector de año + sub-pestañas
// (Ingresos por portal / por apartamento / Ocupación). La sección "Ingresos por portal"
// carga datos reales de GET /api/estadisticas/portales; el resto son placeholders todavía.
// Patrón IIFE con init() + cargar(), como Dashboard.

const Estadisticas = (() => {
  // Sub-secciones: clave -> etiqueta visible.
  const SECCIONES = {
    portal:      'Ingresos por portal',
    apartamento: 'Ingresos por apartamento',
    ocupacion:   'Ocupación',
    propietario: 'Propietarios',
  };
  const ANIOS = [2024, 2025, 2026];

  let seccionActiva = 'portal';
  let anio = new Date().getFullYear();
  let reqSeq = 0; // descarta respuestas obsoletas si se cambia de año/sección rápido

  // Estado de "Ingresos por apartamento": apartamento abierto en detalle (null = vista
  // general), texto del buscador y caché de la vista general (para filtrar sin recargar).
  let aptoSel = null;
  let aptoBuscar = '';
  let aptoCache = null;

  // Estado de "Propietarios": texto del buscador y caché de la respuesta del año.
  let propBuscar = '';
  let propCache = null;

  // ---- Formato ----
  function euro(n) {
    return (Number(n) || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }
  function num(n) {
    return (Number(n) || 0).toLocaleString('es-ES');
  }

  // ---- Placeholder de "Próximamente" (secciones aún sin datos reales) ----
  function placeholderHTML(nombre) {
    return `
      <div class="est-placeholder">
        <span class="est-placeholder-icono">📊</span>
        <p class="est-placeholder-texto">Próximamente — ${esc(nombre)}</p>
      </div>`;
  }

  // ==================== Ingresos por portal ====================

  // Tarjeta de resumen (estilo dashboard): icono de color + valor grande + etiqueta.
  function tarjetaResumen({ icono, color, valor, label }) {
    return `
      <div class="est-card">
        <span class="est-card-icono" style="background:${color}">${icono}</span>
        <div class="est-card-info">
          <div class="est-card-valor">${valor}</div>
          <div class="est-card-label">${esc(label)}</div>
        </div>
      </div>`;
  }

  // Celda de logo/color del portal (logo si existe; si no, círculo del color).
  function celdaPortal(p) {
    if (p.imagen_url) {
      return `<img class="portal-cel-logo" src="${esc(p.imagen_url)}" alt="" onerror="this.style.display='none'">`;
    }
    const color = p.color || '#9ca3af';
    return `<span class="portal-cel-color" style="background:${esc(color)}"></span>`;
  }

  // Barra de progreso (ancho = % del total; color del portal).
  function barra(pct, color) {
    const ancho = Math.max(0, Math.min(100, pct));
    return `
      <div class="est-pct">
        <span class="est-pct-num">${pct.toFixed(1)}%</span>
        <span class="est-barra"><span class="est-barra-fill" style="width:${ancho}%;background:${esc(color || '#9ca3af')}"></span></span>
      </div>`;
  }

  function portalesHTML(data) {
    const { portales = [], resumen = {} } = data || {};

    const cards = `
      <div class="est-cards">
        ${tarjetaResumen({ icono: '📋', color: '#3b82f6', valor: num(resumen.total_reservas), label: 'Total reservas' })}
        ${tarjetaResumen({ icono: '💰', color: '#10b981', valor: euro(resumen.ingresos_cobrados), label: 'Ingresos netos' })}
      </div>`;

    if (!portales.length) {
      return cards + `<div class="est-vacio">Sin reservas registradas para ${anio}</div>`;
    }

    const totalCobrados = Number(resumen.ingresos_cobrados) || 0;
    const filas = portales.map((p) => {
      const pct = totalCobrados > 0 ? (Number(p.ingresos_cobrados) / totalCobrados) * 100 : 0;
      return `
        <tr>
          <td class="est-col-logo">${celdaPortal(p)}</td>
          <td>${esc(p.portal)}</td>
          <td class="num">${num(p.total_reservas)}</td>
          <td class="num">${num(p.noches_totales)}</td>
          <td class="num">${euro(p.ingresos_cobrados)}</td>
          <td class="est-col-pct">${barra(pct, p.color)}</td>
        </tr>`;
    }).join('');

    const totales = `
      <tr class="est-fila-total">
        <td></td>
        <td>Total</td>
        <td class="num">${num(resumen.total_reservas)}</td>
        <td class="num">${num(portales.reduce((s, p) => s + (Number(p.noches_totales) || 0), 0))}</td>
        <td class="num">${euro(resumen.ingresos_cobrados)}</td>
        <td class="est-col-pct">100%</td>
      </tr>`;

    return cards + `
      <div class="tabla-scroll">
        <table class="tabla est-tabla">
          <thead>
            <tr>
              <th class="est-col-logo"></th>
              <th>Portal</th>
              <th class="num">Reservas</th>
              <th class="num">Noches</th>
              <th class="num">Ingresos netos</th>
              <th class="est-col-pct">% del total</th>
            </tr>
          </thead>
          <tbody>${filas}</tbody>
          <tfoot>${totales}</tfoot>
        </table>
      </div>`;
  }

  function skeletonCarga(nCards = 2) {
    const card = '<div class="est-card"><span class="skeleton sk-icono"></span><div class="est-card-info" style="flex:1"><span class="skeleton sk-linea" style="width:50%"></span><span class="skeleton sk-linea" style="width:70%;margin-top:8px"></span></div></div>';
    const filas = '<span class="skeleton sk-bloque"></span>'.repeat(5);
    return `<div class="est-cards">${card.repeat(nCards)}</div><div class="est-skeleton-tabla">${filas}</div>`;
  }

  function errorHTML(msg) {
    return `
      <div class="est-error">
        <p>No se pudieron cargar las estadísticas.</p>
        <p class="est-error-msg">${esc(msg)}</p>
        <button class="btn-pri" data-reintentar="1">Reintentar</button>
      </div>`;
  }

  async function renderPortales(panel) {
    panel.innerHTML = skeletonCarga(2);
    const seq = ++reqSeq;
    let data;
    try {
      data = await API.get(`/api/estadisticas/portales?anio=${anio}`);
    } catch (e) {
      if (seq !== reqSeq) return; // respuesta obsoleta
      panel.innerHTML = errorHTML(e.message);
      const btn = panel.querySelector('[data-reintentar]');
      if (btn) btn.addEventListener('click', () => renderPortales(panel));
      return;
    }
    if (seq !== reqSeq) return; // llegó tarde: ya se pidió otro año/sección
    panel.innerHTML = portalesHTML(data);
  }

  // ==================== Ingresos por apartamento ====================

  // Badge de TIH (1ª Línea verde / 2ª Línea azul), en línea para no tocar el CSS.
  function badgeTih(tipo) {
    const t = String(tipo) === '2' ? '2' : '1';
    const color = t === '1' ? '#10b981' : '#3b82f6';
    return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;color:#fff;background:${color}">${esc(tihTexto(t))}</span>`;
  }

  // Color de la barra de ocupación según el porcentaje (<30 rojo, 30-60 ámbar, >60 verde).
  function colorOcupacion(pct) {
    if (pct < 30) return '#ef4444';
    if (pct <= 60) return '#f59e0b';
    return '#10b981';
  }

  // Filas de la tabla general (separadas para poder refrescar solo el tbody al filtrar).
  function filasAptoHTML(lista, totalIngresos) {
    return lista.map((a) => {
      const ocup = Number(a.porcentaje_ocupacion) || 0;
      const pctIng = totalIngresos > 0 ? (Number(a.ingresos_netos) / totalIngresos) * 100 : 0;
      return `
        <tr data-apto="${a.apartamento_id}" style="cursor:pointer">
          <td>${esc(a.apartamento_nombre)}</td>
          <td>${badgeTih(a.tipo)}</td>
          <td class="num">${num(a.total_reservas)}</td>
          <td class="num">${num(a.noches_ocupadas)}</td>
          <td class="est-col-pct">${barra(ocup, colorOcupacion(ocup))}</td>
          <td class="num">${euro(a.ingresos_netos)}</td>
          <td class="est-col-pct">${barra(pctIng, '#3b82f6')}</td>
        </tr>`;
    }).join('');
  }

  function aptoGeneralHTML(data) {
    const { apartamentos = [], resumen = {} } = data || {};

    const cards = `
      <div class="est-cards">
        ${tarjetaResumen({ icono: '🏠', color: '#3b82f6', valor: num(resumen.total_apartamentos_con_reservas), label: 'Apartamentos activos' })}
        ${tarjetaResumen({ icono: '💰', color: '#10b981', valor: euro(resumen.ingresos_netos_total), label: 'Ingresos netos totales' })}
        ${tarjetaResumen({ icono: '📊', color: '#f59e0b', valor: euro(resumen.media_ingresos_por_apartamento), label: 'Media por apartamento' })}
      </div>`;

    if (!apartamentos.length) {
      return cards + `<div class="est-vacio">Sin reservas registradas para ${anio}</div>`;
    }

    const buscador = `
      <div style="margin-bottom:12px">
        <input class="input-buscar" data-buscar-apto type="search"
               placeholder="Buscar apartamento…" value="${esc(aptoBuscar)}">
      </div>`;

    const total = Number(resumen.ingresos_netos_total) || 0;
    const filas = filasAptoHTML(filtrarApto(apartamentos), total);

    return cards + buscador + `
      <div class="tabla-scroll">
        <table class="tabla est-tabla">
          <thead>
            <tr>
              <th>Apartamento</th>
              <th>TIH</th>
              <th class="num">Reservas</th>
              <th class="num">Noches</th>
              <th class="est-col-pct">% Ocupación</th>
              <th class="num">Ingresos netos</th>
              <th class="est-col-pct">% del total</th>
            </tr>
          </thead>
          <tbody data-apto-tbody>${filas || `<tr><td colspan="7" class="est-vacio">Sin resultados</td></tr>`}</tbody>
        </table>
      </div>`;
  }

  // Filtra la lista en memoria por el texto del buscador (sin llamada extra al servidor).
  function filtrarApto(lista) {
    const q = aptoBuscar.trim().toLowerCase();
    if (!q) return lista;
    return lista.filter((a) => (a.apartamento_nombre || '').toLowerCase().includes(q));
  }

  // Vincula buscador (refresca solo el tbody) y click en fila (abre detalle).
  function enlazarGeneral(panel) {
    const input = panel.querySelector('[data-buscar-apto]');
    if (input) {
      input.addEventListener('input', () => {
        aptoBuscar = input.value;
        const tbody = panel.querySelector('[data-apto-tbody]');
        if (!tbody || !aptoCache) return;
        const total = Number(aptoCache.resumen?.ingresos_netos_total) || 0;
        const filas = filasAptoHTML(filtrarApto(aptoCache.apartamentos || []), total);
        tbody.innerHTML = filas || `<tr><td colspan="7" class="est-vacio">Sin resultados</td></tr>`;
        enlazarFilas(panel);
      });
    }
    enlazarFilas(panel);
  }

  function enlazarFilas(panel) {
    panel.querySelectorAll('tr[data-apto]').forEach((tr) => {
      tr.addEventListener('click', () => {
        aptoSel = Number(tr.dataset.apto);
        renderApartamentos(panel);
      });
    });
  }

  function aptoDetalleHTML(a) {
    const reservas = a.reservas || [];
    const cards = `
      <div class="est-cards">
        ${tarjetaResumen({ icono: '📋', color: '#3b82f6', valor: num(a.total_reservas), label: 'Total reservas' })}
        ${tarjetaResumen({ icono: '💰', color: '#10b981', valor: euro(a.ingresos_netos), label: 'Ingresos netos' })}
        ${tarjetaResumen({ icono: '📊', color: '#f59e0b', valor: (Number(a.porcentaje_ocupacion) || 0).toFixed(1) + '%', label: '% Ocupación' })}
      </div>`;

    const cabecera = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        <button class="btn-sec" data-volver>← Volver</button>
        <span class="est-titulo" style="font-size:20px">${esc(a.apartamento_nombre)}</span>
        ${badgeTih(a.tipo)}
      </div>`;

    if (!reservas.length) {
      return cabecera + cards + `<div class="est-vacio">Sin reservas en ${anio}</div>`;
    }

    const filas = reservas.map((r) => `
      <tr>
        <td>${esc(r.numero_reserva)}</td>
        <td>${esc(r.nombre_cliente)}</td>
        <td>${esc(fechaES(r.entrada))}</td>
        <td>${esc(fechaES(r.salida))}</td>
        <td class="num">${num(r.noches)}</td>
        <td>${esc(r.portal)}</td>
        <td class="num">${euro(r.pagado)}</td>
      </tr>`).join('');

    const totalIng = reservas.reduce((s, r) => s + (Number(r.pagado) || 0), 0);
    const total = `
      <tr class="est-fila-total">
        <td colspan="6">Total</td>
        <td class="num">${euro(totalIng)}</td>
      </tr>`;

    return cabecera + cards + `
      <div class="tabla-scroll">
        <table class="tabla est-tabla">
          <thead>
            <tr>
              <th>Nº Reserva</th>
              <th>Cliente</th>
              <th>Entrada</th>
              <th>Salida</th>
              <th class="num">Noches</th>
              <th>Portal</th>
              <th class="num">Importe</th>
            </tr>
          </thead>
          <tbody>${filas}</tbody>
          <tfoot>${total}</tfoot>
        </table>
      </div>`;
  }

  async function renderAptoDetalle(panel, id) {
    panel.innerHTML = skeletonCarga(3);
    const seq = ++reqSeq;
    let data;
    try {
      data = await API.get(`/api/estadisticas/apartamentos?anio=${anio}&apartamento_id=${id}`);
    } catch (e) {
      if (seq !== reqSeq) return;
      panel.innerHTML = errorHTML(e.message);
      const btn = panel.querySelector('[data-reintentar]');
      if (btn) btn.addEventListener('click', () => renderAptoDetalle(panel, id));
      return;
    }
    if (seq !== reqSeq) return;
    panel.innerHTML = aptoDetalleHTML(data.apartamento || {});
    const volver = panel.querySelector('[data-volver]');
    if (volver) volver.addEventListener('click', () => { aptoSel = null; renderApartamentos(panel); });
  }

  async function renderAptoGeneral(panel) {
    // Si ya tenemos los datos del año, reusarlos (el buscador filtra en memoria).
    if (aptoCache) {
      panel.innerHTML = aptoGeneralHTML(aptoCache);
      enlazarGeneral(panel);
      return;
    }
    panel.innerHTML = skeletonCarga(3);
    const seq = ++reqSeq;
    let data;
    try {
      data = await API.get(`/api/estadisticas/apartamentos?anio=${anio}`);
    } catch (e) {
      if (seq !== reqSeq) return;
      panel.innerHTML = errorHTML(e.message);
      const btn = panel.querySelector('[data-reintentar]');
      if (btn) btn.addEventListener('click', () => renderAptoGeneral(panel));
      return;
    }
    if (seq !== reqSeq) return;
    aptoCache = data;
    panel.innerHTML = aptoGeneralHTML(data);
    enlazarGeneral(panel);
  }

  function renderApartamentos(panel) {
    if (aptoSel != null) { renderAptoDetalle(panel, aptoSel); return; }
    renderAptoGeneral(panel);
  }

  // ==================== Ocupación ====================

  const MESES_ABR = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  function pctTxt(n) { return (Number(n) || 0).toFixed(1) + '%'; }

  // Color de barra de ocupación por umbral (<30 rojo, 30-60 ámbar, >60 verde).
  function colorOcup(pct) {
    if (pct < 30) return '#ef4444';
    if (pct <= 60) return '#f59e0b';
    return '#10b981';
  }

  // Gráfico de barras verticales por mes (CSS inline, sin librerías). Altura máx 200px.
  function graficoMeses(porMes) {
    const hoy = new Date();
    const columnas = porMes.map((m) => {
      const pct = Number(m.porcentaje) || 0;
      const altura = pct > 0 ? Math.max(3, Math.round((pct / 100) * 200)) : 0;
      const esActual = anio === hoy.getFullYear() && m.mes === (hoy.getMonth() + 1);
      const resalte = esActual ? 'box-shadow:0 0 0 2px #1a1a2e;' : '';
      return `
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;min-width:0">
          <div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;width:100%">
            <span style="font-size:11px;font-weight:600;color:var(--muted);margin-bottom:4px">${pct.toFixed(0)}%</span>
            <div title="${esc(m.nombre_mes)}: ${pctTxt(pct)}"
                 style="width:60%;max-width:34px;height:${altura}px;background:${colorOcup(pct)};border-radius:4px 4px 0 0;${resalte}"></div>
          </div>
          <span style="font-size:11px;margin-top:6px;color:${esActual ? '#1a1a2e' : 'var(--muted)'};font-weight:${esActual ? '700' : '400'}">${MESES_ABR[m.mes - 1]}</span>
        </div>`;
    }).join('');

    return `
      <div style="border:1px solid var(--border);border-radius:12px;padding:16px 16px 12px;margin-bottom:20px;background:#fff">
        <div style="display:flex;align-items:flex-end;gap:8px;height:240px">${columnas}</div>
      </div>`;
  }

  // Tarjeta de comparativa de una TIH (título + nº apartamentos + media con barra + noches).
  function tarjetaTih(titulo, d, color) {
    const media = Number(d.media_ocupacion) || 0;
    const ancho = Math.max(0, Math.min(100, media));
    return `
      <div style="flex:1;min-width:0;border:1px solid var(--border);border-radius:12px;padding:18px;background:#fff">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
          <span style="width:12px;height:12px;border-radius:3px;background:${color}"></span>
          <span style="font-size:16px;font-weight:600;color:var(--text)">${esc(titulo)}</span>
        </div>
        <div style="font-size:30px;font-weight:700;color:${color};line-height:1.1">${pctTxt(media)}</div>
        <div style="font-size:13px;color:var(--muted);margin:2px 0 14px">Media de ocupación</div>
        <span style="display:block;height:12px;border-radius:999px;background:var(--border-soft);overflow:hidden">
          <span style="display:block;height:100%;border-radius:999px;width:${ancho}%;background:${color}"></span>
        </span>
        <div style="display:flex;justify-content:space-between;margin-top:14px;font-size:13px;color:var(--muted)">
          <span>${num(d.total_apartamentos)} apartamentos</span>
          <span><strong style="color:var(--text)">${num(d.noches_ocupadas)}</strong> noches ocupadas</span>
        </div>
      </div>`;
  }

  function ocupacionHTML(data) {
    const { resumen = {}, por_mes = [], por_tih = {} } = data || {};

    const cards = `
      <div class="est-cards">
        ${tarjetaResumen({ icono: '🏠', color: '#3b82f6', valor: num(resumen.total_apartamentos), label: 'Total apartamentos' })}
        ${tarjetaResumen({ icono: '📊', color: '#10b981', valor: pctTxt(resumen.media_ocupacion_anual), label: 'Media ocupación anual' })}
        ${tarjetaResumen({ icono: '📅', color: '#f59e0b', valor: esc(resumen.mes_mas_ocupado || '—'), label: 'Mes más ocupado' })}
        ${tarjetaResumen({ icono: '🌙', color: '#8b5cf6', valor: num(resumen.total_noches_ocupadas), label: 'Total noches ocupadas' })}
      </div>`;

    if (!resumen.total_apartamentos) {
      return cards + `<div class="est-vacio">No hay apartamentos registrados</div>`;
    }

    const comparativa = `
      <div style="display:flex;gap:16px;flex-wrap:wrap">
        ${tarjetaTih('1ª Línea', por_tih.primera_linea || {}, '#10b981')}
        ${tarjetaTih('2ª Línea', por_tih.segunda_linea || {}, '#3b82f6')}
      </div>`;

    return cards + graficoMeses(por_mes) + comparativa;
  }

  async function renderOcupacion(panel) {
    panel.innerHTML = skeletonCarga(4);
    const seq = ++reqSeq;
    let data;
    try {
      data = await API.get(`/api/estadisticas/ocupacion?anio=${anio}`);
    } catch (e) {
      if (seq !== reqSeq) return;
      panel.innerHTML = errorHTML(e.message);
      const btn = panel.querySelector('[data-reintentar]');
      if (btn) btn.addEventListener('click', () => renderOcupacion(panel));
      return;
    }
    if (seq !== reqSeq) return;
    panel.innerHTML = ocupacionHTML(data);
  }

  // ==================== Propietarios (cashflow de contratos) ====================

  function filtrarProp(lista) {
    const q = propBuscar.trim().toLowerCase();
    if (!q) return lista;
    return lista.filter((p) => (p.propietario_nombre || '').toLowerCase().includes(q));
  }

  // Celda "Próxima cuota": naranja si vencida, verde "Al día ✓" si no hay próxima.
  function celdaProxima(p) {
    if (!p.proxima_cuota_fecha) return '<span style="color:#10b981;font-weight:600">Al día ✓</span>';
    const hoy = new Date().toISOString().slice(0, 10);
    const vencida = p.proxima_cuota_fecha < hoy;
    const txt = `${fechaES(p.proxima_cuota_fecha)} — ${euro(p.proxima_cuota_importe)}`;
    return `<span style="${vencida ? 'color:#f59e0b;font-weight:600' : 'color:var(--text)'}">${txt}</span>`;
  }

  function filasPropHTML(lista) {
    if (!lista.length) return '<tr><td colspan="7" class="est-vacio">Sin resultados</td></tr>';
    return lista.map((p) => {
      const comp = Number(p.total_comprometido) || 0;
      const pct = comp > 0 ? (Number(p.total_pagado) / comp) * 100 : 0;
      return `
        <tr>
          <td>${esc(p.propietario_nombre)}</td>
          <td class="num">${num(p.contratos)}</td>
          <td class="num">${euro(p.total_comprometido)}</td>
          <td class="est-col-pct">${euro(p.total_pagado)}${barra(pct, '#10b981')}</td>
          <td class="num">${euro(p.total_pendiente)}</td>
          <td>${celdaProxima(p)}</td>
          <td class="acciones"><button class="btn-mini" data-ver-contratos="${p.propietario_id}">Ver contratos</button></td>
        </tr>`;
    }).join('');
  }

  function totalesPropHTML(lista) {
    const sum = (k) => lista.reduce((s, p) => s + (Number(p[k]) || 0), 0);
    return `
      <tr class="est-fila-total">
        <td>Total</td>
        <td class="num">${num(sum('contratos'))}</td>
        <td class="num">${euro(sum('total_comprometido'))}</td>
        <td>${euro(sum('total_pagado'))}</td>
        <td class="num">${euro(sum('total_pendiente'))}</td>
        <td></td><td></td>
      </tr>`;
  }

  function propietariosHTML(data) {
    const { resumen = {}, por_propietario = [] } = data || {};

    const cards = `
      <div class="est-cards">
        ${tarjetaResumen({ icono: '👥', color: '#3b82f6', valor: num(resumen.total_propietarios_con_contrato), label: 'Propietarios con contrato' })}
        ${tarjetaResumen({ icono: '📋', color: '#6b7280', valor: euro(resumen.total_comprometido), label: 'Total comprometido' })}
        ${tarjetaResumen({ icono: '✅', color: '#10b981', valor: euro(resumen.total_pagado), label: 'Total pagado' })}
        ${tarjetaResumen({ icono: '⏳', color: '#f59e0b', valor: euro(resumen.total_pendiente), label: 'Pendiente de pagar' })}
      </div>`;

    if (!por_propietario.length) {
      return cards + `
        <div class="est-placeholder">
          <span class="est-placeholder-icono">📋</span>
          <p class="est-placeholder-texto">Sin contratos registrados para ${anio}</p>
        </div>`;
    }

    // Cashflow global: barra verde (pagado) + naranja (pendiente).
    const comp = Number(resumen.total_comprometido) || 0;
    const pag = Number(resumen.total_pagado) || 0;
    const pend = Number(resumen.total_pendiente) || 0;
    const pctPag = comp > 0 ? (pag / comp) * 100 : 0;
    const pctPend = comp > 0 ? (pend / comp) * 100 : 0;
    const cashflow = `
      <div class="est-cashflow">
        <div class="est-cashflow-titulo">Cashflow de la temporada</div>
        <div class="est-cashflow-bar">
          <div class="est-cashflow-pag" style="width:${Math.max(0, Math.min(100, pctPag))}%"></div>
          <div class="est-cashflow-pend" style="width:${Math.max(0, Math.min(100, pctPend))}%"></div>
        </div>
        <div class="est-cashflow-txt"><strong style="color:var(--text)">${euro(pag)}</strong> pagado de <strong style="color:var(--text)">${euro(comp)}</strong> comprometido (${Math.round(pctPag)}%)</div>
      </div>`;

    const buscador = `
      <div style="margin-bottom:12px">
        <input class="input-buscar" data-buscar-prop type="search" placeholder="Buscar propietario…" value="${esc(propBuscar)}">
      </div>`;

    const lista = filtrarProp(por_propietario);
    const tabla = `
      <div class="tabla-scroll">
        <table class="tabla est-tabla">
          <thead>
            <tr>
              <th>Propietario</th>
              <th class="num">Contratos</th>
              <th class="num">Comprometido</th>
              <th>Pagado</th>
              <th class="num">Pendiente</th>
              <th>Próxima cuota</th>
              <th></th>
            </tr>
          </thead>
          <tbody data-prop-tbody>${filasPropHTML(lista)}</tbody>
          <tfoot>${totalesPropHTML(lista)}</tfoot>
        </table>
      </div>`;

    return cards + cashflow + buscador + tabla;
  }

  // Conecta el buscador (filtra en memoria) y los botones "Ver contratos".
  function enlazarProp(panel) {
    const input = panel.querySelector('[data-buscar-prop]');
    if (input) {
      input.addEventListener('input', () => {
        propBuscar = input.value;
        if (!propCache) return;
        const lista = filtrarProp(propCache.por_propietario || []);
        const tbody = panel.querySelector('[data-prop-tbody]');
        const tfoot = panel.querySelector('.est-tabla tfoot');
        if (tbody) tbody.innerHTML = filasPropHTML(lista);
        if (tfoot) tfoot.innerHTML = totalesPropHTML(lista);
        enlazarVerContratos(panel);
      });
    }
    enlazarVerContratos(panel);
  }

  // "Ver contratos": navega a la pestaña Contratos (el filtrado por propietario lo aplica
  // allí el usuario; este módulo no toca el de Contratos).
  function enlazarVerContratos(panel) {
    panel.querySelectorAll('[data-ver-contratos]').forEach((b) =>
      b.addEventListener('click', () => {
        if (typeof activarTab === 'function') activarTab('contratos');
      }));
  }

  async function renderPropietarios(panel) {
    if (propCache) { panel.innerHTML = propietariosHTML(propCache); enlazarProp(panel); return; }
    panel.innerHTML = skeletonCarga(4);
    const seq = ++reqSeq;
    let data;
    try {
      data = await API.get(`/api/estadisticas/propietarios?anio=${anio}`);
    } catch (e) {
      if (seq !== reqSeq) return;
      panel.innerHTML = errorHTML(e.message);
      const btn = panel.querySelector('[data-reintentar]');
      if (btn) btn.addEventListener('click', () => renderPropietarios(panel));
      return;
    }
    if (seq !== reqSeq) return;
    propCache = data;
    panel.innerHTML = propietariosHTML(data);
    enlazarProp(panel);
  }

  // ---- Render del contenido de la sección activa ----
  function renderSeccion() {
    const panel = document.querySelector(
      `#vista-estadisticas .sub-panel[data-panel-sub="${seccionActiva}"]`
    );
    if (!panel) return;
    if (seccionActiva === 'portal') { renderPortales(panel); return; }
    if (seccionActiva === 'apartamento') { renderApartamentos(panel); return; }
    if (seccionActiva === 'ocupacion') { renderOcupacion(panel); return; }
    if (seccionActiva === 'propietario') { renderPropietarios(panel); return; }
    panel.innerHTML = placeholderHTML(SECCIONES[seccionActiva]);
  }

  // ---- Cambio de sub-pestaña ----
  function activarSub(sub) {
    if (!SECCIONES[sub]) return;
    seccionActiva = sub;
    if (sub === 'apartamento') aptoSel = null; // al (re)entrar, mostrar la vista general
    document.querySelectorAll('#est-subtabs .subtab').forEach((b) =>
      b.classList.toggle('activo', b.dataset.sub === sub));
    document.querySelectorAll('#vista-estadisticas .sub-panel').forEach((p) =>
      p.classList.toggle('activo', p.dataset.panelSub === sub));
    renderSeccion();
  }

  // ---- Selector de año (año actual seleccionado por defecto) ----
  function poblarAnios() {
    const sel = document.getElementById('est-anio');
    if (!sel) return;
    const actual = new Date().getFullYear();
    if (!ANIOS.includes(anio)) anio = ANIOS.includes(actual) ? actual : ANIOS[ANIOS.length - 1];
    sel.innerHTML = ANIOS.map(
      (a) => `<option value="${a}"${a === anio ? ' selected' : ''}>${a}</option>`
    ).join('');
  }

  // La 4ª sub-pestaña "Propietarios" y su panel se inyectan por JS (index.html no se toca).
  function inyectarSubPropietarios() {
    const subtabs = document.getElementById('est-subtabs');
    if (subtabs && !subtabs.querySelector('[data-sub="propietario"]')) {
      const btn = document.createElement('button');
      btn.className = 'subtab';
      btn.dataset.sub = 'propietario';
      btn.textContent = 'Propietarios 💰';
      subtabs.appendChild(btn);
    }
    const scroll = document.querySelector('#vista-estadisticas .est-scroll');
    if (scroll && !scroll.querySelector('[data-panel-sub="propietario"]')) {
      const panel = document.createElement('div');
      panel.className = 'sub-panel';
      panel.dataset.panelSub = 'propietario';
      scroll.appendChild(panel);
    }
  }

  function init() {
    poblarAnios();
    inyectarSubPropietarios(); // antes de cablear los listeners de las sub-pestañas
    const sel = document.getElementById('est-anio');
    if (sel) sel.addEventListener('change', () => {
      anio = Number(sel.value);
      aptoSel = null; aptoCache = null; aptoBuscar = ''; // el año invalida los datos cacheados
      propCache = null; propBuscar = '';
      renderSeccion(); // al cambiar el año se recarga la sección activa
    });
    document.querySelectorAll('#est-subtabs .subtab').forEach((b) =>
      b.addEventListener('click', () => activarSub(b.dataset.sub)));
  }

  // Al entrar en la pestaña: (re)carga la sección activa.
  async function cargar() {
    renderSeccion();
  }

  return { init, cargar };
})();
