import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { LiveKitTokenMinter, TokenService } from './token.service.js';

describe('tokens', () => {
  it('mints role-scoped LiveKit grants (host/speaker/listener)', async () => {
    const minter = new LiveKitTokenMinter('devkey', 'secretsecretsecretsecretsecretsecret12');
    for (const [role, canPublish, roomAdmin] of [
      ['host', true, true],
      ['speaker', true, false],
      ['listener', false, false],
    ] as const) {
      const token = await minter.mint({ identity: 'u1', name: 'А', room: 'FRI-09', role, ttlSec: 900 });
      const decoded = jwt.decode(token) as { video?: Record<string, unknown>; sub?: string };
      expect(decoded.sub).toBe('u1');
      expect(decoded.video?.roomJoin).toBe(true);
      expect(decoded.video?.room).toBe('FRI-09');
      expect(decoded.video?.canPublish).toBe(canPublish);
      expect(decoded.video?.canSubscribe).toBe(true);
      expect(decoded.video?.roomAdmin ?? false).toBe(roomAdmin);
    }
  });

  it('TokenService returns public SFU url + token', async () => {
    const svc = new TokenService(
      { mint: async () => 'tok123' },
      'wss://sfu.example',
      900,
    );
    const creds = await svc.credentialsFor('u9', 'Б', 'R1', 'speaker');
    expect(creds).toEqual({ url: 'wss://sfu.example', token: 'tok123' });
  });
});
