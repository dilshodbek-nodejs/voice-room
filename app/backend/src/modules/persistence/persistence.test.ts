import { describe, expect, it } from 'vitest';
import { MemoryRoomRepo } from './memory.repos.js';
import { MemoryPresenceBus } from './presence.js';

describe('persistence (memory fakes)', () => {
  it('room repo: upsert/list/mute/role/remove + session log', async () => {
    const rooms = new MemoryRoomRepo();
    const room = await rooms.getOrCreate('R1', { openMic: true, maxPeers: 10 });
    expect(room.id).toBe('R1');
    await rooms.upsertParticipant({
      roomId: 'R1', userId: 'u1', name: 'A', guest: false, role: 'host', muted: false, handRaised: false,
    });
    expect(await rooms.countParticipants('R1')).toBe(1);
    await rooms.setMuted('R1', 'u1', true);
    await rooms.setRole('R1', 'u1', 'listener');
    const [p] = await rooms.listParticipants('R1');
    expect(p.muted).toBe(true);
    expect(p.role).toBe('listener');
    await rooms.removeParticipant('R1', 'u1');
    expect(await rooms.countParticipants('R1')).toBe(0);
    await rooms.logSession('R1', 'u1', 'join');
    expect(rooms.sessions).toHaveLength(1);
  });

  it('presence bus: online tracking + fan-out', async () => {
    const bus = new MemoryPresenceBus();
    const seen: string[] = [];
    bus.subscribe((roomId, event) => seen.push(`${roomId}:${event}`));
    await bus.setOnline('R2', 'u1', 60);
    await bus.setOnline('R2', 'u2', 60);
    expect(await bus.onlineCount('R2')).toBe(2);
    await bus.publish('R2', 'presence');
    expect(seen).toEqual(['R2:presence']);
    await bus.removeOnline('R2', 'u1');
    expect(await bus.onlineCount('R2')).toBe(1);
    await bus.close();
  });
});
