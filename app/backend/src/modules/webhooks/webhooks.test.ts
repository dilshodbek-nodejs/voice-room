import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { MemoryRoomRepo } from '../persistence/memory.repos.js';
import { MemoryPresenceBus } from '../persistence/presence.js';
import { webhookRoutes } from './webhooks.routes.js';

function appWith(verifier: Parameters<typeof webhookRoutes>[0]) {
  const app = express();
  app.use('/webhooks', webhookRoutes(verifier, new MemoryRoomRepo(), new MemoryPresenceBus()));
  return app;
}

describe('webhooks', () => {
  it('rejects badly-signed webhooks', async () => {
    const app = appWith(async () => {
      throw new Error('bad signature');
    });
    await request(app).post('/webhooks/livekit').send({}).expect(401);
  });

  it('accepts participant_joined and marks presence', async () => {
    const rooms = new MemoryRoomRepo();
    const bus = new MemoryPresenceBus();
    const seen: string[] = [];
    bus.subscribe((roomId, event) => seen.push(`${roomId}:${event}`));
    const app = express();
    app.use('/webhooks', webhookRoutes(async () => ({
      event: 'participant_joined',
      room: { name: 'FRI-09' },
      participant: { identity: 'u1' },
    }), rooms, bus));
    await request(app).post('/webhooks/livekit').send({}).expect(200);
    expect(await bus.onlineCount('FRI-09')).toBe(1);
    expect(seen).toContain('FRI-09:presence');
    expect(rooms.sessions.at(-1)).toMatchObject({ roomId: 'FRI-09', event: 'sfu_joined' });
  });

  it('accepts participant_left and room_finished', async () => {
    const rooms = new MemoryRoomRepo();
    const bus = new MemoryPresenceBus();
    let evt: { event: string } = { event: 'participant_left' };
    const app = express();
    app.use('/webhooks', webhookRoutes(async () => ({
      ...evt,
      room: { name: 'R9' },
      participant: { identity: 'u7' },
    }), rooms, bus));
    await bus.setOnline('R9', 'u7', 120);
    await request(app).post('/webhooks/livekit').send({}).expect(200);
    expect(await bus.onlineCount('R9')).toBe(0);
    evt = { event: 'room_finished' };
    await request(app).post('/webhooks/livekit').send({}).expect(200);
  });
});
