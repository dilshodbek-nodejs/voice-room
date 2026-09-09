import { Router } from 'express';
import type { RoomRepo } from '../persistence/repos.js';
import type { PresenceBus } from '../persistence/presence.js';

// LiveKit pushes room/participant lifecycle events here. The verifier is injected
// so unit tests don't need real signed webhooks (hexagonal boundary).
export type WebhookVerifier = (rawBody: Buffer, authHeader: string) => Promise<{
  event: string;
  room?: { name?: string };
  participant?: { identity?: string };
}>;

export function webhookRoutes(verifier: WebhookVerifier, rooms: RoomRepo, bus: PresenceBus): Router {
  const r = Router();

  r.post('/livekit', async (req, res) => {
    const authHeader = req.headers.authorization ?? '';
    let evt: { event: string; room?: { name?: string }; participant?: { identity?: string } };
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      evt = await verifier(Buffer.concat(chunks), authHeader);
    } catch {
      res.status(401).json({ error: 'BAD_SIGNATURE' });
      return;
    }

    const roomId = (evt.room?.name ?? '').toUpperCase();
    const userId = evt.participant?.identity ?? null;
    try {
      switch (evt.event) {
        case 'participant_joined':
          if (roomId && userId) {
            await bus.setOnline(roomId, userId, 120);
            await rooms.logSession(roomId, userId, 'sfu_joined');
            await bus.publish(roomId, 'presence');
          }
          break;
        case 'participant_left':
          if (roomId && userId) {
            await bus.removeOnline(roomId, userId);
            await rooms.logSession(roomId, userId, 'sfu_left');
            await bus.publish(roomId, 'presence');
          }
          break;
        case 'room_finished':
          if (roomId) await bus.publish(roomId, 'room_ended');
          break;
        default:
          break; // track_published/unpublished etc. — no app-state change needed
      }
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'WEBHOOK_FAILED' });
    }
  });

  return r;
}
