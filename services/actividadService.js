// Servicio de registro de actividad (auditoría). Se llama desde los routes tras
// cada operación exitosa. Nunca debe romper la operación principal: cualquier
// fallo al registrar se traga y solo se avisa por consola.
function registrarActividad(db, usuarioId, usuarioNombre, accion, entidad, entidadId, detalle) {
  try {
    db.prepare(
      `INSERT INTO actividad_log (usuario_id, usuario_nombre, accion, entidad, entidad_id, detalle)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      usuarioId != null ? usuarioId : null,
      usuarioNombre != null ? usuarioNombre : null,
      accion,
      entidad != null ? entidad : null,
      entidadId != null ? String(entidadId) : null,
      detalle != null ? detalle : null
    );
  } catch (e) {
    console.error('No se pudo registrar actividad:', e.message);
  }
}

module.exports = { registrarActividad };
