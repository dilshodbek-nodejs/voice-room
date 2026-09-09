import type { WebSocket } from 'ws';
import type { RoomService } from '../rooms/rooms.service.js';
import type { RoomRepo } from '../persistence/repos.js';
import type { PresenceBus } from '../persistence/presence.js';
import type { PeerView } from '../persistence/models.js';

// App-level realtime channel (NOT audio — audio flows client <-> LiveKit SFU).
// Message protocol is intentionally identical to the v1 mesh app so the
// existing frontend keeps working: join/chat/react/state/speaking/leave/ping.

interface Session {
  ws: WebSocket;
  peerId: string; // = userId
  roomId: string | null;
  name: string;
  guest: boolean;
  lastChatAt: number;
  lastReactAt: number;
}

const MAX_MSG_BYTES = 64 * 1024;

export class RealtimeHub {
  private sessions = new Map<WebSocket, Session>();
  private joinHits = new Map<string, number[]>();

  constructor(
    private rooms: RoomService,
    private roomRepo: RoomRepo,
    private bus: PresenceBus,
    private opts: { joinRatePerMin: number; chatThrottleMs: number; reactCooldownMs: number },
  ) {
    // Cross-instance fan-out: another backend instance published a presence change.
    bus.subscribe((roomId) => {
      void this.pushRoster(roomId).catch(() => undefined);
    });
  }

