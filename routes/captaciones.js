// API REST del módulo Captación: pipeline de pisos candidatos a captar como propietarios
// nuevos. Independiente de Leads (leads.js), que es captación de clientes/inquilinos.
const express = require('express');
const db = require('../db/database');
const { registrarActividad } = require('../services/actividadService');

const router = express.Router();

const FASES = ['contactado', 'interesado', 'captado', 'descartado'];

function txt(v) { return v === undefined || v === null || v === '' ? null : String(v); }
function aEntero(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}
function aReal(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}
function usuarioActual(req) {
  return {
    id: req.usuario && req.usuario.id != null ? req.usuario.id : null,
    nombre: req.usuario && req.usuario.nombre != null ? req.usuario.nombre : null,
    username: req.usuario && req.usuario.username != null ? req.usuario.username : null,
  };
}
function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// GET /api/captaciones?fase=&buscar= — lista con filtro por fase y buscador libre.
router.get('/', (req, res) => {
  const { fase, buscar } = req.query;
  let sql = 'SELECT * FROM captaciones WHERE 1 = 1';
  const params = [];
  if (fase) { sql += ' AND fase = ?'; params.push(fase); }
  if (buscar) {
    sql += ` AND (nombre_piso LIKE ? OR direccion LIKE ? OR propietario_nombre LIKE ?
                  OR propietario_telefono LIKE ? OR propietario_email LIKE ?)`;
    const like = `%${buscar}%`;
    params.push(like, like, like, like, like);
  }
  sql += ' ORDER BY updated_at DESC';
  res.json(db.prepare(sql).all(...params));
});

// GET /api/captaciones/:id — ficha.
router.get('/:id', (req, res) => {
  const cap = db.prepare('SELECT * FROM captaciones WHERE id = ?').get(req.params.id);
  if (!cap) return res.status(404).json({ error: 'Captación no encontrada' });
  res.json(cap);
});

