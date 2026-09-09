import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { apiLimiter, joinLimiter } from '../middleware/rateLimit.js';
import { AuthService } from './auth/auth.service.js';
import { authRoutes } from './auth/auth.routes.js';
import { LiveKitGateway } from './media/livekit.gateway.js';
import { metricsBody, metrics } from './observability/metrics.js';
import { MemoryRoomRepo, MemoryUserRepo } from './persistence/memory.repos.js';
import { getPool, PgRoomRepo, PgUserRepo } from './persistence/pg.repos.js';
import { MemoryPresenceBus, RedisPresenceBus, type PresenceBus } from './persistence/presence.js';
import type { RoomRepo, UserRepo } from './persistence/repos.js';
import { RealtimeHub } from './realtime/hub.js';
import { RoomService } from './rooms/rooms.service.js';
import { roomsRoutes } from './rooms/rooms.routes.js';
import { TokenService, LiveKitTokenMinter } from './tokens/token.service.js';
import { webhookRoutes, type WebhookVerifier } from './webhooks/webhooks.routes.js';

export interface BuiltApp {
  app: express.Express;
  hub: RealtimeHub;
  bus: PresenceBus;
  close: () => Promise<void>;
}

export function buildApp(): BuiltApp {
  // ---- persistence (Postgres when DATABASE_URL set, memory otherwise) ----
  let users: UserRepo;
  let rooms: RoomRepo;
  if (config.databaseUrl) {
    const pool = getPool(config.databaseUrl);
    users = new PgUserRepo(pool);
    rooms = new PgRoomRepo(pool);
    logger.info('persistence: postgres');
  } else {
    users = new MemoryUserRepo();
    rooms = new MemoryRoomRepo();
    logger.info('persistence: memory (set DATABASE_URL for Postgres)');
  }

  const bus: PresenceBus = config.redisUrl
    ? new RedisPresenceBus(config.redisUrl)
    : new MemoryPresenceBus();

  // ---- domain services ----
  const auth = new AuthService(config.jwtSecret, config.jwtAccessTtl, config.jwtRefreshTtl);
  const tokens = new TokenService(
    new LiveKitTokenMinter(config.livekitApiKey, config.livekitApiSecret),
    config.livekitPublicUrl,
    config.jwtAccessTtl,
  );
  const roomService = new RoomService(rooms, users, tokens, gateway, {
    maxPeers: config.roomMaxPeers,
    openMic: config.roomDefaultOpenMic,
    sfuTokenTtlSec: config.sfuTokenTtl,
  });
  const hub = new RealtimeHub(roomService, rooms, bus, {
    joinRatePerMin: config.joinRatePerMin,
    chatThrottleMs: config.chatThrottleMs,
    reactCooldownMs: config.reactCooldownMs,
  });

  // ---- express ----
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors());
  app.use(express.json({ limit: '64kb' }));
  app.use((req, res, next) => {
    res.on('finish', () => {
      metrics.httpRequests.inc({ method: req.method, route: req.path, status: String(res.statusCode) });
    });
    next();
  });

  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.get('/metrics', async (_req, res) => {
    const { body, contentType } = await metricsBody();
    res.setHeader('Content-Type', contentType).send(body);
  });

  app.use('/api', apiLimiter);
  app.use('/api/auth', authRoutes(auth, users));
  app.use('/api/rooms', joinLimiter, roomsRoutes(auth, roomService));
  app.use(
    '/webhooks',
    webhookRoutes(defaultVerifier, rooms, bus),
  );

  // ---- static frontend (same origin, like v1) ----
  const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'dist');
  app.use(express.static(dist, { maxAge: '1h', setHeaders: (res, p) => {
    if (p.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  } }));
  app.use((req, res, next) => {
    if (req.method !== 'GET') {
      next();
      return;
    }
    res.sendFile(path.join(dist, 'index.html'), (err) => {
      if (err) res.status(404).end();
    });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error('unhandled', { err: String(err) });
    res.status(500).json({ error: 'INTERNAL' });
  });

  return {
    app,
    hub,
    bus,
    close: async () => {
      await bus.close();
      if (config.databaseUrl) await getPool(config.databaseUrl).end().catch(() => undefined);
    },
  };
}

// Media gateway is constructed at module scope so tests can rebuild the app
// with FakeGateway by importing RoomService directly (see rooms.test.ts).
const gateway = new LiveKitGateway(config.livekitUrl, config.livekitApiKey, config.livekitApiSecret);

// Default LiveKit webhook verifier (real signature check in prod).
async function defaultVerifier(rawBody: Buffer, authHeader: string) {
  const { WebhookReceiver } = await import('livekit-server-sdk');
  const receiver = new WebhookReceiver(config.livekitApiKey, config.livekitApiSecret);
  return receiver.receive(rawBody.toString('utf8'), authHeader);
}
