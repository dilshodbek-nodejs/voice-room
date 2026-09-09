import { Router } from 'express';
import { z } from 'zod';
import { optionalAuth, requireAuth, type AuthedRequest } from '../auth/auth.middleware.js';
import type { AuthService } from '../auth/auth.service.js';
import type { Role } from '../persistence/models.js';
import type { RoomService } from './rooms.service.js';

const joinSchema = z.object({ name: z.string().trim().max(20).optional() });
const mutedSchema = z.object({ muted: z.boolean() });
const handSchema = z.object({ raised: z.boolean() });
const promoteSchema = z.object({ userId: z.string().min(1), role: z.enum(['speaker', 'listener']) });

function toStatus(err: unknown): number {
  return typeof (err as { status?: unknown }).status === 'number'
    ? ((err as { status: number }).status as number)
    : 500;
}

export function roomsRoutes(auth: AuthService, rooms: RoomService): Router {
  const r = Router();

  // Join (or auto-create) a room. Auth optional → guests allowed, like v1.
  r.post('/:id/join', optionalAuth(auth), async (req: AuthedRequest, res) => {
    const parsed = joinSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'INVALID_BODY' });
      return;
    }
    try {
      const result = await rooms.join({
        roomRaw: req.params.id,
        userId: req.user?.sub,
        name: parsed.data.name ?? req.user?.name,
      });
      res.json(result);
    } catch (err) {
      res.status(toStatus(err)).json({ error: (err as Error).message });
    }
  });

  r.post('/:id/leave', optionalAuth(auth), async (req: AuthedRequest, res) => {
    const userId = req.user?.sub ?? (req.body?.userId as string | undefined);
    if (!userId) {
      res.status(400).json({ error: 'MISSING_USER' });
      return;
    }
    await rooms.leave(req.params.id, userId);
    res.json({ ok: true });
  });

  r.post('/:id/mute', optionalAuth(auth), async (req: AuthedRequest, res) => {
    const parsed = mutedSchema.safeParse(req.body ?? {});
    const userId = req.user?.sub ?? (req.body?.userId as string | undefined);
    if (!parsed.success || !userId) {
      res.status(400).json({ error: 'INVALID_BODY' });
      return;
    }
    const p = await rooms.setMuted(req.params.id, userId, parsed.data.muted);
    res.json({ participant: p });
  });

  r.post('/:id/hand', optionalAuth(auth), async (req: AuthedRequest, res) => {
    const parsed = handSchema.safeParse(req.body ?? {});
    const userId = req.user?.sub ?? (req.body?.userId as string | undefined);
    if (!parsed.success || !userId) {
      res.status(400).json({ error: 'INVALID_BODY' });
      return;
    }
    const p = await rooms.raiseHand(req.params.id, userId, parsed.data.raised);
    res.json({ participant: p });
  });

  r.post('/:id/promote', optionalAuth(auth), requireAuth, async (req: AuthedRequest, res) => {
    const parsed = promoteSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'INVALID_BODY' });
      return;
    }
    try {
      const p = await rooms.promote(req.params.id, req.user!.sub, parsed.data.userId, parsed.data.role as Role);
      res.json({ participant: p });
    } catch (err) {
      res.status(toStatus(err)).json({ error: (err as Error).message });
    }
  });

  r.post('/:id/end', optionalAuth(auth), requireAuth, async (req: AuthedRequest, res) => {
    try {
      await rooms.endRoom(req.params.id, req.user!.sub);
      res.json({ ok: true });
    } catch (err) {
      res.status(toStatus(err)).json({ error: (err as Error).message });
    }
  });

  return r;
}
