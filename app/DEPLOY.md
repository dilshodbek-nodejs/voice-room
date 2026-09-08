# Деплой на VPS

## Первый раз (на сервере)

```bash
git clone <твой-репо> voice-room && cd voice-room
bash scripts/setup-vps.sh --nginx   # node20 + pm2 + build + запуск + nginx с WS
```

- без `--nginx` — приложение само слушает `:2021` (бэк+статика); dev-фронт Vite — `:2020`
- `--nginx` — прокси на 80-м порту с апгрейдом WebSocket + подсказка по certbot (HTTPS)
- TURN для строгих NAT: впиши `TURN_URL/USER/PASS` в `server/.env`, затем `pm2 reload voice-room`

## Обновления (на сервере)

```bash
bash scripts/deploy.sh
```

## Проверка

```bash
pm2 status
pm2 logs voice-room
node server/smoke.mjs   # тесты стучатся на ws://localhost:2021
```
## Важно

- WS ходит на `/ws` того же origin — nginx-конфиг из setup уже проксирует Upgrade
- in-memory state: держи `instances: 1` в `ecosystem.config.cjs` (скейл — см. BACKEND_INTEGRATION.md §11)
- микрофон требует **HTTPS** (или localhost) — за nginx обязательно поставь certbot
