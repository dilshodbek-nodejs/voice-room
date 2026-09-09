import { AccessToken } from 'livekit-server-sdk';
import type { Role } from '../persistence/models.js';

export interface SfuCredentials {
  url: string;
  token: string;
}

// Role → LiveKit grants. Listeners subscribe only; speakers publish+subscribe;
// hosts additionally get room-admin + data channel rights.
function grantsFor(role: Role): { canPublish: boolean; canSubscribe: boolean; roomAdmin: boolean } {
  switch (role) {
    case 'host':
      return { canPublish: true, canSubscribe: true, roomAdmin: true };
    case 'speaker':
      return { canPublish: true, canSubscribe: true, roomAdmin: false };
    case 'listener':
      return { canPublish: false, canSubscribe: true, roomAdmin: false };
  }
}

export interface TokenMinter {
  mint(opts: { identity: string; name: string; room: string; role: Role; ttlSec: number }): Promise<string>;
}

export class LiveKitTokenMinter implements TokenMinter {
  constructor(
    private apiKey: string,
    private apiSecret: string,
  ) {}
  async mint(opts: { identity: string; name: string; room: string; role: Role; ttlSec: number }): Promise<string> {
    const g = grantsFor(opts.role);
    const token = new AccessToken(this.apiKey, this.apiSecret, {
      identity: opts.identity,
      name: opts.name,
      ttl: opts.ttlSec,
    });
    token.addGrant({ room: opts.room, roomJoin: true, canPublish: g.canPublish, canSubscribe: g.canSubscribe, roomAdmin: g.roomAdmin, canPublishData: true });
    return token.toJwt();
  }
}

export class TokenService {
  constructor(
    private minter: TokenMinter,
    private publicUrl: string,
    private ttlSec: number,
  ) {}
  async credentialsFor(identity: string, name: string, room: string, role: Role): Promise<SfuCredentials> {
    const token = await this.minter.mint({ identity, name, room, role, ttlSec: this.ttlSec });
    return { url: this.publicUrl, token };
  }
}
