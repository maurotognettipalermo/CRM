#!/usr/bin/env bash
# Actualiza el CRM en producción: backup → git pull → (npm install si cambió) → reinicio PM2.
# Ejecutar como usuario 'crm':  /home/crm/crm-app/deploy/deploy.sh
set -euo pipefail

APP_DIR="/home/crm/crm-app"
cd "$APP_DIR"

echo "==> 1/5 Backup previo"
if [ -x "$APP_DIR/deploy/backup-remoto.sh" ]; then
	"$APP_DIR/deploy/backup-remoto.sh" || echo "  (aviso: el backup falló, se continúa igualmente)"
fi

echo "==> 2/5 Guardando hash de package.json"
PKG_ANTES="$(sha1sum package.json 2>/dev/null | awk '{print $1}')"

echo "==> 3/5 git pull origin main"
git pull origin main

echo "==> 4/5 Dependencias"
PKG_DESPUES="$(sha1sum package.json 2>/dev/null | awk '{print $1}')"
if [ "$PKG_ANTES" != "$PKG_DESPUES" ]; then
	echo "  package.json cambió → npm install --production"
	npm install --production
else
	echo "  package.json sin cambios → se omite npm install"
fi

echo "==> 5/5 Reiniciar PM2"
pm2 restart crm --update-env

# Verificación: la app debe quedar 'online'.
sleep 2
if pm2 jlist | grep -q '"name":"crm"' && pm2 jlist | grep -q '"status":"online"'; then
	echo "✅ CRM online"
else
	echo "❌ El CRM NO está online — revisa: pm2 logs crm"
	exit 1
fi
