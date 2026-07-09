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
    pagos:       'Pagos propietario',
    mayorista:   'Mayoristas',
  };
  const METODOS_PAGO = [['transferencia', 'Transferencia'], ['cheque', 'Cheque'], ['efectivo', 'Efectivo']];
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
  let pagosCuentaCache = null; // caché de la sección "Pagos a cuenta" (resumen + propietario + nº pagos)

  // Estado de "Mayoristas": caché del resumen del año y contrato abierto en el panel lateral.
  let mayCache = null;
  let mayPanelContratoId = null;

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

  // Celda de nombre del portal con badge "📋 Contrato" y nota para mayoristas.
  function nombrePortalHTML(p) {
    let html = esc(p.portal);
    if (p.es_mayorista) {
      if (!p.tiene_contrato) {
        html += ' <span style="display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;font-weight:600;background:#fef3c7;color:#92400e;border:1px solid #fbbf24" title="Sin contrato registrado para este año">⚠️ Sin contrato</span>';
        html += '<br><small style="color:#b45309;font-size:11px">Sin contrato registrado para este año</small>';
      } else {
        html += ' <span style="display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;font-weight:600;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe" title="Importe según contrato de mayorista, no según reservas">📋 Contrato</span>';
        html += '<br><small style="color:#6b7280;font-size:11px">Importe según contrato de mayorista</small>';
      }
    }
    return html;
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
        ${tarjetaResumen({ icono: '💰', color: '#10b981', valor: euro(resumen.ingresos_netos), label: 'Ingresos netos' })}
      </div>`;

    if (!portales.length) {
      return cards + `<div class="est-vacio">Sin reservas registradas para ${anio}</div>`;
    }

    const totalNetos = Number(resumen.ingresos_netos) || 0;
    const filas = portales.map((p) => {
      const pct = totalNetos > 0 ? (Number(p.ingresos_netos) / totalNetos) * 100 : 0;
      const comisionStr = p.es_mayorista
        ? '<span style="color:#6b7280">—</span>'
        : (Number(p.comision_porcentaje) > 0 ? `${p.comision_porcentaje}%` : '<span style="color:#6b7280">—</span>');
      return `
        <tr>
          <td class="est-col-logo">${celdaPortal(p)}</td>
          <td>${nombrePortalHTML(p)}</td>
          <td class="num">${num(p.total_reservas)}</td>
          <td class="num">${num(p.noches_totales)}</td>
          <td class="num">${euro(p.ingresos_brutos)}</td>
          <td class="num">${comisionStr}</td>
          <td class="num">${euro(p.ingresos_netos)}</td>
          <td class="est-col-pct">${barra(pct, p.color)}</td>
        </tr>`;
    }).join('');

    const totales = `
      <tr class="est-fila-total">
        <td></td>
        <td>Total</td>
        <td class="num">${num(resumen.total_reservas)}</td>
        <td class="num">${num(portales.reduce((s, p) => s + (Number(p.noches_totales) || 0), 0))}</td>
        <td class="num">${euro(resumen.ingresos_brutos)}</td>
        <td></td>
        <td class="num">${euro(resumen.ingresos_netos)}</td>
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
              <th class="num">Bruto</th>
              <th class="num">Comisión</th>
              <th class="num">Neto</th>
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
              <th class="num">Reservas</th>
              <th class="num">Noches</th>
              <th class="est-col-pct">% Ocupación</th>
              <th class="num">Ingresos netos</th>
              <th class="est-col-pct">% del total</th>
            </tr>
          </thead>
          <tbody data-apto-tbody>${filas || `<tr><td colspan="6" class="est-vacio">Sin resultados</td></tr>`}</tbody>
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
        tbody.innerHTML = filas || `<tr><td colspan="6" class="est-vacio">Sin resultados</td></tr>`;
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
          <td class="acciones"><button class="btn-mini" data-ver-contratos="${p.propietario_id}" data-nombre="${esc(p.propietario_nombre)}">Ver contratos</button></td>
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

  // ==================== Pagos a cuenta a propietarios ====================
  // Datos cruzados en cliente: resumen (totales por apto) + propietario (de /apartamentos) +
  // nº de pagos (longitud de la lista por apto). Usa solo endpoints existentes (sin backend).
  function pagosCuentaHTML(data) {
    const { resumen = {}, porApto = [], propMap = {}, counts = {} } = data || {};
    const totalPagado = Number(resumen.total_pagado) || 0;
    const totalPend = Number(resumen.total_pendiente) || 0;
    const nPagos = Object.values(counts).reduce((s, c) => s + (Number(c) || 0), 0);

    const titulo = '<h3 class="est-seccion-titulo">Pagos a cuenta a propietarios</h3>';
    const cards = `
      <div class="est-cards">
        ${tarjetaResumen({ icono: '✅', color: '#10b981', valor: euro(totalPagado), label: `Total pagado ${anio}` })}
        ${tarjetaResumen({ icono: '⏳', color: '#f59e0b', valor: euro(totalPend), label: 'Total pendiente' })}
        ${tarjetaResumen({ icono: '📋', color: '#3b82f6', valor: num(nPagos), label: 'Nº de pagos' })}
      </div>`;

    if (!porApto.length) {
      return `${titulo}${cards}<div class="est-vacio">Sin pagos a cuenta registrados en ${anio}</div>`;
    }

    const ordenados = [...porApto].sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0));
    const filas = ordenados.map((p) => `
      <tr>
        <td>${esc(p.apartamento_nombre)}</td>
        <td>${esc(propMap[p.apartamento_id] || '—')}</td>
        <td class="num">${euro(p.total)}</td>
        <td>${euro(p.total_pagado)}</td>
        <td class="num">${euro(p.total_pendiente)}</td>
        <td class="num">${num(counts[p.apartamento_id] || 0)}</td>
      </tr>`).join('');
    const tabla = `
      <div class="tabla-scroll">
        <table class="tabla est-tabla">
          <thead>
            <tr>
              <th>Apartamento</th>
              <th>Propietario</th>
              <th class="num">Total año</th>
              <th>Pagado</th>
              <th class="num">Pendiente</th>
              <th class="num">Nº pagos</th>
            </tr>
          </thead>
          <tbody>${filas}</tbody>
          <tfoot>
            <tr class="est-fila-total">
              <td>Total</td>
              <td></td>
              <td class="num">${euro(totalPagado + totalPend)}</td>
              <td>${euro(totalPagado)}</td>
              <td class="num">${euro(totalPend)}</td>
              <td class="num">${num(nPagos)}</td>
            </tr>
          </tfoot>
        </table>
      </div>`;
    return `${titulo}${cards}${tabla}`;
  }

  // Carga (o repinta desde caché) la sub-pestaña independiente "Pagos propietario".
  async function renderPagosSeccion(panel) {
    if (pagosCuentaCache && pagosCuentaCache.anio === anio) { panel.innerHTML = pagosCuentaHTML(pagosCuentaCache); return; }
    panel.innerHTML = skeletonCarga(3);
    const seq = ++reqSeq;
    let resumen, apts;
    try {
      [resumen, apts] = await Promise.all([
        API.get(`/api/apartamentos/pagos-propietario/resumen?anio=${anio}`),
        API.get('/api/apartamentos?todos=1'),
      ]);
    } catch (e) {
      if (seq !== reqSeq) return;
      panel.innerHTML = errorHTML(e.message);
      const btn = panel.querySelector('[data-reintentar]');
      if (btn) btn.addEventListener('click', () => renderPagosSeccion(panel));
      return;
    }
    if (seq !== reqSeq) return;
    const porApto = (resumen && resumen.por_apartamento) || [];
    const propMap = {};
    (apts || []).forEach((a) => { propMap[a.id] = [a.propietario_nombre, a.propietario_apellidos].filter(Boolean).join(' '); });
    // Nº de pagos por apartamento: longitud de la lista de cada apto con pagos.
    const counts = {};
    const listas = await Promise.all(porApto.map((p) =>
      API.get(`/api/apartamentos/${p.apartamento_id}/pagos-propietario?anio=${anio}`).catch(() => [])));
    if (seq !== reqSeq) return;
    porApto.forEach((p, i) => { counts[p.apartamento_id] = (listas[i] || []).length; });

    pagosCuentaCache = { anio, resumen, porApto, propMap, counts };
    panel.innerHTML = pagosCuentaHTML(pagosCuentaCache);
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

  // "Ver contratos": navega a la pestaña Contratos y la filtra por ese propietario.
  function enlazarVerContratos(panel) {
    panel.querySelectorAll('[data-ver-contratos]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.verContratos;
        const nombre = b.dataset.nombre || '';
        if (typeof activarTab === 'function') activarTab('contratos');
        if (typeof Contratos !== 'undefined' && typeof Contratos.filtrarPorPropietario === 'function') {
          Contratos.filtrarPorPropietario(id, nombre);
        }
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

  // ==================== Mayoristas (cashflow de cobros) ====================

  function hoyISO() { return new Date().toISOString().slice(0, 10); }

  function badgeEstadoContrato(estado) {
    const map = { activo: '#10b981', finalizado: '#6b7280', cancelado: '#ef4444' };
    const c = map[estado] || '#6b7280';
    return `<span class="may-badge" style="background:${c}1a;color:${c}">${esc(estado || '—')}</span>`;
  }
  function badgePago(pagado) {
    return pagado
      ? '<span class="may-badge" style="background:#f0fdf4;color:#047857">Cobrado</span>'
      : '<span class="may-badge" style="background:#fffbeb;color:#b45309">Pendiente</span>';
  }

  // Barra de progreso individual (verde) con % cobrado.
  function barraProgreso(pct) {
    const ancho = Math.max(0, Math.min(100, pct));
    return `<span class="may-prog"><span class="may-prog-fill" style="width:${ancho}%"></span></span>`;
  }

  // Próximo pago: "Al día ✓" si no hay; rojo si vencido (fecha < hoy).
  function proximoPagoTxt(m) {
    if (!m.proximo_pago_fecha) return '<span style="color:#10b981;font-weight:600">Al día ✓</span>';
    const vencido = m.proximo_pago_fecha < hoyISO();
    const txt = `${fechaES(m.proximo_pago_fecha)} — ${euro(m.proximo_pago_importe)}`;
    return `<span style="${vencido ? 'color:#ef4444;font-weight:700' : 'color:var(--text)'}">${txt}${vencido ? ' ⚠' : ''}</span>`;
  }

  function cardMayorista(m) {
    const total = Number(m.importe_total) || 0;
    const pag = Number(m.pagado) || 0;
    const pct = total > 0 ? (pag / total) * 100 : 0;
    return `
      <div class="may-card">
        <div class="may-card-cab">
          <span class="may-card-nombre">${esc(m.mayorista_nombre)}</span>
          <button class="btn-mini" data-ver-contrato="${m.contrato_id}">Ver contrato</button>
        </div>
        <div class="may-card-total">Importe total: <strong>${euro(total)}</strong></div>
        <div class="may-card-prog">${barraProgreso(pct)}<span class="may-card-pct">${Math.round(pct)}% cobrado</span></div>
        <div class="may-card-cifras">
          <span>Cobrado: <strong style="color:#10b981">${euro(pag)}</strong></span>
          <span>Pendiente: <strong style="color:#f59e0b">${euro(m.pendiente)}</strong></span>
        </div>
        <div class="may-card-prox">Próximo pago: ${proximoPagoTxt(m)}</div>
      </div>`;
  }

  function mayoristasHTML(data) {
    const { resumen = {}, por_mayorista = [] } = data || {};

    const top = `
      <div class="may-top">
        <button class="btn-sec" data-gestionar>⚙️ Gestionar mayoristas</button>
      </div>`;

    const cards = `
      <div class="est-cards">
        ${tarjetaResumen({ icono: '📋', color: '#3b82f6', valor: num(resumen.contratos_activos), label: 'Contratos activos' })}
        ${tarjetaResumen({ icono: '💰', color: '#6b7280', valor: euro(resumen.total_comprometido), label: 'Total comprometido' })}
        ${tarjetaResumen({ icono: '✅', color: '#10b981', valor: euro(resumen.total_cobrado), label: 'Total cobrado' })}
        ${tarjetaResumen({ icono: '⏳', color: '#f59e0b', valor: euro(resumen.total_pendiente), label: 'Pendiente de cobrar' })}
      </div>`;

    if (!por_mayorista.length) {
      return top + cards + `
        <div class="est-placeholder">
          <span class="est-placeholder-icono">📋</span>
          <p class="est-placeholder-texto">Sin contratos de mayorista para ${anio}</p>
        </div>`;
    }

    const comp = Number(resumen.total_comprometido) || 0;
    const cobr = Number(resumen.total_cobrado) || 0;
    const pend = Number(resumen.total_pendiente) || 0;
    const pctPag = comp > 0 ? (cobr / comp) * 100 : 0;
    const pctPend = comp > 0 ? (pend / comp) * 100 : 0;
    const cashflow = `
      <div class="est-cashflow">
        <div class="est-cashflow-titulo">Cobros de mayoristas — temporada ${anio}</div>
        <div class="est-cashflow-bar">
          <div class="est-cashflow-pag" style="width:${Math.max(0, Math.min(100, pctPag))}%"></div>
          <div class="est-cashflow-pend" style="width:${Math.max(0, Math.min(100, pctPend))}%"></div>
        </div>
        <div class="est-cashflow-txt"><strong style="color:var(--text)">${euro(cobr)}</strong> cobrado de <strong style="color:var(--text)">${euro(comp)}</strong> comprometido (${Math.round(pctPag)}%)</div>
      </div>`;

    const grid = `<div class="may-grid">${por_mayorista.map(cardMayorista).join('')}</div>`;
    return top + cards + cashflow + grid;
  }

  function enlazarMayoristas(panel) {
    const gest = panel.querySelector('[data-gestionar]');
    if (gest) gest.addEventListener('click', modalGestionar);
    panel.querySelectorAll('[data-ver-contrato]').forEach((b) =>
      b.addEventListener('click', () => abrirPanelContrato(Number(b.dataset.verContrato))));
  }

  async function renderMayoristas(panel) {
    if (mayCache) { panel.innerHTML = mayoristasHTML(mayCache); enlazarMayoristas(panel); return; }
    panel.innerHTML = skeletonCarga(4);
    const seq = ++reqSeq;
    let data;
    try {
      data = await API.get(`/api/mayoristas/resumen?anio=${anio}`);
    } catch (e) {
      if (seq !== reqSeq) return;
      panel.innerHTML = errorHTML(e.message);
      const btn = panel.querySelector('[data-reintentar]');
      if (btn) btn.addEventListener('click', () => renderMayoristas(panel));
      return;
    }
    if (seq !== reqSeq) return;
    mayCache = data;
    panel.innerHTML = mayoristasHTML(data);
    enlazarMayoristas(panel);
  }

  // Recarga el resumen (invalida la caché) y repinta si la sección activa es Mayoristas.
  function recargarMayoristas() {
    mayCache = null;
    if (seccionActiva !== 'mayorista') return;
    const panel = document.querySelector('#vista-estadisticas .sub-panel[data-panel-sub="mayorista"]');
    if (panel) renderMayoristas(panel);
  }

  // ---- Panel lateral: detalle del contrato de un mayorista ----
  function crearPanelContrato() {
    if (document.getElementById('may-panel')) return;
    const fondo = document.createElement('div');
    fondo.id = 'may-panel-fondo';
    fondo.className = 'panel-fondo';
    const panel = document.createElement('aside');
    panel.id = 'may-panel';
    panel.className = 'panel-lateral';
    panel.setAttribute('aria-label', 'Detalle del contrato de mayorista');
    panel.innerHTML = `
      <header class="panel-cabecera">
        <div class="rsv-titulo-grupo">
          <h3 id="may-d-titulo">Mayorista</h3>
          <span id="may-d-badge"></span>
        </div>
        <div class="panel-cabecera-acciones">
          <button id="may-d-nuevo" class="btn-sec">＋ Nuevo contrato</button>
          <button id="may-d-editar-plan" class="btn-sec">✏️ Editar plan</button>
          <button id="may-d-editar" class="btn-sec">✏️ Editar</button>
          <button id="may-d-cerrar" class="panel-cerrar" title="Cerrar">&times;</button>
        </div>
      </header>
      <div id="may-d-cuerpo" class="panel-cuerpo"></div>`;
    document.body.appendChild(fondo);
    document.body.appendChild(panel);
    fondo.addEventListener('click', cerrarPanelContrato);
    panel.querySelector('#may-d-cerrar').addEventListener('click', cerrarPanelContrato);
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const modalAbierto = !document.getElementById('modal-fondo').classList.contains('oculto');
      if (!modalAbierto && panel.classList.contains('abierto')) cerrarPanelContrato();
    }, true);
  }
  function abrirPanel() {
    document.getElementById('may-panel-fondo').classList.add('abierto');
    document.getElementById('may-panel').classList.add('abierto');
  }
  function cerrarPanelContrato() {
    document.getElementById('may-panel-fondo')?.classList.remove('abierto');
    document.getElementById('may-panel')?.classList.remove('abierto');
    mayPanelContratoId = null;
  }

  async function abrirPanelContrato(contratoId) {
    crearPanelContrato();
    mayPanelContratoId = contratoId;
    let contrato, mayoristas;
    try {
      [contrato, mayoristas] = await Promise.all([
        API.get('/api/mayoristas/contratos/' + contratoId),
        API.get('/api/mayoristas'),
      ]);
    } catch (e) { return toast(e.message, 'error'); }
    const may = (mayoristas || []).find((m) => m.id === contrato.mayorista_id) || { nombre: contrato.mayorista_nombre };

    document.getElementById('may-d-titulo').textContent = may.nombre || 'Mayorista';
    document.getElementById('may-d-badge').innerHTML = badgeEstadoContrato(contrato.estado);
    document.getElementById('may-d-editar').onclick = () => modalMayorista(may);
    document.getElementById('may-d-nuevo').onclick = () => modalNuevoContrato({ id: may.id, nombre: may.nombre });
    document.getElementById('may-d-editar-plan').onclick = () => modalEditarContrato(contrato, may);
    renderCuerpoContrato(contrato, may);
    abrirPanel();
  }

  function dato(etq, valor) {
    return `<div class="campo-ficha"><div class="etq">${etq}</div><div class="val">${valor}</div></div>`;
  }

  function renderCuerpoContrato(contrato, may) {
    const tel = may.telefono ? `<a class="vta-link" href="tel:${esc(may.telefono)}">${esc(may.telefono)}</a>` : '—';
    const email = may.email ? `<a class="vta-link" href="mailto:${esc(may.email)}">${esc(may.email)}</a>` : '—';
    const datosMay = `
      <div class="may-d-seccion">
        <div class="may-d-titulo-sec">🏢 Datos del mayorista</div>
        <div class="may-d-grid">
          ${dato('Nombre', esc(may.nombre) || '—')}
          ${dato('CIF', esc(may.cif) || '—')}
          ${dato('Dirección', esc(may.direccion) || '—')}
          ${dato('Teléfono', tel)}
          ${dato('Email', email)}
          ${dato('Contacto', esc(may.contacto_nombre) || '—')}
        </div>
      </div>`;

    const datosCon = `
      <div class="may-d-seccion">
        <div class="may-d-titulo-sec">📄 Contrato ${contrato.anio}</div>
        <div class="may-d-grid">
          ${dato('Descripción', esc(contrato.descripcion) || '—')}
          ${dato('Importe total', `<strong>${euro(contrato.importe_total)}</strong>`)}
          ${dato('Estado', badgeEstadoContrato(contrato.estado))}
        </div>
      </div>`;

    const pagos = contrato.pagos || [];
    const filas = pagos.map((p) => {
      const factCel = p.numero_factura
        ? `<a class="may-fact-link" style="text-decoration:underline;cursor:pointer" data-fact-num="${esc(p.numero_factura)}" title="Ver factura ${esc(p.numero_factura)}">${esc(p.numero_factura)}</a>`
        : `<button class="btn-mini" data-factura="${p.id}">🧾 Generar factura</button>`;
      const accion = p.pagado
        ? `<button class="btn-mini" data-desmarcar="${p.id}">Desmarcar</button>`
        : `<button class="btn-mini may-btn-cobrar" data-cobrar="${p.id}">✓ Marcar cobrado</button>`;
      return `
        <tr>
          <td class="num">${p.numero_pago}</td>
          <td>${fechaES(p.fecha_prevista)}</td>
          <td class="num">${euro(p.importe)}</td>
          <td>${badgePago(p.pagado)}</td>
          <td>${p.fecha_pago ? fechaES(p.fecha_pago) : '—'}</td>
          <td>${esc(p.metodo_pago) || '—'}</td>
          <td>${factCel}</td>
          <td class="acciones">${accion}</td>
        </tr>`;
    }).join('') || '<tr><td colspan="8" class="est-vacio">Sin pagos en el plan</td></tr>';

    const total = pagos.reduce((s, p) => s + (Number(p.importe) || 0), 0);
    const cobrado = pagos.filter((p) => p.pagado).reduce((s, p) => s + (Number(p.importe) || 0), 0);
    const pie = `
      <tr class="est-fila-total">
        <td colspan="2">Total</td>
        <td class="num">${euro(total)}</td>
        <td colspan="5">Cobrado: <strong style="color:#10b981">${euro(cobrado)}</strong> · Pendiente: <strong style="color:#f59e0b">${euro(total - cobrado)}</strong></td>
      </tr>`;

    const tabla = `
      <div class="may-d-seccion">
        <div class="may-d-titulo-sec">💳 Plan de pagos</div>
        <div class="tabla-scroll">
          <table class="tabla est-tabla may-tabla-pagos">
            <thead><tr>
              <th class="num">Nº</th><th>Fecha prevista</th><th class="num">Importe</th><th>Estado</th>
              <th>Fecha cobro</th><th>Método</th><th>Nº Factura</th><th></th>
            </tr></thead>
            <tbody>${filas}</tbody>
            <tfoot>${pie}</tfoot>
          </table>
        </div>
      </div>`;

    const cuerpo = document.getElementById('may-d-cuerpo');
    cuerpo.innerHTML = datosMay + datosCon + tabla;

    cuerpo.querySelectorAll('[data-cobrar]').forEach((b) =>
      b.addEventListener('click', () => modalCobrar(Number(b.dataset.cobrar))));
    cuerpo.querySelectorAll('[data-desmarcar]').forEach((b) =>
      b.addEventListener('click', () => desmarcarPago(Number(b.dataset.desmarcar))));
    cuerpo.querySelectorAll('[data-factura]').forEach((b) =>
      b.addEventListener('click', () => generarFactura(pagos.find((p) => p.id === Number(b.dataset.factura)), contrato)));
    cuerpo.querySelectorAll('[data-fact-num]').forEach((a) =>
      a.addEventListener('click', () => irAFactura(a.dataset.factNum, contrato.anio)));
  }

  // Navega a Facturación y abre el panel de la factura con ese número (busca el id por año).
  async function irAFactura(numero, anioContrato) {
    if (!numero) return;
    const anioBusca = anioContrato || parseInt(String(numero).split('-')[1], 10) || anio;
    let facturas;
    try { facturas = await API.get(`/api/facturas?anio=${anioBusca}`); }
    catch (e) { return toast(e.message, 'error'); }
    const f = (facturas || []).find((x) => x.numero === numero);
    if (!f) return toast(`No se encontró la factura ${numero}`, 'error');
    if (typeof activarTab === 'function') activarTab('facturacion');
    if (typeof Facturas !== 'undefined' && typeof Facturas.abrirFicha === 'function') Facturas.abrirFicha(f.id);
  }

  // Recarga el panel del contrato abierto (tras una mutación) y el resumen de fondo.
  async function recargarPanel() {
    recargarMayoristas();
    if (mayPanelContratoId != null) await abrirPanelContrato(mayPanelContratoId);
  }

  // ---- Marcar / desmarcar cobro ----
  function modalCobrar(pagoId) {
    const opts = METODOS_PAGO.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    abrirModal(`
      <h3>✓ Marcar pago como cobrado</h3>
      <div class="fila-campos">
        <div class="campo"><label>Fecha de cobro</label><input type="date" id="may-cobro-fecha" value="${hoyISO()}"></div>
        <div class="campo"><label>Método de pago</label><select id="may-cobro-metodo">${opts}</select></div>
      </div>
      <div class="modal-acciones">
        <button class="btn-sec" id="may-cobro-cancelar">Cancelar</button>
        <button class="btn-pri" id="may-cobro-guardar">Confirmar cobro</button>
      </div>`);
    document.getElementById('may-cobro-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('may-cobro-guardar').addEventListener('click', async () => {
      const btn = document.getElementById('may-cobro-guardar');
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        await API.put('/api/mayoristas/pagos/' + pagoId, {
          pagado: true,
          fecha_pago: document.getElementById('may-cobro-fecha').value || hoyISO(),
          metodo_pago: document.getElementById('may-cobro-metodo').value,
        });
        cerrarModal();
        toast('Pago marcado como cobrado', 'ok');
        await recargarPanel();
      } catch (e) { toast(e.message, 'error'); btn.disabled = false; btn.textContent = 'Confirmar cobro'; }
    });
  }

  async function desmarcarPago(pagoId) {
    if (!confirm('¿Desmarcar este cobro? Se borrará la fecha y el método de pago.')) return;
    try {
      await API.put('/api/mayoristas/pagos/' + pagoId, { pagado: false });
      toast('Cobro desmarcado', 'ok');
      await recargarPanel();
    } catch (e) { toast(e.message, 'error'); }
  }

  // ---- Generar factura de mayorista (elige razón social si hay más de una) ----
  async function generarFactura(pago, contrato) {
    if (!pago) return;
    let razones;
    try { razones = await API.get('/api/ajustes/razones-sociales'); }
    catch (e) { return toast(e.message, 'error'); }
    if (!razones || !razones.length) {
      return toast('Configura una razón social en Ajustes antes de facturar', 'error');
    }
    if (razones.length === 1) return crearFactura(pago, contrato, razones[0].id);

    // Varias razones sociales: mini-selector.
    const opts = razones.map((r) => `<option value="${r.id}">${esc(r.razon_social || r.nombre_comercial || ('Razón ' + r.id))}</option>`).join('');
    abrirModal(`
      <h3>🧾 Generar factura de mayorista</h3>
      <p>Pago ${pago.numero_pago} — ${euro(pago.importe)} (Contrato ${contrato.anio})</p>
      <div class="campo"><label>Razón social emisora</label><select id="may-fact-rs">${opts}</select></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="may-fact-cancelar">Cancelar</button>
        <button class="btn-pri" id="may-fact-guardar">Generar factura</button>
      </div>`);
    document.getElementById('may-fact-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('may-fact-guardar').addEventListener('click', () => {
      const rsId = Number(document.getElementById('may-fact-rs').value);
      cerrarModal();
      crearFactura(pago, contrato, rsId);
    });
  }

  async function crearFactura(pago, contrato, razonSocialId) {
    try {
      const r = await API.post('/api/facturas', {
        tipo: 'mayorista',
        razon_social_id: razonSocialId,
        anio: contrato.anio,
        mayorista_pago_ids: [pago.id],
      });
      toast(`Factura ${r.numero} generada`, 'ok');
      await recargarPanel();
    } catch (e) { toast(e.message, 'error'); }
  }

  // ---- Modal: gestionar mayoristas (CRUD) ----
  async function modalGestionar() {
    let lista;
    try { lista = await API.get('/api/mayoristas'); }
    catch (e) { return toast(e.message, 'error'); }
    const filas = lista.map((m) => `
      <tr>
        <td>${esc(m.nombre)}</td>
        <td>${esc(m.cif) || '—'}</td>
        <td>${m.activo ? '<span class="may-badge" style="background:#f0fdf4;color:#047857">Activo</span>' : '<span class="may-badge" style="background:#f3f4f6;color:#6b7280">Inactivo</span>'}</td>
        <td class="acciones">
          <button class="btn-mini" data-contrato-may="${m.id}" data-nombre="${esc(m.nombre)}">📄 Contrato</button>
          <button class="btn-mini" data-edit-may="${m.id}">✏️</button>
          <button class="btn-mini" data-del-may="${m.id}">🗑</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="4" class="est-vacio">Sin mayoristas</td></tr>';

    abrirModal(`
      <h3>⚙️ Gestionar mayoristas</h3>
      <div class="modal-acciones" style="justify-content:flex-start;margin:0 0 12px">
        <button class="btn-pri" id="may-gest-nuevo">＋ Nuevo mayorista</button>
      </div>
      <div class="tabla-scroll">
        <table class="tabla">
          <thead><tr><th>Nombre</th><th>CIF</th><th>Estado</th><th></th></tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
      <div class="modal-acciones"><button class="btn-sec" id="may-gest-cerrar">Cerrar</button></div>`);
    document.querySelector('.modal')?.classList.add('modal-ancho');
    document.getElementById('may-gest-cerrar').addEventListener('click', cerrarModal);
    document.getElementById('may-gest-nuevo').addEventListener('click', () => modalMayorista(null));
    document.querySelectorAll('[data-edit-may]').forEach((b) =>
      b.addEventListener('click', () => modalMayorista(lista.find((m) => m.id === Number(b.dataset.editMay)))));
    document.querySelectorAll('[data-del-may]').forEach((b) =>
      b.addEventListener('click', () => borrarMayorista(lista.find((m) => m.id === Number(b.dataset.delMay)))));
    document.querySelectorAll('[data-contrato-may]').forEach((b) =>
      b.addEventListener('click', () => modalNuevoContrato({ id: Number(b.dataset.contratoMay), nombre: b.dataset.nombre })));
  }

  function modalMayorista(m) {
    const esNuevo = !m;
    m = m || {};
    abrirModal(`
      <h3>${esNuevo ? '＋ Nuevo mayorista' : '✏️ Editar mayorista'}</h3>
      <div class="fila-campos">
        <div class="campo"><label>Nombre *</label><input id="mf-nombre" value="${esc(m.nombre)}"></div>
        <div class="campo"><label>CIF</label><input id="mf-cif" value="${esc(m.cif)}"></div>
      </div>
      <div class="campo"><label>Dirección</label><input id="mf-direccion" value="${esc(m.direccion)}"></div>
      <div class="fila-campos">
        <div class="campo"><label>Teléfono</label><input id="mf-telefono" value="${esc(m.telefono)}"></div>
        <div class="campo"><label>Email</label><input id="mf-email" value="${esc(m.email)}"></div>
      </div>
      <div class="campo"><label>Persona de contacto</label><input id="mf-contacto_nombre" value="${esc(m.contacto_nombre)}"></div>
      <div class="campo"><label>Notas</label><textarea id="mf-notas" rows="2">${esc(m.notas)}</textarea></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="mf-cancelar">Cancelar</button>
        <button class="btn-pri" id="mf-guardar">${esNuevo ? 'Crear' : 'Guardar'}</button>
      </div>`);
    document.getElementById('mf-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('mf-guardar').addEventListener('click', async () => {
      const v = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
      const nombre = v('mf-nombre');
      if (!nombre) return toast('El nombre es obligatorio', 'error');
      const body = {
        nombre, cif: v('mf-cif'), direccion: v('mf-direccion'), telefono: v('mf-telefono'),
        email: v('mf-email'), contacto_nombre: v('mf-contacto_nombre'), notas: v('mf-notas'),
      };
      const btn = document.getElementById('mf-guardar');
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        if (m.id) await API.put('/api/mayoristas/' + m.id, body);
        else await API.post('/api/mayoristas', body);
        cerrarModal();
        toast(m.id ? 'Mayorista actualizado' : 'Mayorista creado', 'ok');
        recargarMayoristas();
        // Si el panel está abierto sobre este mayorista, refrescar sus datos.
        if (mayPanelContratoId != null) await abrirPanelContrato(mayPanelContratoId);
      } catch (e) { toast(e.message, 'error'); btn.disabled = false; btn.textContent = m.id ? 'Guardar' : 'Crear'; }
    });
  }

  async function borrarMayorista(m) {
    if (!m) return;
    if (!confirm(`¿Eliminar el mayorista ${m.nombre}?`)) return;
    try {
      await API.del('/api/mayoristas/' + m.id);
      toast('Mayorista eliminado', 'ok');
      recargarMayoristas();
      modalGestionar(); // refresca la lista del modal
    } catch (e) { toast(e.message, 'error'); } // 409 si tiene contratos
  }

  // ---- Modal: nuevo contrato (con plan de pagos) ----
  // Estado del plan de pagos del modal (filas {fecha, importe}).
  let cPagos = [];

  function totalPagosModal() {
    return cPagos.reduce((s, p) => s + (Number(p.importe) || 0), 0);
  }
  function pintarPagosModal() {
    const cont = document.getElementById('mc-pagos');
    if (!cont) return;
    cont.innerHTML = cPagos.map((p, i) => `
      <div class="mc-pago-fila">
        <span class="mc-pago-num">${i + 1}</span>
        <input type="date" data-pago-fecha="${i}" value="${esc(p.fecha)}">
        <input type="number" min="0" step="0.01" data-pago-importe="${i}" value="${p.importe}" placeholder="0,00 €">
        <button class="btn-mini" data-pago-del="${i}" title="Eliminar">🗑</button>
      </div>`).join('') || '<div class="est-vacio" style="padding:10px">Sin pagos. Añade al menos uno.</div>';

    cont.querySelectorAll('[data-pago-fecha]').forEach((el) =>
      el.addEventListener('input', () => { cPagos[Number(el.dataset.pagoFecha)].fecha = el.value; }));
    cont.querySelectorAll('[data-pago-importe]').forEach((el) =>
      el.addEventListener('input', () => { cPagos[Number(el.dataset.pagoImporte)].importe = el.value; actualizarContadorModal(); }));
    cont.querySelectorAll('[data-pago-del]').forEach((el) =>
      el.addEventListener('click', () => { cPagos.splice(Number(el.dataset.pagoDel), 1); pintarPagosModal(); actualizarContadorModal(); }));
    actualizarContadorModal();
  }
  function actualizarContadorModal() {
    const cont = document.getElementById('mc-contador');
    if (!cont) return;
    const totalPagos = totalPagosModal();
    const totalContrato = Number(document.getElementById('mc-importe')?.value) || 0;
    const cuadra = Math.abs(totalPagos - totalContrato) < 0.01;
    cont.className = 'mc-contador ' + (cuadra && totalContrato > 0 ? 'mc-ok' : 'mc-mal');
    cont.textContent = `Total pagos: ${euro(totalPagos)} / ${euro(totalContrato)} del contrato`;
  }

  function modalNuevoContrato(mayorista) {
    cPagos = [];
    abrirModal(`
      <h3>＋ Nuevo contrato de mayorista</h3>
      <div class="campo"><label>Mayorista</label><input value="${esc(mayorista.nombre)}" disabled></div>
      <div class="fila-campos">
        <div class="campo"><label>Año *</label><input type="number" id="mc-anio" value="${anio}"></div>
        <div class="campo"><label>Importe total (€) *</label><input type="number" min="0" step="0.01" id="mc-importe" placeholder="0,00"></div>
      </div>
      <div class="campo"><label>Descripción</label><input id="mc-desc" placeholder="Cupo anual, garantía, etc."></div>
      <div class="mc-plan-cab">
        <span class="may-d-titulo-sec" style="margin:0">Plan de pagos</span>
        <div>
          <button class="btn-sec" id="mc-add">＋ Añadir pago</button>
          <button class="btn-sec" id="mc-distribuir">Distribuir automáticamente</button>
        </div>
      </div>
      <div id="mc-pagos" class="mc-pagos"></div>
      <div id="mc-contador" class="mc-contador mc-mal"></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="mc-cancelar">Cancelar</button>
        <button class="btn-pri" id="mc-guardar">Crear contrato</button>
      </div>`);
    document.querySelector('.modal')?.classList.add('modal-ancho');
    pintarPagosModal();

    document.getElementById('mc-importe').addEventListener('input', actualizarContadorModal);
    document.getElementById('mc-add').addEventListener('click', () => {
      cPagos.push({ fecha: hoyISO(), importe: '' });
      pintarPagosModal();
    });
    document.getElementById('mc-distribuir').addEventListener('click', () => {
      const total = Number(document.getElementById('mc-importe').value) || 0;
      if (!(total > 0)) return toast('Indica primero el importe total', 'error');
      if (!cPagos.length) { // sin filas: crear 2 pagos por defecto (hoy y +6 meses)
        const d = new Date(); const d2 = new Date(); d2.setMonth(d2.getMonth() + 6);
        cPagos = [{ fecha: d.toISOString().slice(0, 10), importe: '' }, { fecha: d2.toISOString().slice(0, 10), importe: '' }];
      }
      const n = cPagos.length;
      const base = Math.floor((total / n) * 100) / 100;
      cPagos.forEach((p, i) => { p.importe = (i === n - 1 ? Math.round((total - base * (n - 1)) * 100) / 100 : base); });
      pintarPagosModal();
    });
    document.getElementById('mc-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('mc-guardar').addEventListener('click', () => guardarContrato(mayorista.id));
  }

  async function guardarContrato(mayoristaId) {
    const anioC = parseInt(document.getElementById('mc-anio').value, 10);
    const importe = Number(document.getElementById('mc-importe').value) || 0;
    if (!anioC) return toast('El año es obligatorio', 'error');
    if (!(importe > 0)) return toast('El importe total debe ser mayor que 0', 'error');
    if (!cPagos.length) return toast('Añade al menos un pago', 'error');
    for (const p of cPagos) {
      if (!p.fecha) return toast('Todos los pagos necesitan fecha', 'error');
      if (!(Number(p.importe) > 0)) return toast('Todos los pagos necesitan un importe mayor que 0', 'error');
    }
    if (Math.abs(totalPagosModal() - importe) >= 0.01) {
      return toast('La suma de los pagos no cuadra con el importe total', 'error');
    }
    const body = {
      anio: anioC,
      descripcion: document.getElementById('mc-desc').value.trim(),
      importe_total: importe,
      pagos: cPagos.map((p, i) => ({ numero_pago: i + 1, fecha_prevista: p.fecha, importe: Number(p.importe) })),
    };
    const btn = document.getElementById('mc-guardar');
    btn.disabled = true; btn.textContent = 'Creando…';
    try {
      await API.post('/api/mayoristas/' + mayoristaId + '/contratos', body);
      cerrarModal();
      toast('Contrato creado', 'ok');
      recargarMayoristas();
    } catch (e) { toast(e.message, 'error'); btn.disabled = false; btn.textContent = 'Crear contrato'; } // 409 año duplicado
  }

  // ---- Modal: editar contrato existente (plan de pagos precargado) ----
  function modalEditarContrato(contrato, may) {
    const tieneCobradog = (contrato.pagos || []).some((p) => p.pagado);
    cPagos = (contrato.pagos || []).map((p) => ({ fecha: p.fecha_prevista, importe: p.importe }));
    const avisoCobradog = tieneCobradog
      ? `<div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:6px;padding:10px 14px;margin-bottom:12px;font-size:13px;color:#92400e">
           ⚠️ Los pagos ya cobrados también se pueden editar, pero no se recomienda modificar fecha/importe una vez cobrados.
         </div>`
      : '';
    abrirModal(`
      <h3>✏️ Editar plan de pagos</h3>
      <div class="campo"><label>Mayorista</label><input value="${esc(may.nombre)}" disabled></div>
      ${avisoCobradog}
      <div class="fila-campos">
        <div class="campo"><label>Año *</label><input type="number" id="mc-anio" value="${contrato.anio}"></div>
        <div class="campo"><label>Importe total (€) *</label><input type="number" min="0" step="0.01" id="mc-importe" value="${contrato.importe_total}" placeholder="0,00"></div>
      </div>
      <div class="campo"><label>Descripción</label><input id="mc-desc" value="${esc(contrato.descripcion || '')}"></div>
      <div class="mc-plan-cab">
        <span class="may-d-titulo-sec" style="margin:0">Plan de pagos</span>
        <div>
          <button class="btn-sec" id="mc-add">＋ Añadir pago</button>
          <button class="btn-sec" id="mc-distribuir">Distribuir automáticamente</button>
        </div>
      </div>
      <div id="mc-pagos" class="mc-pagos"></div>
      <div id="mc-contador" class="mc-contador mc-mal"></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="mc-cancelar">Cancelar</button>
        <button class="btn-pri" id="mc-guardar">Guardar cambios</button>
      </div>`);
    document.querySelector('.modal')?.classList.add('modal-ancho');
    pintarPagosModal();

    document.getElementById('mc-importe').addEventListener('input', actualizarContadorModal);
    document.getElementById('mc-add').addEventListener('click', () => {
      cPagos.push({ fecha: hoyISO(), importe: '' });
      pintarPagosModal();
    });
    document.getElementById('mc-distribuir').addEventListener('click', () => {
      const total = Number(document.getElementById('mc-importe').value) || 0;
      if (!(total > 0)) return toast('Indica primero el importe total', 'error');
      if (!cPagos.length) {
        const d = new Date(); const d2 = new Date(); d2.setMonth(d2.getMonth() + 6);
        cPagos = [{ fecha: d.toISOString().slice(0, 10), importe: '' }, { fecha: d2.toISOString().slice(0, 10), importe: '' }];
      }
      const n = cPagos.length;
      const base = Math.floor((total / n) * 100) / 100;
      cPagos.forEach((p, i) => { p.importe = i === n - 1 ? Math.round((total - base * (n - 1)) * 100) / 100 : base; });
      pintarPagosModal();
    });
    document.getElementById('mc-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('mc-guardar').addEventListener('click', () => editarContrato(contrato.id));
  }

  async function editarContrato(contratoId) {
    const anioC = parseInt(document.getElementById('mc-anio').value, 10);
    const importe = Number(document.getElementById('mc-importe').value) || 0;
    if (!anioC) return toast('El año es obligatorio', 'error');
    if (!(importe > 0)) return toast('El importe total debe ser mayor que 0', 'error');
    if (!cPagos.length) return toast('Añade al menos un pago', 'error');
    for (const p of cPagos) {
      if (!p.fecha) return toast('Todos los pagos necesitan fecha', 'error');
      if (!(Number(p.importe) > 0)) return toast('Todos los pagos necesitan un importe mayor que 0', 'error');
    }
    if (Math.abs(totalPagosModal() - importe) >= 0.01) {
      return toast('La suma de los pagos no cuadra con el importe total', 'error');
    }
    const body = {
      anio: anioC,
      descripcion: document.getElementById('mc-desc').value.trim(),
      importe_total: importe,
      pagos: cPagos.map((p, i) => ({ numero_pago: i + 1, fecha_prevista: p.fecha, importe: Number(p.importe) })),
    };
    const btn = document.getElementById('mc-guardar');
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      await API.put('/api/mayoristas/contratos/' + contratoId, body);
      cerrarModal();
      toast('Contrato actualizado', 'ok');
      await recargarPanel();
    } catch (e) { toast(e.message, 'error'); btn.disabled = false; btn.textContent = 'Guardar cambios'; }
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
    if (seccionActiva === 'pagos') { renderPagosSeccion(panel); return; }
    if (seccionActiva === 'mayorista') { renderMayoristas(panel); return; }
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

  // Las sub-pestañas "Propietarios" (4ª) y "Mayoristas" (5ª) y sus paneles se inyectan por
  // JS (index.html no se toca).
  function inyectarSub(sub, etiqueta) {
    const subtabs = document.getElementById('est-subtabs');
    if (subtabs && !subtabs.querySelector(`[data-sub="${sub}"]`)) {
      const btn = document.createElement('button');
      btn.className = 'subtab';
      btn.dataset.sub = sub;
      btn.textContent = etiqueta;
      subtabs.appendChild(btn);
    }
    const scroll = document.querySelector('#vista-estadisticas .est-scroll');
    if (scroll && !scroll.querySelector(`[data-panel-sub="${sub}"]`)) {
      const panel = document.createElement('div');
      panel.className = 'sub-panel';
      panel.dataset.panelSub = sub;
      scroll.appendChild(panel);
    }
  }
  function inyectarSubPropietarios() {
    inyectarSub('propietario', 'Propietarios');
    inyectarSub('pagos', 'Pagos propietario');
    inyectarSub('mayorista', 'Mayoristas');
  }

  function init() {
    poblarAnios();
    inyectarSubPropietarios(); // antes de cablear los listeners de las sub-pestañas
    const sel = document.getElementById('est-anio');
    if (sel) sel.addEventListener('change', () => {
      anio = Number(sel.value);
      aptoSel = null; aptoCache = null; aptoBuscar = ''; // el año invalida los datos cacheados
      propCache = null; propBuscar = '';
      pagosCuentaCache = null;
      mayCache = null;
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
