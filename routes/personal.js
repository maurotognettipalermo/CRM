// API REST del módulo de Personal (RRHH): empleados, control horario (fichajes),
// ausencias, horas extra y resumen del día para el dashboard de administración.
const express = require('express');
const db = require('../db/database');
const { registrarActividad } = require('../services/actividadService');

const router = express.Router();

function txt(v) { return v === undefined || v === null || v === '' ? null : String(v); }
function aEntero(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}
function actor(req) { return req.usuario ? (req.usuario.nombre || req.usuario.username) : null; }
function esAdmin(req) { return !!(req.usuario && req.usuario.rol === 'administrador'); }

// Fecha y hora del servidor en horario local (formato ISO + HH:MM:SS).
function ahoraLocal() {
  return db.prepare("SELECT date('now','localtime') AS fecha, time('now','localtime') AS hora").get();
}

// 'HH:MM[:SS]' -> segundos desde medianoche.
function horaASegundos(h) {
  if (!h) return null;
  const p = String(h).split(':').map((x) => parseInt(x, 10));
  if (!p.length || isNaN(p[0])) return null;
  return (p[0] || 0) * 3600 + (p[1] || 0) * 60 + (p[2] || 0);
}

// (hora_fin - hora_inicio) en horas decimales (2 dec). null si falta o el rango es inválido.
function horasDeRango(ini, fin) {
  const a = horaASegundos(ini), b = horaASegundos(fin);
  if (a === null || b === null || b <= a) return null;
  return Math.round(((b - a) / 3600) * 100) / 100;
}

// Empleado vinculado al usuario logueado (o null si no tiene ficha).
function empleadoDeUsuario(req) {
  if (!req.usuario) return null;
  return db.prepare('SELECT * FROM empleados WHERE usuario_id = ?').get(req.usuario.id);
}

// Fichajes de un empleado en una fecha, ordenados por hora.
function fichajesDelDia(empleadoId, fecha) {
  return db.prepare(
    'SELECT * FROM fichajes WHERE empleado_id = ? AND fecha = ? ORDER BY hora ASC, id ASC'
  ).all(empleadoId, fecha);
}

// Estado actual a partir de la secuencia de fichajes del día.
// 'trabajando' | 'pausa' | 'fuera'.
function estadoDe(rows) {
  let estado = 'fuera';
  for (const f of rows) {
    if (f.tipo === 'entrada' || f.tipo === 'reanudacion') estado = 'trabajando';
    else if (f.tipo === 'pausa') estado = 'pausa';
    else if (f.tipo === 'salida') estado = 'fuera';
  }
  return estado;
}

// Resumen del día: { entrada, salida, pausas, horas_trabajadas }.
// Suma intervalos entrada/reanudación -> pausa/salida. Si queda un intervalo abierto
// (sigue trabajando) y se pasa `horaActual`, se cierra hasta esa hora (solo para hoy).
function resumenDia(rows, horaActual) {
  let entrada = null, salida = null, pausas = 0;
  let total = 0, abierto = null;
  for (const f of rows) {
    const seg = horaASegundos(f.hora);
    if (f.tipo === 'entrada') {
      if (!entrada) entrada = f.hora;
      abierto = seg;
    } else if (f.tipo === 'reanudacion') {
      abierto = seg;
    } else if (f.tipo === 'pausa') {
      pausas++;
      if (abierto !== null && seg !== null) { total += seg - abierto; abierto = null; }
    } else if (f.tipo === 'salida') {
      salida = f.hora;
      if (abierto !== null && seg !== null) { total += seg - abierto; abierto = null; }
    }
  }
  if (abierto !== null && horaActual) {
    const seg = horaASegundos(horaActual);
    if (seg !== null && seg > abierto) total += seg - abierto;
  }
  const horas = Math.round((total / 3600) * 100) / 100;
  return { entrada, salida, pausas, horas_trabajadas: horas };
}

// 'HH:MM:SS' -> 'HH:MM' (o null).
function hhmm(h) { return h ? String(h).slice(0, 5) : null; }

// Día de la semana de una fecha ISO en UTC (0=domingo ... 6=sábado).
function diaSemana(iso) {
  const p = String(iso).split('-').map(Number);
  if (p.length !== 3) return null;
  return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
}

// Días laborables (lun-vie) entre dos fechas ISO, ambas inclusive. 0 si rango inválido.
function diasLaborables(ini, fin) {
  const a = String(ini).split('-').map(Number);
  const b = String(fin).split('-').map(Number);
  if (a.length !== 3 || b.length !== 3) return 0;
  let d = Date.UTC(a[0], a[1] - 1, a[2]);
  const hasta = Date.UTC(b[0], b[1] - 1, b[2]);
  if (hasta < d) return 0;
  let n = 0;
  while (d <= hasta) {
    const dow = new Date(d).getUTCDay();
    if (dow !== 0 && dow !== 6) n++;
    d += 86400000;
  }
  return n;
}

// Empleado por id (o null).
function empleadoPorId(id) {
  return db.prepare('SELECT * FROM empleados WHERE id = ?').get(id);
}

// Pausas del día como pares { inicio, fin } (fin null si sigue en pausa).
function pausasDe(rows) {
  const pausas = [];
  let abierta = null;
  for (const f of rows) {
    if (f.tipo === 'pausa') { abierta = { inicio: hhmm(f.hora), fin: null }; pausas.push(abierta); }
    else if (f.tipo === 'reanudacion' && abierta) { abierta.fin = hhmm(f.hora); abierta = null; }
  }
  return pausas;
}

