#!/usr/bin/env bash
# VOICE ROOM — деплой обновлений на VPS (запускать на сервере в папке приложения):
#   bash scripts/deploy.sh
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "==> git pull"
git pull --ff-only

echo "==> зависимости (фронт + бэкенд)"
npm ci
npm --prefix backend ci

echo "==> тесты бэкенда"
npm --prefix backend test

echo "==> сборка (фронт + бэкенд)"
npm run build
npm --prefix backend run build

echo "==> перезапуск (zero-downtime reload)"
pm2 reload voice-room --update-env

echo "==> статус"
pm2 status voice-room
echo "Готово: pm2 logs voice-room — посмотреть логи"
