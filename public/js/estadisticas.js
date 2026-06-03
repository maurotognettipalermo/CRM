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
  };
  const ANIOS = [2024, 2025, 2026];

  let seccionActiva = 'portal';
  let anio = new Date().getFullYear();
  let reqSeq = 0; // descarta respuestas obsoletas si se cambia de año/sección rápido

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

  function skeletonPortales() {
    const card = '<div class="est-card"><span class="skeleton sk-icono"></span><div class="est-card-info" style="flex:1"><span class="skeleton sk-linea" style="width:50%"></span><span class="skeleton sk-linea" style="width:70%;margin-top:8px"></span></div></div>';
    const filas = '<span class="skeleton sk-bloque"></span>'.repeat(5);
    return `<div class="est-cards">${card.repeat(2)}</div><div class="est-skeleton-tabla">${filas}</div>`;
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
    panel.innerHTML = skeletonPortales();
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

  // ---- Render del contenido de la sección activa ----
  function renderSeccion() {
    const panel = document.querySelector(
      `#vista-estadisticas .sub-panel[data-panel-sub="${seccionActiva}"]`
    );
    if (!panel) return;
    if (seccionActiva === 'portal') { renderPortales(panel); return; }
    panel.innerHTML = placeholderHTML(SECCIONES[seccionActiva]);
  }

  // ---- Cambio de sub-pestaña ----
  function activarSub(sub) {
    if (!SECCIONES[sub]) return;
    seccionActiva = sub;
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

  function init() {
    poblarAnios();
    const sel = document.getElementById('est-anio');
    if (sel) sel.addEventListener('change', () => {
      anio = Number(sel.value);
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
