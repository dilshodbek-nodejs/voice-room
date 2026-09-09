# Backend v2 — по спецификации `voice-room-backend-architecture-prompt.md`

Старый mesh-бэкенд (`server/server.js`) **удалён**. Аудио-транспорт переехал на **LiveKit SFU**,
прикладная логика — на модульный Node+TypeScript бэкенд. Не-медиа протокол WS
(`join/chat/react/state/speaking/leave/ping`, `roster/peer-joined/peer-left/chat/react/peer-state/pong/error`)
**сохранён 1-в-1**, поэтому текущий фронт работает без изменений для чата/реакций/присутствия.

## Модули (`backend/src/modules/`)

| Модуль MD | Реализация | Тест |
|---|---|---|
| API Layer | `auth/auth.routes.ts`, `rooms/rooms.routes.ts` (zod-валидация, rate-limit) | `app.test.ts` |
| Auth | `auth/auth.service.ts` (JWT access+refresh), `auth.middleware.ts` | `auth/auth.test.ts` |
| Room Service | `rooms/rooms.service.ts` (join/leave/mute/hand/promote/end, per-room lock) | `rooms/rooms.test.ts` |
| Token Service | `tokens/token.service.ts` (role→grants: host/speaker/listener) | `tokens/token.test.ts` |
| Media Gateway Adapter | `media/gateway.interface.ts` + `media/livekit.gateway.ts` (+`FakeGateway`) | `media/gateway.test.ts` |
| Webhook Handler | `webhooks/webhooks.routes.ts` (participant_joined/left, room_finished) | `webhooks/webhooks.test.ts` |
| Realtime | `realtime/hub.ts` (WS hub, троттлинг чата, кулдаун реакций 10с) | `realtime/realtime.test.ts` |
| Persistence | `persistence/repos.ts` + `pg.repos.ts` + `memory.repos.ts`, `presence.ts` (Redis/Memory) | `persistence/persistence.test.ts` |

Запуск тестов: `npm --prefix backend test` → **25 passed / 8 files**.
Живой протокол: `npm --prefix backend run smoke` → **12/12 PASS**.

## REST

- `POST /api/auth/register {name}` → `{user, accessToken, refreshToken}`
- `POST /api/auth/guest` → гость `Гость-XXXX` + токены
- `POST /api/auth/refresh {refreshToken}` → новая пара
- `GET /api/auth/me` (optional auth)
- `POST /api/rooms/:id/join {name?}` → `{room, participant, sfuUrl, token}` (первый = host)
- `POST /api/rooms/:id/leave`, `/mute {muted}`, `/hand {raised}`
- `POST /api/rooms/:id/promote {userId, role}` (только host, JWT)
- `POST /api/rooms/:id/end` (только host)
- `POST /webhooks/livekit` (подпись LiveKit)
- `GET /healthz`, `GET /metrics` (Prometheus)

Мут: `setMuted` идёт и в SFU (`mutePublishedTrack`), и в WS `peer-state` — собеседник глохнет
даже если его клиент игнорирует локальный мут. Понижение до `listener` тоже мутит на SFU.

## ENV (`backend/.env`)

`PORT, JWT_SECRET, JWT_ACCESS_TTL, JWT_REFRESH_TTL, DATABASE_URL (пусто = memory),
REDIS_URL (пусто = memory), LIVEKIT_URL, LIVEKIT_PUBLIC_URL, LIVEKIT_API_KEY,
LIVEKIT_API_SECRET, ROOM_MAX_PEERS, ROOM_DEFAULT_OPEN_MIC, JOIN_RATE_PER_MIN,
CHAT_THROTTLE_MS, REACT_COOLDOWN_MS`. Пример — `backend/.env.example`.

## Docker

`cd backend && docker compose up -d` → Postgres (+`migrations.sql`), Redis,
LiveKit (`livekit.yaml`, встроенный TURN), coturn, backend. Локальный dev без Docker:
бэкенд стартует на memory-реализациях, SFU-вызовы отказоустойчивы (join не падает
без LiveKit — комнаты автосоздаются при первом коннекте участника).

## Голос E2E (готово, без обязательной авторизации)

Фронт подключён к SFU: `src/sfu.js` (livekit-client) — коннект по `{sfuUrl, token}`
из события `t:'sfu'`, публикация микрофона, `activeSpeakers` → кольца говорящих,
AnalyserNode → живая волна, `track.attach()` → звук. Меш-клиент `webrtc.js` удалён.
Гости и именованные входят одинаково, JWT нигде не обязателен — HTTPS достаточно.

Мут двойной: `setMicrophoneEnabled(false)` локально + `state{muted}` → бэкенд мутит
трек на SFU и рассылает `peer-state`.

Для работы голоса на проде нужны 3 вещи в `backend/.env`:
`LIVEKIT_URL=ws://localhost:7880` (внутри compose: `ws://livekit:7880`),
`LIVEKIT_PUBLIC_URL=wss://voice.dilshodbekdev.uz/livekit` (через nginx-location
`/livekit/` из `setup-vps.sh`), совпадающие `LIVEKIT_API_KEY/SECRET` с `livekit.yaml`.
Плюс firewall: `7881-7882/tcp+udp` (и `3478`, `49152-65535/udp` при внешнем coturn).
