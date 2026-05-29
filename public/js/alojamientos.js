// Módulo Alojamientos: tabla, alta/edición/borrado y ficha completa.

const Alojamientos = (() => {
  async function cargar() {
    const lista = await API.get('/api/apartamentos');
    const tbody = document.querySelector('#tabla-alojamientos tbody');
    tbody.innerHTML = '';
    if (lista.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="color:#6b7280">No hay alojamientos todavía.</td></tr>';
      return;
    }
    for (const a of lista) {
      const propietario = [a.propietario_nombre, a.propietario_apellidos].filter(Boolean).join(' ');
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="enlace-fila" data-ficha="${a.id}">${esc(a.nombre)}</span></td>
        <td>${esc(a.edificio)}</td>
        <td>${tihTexto(a.tipo)}</td>
        <td>${a.capacidad ?? '—'}</td>
        <td>${esc(propietario) || '—'}</td>
        <td>${esc(a.notas)}</td>
        <td class="acciones">
          <button class="btn-mini" data-editar="${a.id}">Editar</button>
          <button class="btn-mini" data-borrar="${a.id}">Eliminar</button>
        </td>`;
      tbody.appendChild(tr);
    }
    tbody.querySelectorAll('[data-ficha]').forEach((el) =>
      el.addEventListener('click', () => abrirFicha(el.dataset.ficha))
    );
    tbody.querySelectorAll('[data-editar]').forEach((el) =>
      el.addEventListener('click', () => formulario(el.dataset.editar))
    );
    tbody.querySelectorAll('[data-borrar]').forEach((el) =>
      el.addEventListener('click', () => borrar(el.dataset.borrar))
    );
  }

  async function abrirFicha(id) {
    let a;
    try {
      a = await API.get('/api/apartamentos/' + id);
    } catch (e) {
      return toast(e.message, 'error');
    }
    const propietario = [a.propietario_nombre, a.propietario_apellidos].filter(Boolean).join(' ');
    let html = `
      <h3>${esc(a.nombre)}</h3>
      ${dato('Edificio', a.edificio)}
      ${dato('Tipo (TIH)', tihTexto(a.tipo))}
      ${dato('Capacidad máxima', a.capacidad)}
      ${dato('Notas', a.notas)}
      <div class="ficha-seccion">
        <h4>Propietario</h4>
        ${
          propietario
            ? `${dato('Nombre', propietario)}${dato('Teléfono', a.propietario_telefono)}${dato('Email', a.propietario_email)}`
            : '<p style="color:#6b7280">Sin propietario asociado.</p>'
        }
      </div>
      <div class="ficha-seccion">
        <h4>Historial de reservas (${a.reservas.length})</h4>`;
    if (a.reservas.length) {
      html += '<table class="tabla"><thead><tr><th>Reserva</th><th>Cliente</th><th>Entrada</th><th>Salida</th><th>Per.</th></tr></thead><tbody>';
      for (const r of a.reservas) {
        html += `<tr><td>${esc(r.numero_reserva)}</td><td>${esc(r.nombre_cliente)}</td><td>${fechaES(r.entrada)}</td><td>${fechaES(r.salida)}</td><td>${r.personas ?? '—'}</td></tr>`;
      }
      html += '</tbody></table>';
    } else {
      html += '<p style="color:#6b7280">Sin reservas registradas.</p>';
    }
    html += `</div>
      <div class="modal-acciones">
        <button class="btn-sec" data-editar-ficha="${a.id}">Editar</button>
      </div>`;
    abrirModal(html);
    document.querySelector('[data-editar-ficha]').addEventListener('click', () => formulario(a.id));
  }

  async function formulario(id) {
    const propietarios = await API.get('/api/propietarios');
    let a = { nombre: '', edificio: '', tipo: '', capacidad: '', notas: '', propietario_id: '' };
    if (id) a = await API.get('/api/apartamentos/' + id);

    const opciones = ['<option value="">— Sin propietario —</option>']
      .concat(
        propietarios.map(
          (p) =>
            `<option value="${p.id}" ${p.id == a.propietario_id ? 'selected' : ''}>${esc(
              [p.nombre, p.apellidos].filter(Boolean).join(' ')
            )}</option>`
        )
      )
      .join('');

    abrirModal(`
      <h3>${id ? 'Editar' : 'Nuevo'} alojamiento</h3>
      <div class="campo"><label>Nombre *</label><input id="f-nombre" value="${esc(a.nombre)}"></div>
      <div class="fila-campos">
        <div class="campo"><label>Edificio</label><input id="f-edificio" value="${esc(a.edificio)}"></div>
        <div class="campo"><label>Tipo (TIH)</label>
          <select id="f-tipo">
            <option value="">—</option>
            <option value="1" ${a.tipo == '1' ? 'selected' : ''}>1ª Línea</option>
            <option value="2" ${a.tipo == '2' ? 'selected' : ''}>2ª Línea</option>
          </select>
        </div>
        <div class="campo"><label>Capacidad</label><input id="f-capacidad" type="number" min="0" value="${esc(a.capacidad)}"></div>
      </div>
      <div class="campo"><label>Propietario</label><select id="f-propietario">${opciones}</select></div>
      <div class="campo"><label>Notas</label><textarea id="f-notas">${esc(a.notas)}</textarea></div>
      <div class="modal-acciones">
        <button class="btn-sec" id="f-cancelar">Cancelar</button>
        <button class="btn-pri" id="f-guardar">Guardar</button>
      </div>`);

    document.getElementById('f-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('f-guardar').addEventListener('click', async () => {
      const body = {
        nombre: val('f-nombre'),
        edificio: val('f-edificio'),
        tipo: val('f-tipo'),
        capacidad: val('f-capacidad'),
        notas: val('f-notas'),
        propietario_id: val('f-propietario') || null,
      };
      if (!body.nombre.trim()) return toast('El nombre es obligatorio', 'error');
      try {
        if (id) await API.put('/api/apartamentos/' + id, body);
        else await API.post('/api/apartamentos', body);
        cerrarModal();
        await cargar();
        if (typeof Planning !== 'undefined') Planning.cargar();
        toast('Alojamiento guardado', 'ok');
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  async function borrar(id) {
    if (!confirm('¿Eliminar este alojamiento? Sus reservas quedarán "Sin asignar".')) return;
    try {
      await API.del('/api/apartamentos/' + id);
      await cargar();
      if (typeof Planning !== 'undefined') Planning.cargar();
      toast('Alojamiento eliminado', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function dato(etq, v) {
    return `<div class="ficha-dato"><div class="etq">${etq}</div><div class="val">${esc(v) || '—'}</div></div>`;
  }
  function val(id) {
    return document.getElementById(id).value;
  }

  function init() {
    document.getElementById('btn-nuevo-alojamiento').addEventListener('click', () => formulario(null));
  }

  return { init, cargar, abrirFicha, formulario };
})();
