// API REST del módulo de Tarifas: temporadas de precios por año, modificadores por tipo
// de clasificación, descuentos condicionados y cálculo de precio de una estancia.
// Montado bajo requireAuth, así que req.usuario = { id, nombre, username, rol }.
const express = require('express');
const db = require('../db/database');
const { registrarActividad } = require('../services/actividadService');

const router = express.Router();

// --- Helpers de coerción (better-sqlite3 lanza al hacer bind de undefined) ---
function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function intOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}
function txt(v) { return v === undefined || v === null || v === '' ? null : String(v); }
function r2(n) { return Math.round(n * 100) / 100; }
function fechaISO(v) {
  const s = String(v || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
// Normaliza un array (tipos/portales) a JSON o null (null = aplica a todos).
function jsonArrayONull(v) {
  if (v === undefined || v === null || v === '') return null;
  if (Array.isArray(v)) return v.length ? JSON.stringify(v.map(String)) : null;
  if (typeof v === 'string') {
    try { const a = JSON.parse(v); return Array.isArray(a) && a.length ? JSON.stringify(a.map(String)) : null; }
    catch (e) { return null; }
  }
  return null;
}
function log(req, accion, entidad, id, detalle) {
  registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, accion, entidad, id, detalle);
}

// ==================== Temporadas ====================

// Valida el cuerpo de una temporada. Devuelve { error } o { ok, datos }.
function validarTemporada(body, excluirId) {
  const b = body || {};
  const nombre = String(b.nombre || '').trim();
  if (!nombre) return { error: 'El nombre es obligatorio' };
  const fecha_inicio = fechaISO(b.fecha_inicio);
  const fecha_fin = fechaISO(b.fecha_fin);
  if (!fecha_inicio || !fecha_fin) return { error: 'Las fechas son obligatorias (YYYY-MM-DD)' };
  if (!(fecha_inicio < fecha_fin)) return { error: 'La fecha de inicio debe ser anterior a la de fin' };
  let anio = intOrNull(b.anio);
  if (anio === null) anio = parseInt(fecha_inicio.slice(0, 4), 10);
  const precio_base_noche = num(b.precio_base_noche);
  if (precio_base_noche <= 0) return { error: 'El precio base por noche debe ser mayor que 0' };

  // Solape con otra temporada del mismo año (intervalos inclusivos por ambos extremos).
  let sql = 'SELECT nombre FROM temporadas WHERE anio = ? AND fecha_inicio <= ? AND fecha_fin >= ?';
  const params = [anio, fecha_fin, fecha_inicio];
  if (excluirId != null) { sql += ' AND id != ?'; params.push(excluirId); }
  const solapa = db.prepare(sql).get(...params);
  if (solapa) return { conflicto: `Las fechas se solapan con la temporada "${solapa.nombre}"` };

  return {
    ok: true,
    datos: {
      nombre, anio, fecha_inicio, fecha_fin, precio_base_noche,
      color: txt(b.color) || '#3b82f6',
      orden: intOrNull(b.orden) != null ? intOrNull(b.orden) : 0,
    },
  };
}

// GET /api/tarifas/temporadas?anio=2026
router.get('/temporadas', (req, res) => {
  const anio = intOrNull(req.query.anio) || new Date().getFullYear();
  res.json(db.prepare('SELECT * FROM temporadas WHERE anio = ? ORDER BY fecha_inicio').all(anio));
});

// POST /api/tarifas/temporadas/copiar — body { anio_origen, anio_destino }.
// Copia todas las temporadas de un año a otro cambiando solo el año en las fechas.
// Declarado ANTES de /temporadas/:id por claridad de prefijos.
router.post('/temporadas/copiar', (req, res) => {
  const b = req.body || {};
  const origen = intOrNull(b.anio_origen);
  const destino = intOrNull(b.anio_destino);
  if (origen === null || destino === null) return res.status(400).json({ error: 'anio_origen y anio_destino son obligatorios' });
  if (origen === destino) return res.status(400).json({ error: 'El año de origen y destino no pueden ser el mismo' });

  const existentes = db.prepare('SELECT COUNT(*) AS c FROM temporadas WHERE anio = ?').get(destino).c;
  if (existentes > 0) {
    return res.status(409).json({ error: `El año ${destino} ya tiene temporadas definidas. Elimínalas primero` });
  }
  const origenes = db.prepare('SELECT * FROM temporadas WHERE anio = ? ORDER BY fecha_inicio').all(origen);
  if (!origenes.length) return res.status(400).json({ error: `El año ${origen} no tiene temporadas que copiar` });

  // Cambia el año de una fecha ISO; 29 de febrero pasa a 28 si el destino no es bisiesto.
  const esBisiesto = (a) => (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0;
  const cambiarAnio = (fecha) => {
    let resto = fecha.slice(4);
    if (resto === '-02-29' && !esBisiesto(destino)) resto = '-02-28';
    return destino + resto;
  };

  const copiar = db.transaction(() => {
    const ins = db.prepare(`
      INSERT INTO temporadas (nombre, anio, fecha_inicio, fecha_fin, precio_base_noche, color, orden)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const t of origenes) {
      ins.run(t.nombre, destino, cambiarAnio(t.fecha_inicio), cambiarAnio(t.fecha_fin), t.precio_base_noche, t.color, t.orden);
    }
  });
  copiar();
  log(req, 'crear', 'temporada', null, `Copiadas ${origenes.length} temporada(s) de ${origen} a ${destino}`);
  res.status(201).json({ ok: true, copiadas: origenes.length });
});

// POST /api/tarifas/temporadas
router.post('/temporadas', (req, res) => {
  const v = validarTemporada(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  if (v.conflicto) return res.status(409).json({ error: v.conflicto });
  const d = v.datos;
  const info = db.prepare(`
    INSERT INTO temporadas (nombre, anio, fecha_inicio, fecha_fin, precio_base_noche, color, orden)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(d.nombre, d.anio, d.fecha_inicio, d.fecha_fin, d.precio_base_noche, d.color, d.orden);
  log(req, 'crear', 'temporada', info.lastInsertRowid, `${d.nombre} ${d.anio}`);
  res.status(201).json({ id: info.lastInsertRowid });
});

// PUT /api/tarifas/temporadas/:id
router.put('/temporadas/:id', (req, res) => {
  const id = Number(req.params.id);
  const existe = db.prepare('SELECT id FROM temporadas WHERE id = ?').get(id);
  if (!existe) return res.status(404).json({ error: 'Temporada no encontrada' });
  const v = validarTemporada(req.body, id);
  if (v.error) return res.status(400).json({ error: v.error });
  if (v.conflicto) return res.status(409).json({ error: v.conflicto });
  const d = v.datos;
  db.prepare(`
    UPDATE temporadas SET nombre = ?, anio = ?, fecha_inicio = ?, fecha_fin = ?,
      precio_base_noche = ?, color = ?, orden = ?
    WHERE id = ?
  `).run(d.nombre, d.anio, d.fecha_inicio, d.fecha_fin, d.precio_base_noche, d.color, d.orden, id);
  log(req, 'editar', 'temporada', id, `${d.nombre} ${d.anio}`);
  res.json({ ok: true });
});

// DELETE /api/tarifas/temporadas/:id
router.delete('/temporadas/:id', (req, res) => {
  const t = db.prepare('SELECT nombre, anio FROM temporadas WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Temporada no encontrada' });
  db.prepare('DELETE FROM temporadas WHERE id = ?').run(req.params.id);
  log(req, 'eliminar', 'temporada', req.params.id, `${t.nombre} ${t.anio}`);
  res.json({ ok: true });
});

// ==================== Modificadores por tipo ====================

// GET /api/tarifas/modificadores
router.get('/modificadores', (req, res) => {
  res.json(db.prepare('SELECT * FROM tipo_modificadores ORDER BY orden').all());
});

// PUT /api/tarifas/modificadores/:id — solo el porcentaje. El tipo A es la referencia (0%).
router.put('/modificadores/:id', (req, res) => {
  const m = db.prepare('SELECT * FROM tipo_modificadores WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Modificador no encontrado' });
  if (m.tipo === 'A') return res.status(400).json({ error: 'El tipo A es la referencia y su porcentaje es siempre 0' });
  const porcentaje = num((req.body || {}).porcentaje);
  db.prepare('UPDATE tipo_modificadores SET porcentaje = ? WHERE id = ?').run(porcentaje, req.params.id);
  log(req, 'editar', 'tipo_modificador', req.params.id, `${m.tipo}: ${porcentaje}%`);
  res.json({ ok: true });
});

// ==================== Temporadas propietario (tabla de referencia informativa) ====================
// Independiente del sistema de Particular (temporadas/tipo_modificadores): sirve solo para
// decirle a un propietario con contrato "sin garantía" cuánto percibiría en tal temporada.
// No interviene en /calcular ni en la creación de reservas.

// Valida el cuerpo de una temporada propietario. Devuelve { error } o { ok, datos }.
function validarTemporadaPropietario(body, excluirId) {
  const b = body || {};
  const nombre = String(b.nombre || '').trim();
  if (!nombre) return { error: 'El nombre es obligatorio' };
  const fecha_inicio = fechaISO(b.fecha_inicio);
  const fecha_fin = fechaISO(b.fecha_fin);
  if (!fecha_inicio || !fecha_fin) return { error: 'Las fechas son obligatorias (YYYY-MM-DD)' };
  if (!(fecha_inicio < fecha_fin)) return { error: 'La fecha de inicio debe ser anterior a la de fin' };
  let anio = intOrNull(b.anio);
  if (anio === null) anio = parseInt(fecha_inicio.slice(0, 4), 10);
  const precio_base_semana = num(b.precio_base_semana);
  if (precio_base_semana <= 0) return { error: 'El precio base por semana debe ser mayor que 0' };

  // Solape con otra temporada propietario del mismo año (intervalos inclusivos por ambos extremos).
  let sql = 'SELECT nombre FROM temporadas_propietario WHERE anio = ? AND fecha_inicio <= ? AND fecha_fin >= ?';
  const params = [anio, fecha_fin, fecha_inicio];
  if (excluirId != null) { sql += ' AND id != ?'; params.push(excluirId); }
  const solapa = db.prepare(sql).get(...params);
  if (solapa) return { conflicto: `Las fechas se solapan con la temporada "${solapa.nombre}"` };

  return {
    ok: true,
    datos: {
      nombre, anio, fecha_inicio, fecha_fin, precio_base_semana,
      orden: intOrNull(b.orden) != null ? intOrNull(b.orden) : 0,
    },
  };
}

// GET /api/tarifas/temporadas-propietario?anio=2026
router.get('/temporadas-propietario', (req, res) => {
  const anio = intOrNull(req.query.anio) || new Date().getFullYear();
  res.json(db.prepare('SELECT * FROM temporadas_propietario WHERE anio = ? ORDER BY fecha_inicio').all(anio));
});

// POST /api/tarifas/temporadas-propietario/copiar — body { anio_origen, anio_destino }.
// Declarado ANTES de /temporadas-propietario/:id por claridad de prefijos.
router.post('/temporadas-propietario/copiar', (req, res) => {
  const b = req.body || {};
  const origen = intOrNull(b.anio_origen);
  const destino = intOrNull(b.anio_destino);
  if (origen === null || destino === null) return res.status(400).json({ error: 'anio_origen y anio_destino son obligatorios' });
  if (origen === destino) return res.status(400).json({ error: 'El año de origen y destino no pueden ser el mismo' });

  const existentes = db.prepare('SELECT COUNT(*) AS c FROM temporadas_propietario WHERE anio = ?').get(destino).c;
  if (existentes > 0) {
    return res.status(409).json({ error: `El año ${destino} ya tiene temporadas de propietario definidas. Elimínalas primero` });
  }
  const origenes = db.prepare('SELECT * FROM temporadas_propietario WHERE anio = ? ORDER BY fecha_inicio').all(origen);
  if (!origenes.length) return res.status(400).json({ error: `El año ${origen} no tiene temporadas de propietario que copiar` });

  // Cambia el año de una fecha ISO; 29 de febrero pasa a 28 si el destino no es bisiesto.
  const esBisiesto = (a) => (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0;
  const cambiarAnio = (fecha) => {
    let resto = fecha.slice(4);
    if (resto === '-02-29' && !esBisiesto(destino)) resto = '-02-28';
    return destino + resto;
  };

  const copiar = db.transaction(() => {
    const ins = db.prepare(`
      INSERT INTO temporadas_propietario (nombre, anio, fecha_inicio, fecha_fin, precio_base_semana, orden)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const t of origenes) {
      ins.run(t.nombre, destino, cambiarAnio(t.fecha_inicio), cambiarAnio(t.fecha_fin), t.precio_base_semana, t.orden);
    }
  });
  copiar();
  log(req, 'crear', 'temporada-propietario', null, `Copiadas ${origenes.length} temporada(s) de ${origen} a ${destino}`);
  res.status(201).json({ ok: true, copiadas: origenes.length });
});

// POST /api/tarifas/temporadas-propietario
router.post('/temporadas-propietario', (req, res) => {
  const v = validarTemporadaPropietario(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  if (v.conflicto) return res.status(409).json({ error: v.conflicto });
  const d = v.datos;
  const info = db.prepare(`
    INSERT INTO temporadas_propietario (nombre, anio, fecha_inicio, fecha_fin, precio_base_semana, orden)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(d.nombre, d.anio, d.fecha_inicio, d.fecha_fin, d.precio_base_semana, d.orden);
  log(req, 'crear', 'temporada-propietario', info.lastInsertRowid, `${d.nombre} ${d.anio}`);
  res.status(201).json({ id: info.lastInsertRowid });
});

// PUT /api/tarifas/temporadas-propietario/:id
router.put('/temporadas-propietario/:id', (req, res) => {
  const id = Number(req.params.id);
  const existe = db.prepare('SELECT id FROM temporadas_propietario WHERE id = ?').get(id);
  if (!existe) return res.status(404).json({ error: 'Temporada de propietario no encontrada' });
  const v = validarTemporadaPropietario(req.body, id);
  if (v.error) return res.status(400).json({ error: v.error });
  if (v.conflicto) return res.status(409).json({ error: v.conflicto });
  const d = v.datos;
  db.prepare(`
    UPDATE temporadas_propietario SET nombre = ?, anio = ?, fecha_inicio = ?, fecha_fin = ?,
      precio_base_semana = ?, orden = ?
    WHERE id = ?
  `).run(d.nombre, d.anio, d.fecha_inicio, d.fecha_fin, d.precio_base_semana, d.orden, id);
  log(req, 'editar', 'temporada-propietario', id, `${d.nombre} ${d.anio}`);
  res.json({ ok: true });
});

// DELETE /api/tarifas/temporadas-propietario/:id
router.delete('/temporadas-propietario/:id', (req, res) => {
  const t = db.prepare('SELECT nombre, anio FROM temporadas_propietario WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Temporada de propietario no encontrada' });
  db.prepare('DELETE FROM temporadas_propietario WHERE id = ?').run(req.params.id);
  log(req, 'eliminar', 'temporada-propietario', req.params.id, `${t.nombre} ${t.anio}`);
  res.json({ ok: true });
});

// ==================== Modificadores propietario por tipo ====================

// GET /api/tarifas/modificadores-propietario
router.get('/modificadores-propietario', (req, res) => {
  res.json(db.prepare('SELECT * FROM tipo_modificadores_propietario ORDER BY orden').all());
});

// PUT /api/tarifas/modificadores-propietario/:id — solo el porcentaje. El tipo A es la referencia (0%).
router.put('/modificadores-propietario/:id', (req, res) => {
  const m = db.prepare('SELECT * FROM tipo_modificadores_propietario WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Modificador no encontrado' });
  if (m.tipo === 'A') return res.status(400).json({ error: 'El tipo A es la referencia y su porcentaje es siempre 0' });
  const porcentaje = num((req.body || {}).porcentaje);
  db.prepare('UPDATE tipo_modificadores_propietario SET porcentaje = ? WHERE id = ?').run(porcentaje, req.params.id);
  log(req, 'editar', 'tipo_modificador_propietario', req.params.id, `${m.tipo}: ${porcentaje}%`);
  res.json({ ok: true });
});

// ==================== Descuentos ====================

// Valida el cuerpo de un descuento. Devuelve { error } o { ok, datos }.
function validarDescuento(body) {
  const b = body || {};
  const nombre = String(b.nombre || '').trim();
  if (!nombre) return { error: 'El nombre es obligatorio' };
  const porcentaje = num(b.porcentaje);
  if (porcentaje <= 0 || porcentaje > 100) return { error: 'El porcentaje debe estar entre 0 y 100' };
  const fecha_inicio = fechaISO(b.fecha_inicio);
  const fecha_fin = fechaISO(b.fecha_fin);
  if (!fecha_inicio || !fecha_fin) return { error: 'Las fechas son obligatorias (YYYY-MM-DD)' };
  if (!(fecha_inicio <= fecha_fin)) return { error: 'La fecha de inicio debe ser anterior o igual a la de fin' };
  let anio = intOrNull(b.anio);
  if (anio === null) anio = parseInt(fecha_inicio.slice(0, 4), 10);
  let min_noches = intOrNull(b.min_noches);
  if (min_noches === null || min_noches < 0) min_noches = 0;
  return {
    ok: true,
    datos: {
      nombre, porcentaje, fecha_inicio, fecha_fin, anio, min_noches,
      tipos: jsonArrayONull(b.tipos),
      portales: jsonArrayONull(b.portales),
      activo: (b.activo === undefined || b.activo === null) ? 1 : (b.activo ? 1 : 0),
      notas: txt(b.notas),
    },
  };
}

// GET /api/tarifas/descuentos?anio=2026
router.get('/descuentos', (req, res) => {
  const anio = intOrNull(req.query.anio) || new Date().getFullYear();
  res.json(db.prepare('SELECT * FROM descuentos WHERE anio = ? ORDER BY fecha_inicio').all(anio));
});

// POST /api/tarifas/descuentos
router.post('/descuentos', (req, res) => {
  const v = validarDescuento(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  const d = v.datos;
  const info = db.prepare(`
    INSERT INTO descuentos (nombre, porcentaje, fecha_inicio, fecha_fin, anio, min_noches, tipos, portales, activo, notas)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(d.nombre, d.porcentaje, d.fecha_inicio, d.fecha_fin, d.anio, d.min_noches, d.tipos, d.portales, d.activo, d.notas);
  log(req, 'crear', 'descuento', info.lastInsertRowid, `${d.nombre} (${d.porcentaje}%)`);
  res.status(201).json({ id: info.lastInsertRowid });
});

// PUT /api/tarifas/descuentos/:id
router.put('/descuentos/:id', (req, res) => {
  const id = Number(req.params.id);
  const existe = db.prepare('SELECT id FROM descuentos WHERE id = ?').get(id);
  if (!existe) return res.status(404).json({ error: 'Descuento no encontrado' });
  const v = validarDescuento(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  const d = v.datos;
  db.prepare(`
    UPDATE descuentos SET nombre = ?, porcentaje = ?, fecha_inicio = ?, fecha_fin = ?, anio = ?,
      min_noches = ?, tipos = ?, portales = ?, activo = ?, notas = ?
    WHERE id = ?
  `).run(d.nombre, d.porcentaje, d.fecha_inicio, d.fecha_fin, d.anio, d.min_noches, d.tipos, d.portales, d.activo, d.notas, id);
  log(req, 'editar', 'descuento', id, `${d.nombre} (${d.porcentaje}%)`);
  res.json({ ok: true });
});

// DELETE /api/tarifas/descuentos/:id
router.delete('/descuentos/:id', (req, res) => {
  const d = db.prepare('SELECT nombre FROM descuentos WHERE id = ?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Descuento no encontrado' });
  db.prepare('DELETE FROM descuentos WHERE id = ?').run(req.params.id);
  log(req, 'eliminar', 'descuento', req.params.id, d.nombre);
  res.json({ ok: true });
});

// ==================== Cálculo de precio ====================

// Suma días a una fecha ISO (aritmética en UTC para evitar saltos por DST).
function sumarDias(fecha, dias) {
  const d = new Date(fecha + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// Extras obligatorios del catálogo (activos) para `noches` noches. tipo_precio 'noche' multiplica.
function extrasObligatorios(noches) {
  const obligatorios = db.prepare(
    'SELECT * FROM catalogo_extras WHERE obligatorio = 1 AND activo = 1 ORDER BY nombre COLLATE NOCASE'
  ).all();
  const extras_obligatorios = obligatorios.map((e) => ({
    nombre: e.nombre,
    precio: r2(e.precio),
    cantidad: 1,
    importe: r2(e.precio * (e.tipo_precio === 'noche' ? noches : 1)),
  }));
  const total_extras_obligatorios = r2(extras_obligatorios.reduce((s, e) => s + e.importe, 0));
  return { extras_obligatorios, total_extras_obligatorios };
}

// Nº de días entre dos fechas ISO, ambos extremos incluidos (para un tramo cerrado "inicio a fin").
function diasInclusive(fechaInicio, fechaFin) {
  const a = new Date(fechaInicio + 'T00:00:00Z');
  const b = new Date(fechaFin + 'T00:00:00Z');
  return Math.round((b - a) / 86400000) + 1;
}

// Rama de /calcular para portales de mayorista: precio derivado de las partidas del contrato
// anual del mayorista (mayorista_contrato_partidas), en vez de temporadas/modificadores.
function calcularTarifaMayorista(req, res, { entrada, salida, tipoApto, mayoristaId }) {
  const mayorista = db.prepare('SELECT id, nombre FROM mayoristas WHERE id = ?').get(mayoristaId);
  const anioEntrada = parseInt(entrada.slice(0, 4), 10);
  const contrato = db.prepare('SELECT id FROM mayorista_contratos WHERE mayorista_id = ? AND anio = ?')
    .get(mayoristaId, anioEntrada);
  if (!contrato) {
    return res.status(400).json({ ok: false, error: `No hay contrato de mayorista configurado para ${mayorista.nombre} en ${anioEntrada}` });
  }

  const nochesReserva = [];
  for (let fecha = entrada; fecha < salida; fecha = sumarDias(fecha, 1)) nochesReserva.push(fecha);
  const ultimaNocheReserva = nochesReserva[nochesReserva.length - 1];

  const partidaId = intOrNull(req.query.partida_id);
  let partida = null;
  if (partidaId !== null) {
    const p = db.prepare('SELECT * FROM mayorista_contrato_partidas WHERE id = ? AND contrato_id = ?').get(partidaId, contrato.id);
    if (p && p.tipo_clasificacion === tipoApto && p.fecha_inicio <= entrada && p.fecha_fin >= ultimaNocheReserva) {
      partida = p;
    }
  }
  if (!partida) {
    const candidatas = db.prepare(`
      SELECT * FROM mayorista_contrato_partidas
      WHERE contrato_id = ? AND tipo_clasificacion = ? AND fecha_inicio <= ? AND fecha_fin >= ?
      ORDER BY fecha_inicio
    `).all(contrato.id, tipoApto, entrada, ultimaNocheReserva);
    if (!candidatas.length) {
      return res.status(400).json({
        ok: false,
        error: `No hay ninguna partida configurada para el tipo ${tipoApto} en estas fechas, dentro del contrato de ${mayorista.nombre}`,
      });
    }
    if (candidatas.length > 1) {
      return res.json({
        ok: false,
        requiere_partida: true,
        tipo: tipoApto,
        opciones: candidatas.map((c) => ({
          id: c.id, nombre: c.nombre, importe_total: c.importe_total,
          fecha_inicio: c.fecha_inicio, fecha_fin: c.fecha_fin, num_apartamentos: c.num_apartamentos,
        })),
      });
    }
    partida = candidatas[0];
  }

  const noches_bloque = diasInclusive(partida.fecha_inicio, partida.fecha_fin);
  const precio_noche = r2(partida.importe_total / noches_bloque);
  const noches_reserva = nochesReserva.length;
  const precio_total_bloque = r2(precio_noche * noches_reserva);

  const desglose = nochesReserva.map((fecha) => ({
    fecha,
    temporada: partida.nombre || 'Mayorista',
    precio_base: precio_noche,
    modificador: 0,
    precio_final: precio_noche,
  }));

  const { extras_obligatorios, total_extras_obligatorios } = extrasObligatorios(noches_reserva);

  res.json({
    desglose,
    subtotal: precio_total_bloque,
    descuentos_aplicados: [],
    total_descuentos: 0,
    extras_obligatorios,
    total_extras_obligatorios,
    precio_total: r2(precio_total_bloque + total_extras_obligatorios),
  });
}

// GET /api/tarifas/calcular?apartamento_id=X&entrada=YYYY-MM-DD&salida=YYYY-MM-DD&portal=Booking.com
// Precio noche a noche: temporada (precio base del Tipo A) + modificador del tipo del
// apartamento, menos descuentos aplicables, más extras obligatorios del catálogo.
router.get('/calcular', (req, res) => {
  const apartamentoId = intOrNull(req.query.apartamento_id);
  const entrada = fechaISO(req.query.entrada);
  const salida = fechaISO(req.query.salida);
  const portal = String(req.query.portal || '').trim();
  if (apartamentoId === null) return res.status(400).json({ ok: false, error: 'apartamento_id es obligatorio' });
  if (!entrada || !salida) return res.status(400).json({ ok: false, error: 'entrada y salida son obligatorias (YYYY-MM-DD)' });
  if (!(entrada < salida)) return res.status(400).json({ ok: false, error: 'La entrada debe ser anterior a la salida' });

  const apto = db.prepare('SELECT id, tipo_clasificacion FROM apartamentos WHERE id = ?').get(apartamentoId);
  if (!apto) return res.status(404).json({ ok: false, error: 'Apartamento no encontrado' });

  const tipoApto = apto.tipo_clasificacion || 'A';

  // Portal de mayorista: precio derivado de las partidas del contrato anual, no de temporadas.
  if (portal) {
    const portalRow = db.prepare('SELECT mayorista_id FROM portales WHERE nombre = ?').get(portal);
    if (portalRow && portalRow.mayorista_id) {
      return calcularTarifaMayorista(req, res, { apartamentoId, entrada, salida, tipoApto, mayoristaId: portalRow.mayorista_id });
    }
  }

  // Modificador del tipo del apartamento (sin clasificación o tipo desconocido -> 0%, como el A).
  const mod = db.prepare('SELECT porcentaje FROM tipo_modificadores WHERE tipo = ?').get(tipoApto);
  const modificador = mod ? Number(mod.porcentaje) : 0;

  // Temporadas que tocan el rango de la estancia (puede cruzar de año).
  const temporadas = db.prepare(
    'SELECT * FROM temporadas WHERE fecha_fin >= ? AND fecha_inicio < ? ORDER BY fecha_inicio'
  ).all(entrada, salida);

  // Noche a noche: entrada .. salida-1.
  const desglose = [];
  let subtotal = 0;
  for (let fecha = entrada; fecha < salida; fecha = sumarDias(fecha, 1)) {
    const t = temporadas.find((x) => x.fecha_inicio <= fecha && fecha <= x.fecha_fin);
    if (!t) {
      return res.status(400).json({ ok: false, error: `La fecha ${fecha} no tiene tarifa definida` });
    }
    const precio_final = r2(t.precio_base_noche * (1 + modificador / 100));
    desglose.push({
      fecha,
      temporada: t.nombre,
      precio_base: r2(t.precio_base_noche),
      modificador,
      precio_final,
    });
    subtotal += precio_final;
  }
  subtotal = r2(subtotal);
  const noches = desglose.length;
  const ultimaNoche = desglose[desglose.length - 1].fecha;

  // Descuentos activos que cubren TODAS las noches y cuyas condiciones se cumplen.
  const candidatos = db.prepare(
    'SELECT * FROM descuentos WHERE activo = 1 AND fecha_inicio <= ? AND fecha_fin >= ?'
  ).all(entrada, ultimaNoche);
  const descuentos_aplicados = [];
  let total_descuentos = 0;
  for (const d of candidatos) {
    if (d.min_noches && noches < d.min_noches) continue;
    if (d.tipos) {
      try { if (!JSON.parse(d.tipos).includes(tipoApto)) continue; } catch (e) { /* JSON corrupto -> aplica */ }
    }
    if (d.portales) {
      try { if (!portal || !JSON.parse(d.portales).includes(portal)) continue; } catch (e) { /* idem */ }
    }
    const importe = r2(subtotal * d.porcentaje / 100);
    descuentos_aplicados.push({ nombre: d.nombre, porcentaje: d.porcentaje, importe });
    total_descuentos += importe;
  }
  total_descuentos = r2(total_descuentos);

  // Extras obligatorios del catálogo (activos). tipo_precio 'noche' multiplica por noches.
  const { extras_obligatorios, total_extras_obligatorios } = extrasObligatorios(noches);

  res.json({
    desglose,
    subtotal,
    descuentos_aplicados,
    total_descuentos,
    extras_obligatorios,
    total_extras_obligatorios,
    precio_total: r2(subtotal - total_descuentos + total_extras_obligatorios),
  });
});

// GET /api/tarifas/calcular-propietario?anio=2026
// Tabla de referencia informativa: para cada temporada_propietario del año, el precio por
// semana resultante en cada tipo (A/A+/A++/B/B+/C). No es una consulta de una estancia
// concreta (no hay apartamento/entrada/salida) — es la tabla completa del año.
router.get('/calcular-propietario', (req, res) => {
  const anio = intOrNull(req.query.anio) || new Date().getFullYear();
  const temporadas = db.prepare('SELECT * FROM temporadas_propietario WHERE anio = ? ORDER BY fecha_inicio').all(anio);
  const modificadores = db.prepare('SELECT * FROM tipo_modificadores_propietario ORDER BY orden').all();

  const resultado = temporadas.map((t) => {
    const precios = {};
    for (const m of modificadores) {
      precios[m.tipo] = r2(t.precio_base_semana * (1 + Number(m.porcentaje) / 100));
    }
    return {
      id: t.id,
      nombre: t.nombre,
      fecha_inicio: t.fecha_inicio,
      fecha_fin: t.fecha_fin,
      precios,
    };
  });

  res.json({ temporadas: resultado });
});

// ==================== Comparativa Particular / Propietario / Mayorista ====================
// Lógica propia de /comparar, autocontenida — NO llama a /calcular ni a calcularTarifaMayorista
// para no arriesgar el flujo real de reservas. Repite parte del cálculo noche a noche a propósito.

const TIPOS_COMPARAR = ['A', 'A+', 'A++', 'B', 'B+', 'C'];

// Particular: precio noche a noche a partir de `temporadas` (precio_base_noche) + modificador
// del tipo. Igual criterio que /calcular pero sin filtro de portal ni descuentos/extras.
function compararParticular(entrada, salida, temporadas, modificadorPorcentaje) {
  let subtotal = 0;
  for (let fecha = entrada; fecha < salida; fecha = sumarDias(fecha, 1)) {
    const t = temporadas.find((x) => x.fecha_inicio <= fecha && fecha <= x.fecha_fin);
    if (!t) return { ok: false, error: 'Sin tarifa definida para esas fechas' };
    subtotal += t.precio_base_noche * (1 + modificadorPorcentaje / 100);
  }
  return { ok: true, precio_total: r2(subtotal) };
}

// Propietario: mismo criterio pero sobre `temporadas_propietario` (precio_base_semana / 7 como
// equivalente por noche) + modificador propio del tipo.
function compararPropietario(entrada, salida, temporadasProp, modificadorPorcentaje) {
  let subtotal = 0;
  for (let fecha = entrada; fecha < salida; fecha = sumarDias(fecha, 1)) {
    const t = temporadasProp.find((x) => x.fecha_inicio <= fecha && fecha <= x.fecha_fin);
    if (!t) return { ok: false, error: 'Sin tarifa definida para esas fechas' };
    const precioNocheBase = t.precio_base_semana / 7;
    subtotal += precioNocheBase * (1 + modificadorPorcentaje / 100);
  }
  return { ok: true, precio_total: r2(subtotal) };
}

// Mayorista: a diferencia de calcularTarifaMayorista (que exige elegir una partida si hay
// varias candidatas), aquí se devuelven TODAS las partidas que encajen para poder comparar
// varias partidas del mismo tipo/fechas (ej. distintos clientes del mayorista) a la vez.
function compararMayorista(mayoristaId, entrada, ultimaNoche, noches, tipo) {
  if (mayoristaId === null) return { ok: false, requiere_mayorista: true };
  const anioEntrada = parseInt(entrada.slice(0, 4), 10);
  const contrato = db.prepare('SELECT id FROM mayorista_contratos WHERE mayorista_id = ? AND anio = ?')
    .get(mayoristaId, anioEntrada);
  if (!contrato) return { ok: false, error: `No hay contrato de mayorista configurado para el año ${anioEntrada}` };

  const candidatas = db.prepare(`
    SELECT * FROM mayorista_contrato_partidas
    WHERE contrato_id = ? AND tipo_clasificacion = ? AND fecha_inicio <= ? AND fecha_fin >= ?
    ORDER BY fecha_inicio
  `).all(contrato.id, tipo, entrada, ultimaNoche);
  if (!candidatas.length) {
    return { ok: false, error: `No hay ninguna partida configurada para el tipo ${tipo} en estas fechas` };
  }

  const opciones = candidatas.map((c) => {
    const noches_bloque = diasInclusive(c.fecha_inicio, c.fecha_fin);
    const precio_noche = r2(c.importe_total / noches_bloque);
    return {
      nombre: c.nombre,
      importe_total: c.importe_total,
      noches_bloque,
      precio_noche,
      precio_total: r2(precio_noche * noches),
    };
  });
  return { ok: true, opciones };
}

// GET /api/tarifas/comparar?entrada=YYYY-MM-DD&salida=YYYY-MM-DD&mayorista_id=X
// Solo lectura: precio Particular/Propietario/Mayorista por cada tipo de apartamento, para
// una pantalla de comparación. No crea ni modifica nada.
router.get('/comparar', (req, res) => {
  const entrada = fechaISO(req.query.entrada);
  const salida = fechaISO(req.query.salida);
  if (!entrada || !salida) return res.status(400).json({ ok: false, error: 'entrada y salida son obligatorias (YYYY-MM-DD)' });
  if (!(entrada < salida)) return res.status(400).json({ ok: false, error: 'La entrada debe ser anterior a la salida' });
  const mayoristaId = intOrNull(req.query.mayorista_id);

  const nochesReserva = [];
  for (let fecha = entrada; fecha < salida; fecha = sumarDias(fecha, 1)) nochesReserva.push(fecha);
  const ultimaNoche = nochesReserva[nochesReserva.length - 1];
  const noches = nochesReserva.length;

  const temporadas = db.prepare(
    'SELECT * FROM temporadas WHERE fecha_fin >= ? AND fecha_inicio < ? ORDER BY fecha_inicio'
  ).all(entrada, salida);
  const temporadasProp = db.prepare(
    'SELECT * FROM temporadas_propietario WHERE fecha_fin >= ? AND fecha_inicio < ? ORDER BY fecha_inicio'
  ).all(entrada, salida);
  const modificadores = db.prepare('SELECT tipo, porcentaje FROM tipo_modificadores').all();
  const modificadoresProp = db.prepare('SELECT tipo, porcentaje FROM tipo_modificadores_propietario').all();

  const tipos = TIPOS_COMPARAR.map((tipo) => {
    const modPart = modificadores.find((m) => m.tipo === tipo);
    const modProp = modificadoresProp.find((m) => m.tipo === tipo);
    return {
      tipo,
      particular: compararParticular(entrada, salida, temporadas, modPart ? Number(modPart.porcentaje) : 0),
      propietario: compararPropietario(entrada, salida, temporadasProp, modProp ? Number(modProp.porcentaje) : 0),
      mayorista: compararMayorista(mayoristaId, entrada, ultimaNoche, noches, tipo),
    };
  });

  res.json({ entrada, salida, noches, tipos });
});

module.exports = router;
