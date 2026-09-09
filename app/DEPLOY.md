# Деплой на VPS

## Первый раз (на сервере)

```bash
git clone <твой-репо> voice-room && cd voice-room
bash scripts/setup-vps.sh --nginx   # node20 + pm2 + build + запуск + nginx с WS
```

- без `--nginx` — приложение само слушает `:2021` (бэк+статика); dev-фронт Vite — `:2020`
- `--nginx` — прокси на 80-м порту с апгрейдом WebSocket + подсказка по certbot (HTTPS)
- бэкенд v2: заполни `backend/.env` (`JWT_SECRET`, `LIVEKIT_*`, при наличии — `DATABASE_URL`/`REDIS_URL`); без PG/Redis работает на in-memory (один инстанс)
- голос: `LIVEKIT_PUBLIC_URL=wss://<домен>/livekit` (location уже в шаблоне setup-vps.sh), firewall: `7881-7882/tcp+udp`
- существующий nginx: добавь `location /livekit/` из шаблона в `setup-vps.sh` и `reload`
- полный стек (Postgres+Redis+LiveKit+coturn): `cd backend && docker compose up -d`
- Для PC↔мобильных сетей: LiveKit уже со встроенным TURN; внешний coturn — опционально

## Обновления (на сервере)

```bash
bash scripts/deploy.sh
```

## Проверка

```bash
pm2 status
pm2 logs voice-room
npm --prefix backend test          # 25 unit-тестов по модулям
npm --prefix backend run smoke     # живой протокол WS (бэк должен быть запущен)
```
## Важно

- WS ходит на `/ws` того же origin — nginx-конфиг из setup уже проксирует Upgrade
- in-memory state: держи `instances: 1` в `ecosystem.config.cjs` (скейл — Redis PubSub уже встроен, см. BACKEND_V2.md)
- микрофон требует **HTTPS** (или localhost) — за nginx обязательно поставь certbot
