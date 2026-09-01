// bot-telegram.js
// Bot de Telegram de solo lectura sobre el CRM: recibe preguntas, Claude decide
// qué endpoints de /api/* consultar (vía tool-calling) y responde en el chat.
// Requiere internet saliente (Telegram + Anthropic); el CRM en sí sigue en LAN.
require('dotenv').config();
const { Telegraf } = require('telegraf');
const Anthropic = require('@anthropic-ai/sdk');

const CRM_API_URL = process.env.CRM_API_URL || 'http://localhost:3000';
const TELEGRAM_OWNER_ID = String(process.env.TELEGRAM_OWNER_ID || '');

for (const v of ['TELEGRAM_BOT_TOKEN', 'ANTHROPIC_API_KEY', 'TELEGRAM_OWNER_ID', 'CRM_BOT_USERNAME', 'CRM_BOT_PASSWORD']) {
  if (!process.env[v]) {
    console.error(`Falta ${v} en .env`);
    process.exit(1);
  }
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

let crmToken = null;

async function loginCrm() {
  const res = await fetch(`${CRM_API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.CRM_BOT_USERNAME, password: process.env.CRM_BOT_PASSWORD }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error('Login CRM falló: ' + data.error);
  crmToken = data.token;
}

async function llamarCrm(rutaConQuery) {
  const hacer = async () => fetch(`${CRM_API_URL}/api/${rutaConQuery}`, {
    headers: { 'X-Auth-Token': crmToken },
  });
  let res = await hacer();
  if (res.status === 401) {
    await loginCrm();
    res = await hacer();
  }
  if (!res.ok) throw new Error(`CRM respondió ${res.status} en /api/${rutaConQuery}`);
  return res.json();
}

// --- Helpers de filtrado/proyección: las listas del CRM (reservas, propietarios,
// apartamentos) tienen cientos/miles de filas con decenas de columnas cada una (hasta
// 2MB en JSON) - mandarle eso entero a Claude lo trunca a la mitad y rompe el JSON.
// Se filtra y proyecta ANTES de armar el tool_result, nunca se corta el texto a ciegas.
const DIACRITICOS = /[̀-ͯ]/g;
const normalizar = (s) => String(s ?? '').normalize('NFD').replace(DIACRITICOS, '').toLowerCase();

function coincideTexto(campos, termino) {
  if (!termino) return true;
  const haystack = normalizar(campos.filter(Boolean).join(' '));
  return normalizar(termino).split(/\s+/).filter(Boolean).every((palabra) => haystack.includes(palabra));
}

function soloCampos(obj, campos) {
  const out = {};
  for (const c of campos) out[c] = obj[c];
  return out;
}

function limitar(items, limite, etiqueta) {
  return {
    total: items.length,
    mostrando: Math.min(items.length, limite),
    [etiqueta]: items.slice(0, limite),
  };
}

function seSolapan(entrada, salida, desde, hasta) {
  if (!desde && !hasta) return true;
  const d = desde || hasta;
  const h = hasta || desde;
  return entrada < h && d < salida;
}

// --- Tools: cada una es GET puro sobre la API ya documentada en CLAUDE.md ---
const tools = [
  {
    name: 'dashboard',
    description: 'Resumen general: próximos check-in/check-out, reservas en curso, pagos pendientes.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'buscar_reservas',
    description: 'Busca reservas por cliente, apartamento y/o rango de fechas (todos los filtros son opcionales y combinables; sin ningún filtro devuelve las más recientes). Usar "cliente" para buscar por nombre de huésped.',
    input_schema: {
      type: 'object',
      properties: {
        cliente: { type: 'string', description: 'Nombre del cliente/huésped (parcial, sin distinguir mayúsculas/acentos)' },
        apartamento: { type: 'string', description: 'Nombre del apartamento (parcial)' },
        desde: { type: 'string', description: 'YYYY-MM-DD, filtra reservas que solapen desde esta fecha' },
        hasta: { type: 'string', description: 'YYYY-MM-DD, filtra reservas que solapen hasta esta fecha' },
      },
    },
  },
  {
    name: 'reservas_sin_asignar',
    description: 'Reservas importadas que no tienen apartamento asignado (bandeja de incidencias).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'ficha_apartamento',
    description: 'Detalle de un apartamento por ID: propietarios, estado de limpieza, portal, clasificación.',
    input_schema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
  },
  {
    name: 'listar_apartamentos',
    description: 'Lista apartamentos con propietario y portal. "buscar" filtra por nombre de apartamento/edificio O nombre/apellidos del propietario - usarla para encontrar "el apartamento de FULANO". Sin filtro devuelve los primeros (hay 253 en total).',
    input_schema: { type: 'object', properties: { buscar: { type: 'string', description: 'Nombre/edificio del apartamento, o nombre/apellidos del propietario' } } },
  },
  {
    name: 'listar_propietarios',
    description: 'Busca propietarios por nombre, apellidos o DNI (parcial, sin distinguir mayúsculas/acentos). Siempre pasar "buscar" - hay 1400+ propietarios, sin filtro solo se ven los primeros.',
    input_schema: { type: 'object', properties: { buscar: { type: 'string', description: 'Nombre, apellido(s) o DNI a buscar' } } },
  },
  {
    name: 'ficha_propietario',
    description: 'Detalle de un propietario por ID.',
    input_schema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
  },
  {
    name: 'pagos_propietario_resumen',
    description: 'Pagos MANUALES sueltos a propietarios (tabla aparte, no todos los apartamentos tienen filas). NO usar para "cuánto se le debe del contrato" - para eso usar resumen_contrato_propietario. Devuelve solo los apartamentos que tienen algún pago manual registrado ese año.',
    input_schema: { type: 'object', properties: { anio: { type: 'integer' } }, required: ['anio'] },
  },
  {
    name: 'resumen_contrato_propietario',
    description: 'Lo que se le debe/pagó a un propietario por su CONTRATO de alquiler este año: cuotas totales, cuotas pagadas, importe pagado y pendiente. Requiere el id del propietario (obtenerlo con listar_propietarios primero).',
    input_schema: { type: 'object', properties: { propietario_id: { type: 'integer' }, anio: { type: 'integer' } }, required: ['propietario_id', 'anio'] },
  },
  {
    name: 'estadisticas_portales',
    description: 'Ingresos por portal (Booking, Airbnb, etc.) en un año, ya netos de comisión.',
    input_schema: { type: 'object', properties: { anio: { type: 'integer' } }, required: ['anio'] },
  },
  {
    name: 'estadisticas_ocupacion',
    description: 'Ocupación por mes y por tipo de apartamento en un año.',
    input_schema: { type: 'object', properties: { anio: { type: 'integer' } }, required: ['anio'] },
  },
  {
    name: 'limpieza_resumen',
    description: 'Estado de tareas de limpieza de un día: total, pendientes, en proceso, completadas.',
    input_schema: { type: 'object', properties: { fecha: { type: 'string', description: 'YYYY-MM-DD, default hoy' } } },
  },
  {
    name: 'mantenimiento_resumen',
    description: 'Tareas de mantenimiento: abiertas, urgentes, en proceso, completadas este mes.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'facturas_pendientes',
    description: 'Lista de facturas, opcionalmente filtradas por estado (emitida/parcialmente_pagada/pagada/anulada) y año.',
    input_schema: { type: 'object', properties: { estado: { type: 'string' }, anio: { type: 'integer' } } },
  },
];

const CAMPOS_RESERVA = ['id', 'numero_reserva', 'nombre_cliente', 'ocupante', 'apartamento_nombre',
  'entrada', 'salida', 'tipo_reserva', 'portal', 'checkin_estado', 'checkout_estado',
  'precio_total', 'total_pagado', 'pendiente', 'observaciones'];
const CAMPOS_PROPIETARIO = ['id', 'nombre', 'apellidos', 'segundo_apellido', 'telefono',
  'telefono2', 'email', 'numero_documento', 'num_alojamientos', 'ciudad'];
const CAMPOS_APARTAMENTO = ['id', 'nombre', 'edificio', 'tipo_clasificacion', 'estado_limpieza',
  'portal_nombre', 'propietario_id', 'propietario_nombre', 'propietario_apellidos',
  'propietario_segundo_apellido', 'capacidad'];

async function ejecutarTool(nombre, input) {
  switch (nombre) {
    case 'dashboard': {
      const d = await llamarCrm('dashboard');
      const CAMPOS_DASH = ['numero_reserva', 'nombre_cliente', 'apartamento_nombre', 'entrada', 'salida', 'portal'];
      return {
        pagos_pendientes: d.pagos_pendientes,
        reservas_entrantes: d.reservas_entrantes,
        proximos_checkin: { total: d.proximos_checkin.length, items: d.proximos_checkin.slice(0, 15).map((r) => soloCampos(r, CAMPOS_DASH)) },
        proximos_checkout: { total: d.proximos_checkout.length, items: d.proximos_checkout.slice(0, 15).map((r) => soloCampos(r, CAMPOS_DASH)) },
        reservas_en_curso: { total: d.reservas_en_curso.length, items: d.reservas_en_curso.slice(0, 15).map((r) => soloCampos(r, CAMPOS_DASH)) },
      };
    }
    case 'buscar_reservas': {
      const todas = await llamarCrm('reservas/todas');
      const filtradas = todas
        .filter((r) => coincideTexto([r.nombre_cliente, r.ocupante], input.cliente))
        .filter((r) => coincideTexto([r.apartamento_nombre], input.apartamento))
        .filter((r) => seSolapan(r.entrada, r.salida, input.desde, input.hasta))
        .sort((a, b) => (b.entrada || '').localeCompare(a.entrada || ''));
      return limitar(filtradas.map((r) => soloCampos(r, CAMPOS_RESERVA)), 40, 'reservas');
    }
    case 'reservas_sin_asignar':
      return llamarCrm('reservas/sin-asignar');
    case 'ficha_apartamento':
      return llamarCrm(`apartamentos/${input.id}`);
    case 'listar_propietarios': {
      const todos = await llamarCrm('propietarios');
      const filtrados = todos.filter((p) => coincideTexto([p.nombre, p.apellidos, p.segundo_apellido, p.numero_documento, p.email], input.buscar));
      return limitar(filtrados.map((p) => soloCampos(p, CAMPOS_PROPIETARIO)), 30, 'propietarios');
    }
    case 'ficha_propietario':
      return llamarCrm(`propietarios/${input.id}`);
    case 'listar_apartamentos': {
      const todos = await llamarCrm('apartamentos?todos=1');
      const filtrados = todos.filter((a) => coincideTexto(
        [a.nombre, a.edificio, a.propietario_nombre, a.propietario_apellidos, a.propietario_segundo_apellido],
        input.buscar,
      ));
      return limitar(filtrados.map((a) => soloCampos(a, CAMPOS_APARTAMENTO)), 60, 'apartamentos');
    }
    case 'pagos_propietario_resumen':
      return llamarCrm(`apartamentos/pagos-propietario/resumen?anio=${input.anio}`);
    case 'resumen_contrato_propietario':
      return llamarCrm(`contratos/resumen-propietario?propietario_id=${input.propietario_id}&anio=${input.anio}`);
    case 'estadisticas_portales':
      return llamarCrm(`estadisticas/portales?anio=${input.anio}`);
    case 'estadisticas_ocupacion':
      return llamarCrm(`estadisticas/ocupacion?anio=${input.anio}`);
    case 'limpieza_resumen':
      return llamarCrm(`limpieza/resumen${input.fecha ? `?fecha=${input.fecha}` : ''}`);
    case 'mantenimiento_resumen':
      return llamarCrm('mantenimiento/resumen');
    case 'facturas_pendientes': {
      const qs = new URLSearchParams();
      if (input.estado) qs.set('estado', input.estado);
      if (input.anio) qs.set('anio', input.anio);
      const CAMPOS_FACTURA = ['id', 'numero', 'tipo', 'estado', 'emisor_nombre', 'receptor_nombre',
        'apartamento_nombre', 'propietario_nombre', 'propietario_apellidos', 'total',
        'fecha_emision', 'fecha_vencimiento'];
      const facturas = await llamarCrm(`facturas?${qs}`);
      return limitar(facturas.map((f) => soloCampos(f, CAMPOS_FACTURA)), 40, 'facturas');
    }
    default:
      throw new Error('Tool desconocida: ' + nombre);
  }
}

function systemPrompt() {
  const hoy = new Date();
  const fechaHoy = hoy.toISOString().slice(0, 10);
  const anioActual = hoy.getFullYear();
  return `Sos un asistente que responde preguntas sobre un CRM de alquiler vacacional,
consultando su API mediante las tools disponibles. Respondé siempre en español, breve y concreto,
con los datos reales que te devuelven las tools (no inventes números). Si una pregunta requiere
varias consultas (por ejemplo cruzar reservas con apartamentos), encadená las tools que hagan falta.
Hoy es ${fechaHoy}. En cualquier tool que pida "anio" y la pregunta no especifique año, usá
${anioActual} (el año actual) por defecto - NO pruebes con años anteriores salvo que te lo pidan
explícitamente ("el año pasado", "en 2025", etc.).
Las tools de búsqueda (reservas, propietarios, apartamentos, facturas) devuelven "total" y
"mostrando": si mostrando < total, hay más resultados de los que ves - si la búsqueda inicial no
encontró lo que pedían, probá con un término más corto o parcial (ej. solo el apellido) antes de
decir que no existe.
IMPORTANTE - no mezclar datos de entidades distintas: antes de dar una cifra o un dato, verificá
que el nombre de apartamento/propietario que aparece en el resultado de la tool es EXACTAMENTE
el que te preguntaron, no una fila cualquiera de la lista. "pagos_propietario_resumen" solo
devuelve apartamentos con pagos manuales sueltos registrados - si el apartamento que buscás no
aparece ahí, no es que deba 0, es que no tiene filas en esa tabla; para "cuánto se le debe del
contrato" usá siempre "resumen_contrato_propietario", nunca "pagos_propietario_resumen". Si no
podés confirmar la coincidencia, decilo en vez de inventar o de dar el dato de otra entidad.
Formateá fechas como DD/MM/AAAA y montos en euros.`;
}

async function responder(pregunta) {
  const mensajes = [{ role: 'user', content: pregunta }];

  for (let vuelta = 0; vuelta < 6; vuelta++) {
    const respuesta = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 8000,
      system: systemPrompt(),
      tools,
      messages: mensajes,
    });

    const usosDeTool = respuesta.content.filter((b) => b.type === 'tool_use');
    if (usosDeTool.length === 0) {
      console.log('vuelta', vuelta, 'stop_reason', respuesta.stop_reason, 'bloques', respuesta.content.map((b) => b.type));
      return respuesta.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    }

    mensajes.push({ role: 'assistant', content: respuesta.content });
    const resultados = [];
    for (const uso of usosDeTool) {
      try {
        const data = await ejecutarTool(uso.name, uso.input || {});
        resultados.push({ type: 'tool_result', tool_use_id: uso.id, content: JSON.stringify(data).slice(0, 20000) });
      } catch (e) {
        resultados.push({ type: 'tool_result', tool_use_id: uso.id, content: `Error: ${e.message}`, is_error: true });
      }
    }
    mensajes.push({ role: 'user', content: resultados });
  }
  return 'No pude terminar de procesar la consulta (demasiados pasos).';
}

bot.use(async (ctx, next) => {
  if (String(ctx.chat?.id) !== TELEGRAM_OWNER_ID) {
    console.log(`Mensaje ignorado de chat no autorizado: ${ctx.chat?.id}`);
    return;
  }
  return next();
});

bot.on('text', async (ctx) => {
  console.log('Mensaje recibido:', JSON.stringify(ctx.message.text));
  await ctx.sendChatAction('typing');
  try {
    const texto = await responder(ctx.message.text);
    await ctx.reply(texto || 'Sin respuesta.');
  } catch (e) {
    console.error('Error en responder():', e);
    await ctx.reply('Error consultando el CRM: ' + e.message);
  }
});

loginCrm()
  .then(() => bot.launch())
  .then(() => console.log('Bot de Telegram conectado al CRM y escuchando (polling)...'))
  .catch((e) => {
    console.error('No se pudo iniciar sesión en el CRM:', e.message);
    process.exit(1);
  });

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
