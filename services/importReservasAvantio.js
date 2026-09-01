// Servicio de importación de reservas desde el export de Avantio (Listado de reservas).
//
// El archivo es un XLS real (Composite Document). SheetJS lo lee con raw:true.
// Estructura: fila 0 -> título ("Listado de reservas"), fila 1 -> cabeceras (69 cols),
// fila 2+ -> datos. Detectamos la fila de cabeceras y mapeamos por nombre normalizado.
//
// Upsert por `numero_reserva` (columna "Localizador"):
//   - existe  -> UPDATE de los campos del Excel SIN pisar: apartamento_id (si ya tiene uno
//                asignado manualmente), notas_internas, y observaciones (se hace append de
//                los fragmentos nuevos que no estuvieran ya).
//   - no existe -> INSERT.
// Nunca borra. Diferente del importador del Excel simplificado (services/importService.js).
const xlsx = require('xlsx');
const db = require('../db/database');
const { parseFecha } = require('./dateUtils');

// Cabecera del Excel normalizada -> campo interno. La normalización quita acentos,
// espacios y signos, así "Cliente: Nombre" -> "clientenombre", "Total reserva con tasas"
// -> "totalreservacontasas", etc.
const MAPA = {
  localizador: 'numero_reserva',
  fechaalta: 'fecha_creacion',
  estado: 'estado',
  fechaentrada: 'entrada',
  horaentrada: 'hora_entrada',
  fechasalida: 'salida',
  horasalida: 'hora_salida',
  nombrealojamiento: 'alojamiento',
  alojamiento: 'alojamiento',
  adultos: 'adultos',
  ninos: 'ninos',
  bebes: 'bebes',
  totalreservacontasas: 'precio_total',
  pagado: 'pagado',
  pendiente: 'pendiente',
  portal: 'portal',
  condiciondecancelacion: 'condicion_cancelacion',
  condicioncancelacion: 'condicion_cancelacion',
  atendidopor: 'atendido_por',
  miscomentarios: 'observaciones',
  comentarioscheckin: 'coment_checkin',
  comentarioscheckout: 'coment_checkout',
  clienteidcliente: 'cliente_id_avantio',
  idcliente: 'cliente_id_avantio',
  clientenombre: 'cliente_nombre',
  clienteapellidos: 'cliente_apellidos',
  clientefechanacimiento: 'cliente_fecha_nacimiento',
  clientepais: 'cliente_pais',
  clientetelefono: 'cliente_telefono',
  clientetelefonoalternativo1: 'cliente_telefono2',
  clienteemail: 'cliente_email',
  clientenumerodocumento: 'cliente_dni',
  ocupantenombre: 'ocupante_nombre',
  ocupanteapellidos: 'ocupante_apellidos',
  edificio: 'edificio',
};

function normalizaClave(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita acentos
    .replace(/[^a-z0-9]/g, '');       // quita espacios, signos, etc.
}

// Limpia un valor de celda: trim, descarta vacíos y guiones sueltos ("-").
function limpia(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === '' || s === '-' || s === '—') return null;
  return s;
}

// Teléfonos/números que SheetJS entrega como float: los volvemos a texto sin decimales.
function limpiaTexto(v) {
  if (typeof v === 'number' && isFinite(v)) {
    return Number.isInteger(v) ? String(v) : String(v);
  }
  return limpia(v);
}

// Parsea importes en formato europeo ("1.234,56") o numérico nativo. Devuelve número (0 si no).
function aMoneda(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? Math.round(v * 100) / 100 : 0;
  let s = String(v).trim().replace(/[€\s]/g, '');
  if (s === '' || s === '-') return 0;
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : Math.round(n * 100) / 100;
}

