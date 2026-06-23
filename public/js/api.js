// Helpers de acceso a la API REST y utilidades comunes de UI.

// Cabecera de autenticación leída de la sesión guardada en localStorage.
function authHeaders() {
  try {
    const s = JSON.parse(localStorage.getItem('crm-sesion'));
    return s && s.token ? { 'X-Auth-Token': s.token } : {};
  } catch (e) {
    return {};
  }
}

const API = {
  async get(url) {
    const r = await fetch(url, { headers: authHeaders() });
    if (!r.ok) throw await error(r);
    return r.json();
  },
  async post(url, body) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw await error(r);
    return r.json();
  },
  async put(url, body) {
    const r = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw await error(r);
    return r.json();
  },
  async del(url) {
    const r = await fetch(url, { method: 'DELETE', headers: authHeaders() });
    if (!r.ok) throw await error(r);
    return r.json();
  },
  async subirArchivo(url, file) {
    const fd = new FormData();
    fd.append('archivo', file);
    const r = await fetch(url, { method: 'POST', body: fd, headers: authHeaders() });
    if (!r.ok) throw await error(r);
    return r.json();
  },
  // Lista de portales cacheada en memoria (varios módulos la comparten sin repetir la llamada).
  async getPortales() {
    if (_portalesCache) return _portalesCache;
    _portalesCache = await this.get('/api/portales');
    return _portalesCache;
  },
  // Borra el caché de portales: tras crear/editar/borrar un portal en Ajustes, para que
  // planning/reservas vuelvan a leer la lista actualizada sin recargar la página (F5).
  invalidarPortales() { _portalesCache = null; },
};

// Caché en memoria de la lista de portales (se limpia al recargar la página).
let _portalesCache = null;

async function error(r) {
  // Sesión inválida/expirada: avisar al gestor de autenticación para volver al login.
  if (r.status === 401 && typeof window.onNoAutorizado === 'function') {
    window.onNoAutorizado();
  }
  let msg = 'Error ' + r.status;
  try {
    const data = await r.json();
    if (data && data.error) msg = data.error;
  } catch (e) {}
  const e = new Error(msg);
  e.status = r.status;
  return e;
}

// ===== Toast =====
let toastTimer = null;
function toast(mensaje, tipo = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = mensaje;
  el.className = 'toast ' + tipo;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('oculto'), 3500);
}

// ===== Modal =====
function abrirModal(html) {
  document.getElementById('modal-contenido').innerHTML = html;
  // Cada modal arranca con el ancho por defecto; quien lo necesite añade .modal-ancho.
  document.querySelector('.modal').classList.remove('modal-ancho');
  document.getElementById('modal-fondo').classList.remove('oculto');
}
function cerrarModal() {
  document.getElementById('modal-fondo').classList.add('oculto');
  document.getElementById('modal-contenido').innerHTML = '';
}

// ===== Utilidades =====
function tihTexto(t) {
  if (t === '1' || t === 1) return '1ª Línea';
  if (t === '2' || t === 2) return '2ª Línea';
  return '—';
}
function fechaES(iso) {
  if (!iso) return '—';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ===== flatpickr: sustituye los date inputs nativos por un calendario propio =====
// Muestra DD/MM/YYYY al usuario (altInput) pero conserva YYYY-MM-DD en el input real,
// así el resto del CRM sigue leyendo/enviando ISO sin cambios.
API.initDatePickers = function (container) {
  if (typeof flatpickr === 'undefined') return;
  const inputs = (container || document).querySelectorAll('input[type="date"]:not(.flatpickr-input)');
  inputs.forEach((input) => {
    flatpickr(input, {
      locale: 'es',
      dateFormat: 'Y-m-d',
      altInput: true,
      altFormat: 'd/m/Y',
      allowInput: true,
      disableMobile: true,
    });
  });
};

// Auto-inicializa flatpickr en cualquier input[type=date] nuevo que aparezca en el DOM
// (modales, paneles laterales, contenido renderizado) sin tocar cada módulo. Debounce
// para no escanear el documento en cada mutación.
let _fpTimer = null;
const _fpObserver = new MutationObserver(() => {
  clearTimeout(_fpTimer);
  _fpTimer = setTimeout(() => {
    if (document.querySelector('input[type="date"]:not(.flatpickr-input)')) API.initDatePickers();
  }, 50);
});
function _fpStart() { _fpObserver.observe(document.body, { childList: true, subtree: true }); API.initDatePickers(); }
if (document.body) _fpStart();
else document.addEventListener('DOMContentLoaded', _fpStart);
