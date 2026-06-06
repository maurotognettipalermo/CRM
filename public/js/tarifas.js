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

  let anio = new Date().getFullYear();
  let subActiva = 'temporadas';
  let temporadas = [];        // temporadas del año seleccionado
  let modificadores = [];     // tipo_modificadores (cache, no depende del año)

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
          dias += `<div class="trf-cal-dia cubierto" style="background:${esc(t.color)}" title="${esc(t.nombre)} — ${euro(t.precio_base_noche)}/noche (${fechaES(fecha)})"></div>`;
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
        <td>${esc(t.nombre)}</td>
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
      <div class="campo"><label>Nombre *</label><input id="tp-nombre" placeholder="Temporada Alta" value="${t ? esc(t.nombre) : ''}"></div>
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
    if (!confirm(`¿Eliminar la temporada "${t ? t.nombre : ''}"?`)) return;
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

  // ==================== Sub-pestaña Descuentos (pendiente: tarea 3) ====================
  async function cargarDescuentos() {
    panel('descuentos').innerHTML =
      '<div style="color:var(--muted);padding:8px 0">La gestión de descuentos estará disponible próximamente.</div>';
  }

  function val(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
  }

  return { init, cargar };
})();
