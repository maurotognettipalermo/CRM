// Gestión de autenticación en el frontend: sesión en localStorage, pantalla de
// login a pantalla completa y cierre de sesión.

const Auth = (() => {
  const KEY = 'crm-sesion';

  function sesion() {
    try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; }
  }
  function tieneSesion() {
    const s = sesion();
    return !!(s && s.token);
  }
  function esAdmin() {
    const s = sesion();
    return !!(s && s.rol === 'administrador');
  }

  function mostrarLogin() {
    document.getElementById('login-overlay').classList.remove('oculto');
    const u = document.getElementById('login-username');
    if (u) u.focus();
  }
  function ocultarLogin() {
    document.getElementById('login-overlay').classList.add('oculto');
  }

  // Login con fetch propio (no usa API.* para no disparar el manejador global de 401).
  async function login(username, password) {
    const errEl = document.getElementById('login-error');
    errEl.classList.add('oculto');
    let data;
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      data = await r.json();
    } catch (e) {
      errEl.textContent = 'No se pudo conectar con el servidor';
      errEl.classList.remove('oculto');
      return;
    }
    if (!data.ok) {
      errEl.textContent = data.error || 'Error de acceso';
      errEl.classList.remove('oculto');
      return;
    }
    localStorage.setItem(KEY, JSON.stringify({
      userId: data.userId, username: data.username, nombre: data.nombre,
      rol: data.rol, token: data.token,
    }));
    // Recarga para arrancar la app limpia ya con sesión.
    window.location.reload();
  }

  async function logout() {
    try { await API.post('/api/auth/logout', {}); } catch (e) { /* da igual */ }
    cerrarSesionLocal();
  }

  // Limpia la sesión local y vuelve al login (también lo usa el manejador de 401).
  function cerrarSesionLocal() {
    localStorage.removeItem(KEY);
    window.location.reload();
  }

  return { sesion, tieneSesion, esAdmin, mostrarLogin, ocultarLogin, login, logout, cerrarSesionLocal };
})();

// Cualquier 401 en una llamada a la API devuelve al login.
window.onNoAutorizado = () => Auth.cerrarSesionLocal();
