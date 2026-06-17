#!/usr/bin/env bash
# Backup del CRM: base de datos SQLite + ficheros subidos (public/uploads).
# Pensado para cron, p. ej. diario a las 03:00:
#   0 3 * * *  /home/crm/crm-app/deploy/backup-remoto.sh >> /home/crm/logs/backup.log 2>&1
set -euo pipefail

# ====================== Configuración ======================
APP_DIR="/home/crm/crm-app"                 # raíz de la app
BACKUP_DIR="/home/crm/backups"              # destino de los backups locales
KEEP_DAYS=7                                 # días a conservar en local
# Destino remoto (Hetzner Storage Box por SSH/rsync, o un remoto de rclone).
# Déjalo vacío para no subir a ningún sitio.
REMOTE_DEST=""                              # ej: "u123456@u123456.your-storagebox.de:crm/"
# ===========================================================

DB_FILE="$APP_DIR/db/crm.db"
STAMP="$(date +%Y-%m-%d_%H-%M-%S)"
DEST="$BACKUP_DIR/$STAMP"
mkdir -p "$DEST"

echo "[$(date)] Iniciando backup en $DEST"

# --- Base de datos ---
# Preferimos 'VACUUM INTO': genera un .db consistente sin parar la app.
if command -v sqlite3 >/dev/null 2>&1; then
	sqlite3 "$DB_FILE" "VACUUM INTO '$DEST/crm.db'"
	echo "  BD copiada con VACUUM INTO"
else
	# Sin sqlite3: copiar los TRES ficheros del WAL juntos (crm.db, -wal, -shm).
	cp -a "$DB_FILE" "$DEST/crm.db" 2>/dev/null || true
	cp -a "$DB_FILE-wal" "$DEST/crm.db-wal" 2>/dev/null || true
	cp -a "$DB_FILE-shm" "$DEST/crm.db-shm" 2>/dev/null || true
	echo "  BD copiada (crm.db + -wal + -shm)"
fi

# --- Ficheros subidos por el usuario ---
if [ -d "$APP_DIR/public/uploads" ]; then
	tar -czf "$DEST/uploads.tar.gz" -C "$APP_DIR/public" uploads
	echo "  uploads/ empaquetado en uploads.tar.gz"
fi

# --- Envío a remoto (opcional) ---
if [ -n "$REMOTE_DEST" ]; then
	# Opción A — rsync por SSH (Hetzner Storage Box):
	rsync -az --delete "$DEST/" "$REMOTE_DEST/$STAMP/"
	echo "  Subido a $REMOTE_DEST/$STAMP/ (rsync)"

	# Opción B — rclone (descomentar y configurar 'remoto' con 'rclone config'):
	# rclone copy "$DEST" "remoto:crm-backups/$STAMP" && echo "  Subido con rclone"
fi

# --- Limpieza de backups locales antiguos ---
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime "+$KEEP_DAYS" -exec rm -rf {} + 2>/dev/null || true
echo "[$(date)] Backup completado. Conservando últimos $KEEP_DAYS días."
