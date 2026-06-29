// API REST del inventario de Extras: objetos prestables (cunas, tronas, ventiladores...)
// con stock y movimientos de préstamo/devolución por apartamento o reserva.
const express = require('express');
const db = require('../db/database');

const router = express.Router();

// Corta el handler con 403 si el usuario no es administrador. Devuelve true si cortó.
function bloquearNoAdmin(req, res) {
  if (!req.usuario || req.usuario.rol !== 'administrador') {
    res.status(403).json({ error: 'Solo los administradores pueden hacer esto' });
    return true;
  }
  return false;
}

function autor(req) {
  return (req.usuario && (req.usuario.nombre || req.usuario.username)) || null;
}

// Calcula, para una lista de items, el neto en préstamo y el disponible.
// Devuelve un mapa { item_id: { total_prestado, total_devuelto, en_prestamo } }.
function netoPorItem(itemIds) {
  if (!itemIds.length) return {};
  const ph = itemIds.map(() => '?').join(',');
  const filas = db.prepare(`
    SELECT item_id,
      COALESCE(SUM(CASE WHEN tipo='prestamo'   THEN cantidad ELSE 0 END), 0) AS total_prestado,
      COALESCE(SUM(CASE WHEN tipo='devolucion' THEN cantidad ELSE 0 END), 0) AS total_devuelto
    FROM extras_movimientos
    WHERE item_id IN (${ph})
    GROUP BY item_id
  `).all(...itemIds);
  const mapa = {};
  for (const f of filas) {
    mapa[f.item_id] = {
      total_prestado: f.total_prestado,
      total_devuelto: f.total_devuelto,
      en_prestamo: f.total_prestado - f.total_devuelto,
    };
  }
  return mapa;
}

// Ubicaciones actuales (apartamentos con préstamo neto > 0) por item.
// Devuelve { item_id: [{ apartamento_id, apartamento_nombre, cantidad }] }.
function ubicacionesPorItem(itemIds) {
  if (!itemIds.length) return {};
  const ph = itemIds.map(() => '?').join(',');
  const filas = db.prepare(`
    SELECT m.item_id, m.apartamento_id, a.nombre AS apartamento_nombre,
      SUM(CASE WHEN m.tipo='prestamo' THEN m.cantidad ELSE -m.cantidad END) AS neto
    FROM extras_movimientos m
    LEFT JOIN apartamentos a ON a.id = m.apartamento_id
    WHERE m.apartamento_id IS NOT NULL AND m.item_id IN (${ph})
    GROUP BY m.item_id, m.apartamento_id
    HAVING neto > 0
    ORDER BY a.nombre
  `).all(...itemIds);
  const mapa = {};
  for (const f of filas) {
    (mapa[f.item_id] = mapa[f.item_id] || []).push({
      apartamento_id: f.apartamento_id,
      apartamento_nombre: f.apartamento_nombre,
      cantidad: f.neto,
    });
  }
  return mapa;
}

// ==================== Categorías ====================

router.get('/categorias', (req, res) => {
  const cats = db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM extras_items i WHERE i.categoria_id = c.id) AS num_items
    FROM extras_categorias c ORDER BY c.nombre
  `).all();
  res.json(cats);
});

router.post('/categorias', (req, res) => {
  const nombre = String((req.body && req.body.nombre) || '').trim();
  if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
  const icono = String((req.body && req.body.icono) || '📦').trim() || '📦';
  if (db.prepare('SELECT id FROM extras_categorias WHERE nombre = ?').get(nombre)) {
    return res.status(409).json({ error: 'Ya existe una categoría con ese nombre' });
  }
  const info = db.prepare('INSERT INTO extras_categorias (nombre, icono) VALUES (?, ?)').run(nombre, icono);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.put('/categorias/:id', (req, res) => {
  const actual = db.prepare('SELECT * FROM extras_categorias WHERE id = ?').get(req.params.id);
  if (!actual) return res.status(404).json({ error: 'Categoría no encontrada' });
  const nombre = req.body && req.body.nombre != null && String(req.body.nombre).trim()
    ? String(req.body.nombre).trim() : actual.nombre;
  if (nombre !== actual.nombre) {
    const dup = db.prepare('SELECT id FROM extras_categorias WHERE nombre = ? AND id <> ?').get(nombre, req.params.id);
    if (dup) return res.status(409).json({ error: 'Ya existe una categoría con ese nombre' });
  }
  const icono = req.body && req.body.icono != null && String(req.body.icono).trim()
    ? String(req.body.icono).trim() : actual.icono;
  db.prepare('UPDATE extras_categorias SET nombre = ?, icono = ? WHERE id = ?').run(nombre, icono, req.params.id);
  res.json({ ok: true });
});

router.delete('/categorias/:id', (req, res) => {
  const cat = db.prepare('SELECT id FROM extras_categorias WHERE id = ?').get(req.params.id);
  if (!cat) return res.status(404).json({ error: 'Categoría no encontrada' });
  const usos = db.prepare('SELECT COUNT(*) AS c FROM extras_items WHERE categoria_id = ?').get(req.params.id).c;
  if (usos > 0) return res.status(409).json({ error: `No se puede eliminar: ${usos} artículo(s) en esta categoría` });
  db.prepare('DELETE FROM extras_categorias WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ==================== Resumen ====================
// Declarado antes de /items/:id (no colisiona, pero lo agrupamos con el resto).
router.get('/resumen', (req, res) => {
  const total_items = db.prepare('SELECT COUNT(*) AS c FROM extras_items').get().c;
  const prestados_ahora = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN tipo='prestamo' THEN cantidad ELSE -cantidad END), 0) AS n
    FROM extras_movimientos
  `).get().n;
  const categorias_con_items = db.prepare(`
    SELECT COUNT(DISTINCT categoria_id) AS c FROM extras_items WHERE categoria_id IS NOT NULL
  `).get().c;
  res.json({ total_items, prestados_ahora, categorias_con_items });
});

