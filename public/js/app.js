// Inicialización general y navegación entre pestañas.

document.addEventListener('DOMContentLoaded', () => {
  // Formulario de login.
  document.getElementById('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    Auth.login(
      document.getElementById('login-username').value.trim(),
      document.getElementById('login-password').value
    );
  });

  // Navegación del menú lateral.
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.addEventListener('click', () => activarTab(item.dataset.tab));
  });

  // Sidebar plegable (recuerda el estado en localStorage).
  const sidebar = document.getElementById('sidebar');
  if (localStorage.getItem('sidebar-colapsado') === '1') sidebar.classList.add('colapsado');
  document.getElementById('sidebar-toggle').addEventListener('click', () => {
    sidebar.classList.toggle('colapsado');
    localStorage.setItem('sidebar-colapsado', sidebar.classList.contains('colapsado') ? '1' : '0');
  });

  // Cierre del modal.
  document.getElementById('modal-cerrar').addEventListener('click', cerrarModal);
  document.getElementById('modal-fondo').addEventListener('click', (e) => {
    if (e.target.id === 'modal-fondo') cerrarModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cerrarModal();
  });

  // Cerrar sesión.
  document.getElementById('su-logout').addEventListener('click', () => Auth.logout());

  // Arranque según haya o no sesión válida.
  if (Auth.tieneSesion()) {
    Auth.ocultarLogin();
    arrancarApp();
  } else {
    Auth.mostrarLogin();
  }
});

// Inicializa los módulos y carga la vista inicial (solo con sesión activa).
function arrancarApp() {
  const s = Auth.sesion() || {};
  const nombre = s.nombre || s.username || '';
  document.getElementById('su-avatar').textContent = (nombre || '?').trim().charAt(0).toUpperCase();
  document.getElementById('su-nombre').textContent = nombre;

  // Estadísticas es solo para administradores: el ítem del sidebar se muestra según el rol.
  document.getElementById('nav-estadisticas').classList.toggle('oculto', !Auth.esAdmin());

  Dashboard.init();
  Planning.init();
  Alojamientos.init();
  Contratos.init();
  Propietarios.init();
  Reservas.init();
  Ajustes.init();
  Estadisticas.init();

  // Dashboard es la vista por defecto al entrar.
  Dashboard.cargar().catch((e) => toast(e.message, 'error'));
}

function activarTab(nombre) {
  // Estadísticas está restringida a administradores (también frente a acceso directo).
  if (nombre === 'estadisticas' && !Auth.esAdmin()) {
    toast('Acceso restringido a administradores', 'error');
    return;
  }

  document.querySelectorAll('.nav-item').forEach((t) =>
    t.classList.toggle('activo', t.dataset.tab === nombre)
  );
  document.querySelectorAll('.vista').forEach((v) => v.classList.remove('activa'));
  document.getElementById('vista-' + nombre).classList.add('activa');

  if (nombre === 'dashboard')    Dashboard.cargar().catch((e) => toast(e.message, 'error'));
  if (nombre === 'planning') Planning.cargar().catch((e) => toast(e.message, 'error'));
  if (nombre === 'alojamientos') Alojamientos.cargar().catch((e) => toast(e.message, 'error'));
  if (nombre === 'contratos')    Contratos.cargar().catch((e) => toast(e.message, 'error'));
  if (nombre === 'propietarios') Propietarios.cargar().catch((e) => toast(e.message, 'error'));
  if (nombre === 'reservas')     Reservas.cargar().catch((e) => toast(e.message, 'error'));
  if (nombre === 'estadisticas') Estadisticas.cargar().catch((e) => toast(e.message, 'error'));
  if (nombre === 'ajustes')      Ajustes.cargar().catch((e) => toast(e.message, 'error'));
}