// POST /api/captaciones — crear.
router.post('/', (req, res) => {
  const b = req.body || {};
  const propietarioNombre = txt(b.propietario_nombre);
  if (!propietarioNombre) return res.status(400).json({ error: 'propietario_nombre es obligatorio' });

  const fase = FASES.includes(b.fase) ? b.fase : 'contactado';
  const motivoDescarte = txt(b.motivo_descarte);
  if (fase === 'descartado' && !motivoDescarte) {
    return res.status(400).json({ error: 'motivo_descarte es obligatorio cuando fase es descartado' });
  }

  const u = usuarioActual(req);
  const info = db.prepare(`
    INSERT INTO captaciones
      (nombre_piso, direccion, m2, capacidad, propietario_nombre, propietario_telefono,
       propietario_email, fuente, fase, motivo_descarte, notas, atendido_por, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    txt(b.nombre_piso), txt(b.direccion), aReal(b.m2), aEntero(b.capacidad),
    propietarioNombre, txt(b.propietario_telefono), txt(b.propietario_email),
    txt(b.fuente), fase, motivoDescarte, txt(b.notas), txt(b.atendido_por) || u.username, u.username
  );

  registrarActividad(db, u.id, u.nombre, 'crear', 'captacion', info.lastInsertRowid, `Captación: ${propietarioNombre}`);
  res.status(201).json({ id: info.lastInsertRowid });
});

// PUT /api/captaciones/:id — editar.
router.put('/:id', (req, res) => {
  const cap = db.prepare('SELECT * FROM captaciones WHERE id = ?').get(req.params.id);
  if (!cap) return res.status(404).json({ error: 'Captación no encontrada' });
  const b = req.body || {};

  const sets = [];
  const vals = [];
  const add = (col, val) => { sets.push(`${col} = ?`); vals.push(val); };

  if ('nombre_piso' in b) add('nombre_piso', txt(b.nombre_piso));
  if ('direccion' in b) add('direccion', txt(b.direccion));
  if ('m2' in b) add('m2', aReal(b.m2));
  if ('capacidad' in b) add('capacidad', aEntero(b.capacidad));
  if ('propietario_nombre' in b) {
    if (!txt(b.propietario_nombre)) return res.status(400).json({ error: 'propietario_nombre no puede quedar vacío' });
    add('propietario_nombre', txt(b.propietario_nombre));
  }
  if ('propietario_telefono' in b) add('propietario_telefono', txt(b.propietario_telefono));
  if ('propietario_email' in b) add('propietario_email', txt(b.propietario_email));
  if ('fuente' in b) add('fuente', txt(b.fuente));
  if ('notas' in b) add('notas', txt(b.notas));
  if ('atendido_por' in b) add('atendido_por', txt(b.atendido_por));

  const nuevaFase = 'fase' in b ? b.fase : cap.fase;
  const motivoDescarte = 'motivo_descarte' in b ? txt(b.motivo_descarte) : cap.motivo_descarte;
  if ('fase' in b) {
    if (!FASES.includes(b.fase)) return res.status(400).json({ error: 'fase no válida' });
    if (nuevaFase === 'descartado' && !motivoDescarte) {
      return res.status(400).json({ error: 'motivo_descarte es obligatorio cuando fase es descartado' });
    }
    add('fase', nuevaFase);
  }
  if ('motivo_descarte' in b) add('motivo_descarte', motivoDescarte);

  if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
  add('updated_at', new Date().toISOString().replace('T', ' ').slice(0, 19));
  vals.push(cap.id);
  db.prepare(`UPDATE captaciones SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  res.json({ ok: true });
});

// DELETE /api/captaciones/:id — solo si no fue ya convertida en alojamiento.
router.delete('/:id', (req, res) => {
  const cap = db.prepare('SELECT * FROM captaciones WHERE id = ?').get(req.params.id);
  if (!cap) return res.status(404).json({ error: 'Captación no encontrada' });
  if (cap.apartamento_id) {
    return res.status(409).json({ error: 'No se puede borrar una captación ya convertida en alojamiento' });
  }
  db.prepare('DELETE FROM captaciones WHERE id = ?').run(cap.id);
  const u = usuarioActual(req);
  registrarActividad(db, u.id, u.nombre, 'eliminar', 'captacion', cap.id, `Captación: ${cap.propietario_nombre}`);
  res.json({ ok: true });
});

// POST /api/captaciones/:id/convertir — crea propietario + apartamento reales, los vincula
// al 100% y marca la captación como captada. El m2 recogido en la captación NO se traslada
// (apartamentos no tiene columna de m2 hoy; queda solo como referencia en la propia captación).
router.post('/:id/convertir', (req, res) => {
  const cap = db.prepare('SELECT * FROM captaciones WHERE id = ?').get(req.params.id);
  if (!cap) return res.status(404).json({ error: 'Captación no encontrada' });
  if (cap.fase === 'descartado') {
    return res.status(409).json({ error: 'No se puede convertir una captación descartada' });
  }
  if (cap.apartamento_id || cap.propietario_id) {
    return res.status(409).json({ error: 'Esta captación ya fue convertida' });
  }

  const u = usuarioActual(req);
  const resultado = db.transaction(() => {
    const infoProp = db.prepare(`
      INSERT INTO propietarios (nombre, telefono, email, fecha_alta)
      VALUES (?, ?, ?, ?)
    `).run(cap.propietario_nombre, cap.propietario_telefono, cap.propietario_email, hoyISO());
    const propietarioId = infoProp.lastInsertRowid;

    const infoApto = db.prepare(`
      INSERT INTO apartamentos (nombre, direccion, capacidad, notas)
      VALUES (?, ?, ?, ?)
    `).run(cap.nombre_piso || cap.direccion || `Captación #${cap.id}`, cap.direccion, cap.capacidad, cap.notas);
    const apartamentoId = infoApto.lastInsertRowid;

    db.prepare(`
      INSERT INTO apartamento_propietarios (apartamento_id, propietario_id, porcentaje, fecha_inicio, activo)
      VALUES (?, ?, 100, ?, 1)
    `).run(apartamentoId, propietarioId, hoyISO());

    db.prepare(`
      UPDATE captaciones SET fase = 'captado', apartamento_id = ?, propietario_id = ?,
        updated_at = datetime('now') WHERE id = ?
    `).run(apartamentoId, propietarioId, cap.id);

    return { apartamentoId, propietarioId };
  })();

  registrarActividad(db, u.id, u.nombre, 'convertir', 'captacion', cap.id,
    `Captación "${cap.propietario_nombre}" convertida en alojamiento #${resultado.apartamentoId}`);
  res.json({ ok: true, apartamento_id: resultado.apartamentoId, propietario_id: resultado.propietarioId });
});

module.exports = router;
