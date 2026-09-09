import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { FakeGateway } from '../media/livekit.gateway.js';
import { MemoryRoomRepo, MemoryUserRepo } from '../persistence/memory.repos.js';
import { MemoryPresenceBus } from '../persistence/presence.js';
import { RoomService } from '../rooms/rooms.service.js';
import { TokenService } from '../tokens/token.service.js';
import { RealtimeHub } from './hub.js';

// Fake socket implementing the surface RealtimeHub uses (on/send/readyState/close).
class FakeSocket extends EventEmitter {
  readyState = 1;
  readonly outbox: unknown[] = [];
  send(data: string): void {
    this.outbox.push(JSON.parse(data));
  }
  receive(obj: unknown): void {
    this.emit('message', Buffer.from(JSON.stringify(obj)));
  }
  closeIt(): void {
    this.emit('close');
  }
  ofType(t: string): unknown[] {
    return this.outbox.filter((m) => (m as { t: string }).t === t);
  }
}

function setup() {
  const rooms = new MemoryRoomRepo();
  const users = new MemoryUserRepo();
  const gateway = new FakeGateway();
  const tokens = new TokenService(
    { mint: async ({ identity, room, role }) => `tok:${identity}:${room}:${role}` },
    'wss://sfu.test',
    900,
  );
  const svc = new RoomService(rooms, users, tokens, gateway, { maxPeers: 10, openMic: true, sfuTokenTtlSec: 900 });
  const hub = new RealtimeHub(svc, rooms, new MemoryPresenceBus(), {
    joinRatePerMin: 100,
    chatThrottleMs: 1000,
    reactCooldownMs: 10000,
  });
  return { hub, rooms };
}

describe('realtime hub: two users hear-presence, chat, react, mute', () => {
  it('full session: join → presence → chat → react+limit → mute → leave → ping', async () => {
    const { hub, rooms } = setup();
    const alice = new FakeSocket();
    const bob = new FakeSocket();
    hub.attach(alice as unknown as WebSocket, '1.1.1.1');
    hub.attach(bob as unknown as WebSocket, '2.2.2.2');

    alice.receive({ t: 'join', name: 'Алиса', room: 'test-01' });
    bob.receive({ t: 'join', name: '', room: 'test-01' });
    await new Promise((r) => setTimeout(r, 50));

    // 1. roster for both; bob auto-guest
    const rosterA = alice.ofType('roster').at(-1) as { you: { name: string }; peers: unknown[]; room: string };
    expect(rosterA.you.name).toBe('Алиса');
    expect(rosterA.room).toBe('TEST-01');
    const rosterB = bob.ofType('roster').at(-1) as { you: { name: string; guest: boolean }; peers: unknown[] };
    expect(rosterB.you.name).toMatch(/^Гость-\d{4}$/);
    expect(rosterB.you.guest).toBe(true);
    expect(rosterB.peers).toHaveLength(1);

    // 2. alice saw peer-joined; roles persisted (host/speaker)
    expect(alice.ofType('peer-joined')).toHaveLength(1);
    const parts = await rooms.listParticipants('TEST-01');
    expect(parts.map((p) => p.role).sort()).toEqual(['host', 'speaker']);

    // 3. chat: bob → alice gets it, bob gets me:true echo
    bob.receive({ t: 'chat', text: 'привет' });
    await new Promise((r) => setTimeout(r, 20));
    const chatA = alice.ofType('chat').at(-1) as { text: string; fromName: string; me?: boolean };
    expect(chatA.text).toBe('привет');
    expect(chatA.me).toBeUndefined();
    const chatB = bob.ofType('chat').at(-1) as { me?: boolean };
    expect(chatB.me).toBe(true);

    // 4. react relay + server-enforced 10s cooldown
    bob.receive({ t: 'react', emoji: '🔥' });
    await new Promise((r) => setTimeout(r, 20));
    expect((alice.ofType('react').at(-1) as { emoji: string }).emoji).toBe('🔥');
    bob.receive({ t: 'react', emoji: '😂' });
    await new Promise((r) => setTimeout(r, 20));
    const err = bob.ofType('error').at(-1) as { code: string; waitMs: number };
    expect(err.code).toBe('RATE_LIMIT');
    expect(err.waitMs).toBeGreaterThan(0);

    // 5. mute: bob mutes → alice sees peer-state, repo updated
    bob.receive({ t: 'state', muted: true });
    await new Promise((r) => setTimeout(r, 20));
    expect((alice.ofType('peer-state').at(-1) as { muted: boolean }).muted).toBe(true);
    const bobId = (rosterB.you as { name: string }).name;
    void bobId;
    const after = await rooms.listParticipants('TEST-01');
    expect(after.find((p) => p.name.startsWith('Гость'))?.muted).toBe(true);

    // 6. leave: bob leaves → alice sees peer-left
    const bobPeerId = (alice.ofType('peer-joined')[0] as { peer: { id: string } }).peer.id;
    bob.receive({ t: 'leave' });
    await new Promise((r) => setTimeout(r, 20));
    expect((alice.ofType('peer-left').at(-1) as { peerId: string }).peerId).toBe(bobPeerId);

    // 7. ping/pong with echo ts
    alice.receive({ t: 'ping', ts: 123 });
    await new Promise((r) => setTimeout(r, 20));
    expect((alice.ofType('pong').at(-1) as { ts: number }).ts).toBe(123);

    // 8. chat throttle: second message within window is rejected
    alice.receive({ t: 'chat', text: 'one' });
    alice.receive({ t: 'chat', text: 'two' });
    await new Promise((r) => setTimeout(r, 20));
    const errs = alice.ofType('error').filter((e) => (e as { code: string }).code === 'RATE_LIMIT');
    expect(errs.length).toBeGreaterThanOrEqual(1);
  });
});
