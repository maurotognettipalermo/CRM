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

  // Overlay oscuro tras el sidebar abierto en móvil: al pulsarlo se cierra.
  // (En móvil la clase .colapsado = sidebar ABIERTO; el CSS muestra el overlay
  // solo cuando está abierto y en viewport estrecho.)
  const sidebarOverlay = document.createElement('div');
  sidebarOverlay.id = 'sidebar-overlay';
  document.body.appendChild(sidebarOverlay);
  sidebarOverlay.addEventListener('click', cerrarSidebarMovil);

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
  // - Roles de acceso único (limpieza, mantenimiento): solo ven su propio módulo.
  document.getElementById('nav-estadisticas').classList.toggle('oculto', rol !== 'administrador');
  const soloTab = SOLO_TAB[rol];
  if (soloTab) {
    document.querySelectorAll('.nav-item').forEach((it) =>
      it.classList.toggle('oculto', it.dataset.tab !== soloTab));
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
  Mantenimiento.init();
  Ventas.init();

  // Vista por defecto: su propio módulo para roles de acceso único, Dashboard para el resto.
  if (soloTab) activarTab(soloTab);
  else Dashboard.cargar().catch((e) => toast(e.message, 'error'));
}

// Roles con acceso restringido a un único módulo (clave = rol, valor = pestaña permitida).
const SOLO_TAB = { limpieza: 'limpieza', mantenimiento: 'mantenimiento' };

// En móvil cierra el sidebar (en móvil la clase .colapsado = abierto, así que cerrar
// = quitarla). No-op en escritorio, donde .colapsado es el modo "icono".
function cerrarSidebarMovil() {
  if (window.innerWidth >= 768) return;
  const sb = document.getElementById('sidebar');
  if (sb && sb.classList.contains('colapsado')) {
    sb.classList.remove('colapsado');
    localStorage.setItem('sidebar-colapsado', '0');
  }
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
    mantenimiento: ['Mantenimiento', 'rol-mantenimiento'],
  };
  const x = map[rol] || map.usuario;
  badge.className = 'sidebar-rol-badge nav-texto ' + x[1];
  badge.textContent = x[0];
}

function activarTab(nombre) {
  const rol = (Auth.sesion() || {}).rol;

  // Roles de acceso único (limpieza, mantenimiento): solo su propio módulo.
  const soloTab = SOLO_TAB[rol];
  if (soloTab && nombre !== soloTab) {
    toast('No tienes acceso a esta sección', 'error');
    nombre = soloTab;
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

  // En móvil, navegar cierra el sidebar deslizable.
  cerrarSidebarMovil();

  if (nombre === 'dashboard')    Dashboard.cargar().catch((e) => toast(e.message, 'error'));
  if (nombre === 'planning') Planning.cargar().catch((e) => toast(e.message, 'error'));
  if (nombre === 'alojamientos') Alojamientos.cargar().catch((e) => toast(e.message, 'error'));
  if (nombre === 'contratos')    Contratos.cargar().catch((e) => toast(e.message, 'error'));
  if (nombre === 'facturacion')  Facturas.cargar().catch((e) => toast(e.message, 'error'));
  if (nombre === 'tarifas')      Tarifas.cargar().catch((e) => toast(e.message, 'error'));
  if (nombre === 'ventas')       Ventas.cargar().catch((e) => toast(e.message, 'error'));
  if (nombre === 'propietarios') Propietarios.cargar().catch((e) => toast(e.message, 'error'));
  if (nombre === 'reservas')     Reservas.cargar().catch((e) => toast(e.message, 'error'));
  if (nombre === 'estadisticas') Estadisticas.cargar().catch((e) => toast(e.message, 'error'));
  if (nombre === 'limpieza')     Limpieza.cargar().catch((e) => toast(e.message, 'error'));
  if (nombre === 'mantenimiento') Mantenimiento.cargar().catch((e) => toast(e.message, 'error'));
  if (nombre === 'ajustes')      Ajustes.cargar().catch((e) => toast(e.message, 'error'));
}