// ============================================================
// Empleados
// ============================================================
const EMP_CAMPOS = [
  'nombre', 'apellidos', 'dni', 'telefono', 'email', 'puesto',
  'fecha_inicio', 'dias_vacaciones_anio', 'activo', 'notas',
];
function normalizaEmp(campo, valor) {
  if (campo === 'dias_vacaciones_anio') return aEntero(valor);
  if (campo === 'activo') return valor ? 1 : 0;
  return txt(valor);
}

// GET /api/personal/empleados — lista. Por defecto solo activos; ?todos=1 incluye inactivos.
router.get('/empleados', (req, res) => {
  const todos = req.query.todos == 1 || req.query.todos === 'true';
  const rows = db.prepare(`
    SELECT e.*, u.username AS usuario_username
    FROM empleados e
    LEFT JOIN usuarios u ON u.id = e.usuario_id
    ${todos ? '' : 'WHERE e.activo = 1'}
    ORDER BY e.activo DESC, e.nombre COLLATE NOCASE, e.apellidos COLLATE NOCASE
  `).all();
  res.json(rows);
});

// GET /api/personal/empleados/:id — ficha completa.
router.get('/empleados/:id', (req, res) => {
  const emp = db.prepare(`
    SELECT e.*, u.username AS usuario_username
    FROM empleados e LEFT JOIN usuarios u ON u.id = e.usuario_id
    WHERE e.id = ?
  `).get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });
  res.json(emp);
});

// POST /api/personal/empleados — crear (vincula usuario_id si viene).
router.post('/empleados', (req, res) => {
  const b = req.body || {};
  if (!txt(b.nombre)) return res.status(400).json({ error: 'El nombre es obligatorio' });

  const usuarioId = aEntero(b.usuario_id);
  if (usuarioId !== null) {
    if (!db.prepare('SELECT id FROM usuarios WHERE id = ?').get(usuarioId)) {
      return res.status(400).json({ error: 'El usuario indicado no existe' });
    }
    if (db.prepare('SELECT id FROM empleados WHERE usuario_id = ?').get(usuarioId)) {
      return res.status(409).json({ error: 'Ese usuario ya está vinculado a otro empleado' });
    }
  }

  const datos = {};
  for (const c of EMP_CAMPOS) if (c in b) datos[c] = normalizaEmp(c, b[c]);
  datos.nombre = txt(b.nombre);
  datos.usuario_id = usuarioId;
  if (datos.activo === undefined || datos.activo === null) datos.activo = 1;

  const claves = Object.keys(datos);
  const cols = claves.join(', ');
  const ph = claves.map((c) => '@' + c).join(', ');
  const info = db.prepare(`INSERT INTO empleados (${cols}) VALUES (${ph})`).run(datos);
  registrarActividad(db, req.usuario && req.usuario.id, actor(req), 'crear', 'empleado', info.lastInsertRowid, datos.nombre);
  res.status(201).json({ id: info.lastInsertRowid });
});

// PUT /api/personal/empleados/:id — editar.
router.put('/empleados/:id', (req, res) => {
  const emp = db.prepare('SELECT * FROM empleados WHERE id = ?').get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });
  const b = req.body || {};
  if ('nombre' in b && !txt(b.nombre)) return res.status(400).json({ error: 'El nombre no puede quedar vacío' });

  const sets = [];
  const vals = {};
  for (const c of EMP_CAMPOS) {
    if (c in b) { sets.push(`${c} = @${c}`); vals[c] = normalizaEmp(c, b[c]); }
  }
  if ('usuario_id' in b) {
    const usuarioId = aEntero(b.usuario_id);
    if (usuarioId !== null) {
      if (!db.prepare('SELECT id FROM usuarios WHERE id = ?').get(usuarioId)) {
        return res.status(400).json({ error: 'El usuario indicado no existe' });
      }
      const dup = db.prepare('SELECT id FROM empleados WHERE usuario_id = ? AND id <> ?').get(usuarioId, emp.id);
      if (dup) return res.status(409).json({ error: 'Ese usuario ya está vinculado a otro empleado' });
    }
    sets.push('usuario_id = @usuario_id'); vals.usuario_id = usuarioId;
  }
  if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
  vals.id = emp.id;
  db.prepare(`UPDATE empleados SET ${sets.join(', ')} WHERE id = @id`).run(vals);
  res.json({ ok: true });
});

// DELETE /api/personal/empleados/:id — 409 si tiene fichajes o ausencias.
router.delete('/empleados/:id', (req, res) => {
  const emp = db.prepare('SELECT id, nombre FROM empleados WHERE id = ?').get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });
  const nf = db.prepare('SELECT COUNT(*) AS c FROM fichajes WHERE empleado_id = ?').get(emp.id).c;
  const na = db.prepare('SELECT COUNT(*) AS c FROM ausencias WHERE empleado_id = ?').get(emp.id).c;
  if (nf > 0 || na > 0) {
    return res.status(409).json({ error: 'No se puede borrar: el empleado tiene fichajes o ausencias registradas' });
  }
  db.prepare('DELETE FROM empleados WHERE id = ?').run(emp.id);
  registrarActividad(db, req.usuario && req.usuario.id, actor(req), 'eliminar', 'empleado', emp.id, emp.nombre);
  res.json({ ok: true });
});

// ============================================================
// Fichajes (control horario)
// ============================================================

