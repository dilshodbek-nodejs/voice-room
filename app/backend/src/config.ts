import 'dotenv/config';

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}
function str(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

export const config = {
  port: num('PORT', 2021),
  jwtSecret: str('JWT_SECRET', 'change-me-in-production'),
  jwtAccessTtl: num('JWT_ACCESS_TTL', 900),
  jwtRefreshTtl: num('JWT_REFRESH_TTL', 2592000),
  sfuTokenTtl: num('SFU_TOKEN_TTL', 21600),
  databaseUrl: str('DATABASE_URL', ''),
  redisUrl: str('REDIS_URL', ''),
  livekitUrl: str('LIVEKIT_URL', 'ws://localhost:7880'),
  livekitPublicUrl: str('LIVEKIT_PUBLIC_URL', '') || str('LIVEKIT_URL', 'ws://localhost:7880'),
  livekitApiKey: str('LIVEKIT_API_KEY', 'devkey'),
  livekitApiSecret: str('LIVEKIT_API_SECRET', 'change-me-livekit-secret'),
  roomMaxPeers: num('ROOM_MAX_PEERS', 10),
  roomDefaultOpenMic: (process.env.ROOM_DEFAULT_OPEN_MIC ?? 'true') !== 'false',
  joinRatePerMin: num('JOIN_RATE_PER_MIN', 10),
  chatThrottleMs: num('CHAT_THROTTLE_MS', 1000),
  reactCooldownMs: num('REACT_COOLDOWN_MS', 10000),
  isProd: (process.env.NODE_ENV ?? '') === 'production',
} as const;
