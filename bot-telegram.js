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

// --- Tools: cada una es GET puro sobre la API ya documentada en CLAUDE.md ---
const tools = [
  {
    name: 'dashboard',
    description: 'Resumen general: próximos check-in/check-out, reservas en curso, pagos pendientes.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'buscar_reservas',
    description: 'Lista todas las reservas (con nombre de apartamento). Útil para buscar por cliente, fechas o estado en el texto devuelto.',
    input_schema: { type: 'object', properties: {} },
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
    description: 'Lista todos los apartamentos con sus propietarios y portal.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'pagos_propietario_resumen',
    description: 'Total pagado/pendiente a propietarios por apartamento, para un año.',
    input_schema: { type: 'object', properties: { anio: { type: 'integer' } }, required: ['anio'] },
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

async function ejecutarTool(nombre, input) {
  switch (nombre) {
    case 'dashboard':
      return llamarCrm('dashboard');
    case 'buscar_reservas':
      return llamarCrm('reservas/todas');
    case 'reservas_sin_asignar':
      return llamarCrm('reservas/sin-asignar');
    case 'ficha_apartamento':
      return llamarCrm(`apartamentos/${input.id}`);
    case 'listar_apartamentos':
      return llamarCrm('apartamentos?todos=1');
    case 'pagos_propietario_resumen':
      return llamarCrm(`apartamentos/pagos-propietario/resumen?anio=${input.anio}`);
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
      return llamarCrm(`facturas?${qs}`);
    }
    default:
      throw new Error('Tool desconocida: ' + nombre);
  }
}

const SYSTEM_PROMPT = `Sos un asistente que responde preguntas sobre un CRM de alquiler vacacional,
consultando su API mediante las tools disponibles. Respondé siempre en español, breve y concreto,
con los datos reales que te devuelven las tools (no inventes números). Si una pregunta requiere
varias consultas (por ejemplo cruzar reservas con apartamentos), encadená las tools que hagan falta.
Formateá fechas como DD/MM/AAAA y montos en euros.`;

async function responder(pregunta) {
  const mensajes = [{ role: 'user', content: pregunta }];

  for (let vuelta = 0; vuelta < 6; vuelta++) {
    const respuesta = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools,
      messages: mensajes,
    });

    const usosDeTool = respuesta.content.filter((b) => b.type === 'tool_use');
    if (usosDeTool.length === 0) {
      return respuesta.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    }

    mensajes.push({ role: 'assistant', content: respuesta.content });
    const resultados = [];
    for (const uso of usosDeTool) {
      try {
        const data = await ejecutarTool(uso.name, uso.input || {});
        resultados.push({ type: 'tool_result', tool_use_id: uso.id, content: JSON.stringify(data).slice(0, 8000) });
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
  await ctx.sendChatAction('typing');
  try {
    const texto = await responder(ctx.message.text);
    await ctx.reply(texto || 'Sin respuesta.');
  } catch (e) {
    console.error(e);
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
