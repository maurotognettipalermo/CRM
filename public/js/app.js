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

  const rol = s.rol;
  pintarBadgeRol(rol);

  // Visibilidad de pestañas según rol.
  // - Estadísticas: solo administradores.
  // - Rol 'limpieza': solo ve el módulo de Limpieza; el resto se oculta.
  document.getElementById('nav-estadisticas').classList.toggle('oculto', rol !== 'administrador');
  if (rol === 'limpieza') {
    document.querySelectorAll('.nav-item').forEach((it) =>
      it.classList.toggle('oculto', it.dataset.tab !== 'limpieza'));
  }

  Dashboard.init();
  Planning.init();
  Alojamientos.init();
  Contratos.init();
  Facturas.init();
  Tarifas.init();
  Propietarios.init();
  Reservas.init();
  Ajustes.init();
  Estadisticas.init();
  Limpieza.init();

  // Vista por defecto: Limpieza para el rol limpieza, Dashboard para el resto.
  if (rol === 'limpieza') activarTab('limpieza');
  else Dashboard.cargar().catch((e) => toast(e.message, 'error'));
}

// Pinta (o actualiza) el badge de rol bajo el nombre en el sidebar.
function pintarBadgeRol(rol) {
  const footer = document.querySelector('.sidebar-footer');
  if (!footer) return;
  let badge = document.getElementById('su-rol');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'su-rol';
    const user = footer.querySelector('.sidebar-user');
    if (user) user.insertAdjacentElement('afterend', badge);
    else footer.prepend(badge);
  }
  const map = {
    administrador: ['Admin', 'rol-admin'],
    usuario: ['Usuario', 'rol-usuario'],
    limpieza: ['Limpieza', 'rol-limpieza'],
  };
  const x = map[rol] || map.usuario;
  badge.className = 'sidebar-rol-badge nav-texto ' + x[1];
  badge.textContent = x[0];
}

function activarTab(nombre) {
  const rol = (Auth.sesion() || {}).rol;

  // Rol 'limpieza': solo puede acceder al módulo de Limpieza.
  if (rol === 'limpieza' && nombre !== 'limpieza') {
    toast('No tienes acceso a esta sección', 'error');
    nombre = 'limpieza';
  }

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
  if (nombre === 'facturacion')  Facturas.cargar().catch((e) => toast(e.message, 'error'));
  if (nombre === 'tarifas')      Tarifas.cargar().catch((e) => toast(e.message, 'error'));
  if (nombre === 'propietarios') Propietarios.cargar().catch((e) => toast(e.message, 'error'));
  if (nombre === 'reservas')     Reservas.cargar().catch((e) => toast(e.message, 'error'));
  if (nombre === 'estadisticas') Estadisticas.cargar().catch((e) => toast(e.message, 'error'));
  if (nombre === 'limpieza')     Limpieza.cargar().catch((e) => toast(e.message, 'error'));
  if (nombre === 'ajustes')      Ajustes.cargar().catch((e) => toast(e.message, 'error'));
}