// GET /api/personal/fichajes/estado — estado actual + resumen del empleado logueado.
// (declarar antes de cualquier ruta con parámetro)
router.get('/fichajes/estado', (req, res) => {
  const emp = empleadoDeUsuario(req);
  if (!emp) return res.status(404).json({ error: 'No tienes una ficha de empleado vinculada' });
  const { fecha, hora } = ahoraLocal();
  const rows = fichajesDelDia(emp.id, fecha);
  res.json({
    empleado: { id: emp.id, nombre: emp.nombre, apellidos: emp.apellidos },
    fecha,
    estado: estadoDe(rows),
    resumen_dia: resumenDia(rows, hora),
    fichajes: rows,
  });
});

// GET /api/personal/fichajes/resumen?empleado_id=&mes=&anio= — resumen mensual.
router.get('/fichajes/resumen', (req, res) => {
  const ahora = ahoraLocal();
  const mes = aEntero(req.query.mes) || (new Date().getMonth() + 1);
  const anio = aEntero(req.query.anio) || new Date().getFullYear();
  const prefijo = `${anio}-${String(mes).padStart(2, '0')}-`; // ej: '2026-06-'

  // Empleados a incluir: admin puede ver todos o uno; el resto solo el suyo.
  let empleados;
  if (esAdmin(req)) {
    const pedido = aEntero(req.query.empleado_id);
    empleados = pedido
      ? db.prepare('SELECT * FROM empleados WHERE id = ?').all(pedido)
      : db.prepare('SELECT * FROM empleados WHERE activo = 1 ORDER BY nombre COLLATE NOCASE').all();
  } else {
    const propio = empleadoDeUsuario(req);
    if (!propio) return res.status(404).json({ error: 'No tienes una ficha de empleado vinculada' });
    empleados = [propio];
  }

  const resultado = empleados.map((emp) => {
    const rows = db.prepare(
      "SELECT * FROM fichajes WHERE empleado_id = ? AND fecha LIKE ? ORDER BY fecha ASC, hora ASC, id ASC"
    ).all(emp.id, prefijo + '%');
    const porDia = {};
    rows.forEach((f) => { (porDia[f.fecha] = porDia[f.fecha] || []).push(f); });
    const dias = Object.keys(porDia).sort().map((fecha) => {
      const horaCap = (fecha === ahora.fecha) ? ahora.hora : null;
      return { fecha, horas: resumenDia(porDia[fecha], horaCap).horas_trabajadas };
    });
    const total = Math.round(dias.reduce((s, d) => s + d.horas, 0) * 100) / 100;
    return {
      empleado: { id: emp.id, nombre: emp.nombre, apellidos: emp.apellidos },
      dias,
      total_horas: total,
    };
  });

  res.json({ mes, anio, empleados: resultado });
});

