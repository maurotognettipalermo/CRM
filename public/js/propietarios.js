// Módulo Propietarios: lista con búsqueda/orden/paginación, ficha en panel lateral
// deslizante (con edición inline), modal de alta/edición por pestañas e importación Excel.

const Propietarios = (() => {
  const POR_PAGINA = 40;

  let todos = [];                 // caché de la lista completa
  let busqueda = '';
  let orden = { campo: 'nombre', dir: 1 }; // dir 1 = A-Z, -1 = Z-A
  let pagina = 0;

  let fichaActual = null;         // propietario abierto en el panel
  let editando = false;           // modo edición del panel
  let tagsActuales = [];          // estado del editor de tags (panel/modal)

  // ---- Definición de secciones y campos (compartida por ficha y modal) ----
  const SECCIONES = [
    {
      titulo: 'Datos propietario', tab: 'basicos',
      campos: [
        ['fecha_alta', 'Fecha de alta', 'date'],
        ['nombre', 'Nombre', 'text'],
        ['tratamiento', 'Tratamiento', 'text'],
        ['apellidos', 'Primer apellido', 'text'],
        ['idioma', 'Idioma', 'text'],
        ['segundo_apellido', 'Segundo apellido', 'text'],
        ['fecha_nacimiento', 'Fecha de nacimiento', 'date'],
        ['notas', 'Observaciones', 'textarea'],
        ['tags', 'Tags', 'tags'],
      ],
    },
    {
      titulo: 'Contacto', tab: 'contacto',
      campos: [
        ['telefono', 'Teléfono móvil', 'text'],
        ['email', 'Email', 'text'],
        ['telefono2', 'Teléfono alternativo 1', 'text'],
        ['email2', 'Email alternativo', 'text'],
        ['telefono3', 'Teléfono alternativo 2', 'text'],
        ['fax', 'Fax', 'text'],
      ],
    },
    {
      titulo: 'Domicilio', tab: 'domicilio',
      campos: [
        ['direccion', 'Dirección', 'text'],
        ['pais', 'País', 'text'],
        ['direccion_numero', 'Número', 'text'],
        ['region', 'Región', 'text'],
        ['bloque_portal', 'Bloque o portal', 'text'],
        ['provincia', 'Provincia', 'text'],
        ['planta_puerta', 'Planta y puerta', 'text'],
        ['ciudad', 'Ciudad', 'text'],
        ['codigo_postal', 'Código postal', 'text'],
        ['tipo_direccion', 'Tipo de dirección', 'text'],
      ],
    },
    {
      titulo: 'Documentación', tab: 'documentacion',
      campos: [
        ['tipo_documento', 'Tipo documento', 'text'],
        ['expedido_fecha', 'Expedido fecha', 'date'],
        ['numero_documento', 'Número documento', 'text'],
        ['ciudad_nacimiento', 'Ciudad de nacimiento', 'text'],
        ['tipo_identificacion', 'Tipo de identificación', 'text'],
        ['provincia_nacimiento', 'Provincia de nacimiento', 'text'],
        ['pais_nacimiento', 'País de nacimiento', 'text'],
        ['lugar_expedicion', 'Lugar de expedición', 'text'],
      ],
    },
    {
      titulo: 'Datos contables', tab: 'contables',
      campos: [
        ['metodo_pago', 'Método de pago', 'text'],
        ['retencion', 'Retención', 'text'],
        ['tipo_cuenta', 'Tipo de cuenta', 'text'],
        ['codigo_fiscal', 'Código fiscal', 'text'],
        ['titular_cuenta', 'Titular de la cuenta', 'text'],
        ['cuenta_contable', 'Cuenta contable', 'text'],
        ['numero_cuenta', 'Nº cuenta (IBAN)', 'text'],
      ],
    },
  ];

  // ---- Utilidades ----
  function nombreCompleto(p) {
    return [p.nombre, p.apellidos, p.segundo_apellido].filter(Boolean).join(' ');
  }
  function inicial(p) {
    return (p.nombre || p.apellidos || '?').trim().charAt(0).toUpperCase();
  }
  // Color estable a partir del nombre (hash -> matiz HSL).
  function colorAvatar(p) {
    const s = (p.nombre || '') + (p.apellidos || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
    return `hsl(${Math.abs(h) % 360}, 52%, 52%)`;
  }
  function tagsArray(str) {
    return (str || '').split(',').map((t) => t.trim()).filter(Boolean);
  }
  function val(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
  }

  // ================== LISTA ==================
  async function cargar() {
    try {
      todos = await API.get('/api/propietarios');
      pagina = 0;
      render();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function filtrarOrdenar() {
    const q = busqueda.trim().toLowerCase();
    let lista = todos;
    if (q) {
      lista = lista.filter((p) =>
        [p.nombre, p.apellidos, p.segundo_apellido, p.email, p.telefono]
          .some((v) => (v || '').toLowerCase().includes(q))
      );
    }
    const c = orden.campo;
    lista = [...lista].sort((a, b) => {
      let va, vb;
      if (c === 'num_alojamientos') {
        va = a.num_alojamientos || 0; vb = b.num_alojamientos || 0;
        return (va - vb) * orden.dir;
      }
      if (c === 'nombre') {
        va = nombreCompleto(a).toLowerCase(); vb = nombreCompleto(b).toLowerCase();
      } else {
        va = (a[c] || '').toLowerCase(); vb = (b[c] || '').toLowerCase();
      }
      return va < vb ? -orden.dir : va > vb ? orden.dir : 0;
    });
    return lista;
  }

  function render() {
    const lista = filtrarOrdenar();
    const total = todos.length;
    const totalFiltrado = lista.length;

    document.getElementById('prop-conteo').textContent =
      `Total: ${total} propietario${total === 1 ? '' : 's'}`;

    const maxPag = Math.max(0, Math.ceil(totalFiltrado / POR_PAGINA) - 1);
    if (pagina > maxPag) pagina = maxPag;
    const inicio = pagina * POR_PAGINA;
    const pagItems = lista.slice(inicio, inicio + POR_PAGINA);

    const tbody = document.querySelector('#tabla-propietarios tbody');
    tbody.innerHTML = '';

    if (totalFiltrado === 0) {
      tbody.innerHTML =
        '<tr><td colspan="6" style="color:#6b7280;text-align:center;padding:24px">' +
        (total === 0 ? 'No hay propietarios todavía.' : 'Ningún propietario coincide con la búsqueda.') +
        '</td></tr>';
    } else {
      for (const p of pagItems) {
        const tr = document.createElement('tr');
        tr.dataset.ficha = p.id;
        const emailSub = p.email ? `<span class="cel-sub">${esc(p.email)}</span>` : '';
        const doc = p.numero_documento || p.dni;
        tr.innerHTML = `
          <td class="cel-avatar">
            <span class="avatar" style="background:${colorAvatar(p)}">${esc(inicial(p))}</span>
          </td>
          <td>
            <div class="cel-nombre">
              <span class="nombre">${esc(nombreCompleto(p)) || '—'}</span>
              ${emailSub}
            </div>
          </td>
          <td>${esc(p.telefono) || '—'}</td>
          <td>${esc(doc) || '—'}</td>
          <td><span class="badge-aloj${p.num_alojamientos ? '' : ' vacio'}">${p.num_alojamientos || 0}</span></td>
          <td class="acciones">
            <button class="btn-mini" data-editar="${p.id}">Editar</button>
            <button class="btn-mini" data-borrar="${p.id}">Eliminar</button>
          </td>`;
        tbody.appendChild(tr);
      }
    }

    // Paginación.
    const desde = totalFiltrado === 0 ? 0 : inicio + 1;
    const hasta = Math.min(inicio + POR_PAGINA, totalFiltrado);
    document.getElementById('prop-paginacion-texto').textContent =
      `Resultados ${desde}–${hasta} de ${totalFiltrado}`;
    const btnPrev = document.getElementById('prop-prev');
    const btnNext = document.getElementById('prop-next');
    btnPrev.disabled = pagina <= 0;
    btnNext.disabled = pagina >= maxPag;

    // Indicador de orden en cabeceras.
    document.querySelectorAll('#tabla-propietarios th[data-orden]').forEach((th) => {
      th.classList.toggle('orden-asc', orden.campo === th.dataset.orden && orden.dir === 1);
      th.classList.toggle('orden-desc', orden.campo === th.dataset.orden && orden.dir === -1);
    });

    // Eventos de fila.
    tbody.querySelectorAll('tr[data-ficha]').forEach((tr) => {
      tr.addEventListener('click', (e) => {
        if (e.target.closest('[data-editar]') || e.target.closest('[data-borrar]')) return;
        abrirFicha(tr.dataset.ficha);
      });
    });
    tbody.querySelectorAll('[data-editar]').forEach((el) =>
      el.addEventListener('click', (e) => { e.stopPropagation(); formulario(el.dataset.editar); })
    );
    tbody.querySelectorAll('[data-borrar]').forEach((el) =>
      el.addEventListener('click', (e) => { e.stopPropagation(); borrar(el.dataset.borrar); })
    );
  }

  // ================== PANEL LATERAL (FICHA) ==================
  async function abrirFicha(id) {
    try {
      fichaActual = await API.get('/api/propietarios/' + id);
    } catch (e) {
      return toast(e.message, 'error');
    }
    editando = false;
    renderPanel();
    abrirPanel();
  }

  function abrirPanel() {
    document.getElementById('panel-fondo').classList.add('abierto');
    document.getElementById('panel-propietario').classList.add('abierto');
  }
  function cerrarPanel() {
    document.getElementById('panel-fondo').classList.remove('abierto');
    document.getElementById('panel-propietario').classList.remove('abierto');
    fichaActual = null;
    editando = false;
  }

  function campoFicha([key, label, tipo]) {
    const v = fichaActual[key];
    if (editando) {
      if (tipo === 'textarea') {
        return `<div class="campo-ficha ancho-total"><label>${label}</label>
          <textarea data-campo="${key}">${esc(v)}</textarea></div>`;
      }
      if (tipo === 'tags') {
        return `<div class="campo-ficha ancho-total"><label>${label}</label>
          <div id="editor-tags" class="tags-editor"></div></div>`;
      }
      const t = tipo === 'date' ? 'date' : 'text';
      return `<div class="campo-ficha"><label>${label}</label>
        <input type="${t}" data-campo="${key}" value="${esc(v)}"></div>`;
    }
    // Modo lectura.
    let display;
    if (tipo === 'tags') {
      const tags = tagsArray(v);
      display = tags.length
        ? `<div class="chips-tags">${tags.map((t) => `<span class="chip-tag">${esc(t)}</span>`).join('')}</div>`
        : '—';
    } else if (tipo === 'date') {
      display = v ? esc(fechaES(v)) : '—';
    } else {
      display = esc(v) || '—';
    }
    return `<div class="campo-ficha"><div class="etq">${label}</div><div class="val">${display}</div></div>`;
  }

  function seccionAlojamientos() {
    const aloj = fichaActual.apartamentos || [];
    let html = '<div class="ficha-seccion-titulo">Alojamientos asignados</div>';
    if (aloj.length === 0) {
      html += '<p class="ficha-vacio">Sin alojamientos asignados</p>';
    } else {
      html += '<div class="chips-aloj">' +
        aloj.map((a) =>
          `<span class="chip-aloj" data-aloj="${a.id}">${esc(a.nombre)}${a.tipo ? ' · ' + tihTexto(a.tipo) : ''}</span>`
        ).join('') + '</div>';
    }
    return html;
  }

  function renderPanel() {
    const p = fichaActual;
    document.getElementById('panel-titulo').textContent =
      [p.tratamiento, nombreCompleto(p)].filter(Boolean).join(' ') || 'Propietario';

    const cuerpo = document.getElementById('panel-cuerpo');
    let html = '';
    for (const sec of SECCIONES) {
      html += `<div class="ficha-seccion-titulo">${sec.titulo}</div>`;
      html += '<div class="ficha-grid">' + sec.campos.map(campoFicha).join('') + '</div>';
      // Insertar alojamientos justo después de Contacto (como en Avantio).
      if (sec.tab === 'contacto') html += seccionAlojamientos();
    }
    cuerpo.innerHTML = html;

    // Botones de cabecera.
    document.getElementById('panel-editar').classList.toggle('oculto', editando);
    document.getElementById('panel-guardar').classList.toggle('oculto', !editando);

    // Editor de tags (solo en modo edición).
    if (editando) {
      tagsActuales = tagsArray(p.tags);
      montarEditorTags('editor-tags');
    }

    // Chips de alojamiento clicables.
    cuerpo.querySelectorAll('[data-aloj]').forEach((el) =>
      el.addEventListener('click', () => {
        if (typeof Alojamientos !== 'undefined') Alojamientos.abrirFicha(el.dataset.aloj);
      })
    );
  }

  async function guardarFicha() {
    const body = {};
    document.querySelectorAll('#panel-cuerpo [data-campo]').forEach((el) => {
      body[el.dataset.campo] = el.value;
    });
    body.tags = tagsActuales.join(', ');
    if (!body.nombre || !body.nombre.trim()) return toast('El nombre es obligatorio', 'error');

    try {
      await API.put('/api/propietarios/' + fichaActual.id, body);
      toast('Propietario guardado', 'ok');
      fichaActual = await API.get('/api/propietarios/' + fichaActual.id);
      editando = false;
      renderPanel();
      await recargarLista();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // Recarga la caché de la lista sin perder página/búsqueda.
  async function recargarLista() {
    try {
      todos = await API.get('/api/propietarios');
      render();
    } catch (e) { /* no bloquea el panel */ }
  }

  // ================== EDITOR DE TAGS ==================
  function montarEditorTags(contId) {
    const cont = document.getElementById(contId);
    if (!cont) return;
    const pinta = () => {
      cont.innerHTML =
        tagsActuales.map((t, i) =>
          `<span class="chip-tag editable">${esc(t)}<button type="button" data-quitar="${i}">&times;</button></span>`
        ).join('') +
        '<input type="text" class="tags-input" placeholder="Añadir tag y Enter">';
      cont.querySelectorAll('[data-quitar]').forEach((b) =>
        b.addEventListener('click', () => { tagsActuales.splice(+b.dataset.quitar, 1); pinta(); })
      );
      const input = cont.querySelector('.tags-input');
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ',') {
          e.preventDefault();
          const v = input.value.trim().replace(/,$/, '');
          if (v && !tagsActuales.includes(v)) { tagsActuales.push(v); pinta(); cont.querySelector('.tags-input').focus(); }
        } else if (e.key === 'Backspace' && !input.value && tagsActuales.length) {
          tagsActuales.pop(); pinta(); cont.querySelector('.tags-input').focus();
        }
      });
    };
    pinta();
  }

  // ================== MODAL ALTA / EDICIÓN ==================
  async function formulario(id) {
    let p = {};
    if (id) {
      try { p = await API.get('/api/propietarios/' + id); }
      catch (e) { return toast(e.message, 'error'); }
    }

    const tabsBtn = SECCIONES.map((s, i) =>
      `<button type="button" class="tab-modal${i === 0 ? ' activo' : ''}" data-tab="${s.tab}">${s.titulo}</button>`
    ).join('');

    const paneles = SECCIONES.map((s, i) => {
      const campos = s.campos.map(([key, label, tipo]) => {
        const v = p[key] != null ? p[key] : '';
        const req = key === 'nombre' || key === 'apellidos';
        if (tipo === 'textarea') {
          return `<div class="campo ancho-total"><label>${label}</label><textarea id="m-${key}">${esc(v)}</textarea></div>`;
        }
        if (tipo === 'tags') {
          return `<div class="campo ancho-total"><label>${label}</label><div id="m-editor-tags" class="tags-editor"></div></div>`;
        }
        const t = tipo === 'date' ? 'date' : 'text';
        return `<div class="campo"><label>${label}${req ? ' *' : ''}</label><input type="${t}" id="m-${key}" value="${esc(v)}"></div>`;
      }).join('');
      return `<div class="panel-tab${i === 0 ? ' activo' : ''}" data-panel="${s.tab}"><div class="fila-campos-grid">${campos}</div></div>`;
    }).join('');

    abrirModal(`
      <h3>${id ? 'Editar' : 'Nuevo'} propietario</h3>
      <div class="tabs-modal">${tabsBtn}</div>
      <div class="tabs-cuerpo">${paneles}</div>
      <div class="modal-acciones">
        <button class="btn-sec" id="m-cancelar">Cancelar</button>
        <button class="btn-pri" id="m-guardar">Guardar</button>
      </div>`);

    document.querySelector('.modal').classList.add('modal-ancho');

    // Pestañas internas.
    document.querySelectorAll('.tab-modal').forEach((btn) =>
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-modal').forEach((b) => b.classList.remove('activo'));
        document.querySelectorAll('.panel-tab').forEach((pn) => pn.classList.remove('activo'));
        btn.classList.add('activo');
        document.querySelector(`.panel-tab[data-panel="${btn.dataset.tab}"]`).classList.add('activo');
      })
    );

    // Editor de tags del modal.
    tagsActuales = tagsArray(p.tags);
    montarEditorTags('m-editor-tags');

    document.getElementById('m-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('m-guardar').addEventListener('click', async () => {
      const body = {};
      for (const sec of SECCIONES) for (const [key] of sec.campos) {
        if (key === 'tags') continue;
        body[key] = val('m-' + key);
      }
      body.tags = tagsActuales.join(', ');
      if (!body.nombre.trim()) { activarTab('basicos'); return toast('El nombre es obligatorio', 'error'); }
      if (!body.apellidos.trim()) { activarTab('basicos'); return toast('El primer apellido es obligatorio', 'error'); }
      try {
        if (id) await API.put('/api/propietarios/' + id, body);
        else await API.post('/api/propietarios', body);
        cerrarModal();
        await cargar();
        toast('Propietario guardado', 'ok');
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  function activarTab(tab) {
    const btn = document.querySelector(`.tab-modal[data-tab="${tab}"]`);
    if (btn) btn.click();
  }

  // ================== IMPORTACIÓN ==================
  function modalImportar() {
    abrirModal(`
      <h3>Importar propietarios desde Excel</h3>
      <div id="dropzone" class="dropzone">
        <p><strong>Arrastra aquí</strong> un archivo .xlsx, .xls o .csv</p>
        <p class="dropzone-sub">o</p>
        <button type="button" class="btn-sec" id="dz-elegir">Seleccionar archivo</button>
        <input type="file" id="dz-input" accept=".xlsx,.xls,.csv" hidden>
        <p class="dropzone-hint">Se reconocen automáticamente columnas como nombre, apellidos,
        teléfono, email, DNI, dirección, ciudad, código postal, provincia, país… Las no
        reconocidas se ignoran. Se actualizan los que coincidan por email o documento.</p>
      </div>
      <div id="import-resultado"></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="import-cerrar">Cerrar</button>
      </div>`);

    const dz = document.getElementById('dropzone');
    const input = document.getElementById('dz-input');
    document.getElementById('dz-elegir').addEventListener('click', () => input.click());
    document.getElementById('import-cerrar').addEventListener('click', cerrarModal);
    input.addEventListener('change', () => { if (input.files[0]) subir(input.files[0]); });

    ['dragenter', 'dragover'].forEach((ev) =>
      dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('dz-activo'); })
    );
    ['dragleave', 'drop'].forEach((ev) =>
      dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('dz-activo'); })
    );
    dz.addEventListener('drop', (e) => {
      const f = e.dataTransfer.files[0];
      if (f) subir(f);
    });
  }

  async function subir(file) {
    const out = document.getElementById('import-resultado');
    out.innerHTML = '<p class="import-cargando">Importando…</p>';
    try {
      const res = await API.subirArchivo('/api/propietarios/importar', file);
      let html = `<div class="resumen-import">
        <p><strong>${res.nuevos}</strong> nuevos · <strong>${res.actualizados}</strong> actualizados · <strong>${res.errores.length}</strong> con incidencia</p>`;
      if (res.errores.length) {
        html += '<strong>Incidencias:</strong><ul>' +
          res.errores.map((e) => `<li class="err">Fila ${e.fila}: ${esc(e.motivo)}</li>`).join('') +
          '</ul>';
      }
      html += '</div>';
      out.innerHTML = html;
      await cargar();
    } catch (e) {
      out.innerHTML = `<p class="import-error">${esc(e.message)}</p>`;
    }
  }

  // ================== BORRAR ==================
  async function borrar(id) {
    const p = todos.find((x) => x.id == id);
    if (!confirm(`¿Eliminar a "${p ? nombreCompleto(p) : id}"? Sus alojamientos quedarán sin propietario asociado.`)) return;
    try {
      await API.del('/api/propietarios/' + id);
      if (fichaActual && fichaActual.id == id) cerrarPanel();
      await cargar();
      toast('Propietario eliminado', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ================== INIT ==================
  function init() {
    document.getElementById('btn-nuevo-propietario').addEventListener('click', () => formulario(null));
    document.getElementById('btn-importar-propietarios').addEventListener('click', modalImportar);

    document.getElementById('prop-buscar').addEventListener('input', (e) => {
      busqueda = e.target.value;
      pagina = 0;
      render();
    });

    document.getElementById('prop-prev').addEventListener('click', () => { if (pagina > 0) { pagina--; render(); } });
    document.getElementById('prop-next').addEventListener('click', () => { pagina++; render(); });

    document.querySelectorAll('#tabla-propietarios th[data-orden]').forEach((th) =>
      th.addEventListener('click', () => {
        const campo = th.dataset.orden;
        if (orden.campo === campo) orden.dir *= -1;
        else orden = { campo, dir: 1 };
        render();
      })
    );

    // Cierre del panel lateral.
    document.getElementById('panel-cerrar').addEventListener('click', cerrarPanel);
    document.getElementById('panel-fondo').addEventListener('click', cerrarPanel);
    document.getElementById('panel-editar').addEventListener('click', () => { editando = true; renderPanel(); });
    document.getElementById('panel-guardar').addEventListener('click', guardarFicha);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.getElementById('panel-propietario').classList.contains('abierto')) {
        cerrarPanel();
      }
    });
  }

  return { init, cargar, abrirFicha, formulario };
})();
