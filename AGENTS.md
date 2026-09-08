# VOICE ROOM — Project Rules (binding for all future work)

Single source of truth for scaling + new functionality. Follow these unless the user explicitly overrides them.

## 1. What this is
Real voice-room app for friends. Join with a name (or without) → land straight in the room.
Reference: `plan.md`. UI preview: `preview.html` (single file, see §3).

## 2. Stack (minimal on purpose, do not add frameworks)
- No framework. Vanilla ES modules. ~20KB JS, instant load on cheap Androids.
- Server: Node + `express` + `ws` only. Static files + one WebSocket for signaling/chat/emoji. In-memory state, no DB, no accounts.
- Voice: WebRTC mesh (2–10 people). Deterministic offers (existing peers offer to newcomer), ID-compare fallback, STUN default / TURN via env.
- Mute = `track.enabled` toggle, no renegotiation. Speaking detection = AudioContext + AnalyserNode per stream.
- Reconnect: exponential backoff WS retry → rejoin same name/room → mesh rebuilds. ~10s grace on server.
- Fonts: Space Grotesk + Manrope (Cyrillic fallback) + JetBrains Mono, Google Fonts with preconnect + display=swap.
- No hardcoding: PORT, cert paths, ICE servers in `.env` + config module. Emoji set + labels in one content module.

## 3. Preview-first workflow
- `preview.html` is the UI-only preview (no backend, all data mocked). Build/verify UI there FIRST, then port to real `public/` files.
- Keep `preview.html` working after every UI change. Open it directly in a browser to check.
- Anything networked (WS broadcast, WebRTC) must be marked in preview code with `NOTE(preview):` explaining it renders locally only.

## 4. Language
- ALL user-facing texts in Russian. `html lang="ru"`. Toasts, placeholders, badges, chat mocks — everything.
- Brand stays `VOICE_ROOM`. Hero title: `ГОЛОС / РУМ`.

## 5. Design tokens (dark/lime technical aesthetic)
- bg `#080808`/`#0A0A0A`, panels `#0D0D0D`, text `#F2F2F2`, secondary `#777`/`#555`, borders `rgba(255,255,255,.08)` 1px, accent lime `#8CFF00`, red `#FF4D4D` for destructive/mute.
- Lime is rare and intentional: join button, mic-on, speaking ring, live waveform, tiny accents. Everything else monochrome.
- Micro-metadata everywhere: 10px JetBrains Mono, uppercase, low opacity, thin borders (`+001 / ВХОД`, `СТАТУС: ПОДКЛЮЧЁН`, `КОМНАТА: FRI-09`, `12 В СЕТИ`).
- Ambience: barely-visible scanlines + one faint radial light. No glow soup.

## 6. Layout — NO page scroll, mobile-first
- Page must NEVER scroll: `html,body` locked to `100dvh`, `overflow:hidden`. No visible scrollbars anywhere (`scrollbar-width:none`, `::-webkit-scrollbar{display:none}`).
- Internal scroll allowed only inside `#msgs` (chat) and `.grid` (tiles overflow) — scrollbars hidden, functionality kept.
- Mobile-first CSS (`min-width` queries only), `100dvh`, safe-area insets, touch targets ≥44px.
- Long texts: `nowrap + ellipsis`, `min-width:0` on flex children. Nothing may cause horizontal overflow.
- Short screens (`max-height:700px`): hide `.sub`/`.hint`/`.level`, shrink wave + avatars — must still fit.

## 7. Join screen (ВХОД)
- Name is OPTIONAL. Placeholder: `твоё имя… (необязательно)`. Two paths: `ВОЙТИ →` and `продолжить без имени · как гость`.
- Empty name → auto `Гость-XXXX`, tile tag `ГОСТЬ` (not `ВЫ`), do NOT persist guests to localStorage. Named users persist.
- Room code from URL hash (`#fri-09` default), shown as `КОМНАТА #… · ИЗ ССЫЛКИ`.
- Entrance motion only (staged reveal, masked h1 lines, shine sweep on `РУМ`, 3-layer ambient wave + traveling pulse + drifting orb + pointer parallax). All entrance/CSS motion GPU-only (`transform`/`opacity`).
- NO infinite/looping animations on or around the input field and join button (static at rest; hover/focus glow only).

## 8. Room screen (КОМНАТА)
- Top bar: room label, `N В СЕТИ` count, connection dot + `СТАТУС: ПОДКЛЮЧЁН`.
- Tiles: initial-avatars, lime speaking ring, `ВЫ`/`ГОСТЬ` tag, `МИК ВКЛ`/`МУТ` badge, mini level bars. Compact (avatar ~38px).
- Grid: 3 cols mobile → 4 cols ≥760px → 6 cols ≥1100px. Speaking participants get priority slots. Full roster always reachable (overflow list, never page scroll).
- Central audio-reactive waveform canvas + `ГОВОРИТ: …` / `ЗАДЕРЖКА …МС · OPUS` line.
- Bottom thumb-zone bar: mic toggle, chat (unread badge), emoji, leave. Fixed, above safe-area.

## 9. Emoji reactions
- Big (40–44px buttons) + interactive: tap burst, center flash, feed (`кто что кинул`), tap flying emoji to explode it, double-tap tile = ❤️, haptics via `navigator.vibrate`.
- Picker panel stays open for tap series (closes via toggle/outside tap).
- RATE LIMIT: 1 emoji per 10 seconds per user. Cooldown = greyed panel + `ЖДИ NС` countdown + shake + toast `ЛИМИТ · ЖДИ NС`. Applies to grid taps AND tile double-taps.
- Preview renders reactions LOCALLY ONLY. Real build: `ws.send({t:'react',emoji})` → server relays to room → every client renders. Server must enforce the same 10s limit (never trust client).

## 10. Chat
- Bottom sheet (mobile) / side panel ≥900px (desktop). Sign messages with current name (`Гость-XXXX · СЕЙЧАС` for guests).
- Real build: `chat{text}` over the same WS, server relays to room, no history (or last-20 in memory max).

## 11. Accessibility & perf
- Respect `prefers-reduced-motion`: kill all animation, keep content visible (override `opacity:0` entrance states), hide orb, freeze canvases.
- One rAF loop per canvas, skip work when its view is hidden. Cheap Androids first: no blur-heavy stacks, no layout-thrashing.

## 12. Server protocol (WS, JSON) — real build
`join{name,room} → roster` + peer offers; relay `offer/answer/ice`; `chat{text}`; `react{emoji}` (10s/user limit, drop excess); `leave`; `ping/pong` heartbeat.
