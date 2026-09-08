// VOICE ROOM — signal server (express + ws, ESM)
// Спека: BACKEND_INTEGRATION.md §2/§7. Ин-memory, без БД.
// Перф-решения: без permessage-deflate (меньше латентности на мелких JSON),
// один JSON.stringify на broadcast, maxPayload-лимит, heartbeat-терминация.

import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT) || 2021;
const MAX_PEERS = 10;
const ROOM_GRACE_MS = 10_000;
const REACT_COOLDOWN_MS = 10_000;
const CHAT_THROTTLE_MS = 1_000;
const CHAT_MAX_LEN = 500;
const NAME_MAX_LEN = 20;
const ROOM_MAX_LEN = 12;
const MSG_MAX_BYTES = 64 * 1024;
const JOIN_RATE_WINDOW_MS = 60_000;
const JOIN_RATE_MAX = 10;

// ---------- .env (без зависимости dotenv) ----------
import { readFileSync } from 'node:fs';
try {
  for (const line of readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch (_) { /* .env не обязателен */ }

// ---------- ICE из ENV ----------
function iceServers() {
  const list = [{ urls: process.env.STUN_URL || 'stun:stun.l.google.com:19302' }];
  const turnUrls = [process.env.TURN_URL, process.env.TURN_URL_TCP].filter(Boolean);
  if (turnUrls.length) {
    list.push({
      urls: turnUrls,
      username: process.env.TURN_USER || undefined,
      credential: process.env.TURN_PASS || undefined,
    });
  }
  return list;
}
const ICE_JSON = JSON.stringify(iceServers()); // строка один раз — переиспользуем в roster

// ---------- состояние ----------
/** @type {Map<string, Room>} */
const rooms = new Map();

class Room {
  constructor(id) {
    this.id = id;
    this.peers = new Map();          // peerId -> peer
    this.reactAt = new Map();        // peerId -> last react ts (server-enforced 10s)
    this.chatAt = new Map();         // peerId -> last chat ts
    this.emptySince = 0;             // grace timer
  }
  broadcast(str, excludeId = null) {
    for (const p of this.peers.values()) {
      if (p.id !== excludeId && p.ws.readyState === 1) p.ws.send(str);
    }
  }
  rosterJSON() {
    const peers = [];
    for (const p of this.peers.values()) peers.push({ id: p.id, name: p.name, guest: p.guest, muted: p.muted });
    return peers;
  }
}

function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }

// ---------- rate limit join по IP ----------
const joinHits = new Map(); // ip -> [ts...]
function joinAllowed(ip) {
  const now = Date.now();
  const arr = (joinHits.get(ip) || []).filter((t) => now - t < JOIN_RATE_WINDOW_MS);
  if (arr.length >= JOIN_RATE_MAX) { joinHits.set(ip, arr); return false; }
  arr.push(now); joinHits.set(ip, arr);
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, arr] of joinHits) {
    const fresh = arr.filter((t) => now - t < JOIN_RATE_WINDOW_MS);
    if (fresh.length) joinHits.set(ip, fresh); else joinHits.delete(ip);
  }
}, 30_000).unref();

// ---------- HTTP: статика dist ----------
const app = express();
app.disable('x-powered-by');
app.use(express.static(DIST, { maxAge: '1h', setHeaders(res, p) { if (p.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); } }));
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  res.sendFile(path.join(DIST, 'index.html'), (err) => err && res.status(404).end());
});

const server = http.createServer(app);

// ---------- WS ----------
const wss = new WebSocketServer({
  server,
  path: '/ws',
  perMessageDeflate: false,   // перф: мелкие JSON, сжатие только добавляет латентность/CPU
  maxPayload: MSG_MAX_BYTES,
});

function onRoomEmpty(room) {
  room.emptySince = Date.now();
  setTimeout(() => {
    if (room.peers.size === 0 && rooms.get(room.id) === room && Date.now() - room.emptySince >= ROOM_GRACE_MS - 100) {
      rooms.delete(room.id);
    }
  }, ROOM_GRACE_MS);
}

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress || 'unknown';
  ws.peer = null;      // { id, name, guest, muted, roomId }
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    if (raw.length > MSG_MAX_BYTES) return;
    let msg;
    try { msg = JSON.parse(raw); } catch (_) { return; }
    if (!msg || typeof msg.t !== 'string') return;

    switch (msg.t) {
      case 'join': handleJoin(ws, msg, ip); break;
      case 'offer':
      case 'answer':
      case 'ice': relaySignal(ws, msg); break;
      case 'chat': handleChat(ws, msg); break;
      case 'react': handleReact(ws, msg); break;
      case 'state': handleState(ws, msg); break;       // { muted } — без renegotiation
      case 'speaking': handleSpeaking(ws, msg); break; // клиентский VAD, троттлится клиентом
      case 'leave': dropPeer(ws); break;
      case 'ping': send(ws, { t: 'pong', ts: msg.ts ?? Date.now() }); break;
      default: break;
    }
  });

  ws.on('close', () => dropPeer(ws));
  ws.on('error', () => dropPeer(ws));
});