// ==================== Items ====================

// GET /api/extras/items?categoria_id= — lista con disponible + ubicaciones actuales.
router.get('/items', (req, res) => {
  const catId = req.query.categoria_id;
  const cond = catId ? 'WHERE i.categoria_id = ?' : '';
  const params = catId ? [catId] : [];
  const items = db.prepare(`
    SELECT i.*, c.nombre AS categoria_nombre, c.icono AS categoria_icono
    FROM extras_items i
    LEFT JOIN extras_categorias c ON c.id = i.categoria_id
    ${cond}
    ORDER BY i.nombre
  `).all(...params);

  const ids = items.map((i) => i.id);
  const neto = netoPorItem(ids);
  const ubic = ubicacionesPorItem(ids);
  for (const it of items) {
    const n = neto[it.id] || { en_prestamo: 0 };
    it.en_prestamo = n.en_prestamo;
    it.disponible = it.stock_total == null ? null : it.stock_total - n.en_prestamo;
    it.ubicaciones = ubic[it.id] || [];
  }
  res.json(items);
});

// GET /api/extras/items/:id — ficha con historial de movimientos.
router.get('/items/:id', (req, res) => {
  const it = db.prepare(`
    SELECT i.*, c.nombre AS categoria_nombre, c.icono AS categoria_icono
    FROM extras_items i
    LEFT JOIN extras_categorias c ON c.id = i.categoria_id
    WHERE i.id = ?
  `).get(req.params.id);
  if (!it) return res.status(404).json({ error: 'Artículo no encontrado' });

  const n = netoPorItem([it.id])[it.id] || { en_prestamo: 0 };
  it.en_prestamo = n.en_prestamo;
  it.disponible = it.stock_total == null ? null : it.stock_total - n.en_prestamo;
  it.ubicaciones = ubicacionesPorItem([it.id])[it.id] || [];
  it.movimientos = db.prepare(`
    SELECT m.*, a.nombre AS apartamento_nombre, r.numero_reserva, r.nombre_cliente
    FROM extras_movimientos m
    LEFT JOIN apartamentos a ON a.id = m.apartamento_id
    LEFT JOIN reservas r ON r.id = m.reserva_id
    WHERE m.item_id = ?
    ORDER BY m.fecha DESC, m.id DESC
  `).all(it.id);
  res.json(it);
});

