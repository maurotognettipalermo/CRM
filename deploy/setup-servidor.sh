#!/usr/bin/env bash
# Setup inicial del VPS para el CRM. Ubuntu 24.04. EJECUTAR COMO root.
#   sudo bash setup-servidor.sh
# Idempotente en lo posible: se puede re-ejecutar.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
	echo "Ejecuta como root (sudo bash setup-servidor.sh)"; exit 1
fi

APP_USER="crm"
APP_DIR="/home/$APP_USER/crm-app"
REPO="https://github.com/maurotognettipalermo/CRM.git"

echo "==> Usuario '$APP_USER'"
if ! id "$APP_USER" >/dev/null 2>&1; then
	adduser --disabled-password --gecos "" "$APP_USER"
	usermod -aG sudo "$APP_USER"
fi
mkdir -p "/home/$APP_USER/logs" "/home/$APP_USER/backups"
chown -R "$APP_USER:$APP_USER" "/home/$APP_USER"

echo "==> Paquetes base"
apt-get update
apt-get install -y curl git build-essential sqlite3 debian-keyring debian-archive-keyring apt-transport-https

echo "==> Node.js 22 LTS (NodeSource)"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]; then
	curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
	apt-get install -y nodejs
fi

echo "==> PM2 global"
npm install -g pm2

echo "==> Caddy (repo oficial)"
if ! command -v caddy >/dev/null 2>&1; then
	curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
	curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
	apt-get update
	apt-get install -y caddy
fi

echo "==> Firewall (UFW)"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> Clonar / actualizar repositorio"
if [ ! -d "$APP_DIR/.git" ]; then
	sudo -u "$APP_USER" git clone "$REPO" "$APP_DIR"
else
	sudo -u "$APP_USER" git -C "$APP_DIR" pull origin main
fi

echo "==> Dependencias de la app"
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && npm install --production"

echo "==> Caddyfile"
mkdir -p /var/log/caddy
cp "$APP_DIR/deploy/Caddyfile" /etc/caddy/Caddyfile
systemctl restart caddy

echo "==> Arrancar la app con PM2 (como $APP_USER)"
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && pm2 start deploy/ecosystem.config.js && pm2 save"
# Configurar arranque automático de PM2 al reiniciar el servidor:
env PATH=$PATH:/usr/bin pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER"

echo ""
echo "✅ Setup completo."
echo "   - App:   pm2 status   (usuario $APP_USER)"
echo "   - Caddy: systemctl status caddy"
echo "   - DNS:   crm.hectorinmobiliaria.com debe apuntar a este servidor para el HTTPS."