// GET /api/personal/fichajes/exportar?empleado_ids=&meses=&anio= — CSV (solo admin).
// meses/empleado_ids: listas separadas por coma; vacío = todos. (antes de /fichajes)
router.get('/fichajes/exportar', (req, res) => {
  if (!esAdmin(req)) return res.status(403).json({ error: 'Solo disponible para administradores' });
  const anio = aEntero(req.query.anio) || new Date().getFullYear();

  const parseNums = (v) => String(v || '').split(',').map((x) => parseInt(x, 10)).filter((n) => !isNaN(n));
  let meses = [...new Set(parseNums(req.query.meses).filter((m) => m >= 1 && m <= 12))].sort((a, b) => a - b);
  if (!meses.length) meses = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const ids = [...new Set(parseNums(req.query.empleado_ids))];

  let empleados = ids.length
    ? ids.map((id) => db.prepare('SELECT * FROM empleados WHERE id = ?').get(id)).filter(Boolean)
    : db.prepare('SELECT * FROM empleados ORDER BY nombre COLLATE NOCASE, apellidos COLLATE NOCASE').all();
  if (ids.length) empleados.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

  const pad = (n) => String(n).padStart(2, '0');
  const durHHMM = (sec) => `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}`;

  // Pausas de un día: [{ini, fin}] (fin null si quedó en curso).
  function pausasDelDia(rows) {
    const res = [];
    let abierta = null;
    for (const f of rows) {
      if (f.tipo === 'pausa') { abierta = { ini: f.hora, fin: null }; res.push(abierta); }
      else if (f.tipo === 'reanudacion' && abierta) { abierta.fin = f.hora; abierta = null; }
    }
    return res;
  }

  // 1ª pasada: construye las filas (por empleado, meses asc y días asc) y el máximo de pausas/día.
  let maxPausas = 0;
  const bloques = empleados.map((emp) => {
    const nombre = [emp.nombre, emp.apellidos].filter(Boolean).join(' ');
    let total = 0;
    const filas = [];
    for (const mes of meses) {
      const diasMes = new Date(anio, mes, 0).getDate();
      for (let d = 1; d <= diasMes; d++) {
        const dow = new Date(anio, mes - 1, d).getDay();
        if (dow === 0 || dow === 6) continue; // solo laborables
        const fecha = `${anio}-${pad(mes)}-${pad(d)}`;
        const rows = fichajesDelDia(emp.id, fecha);
        const fechaTxt = `${pad(d)}/${pad(mes)}/${anio}`;
        if (!rows.length) { filas.push({ fechaTxt, vacio: true }); continue; }
        const entrada = (rows.find((f) => f.tipo === 'entrada') || {}).hora || '';
        const salida = [...rows].reverse().find((f) => f.tipo === 'salida');
        const pausas = pausasDelDia(rows).map((p) => ({
          ini: (p.ini || '').slice(0, 5),
          fin: p.fin ? p.fin.slice(0, 5) : '',
          dur: p.fin ? durHHMM(horaASegundos(p.fin) - horaASegundos(p.ini)) : '',
        }));
        if (pausas.length > maxPausas) maxPausas = pausas.length;
        const horas = resumenDia(rows, null).horas_trabajadas;
        total += horas;
        filas.push({ fechaTxt, entrada: entrada.slice(0, 5), salida: salida ? salida.hora.slice(0, 5) : '', pausas, horas });
      }
    }
    return { nombre, filas, total: Math.round(total * 100) / 100 };
  });

  // Cabecera con columnas de pausa dinámicas.
  const cab = ['Empleado', 'Fecha', 'Entrada'];
  for (let k = 1; k <= Math.max(1, maxPausas); k++) {
    const suf = k === 1 ? '' : ' ' + k;
    cab.push(`Pausa${suf} inicio`, `Pausa${suf} fin`, `Duración pausa${suf}`);
  }
  cab.push('Salida', 'Total horas');
  const nPausasCols = Math.max(1, maxPausas);

  const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lineas = [cab.map(cell).join(';')];

  for (const b of bloques) {
    for (const f of b.filas) {
      const fila = [b.nombre, f.fechaTxt];
      if (f.vacio) {
        fila.push('—');                                  // Entrada
        for (let k = 0; k < nPausasCols; k++) fila.push('', '', '');
        fila.push('—', '—');                             // Salida, Total
      } else {
        fila.push(f.entrada || '—');
        for (let k = 0; k < nPausasCols; k++) {
          const p = f.pausas[k];
          fila.push(p ? p.ini : '', p ? p.fin : '', p ? p.dur : '');
        }
        fila.push(f.salida || '—', f.horas.toFixed(2));
      }
      lineas.push(fila.map(cell).join(';'));
    }
    // Fila de totales del periodo para este empleado.
    const tot = [b.nombre, 'TOTAL'];
    for (let k = 0; k < 1 + nPausasCols * 3; k++) tot.push(''); // Entrada + columnas de pausa
    tot.push('', b.total.toFixed(2));                            // Salida vacía + Total
    lineas.push(tot.map(cell).join(';'));
  }

  // Nombre de archivo según el rango de meses.
  const ABBR = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  let sufijo;
  if (meses.length === 12) sufijo = 'completo';
  else if (meses.length === 1) sufijo = ABBR[meses[0] - 1];
  else sufijo = `${ABBR[meses[0] - 1]}-a-${ABBR[meses[meses.length - 1] - 1]}`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="fichajes-${anio}-${sufijo}.csv"`);
  res.write('\uFEFF'); // BOM para que Excel reconozca UTF-8
  res.end(lineas.join('\r\n'));
});

// GET /api/personal/fichajes?empleado_id=&fecha= — fichajes del día.
router.get('/fichajes', (req, res) => {
  const fecha = txt(req.query.fecha) || ahoraLocal().fecha;
  const pedido = aEntero(req.query.empleado_id);

  if (!esAdmin(req)) {
    // No admin: solo sus propios fichajes.
    const propio = empleadoDeUsuario(req);
    if (!propio) return res.status(404).json({ error: 'No tienes una ficha de empleado vinculada' });
    return res.json(fichajesDelDia(propio.id, fecha));
  }

  if (pedido) return res.json(fichajesDelDia(pedido, fecha));

  // Admin sin empleado_id: fichajes de todos para esa fecha.
  const rows = db.prepare(`
    SELECT f.*, e.nombre AS empleado_nombre, e.apellidos AS empleado_apellidos
    FROM fichajes f JOIN empleados e ON e.id = f.empleado_id
    WHERE f.fecha = ? AND e.activo = 1
    ORDER BY e.nombre COLLATE NOCASE, f.hora ASC, f.id ASC
  `).all(fecha);
  res.json(rows);
});

// POST /api/personal/fichajes — registrar fichaje del empleado logueado. Body { tipo, notas? }.
router.post('/fichajes', (req, res) => {
  const emp = empleadoDeUsuario(req);
  if (!emp) return res.status(404).json({ error: 'No tienes una ficha de empleado vinculada' });
  const tipo = txt((req.body || {}).tipo);
  if (!['entrada', 'pausa', 'reanudacion', 'salida'].includes(tipo)) {
    return res.status(400).json({ error: 'Tipo de fichaje no válido' });
  }

  const { fecha, hora } = ahoraLocal();
  const rows = fichajesDelDia(emp.id, fecha);
  const estado = estadoDe(rows);

  // Validaciones según el estado actual.
  if (tipo === 'entrada' && estado !== 'fuera') {
    return res.status(409).json({ error: 'Ya tienes una entrada sin salida' });
  }
  if (tipo === 'pausa' && estado !== 'trabajando') {
    return res.status(409).json({ error: 'No puedes pausar: no estás trabajando' });
  }
  if (tipo === 'reanudacion' && estado !== 'pausa') {
    return res.status(409).json({ error: 'No puedes reanudar: no estás en pausa' });
  }
  if (tipo === 'salida' && estado !== 'trabajando') {
    return res.status(409).json({ error: 'No puedes fichar salida: no estás trabajando' });
  }

  const info = db.prepare(
    'INSERT INTO fichajes (empleado_id, fecha, tipo, hora, notas) VALUES (?, ?, ?, ?, ?)'
  ).run(emp.id, fecha, tipo, hora, txt((req.body || {}).notas));
  const fichaje = db.prepare('SELECT * FROM fichajes WHERE id = ?').get(info.lastInsertRowid);

  const nuevas = fichajesDelDia(emp.id, fecha);
  registrarActividad(db, req.usuario && req.usuario.id, actor(req), 'fichaje', 'empleado', emp.id, `${tipo} ${hora}`);
  res.status(201).json({
    ok: true,
    fichaje,
    estado: estadoDe(nuevas),
    resumen_dia: resumenDia(nuevas, hora),
  });
});

// ============================================================
// Ausencias
// ============================================================
const AUSENCIA_TIPOS = ['vacaciones', 'dia_libre', 'dia_gracia', 'baja_medica', 'asuntos_propios'];

// GET /api/personal/ausencias/calendario?anio=&mes= — ausencias por día del mes.
// (antes de /ausencias/:id)
router.get('/ausencias/calendario', (req, res) => {
  const mes = aEntero(req.query.mes) || (new Date().getMonth() + 1);
  const anio = aEntero(req.query.anio) || new Date().getFullYear();
  const ini = `${anio}-${String(mes).padStart(2, '0')}-01`;
  const finDia = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const fin = `${anio}-${String(mes).padStart(2, '0')}-${String(finDia).padStart(2, '0')}`;

  // Ausencias (no rechazadas) que solapan el mes.
  const rows = db.prepare(`
    SELECT a.*, e.nombre AS empleado_nombre, e.apellidos AS empleado_apellidos
    FROM ausencias a JOIN empleados e ON e.id = a.empleado_id
    WHERE e.activo = 1 AND a.estado <> 'rechazada' AND a.fecha_inicio <= ? AND a.fecha_fin >= ?
  `).all(fin, ini);

  const salida = [];
  for (const a of rows) {
    let d = Math.max(Date.parse(a.fecha_inicio), Date.parse(ini));
    const hasta = Math.min(Date.parse(a.fecha_fin), Date.parse(fin));
    for (; d <= hasta; d += 86400000) {
      const fecha = new Date(d).toISOString().slice(0, 10);
      salida.push({ fecha, empleado_id: a.empleado_id, empleado_nombre: [a.empleado_nombre, a.empleado_apellidos].filter(Boolean).join(' '), tipo: a.tipo });
    }
  }
  res.json(salida);
});

// GET /api/personal/ausencias/saldo?empleado_id=&anio= — días usados/totales.
// (antes de /ausencias/:id)
router.get('/ausencias/saldo', (req, res) => {
  let empId;
  if (esAdmin(req)) {
    empId = aEntero(req.query.empleado_id);
    if (empId === null) return res.status(400).json({ error: 'empleado_id es obligatorio' });
  } else {
    const propio = empleadoDeUsuario(req);
    if (!propio) return res.status(404).json({ error: 'No tienes una ficha de empleado vinculada' });
    empId = propio.id;
  }
  const emp = empleadoPorId(empId);
  if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });
  const anio = aEntero(req.query.anio) || new Date().getFullYear();

  const desglose = {};
  AUSENCIA_TIPOS.forEach((t) => { desglose[t] = 0; });
  const rows = db.prepare(
    "SELECT tipo, SUM(dias) AS d FROM ausencias WHERE empleado_id = ? AND estado = 'aprobada' AND fecha_inicio LIKE ? GROUP BY tipo"
  ).all(empId, anio + '-%');
  rows.forEach((r) => { if (r.tipo in desglose) desglose[r.tipo] = r.d || 0; });

  const total = emp.dias_vacaciones_anio != null ? emp.dias_vacaciones_anio : 30;
  const usados = Object.values(desglose).reduce((s, v) => s + v, 0);
  res.json({ total, usados, pendientes: total - usados, desglose });
});

// GET /api/personal/ausencias?empleado_id=&anio=&tipo= — lista.
router.get('/ausencias', (req, res) => {
  let sql = `
    SELECT a.*, e.nombre AS empleado_nombre, e.apellidos AS empleado_apellidos
    FROM ausencias a JOIN empleados e ON e.id = a.empleado_id WHERE 1 = 1`;
  const params = [];
  if (!esAdmin(req)) {
    const propio = empleadoDeUsuario(req);
    if (!propio) return res.status(404).json({ error: 'No tienes una ficha de empleado vinculada' });
    sql += ' AND a.empleado_id = ?'; params.push(propio.id);
  } else if (req.query.empleado_id) {
    sql += ' AND a.empleado_id = ?'; params.push(aEntero(req.query.empleado_id));
  }
  if (req.query.anio) { sql += ' AND a.fecha_inicio LIKE ?'; params.push(req.query.anio + '-%'); }
  if (req.query.tipo) { sql += ' AND a.tipo = ?'; params.push(req.query.tipo); }
  sql += ' ORDER BY a.fecha_inicio DESC, a.id DESC';
  res.json(db.prepare(sql).all(...params));
});

// POST /api/personal/ausencias — crear. Admin para cualquiera; empleado solo para sí mismo.
router.post('/ausencias', (req, res) => {
  const b = req.body || {};
  const tipo = txt(b.tipo);
  const ini = txt(b.fecha_inicio);
  const fin = txt(b.fecha_fin);
  if (!AUSENCIA_TIPOS.includes(tipo)) return res.status(400).json({ error: 'Tipo de ausencia no válido' });
  if (!ini || !fin) return res.status(400).json({ error: 'fecha_inicio y fecha_fin son obligatorias' });
  if (fin < ini) return res.status(400).json({ error: 'La fecha de fin no puede ser anterior a la de inicio' });

  let empId;
  if (esAdmin(req)) {
    empId = aEntero(b.empleado_id);
    if (empId === null) return res.status(400).json({ error: 'empleado_id es obligatorio' });
    if (!empleadoPorId(empId)) return res.status(400).json({ error: 'El empleado indicado no existe' });
  } else {
    const propio = empleadoDeUsuario(req);
    if (!propio) return res.status(404).json({ error: 'No tienes una ficha de empleado vinculada' });
    if (b.empleado_id != null && aEntero(b.empleado_id) !== propio.id) {
      return res.status(403).json({ error: 'Solo puedes crear ausencias para ti mismo' });
    }
    empId = propio.id;
  }

  const dias = diasLaborables(ini, fin);
  // Empleado: las ausencias quedan pendientes; admin: aprobadas salvo que indique otra cosa.
  let estado = esAdmin(req) ? (txt(b.estado) || 'aprobada') : 'pendiente';
  if (!['pendiente', 'aprobada', 'rechazada'].includes(estado)) estado = 'pendiente';
  const aprobadoPor = estado === 'aprobada' ? actor(req) : txt(b.aprobado_por);

  const info = db.prepare(`
    INSERT INTO ausencias (empleado_id, tipo, fecha_inicio, fecha_fin, dias, estado, aprobado_por, notas)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(empId, tipo, ini, fin, dias, estado, aprobadoPor, txt(b.notas));
  res.status(201).json({ id: info.lastInsertRowid, dias });
});

