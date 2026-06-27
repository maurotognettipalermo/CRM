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

  // Grupos colapsables del sidebar (estado recordado en localStorage).
  inicializarGruposSidebar();

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
  const restr = ROL_RESTRINGIDO[rol];
  if (restr) {
    document.querySelectorAll('.nav-item').forEach((it) =>
      it.classList.toggle('oculto', !restr.permitidas.includes(it.dataset.tab)));
  }
  // Oculta los grupos que se quedan sin ítems visibles (p. ej. roles restringidos).
  ocultarGruposVacios();

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
  Leads.init();
  ClientesAlquiler.init();
  Personal.init();

  // Vista por defecto: su módulo principal para roles restringidos, Dashboard para el resto.
  if (restr) activarTab(restr.principal);
  else Dashboard.cargar().catch((e) => toast(e.message, 'error'));
}

// Roles con acceso restringido. `principal` = vista por defecto; `permitidas` = pestañas
// que pueden ver (su módulo + Personal, para poder fichar).
const ROL_RESTRINGIDO = {
  limpieza: { principal: 'limpieza', permitidas: ['limpieza', 'personal'] },
  mantenimiento: { principal: 'mantenimiento', permitidas: ['mantenimiento', 'personal'] },
};

// Estado por defecto de los grupos del sidebar (true = abierto).
const GRUPOS_DEFAULT = { alquiler: true, administracion: false, equipo: false };

// Aplica el estado guardado a los grupos y cablea el clic en sus cabeceras.
function inicializarGruposSidebar() {
  let estado = {};
  try { estado = JSON.parse(localStorage.getItem('sidebar-grupos')) || {}; } catch (e) { estado = {}; }
  document.querySelectorAll('.nav-group').forEach((g) => {
    const key = g.dataset.group;
    const abierto = key in estado ? !!estado[key] : (GRUPOS_DEFAULT[key] !== false);
    g.classList.toggle('open', abierto);
    g.classList.toggle('closed', !abierto);
    const header = g.querySelector('.nav-group-header');
    if (!header) return;
    header.addEventListener('click', () => toggleGrupoSidebar(g));
    header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleGrupoSidebar(g); }
    });
  });
}

function toggleGrupoSidebar(g) {
  const abrir = !g.classList.contains('open');
  g.classList.toggle('open', abrir);
  g.classList.toggle('closed', !abrir);
  guardarEstadoGrupos();
}

function guardarEstadoGrupos() {
  const estado = {};
  document.querySelectorAll('.nav-group').forEach((g) => { estado[g.dataset.group] = g.classList.contains('open'); });
  localStorage.setItem('sidebar-grupos', JSON.stringify(estado));
}

// Expande el grupo que contiene la pestaña indicada (si está cerrado).
function expandirGrupoDe(nombreTab) {
  const item = document.querySelector(`.nav-item[data-tab="${nombreTab}"]`);
  const g = item && item.closest('.nav-group');
  if (g && !g.classList.contains('open')) {
    g.classList.add('open');
    g.classList.remove('closed');
    guardarEstadoGrupos();
  }
}

// Oculta los grupos sin ningún ítem visible (todos sus nav-item con .oculto).
function ocultarGruposVacios() {
  document.querySelectorAll('.nav-group').forEach((g) => {
    const visibles = g.querySelectorAll('.nav-item:not(.oculto)').length;
    g.classList.toggle('oculto', visibles === 0);
  });
}

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

  // Roles restringidos (limpieza, mantenimiento): solo sus pestañas permitidas.
  const restr = ROL_RESTRINGIDO[rol];
  if (restr && !restr.permitidas.includes(nombre)) {
    toast('No tienes acceso a esta sección', 'error');
    nombre = restr.principal;
  }

  // Estadísticas está restringida a administradores (también frente a acceso directo).
  if (nombre === 'estadisticas' && !Auth.esAdmin()) {
    toast('Acceso restringido a administradores', 'error');
    return;
  }

  document.querySelectorAll('.nav-item').forEach((t) =>
    t.classList.toggle('activo', t.dataset.tab === nombre)
  );
  // Expande automáticamente el grupo que contiene la pestaña activa.
  expandirGrupoDe(nombre);
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
  if (nombre === 'comercial')    Leads.cargar().catch((e) => toast(e.message, 'error'));
  if (nombre === 'clientes')     ClientesAlquiler.cargar().catch((e) => toast(e.message, 'error'));
  if (nombre === 'propietarios') Propietarios.cargar().catch((e) => toast(e.message, 'error'));
  if (nombre === 'reservas')     Reservas.cargar().catch((e) => toast(e.message, 'error'));
  if (nombre === 'estadisticas') Estadisticas.cargar().catch((e) => toast(e.message, 'error'));
  if (nombre === 'limpieza')     Limpieza.cargar().catch((e) => toast(e.message, 'error'));
  if (nombre === 'mantenimiento') Mantenimiento.cargar().catch((e) => toast(e.message, 'error'));
  if (nombre === 'personal')     Personal.cargar().catch((e) => toast(e.message, 'error'));
  if (nombre === 'ajustes')      Ajustes.cargar().catch((e) => toast(e.message, 'error'));
}
