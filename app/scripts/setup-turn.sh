#!/usr/bin/env bash
# VOICE ROOM — coturn для WebRTC между мобильными сетями и VPS.
# Запускать на том же Ubuntu VPS:
#   bash scripts/setup-turn.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PUBLIC_IP="$(curl -4fsS https://api.ipify.org)"
TURN_USER="voice-room"
TURN_PASS="$(openssl rand -hex 20)"
REALM="voice.dilshodbekdev.uz"

echo "==> ставлю coturn"
sudo apt-get update
sudo apt-get install -y coturn

echo "==> конфигурирую coturn для ${PUBLIC_IP}"
sudo tee /etc/turnserver.conf >/dev/null <<CONF
listening-port=3478
listening-ip=${PUBLIC_IP}
external-ip=${PUBLIC_IP}
realm=${REALM}
server-name=${REALM}
fingerprint
lt-cred-mech
user=${TURN_USER}:${TURN_PASS}
min-port=49152
max-port=65535
no-cli
no-loopback-peers
no-multicast-peers
stale-nonce=600
CONF

sudo sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
sudo systemctl enable --now coturn

echo "==> открываю TURN-порты"
sudo ufw allow 3478/tcp || true
sudo ufw allow 3478/udp || true
sudo ufw allow 49152:65535/udp || true

echo "==> записываю credentials в server/.env"
touch "${APP_DIR}/server/.env"
grep -q '^PORT=' "${APP_DIR}/server/.env" || echo 'PORT=2021' >> "${APP_DIR}/server/.env"
grep -q '^STUN_URL=' "${APP_DIR}/server/.env" || echo 'STUN_URL=stun:stun.l.google.com:19302' >> "${APP_DIR}/server/.env"
sed -i '/^TURN_URL=/d;/^TURN_URL_TCP=/d;/^TURN_USER=/d;/^TURN_PASS=/d' "${APP_DIR}/server/.env"
cat >> "${APP_DIR}/server/.env" <<ENV
TURN_URL=turn:${PUBLIC_IP}:3478?transport=udp
TURN_URL_TCP=turn:${PUBLIC_IP}:3478?transport=tcp
TURN_USER=${TURN_USER}
TURN_PASS=${TURN_PASS}
ENV

cd "${APP_DIR}"
pm2 reload voice-room --update-env || true

echo
echo "TURN готов: ${PUBLIC_IP}:3478 (UDP+TCP)"
echo "Проверка: pm2 logs voice-room --lines 30"