function handleJoin(ws, msg, ip) {
  if (ws.peer) return;                       // уже в комнате
  if (!joinAllowed(ip)) return send(ws, { t: 'error', code: 'RATE_LIMIT', message: 'Слишком много попыток входа' });

  const roomId = String(msg.room || 'FRI-09').toUpperCase().slice(0, ROOM_MAX_LEN);
  let room = rooms.get(roomId);
  if (!room) { room = new Room(roomId); rooms.set(roomId, room); }
  else if (room.peers.size >= MAX_PEERS) return send(ws, { t: 'error', code: 'ROOM_FULL', message: 'Комната заполнена (2–10 чел)' });
  else room.emptySince = 0;                  // комната снова живая

  const rawName = typeof msg.name === 'string' ? msg.name.trim() : '';
  const guest = !rawName;
  const name = guest
    ? 'Гость-' + Math.floor(1000 + Math.random() * 9000)
    : rawName.slice(0, NAME_MAX_LEN);

  ws.peer = { id: crypto.randomUUID(), name, guest, muted: false, roomId };

  // 1) новому: roster + iceServers
  send(ws, { t: 'roster', you: { ...peerPublic(ws.peer), you: true }, peers: room.rosterJSON(), room: roomId, iceServers: JSON.parse(ICE_JSON) });

  // 2) остальным: peer-joined → старые делают offer (deterministic, no glare)
  room.peers.set(ws.peer.id, { ...ws.peer, ws });
  room.broadcast(JSON.stringify({ t: 'peer-joined', peer: peerPublic(ws.peer) }), ws.peer.id);
}

function peerPublic(p) { return { id: p.id, name: p.name, guest: p.guest, muted: p.muted }; }

function relaySignal(ws, msg) {
  const p = ws.peer;
  if (!p || typeof msg.to !== 'string') return;
  const target = rooms.get(p.roomId)?.peers.get(msg.to);
  if (!target || target.ws.readyState !== 1) return;
  // ретранслируем as-is + from; sdp/candidate не валидируем глубоко (размер ограничен maxPayload)
  target.ws.send(JSON.stringify({ t: msg.t, from: p.id, ...(msg.t === 'ice' ? { candidate: msg.candidate } : { sdp: msg.sdp }) }));
}

function handleChat(ws, msg) {
  const p = ws.peer;
  if (!p || typeof msg.text !== 'string') return;
  const text = msg.text.trim().slice(0, CHAT_MAX_LEN);
  if (!text) return;
  const room = rooms.get(p.roomId);
  if (!room) return;
  const now = Date.now();
  const last = room.chatAt.get(p.id) || 0;
  if (now - last < CHAT_THROTTLE_MS) return send(ws, { t: 'error', code: 'RATE_LIMIT', message: 'Слишком часто · подожди секунду' });
  room.chatAt.set(p.id, now);
  const base = { t: 'chat', from: p.id, fromName: p.name, text, ts: now };
  room.broadcast(JSON.stringify(base), p.id);           // остальным
  send(ws, { ...base, me: true });                      // эхо отправителю
}

function handleReact(ws, msg) {
  const p = ws.peer;
  if (!p || typeof msg.emoji !== 'string' || msg.emoji.length > 8) return;
  const room = rooms.get(p.roomId);
  if (!room) return;
  const now = Date.now();
  const last = room.reactAt.get(p.id) || 0;
  if (now - last < REACT_COOLDOWN_MS) {
    return send(ws, { t: 'error', code: 'RATE_LIMIT', message: 'ЛИМИТ · ЖДИ ' + Math.ceil((REACT_COOLDOWN_MS - (now - last)) / 1000) + 'С', waitMs: REACT_COOLDOWN_MS - (now - last) });
  }
  room.reactAt.set(p.id, now);
  room.broadcast(JSON.stringify({ t: 'react', from: p.id, fromName: p.name, emoji: msg.emoji, ts: now }));
}

function handleState(ws, msg) {
  const p = ws.peer;
  if (!p) return;
  if (typeof msg.muted === 'boolean') {
    p.muted = msg.muted;
    const peer = rooms.get(p.roomId)?.peers.get(p.id);
    if (peer) peer.muted = msg.muted;
    rooms.get(p.roomId)?.broadcast(JSON.stringify({ t: 'peer-state', peerId: p.id, muted: msg.muted }));
  }
}

function handleSpeaking(ws, msg) {
  const p = ws.peer;
  if (!p || typeof msg.speaking !== 'boolean') return;
  rooms.get(p.roomId)?.broadcast(JSON.stringify({ t: 'speaking', peerId: p.id, speaking: msg.speaking }), p.id);
}

function dropPeer(ws) {
  const p = ws.peer;
  if (!p) return;
  ws.peer = null;
  const room = rooms.get(p.roomId);
  if (!room) return;
  room.peers.delete(p.id);
  room.reactAt.delete(p.id);
  room.chatAt.delete(p.id);
  room.broadcast(JSON.stringify({ t: 'peer-left', peerId: p.id }));
  if (room.peers.size === 0) onRoomEmpty(room);
}

// ---------- heartbeat: рвём мёртвые соединения ----------
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);
heartbeat.unref();

server.listen(PORT, () => {
  console.log(`[voice-room] http+ws на :${PORT} · static: ${DIST}`);
});
