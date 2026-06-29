// Módulo Contratos (window.Contratos). Lista de contratos de gestión con el propietario
// (precio cerrado o comisión), ficha en panel lateral y modal de alta/edición con plan de
// pagos dinámico. Patrón IIFE como Reservas; el panel lateral se crea por JS.

const Contratos = (() => {
  const ANIOS = [2024, 2025, 2026];

  let todos = [];            // contratos del año (enriquecidos con sus cuotas)
  let apartamentos = [];     // para el modal + autorelleno de propietario
  let reservasCache = null;  // reservas (para el cálculo de comisión en la ficha)
  let filtroAnio = new Date().getFullYear();
  let filtroTipo = '';       // '' | 'precio_cerrado' | 'comision'
  let filtroPropId = '';     // '' = todos | id del propietario (string)
  let filtroPropNombre = ''; // nombre del propietario filtrado (para el select)
  let fichaActual = null;    // contrato abierto en el panel
  let aptoSelId = null;      // apartamento seleccionado en el modal
  let cuotasModal = [];      // cuotas en edición en el modal
  let fechasModal = [];      // fechas del propietario en edición en el modal
  let taMatches = [];        // resultados actuales del autocompletado de apartamento
  let taIndex = -1;          // opción resaltada en el dropdown (navegación con teclado)

  // ---- Formato ----
  function euro(n) {
    return (Number(n) || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }
  function pct(n) {
    return (Number(n) || 0).toLocaleString('es-ES', { maximumFractionDigits: 2 }) + '%';
  }
  function nombrePropietario(c) {
    const nom = `${c.propietario_nombre || ''} ${c.propietario_apellidos || ''}`.trim();
    return nom || '—';
  }
  function tipoTexto(t) {
    return t === 'comision' ? 'Comisión' : 'Precio cerrado';
  }
  function estadoTexto(e) {
    return (e || 'activo').charAt(0).toUpperCase() + (e || 'activo').slice(1);
  }
  // Fecha ISO -> "DD/MM" (para el resumen de disponibilidad).
  function fechaCorta(iso) {
    if (!iso) return '—';
    const [, m, d] = String(iso).split('-');
    return d && m ? `${d}/${m}` : iso;
  }
  // Días entre dos fechas ISO contando ambos extremos (inclusive).
  function diasInclusive(a, b) {
    if (!a || !b) return 0;
    const ms = new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00');
    return Math.round(ms / 86400000) + 1;
  }
  // Días del año (maneja bisiestos).
  function diasAnio(anio) {
    const y = Number(anio);
    return Math.round((new Date(y, 11, 31) - new Date(y, 0, 1)) / 86400000) + 1;
  }

  // ---- Badges ----
  function badgeTipo(tipo) {
    const clase = tipo === 'comision' ? 'comision' : 'cerrado';
    return `<span class="badge-tipo ${clase}">${tipoTexto(tipo)}</span>`;
  }
  function badgeEstado(estado) {
    // Reutiliza .badge-estado: activo=verde, finalizado=gris(neutro), cancelado=rojo(inactivo).
    const map = { activo: 'activo', finalizado: 'neutro', cancelado: 'inactivo' };
    const clase = map[estado] || 'neutro';
    return `<span class="badge-estado ${clase}">${estadoTexto(estado)}</span>`;
  }

  // ---- Fiscalidad (IVA 21% + retención IRPF) ----
  function retencionTexto(r) {
    const n = Number(r) || 0;
    if (n === 19) return '19% Residentes';
    if (n === 24) return '24% No residentes';
    return 'Sin retención';
  }
  function fiscalidadCalc(base, aplicaIva, retPct) {
    base = Number(base) || 0;
    const iva = aplicaIva ? base * 0.21 : 0;
    const ret = base * (Number(retPct) || 0) / 100;
    return { base, iva, ret, total: base + iva - ret };
  }
  // Bloque resumen de 4 campos (precio base / +IVA / −retención / total a pagar).
  function resumenFiscalHTML(base, aplicaIva, retPct) {
    const f = fiscalidadCalc(base, aplicaIva, retPct);
    const rows = [`<div class="cnt-fisc-row"><span>Precio base:</span><span>${euro(f.base)}</span></div>`];
    if (aplicaIva) rows.push(`<div class="cnt-fisc-row"><span>+ IVA 21%:</span><span>${euro(f.iva)}</span></div>`);
    if (f.ret > 0) rows.push(`<div class="cnt-fisc-row"><span>− Retención ${Number(retPct) || 0}%:</span><span>${euro(f.ret)} <em>(sobre precio base)</em></span></div>`);
    rows.push(`<div class="cnt-fisc-row total"><span>Total a pagar:</span><span>${euro(f.total)}</span></div>`);
    return `<div class="cnt-fisc-resumen-box">${rows.join('')}</div>`;
  }

  // ==================== Carga + tabla ====================

  async function cargar() {
    try {
      const lista = await API.get(`/api/contratos?anio=${filtroAnio}`);
      // El endpoint de lista no trae el recuento de cuotas; lo obtenemos de la ficha de cada
      // contrato (dataset pequeño: una oficina). De paso cacheamos las cuotas para la ficha.
      const detalles = await Promise.all(
        lista.map((c) => API.get('/api/contratos/' + c.id).catch(() => null))
      );
      todos = lista.map((c, i) => ({ ...c, cuotas: (detalles[i] && detalles[i].cuotas) || [] }));
      poblarPropietarios();
      renderTabla(filtrar());
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function filtrar() {
    return todos.filter((c) =>
      (!filtroTipo || c.tipo === filtroTipo) &&
      (!filtroPropId || String(c.propietario_id) === filtroPropId)
    );
  }

  function celdaCuotas(c) {
    const total = c.cuotas.length;
    if (c.tipo === 'comision' || total === 0) return '<span style="color:#9ca3af">—</span>';
    const pagadas = c.cuotas.filter((q) => q.pagado).length;
    const w = Math.round((pagadas / total) * 100);
    return `
      <div class="cnt-cuotas-cel">
        <span class="cnt-cuotas-txt">${pagadas}/${total} pagadas</span>
        <span class="cnt-barra"><span class="cnt-barra-fill" style="width:${w}%"></span></span>
      </div>`;
  }

  function celdaImporte(c) {
    return c.tipo === 'comision' ? pct(c.porcentaje_comision) : euro(c.precio_total);
  }

  function renderTabla(lista) {
    const tbody = document.querySelector('#tabla-contratos tbody');
    tbody.innerHTML = '';
    if (!lista.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="cnt-vacio">No hay contratos para los filtros actuales.</td></tr>';
      return;
    }
    for (const c of lista) {
      const tr = document.createElement('tr');
      tr.dataset.ficha = c.id;
      tr.innerHTML = `
        <td><span class="enlace-fila">${esc(c.apartamento_nombre)}</span></td>
        <td>${esc(nombrePropietario(c))}</td>
        <td>${badgeTipo(c.tipo)}</td>
        <td>${fechaES(c.temporada_inicio)} → ${fechaES(c.temporada_fin)}</td>
        <td>${celdaImporte(c)}</td>
        <td>${celdaCuotas(c)}</td>
        <td>${badgeEstado(c.estado)}</td>
        <td class="acciones">
          <button class="btn-mini" data-editar="${c.id}">Editar</button>
          <button class="btn-mini" data-borrar="${c.id}">Eliminar</button>
        </td>`;
      tbody.appendChild(tr);
    }
    tbody.querySelectorAll('tr[data-ficha]').forEach((tr) =>
      tr.addEventListener('click', (e) => {
        if (e.target.closest('[data-editar]') || e.target.closest('[data-borrar]')) return;
        abrirFicha(tr.dataset.ficha);
      })
    );
    tbody.querySelectorAll('[data-editar]').forEach((el) =>
      el.addEventListener('click', (e) => { e.stopPropagation(); formulario(el.dataset.editar); })
    );
    tbody.querySelectorAll('[data-borrar]').forEach((el) =>
      el.addEventListener('click', (e) => { e.stopPropagation(); borrar(el.dataset.borrar); })
    );
  }

  // ==================== Panel lateral (ficha) ====================

  function crearPanel() {
    if (document.getElementById('cnt-panel')) return;
    const fondo = document.createElement('div');
    fondo.id = 'cnt-panel-fondo';
    fondo.className = 'panel-fondo';
    const panel = document.createElement('aside');
    panel.id = 'cnt-panel';
    panel.className = 'panel-lateral';
    panel.setAttribute('aria-label', 'Ficha de contrato');
    panel.innerHTML = `
      <header class="panel-cabecera">
        <div class="rsv-titulo-grupo">
          <h3 id="cnt-titulo">Contrato</h3>
          <span id="cnt-badge-tipo"></span>
          <span id="cnt-badge-estado"></span>
        </div>
        <div class="panel-cabecera-acciones">
          <div id="cnt-dl-wrap" style="position:relative;display:inline-block">
            <button id="cnt-descargar" class="btn-sec">📄 Descargar contrato ▾</button>
            <div id="cnt-dl-menu" class="oculto" style="position:absolute;top:100%;right:0;z-index:60;background:#fff;border:1px solid var(--border);border-radius:8px;box-shadow:0 6px 16px rgba(0,0,0,.14);min-width:190px;overflow:hidden;margin-top:4px">
              <button class="cnt-dl-op" data-fmt="pdf" style="display:block;width:100%;text-align:left;padding:9px 14px;border:0;background:none;cursor:pointer;font-size:14px">📥 Descargar PDF</button>
              <button class="cnt-dl-op" data-fmt="docx" style="display:block;width:100%;text-align:left;padding:9px 14px;border:0;background:none;cursor:pointer;font-size:14px">📥 Descargar Word</button>
            </div>
          </div>
          <button id="cnt-editar" class="btn-sec">Editar</button>
          <button id="cnt-cerrar" class="panel-cerrar" title="Cerrar">&times;</button>
        </div>
      </header>
      <div id="cnt-cuerpo" class="panel-cuerpo"></div>`;
    document.body.appendChild(fondo);
    document.body.appendChild(panel);

    fondo.addEventListener('click', cerrarPanel);
    panel.querySelector('#cnt-cerrar').addEventListener('click', cerrarPanel);
    panel.querySelector('#cnt-editar').addEventListener('click', () => { if (fichaActual) formulario(fichaActual.id); });
    // Dropdown "Descargar contrato": PDF o Word.
    const dlMenu = panel.querySelector('#cnt-dl-menu');
    panel.querySelector('#cnt-descargar').addEventListener('click', (e) => {
      e.stopPropagation();
      dlMenu.classList.toggle('oculto');
    });
    panel.querySelectorAll('.cnt-dl-op').forEach((op) =>
      op.addEventListener('click', () => {
        dlMenu.classList.add('oculto');
        if (fichaActual) descargarContrato(fichaActual.id, op.dataset.fmt);
      }));
    document.addEventListener('click', () => dlMenu.classList.add('oculto'));
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const modalAbierto = !document.getElementById('modal-fondo').classList.contains('oculto');
      if (!modalAbierto && panel.classList.contains('abierto')) cerrarPanel();
    }, true);
  }

  function abrirPanel() {
    document.getElementById('cnt-panel-fondo').classList.add('abierto');
    document.getElementById('cnt-panel').classList.add('abierto');
  }
  function cerrarPanel() {
    document.getElementById('cnt-panel-fondo').classList.remove('abierto');
    document.getElementById('cnt-panel').classList.remove('abierto');
    fichaActual = null;
  }

  async function abrirFicha(id) {
    crearPanel();
    try {
      fichaActual = await API.get('/api/contratos/' + id);
    } catch (e) {
      return toast(e.message, 'error');
    }
    await renderFicha();
    abrirPanel();
  }

  function dato(etq, val, clase) {
    return `<div class="rsv-dato"><div class="etq">${etq}</div><div class="val${clase ? ' ' + clase : ''}">${val}</div></div>`;
  }

  // Cuerpo de la ficha: datos del contrato + plan de pagos (cerrado) o resumen comisión.
  async function renderFicha() {
    const c = fichaActual;
    document.getElementById('cnt-titulo').textContent = c.apartamento_nombre || 'Contrato';
    document.getElementById('cnt-badge-tipo').innerHTML = badgeTipo(c.tipo);
    document.getElementById('cnt-badge-estado').innerHTML = badgeEstado(c.estado);

    const esCerrado = c.tipo !== 'comision';
    const aptoLink = `<span class="cnt-link" data-ir-apto="${c.apartamento_id}">${esc(c.apartamento_nombre)}</span>`;
    const importeDato = c.tipo === 'comision'
      ? dato('Porcentaje comisión', pct(c.porcentaje_comision))
      : dato('Precio total', euro(c.precio_total));

    const izquierda =
      dato('Apartamento', aptoLink) +
      dato('Propietario', esc(nombrePropietario(c))) +
      dato('Tipo de contrato', badgeTipo(c.tipo)) +
      dato('Temporada', `${fechaES(c.temporada_inicio)} → ${fechaES(c.temporada_fin)}`);

    const fiscalDatos = esCerrado
      ? dato('IVA aplicado', c.aplica_iva ? 'Sí (21%)' : 'No') +
        dato('Retención', retencionTexto(c.porcentaje_retencion))
      : '';

    const derecha =
      dato('Año', c.anio) +
      importeDato +
      fiscalDatos +
      dato('Estado', badgeEstado(c.estado)) +
      dato('Creado por', `${esc(c.created_by) || '—'}${c.created_at ? ' · ' + fechaES(String(c.created_at).split(' ')[0]) : ''}`);

    const cuerpoExtra = c.tipo === 'comision'
      ? await seccionComision(c)
      : seccionPlanPagos(c);

    const calculoFiscal = esCerrado
      ? `<div class="rsv-seccion-titulo">Cálculo fiscal</div>${resumenFiscalHTML(c.precio_total, c.aplica_iva, c.porcentaje_retencion)}`
      : '';

    document.getElementById('cnt-cuerpo').innerHTML = `
      <div class="rsv-seccion-titulo">Datos del contrato</div>
      <div class="rsv-grid"><div>${izquierda}</div><div>${derecha}</div></div>
      ${c.notas ? `<div class="rsv-dato" style="margin-top:8px"><div class="etq">Notas</div><div class="val">${esc(c.notas)}</div></div>` : ''}
      ${calculoFiscal}
      ${cuerpoExtra}
      <div id="cnt-fechas-prop"></div>`;

    await renderFechasPropietario(c);

    const link = document.querySelector('#cnt-cuerpo [data-ir-apto]');
    if (link) link.addEventListener('click', () => {
      cerrarPanel();
      activarTab('alojamientos');
      Alojamientos.abrirFicha(link.dataset.irApto);
    });

    // Botones de marcar/desmarcar pago (solo precio cerrado).
    document.querySelectorAll('#cnt-cuerpo [data-pagar]').forEach((b) =>
      b.addEventListener('click', () => modalPago(c.id, Number(b.dataset.pagar))));
    document.querySelectorAll('#cnt-cuerpo [data-despagar]').forEach((b) =>
      b.addEventListener('click', () => desmarcarPago(c.id, Number(b.dataset.despagar))));
  }

  // Plan de pagos (cuotas) con totales.
  function seccionPlanPagos(c) {
    const cuotas = (c.cuotas || []).slice().sort((a, b) => a.numero_cuota - b.numero_cuota);
    if (!cuotas.length) {
      return '<div class="rsv-seccion-titulo">Plan de pagos</div><div class="cnt-vacio">Este contrato no tiene cuotas.</div>';
    }
    const total = cuotas.reduce((s, q) => s + (Number(q.importe) || 0), 0);
    const pagado = cuotas.filter((q) => q.pagado).reduce((s, q) => s + (Number(q.importe) || 0), 0);
    const base = Number(c.precio_total) || total; // precio base = suma de cuotas (cuadran por validación)
    const pendiente = base - pagado;
    const f = fiscalidadCalc(base, c.aplica_iva, c.porcentaje_retencion);

    // Transferencia neta por cuota = importe + IVA − retención (mismos factores que la fiscalidad del contrato).
    const factorIVA = c.aplica_iva ? 0.21 : 0;
    const factorRet = c.porcentaje_retencion ? c.porcentaje_retencion / 100 : 0;

    const filas = cuotas.map((q) => {
      const badge = q.pagado
        ? '<span class="badge-estado activo">Pagado</span>'
        : '<span class="badge-estado" style="background:#fff7ed;color:#c2410c">Pendiente</span>';
      const accion = q.pagado
        ? `<button class="btn-mini" data-despagar="${q.id}">Desmarcar</button>`
        : `<button class="btn-mini" data-pagar="${q.id}">✓ Marcar pagado</button>`;
      const transferencia = (Number(q.importe) || 0) * (1 + factorIVA) - (Number(q.importe) || 0) * factorRet;
      return `
        <tr>
          <td>${q.numero_cuota}</td>
          <td>${fechaES(q.fecha_prevista)}</td>
          <td>${euro(q.importe)}</td>
          <td style="font-weight:700;color:#3b82f6">${euro(transferencia)}</td>
          <td>${badge}</td>
          <td>${q.fecha_pago ? fechaES(q.fecha_pago) : '—'}</td>
          <td class="acciones">${accion}</td>
        </tr>`;
    }).join('');

    return `
      <div class="rsv-seccion-titulo">Plan de pagos</div>
      <div class="tabla-scroll">
        <table class="tabla cnt-tabla-cuotas">
          <thead><tr><th>Nº</th><th>Fecha prevista</th><th>Importe</th><th>Transferencia</th><th>Estado</th><th>Fecha pago real</th><th></th></tr></thead>
          <tbody>${filas}</tbody>
          <tfoot>
            <tr><td colspan="2">Precio base</td><td colspan="5">${euro(f.base)}</td></tr>
            <tr><td colspan="2">IVA${c.aplica_iva ? ' 21%' : ''}</td><td colspan="5">${euro(f.iva)}</td></tr>
            <tr><td colspan="2">Retención${Number(c.porcentaje_retencion) ? ' ' + (Number(c.porcentaje_retencion) || 0) + '%' : ''}</td><td colspan="5">−${euro(f.ret)}</td></tr>
            <tr class="cnt-fila-total"><td colspan="2">Total a pagar</td><td colspan="5">${euro(f.total)}</td></tr>
            <tr><td colspan="2">Pagado</td><td colspan="5" style="color:#059669">${euro(pagado)}</td></tr>
            <tr><td colspan="2">Pendiente</td><td colspan="5" style="color:var(--red)">${euro(pendiente)}</td></tr>
          </tfoot>
        </table>
      </div>`;
  }

  // Resumen de comisión: reservas del apartamento ese año + comisión calculada.
  async function seccionComision(c) {
    if (!reservasCache) {
      try { reservasCache = await API.get('/api/reservas/todas'); }
      catch (e) { reservasCache = []; }
    }
    const porc = Number(c.porcentaje_comision) || 0;
    const reservas = reservasCache.filter((r) =>
      r.apartamento_id === c.apartamento_id &&
      String(r.entrada || '').slice(0, 4) === String(c.anio) &&
      (r.tipo_reserva || '') !== 'Cancelada'
    );

    let totalComision = 0;
    const filas = reservas.map((r) => {
      const base = Number(r.precio_total) || 0;
      const com = base * porc / 100;
      totalComision += com;
      return `
        <tr>
          <td>${esc(r.numero_reserva)}</td>
          <td>${esc(r.nombre_cliente)}</td>
          <td>${fechaES(r.entrada)} → ${fechaES(r.salida)}</td>
          <td>${euro(base)}</td>
          <td>${euro(com)}</td>
        </tr>`;
    }).join('');

    const tabla = reservas.length
      ? `<div class="tabla-scroll"><table class="tabla cnt-tabla-cuotas">
           <thead><tr><th>Nº Reserva</th><th>Cliente</th><th>Estancia</th><th>Importe reserva</th><th>Comisión</th></tr></thead>
           <tbody>${filas}</tbody>
           <tfoot><tr><td colspan="4">Total comisión generada</td><td>${euro(totalComision)}</td></tr></tfoot>
         </table></div>`
      : '<div class="cnt-vacio">No hay reservas de este apartamento en ' + c.anio + '.</div>';

    return `
      <div class="rsv-seccion-titulo">Resumen comisión</div>
      ${dato('Porcentaje pactado', pct(porc))}
      ${tabla}
      <div class="cnt-rango-info">Los pagos de comisión se gestionan desde Liquidación de propietarios.</div>`;
  }

  // ---- Mini modal: marcar cuota como pagada (con fecha) ----
  function modalPago(contratoId, cuotaId) {
    const hoy = new Date().toISOString().slice(0, 10);
    abrirModal(`
      <h3>Marcar cuota como pagada</h3>
      <div class="campo">
        <label>Fecha de pago</label>
        <input type="date" id="cnt-pago-fecha" value="${hoy}">
      </div>
      <div class="modal-acciones">
        <button class="btn-sec" id="cnt-pago-cancelar">Cancelar</button>
        <button class="btn-pri" id="cnt-pago-ok">Confirmar pago</button>
      </div>`);
    document.getElementById('cnt-pago-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('cnt-pago-ok').addEventListener('click', async () => {
      const fecha = document.getElementById('cnt-pago-fecha').value || hoy;
      try {
        await API.put(`/api/contratos/${contratoId}/cuotas/${cuotaId}`, { pagado: 1, fecha_pago: fecha });
        cerrarModal();
        await abrirFicha(contratoId);
        await cargar();
        toast('Cuota marcada como pagada', 'ok');
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  async function desmarcarPago(contratoId, cuotaId) {
    if (!confirm('¿Marcar esta cuota como pendiente (deshacer el pago)?')) return;
    try {
      await API.put(`/api/contratos/${contratoId}/cuotas/${cuotaId}`, { pagado: 0 });
      await abrirFicha(contratoId);
      await cargar();
      toast('Pago deshecho', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ==================== Fechas del propietario (ficha) ====================

  // Sección "Fechas del propietario" del panel: lista + resumen de disponibilidad.
  async function renderFechasPropietario(c) {
    const cont = document.getElementById('cnt-fechas-prop');
    if (!cont) return;
    let fechas = [];
    try { fechas = await API.get(`/api/contratos/${c.id}/fechas-propietario`); }
    catch (e) { fechas = []; }

    const lista = fechas.length
      ? fechas.map((f) => `
          <div class="cnt-fp-item">
            <div class="cnt-fp-item-main">
              <span class="badge-uso-prop">Uso propietario</span>
              <span class="cnt-fp-fechas">${fechaES(f.fecha_inicio)} → ${fechaES(f.fecha_fin)}</span>
              ${f.motivo ? `<span class="cnt-fp-motivo">${esc(f.motivo)}</span>` : ''}
            </div>
            <button class="btn-mini" data-del-fp="${f.id}" title="Eliminar">🗑</button>
          </div>`).join('')
      : '<div class="cnt-vacio">El propietario no ha reservado fechas este período.</div>';

    const periodo = diasInclusive(c.temporada_inicio, c.temporada_fin);
    const uso = fechas.reduce((s, f) => s + diasInclusive(f.fecha_inicio, f.fecha_fin), 0);
    const disponible = periodo - uso;
    const anio = c.anio || Number(String(c.temporada_inicio).slice(0, 4));
    const fuera = diasAnio(anio) - periodo;

    cont.innerHTML = `
      <div class="cnt-fp-head">
        <span class="rsv-seccion-titulo cnt-fp-titulo">Fechas del propietario</span>
        <button class="btn-sec" id="cnt-fp-add">＋ Añadir fechas</button>
      </div>
      <div class="cnt-fp-lista">${lista}</div>
      <div class="cnt-fp-resumen">
        <div class="cnt-fp-resumen-tit">📊 Resumen de disponibilidad</div>
        <ul>
          <li>Período del contrato: ${fechaCorta(c.temporada_inicio)} — ${fechaCorta(c.temporada_fin)} (${periodo} días)</li>
          <li>Uso propietario: ${uso} días</li>
          <li>Disponible para alquiler: ${disponible} días</li>
          <li>Fuera de contrato (bloqueado): ${fuera} días</li>
        </ul>
      </div>`;

    document.getElementById('cnt-fp-add').addEventListener('click', () => modalAnadirFechas(c));
    cont.querySelectorAll('[data-del-fp]').forEach((b) =>
      b.addEventListener('click', () => borrarFechaProp(c.id, Number(b.dataset.delFp))));
  }

  // Modal "Añadir fechas del propietario" (valida que caigan dentro del contrato).
  function modalAnadirFechas(c) {
    const rango = `${fechaCorta(c.temporada_inicio)} — ${fechaCorta(c.temporada_fin)}`;
    abrirModal(`
      <h3>Añadir fechas del propietario</h3>
      <div class="fila-campos">
        <div class="campo"><label>Fecha inicio *</label><input type="date" id="cnt-fp-inicio" min="${c.temporada_inicio}" max="${c.temporada_fin}" value="${c.temporada_inicio}"></div>
        <div class="campo"><label>Fecha fin *</label><input type="date" id="cnt-fp-fin" min="${c.temporada_inicio}" max="${c.temporada_fin}"></div>
      </div>
      <div class="cnt-fp-aviso oculto" id="cnt-fp-aviso"></div>
      <div class="campo"><label>Motivo</label><textarea id="cnt-fp-motivo" placeholder="Vacaciones del propietario, uso personal..."></textarea></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="cnt-fp-cancelar">Cancelar</button>
        <button class="btn-pri" id="cnt-fp-guardar">Guardar</button>
      </div>`);

    const ini = document.getElementById('cnt-fp-inicio');
    const fin = document.getElementById('cnt-fp-fin');
    const aviso = document.getElementById('cnt-fp-aviso');
    const fuera = () => {
      const fi = ini.value; const ff = fin.value;
      return fi && ff && (fi < c.temporada_inicio || ff > c.temporada_fin);
    };
    const chk = () => {
      if (fuera()) {
        aviso.textContent = `⚠️ Las fechas deben estar dentro del período del contrato (${rango})`;
        aviso.classList.remove('oculto');
      } else {
        aviso.classList.add('oculto');
      }
    };
    ini.addEventListener('change', chk);
    fin.addEventListener('change', chk);

    document.getElementById('cnt-fp-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('cnt-fp-guardar').addEventListener('click', async () => {
      const fi = ini.value; const ff = fin.value;
      if (!fi || !ff) return toast('Indica fecha inicio y fin', 'error');
      if (!(fi < ff)) return toast('La fecha de inicio debe ser anterior a la de fin', 'error');
      if (fi < c.temporada_inicio || ff > c.temporada_fin) return toast('Las fechas deben estar dentro del período del contrato', 'error');
      try {
        await API.post(`/api/contratos/${c.id}/fechas-propietario`, {
          fecha_inicio: fi, fecha_fin: ff, motivo: document.getElementById('cnt-fp-motivo').value.trim(),
        });
        cerrarModal();
        await abrirFicha(c.id); // recarga la ficha (regenera la sección)
        toast('Fechas añadidas y bloqueo creado en el planning', 'ok');
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  async function borrarFechaProp(contratoId, fpId) {
    if (!confirm('¿Eliminar esta fecha del propietario?')) return;
    try {
      await API.del(`/api/contratos/${contratoId}/fechas-propietario/${fpId}`);
      await abrirFicha(contratoId);
      toast('Fecha eliminada', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ==================== Modal nuevo / editar ====================

  async function cargarApartamentos() {
    if (apartamentos.length) return;
    try { apartamentos = await API.get('/api/apartamentos?todos=1'); }
    catch (e) { apartamentos = []; }
  }

  async function formulario(id) {
    await cargarApartamentos();

    let c = {
      apartamento_id: null, propietario_id: null, tipo: 'precio_cerrado',
      temporada_inicio: '', temporada_fin: '', anio: filtroAnio,
      precio_total: 0, porcentaje_comision: 0, aplica_iva: 1, porcentaje_retencion: 19,
      estado: 'activo', notas: '', cuotas: [],
    };
    if (id) {
      try { c = await API.get('/api/contratos/' + id); }
      catch (e) { return toast(e.message, 'error'); }
    }

    aptoSelId = c.apartamento_id != null ? Number(c.apartamento_id) : null;
    cuotasModal = (c.cuotas || []).map((q) => ({
      fecha_prevista: q.fecha_prevista || '', importe: Number(q.importe) || 0,
      pagado: q.pagado ? 1 : 0, fecha_pago: q.fecha_pago || null,
    }));
    fechasModal = []; // las fechas del propietario añadidas aquí se POSTean tras guardar

    const estados = ['activo', 'finalizado', 'cancelado'];
    const estadoOpts = estados.map((e) => `<option value="${e}"${c.estado === e ? ' selected' : ''}>${estadoTexto(e)}</option>`).join('');

    abrirModal(`
      <h3>${id ? 'Editar' : 'Nuevo'} contrato</h3>

      <div class="campo cnt-typeahead">
        <label>Apartamento *</label>
        <input id="cnt-f-apto-buscar" placeholder="Buscar apartamento..." autocomplete="off">
        <div class="cnt-ta-dropdown oculto" id="cnt-f-apto-dropdown"></div>
      </div>
      <div class="campo">
        <label>Propietario</label>
        <input id="cnt-f-propietario" class="campo-readonly" readonly>
      </div>

      <label class="campo-label-suelto">Tipo de contrato *</label>
      <div class="cnt-tipo-opciones" id="cnt-f-tipo">
        <label class="cnt-tipo-op${c.tipo === 'precio_cerrado' ? ' activo' : ''}" data-tipo="precio_cerrado">
          <input type="radio" name="cnt-tipo" value="precio_cerrado"${c.tipo === 'precio_cerrado' ? ' checked' : ''}>
          <span class="cnt-tipo-op-icono">💰</span>Precio cerrado
        </label>
        <label class="cnt-tipo-op${c.tipo === 'comision' ? ' activo' : ''}" data-tipo="comision">
          <input type="radio" name="cnt-tipo" value="comision"${c.tipo === 'comision' ? ' checked' : ''}>
          <span class="cnt-tipo-op-icono">📊</span>Comisión
        </label>
      </div>

      <div class="cnt-rango">
        <div class="campo"><label>Temporada inicio *</label><input type="date" id="cnt-f-inicio" value="${c.temporada_inicio || ''}"></div>
        <span class="cnt-rango-sep">→</span>
        <div class="campo"><label>Temporada fin *</label><input type="date" id="cnt-f-fin" value="${c.temporada_fin || ''}"></div>
      </div>
      <div class="cnt-rango-info" id="cnt-f-rango-info"></div>

      <div class="fila-campos">
        <div class="campo"><label>Año *</label><input type="number" id="cnt-f-anio" value="${c.anio || filtroAnio}"></div>
        <div class="campo" id="cnt-f-campo-precio"><label>Precio total (€)</label><input type="number" step="0.01" id="cnt-f-precio" value="${c.precio_total ?? 0}"></div>
        <div class="campo" id="cnt-f-campo-porc"><label>Porcentaje (%)</label><input type="number" step="0.01" id="cnt-f-porc" value="${c.porcentaje_comision ?? 0}"></div>
      </div>

      <div id="cnt-f-fiscalidad">
        <div class="cnt-fisc-titulo">Fiscalidad</div>
        <label class="cnt-check"><input type="checkbox" id="cnt-f-iva"${c.aplica_iva ? ' checked' : ''}> Aplicar IVA (21%)</label>
        <div class="cnt-fisc-ret">
          <span class="campo-label-suelto">Retención IRPF:</span>
          <label class="cnt-radio"><input type="radio" name="cnt-ret" value="0"${Number(c.porcentaje_retencion) === 0 ? ' checked' : ''}> Sin retención</label>
          <label class="cnt-radio"><input type="radio" name="cnt-ret" value="19"${Number(c.porcentaje_retencion) === 19 ? ' checked' : ''}> 19% — Residentes</label>
          <label class="cnt-radio"><input type="radio" name="cnt-ret" value="24"${Number(c.porcentaje_retencion) === 24 ? ' checked' : ''}> 24% — No residentes</label>
        </div>
        <div id="cnt-f-fisc-resumen"></div>
      </div>

      <div class="campo"><label>Estado</label><select id="cnt-f-estado">${estadoOpts}</select></div>
      <div class="campo"><label>Notas</label><textarea id="cnt-f-notas">${esc(c.notas)}</textarea></div>

      <div id="cnt-f-plan">
        <div class="cnt-plan-head">
          <span class="cnt-plan-titulo">Plan de pagos</span>
          <div>
            <button type="button" class="btn-sec" id="cnt-f-distribuir">Distribuir automáticamente</button>
            <button type="button" class="btn-sec" id="cnt-f-add-cuota">＋ Añadir cuota</button>
          </div>
        </div>
        <div id="cnt-f-cuotas"></div>
        <div class="cnt-total-cuotas" id="cnt-f-total"></div>
      </div>

      <div id="cnt-f-fechasprop">
        <div class="cnt-plan-head">
          <span class="cnt-plan-titulo">Fechas del propietario</span>
          <button type="button" class="btn-sec" id="cnt-f-add-fp">＋ Añadir fechas</button>
        </div>
        <div id="cnt-f-fp-lista"></div>
      </div>

      <div class="cnt-error-inline oculto" id="cnt-f-error"></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="cnt-f-cancelar">Cancelar</button>
        <button class="btn-pri" id="cnt-f-guardar">Guardar</button>
      </div>`);
    document.querySelector('.modal').classList.add('modal-ancho');

    // --- Apartamento (autocompletado typeahead) + autorelleno de propietario ---
    initTypeahead();

    // --- Fiscalidad (resumen en tiempo real) ---
    document.getElementById('cnt-f-iva').addEventListener('change', calcFiscalidad);
    document.querySelectorAll('#cnt-f-fiscalidad input[name="cnt-ret"]').forEach((r) =>
      r.addEventListener('change', calcFiscalidad));
    document.getElementById('cnt-f-precio').addEventListener('input', () => {
      actualizarTotalCuotas();
      calcFiscalidad();
    });

    // --- Tipo (radios grandes) ---
    document.querySelectorAll('#cnt-f-tipo .cnt-tipo-op').forEach((op) =>
      op.addEventListener('click', () => {
        document.querySelectorAll('#cnt-f-tipo .cnt-tipo-op').forEach((o) => o.classList.remove('activo'));
        op.classList.add('activo');
        op.querySelector('input').checked = true;
        aplicarTipo();
      }));

    // --- Temporada / año ---
    document.getElementById('cnt-f-inicio').addEventListener('change', () => {
      const ini = document.getElementById('cnt-f-inicio').value;
      if (ini) document.getElementById('cnt-f-anio').value = ini.slice(0, 4);
      actualizarRangoInfo();
    });
    document.getElementById('cnt-f-fin').addEventListener('change', actualizarRangoInfo);

    // --- Plan de pagos ---
    document.getElementById('cnt-f-add-cuota').addEventListener('click', () => {
      cuotasModal.push({ fecha_prevista: '', importe: 0, pagado: 0, fecha_pago: null });
      renderCuotasModal();
    });
    document.getElementById('cnt-f-distribuir').addEventListener('click', distribuirAuto);

    // --- Fechas del propietario ---
    document.getElementById('cnt-f-add-fp').addEventListener('click', () => {
      leerFechasDelDOM();
      fechasModal.push({ fecha_inicio: '', fecha_fin: '', motivo: '' });
      renderFechasModal();
    });

    document.getElementById('cnt-f-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('cnt-f-guardar').addEventListener('click', () => guardar(id));

    aplicarTipo();
    actualizarRangoInfo();
    renderCuotasModal();
    renderFechasModal();
  }

  // Lee los inputs de fechas del propietario del DOM al array (no perder ediciones).
  function leerFechasDelDOM() {
    document.querySelectorAll('#cnt-f-fp-lista .cnt-fp-fila').forEach((fila, i) => {
      if (!fechasModal[i]) return;
      fechasModal[i].fecha_inicio = fila.querySelector('.cnt-fp-f-inicio').value;
      fechasModal[i].fecha_fin = fila.querySelector('.cnt-fp-f-fin').value;
      fechasModal[i].motivo = fila.querySelector('.cnt-fp-f-motivo').value;
    });
  }

  function renderFechasModal() {
    const cont = document.getElementById('cnt-f-fp-lista');
    if (!cont) return;
    if (!fechasModal.length) {
      cont.innerHTML = '<div class="cnt-fp-modal-vacio">Sin fechas reservadas por el propietario (se pueden añadir después).</div>';
      return;
    }
    cont.innerHTML = fechasModal.map((f, i) => `
      <div class="cnt-fp-fila" data-idx="${i}">
        <input type="date" class="cnt-fp-f-inicio" value="${f.fecha_inicio || ''}">
        <span class="cnt-fp-fila-sep">→</span>
        <input type="date" class="cnt-fp-f-fin" value="${f.fecha_fin || ''}">
        <input type="text" class="cnt-fp-f-motivo" placeholder="Motivo (opcional)" value="${esc(f.motivo || '')}">
        <button type="button" class="cnt-cuota-borrar" data-borrar-fp="${i}" title="Eliminar">×</button>
      </div>`).join('');

    cont.querySelectorAll('.cnt-fp-f-inicio, .cnt-fp-f-fin, .cnt-fp-f-motivo').forEach((inp) =>
      inp.addEventListener('change', leerFechasDelDOM));
    cont.querySelectorAll('[data-borrar-fp]').forEach((b) =>
      b.addEventListener('click', () => {
        leerFechasDelDOM();
        fechasModal.splice(Number(b.dataset.borrarFp), 1);
        renderFechasModal();
      }));
  }

  // ---- Autocompletado (typeahead) del apartamento ----
  function initTypeahead() {
    const input = document.getElementById('cnt-f-apto-buscar');
    const aptoSel = apartamentos.find((a) => a.id === aptoSelId);
    input.value = aptoSel ? aptoSel.nombre : ''; // al editar, muestra el ya seleccionado
    autofillPropietario();

    input.addEventListener('input', () => {
      aptoSelId = null;       // cambiar el texto invalida la selección previa
      autofillPropietario();  // y limpia el propietario
      const q = input.value.trim();
      if (q.length < 2) { cerrarDropdown(); return; }
      taMatches = buscarApartamentos(q);
      taIndex = -1;
      renderDropdown();
    });

    input.addEventListener('keydown', (e) => {
      const dd = document.getElementById('cnt-f-apto-dropdown');
      const abierto = dd && !dd.classList.contains('oculto');
      if (e.key === 'ArrowDown') {
        if (!abierto) return;
        e.preventDefault();
        taIndex = Math.min(taIndex + 1, taMatches.length - 1);
        renderDropdown(); scrollActivo();
      } else if (e.key === 'ArrowUp') {
        if (!abierto) return;
        e.preventDefault();
        taIndex = Math.max(taIndex - 1, 0);
        renderDropdown(); scrollActivo();
      } else if (e.key === 'Enter') {
        if (abierto && taIndex >= 0 && taMatches[taIndex]) {
          e.preventDefault();
          seleccionarApto(taMatches[taIndex].id);
        }
      } else if (e.key === 'Escape') {
        if (abierto) { e.preventDefault(); e.stopPropagation(); cerrarDropdown(); }
      }
    });

    // Cierra el dropdown al perder el foco (tras dar margen al click de una opción).
    input.addEventListener('blur', () => setTimeout(cerrarDropdown, 120));
  }

  function buscarApartamentos(q) {
    const s = q.toLowerCase();
    return apartamentos.filter((a) =>
      (a.nombre || '').toLowerCase().includes(s) ||
      (a.edificio || '').toLowerCase().includes(s)
    );
  }

  function renderDropdown() {
    const dd = document.getElementById('cnt-f-apto-dropdown');
    if (!dd) return;
    if (!taMatches.length) {
      dd.innerHTML = '<div class="cnt-ta-vacio">Sin resultados</div>';
      dd.classList.remove('oculto');
      return;
    }
    dd.innerHTML = taMatches.map((a, i) => {
      const t = String(a.tipo) === '2' ? '2' : '1';
      return `<div class="cnt-ta-op${i === taIndex ? ' activo' : ''}" data-id="${a.id}">
        <span class="cnt-ta-nombre">${esc(a.nombre)}${a.edificio ? ` <span class="cnt-ta-edif">${esc(a.edificio)}</span>` : ''}</span>
        <span class="badge-tih-mini tih-${t}">${tihTexto(t)}</span>
      </div>`;
    }).join('');
    dd.classList.remove('oculto');
    // mousedown (no click) para que se dispare antes del blur del input.
    dd.querySelectorAll('.cnt-ta-op').forEach((op) =>
      op.addEventListener('mousedown', (e) => { e.preventDefault(); seleccionarApto(Number(op.dataset.id)); }));
  }

  function scrollActivo() {
    const dd = document.getElementById('cnt-f-apto-dropdown');
    const act = dd && dd.querySelector('.cnt-ta-op.activo');
    if (act) act.scrollIntoView({ block: 'nearest' });
  }

  function seleccionarApto(id) {
    aptoSelId = id;
    const a = apartamentos.find((x) => x.id === id);
    document.getElementById('cnt-f-apto-buscar').value = a ? a.nombre : '';
    cerrarDropdown();
    autofillPropietario();
  }

  function cerrarDropdown() {
    const dd = document.getElementById('cnt-f-apto-dropdown');
    if (dd) dd.classList.add('oculto');
    taIndex = -1;
  }

  function calcFiscalidad() {
    const el = document.getElementById('cnt-f-fisc-resumen');
    if (!el) return;
    const base = parseFloat(document.getElementById('cnt-f-precio').value) || 0;
    const iva = document.getElementById('cnt-f-iva').checked;
    const retEl = document.querySelector('#cnt-f-fiscalidad input[name="cnt-ret"]:checked');
    const ret = retEl ? Number(retEl.value) : 0;
    el.innerHTML = resumenFiscalHTML(base, iva, ret);
  }

  function autofillPropietario() {
    const a = apartamentos.find((x) => x.id === aptoSelId);
    const nom = a && a.propietario_id
      ? `${a.propietario_nombre || ''} ${a.propietario_apellidos || ''}`.trim()
      : '';
    const inp = document.getElementById('cnt-f-propietario');
    if (inp) inp.value = nom || '—';
  }

  function tipoSeleccionado() {
    const r = document.querySelector('#cnt-f-tipo input[name="cnt-tipo"]:checked');
    return r ? r.value : 'precio_cerrado';
  }

  // Muestra precio/plan (cerrado) o porcentaje (comisión).
  function aplicarTipo() {
    const esCerrado = tipoSeleccionado() === 'precio_cerrado';
    document.getElementById('cnt-f-campo-precio').classList.toggle('oculto', !esCerrado);
    document.getElementById('cnt-f-campo-porc').classList.toggle('oculto', esCerrado);
    document.getElementById('cnt-f-plan').classList.toggle('oculto', !esCerrado);
    document.getElementById('cnt-f-fiscalidad').classList.toggle('oculto', !esCerrado);
    if (esCerrado) { actualizarTotalCuotas(); calcFiscalidad(); }
  }

  function actualizarRangoInfo() {
    const ini = document.getElementById('cnt-f-inicio').value;
    const fin = document.getElementById('cnt-f-fin').value;
    const el = document.getElementById('cnt-f-rango-info');
    if (!el) return;
    if (ini && fin && ini < fin) {
      const dias = Math.round((new Date(fin + 'T00:00:00') - new Date(ini + 'T00:00:00')) / 86400000);
      el.textContent = `Temporada de ${dias} día${dias === 1 ? '' : 's'}.`;
    } else if (ini && fin) {
      el.textContent = 'La fecha de inicio debe ser anterior a la de fin.';
    } else {
      el.textContent = '';
    }
  }

  // Lee los inputs de cuotas del DOM al array (para no perder ediciones al re-renderizar).
  function leerCuotasDelDOM() {
    document.querySelectorAll('#cnt-f-cuotas .cnt-cuota-fila').forEach((fila, i) => {
      if (!cuotasModal[i]) return;
      cuotasModal[i].fecha_prevista = fila.querySelector('.cnt-cuota-fecha').value;
      cuotasModal[i].importe = parseFloat(fila.querySelector('.cnt-cuota-importe').value) || 0;
    });
  }

  function renderCuotasModal() {
    const cont = document.getElementById('cnt-f-cuotas');
    if (!cont) return;
    cont.innerHTML = cuotasModal.map((q, i) => `
      <div class="cnt-cuota-fila" data-idx="${i}">
        <span class="cnt-cuota-num">${i + 1}</span>
        <input type="date" class="cnt-cuota-fecha" value="${q.fecha_prevista || ''}">
        <input type="number" step="0.01" class="cnt-cuota-importe" placeholder="Importe €" value="${q.importe != null ? q.importe : ''}">
        <button type="button" class="cnt-cuota-borrar" data-borrar-cuota="${i}" title="Eliminar cuota">×</button>
      </div>`).join('');

    cont.querySelectorAll('.cnt-cuota-importe').forEach((inp) =>
      inp.addEventListener('input', () => { leerCuotasDelDOM(); actualizarTotalCuotas(); }));
    cont.querySelectorAll('.cnt-cuota-fecha').forEach((inp) =>
      inp.addEventListener('change', leerCuotasDelDOM));
    cont.querySelectorAll('[data-borrar-cuota]').forEach((b) =>
      b.addEventListener('click', () => {
        leerCuotasDelDOM();
        cuotasModal.splice(Number(b.dataset.borrarCuota), 1);
        renderCuotasModal();
      }));
    actualizarTotalCuotas();
  }

  function actualizarTotalCuotas() {
    const el = document.getElementById('cnt-f-total');
    if (!el) return;
    const suma = cuotasModal.reduce((s, q) => s + (Number(q.importe) || 0), 0);
    const precio = parseFloat(document.getElementById('cnt-f-precio').value) || 0;
    const cuadra = Math.abs(suma - precio) < 0.01;
    el.className = 'cnt-total-cuotas ' + (cuadra ? 'ok' : 'mal');
    el.textContent = `Total cuotas: ${euro(suma)} / ${euro(precio)} del contrato` + (cuadra ? '  ✓' : '');
  }

  // Divide el precio total en N cuotas iguales con fechas mensuales desde el inicio.
  function distribuirAuto() {
    const precio = parseFloat(document.getElementById('cnt-f-precio').value) || 0;
    const ini = document.getElementById('cnt-f-inicio').value;
    if (!precio) return toast('Introduce primero el precio total', 'error');
    if (!ini) return toast('Introduce primero la fecha de inicio de temporada', 'error');

    leerCuotasDelDOM();
    const n = cuotasModal.length > 0 ? cuotasModal.length : 3;
    const baseCent = Math.floor((precio * 100) / n);          // céntimos por cuota
    const restoCent = Math.round(precio * 100) - baseCent * n; // el resto va a la última

    cuotasModal = [];
    const [y, m, d] = ini.split('-').map(Number);
    for (let i = 0; i < n; i++) {
      const fecha = new Date(y, (m - 1) + i, d);
      const iso = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
      const cent = baseCent + (i === n - 1 ? restoCent : 0);
      cuotasModal.push({ fecha_prevista: iso, importe: cent / 100, pagado: 0, fecha_pago: null });
    }
    renderCuotasModal();
  }

  function mostrarError(msg) {
    const el = document.getElementById('cnt-f-error');
    el.textContent = msg;
    el.classList.remove('oculto');
  }

  async function guardar(id) {
    const tipo = tipoSeleccionado();
    const apartamento_id = aptoSelId;
    const inicio = document.getElementById('cnt-f-inicio').value;
    const fin = document.getElementById('cnt-f-fin').value;
    const anio = parseInt(document.getElementById('cnt-f-anio').value, 10);
    const precio = parseFloat(document.getElementById('cnt-f-precio').value) || 0;
    const porc = parseFloat(document.getElementById('cnt-f-porc').value) || 0;
    const aplicaIva = document.getElementById('cnt-f-iva').checked ? 1 : 0;
    const retEl = document.querySelector('#cnt-f-fiscalidad input[name="cnt-ret"]:checked');
    const porcentajeRetencion = retEl ? Number(retEl.value) : 19;

    document.getElementById('cnt-f-error').classList.add('oculto');

    if (!apartamento_id) return mostrarError('Selecciona un apartamento.');
    if (!inicio || !fin) return mostrarError('Indica las fechas de temporada.');
    if (!(inicio < fin)) return mostrarError('La fecha de inicio debe ser anterior a la de fin.');
    if (!anio) return mostrarError('Indica el año del contrato.');

    leerCuotasDelDOM();
    const cuotas = tipo === 'precio_cerrado'
      ? cuotasModal.map((q, i) => ({
          numero_cuota: i + 1, fecha_prevista: q.fecha_prevista, importe: Number(q.importe) || 0,
          pagado: q.pagado ? 1 : 0, fecha_pago: q.fecha_pago || null,
        }))
      : [];

    if (tipo === 'precio_cerrado') {
      for (const q of cuotas) {
        if (!q.fecha_prevista) return mostrarError('Cada cuota necesita una fecha prevista.');
      }
      const suma = cuotas.reduce((s, q) => s + q.importe, 0);
      if (Math.abs(suma - precio) > 0.01) {
        return mostrarError(`La suma de las cuotas (${euro(suma)}) no coincide con el precio total (${euro(precio)}).`);
      }
    }

    const a = apartamentos.find((x) => x.id === apartamento_id);
    const body = {
      apartamento_id,
      propietario_id: a ? a.propietario_id : null,
      tipo,
      temporada_inicio: inicio,
      temporada_fin: fin,
      anio,
      precio_total: tipo === 'precio_cerrado' ? precio : 0,
      porcentaje_comision: tipo === 'comision' ? porc : 0,
      aplica_iva: aplicaIva,
      porcentaje_retencion: porcentajeRetencion,
      estado: document.getElementById('cnt-f-estado').value,
      notas: document.getElementById('cnt-f-notas').value || '',
      cuotas,
    };

    try {
      let contratoId = id;
      if (id) await API.put('/api/contratos/' + id, body);
      else { const res = await API.post('/api/contratos', body); contratoId = res && res.id; }

      // Fechas del propietario añadidas en el modal: se POSTean tras el contrato.
      leerFechasDelDOM();
      const fechasValidas = fechasModal.filter((f) => f.fecha_inicio && f.fecha_fin);
      if (contratoId && fechasValidas.length) {
        for (const f of fechasValidas) {
          try {
            await API.post(`/api/contratos/${contratoId}/fechas-propietario`, {
              fecha_inicio: f.fecha_inicio, fecha_fin: f.fecha_fin, motivo: f.motivo || '',
            });
          } catch (e) { /* fecha fuera de rango u otro error: se omite */ }
        }
      }

      cerrarModal();
      await cargar();
      if (fichaActual && id && Number(id) === fichaActual.id) await abrirFicha(id);
      toast(id ? 'Contrato actualizado' : 'Contrato creado', 'ok');
    } catch (e) {
      mostrarError(e.message);
    }
  }

  // ---- Descargar contrato (PDF o Word) con auth token (patrón de facturas/entradas) ----
  async function descargarContrato(id, formato) {
    const fmt = formato === 'docx' ? 'docx' : 'pdf';
    const sesion = Auth.sesion();
    const response = await fetch(`/api/contratos/${id}/${fmt}`, {
      headers: { 'X-Auth-Token': sesion.token }
    });
    if (!response.ok) { toast('Error al generar el documento', 'error'); return; }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `contrato-${id}.${fmt}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ---- Borrar ----
  async function borrar(id) {
    const c = todos.find((x) => x.id == id);
    if (!confirm(`¿Eliminar el contrato de "${c?.apartamento_nombre || id}"? Esta acción no se puede deshacer.`)) return;
    try {
      await API.del('/api/contratos/' + id);
      await cargar();
      toast('Contrato eliminado', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ---- Selector de año ----
  function poblarAnios() {
    const sel = document.getElementById('cnt-filtro-anio');
    if (!sel) return;
    if (!ANIOS.includes(filtroAnio)) filtroAnio = ANIOS[ANIOS.length - 1];
    sel.innerHTML = ANIOS.map((a) => `<option value="${a}"${a === filtroAnio ? ' selected' : ''}>${a}</option>`).join('');
  }

  // ---- Filtro de propietario (select inyectado por JS; index.html no se toca) ----
  function inyectarFiltroPropietario() {
    const cont = document.querySelector('#vista-contratos .cnt-controles');
    if (!cont || document.getElementById('cnt-filtro-propietario')) return;
    const sel = document.createElement('select');
    sel.id = 'cnt-filtro-propietario';
    sel.className = 'select-filtro';
    sel.innerHTML = '<option value="">Todos los propietarios</option>';
    cont.appendChild(sel);
  }

  // Opciones = propietarios únicos de los contratos cargados (sin llamada extra). Si hay un
  // propietario filtrado sin contratos este año, se añade igualmente para mostrarlo seleccionado.
  function poblarPropietarios() {
    const sel = document.getElementById('cnt-filtro-propietario');
    if (!sel) return;
    const mapa = new Map();
    for (const c of todos) {
      if (c.propietario_id != null) mapa.set(String(c.propietario_id), nombrePropietario(c));
    }
    if (filtroPropId && !mapa.has(filtroPropId)) {
      mapa.set(filtroPropId, filtroPropNombre || ('Propietario #' + filtroPropId));
    }
    const ops = Array.from(mapa.entries()).sort((a, b) => a[1].localeCompare(b[1], 'es'));
    sel.innerHTML = '<option value="">Todos los propietarios</option>' +
      ops.map(([id, nom]) => `<option value="${id}"${id === filtroPropId ? ' selected' : ''}>${esc(nom)}</option>`).join('');
  }

  // Método público: navegar/filtrar Contratos por un propietario (lo usa Estadísticas).
  function filtrarPorPropietario(propId, nombre) {
    filtroPropId = (propId === null || propId === undefined) ? '' : String(propId);
    filtroPropNombre = nombre || '';
    const vista = document.getElementById('vista-contratos');
    const activa = vista && vista.classList.contains('activa');
    if (!activa) {
      // activarTab dispara cargar(): como filtroPropId ya está fijado, renderiza filtrado.
      if (typeof activarTab === 'function') activarTab('contratos');
      return;
    }
    // Vista ya activa: reflejar el filtro de inmediato (o cargar si aún no hay datos).
    if (todos.length) { poblarPropietarios(); renderTabla(filtrar()); }
    else cargar().catch((e) => toast(e.message, 'error'));
  }

  // ---- Init ----
  function init() {
    crearPanel();
    poblarAnios();
    inyectarFiltroPropietario();
    document.getElementById('btn-nuevo-contrato').addEventListener('click', () => formulario(null));
    document.getElementById('cnt-filtro-anio').addEventListener('change', (e) => {
      filtroAnio = Number(e.target.value);
      filtroPropId = ''; filtroPropNombre = ''; // el año cambia el conjunto de propietarios
      cargar().catch((err) => toast(err.message, 'error'));
    });
    document.getElementById('cnt-filtro-tipo').addEventListener('change', (e) => {
      filtroTipo = e.target.value;
      renderTabla(filtrar());
    });
    document.getElementById('cnt-filtro-propietario').addEventListener('change', (e) => {
      filtroPropId = e.target.value;
      filtroPropNombre = e.target.selectedOptions[0] ? e.target.selectedOptions[0].textContent : '';
      renderTabla(filtrar());
    });
  }

  return { init, cargar, abrirFicha, filtrarPorPropietario };
})();
