import jwt from 'jsonwebtoken';

export interface JwtClaims {
  sub: string; // user id
  name: string;
  guest: boolean;
  type: 'access' | 'refresh';
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export class AuthService {
  constructor(
    private secret: string,
    private accessTtlSec: number,
    private refreshTtlSec: number,
  ) {
    if (!secret) throw new Error('JWT_SECRET is required');
  }

  issue(userId: string, name: string, guest: boolean): TokenPair {
    const accessToken = jwt.sign(
      { sub: userId, name, guest, type: 'access' } satisfies JwtClaims,
      this.secret,
      { expiresIn: this.accessTtlSec },
    );
    const refreshToken = jwt.sign(
      { sub: userId, name, guest, type: 'refresh' } satisfies JwtClaims,
      this.secret,
      { expiresIn: this.refreshTtlSec },
    );
    return { accessToken, refreshToken };
  }

  verify(token: string, type: 'access' | 'refresh' = 'access'): JwtClaims {
    const claims = jwt.verify(token, this.secret) as JwtClaims;
    if (claims.type !== type) throw new Error('wrong token type');
    return claims;
  }

  refresh(refreshToken: string, lookup: (userId: string) => Promise<{ name: string; guest: boolean } | null>): Promise<TokenPair> {
    return (async () => {
      const claims = this.verify(refreshToken, 'refresh');
      const user = await lookup(claims.sub);
      if (!user) throw new Error('unknown user');
      return this.issue(claims.sub, user.name, user.guest);
    })();
  }
}
