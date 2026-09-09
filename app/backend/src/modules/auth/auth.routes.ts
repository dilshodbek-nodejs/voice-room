import { Router } from 'express';
import { z } from 'zod';
import type { AuthService } from './auth.service.js';
import type { UserRepo } from '../persistence/repos.js';
import { optionalAuth } from './auth.middleware.js';

const guestName = (): string => 'Гость-' + Math.floor(1000 + Math.random() * 9000);
const registerSchema = z.object({ name: z.string().trim().min(1).max(20) });

export function authRoutes(auth: AuthService, users: UserRepo): Router {
  const r = Router();

  // Named account (persisted name; still no password — friends app, JWT is the session).
  r.post('/register', async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'INVALID_NAME' });
      return;
    }
    const user = await users.create(parsed.data.name, false);
    res.json({ user, ...auth.issue(user.id, user.name, false) });
  });

  // Guest identity — mirrors v1 behavior (Гость-XXXX, never persisted client-side).
  r.post('/guest', async (req, res) => {
    const user = await users.create(guestName(), true);
    res.json({ user, ...auth.issue(user.id, user.name, true) });
  });

  r.post('/refresh', async (req, res) => {
    const { refreshToken } = (req.body ?? {}) as { refreshToken?: string };
    if (!refreshToken) {
      res.status(400).json({ error: 'MISSING_REFRESH_TOKEN' });
      return;
    }
    try {
      const pair = await auth.refresh(refreshToken, async (id) => {
        const u = await users.findById(id);
        return u ? { name: u.name, guest: u.guest } : null;
      });
      res.json(pair);
    } catch {
      res.status(401).json({ error: 'INVALID_REFRESH_TOKEN' });
    }
  });

  r.get('/me', optionalAuth(auth), (req, res) => {
    res.json({ user: (req as { user?: unknown }).user ?? null });
  });

  return r;
}
