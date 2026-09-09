import type { NextFunction, Request, Response } from 'express';
import type { AuthService, JwtClaims } from './auth.service.js';

export interface AuthedRequest extends Request {
  user?: JwtClaims;
}

// Optional auth: guests without token are allowed and handled downstream as guests.
export function optionalAuth(auth: AuthService) {
  return (req: AuthedRequest, _res: Response, next: NextFunction): void => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (token) {
      try {
        req.user = auth.verify(token, 'access');
      } catch {
        // fall through as guest; routes decide
      }
    }
    next();
  };
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return;
  }
  next();
}