// PUT /api/personal/ausencias/:id — editar (solo admin).
router.put('/ausencias/:id', (req, res) => {
  if (!esAdmin(req)) return res.status(403).json({ error: 'Solo un administrador puede editar ausencias' });
  const a = db.prepare('SELECT * FROM ausencias WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Ausencia no encontrada' });
  const b = req.body || {};

  const sets = [];
  const vals = {};
  const add = (col, v) => { sets.push(`${col} = @${col}`); vals[col] = v; };

  if ('tipo' in b) {
    if (!AUSENCIA_TIPOS.includes(b.tipo)) return res.status(400).json({ error: 'Tipo de ausencia no válido' });
    add('tipo', b.tipo);
  }
  const ini = 'fecha_inicio' in b ? txt(b.fecha_inicio) : a.fecha_inicio;
  const fin = 'fecha_fin' in b ? txt(b.fecha_fin) : a.fecha_fin;
  if ('fecha_inicio' in b || 'fecha_fin' in b) {
    if (!ini || !fin || fin < ini) return res.status(400).json({ error: 'Rango de fechas no válido' });
    add('fecha_inicio', ini); add('fecha_fin', fin); add('dias', diasLaborables(ini, fin));
  }
  let cambioEstado = null;
  if ('estado' in b) {
    if (!['pendiente', 'aprobada', 'rechazada'].includes(b.estado)) return res.status(400).json({ error: 'estado no válido' });
    add('estado', b.estado); cambioEstado = b.estado;
    add('aprobado_por', b.estado === 'aprobada' ? actor(req) : (txt(b.aprobado_por) || null));
  }
  if ('notas' in b) add('notas', txt(b.notas));

  if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
  vals.id = a.id;
  db.prepare(`UPDATE ausencias SET ${sets.join(', ')} WHERE id = @id`).run(vals);
  if (cambioEstado === 'aprobada' || cambioEstado === 'rechazada') {
    registrarActividad(db, req.usuario && req.usuario.id, actor(req), cambioEstado === 'aprobada' ? 'aprobar' : 'rechazar', 'ausencia', a.id, a.tipo);
  }
  res.json({ ok: true });
});

