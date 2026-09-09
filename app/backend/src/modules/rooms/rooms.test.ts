import { describe, expect, it } from 'vitest';
import { FakeGateway } from '../media/livekit.gateway.js';
import { MemoryRoomRepo, MemoryUserRepo } from '../persistence/memory.repos.js';
import { TokenService } from '../tokens/token.service.js';
import { RoomService } from './rooms.service.js';

function setup(openMic = true) {
  const rooms = new MemoryRoomRepo();
  const users = new MemoryUserRepo();
  const gateway = new FakeGateway();
  const tokens = new TokenService(
    { mint: async ({ identity, room, role }) => `sfu-token:${identity}:${room}:${role}` },
    'wss://sfu.test',
    900,
  );
  const svc = new RoomService(rooms, users, tokens, gateway, { maxPeers: 3, openMic, sfuTokenTtlSec: 900 });
  return { rooms, users, gateway, svc };
}

describe('rooms.service', () => {
  it('first joiner becomes host, gets SFU credentials', async () => {
    const { svc, gateway } = setup();
    const r = await svc.join({ roomRaw: 'fri-09', name: 'Алиса' });
    expect(r.room.id).toBe('FRI-09');
    expect(r.participant.role).toBe('host');
    expect(r.sfuUrl).toBe('wss://sfu.test');
    expect(r.token).toContain('speaker'.length ? 'host' : 'host');
    expect(gateway.calls[0]).toEqual({ method: 'ensureRoom', args: ['FRI-09', 3] });
  });

  it('later joiners become speakers when openMic, listeners otherwise', async () => {
    const open = setup(true);
    await open.svc.join({ roomRaw: 'r1', name: 'A' });
    const b = await open.svc.join({ roomRaw: 'r1', name: 'B' });
    expect(b.participant.role).toBe('speaker');

    const closed = setup(false);
    await closed.svc.join({ roomRaw: 'r2', name: 'A' });
    const b2 = await closed.svc.join({ roomRaw: 'r2', name: 'B' });
    expect(b2.participant.role).toBe('listener');
  });

  it('empty name auto-provisions Гость-XXXX', async () => {
    const { svc } = setup();
    const r = await svc.join({ roomRaw: 'r3' });
    expect(r.participant.name).toMatch(/^Гость-\d{4}$/);
    expect(r.participant.guest).toBe(true);
  });

  it('enforces room capacity', async () => {
    const { svc } = setup();
    await svc.join({ roomRaw: 'r4', name: 'A' });
    await svc.join({ roomRaw: 'r4', name: 'B' });
    await svc.join({ roomRaw: 'r4', name: 'C' });
    await expect(svc.join({ roomRaw: 'r4', name: 'D' })).rejects.toThrowError('ROOM_FULL');
  });

  it('mute updates the participant and the SFU', async () => {
    const { svc, gateway } = setup();
    const a = await svc.join({ roomRaw: 'r5', name: 'A' });
    const p = await svc.setMuted('r5', a.participant.userId, true);
    expect(p?.muted).toBe(true);
    expect(gateway.calls).toContainEqual({
      method: 'setParticipantMuted',
      args: ['R5', a.participant.userId, true],
    });
  });

  it('only the host can promote; demoting to listener mutes on the SFU', async () => {
    const { svc, gateway } = setup();
    const a = await svc.join({ roomRaw: 'r6', name: 'A' });
    const b = await svc.join({ roomRaw: 'r6', name: 'B' });
    await expect(svc.promote('r6', b.participant.userId, a.participant.userId, 'listener')).rejects.toThrowError(
      'FORBIDDEN',
    );
    const updated = await svc.promote('r6', a.participant.userId, b.participant.userId, 'listener');
    expect(updated?.role).toBe('listener');
    expect(gateway.calls).toContainEqual({
      method: 'setParticipantMuted',
      args: ['R6', b.participant.userId, true],
    });
  });

  it('leave removes the participant and kicks from the SFU', async () => {
    const { svc, rooms, gateway } = setup();
    const a = await svc.join({ roomRaw: 'r7', name: 'A' });
    await svc.leave('r7', a.participant.userId);
    expect(await rooms.countParticipants('R7')).toBe(0);
    expect(gateway.calls).toContainEqual({
      method: 'removeParticipant',
      args: ['R7', a.participant.userId],
    });
  });
});