function aEntero(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = parseInt(String(v).replace(/[^\d-]/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

// Mapea el "Estado" de Avantio al tipo_reserva del CRM.
function mapearEstado(estado) {
  const e = limpia(estado);
  if (!e) return 'Confirmada';
  const n = normalizaClave(e);
  if (n === 'nodisponible') return 'Bloqueado';
  if (n === 'cancelada') return 'Cancelada';
  if (n === 'confirmada') return 'Confirmada';
  return e; // resto tal cual
}

function mapearCabeceras(headers) {
  return (headers || []).map((h) => MAPA[normalizaClave(h)] || null);
}

// Localiza la fila de cabeceras (la primera que mapea 'numero_reserva' o >=4 columnas conocidas).
function detectarFilaCabeceras(rows) {
  const limite = Math.min(rows.length, 10);
  for (let i = 0; i < limite; i++) {
    const campos = mapearCabeceras(rows[i]).filter(Boolean);
    if (campos.includes('numero_reserva') || campos.length >= 4) return i;
  }
  return rows.length > 1 ? 1 : 0;
}

function mapearFila(fila, colCampo) {
  const datos = {};
  for (let c = 0; c < colCampo.length; c++) {
    const campo = colCampo[c];
    if (!campo) continue;
    if (datos[campo] == null) datos[campo] = fila[c]; // primer valor no nulo gana
  }
  return datos;
}

// Compone el nombre completo (nombre + apellidos), null si ambos vacíos.
function nombreCompleto(nombre, apellidos) {
  const partes = [limpia(nombre), limpia(apellidos)].filter(Boolean);
  return partes.length ? partes.join(' ') : null;
}

// Construye/actualiza el texto de observaciones añadiendo los fragmentos (comentarios,
// "TELF:", email) que no estén ya presentes en `base`.
function componerObservaciones(base, fragmentos) {
  let texto = limpia(base) || '';
  for (const f of fragmentos) {
    const frag = limpia(f);
    if (!frag) continue;
    if (texto.includes(frag)) continue;
    texto = texto ? `${texto}\n${frag}` : frag;
  }
  return texto || null;
}

function importarReservasAvantio(buffer) {
  const wb = xlsx.read(buffer, { type: 'buffer', raw: true });
  const hoja = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(hoja, { header: 1, raw: true, blankrows: false });

  const resumen = { nuevas: 0, actualizadas: 0, errores: [], clientes_vinculados: 0, clientes_creados: 0, apartamentos_vinculados: 0 };
  if (rows.length === 0) return resumen;

  const filaCabeceras = detectarFilaCabeceras(rows);
  const colCampo = mapearCabeceras(rows[filaCabeceras]);
  const dataRows = rows.slice(filaCabeceras + 1);

  // Índices en memoria para resolver alojamiento y cliente.
  const apartamentos = db.prepare('SELECT id, nombre, tipo FROM apartamentos').all();
  const aptoPorNombre = new Map();
  for (const a of apartamentos) aptoPorNombre.set(normalizaClave(a.nombre), a);

  const buscarCliente = db.prepare(
    "SELECT id FROM clientes WHERE id_avantio IS NOT NULL AND id_avantio <> '' AND id_avantio = ?"
  );
  const insertarCliente = db.prepare(`
    INSERT INTO clientes (id_avantio, nombre, apellido1, fecha_nacimiento, pais, telefono, telefono2, email, dni)
    VALUES (@id_avantio, @nombre, @apellido1, @fecha_nacimiento, @pais, @telefono, @telefono2, @email, @dni)
  `);
  const buscarReserva = db.prepare('SELECT * FROM reservas WHERE numero_reserva = ?');
  const contarPagosReserva = db.prepare('SELECT COUNT(*) AS c FROM reserva_pagos WHERE reserva_id = ?');
  const insertarPagoReserva = db.prepare(`
    INSERT INTO reserva_pagos (reserva_id, concepto, importe, pagado, fecha_pago, orden)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  // Si la reserva (nueva o ya existente) no tiene ningún pago registrado todavía, refleja el
  // estado real de cobro que trae Avantio (columnas "Pagado"/"Pendiente") como 1 o 2 líneas en
  // reserva_pagos. No se toca si ya tiene pagos (gestión manual previa, no se pisa).
  function sincronizarPagosAvantio(reservaId, pagado, pendiente, fechaAlta) {
    if (pagado <= 0 && pendiente <= 0) return;
    if (contarPagosReserva.get(reservaId).c > 0) return;
    let orden = 1;
    if (pagado > 0) insertarPagoReserva.run(reservaId, 'Pagado (Avantio)', pagado, 1, fechaAlta, orden++);
    if (pendiente > 0) insertarPagoReserva.run(reservaId, 'Pendiente (Avantio)', pendiente, 0, null, orden++);
  }

  const insertar = db.prepare(`
    INSERT INTO reservas
      (numero_reserva, nombre_cliente, edificio, tih, personas, entrada, salida,
       observaciones, apartamento_id, tipo_reserva, fecha_creacion, portal,
       condicion_cancelacion, atendido_por, hora_entrada, hora_salida,
       precio_total, pagado, pendiente, notas_internas, ocupante, cliente_id)
    VALUES
      (@numero_reserva, @nombre_cliente, @edificio, @tih, @personas, @entrada, @salida,
       @observaciones, @apartamento_id, @tipo_reserva, @fecha_creacion, @portal,
       @condicion_cancelacion, @atendido_por, @hora_entrada, @hora_salida,
       @precio_total, @pagado, @pendiente, @notas_internas, @ocupante, @cliente_id)
  `);

  const tx = db.transaction(() => {
    dataRows.forEach((fila, i) => {
      const numFila = filaCabeceras + 2 + i; // nº real de fila (1-based)
      const d = mapearFila(fila, colCampo);

      const numero_reserva = limpiaTexto(d.numero_reserva);
      if (!numero_reserva) {
        // Fila probablemente vacía o de totales: solo la reportamos si tiene algún dato.
        if (Object.values(d).some((v) => limpia(v) != null)) {
          resumen.errores.push({ fila: numFila, numero_reserva: '', motivo: 'Falta el Localizador' });
        }
        return;
      }

      const entrada = parseFecha(d.entrada);
      const salida = parseFecha(d.salida);
      if (!entrada) { resumen.errores.push({ fila: numFila, numero_reserva, motivo: 'Fecha de entrada inválida' }); return; }
      if (!salida)  { resumen.errores.push({ fila: numFila, numero_reserva, motivo: 'Fecha de salida inválida' }); return; }
      if (entrada >= salida) { resumen.errores.push({ fila: numFila, numero_reserva, motivo: 'La entrada debe ser anterior a la salida' }); return; }

      // Alojamiento por nombre normalizado.
      const apto = aptoPorNombre.get(normalizaClave(limpia(d.alojamiento) || ''));
      const apartamentoId = apto ? apto.id : null;
      const tih = apto && apto.tipo ? String(apto.tipo) : null;

      const telefono = limpiaTexto(d.cliente_telefono);
      const email = limpia(d.cliente_email);

      // Cliente por id_avantio: si no existe en el CRM (típico si nunca se importó el
      // listado de clientes de Avantio, o es un cliente nuevo desde el último import) se
      // crea con los datos que trae este mismo Excel, para no perder el enlace.
      const clienteIdAvantio = limpiaTexto(d.cliente_id_avantio);
      let clienteId = null;
      if (clienteIdAvantio) {
        const cli = buscarCliente.get(clienteIdAvantio);
        if (cli) {
          clienteId = cli.id;
        } else {
          const nombreCliente = limpia(d.cliente_nombre);
          if (nombreCliente) {
            const info = insertarCliente.run({
              id_avantio: clienteIdAvantio,
              nombre: nombreCliente,
              apellido1: limpia(d.cliente_apellidos),
              fecha_nacimiento: parseFecha(d.cliente_fecha_nacimiento),
              pais: limpia(d.cliente_pais),
              telefono,
              telefono2: limpiaTexto(d.cliente_telefono2),
              email,
              dni: limpiaTexto(d.cliente_dni),
            });
            clienteId = info.lastInsertRowid;
            resumen.clientes_creados++;
          }
        }
      }
      const fragObs = [limpia(d.observaciones), telefono ? `TELF: ${telefono}` : null, email];

      const datos = {
        numero_reserva,
        nombre_cliente: nombreCompleto(d.cliente_nombre, d.cliente_apellidos),
        edificio: limpia(d.edificio),
        tih,
        personas: aEntero(d.adultos) + aEntero(d.ninos) + aEntero(d.bebes) || null,
        entrada,
        salida,
        apartamento_id: apartamentoId,
        tipo_reserva: mapearEstado(d.estado),
        fecha_creacion: parseFecha(d.fecha_creacion) || new Date().toISOString().slice(0, 10),
        portal: limpia(d.portal),
        condicion_cancelacion: limpia(d.condicion_cancelacion),
        atendido_por: limpia(d.atendido_por),
        hora_entrada: limpia(d.hora_entrada) || '17:00',
        hora_salida: limpia(d.hora_salida) || '10:00',
        precio_total: aMoneda(d.precio_total),
        pagado: aMoneda(d.pagado),
        notas_internas: componerObservaciones(null, [limpia(d.coment_checkin), limpia(d.coment_checkout)]),
        ocupante: nombreCompleto(d.ocupante_nombre, d.ocupante_apellidos),
        cliente_id: clienteId,
      };
      datos.pendiente = Math.round((datos.precio_total - datos.pagado) * 100) / 100;

      const existente = buscarReserva.get(numero_reserva);

      if (existente) {
        // UPDATE sin pisar: apartamento_id (si ya tenía uno), cliente_id (si ya tenía uno,
        // p.ej. corregido a mano), notas_internas; observaciones se hace append de los
        // fragmentos nuevos sobre las existentes.
        const apartamentoFinal = existente.apartamento_id != null ? existente.apartamento_id : datos.apartamento_id;
        const clienteFinal = existente.cliente_id != null ? existente.cliente_id : datos.cliente_id;
        const observacionesFinal = componerObservaciones(existente.observaciones, fragObs);
        const upd = {
          ...datos,
          id: existente.id,
          apartamento_id: apartamentoFinal,
          cliente_id: clienteFinal,
          observaciones: observacionesFinal,
          notas_internas: existente.notas_internas != null && existente.notas_internas !== ''
            ? existente.notas_internas : datos.notas_internas,
        };
        db.prepare(`
          UPDATE reservas SET
            nombre_cliente=@nombre_cliente, edificio=@edificio, tih=@tih, personas=@personas,
            entrada=@entrada, salida=@salida, observaciones=@observaciones, apartamento_id=@apartamento_id,
            tipo_reserva=@tipo_reserva, fecha_creacion=@fecha_creacion, portal=@portal,
            condicion_cancelacion=@condicion_cancelacion, atendido_por=@atendido_por,
            hora_entrada=@hora_entrada, hora_salida=@hora_salida, precio_total=@precio_total,
            pagado=@pagado, pendiente=@pendiente, notas_internas=@notas_internas,
            ocupante=@ocupante, cliente_id=@cliente_id
          WHERE id=@id
        `).run(upd);
        resumen.actualizadas++;
        if (apartamentoFinal != null) resumen.apartamentos_vinculados++;
        if (clienteFinal != null) resumen.clientes_vinculados++;
        sincronizarPagosAvantio(existente.id, datos.pagado, datos.pendiente, datos.fecha_creacion);
      } else {
        const info = insertar.run({ ...datos, observaciones: componerObservaciones(null, fragObs) });
        resumen.nuevas++;
        if (datos.apartamento_id != null) resumen.apartamentos_vinculados++;
        if (clienteId != null) resumen.clientes_vinculados++;
        sincronizarPagosAvantio(info.lastInsertRowid, datos.pagado, datos.pendiente, datos.fecha_creacion);
      }
    });
  });

  tx();
  return resumen;
}

module.exports = { importarReservasAvantio };