router.post('/items', (req, res) => {
  const b = req.body || {};
  const nombre = String(b.nombre || '').trim();
  if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
  const categoria_id = b.categoria_id ? Number(b.categoria_id) : null;
  // stock_total: '' o null => ilimitado.
  const stock_total = (b.stock_total === '' || b.stock_total == null) ? null : Number(b.stock_total);
  if (stock_total != null && (isNaN(stock_total) || stock_total < 0)) {
    return res.status(400).json({ error: 'El stock debe ser un número ≥ 0 (o vacío para ilimitado)' });
  }
  const info = db.prepare(
    'INSERT INTO extras_items (nombre, categoria_id, stock_total, descripcion) VALUES (?, ?, ?, ?)'
  ).run(nombre, categoria_id, stock_total, b.descripcion ? String(b.descripcion).trim() : null);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.put('/items/:id', (req, res) => {
  const actual = db.prepare('SELECT * FROM extras_items WHERE id = ?').get(req.params.id);
  if (!actual) return res.status(404).json({ error: 'Artículo no encontrado' });
  const b = req.body || {};
  const nombre = b.nombre != null && String(b.nombre).trim() ? String(b.nombre).trim() : actual.nombre;
  const categoria_id = 'categoria_id' in b ? (b.categoria_id ? Number(b.categoria_id) : null) : actual.categoria_id;
  let stock_total = actual.stock_total;
  if ('stock_total' in b) {
    stock_total = (b.stock_total === '' || b.stock_total == null) ? null : Number(b.stock_total);
    if (stock_total != null && (isNaN(stock_total) || stock_total < 0)) {
      return res.status(400).json({ error: 'El stock debe ser un número ≥ 0 (o vacío para ilimitado)' });
    }
  }
  const descripcion = 'descripcion' in b ? (b.descripcion ? String(b.descripcion).trim() : null) : actual.descripcion;
  db.prepare('UPDATE extras_items SET nombre = ?, categoria_id = ?, stock_total = ?, descripcion = ? WHERE id = ?')
    .run(nombre, categoria_id, stock_total, descripcion, req.params.id);
  res.json({ ok: true });
});

// DELETE item: solo si no tiene préstamos sin devolver (neto en préstamo == 0).
router.delete('/items/:id', (req, res) => {
  const it = db.prepare('SELECT id FROM extras_items WHERE id = ?').get(req.params.id);
  if (!it) return res.status(404).json({ error: 'Artículo no encontrado' });
  const n = netoPorItem([req.params.id])[req.params.id] || { en_prestamo: 0 };
  if (n.en_prestamo > 0) {
    return res.status(409).json({ error: `No se puede eliminar: ${n.en_prestamo} unidad(es) en préstamo sin devolver` });
  }
  db.prepare('DELETE FROM extras_items WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ==================== Movimientos ====================

router.get('/movimientos', (req, res) => {
  const cond = [];
  const params = [];
  if (req.query.item_id) { cond.push('m.item_id = ?'); params.push(req.query.item_id); }
  if (req.query.apartamento_id) { cond.push('m.apartamento_id = ?'); params.push(req.query.apartamento_id); }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  const movs = db.prepare(`
    SELECT m.*, i.nombre AS item_nombre, a.nombre AS apartamento_nombre,
      r.numero_reserva, r.nombre_cliente
    FROM extras_movimientos m
    JOIN extras_items i ON i.id = m.item_id
    LEFT JOIN apartamentos a ON a.id = m.apartamento_id
    LEFT JOIN reservas r ON r.id = m.reserva_id
    ${where}
    ORDER BY m.fecha DESC, m.id DESC
  `).all(...params);
  res.json(movs);
});

router.post('/movimientos', (req, res) => {
  const b = req.body || {};
  const item = db.prepare('SELECT * FROM extras_items WHERE id = ?').get(b.item_id);
  if (!item) return res.status(404).json({ error: 'Artículo no encontrado' });
  const tipo = b.tipo === 'devolucion' ? 'devolucion' : (b.tipo === 'prestamo' ? 'prestamo' : null);
  if (!tipo) return res.status(400).json({ error: 'Tipo inválido (prestamo o devolucion)' });
  const cantidad = Number(b.cantidad) || 1;
  if (cantidad < 1) return res.status(400).json({ error: 'La cantidad debe ser ≥ 1' });
  const apartamento_id = b.apartamento_id ? Number(b.apartamento_id) : null;
  const reserva_id = b.reserva_id ? Number(b.reserva_id) : null;
  const fecha = (b.fecha && String(b.fecha).trim()) || new Date().toISOString().slice(0, 10);

  // Préstamo con stock limitado: no superar el disponible actual.
  if (tipo === 'prestamo' && item.stock_total != null) {
    const n = netoPorItem([item.id])[item.id] || { en_prestamo: 0 };
    const disponible = item.stock_total - n.en_prestamo;
    if (cantidad > disponible) {
      return res.status(409).json({ error: `Stock insuficiente: solo ${disponible} disponible(s)` });
    }
  }

  const info = db.prepare(`
    INSERT INTO extras_movimientos (item_id, apartamento_id, reserva_id, cantidad, tipo, fecha, notas, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(item.id, apartamento_id, reserva_id, cantidad, tipo, fecha,
    b.notas ? String(b.notas).trim() : null, autor(req));
  res.status(201).json({ id: info.lastInsertRowid });
});

router.delete('/movimientos/:id', (req, res) => {
  if (bloquearNoAdmin(req, res)) return;
  const mov = db.prepare('SELECT id FROM extras_movimientos WHERE id = ?').get(req.params.id);
  if (!mov) return res.status(404).json({ error: 'Movimiento no encontrado' });
  db.prepare('DELETE FROM extras_movimientos WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
