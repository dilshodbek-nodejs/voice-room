#!/usr/bin/env bash
# VOICE ROOM — первичная настройка VPS (запускать ОДИН раз на сервере, от юзера с sudo):
#   bash scripts/setup-vps.sh            # только приложение + pm2
#   bash scripts/setup-vps.sh --nginx    # + конфиг nginx с проксированием WS
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NGINX=0
[ "${1:-}" = "--nginx" ] && NGINX=1

echo "==> 1/6 Node.js"
if ! command -v node >/dev/null 2>&1 || [ "$(node -e 'console.log(process.versions.node.split(".")[0])')" -lt 18 ]; then
  echo "    ставлю Node 20 LTS (NodeSource)…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v

echo "==> 2/6 PM2"
if ! command -v pm2 >/dev/null 2>&1; then
  sudo npm i -g pm2
fi
pm2 -v

echo "==> 3/7 зависимости (фронт + бэкенд)"
cd "$APP_DIR"
npm ci
npm --prefix backend ci

echo "==> 4/7 сборка фронта и бэкенда"
npm run build
npm --prefix backend run build

echo "==> 5/7 .env бэкенда"
if [ ! -f backend/.env ]; then
  cp backend/.env.example backend/.env
  echo "    создан backend/.env — впиши JWT_SECRET, LIVEKIT_*, DATABASE_URL/REDIS_URL"
fi

echo "==> 6/7 запуск pm2"
pm2 delete voice-room 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd -u "$USER" --hp "$HOME" | tail -n 1 | sudo bash || true

if [ "$NGINX" = "1" ]; then
  echo "==> nginx: конфиг voice-room"
  sudo tee /etc/nginx/sites-available/voice-room >/dev/null <<'CONF'
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:2021;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;      # обязательно для /ws
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 3600s;                    # WS не рвать по таймауту
        proxy_send_timeout 3600s;
    }

    # LiveKit SFU (голос): клиент ходит на wss://домен/livekit
    location /livekit/ {
        proxy_pass http://127.0.0.1:7880/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
CONF
  sudo ln -sf /etc/nginx/sites-available/voice-room /etc/nginx/sites-enabled/voice-room
  sudo rm -f /etc/nginx/sites-enabled/default
  sudo nginx -t && sudo systemctl reload nginx
  echo "    nginx готов. HTTPS: sudo apt install certbot python3-certbot-nginx && sudo certbot --nginx"
fi

cat <<'EOF'

ГОТОВО. Приложение на http://<IP_СЕРВЕРА> (nginx 80 → 2021; напрямую: http://<IP_СЕРВЕРА>:2021)
  pm2 status        — статус
  pm2 logs voice-room — логи
  pm2 monit         — мониторинг
Если за nginx (порт 80) — не забудь открыть только 80/443:
  sudo ufw allow 80,443/tcp && sudo ufw allow OpenSSH && sudo ufw enable
EOF
