// API REST de importación de reservas desde Excel/CSV.
const express = require('express');
const multer = require('multer');
const db = require('../db/database');
const { importar } = require('../services/importService');
const { registrarActividad } = require('../services/actividadService');

const router = express.Router();

// Recibimos el archivo en memoria (los archivos de reservas son pequeños).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
});

// POST /api/importar  (campo de formulario: "archivo")
router.post('/', upload.single('archivo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se ha recibido ningún archivo' });
  try {
    const resumen = importar(req.file.buffer);
    registrarActividad(db, req.usuario && req.usuario.id, req.usuario && req.usuario.nombre, 'importar', 'reserva', null, `${resumen.nuevas} nuevas / ${resumen.actualizadas} actualizadas`);
    res.json(resumen);
  } catch (e) {
    console.error('Error importando:', e);
    res.status(500).json({ error: 'No se pudo procesar el archivo: ' + e.message });
  }
});

module.exports = router;
