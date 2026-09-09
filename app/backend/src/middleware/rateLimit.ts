import rateLimit from 'express-rate-limit';

// REST abuse protection (WS has its own per-session throttles in the hub).
export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'RATE_LIMIT' },
});

export const joinLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'RATE_LIMIT' },
});
