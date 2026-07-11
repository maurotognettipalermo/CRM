// Módulo Tarifas: temporadas de precios (calendario anual + tabla), modificadores por
// tipo de clasificación (tabla editable inline) y descuentos. Selector de año compartido.

const Tarifas = (() => {
  const ANIOS = [2024, 2025, 2026, 2027];
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  // Paleta para el color aleatorio por defecto de una temporada nueva.
  const PALETA = ['#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
  // Badges por tipo: mismas clases que las fichas de alojamiento (badge-clasif).
  const CLASE_TIPO = { 'A++': 'c-app', 'A+': 'c-ap', 'A': 'c-a', 'B+': 'c-bp', 'B': 'c-b', 'C': 'c-c' };

  const TIPOS_CLASIF = ['A++', 'A+', 'A', 'B+', 'B', 'C'];

  let anio = new Date().getFullYear();
  let subActiva = 'temporadas';
  let temporadas = [];        // temporadas del año seleccionado
  let modificadores = [];     // tipo_modificadores (cache, no depende del año)
  let descuentos = [];        // descuentos del año seleccionado
  // Tabla de referencia informativa para Propietario (contratos "sin garantía"): precio por
  // SEMANA, sistema independiente del de Particular. No se conecta a reservas ni contratos.
  let propietarioTemporadas = [];
  let propietarioModificadores = [];
  // Sub-pestaña "Consultar precio" (GET /api/tarifas/comparar): solo lectura, sin caché por año.
  let mayoristasComparar = null;   // cache en memoria de sesión (activos)
  let compararTimer = null;        // debounce
  let compararToken = 0;           // descarta respuestas obsoletas

  // ---- Formato ----
  function euro(n) { return (Number(n) || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'; }
  function pctMod(p) {
    const n = Number(p) || 0;
    if (n === 0) return 'base';
    return (n > 0 ? '+' : '−') + Math.abs(n) + '%';
  }
  function badgeTipo(t) {
    return `<span class="badge-clasif ${CLASE_TIPO[t] || 'c-c'}">${esc(t)}</span>`;
  }
  // Nombre a mostrar: si la temporada no tiene nombre (ahora opcional), usa el rango de fechas.
  function nombreTemporada(t) {
    return t.nombre || `${fechaES(t.fecha_inicio)} - ${fechaES(t.fecha_fin)}`;
  }
  function diasEntre(inicio, fin) {
    return Math.round((new Date(fin + 'T00:00:00Z') - new Date(inicio + 'T00:00:00Z')) / 86400000) + 1;
  }

  // ==================== Carga / navegación ====================
  function init() {
    const sel = document.getElementById('trf-anio');
    sel.innerHTML = ANIOS.map((a) => `<option value="${a}"${a === anio ? ' selected' : ''}>${a}</option>`).join('');
    sel.addEventListener('change', () => { anio = Number(sel.value); cargar(); });
    document.getElementById('trf-copiar').addEventListener('click', modalCopiar);
    document.querySelectorAll('#trf-subtabs .subtab').forEach((b) =>
      b.addEventListener('click', () => activarSub(b.dataset.sub)));
  }

  function activarSub(sub) {
    subActiva = sub;
    document.querySelectorAll('#trf-subtabs .subtab').forEach((b) =>
      b.classList.toggle('activo', b.dataset.sub === sub));
    document.querySelectorAll('#vista-tarifas .sub-panel').forEach((p) =>
      p.classList.toggle('activo', p.dataset.panelSub === sub));
    cargarSub();
  }

  async function cargar() {
    // Modificadores cacheados: los necesitan el preview del modal y su sub-pestaña.
    if (!modificadores.length) {
      try { modificadores = await API.get('/api/tarifas/modificadores'); } catch (e) { modificadores = []; }
    }
    await cargarSub();
  }

  async function cargarSub() {
    if (subActiva === 'temporadas') return cargarTemporadas();
    if (subActiva === 'modificadores') return cargarModificadores();
    if (subActiva === 'descuentos') return cargarDescuentos();
    if (subActiva === 'propietario') return cargarPropietario();
    if (subActiva === 'comparar') return cargarComparar();
  }

  function panel(sub) {
    return document.querySelector(`#vista-tarifas .sub-panel[data-panel-sub="${sub}"]`);
  }

  // ==================== Sub-pestaña Temporadas ====================
  async function cargarTemporadas() {
    const cont = panel('temporadas');
    cont.innerHTML = '<div style="color:var(--muted);padding:8px 0">Cargando temporadas…</div>';
    try {
      temporadas = await API.get(`/api/tarifas/temporadas?anio=${anio}`);
    } catch (e) {
      cont.innerHTML = '<div style="color:var(--muted);padding:8px 0">No se pudieron cargar las temporadas.</div>';
      return;
    }
    renderTemporadas(cont);
  }

  function temporadaDe(fecha) {
    return temporadas.find((t) => t.fecha_inicio <= fecha && fecha <= t.fecha_fin) || null;
  }

  function calendarioHTML() {
    let html = '<div class="trf-cal">';
    for (let m = 0; m < 12; m++) {
      const nDias = new Date(anio, m + 1, 0).getDate();
      let dias = '';
      for (let d = 1; d <= nDias; d++) {
        const fecha = `${anio}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const t = temporadaDe(fecha);
        if (t) {
          dias += `<div class="trf-cal-dia cubierto" style="background:${esc(t.color)}" title="${esc(nombreTemporada(t))} — ${euro(t.precio_base_noche)}/noche (${fechaES(fecha)})"></div>`;
        } else {
          dias += `<div class="trf-cal-dia" title="${fechaES(fecha)} — sin temporada"></div>`;
        }
      }
      html += `
        <div class="trf-cal-mes">
          <div class="trf-cal-mes-label">${MESES[m]}</div>
          <div class="trf-cal-dias">${dias}</div>
        </div>`;
    }
    return html + '</div>';
  }

  function renderTemporadas(cont) {
    const filas = temporadas.map((t) => `
      <tr>
        <td><span class="trf-color-sq" style="background:${esc(t.color)}"></span></td>
        <td>${esc(nombreTemporada(t))}</td>
        <td>${fechaES(t.fecha_inicio)}</td>
        <td>${fechaES(t.fecha_fin)}</td>
        <td>${diasEntre(t.fecha_inicio, t.fecha_fin)}</td>
        <td style="text-align:right;white-space:nowrap">${euro(t.precio_base_noche)}</td>
        <td class="acciones">
          <button class="btn-mini" data-editar="${t.id}">Editar</button>
          <button class="btn-mini" data-borrar="${t.id}">Eliminar</button>
        </td>
      </tr>`).join('');

    cont.innerHTML = `
      ${calendarioHTML()}
      <div class="trf-tabla-head">
        <span class="sub-panel-titulo">Temporadas de ${anio}</span>
        <button id="trf-nueva-temporada" class="btn-pri">＋ Nueva temporada</button>
      </div>
      <div class="tabla-scroll">
        <table class="tabla">
          <thead><tr><th></th><th>Nombre</th><th>Fecha inicio</th><th>Fecha fin</th><th>Días</th><th style="text-align:right">Precio/noche (Tipo A)</th><th></th></tr></thead>
          <tbody>${filas || `<tr><td colspan="7" style="color:#6b7280">No hay temporadas definidas en ${anio}.</td></tr>`}</tbody>
        </table>
      </div>`;

    document.getElementById('trf-nueva-temporada').addEventListener('click', () => modalTemporada(null));
    cont.querySelectorAll('[data-editar]').forEach((b) =>
      b.addEventListener('click', () => modalTemporada(Number(b.dataset.editar))));
    cont.querySelectorAll('[data-borrar]').forEach((b) =>
      b.addEventListener('click', () => borrarTemporada(Number(b.dataset.borrar))));
  }

  // Tabla de precios resultantes por tipo según el precio base introducido.
  function previewTiposHTML(precio) {
    const base = Number(precio) || 0;
    const filas = modificadores.map((m) => `
      <tr>
        <td>${badgeTipo(m.tipo)}</td>
        <td>${pctMod(m.porcentaje)}</td>
        <td style="text-align:right;white-space:nowrap">${euro(base * (1 + (Number(m.porcentaje) || 0) / 100))}</td>
      </tr>`).join('');
    return `
      <table class="tabla trf-preview-tabla">
        <thead><tr><th>Tipo</th><th>Modificador</th><th style="text-align:right">Precio/noche</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>`;
  }

  function modalTemporada(id) {
    const t = id ? temporadas.find((x) => x.id === id) : null;
    const color = t ? t.color : PALETA[Math.floor(Math.random() * PALETA.length)];

    abrirModal(`
      <h3>${t ? 'Editar' : 'Nueva'} temporada</h3>
      <div class="campo"><label>Nombre</label><input id="tp-nombre" placeholder="Temporada Alta" value="${t ? esc(t.nombre) : ''}"></div>
      <div class="fila-campos">
        <div class="campo"><label>Fecha inicio *</label><input type="date" id="tp-inicio" value="${t ? t.fecha_inicio : ''}"></div>
        <div class="campo"><label>Fecha fin *</label><input type="date" id="tp-fin" value="${t ? t.fecha_fin : ''}"></div>
      </div>
      <div class="fila-campos">
        <div class="campo">
          <label>Precio base por noche (€) *</label>
          <input type="number" step="0.01" min="0" id="tp-precio" value="${t ? t.precio_base_noche : ''}">
          <div style="font-size:12px;color:var(--muted);margin-top:6px">Este es el precio para Tipo A</div>
        </div>
        <div class="campo"><label>Color</label><input type="color" id="tp-color" value="${esc(color)}"></div>
      </div>
      <div class="campo">
        <label>Precios resultantes por tipo</label>
        <div id="tp-preview">${previewTiposHTML(t ? t.precio_base_noche : 0)}</div>
      </div>
      <div class="modal-acciones">
        <button class="btn-sec" id="tp-cancelar">Cancelar</button>
        <button class="btn-pri" id="tp-guardar">Guardar</button>
      </div>`);

    document.getElementById('tp-precio').addEventListener('input', (e) => {
      document.getElementById('tp-preview').innerHTML = previewTiposHTML(e.target.value);
    });
    document.getElementById('tp-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('tp-guardar').addEventListener('click', async () => {
      const body = {
        nombre: val('tp-nombre'),
        fecha_inicio: val('tp-inicio'),
        fecha_fin: val('tp-fin'),
        precio_base_noche: val('tp-precio'),
        color: val('tp-color'),
        anio,
      };
      try {
        if (t) await API.put(`/api/tarifas/temporadas/${t.id}`, body);
        else await API.post('/api/tarifas/temporadas', body);
        cerrarModal();
        toast('Temporada guardada', 'ok');
        await cargarTemporadas();
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  async function borrarTemporada(id) {
    const t = temporadas.find((x) => x.id === id);
    if (!confirm(`¿Eliminar la temporada "${t ? nombreTemporada(t) : ''}"?`)) return;
    try {
      await API.del(`/api/tarifas/temporadas/${id}`);
      toast('Temporada eliminada', 'ok');
      await cargarTemporadas();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ---- Modal copiar temporadas de otro año ----
  async function modalCopiar() {
    // Años con temporadas (candidatos a origen), excluyendo el año destino actual.
    const conteos = await Promise.all(ANIOS.map(async (a) => {
      try { return { anio: a, n: (await API.get(`/api/tarifas/temporadas?anio=${a}`)).length }; }
      catch (e) { return { anio: a, n: 0 }; }
    }));
    const origenes = conteos.filter((c) => c.n > 0 && c.anio !== anio);
    if (!origenes.length) return toast('Ningún otro año tiene temporadas que copiar', 'error');

    abrirModal(`
      <h3>Copiar temporadas</h3>
      <div class="campo">
        <label>Copiar desde año</label>
        <select id="cp-origen">${origenes.map((o) => `<option value="${o.anio}">${o.anio} (${o.n} temporada${o.n === 1 ? '' : 's'})</option>`).join('')}</select>
      </div>
      <p id="cp-texto" style="font-size:13px;color:var(--muted)"></p>
      <div class="modal-acciones">
        <button class="btn-sec" id="cp-cancelar">Cancelar</button>
        <button class="btn-pri" id="cp-confirmar">Copiar</button>
      </div>`);

    const actualizarTexto = () => {
      const o = origenes.find((x) => x.anio === Number(val('cp-origen')));
      document.getElementById('cp-texto').textContent =
        `Se copiarán ${o ? o.n : 0} temporada(s) al año ${anio}`;
    };
    document.getElementById('cp-origen').addEventListener('change', actualizarTexto);
    actualizarTexto();
    document.getElementById('cp-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('cp-confirmar').addEventListener('click', async () => {
      try {
        await API.post('/api/tarifas/temporadas/copiar', {
          anio_origen: Number(val('cp-origen')),
          anio_destino: anio,
        });
        cerrarModal();
        toast('Temporadas copiadas', 'ok');
        await cargarTemporadas();
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  // ==================== Sub-pestaña Modificadores por tipo ====================
  async function cargarModificadores() {
    const cont = panel('modificadores');
    cont.innerHTML = '<div style="color:var(--muted);padding:8px 0">Cargando modificadores…</div>';
    try {
      modificadores = await API.get('/api/tarifas/modificadores');
    } catch (e) {
      cont.innerHTML = '<div style="color:var(--muted);padding:8px 0">No se pudieron cargar los modificadores.</div>';
      return;
    }
    renderModificadores(cont);
  }

  function renderModificadores(cont) {
    const filas = modificadores.map((m) => {
      const esA = m.tipo === 'A';
      const input = esA
        ? '<span style="color:var(--muted)">Base (referencia)</span>'
        : `<input type="number" step="1" class="trf-mod-input" data-mod-id="${m.id}" data-original="${m.porcentaje}" value="${m.porcentaje}"> %`;
      return `
        <tr>
          <td>${esc(m.tipo)}</td>
          <td>${badgeTipo(m.tipo)}</td>
          <td>${input}</td>
          <td style="text-align:right;white-space:nowrap" data-ejemplo="${m.id}"></td>
        </tr>`;
    }).join('');

    cont.innerHTML = `
      <div class="trf-tabla-head">
        <span class="sub-panel-titulo">Modificadores por tipo de clasificación</span>
        <div class="trf-mod-controles">
          <label for="trf-mod-base" style="font-size:13px;color:var(--muted)">Precio ejemplo (€)</label>
          <input type="number" id="trf-mod-base" step="0.01" min="0" value="100" class="trf-mod-input">
          <button id="trf-mod-guardar" class="btn-pri">Guardar cambios</button>
        </div>
      </div>
      <div class="tabla-scroll">
        <table class="tabla">
          <thead><tr><th>Tipo</th><th>Badge</th><th>Modificador %</th><th style="text-align:right">Precio ejemplo</th></tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>`;

    const actualizarEjemplos = () => {
      const base = Number(val('trf-mod-base')) || 0;
      for (const m of modificadores) {
        const inp = cont.querySelector(`[data-mod-id="${m.id}"]`);
        const pct = inp ? (Number(inp.value) || 0) : 0; // A no tiene input -> 0
        const celda = cont.querySelector(`[data-ejemplo="${m.id}"]`);
        if (celda) celda.textContent = euro(base * (1 + pct / 100));
      }
    };
    document.getElementById('trf-mod-base').addEventListener('input', actualizarEjemplos);
    cont.querySelectorAll('[data-mod-id]').forEach((inp) => inp.addEventListener('input', actualizarEjemplos));
    actualizarEjemplos();

    document.getElementById('trf-mod-guardar').addEventListener('click', async () => {
      const cambiados = [...cont.querySelectorAll('[data-mod-id]')]
        .filter((inp) => Number(inp.value) !== Number(inp.dataset.original));
      if (!cambiados.length) return toast('No hay cambios que guardar', 'ok');
      try {
        for (const inp of cambiados) {
          await API.put(`/api/tarifas/modificadores/${inp.dataset.modId}`, { porcentaje: Number(inp.value) || 0 });
        }
        toast(`${cambiados.length} modificador(es) actualizado(s)`, 'ok');
        await cargarModificadores();
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  // ==================== Sub-pestaña Descuentos ====================
  // Parsea un campo JSON array (tipos/portales) a array o null (null = aplica a todos).
  function parseArr(v) {
    if (!v) return null;
    try { const a = JSON.parse(v); return Array.isArray(a) && a.length ? a : null; }
    catch (e) { return null; }
  }

  async function cargarDescuentos() {
    const cont = panel('descuentos');
    cont.innerHTML = '<div style="color:var(--muted);padding:8px 0">Cargando descuentos…</div>';
    try {
      descuentos = await API.get(`/api/tarifas/descuentos?anio=${anio}`);
    } catch (e) {
      cont.innerHTML = '<div style="color:var(--muted);padding:8px 0">No se pudieron cargar los descuentos.</div>';
      return;
    }
    renderDescuentos(cont);
  }

  function condicionesHTML(d) {
    const badges = [];
    if (d.min_noches > 0) badges.push(`<span class="trf-cond-badge azul">Mín. ${d.min_noches} noches</span>`);
    const tipos = parseArr(d.tipos);
    if (tipos) badges.push(`<span class="trf-cond-badge verde">${tipos.map(esc).join(', ')}</span>`);
    const portales = parseArr(d.portales);
    if (portales) badges.push(`<span class="trf-cond-badge naranja">${portales.map(esc).join(', ')}</span>`);
    return badges.length ? badges.join(' ') : '<span style="color:var(--muted)">Sin restricciones</span>';
  }

  function renderDescuentos(cont) {
    const filas = descuentos.map((d) => `
      <tr>
        <td>${esc(d.nombre)}</td>
        <td style="white-space:nowrap">${(Number(d.porcentaje) || 0).toLocaleString('es-ES')}%</td>
        <td>${fechaES(d.fecha_inicio)}</td>
        <td>${fechaES(d.fecha_fin)}</td>
        <td>${condicionesHTML(d)}</td>
        <td>${d.activo
          ? '<span class="badge-estado activo">Activo</span>'
          : '<span class="badge-estado neutro">Inactivo</span>'}</td>
        <td class="acciones">
          <button class="btn-mini" data-editar-d="${d.id}" title="Editar">✏️</button>
          <button class="btn-mini" data-borrar-d="${d.id}" title="Eliminar">🗑️</button>
        </td>
      </tr>`).join('');

    cont.innerHTML = `
      <div class="trf-tabla-head">
        <span class="sub-panel-titulo">Descuentos de ${anio}</span>
        <button id="trf-nuevo-descuento" class="btn-pri">＋ Nuevo descuento</button>
      </div>
      <div class="tabla-scroll">
        <table class="tabla">
          <thead><tr><th>Nombre</th><th>Descuento %</th><th>Fecha inicio</th><th>Fecha fin</th><th>Condiciones</th><th>Estado</th><th></th></tr></thead>
          <tbody>${filas || `<tr><td colspan="7" style="color:#6b7280">Sin descuentos definidos para ${anio}</td></tr>`}</tbody>
        </table>
      </div>`;

    document.getElementById('trf-nuevo-descuento').addEventListener('click', () => modalDescuento(null));
    cont.querySelectorAll('[data-editar-d]').forEach((b) =>
      b.addEventListener('click', () => modalDescuento(descuentos.find((x) => x.id === Number(b.dataset.editarD)))));
    cont.querySelectorAll('[data-borrar-d]').forEach((b) =>
      b.addEventListener('click', () => borrarDescuento(Number(b.dataset.borrarD))));
  }

  // Lista en castellano: "A y A+" / "A, A+ y B".
  function listaY(arr) {
    if (arr.length <= 1) return arr.join('');
    return arr.slice(0, -1).join(', ') + ' y ' + arr[arr.length - 1];
  }

  async function modalDescuento(d) {
    d = d || {};
    const esNuevo = !d.id;
    let portalesAPI = [];
    try { portalesAPI = (await API.getPortales()).filter((p) => p.activo); } catch (e) { portalesAPI = []; }

    const tiposSel = parseArr(d.tipos);          // null = todos
    const portalesSel = parseArr(d.portales);    // null = todos
    const conMin = (d.min_noches || 0) > 0;
    const activoChecked = d.activo === undefined ? true : !!d.activo;

    const checksTipos = TIPOS_CLASIF.map((t) => `
      <label class="trf-check"><input type="checkbox" name="dc-tipo" value="${esc(t)}"${!tiposSel || tiposSel.includes(t) ? ' checked' : ''}><span>${badgeTipo(t)}</span></label>`).join('');
    const checksPortales = portalesAPI.length
      ? portalesAPI.map((p) => `
      <label class="trf-check"><input type="checkbox" name="dc-portal" value="${esc(p.nombre)}"${!portalesSel || portalesSel.includes(p.nombre) ? ' checked' : ''}><span>${esc(p.nombre)}</span></label>`).join('')
      : '<span style="color:var(--muted);font-size:13px">No hay portales configurados</span>';

    abrirModal(`
      <h3>${esNuevo ? 'Nuevo' : 'Editar'} descuento</h3>

      <div class="ficha-seccion-titulo">Datos del descuento</div>
      <div class="campo"><label>Nombre *</label><input id="dc-nombre" placeholder="Early booking junio" value="${esc(d.nombre)}"></div>
      <div class="fila-campos">
        <div class="campo"><label>Porcentaje de descuento (%) *</label><input type="number" id="dc-pct" step="0.5" min="0.5" max="100" value="${d.porcentaje != null ? d.porcentaje : ''}"></div>
        <div class="campo"><label>Fecha inicio *</label><input type="date" id="dc-inicio" value="${d.fecha_inicio || ''}"></div>
        <div class="campo"><label>Fecha fin *</label><input type="date" id="dc-fin" value="${d.fecha_fin || ''}"></div>
      </div>
      <label class="alo-switch"><input type="checkbox" id="dc-activo"${activoChecked ? ' checked' : ''}><span class="alo-switch-track"></span> Activo</label>
      <div class="campo"><label>Notas</label><textarea id="dc-notas">${esc(d.notas)}</textarea></div>

      <div class="ficha-seccion-titulo">Condiciones de aplicación</div>
      <label class="alo-switch"><input type="checkbox" id="dc-min-toggle"${conMin ? ' checked' : ''}><span class="alo-switch-track"></span> Aplicar solo si estancia mínima</label>
      <div class="campo trf-cond-bloque${conMin ? '' : ' oculto'}" id="dc-min-bloque">
        <label>Mínimo de noches</label>
        <input type="number" id="dc-min" min="1" step="1" value="${conMin ? d.min_noches : 7}">
      </div>
      <label class="alo-switch"><input type="checkbox" id="dc-tipos-toggle"${tiposSel ? ' checked' : ''}><span class="alo-switch-track"></span> Aplicar solo a ciertos tipos</label>
      <div class="trf-cond-bloque${tiposSel ? '' : ' oculto'}" id="dc-tipos-bloque">${checksTipos}</div>
      <label class="alo-switch"><input type="checkbox" id="dc-portales-toggle"${portalesSel ? ' checked' : ''}><span class="alo-switch-track"></span> Aplicar solo a ciertos portales</label>
      <div class="trf-cond-bloque${portalesSel ? '' : ' oculto'}" id="dc-portales-bloque">${checksPortales}</div>

      <div class="ficha-seccion-titulo">Preview del descuento</div>
      <div class="campo"><label>Precio ejemplo (€)</label><input type="number" id="dc-ejemplo" step="0.01" min="0" value="1000"></div>
      <div id="dc-preview" class="trf-dc-preview"></div>

      <div class="modal-acciones">
        <button class="btn-sec" id="dc-cancelar">Cancelar</button>
        <button class="btn-pri" id="dc-guardar">Guardar</button>
      </div>`);
    document.querySelector('.modal').classList.add('modal-ancho');

    const marcados = (name) => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);

    const actualizarPreview = () => {
      const pct = Number(val('dc-pct')) || 0;
      const ini = val('dc-inicio');
      const fin = val('dc-fin');
      const lineas = [];
      lineas.push(`${pct ? pct.toLocaleString('es-ES') : '—'}% de descuento` +
        (ini && fin ? ` del ${fechaES(ini)} al ${fechaES(fin)}` : ''));

      const conds = [];
      if (document.getElementById('dc-min-toggle').checked) {
        const n = Number(val('dc-min')) || 0;
        if (n > 0) conds.push(`estancia mínima ${n} noches`);
      }
      if (document.getElementById('dc-tipos-toggle').checked) {
        const t = marcados('dc-tipo');
        conds.push(t.length ? `solo tipos ${listaY(t)}` : 'ningún tipo seleccionado ⚠️');
      }
      if (document.getElementById('dc-portales-toggle').checked) {
        const p = marcados('dc-portal');
        conds.push(p.length ? `solo ${listaY(p)}` : 'ningún portal seleccionado ⚠️');
      }
      lineas.push(conds.length ? `Condiciones: ${conds.join(', ')}` : 'Sin condiciones (aplica a todo)');

      const base = Number(val('dc-ejemplo')) || 0;
      const imp = Math.round(base * pct) / 100;
      lineas.push(`Ejemplo: reserva de ${euro(base)} → descuento ${euro(imp)} → total ${euro(base - imp)}`);
      document.getElementById('dc-preview').innerHTML = lineas.map((l) => `<div>${l}</div>`).join('');
    };

    // Toggles que muestran/ocultan su bloque de condición.
    const enlazarToggle = (toggleId, bloqueId) => {
      document.getElementById(toggleId).addEventListener('change', (e) => {
        document.getElementById(bloqueId).classList.toggle('oculto', !e.target.checked);
        actualizarPreview();
      });
    };
    enlazarToggle('dc-min-toggle', 'dc-min-bloque');
    enlazarToggle('dc-tipos-toggle', 'dc-tipos-bloque');
    enlazarToggle('dc-portales-toggle', 'dc-portales-bloque');
    ['dc-nombre', 'dc-pct', 'dc-inicio', 'dc-fin', 'dc-min', 'dc-ejemplo'].forEach((id) =>
      document.getElementById(id).addEventListener('input', actualizarPreview));
    document.querySelectorAll('input[name="dc-tipo"], input[name="dc-portal"]').forEach((i) =>
      i.addEventListener('change', actualizarPreview));
    actualizarPreview();

    document.getElementById('dc-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('dc-guardar').addEventListener('click', async () => {
      const nombre = val('dc-nombre').trim();
      if (!nombre) return toast('El nombre es obligatorio', 'error');
      if (!val('dc-pct')) return toast('El porcentaje es obligatorio', 'error');
      if (!val('dc-inicio') || !val('dc-fin')) return toast('Las fechas son obligatorias', 'error');

      let tipos = null;
      if (document.getElementById('dc-tipos-toggle').checked) {
        tipos = marcados('dc-tipo');
        if (!tipos.length) return toast('Selecciona al menos un tipo', 'error');
      }
      let portales = null;
      if (document.getElementById('dc-portales-toggle').checked) {
        portales = marcados('dc-portal');
        if (!portales.length) return toast('Selecciona al menos un portal', 'error');
      }
      const body = {
        nombre,
        porcentaje: Number(val('dc-pct')),
        fecha_inicio: val('dc-inicio'),
        fecha_fin: val('dc-fin'),
        anio,
        min_noches: document.getElementById('dc-min-toggle').checked ? Number(val('dc-min')) || 0 : 0,
        tipos,
        portales,
        activo: document.getElementById('dc-activo').checked ? 1 : 0,
        notas: val('dc-notas'),
      };
      try {
        if (esNuevo) await API.post('/api/tarifas/descuentos', body);
        else await API.put(`/api/tarifas/descuentos/${d.id}`, body);
        cerrarModal();
        toast('Descuento guardado', 'ok');
        await cargarDescuentos();
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  async function borrarDescuento(id) {
    const d = descuentos.find((x) => x.id === id);
    if (!confirm(`¿Eliminar el descuento "${d ? d.nombre : ''}"?`)) return;
    try {
      await API.del(`/api/tarifas/descuentos/${id}`);
      toast('Descuento eliminado', 'ok');
      await cargarDescuentos();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ==================== Sub-pestaña Propietario (tabla de referencia informativa) ====================
  // Sistema independiente del de Particular (temporadas/modificadores de arriba): precio por
  // SEMANA, para decirle a un propietario con contrato "sin garantía" cuánto percibiría.
  // No se conecta a reservas ni contratos automáticamente.
  async function cargarPropietario() {
    const cont = panel('propietario');
    cont.innerHTML = '<div style="color:var(--muted);padding:8px 0">Cargando…</div>';
    try {
      [propietarioTemporadas, propietarioModificadores] = await Promise.all([
        API.get(`/api/tarifas/temporadas-propietario?anio=${anio}`),
        API.get('/api/tarifas/modificadores-propietario'),
      ]);
    } catch (e) {
      cont.innerHTML = '<div style="color:var(--muted);padding:8px 0">No se pudo cargar la tabla de propietario.</div>';
      return;
    }
    renderPropietario(cont);
  }

  // Tabla de precios/semana resultantes por tipo según el precio base introducido.
  function previewTiposHTMLPropietario(precio) {
    const base = Number(precio) || 0;
    const filas = propietarioModificadores.map((m) => `
      <tr>
        <td>${badgeTipo(m.tipo)}</td>
        <td>${pctMod(m.porcentaje)}</td>
        <td style="text-align:right;white-space:nowrap">${euro(base * (1 + (Number(m.porcentaje) || 0) / 100))}</td>
      </tr>`).join('');
    return `
      <table class="tabla trf-preview-tabla">
        <thead><tr><th>Tipo</th><th>Modificador</th><th style="text-align:right">Precio/semana</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>`;
  }

  function renderPropietario(cont) {
    const filas = propietarioTemporadas.map((t) => `
      <tr>
        <td>${esc(nombreTemporada(t))}</td>
        <td>${fechaES(t.fecha_inicio)}</td>
        <td>${fechaES(t.fecha_fin)}</td>
        <td style="text-align:right;white-space:nowrap">${euro(t.precio_base_semana)}</td>
        <td class="acciones">
          <button class="btn-mini" data-editar-prop="${t.id}">Editar</button>
          <button class="btn-mini" data-borrar-prop="${t.id}">Eliminar</button>
        </td>
      </tr>`).join('');

    const tablaTemporadas = `
      <div style="font-size:13px;color:var(--muted);margin-bottom:10px">
        Tabla de referencia informativa (contratos "sin garantía"): no se conecta a reservas ni contratos.
      </div>
      <div class="trf-tabla-head">
        <span class="sub-panel-titulo">Temporadas de propietario — ${anio}</span>
        <button id="trf-nueva-temporada-prop" class="btn-pri">＋ Nueva temporada</button>
      </div>
      <div class="tabla-scroll">
        <table class="tabla">
          <thead><tr><th>Nombre</th><th>Fecha inicio</th><th>Fecha fin</th><th style="text-align:right">Precio/semana (Tipo A)</th><th></th></tr></thead>
          <tbody>${filas || `<tr><td colspan="5" style="color:#6b7280">No hay temporadas de propietario definidas en ${anio}.</td></tr>`}</tbody>
        </table>
      </div>`;

    const filasMod = propietarioModificadores.map((m) => {
      const esA = m.tipo === 'A';
      const input = esA
        ? '<span style="color:var(--muted)">Base (referencia)</span>'
        : `<input type="number" step="1" class="trf-mod-input" data-modp-id="${m.id}" data-original="${m.porcentaje}" value="${m.porcentaje}"> %`;
      return `
        <tr>
          <td>${esc(m.tipo)}</td>
          <td>${badgeTipo(m.tipo)}</td>
          <td>${input}</td>
          <td style="text-align:right;white-space:nowrap" data-ejemplo-prop="${m.id}"></td>
        </tr>`;
    }).join('');

    const tablaMod = `
      <div class="trf-tabla-head" style="margin-top:28px">
        <span class="sub-panel-titulo">Modificadores por tipo (propietario)</span>
        <div class="trf-mod-controles">
          <label for="trfp-mod-base" style="font-size:13px;color:var(--muted)">Precio ejemplo (€/semana)</label>
          <input type="number" id="trfp-mod-base" step="0.01" min="0" value="700" class="trf-mod-input">
          <button id="trfp-mod-guardar" class="btn-pri">Guardar cambios</button>
        </div>
      </div>
      <div class="tabla-scroll">
        <table class="tabla">
          <thead><tr><th>Tipo</th><th>Badge</th><th>Modificador %</th><th style="text-align:right">Precio ejemplo</th></tr></thead>
          <tbody>${filasMod}</tbody>
        </table>
      </div>`;

    cont.innerHTML = tablaTemporadas + tablaMod;

    document.getElementById('trf-nueva-temporada-prop').addEventListener('click', () => modalTemporadaPropietario(null));
    cont.querySelectorAll('[data-editar-prop]').forEach((b) =>
      b.addEventListener('click', () => modalTemporadaPropietario(Number(b.dataset.editarProp))));
    cont.querySelectorAll('[data-borrar-prop]').forEach((b) =>
      b.addEventListener('click', () => borrarTemporadaPropietario(Number(b.dataset.borrarProp))));

    const actualizarEjemplosProp = () => {
      const base = Number(val('trfp-mod-base')) || 0;
      for (const m of propietarioModificadores) {
        const inp = cont.querySelector(`[data-modp-id="${m.id}"]`);
        const pct = inp ? (Number(inp.value) || 0) : 0; // A no tiene input -> 0
        const celda = cont.querySelector(`[data-ejemplo-prop="${m.id}"]`);
        if (celda) celda.textContent = euro(base * (1 + pct / 100));
      }
    };
    document.getElementById('trfp-mod-base').addEventListener('input', actualizarEjemplosProp);
    cont.querySelectorAll('[data-modp-id]').forEach((inp) => inp.addEventListener('input', actualizarEjemplosProp));
    actualizarEjemplosProp();

    document.getElementById('trfp-mod-guardar').addEventListener('click', async () => {
      const cambiados = [...cont.querySelectorAll('[data-modp-id]')]
        .filter((inp) => Number(inp.value) !== Number(inp.dataset.original));
      if (!cambiados.length) return toast('No hay cambios que guardar', 'ok');
      try {
        for (const inp of cambiados) {
          await API.put(`/api/tarifas/modificadores-propietario/${inp.dataset.modpId}`, { porcentaje: Number(inp.value) || 0 });
        }
        toast(`${cambiados.length} modificador(es) actualizado(s)`, 'ok');
        await cargarPropietario();
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  function modalTemporadaPropietario(id) {
    const t = id ? propietarioTemporadas.find((x) => x.id === id) : null;

    abrirModal(`
      <h3>${t ? 'Editar' : 'Nueva'} temporada (propietario)</h3>
      <div class="campo"><label>Nombre</label><input id="tpp-nombre" placeholder="Temporada Alta" value="${t ? esc(t.nombre) : ''}"></div>
      <div class="fila-campos">
        <div class="campo"><label>Fecha inicio *</label><input type="date" id="tpp-inicio" value="${t ? t.fecha_inicio : ''}"></div>
        <div class="campo"><label>Fecha fin *</label><input type="date" id="tpp-fin" value="${t ? t.fecha_fin : ''}"></div>
      </div>
      <div class="campo">
        <label>Precio/semana (Tipo A) *</label>
        <input type="number" step="0.01" min="0" id="tpp-precio" value="${t ? t.precio_base_semana : ''}">
        <div style="font-size:12px;color:var(--muted);margin-top:6px">Este es el precio para Tipo A</div>
      </div>
      <div class="campo">
        <label>Precios resultantes por tipo</label>
        <div id="tpp-preview">${previewTiposHTMLPropietario(t ? t.precio_base_semana : 0)}</div>
      </div>
      <div class="modal-acciones">
        <button class="btn-sec" id="tpp-cancelar">Cancelar</button>
        <button class="btn-pri" id="tpp-guardar">Guardar</button>
      </div>`);

    document.getElementById('tpp-precio').addEventListener('input', (e) => {
      document.getElementById('tpp-preview').innerHTML = previewTiposHTMLPropietario(e.target.value);
    });
    document.getElementById('tpp-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('tpp-guardar').addEventListener('click', async () => {
      const body = {
        nombre: val('tpp-nombre'),
        fecha_inicio: val('tpp-inicio'),
        fecha_fin: val('tpp-fin'),
        precio_base_semana: val('tpp-precio'),
        anio,
      };
      try {
        if (t) await API.put(`/api/tarifas/temporadas-propietario/${t.id}`, body);
        else await API.post('/api/tarifas/temporadas-propietario', body);
        cerrarModal();
        toast('Temporada guardada', 'ok');
        await cargarPropietario();
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  async function borrarTemporadaPropietario(id) {
    const t = propietarioTemporadas.find((x) => x.id === id);
    if (!confirm(`¿Eliminar la temporada "${t ? nombreTemporada(t) : ''}"?`)) return;
    try {
      await API.del(`/api/tarifas/temporadas-propietario/${id}`);
      toast('Temporada eliminada', 'ok');
      await cargarPropietario();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ==================== Sub-pestaña Consultar precio (comparativa) ====================
  // Solo lectura: GET /api/tarifas/comparar. No crea ni modifica nada, no depende del año
  // seleccionado arriba (usa las fechas elegidas aquí).
  async function cargarComparar() {
    const cont = panel('comparar');
    if (mayoristasComparar === null) {
      try {
        const todos = await API.get('/api/mayoristas');
        mayoristasComparar = (todos || []).filter((m) => m.activo === undefined || !!m.activo);
      } catch (e) {
        mayoristasComparar = [];
      }
    }
    renderComparar(cont);
  }

  function renderComparar(cont) {
    cont.innerHTML = `
      <div style="font-size:13px;color:var(--muted);margin-bottom:10px">
        Consulta el precio por noche de una estancia en los tres sistemas (Particular, Propietario y
        Mayorista) para cada tipo de apartamento. Solo consulta: no crea ni modifica nada.
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Fecha entrada</label><input type="date" id="cmp-entrada"></div>
        <div class="campo"><label>Fecha salida</label><input type="date" id="cmp-salida"></div>
        <div class="campo">
          <label>Mayorista</label>
          <select id="cmp-mayorista">
            <option value="">— Sin mayorista —</option>
            ${mayoristasComparar.map((m) => `<option value="${m.id}">${esc(m.nombre)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div id="cmp-resultado"><div style="color:var(--muted);padding:8px 0">Elige fechas para consultar precios.</div></div>`;

    ['cmp-entrada', 'cmp-salida', 'cmp-mayorista'].forEach((id) =>
      document.getElementById(id).addEventListener('change', programarComparar));
  }

  function programarComparar() {
    clearTimeout(compararTimer);
    compararTimer = setTimeout(ejecutarComparar, 400);
  }

  function celdaComparar(r) {
    if (!r) return '<span style="color:var(--muted)">—</span>';
    if (r.ok) return euro(r.precio_total);
    return `<span style="color:var(--muted)">${esc(r.error || 'Sin tarifa definida')}</span>`;
  }

  function celdaMayorista(r, mayoristaElegido) {
    if (!mayoristaElegido) return '<span style="color:var(--muted)">Elige un mayorista</span>';
    if (!r || r.requiere_mayorista) return '<span style="color:var(--muted)">Elige un mayorista</span>';
    if (!r.ok) return `<span style="color:var(--muted)">${esc(r.error || 'Sin partida configurada')}</span>`;
    return (r.opciones || []).map((o) => `<div>${esc(o.nombre || 'Mayorista')}: ${euro(o.precio_total)}</div>`).join('');
  }

  async function ejecutarComparar() {
    const resultado = document.getElementById('cmp-resultado');
    if (!resultado) return;
    const entrada = val('cmp-entrada');
    const salida = val('cmp-salida');
    const mayoristaId = val('cmp-mayorista');

    if (!entrada || !salida) {
      resultado.innerHTML = '<div style="color:var(--muted);padding:8px 0">Elige fechas para consultar precios.</div>';
      return;
    }
    if (entrada >= salida) {
      resultado.innerHTML = '<div style="color:var(--muted);padding:8px 0">La fecha de entrada debe ser anterior a la de salida.</div>';
      return;
    }

    const token = ++compararToken;
    resultado.innerHTML = '<div style="color:var(--muted);padding:8px 0">Calculando…</div>';

    let data;
    try {
      let url = `/api/tarifas/comparar?entrada=${encodeURIComponent(entrada)}&salida=${encodeURIComponent(salida)}`;
      if (mayoristaId) url += `&mayorista_id=${encodeURIComponent(mayoristaId)}`;
      data = await API.get(url);
    } catch (e) {
      if (token !== compararToken) return;
      resultado.innerHTML = `<div style="color:var(--muted);padding:8px 0">${esc(e.message)}</div>`;
      return;
    }
    if (token !== compararToken) return;

    const filas = (data.tipos || []).map((t) => `
      <tr>
        <td>${badgeTipo(t.tipo)}</td>
        <td style="text-align:right;white-space:nowrap">${celdaComparar(t.particular)}</td>
        <td style="text-align:right;white-space:nowrap">${celdaComparar(t.propietario)}</td>
        <td style="text-align:right">${celdaMayorista(t.mayorista, mayoristaId)}</td>
      </tr>`).join('');

    resultado.innerHTML = `
      <div class="tabla-scroll">
        <table class="tabla">
          <thead><tr><th>Tipo</th><th style="text-align:right">Particular</th><th style="text-align:right">Propietario</th><th style="text-align:right">Mayorista</th></tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>`;
  }

  function val(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
  }

  return { init, cargar };
})();