// DELETE /api/personal/ausencias/:id — eliminar (solo admin).
router.delete('/ausencias/:id', (req, res) => {
  if (!esAdmin(req)) return res.status(403).json({ error: 'Solo un administrador puede eliminar ausencias' });
  const a = db.prepare('SELECT id FROM ausencias WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Ausencia no encontrada' });
  db.prepare('DELETE FROM ausencias WHERE id = ?').run(a.id);
  res.json({ ok: true });
});

// ============================================================
// Horas extra
// ============================================================

// GET /api/personal/horas-extra/resumen?empleado_id=&anio= — totales. (antes de /:id)
router.get('/horas-extra/resumen', (req, res) => {
  let empId;
  if (esAdmin(req)) {
    empId = aEntero(req.query.empleado_id); // null = todos
  } else {
    const propio = empleadoDeUsuario(req);
    if (!propio) return res.status(404).json({ error: 'No tienes una ficha de empleado vinculada' });
    empId = propio.id;
  }
  let where = '1 = 1';
  const params = [];
  if (empId !== null) { where += ' AND empleado_id = ?'; params.push(empId); }
  if (req.query.anio) { where += ' AND fecha LIKE ?'; params.push(req.query.anio + '-%'); }
  const r = db.prepare(`
    SELECT
      COALESCE(SUM(horas), 0) AS total_horas,
      COALESCE(SUM(CASE WHEN pagada = 1 THEN horas ELSE 0 END), 0) AS horas_pagadas,
      COALESCE(SUM(CASE WHEN pagada = 0 THEN horas ELSE 0 END), 0) AS horas_pendientes,
      COALESCE(SUM(CASE WHEN pagada = 1 THEN importe ELSE 0 END), 0) AS total_pagado,
      COALESCE(SUM(CASE WHEN pagada = 0 THEN importe ELSE 0 END), 0) AS total_pendiente
    FROM horas_extra WHERE ${where}
  `).get(...params);
  res.json(r);
});

