// Módulo Dashboard: pantalla de inicio con 4 tarjetas (pagos pendientes, próximos
// check-in, reservas en curso, próximos check-out). Carga GET /api/dashboard +
// API.getPortales() en paralelo, con skeleton, manejo de error y refresco cada 5 min.

const Dashboard = (() => {
  const POR_PAGINA = 5;
  const REFRESCO_MS = 5 * 60 * 1000;

  let datos = null;
  let portalesMap = {};
  let intervalo = null;
  const paginas = { checkin: 0, encurso: 0, checkout: 0 };

  // ---- Utilidades de formato ----
  function euro(n) {
    return (Number(n) || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }
  function ddmm(iso) {
    if (!iso) return '';
    const p = String(iso).split('-');
    return p.length === 3 ? `${p[2]}/${p[1]}` : iso;
  }
  function estadoClase(e) {
    const t = (e || '').toLowerCase();
    return t === 'asignado' ? 'asignado' : t === 'completado' ? 'completado' : 'pendiente';
  }
  function estadoBadge(e) {
    return `<span class="dash-estado ${estadoClase(e)}">${esc(e) || 'Pendiente'}</span>`;
  }
  function portalBadge(nombre) {
    if (!nombre) return '';
    const info = portalesMap[nombre] || {};
    const estilo = info.color ? ` style="background:${esc(info.color)};color:#fff;border-color:${esc(info.color)}"` : '';
    return `<span class="dash-portal"${estilo}>${esc(nombre)}</span>`;
  }

  // ---- Render de un ítem de lista ----
  function itemHTML(r, usaSalida) {
    const fecha = usaSalida ? r.salida : r.entrada;
    const hora = usaSalida ? r.hora_salida : r.hora_entrada;
    const estado = usaSalida ? r.checkout_estado : r.checkin_estado;
    const apto = r.apartamento_nombre
      ? esc(r.apartamento_nombre)
      : '<span class="dash-vacio">Sin asignar</span>';
    return `
      <div class="dash-item">
        <div class="dash-item-l1">
          <span class="dash-cliente">${esc(r.nombre_cliente) || '—'}</span>
          <span class="dash-fecha">${ddmm(fecha)}${hora ? ' · ' + esc(hora) : ''}</span>
        </div>
        <div class="dash-item-l2">${apto}</div>
        <div class="dash-item-l3">${estadoBadge(estado)}${portalBadge(r.portal)}</div>
      </div>`;
  }

  // ---- Paginación (misma estética que la tabla de reservas) ----
  function paginacionHTML(clave, totalPag, pag) {
    let nums = '';
    for (let i = 0; i < totalPag; i++) {
      nums += `<button class="dash-pag-num${i === pag ? ' activo' : ''}" data-pag-clave="${clave}" data-pag-idx="${i}">${i + 1}</button>`;
    }
    return `
      <div class="dash-paginacion">
        <button class="dash-pag-btn" data-pag-clave="${clave}" data-pag-idx="0" ${pag === 0 ? 'disabled' : ''}>«</button>
        <button class="dash-pag-btn" data-pag-clave="${clave}" data-pag-idx="${pag - 1}" ${pag === 0 ? 'disabled' : ''}>‹</button>
        ${nums}
        <button class="dash-pag-btn" data-pag-clave="${clave}" data-pag-idx="${pag + 1}" ${pag >= totalPag - 1 ? 'disabled' : ''}>›</button>
        <button class="dash-pag-btn" data-pag-clave="${clave}" data-pag-idx="${totalPag - 1}" ${pag >= totalPag - 1 ? 'disabled' : ''}>»</button>
      </div>`;
  }

  // ---- Cabecera + contenedor de una tarjeta ----
  function cardShell({ icono, color, titulo, subtitulo, count, body }) {
    return `
      <div class="dash-card">
        <div class="dash-card-head">
          <span class="dash-icono" style="background:${color}">${icono}</span>
          <div class="dash-head-text">
            <div class="dash-titulo">${titulo} <span class="dash-count" style="background:${color}">${count}</span></div>
            <div class="dash-sub">${subtitulo}</div>
          </div>
        </div>
        <div class="dash-card-body">${body}</div>
      </div>`;
  }

  // ---- Tarjeta de lista (check-in / en curso / check-out) ----
  function cardLista({ clave, icono, color, titulo, subtitulo, items, usaSalida, verTodas }) {
    const total = items.length;
    const totalPag = Math.max(1, Math.ceil(total / POR_PAGINA));
    const pag = Math.min(paginas[clave] || 0, totalPag - 1);
    paginas[clave] = pag;
    const slice = items.slice(pag * POR_PAGINA, pag * POR_PAGINA + POR_PAGINA);

    let body = total === 0
      ? '<div class="dash-vacio-lista">Sin registros</div>'
      : slice.map((r) => itemHTML(r, usaSalida)).join('');
    if (total > POR_PAGINA) body += paginacionHTML(clave, totalPag, pag);
    if (verTodas) body += '<a class="dash-vertodas" data-vertodas="1">Ver todas →</a>';

    return cardShell({ icono, color, titulo, subtitulo, count: total, body });
  }

  // ---- Tarjeta de pagos pendientes ----
  function cardPagos(p) {
    const body = p.total > 0
      ? `<div class="dash-importe">${euro(p.total)}</div>`
      : '<div class="dash-vacio-lista">Sin pagos pendientes</div>';
    return cardShell({ icono: '€', color: '#eab308', titulo: 'Pagos pendientes', subtitulo: 'Importe total pendiente', count: p.count, body });
  }

  // ---- Render completo ----
  function render() {
    const cont = document.getElementById('dashboard');
    if (!cont || !datos) return;
    cont.innerHTML =
      cardPagos(datos.pagos_pendientes) +
      cardLista({ clave: 'checkin', icono: '↓', color: '#10b981', titulo: 'Próximos Check-in', subtitulo: 'Próximos 7 días', items: datos.proximos_checkin, usaSalida: false }) +
      cardLista({ clave: 'encurso', icono: '●', color: '#3b82f6', titulo: 'Reservas en curso', subtitulo: 'Hoy', items: datos.reservas_en_curso, usaSalida: true, verTodas: true }) +
      cardLista({ clave: 'checkout', icono: '↑', color: '#f97316', titulo: 'Próximos Check-out', subtitulo: 'Próximos 7 días', items: datos.proximos_checkout, usaSalida: true });
    bindEventos();
  }

  function bindEventos() {
    document.querySelectorAll('#dashboard [data-pag-idx]').forEach((b) =>
      b.addEventListener('click', () => {
        paginas[b.dataset.pagClave] = Number(b.dataset.pagIdx);
        render();
      }));
    const vt = document.querySelector('#dashboard [data-vertodas]');
    if (vt) vt.addEventListener('click', verTodasReservas);
  }

  // Navega a Reservas con el filtro del mes actual (sin tocar el módulo Reservas).
  function verTodasReservas() {
    const hoy = new Date();
    const mes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
    if (typeof activarTab === 'function') activarTab('reservas');
    const sel = document.getElementById('reservas-filtro-mes');
    if (sel) {
      sel.value = mes;
      sel.dispatchEvent(new Event('change'));
    }
  }

  // ---- Skeleton de carga ----
  function renderSkeleton() {
    const cont = document.getElementById('dashboard');
    if (!cont) return;
    const tarjeta = `
      <div class="dash-card">
        <div class="dash-card-head">
          <span class="skeleton sk-icono"></span>
          <div class="dash-head-text" style="flex:1">
            <span class="skeleton sk-linea" style="width:60%"></span>
            <span class="skeleton sk-linea" style="width:40%;margin-top:6px"></span>
          </div>
        </div>
        <div class="dash-card-body">${'<span class="skeleton sk-bloque"></span>'.repeat(4)}</div>
      </div>`;
    cont.innerHTML = tarjeta.repeat(4);
  }

  function renderError(msg) {
    const cont = document.getElementById('dashboard');
    if (!cont) return;
    cont.innerHTML = `
      <div class="dash-error">
        <p>No se pudo cargar el dashboard.</p>
        <p class="dash-error-msg">${esc(msg)}</p>
        <button class="btn-pri" id="dash-reintentar">Reintentar</button>
      </div>`;
    document.getElementById('dash-reintentar').addEventListener('click', cargar);
  }

  // ---- Carga de datos ----
  async function obtenerDatos() {
    const [d, portales] = await Promise.all([API.get('/api/dashboard'), API.getPortales()]);
    datos = d;
    portalesMap = {};
    for (const p of portales) portalesMap[p.nombre] = { color: p.color, imagen_url: p.imagen_url };
  }

  async function cargar() {
    renderSkeleton();
    try {
      await obtenerDatos();
      render();
    } catch (e) {
      renderError(e.message);
    }
    programarRefresco();
  }

  // Refresco automático cada 5 minutos (silencioso; conserva la paginación).
  function programarRefresco() {
    if (intervalo) return;
    intervalo = setInterval(async () => {
      try {
        await obtenerDatos();
        render();
      } catch (e) { /* en auto-refresco no molestamos al usuario */ }
    }, REFRESCO_MS);
  }

  function init() { /* nada que enlazar en carga; todo se construye en cargar() */ }

  return { init, cargar };
})();