  attach(ws: WebSocket, ip: string): void {
    const session: Session = {
      ws,
      peerId: '',
      roomId: null,
      name: '',
      guest: true,
      lastChatAt: 0,
      lastReactAt: 0,
    };
    this.sessions.set(ws, session);

    ws.on('message', (raw) => {
      if (Buffer.byteLength(raw as Buffer) > MAX_MSG_BYTES) return;
      let msg: { t?: string } & Record<string, unknown>;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!msg || typeof msg.t !== 'string') return;
      void this.handle(session, msg as { t: string } & Record<string, unknown>, ip).catch(() => undefined);
    });
    ws.on('close', () => void this.drop(session).catch(() => undefined));
    ws.on('error', () => void this.drop(session).catch(() => undefined));
  }

  private send(ws: WebSocket, obj: unknown): void {
    if (ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  private peersIn(roomId: string): Session[] {
    return [...this.sessions.values()].filter((s) => s.roomId === roomId);
  }

  private broadcast(roomId: string, obj: unknown, excludePeer?: string): void {
    const str = JSON.stringify(obj);
    for (const s of this.peersIn(roomId)) {
      if (s.peerId !== excludePeer && s.ws.readyState === 1) s.ws.send(str);
    }
  }

  private toPeerView(roomId: string, s: Session): PeerView {
    void roomId;
    return { id: s.peerId, name: s.name, guest: s.guest, muted: false };
  }

  private async pushRoster(roomId: string): Promise<void> {
    const parts = await this.roomRepo.listParticipants(roomId);
    const mutedById = new Map(parts.map((p) => [p.userId, p.muted]));
    const guestById = new Map(parts.map((p) => [p.userId, p.guest]));
    for (const s of this.peersIn(roomId)) {
      const peers: PeerView[] = this.peersIn(roomId)
        .filter((o) => o.peerId !== s.peerId)
        .map((o) => ({
          id: o.peerId,
          name: o.name,
          guest: guestById.get(o.peerId) ?? o.guest,
          muted: mutedById.get(o.peerId) ?? false,
        }));
      this.send(s.ws, {
        t: 'roster',
        you: {
          id: s.peerId,
          name: s.name,
          guest: guestById.get(s.peerId) ?? s.guest,
          muted: mutedById.get(s.peerId) ?? false,
          you: true,
        },
        peers,
        room: roomId,
        iceServers: [],
      });
    }
  }

  private joinAllowed(ip: string): boolean {
    const now = Date.now();
    const arr = (this.joinHits.get(ip) ?? []).filter((t) => now - t < 60_000);
    if (arr.length >= this.opts.joinRatePerMin) {
      this.joinHits.set(ip, arr);
      return false;
    }
    arr.push(now);
    this.joinHits.set(ip, arr);
    return true;
  }

  private async handle(session: Session, msg: { t: string } & Record<string, unknown>, ip: string): Promise<void> {
    switch (msg.t) {
      case 'join': {
        if (session.roomId || !this.joinAllowed(ip)) {
          if (session.roomId) return;
          this.send(session.ws, { t: 'error', code: 'RATE_LIMIT', message: 'Слишком много попыток входа' });
          return;
        }
        const name = typeof msg.name === 'string' ? msg.name : '';
        const roomRaw = typeof msg.room === 'string' ? msg.room : 'FRI-09';
        let result;
        try {
          result = await this.rooms.join({ roomRaw, name });
        } catch (err) {
          this.send(session.ws, { t: 'error', code: (err as Error).message, message: 'Комната заполнена (2–10 чел)' });
          return;
        }
        session.peerId = result.participant.userId;
        session.roomId = result.room.id;
        session.name = result.participant.name;
        session.guest = result.participant.guest;
        await this.bus.setOnline(result.room.id, session.peerId, 120);
        await this.bus.publish(result.room.id, 'presence');
        // Tell existing peers (they render peer-joined) then push full roster to everyone incl. self.
        this.broadcast(result.room.id, {
          t: 'peer-joined',
          peer: { id: session.peerId, name: session.name, guest: session.guest, muted: false },
        }, session.peerId);
        await this.pushRoster(result.room.id);
        // SFU credentials ride along for the future LiveKit frontend (ignored by v1 client).
        this.send(session.ws, { t: 'sfu', url: result.sfuUrl, token: result.token });
        break;
      }
      case 'chat': {
        if (!session.roomId || typeof msg.text !== 'string') return;
        const text = msg.text.trim().slice(0, 500);
        if (!text) return;
        const now = Date.now();
        if (now - session.lastChatAt < this.opts.chatThrottleMs) {
          this.send(session.ws, { t: 'error', code: 'RATE_LIMIT', message: 'Слишком часто · подожди секунду' });
          return;
        }
        session.lastChatAt = now;
        const base = { t: 'chat', from: session.peerId, fromName: session.name, text, ts: now };
        this.broadcast(session.roomId, base, session.peerId);
        this.send(session.ws, { ...base, me: true });
        break;
      }
      case 'react': {
        if (!session.roomId || typeof msg.emoji !== 'string' || msg.emoji.length > 8) return;
        const now = Date.now();
        if (now - session.lastReactAt < this.opts.reactCooldownMs) {
          this.send(session.ws, {
            t: 'error',
            code: 'RATE_LIMIT',
            message: 'ЛИМИТ · ЖДИ ' + Math.ceil((this.opts.reactCooldownMs - (now - session.lastReactAt)) / 1000) + 'С',
            waitMs: this.opts.reactCooldownMs - (now - session.lastReactAt),
          });
          return;
        }
        session.lastReactAt = now;
        this.broadcast(session.roomId, { t: 'react', from: session.peerId, fromName: session.name, emoji: msg.emoji, ts: now });
        break;
      }
      case 'state': {
        if (!session.roomId || typeof msg.muted !== 'boolean') return;
        await this.rooms.setMuted(session.roomId, session.peerId, msg.muted);
        this.broadcast(session.roomId, { t: 'peer-state', peerId: session.peerId, muted: msg.muted });
        break;
      }
      case 'speaking': {
        if (!session.roomId || typeof msg.speaking !== 'boolean') return;
        this.broadcast(session.roomId, { t: 'speaking', peerId: session.peerId, speaking: msg.speaking }, session.peerId);
        break;
      }
      case 'leave':
        await this.drop(session);
        break;
      case 'ping':
        this.send(session.ws, { t: 'pong', ts: typeof msg.ts === 'number' ? msg.ts : Date.now() });
        break;
      default:
        break;
    }
  }

  private async drop(session: Session): Promise<void> {
    this.sessions.delete(session.ws);
    if (!session.roomId || !session.peerId) return;
    const { roomId, peerId } = session;
    session.roomId = null;
    await this.rooms.leave(roomId, peerId).catch(() => undefined);
    await this.bus.removeOnline(roomId, peerId);
    await this.bus.publish(roomId, 'presence');
    this.broadcast(roomId, { t: 'peer-left', peerId });
  }
}