// GET /api/personal/horas-extra?empleado_id=&anio=&pagada= — lista.
router.get('/horas-extra', (req, res) => {
  let sql = `
    SELECT h.*, e.nombre AS empleado_nombre, e.apellidos AS empleado_apellidos
    FROM horas_extra h JOIN empleados e ON e.id = h.empleado_id WHERE 1 = 1`;
  const params = [];
  if (!esAdmin(req)) {
    const propio = empleadoDeUsuario(req);
    if (!propio) return res.status(404).json({ error: 'No tienes una ficha de empleado vinculada' });
    sql += ' AND h.empleado_id = ?'; params.push(propio.id);
  } else if (req.query.empleado_id) {
    sql += ' AND h.empleado_id = ?'; params.push(aEntero(req.query.empleado_id));
  }
  if (req.query.anio) { sql += ' AND h.fecha LIKE ?'; params.push(req.query.anio + '-%'); }
  if (req.query.pagada !== undefined && req.query.pagada !== '') {
    sql += ' AND h.pagada = ?'; params.push(req.query.pagada == 1 || req.query.pagada === 'true' ? 1 : 0);
  }
  sql += ' ORDER BY h.fecha DESC, h.id DESC';
  res.json(db.prepare(sql).all(...params));
});

// POST /api/personal/horas-extra — el empleado apunta sus propias horas; el admin puede
// registrarlas para cualquier empleado. Acepta horas directas o un rango horario
// (hora_inicio/hora_fin → calcula las horas) y precio_hora (→ importe = horas × precio_hora).
router.post('/horas-extra', (req, res) => {
  const b = req.body || {};
  const admin = esAdmin(req);

  // Empleado destino: admin puede indicar empleado_id; el resto solo el suyo.
  let empId;
  if (admin && b.empleado_id != null && b.empleado_id !== '') {
    empId = aEntero(b.empleado_id);
    if (empId === null || !empleadoPorId(empId)) return res.status(400).json({ error: 'El empleado indicado no existe' });
  } else {
    const emp = empleadoDeUsuario(req);
    if (!emp) return res.status(404).json({ error: 'No tienes una ficha de empleado vinculada' });
    empId = emp.id;
  }

  const fecha = txt(b.fecha);
  if (!fecha) return res.status(400).json({ error: 'La fecha es obligatoria' });

  // Horas: si vienen hora_inicio y hora_fin se calculan; si no, el valor directo.
  const horaIni = txt(b.hora_inicio);
  const horaFin = txt(b.hora_fin);
  let horas = horasDeRango(horaIni, horaFin);
  if (horas === null) horas = (b.horas === '' || b.horas == null ? null : parseFloat(b.horas));
  if (horas === null || isNaN(horas) || horas <= 0) return res.status(400).json({ error: 'Las horas deben ser un número mayor que 0' });

  // Importe: si viene precio_hora → importe = horas × precio_hora; si no, el importe explícito.
  const precioHora = b.precio_hora === '' || b.precio_hora == null ? null : parseFloat(b.precio_hora);
  let importe = null;
  if (precioHora !== null && !isNaN(precioHora)) importe = Math.round(horas * precioHora * 100) / 100;
  else if (b.importe !== '' && b.importe != null) importe = parseFloat(b.importe);

  // Pago: solo el admin puede marcar las horas como pagadas al registrarlas.
  const pagada = admin && b.pagada ? 1 : 0;
  const fechaPago = pagada ? (txt(b.fecha_pago) || ahoraLocal().fecha) : null;

  const info = db.prepare(`
    INSERT INTO horas_extra (empleado_id, fecha, horas, descripcion, hora_inicio, hora_fin, importe, pagada, fecha_pago, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(empId, fecha, horas, txt(b.descripcion), horaIni, horaFin, importe, pagada, fechaPago, req.usuario && req.usuario.username);
  res.status(201).json({ id: info.lastInsertRowid });
});

// PUT /api/personal/horas-extra/:id — admin: pago; empleado: solo las suyas no pagadas.
router.put('/horas-extra/:id', (req, res) => {
  const h = db.prepare('SELECT * FROM horas_extra WHERE id = ?').get(req.params.id);
  if (!h) return res.status(404).json({ error: 'Registro no encontrado' });
  const b = req.body || {};
  const sets = [];
  const vals = {};
  const add = (col, v) => { sets.push(`${col} = @${col}`); vals[col] = v; };

  // Resuelve las horas finales: rango horario (hora_inicio/hora_fin) tiene prioridad sobre
  // el valor directo. Devuelve { horas, error }. horas null = no se tocan.
  function resolverHoras() {
    if ('hora_inicio' in b) add('hora_inicio', txt(b.hora_inicio));
    if ('hora_fin' in b) add('hora_fin', txt(b.hora_fin));
    if (b.hora_inicio && b.hora_fin) {
      const hr = horasDeRango(txt(b.hora_inicio), txt(b.hora_fin));
      if (hr === null) return { error: 'Rango horario no válido' };
      add('horas', hr);
      return { horas: hr };
    }
    if ('horas' in b) {
      const n = parseFloat(b.horas);
      if (isNaN(n) || n <= 0) return { error: 'Horas no válidas' };
      add('horas', n);
      return { horas: n };
    }
    return { horas: null };
  }

  if (esAdmin(req)) {
    if ('fecha' in b) add('fecha', txt(b.fecha));
    const rh = resolverHoras();
    if (rh.error) return res.status(400).json({ error: rh.error });
    if ('descripcion' in b) add('descripcion', txt(b.descripcion));
    if ('pagada' in b) add('pagada', b.pagada ? 1 : 0);
    // Importe: precio_hora → importe = horas × precio_hora (sobre las horas resultantes);
    // si no, el importe explícito.
    const precioHora = b.precio_hora === '' || b.precio_hora == null ? null : parseFloat(b.precio_hora);
    if (precioHora !== null && !isNaN(precioHora)) {
      const baseHoras = rh.horas != null ? rh.horas : h.horas;
      add('importe', Math.round((baseHoras || 0) * precioHora * 100) / 100);
    } else if ('importe' in b) {
      add('importe', b.importe === '' || b.importe == null ? null : parseFloat(b.importe));
    }
    if ('fecha_pago' in b) add('fecha_pago', txt(b.fecha_pago));
  } else {
    const propio = empleadoDeUsuario(req);
    if (!propio || h.empleado_id !== propio.id) return res.status(403).json({ error: 'No puedes editar este registro' });
    if (h.pagada) return res.status(403).json({ error: 'No puedes editar una hora extra ya pagada' });
    if ('pagada' in b || 'importe' in b || 'precio_hora' in b || 'fecha_pago' in b) {
      return res.status(403).json({ error: 'Solo un administrador puede gestionar el pago' });
    }
    if ('fecha' in b) add('fecha', txt(b.fecha));
    const rh = resolverHoras();
    if (rh.error) return res.status(400).json({ error: rh.error });
    if ('descripcion' in b) add('descripcion', txt(b.descripcion));
  }
  if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
  vals.id = h.id;
  db.prepare(`UPDATE horas_extra SET ${sets.join(', ')} WHERE id = @id`).run(vals);
  res.json({ ok: true });
});

// DELETE /api/personal/horas-extra/:id — admin, o el propio empleado si no está pagada.
router.delete('/horas-extra/:id', (req, res) => {
  const h = db.prepare('SELECT * FROM horas_extra WHERE id = ?').get(req.params.id);
  if (!h) return res.status(404).json({ error: 'Registro no encontrado' });
  if (!esAdmin(req)) {
    const propio = empleadoDeUsuario(req);
    if (!propio || h.empleado_id !== propio.id) return res.status(403).json({ error: 'No puedes eliminar este registro' });
    if (h.pagada) return res.status(403).json({ error: 'No puedes eliminar una hora extra ya pagada' });
  }
  db.prepare('DELETE FROM horas_extra WHERE id = ?').run(h.id);
  res.json({ ok: true });
});

// ============================================================
// Resumen del día (dashboard de admin)
// ============================================================
// GET /api/personal/resumen-dia?fecha= — panorama del día para el administrador.
router.get('/resumen-dia', (req, res) => {
  if (!esAdmin(req)) return res.status(403).json({ error: 'Solo disponible para administradores' });
  const fecha = txt(req.query.fecha) || ahoraLocal().fecha;
  const ahora = ahoraLocal();
  const horaCap = (fecha === ahora.fecha) ? ahora.hora : null;

  // Empleados con algún fichaje ese día.
  const empleados = db.prepare(`
    SELECT DISTINCT e.id, e.nombre, e.apellidos
    FROM empleados e JOIN fichajes f ON f.empleado_id = e.id
    WHERE f.fecha = ? AND e.activo = 1 ORDER BY e.nombre COLLATE NOCASE
  `).all(fecha);

  let enPausa = 0, fichados = 0;
  const fichajes = empleados.map((e) => {
    const rows = fichajesDelDia(e.id, fecha);
    const estado = estadoDe(rows);
    const r = resumenDia(rows, horaCap);
    if (estado === 'pausa') enPausa++;
    if (estado === 'trabajando' || estado === 'pausa') fichados++;
    return {
      empleado_id: e.id,
      empleado_nombre: [e.nombre, e.apellidos].filter(Boolean).join(' '),
      entrada: hhmm(r.entrada),
      salida: hhmm(r.salida),
      estado,
      horas: r.horas_trabajadas,
      pausas: pausasDe(rows),
    };
  });

  // Ausentes hoy: ausencias aprobadas que cubren la fecha.
  const ausentes = db.prepare(`
    SELECT e.nombre AS nombre, e.apellidos AS apellidos, a.tipo AS tipo
    FROM ausencias a JOIN empleados e ON e.id = a.empleado_id
    WHERE e.activo = 1 AND a.estado = 'aprobada' AND a.fecha_inicio <= ? AND a.fecha_fin >= ?
    ORDER BY e.nombre COLLATE NOCASE
  `).all(fecha, fecha).map((a) => ({ empleado_nombre: [a.nombre, a.apellidos].filter(Boolean).join(' '), tipo: a.tipo }));

  res.json({
    empleados_fichados: fichados,
    en_pausa: enPausa,
    ausentes_hoy: ausentes,
    fichajes,
  });
});

module.exports = router;
