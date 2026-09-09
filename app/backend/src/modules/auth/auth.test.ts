import { describe, expect, it } from 'vitest';
import { AuthService } from './auth.service.js';
import { MemoryUserRepo } from '../persistence/memory.repos.js';

const svc = () => new AuthService('test-secret', 900, 3600);

describe('auth.service', () => {
  it('issues a verifiable access + refresh pair', () => {
    const pair = svc().issue('u1', 'Алиса', false);
    const claims = svc().verify(pair.accessToken, 'access');
    expect(claims.sub).toBe('u1');
    expect(claims.name).toBe('Алиса');
    expect(claims.guest).toBe(false);
  });

  it('rejects tokens of the wrong type', () => {
    const pair = svc().issue('u1', 'А', false);
    expect(() => svc().verify(pair.refreshToken, 'access')).toThrow();
    expect(() => svc().verify(pair.accessToken, 'refresh')).toThrow();
  });

  it('rejects tampered tokens', () => {
    const pair = svc().issue('u1', 'А', false);
    expect(() => svc().verify(pair.accessToken + 'x', 'access')).toThrow();
  });

  it('refreshes a session via user lookup', async () => {
    const users = new MemoryUserRepo();
    const u = await users.create('Боб', true);
    const pair = svc().issue(u.id, u.name, true);
    const next = await svc().refresh(pair.refreshToken, async (id) => {
      const found = await users.findById(id);
      return found ? { name: found.name, guest: found.guest } : null;
    });
    expect(svc().verify(next.accessToken, 'access').sub).toBe(u.id);
  });

  it('refuses refresh for deleted users', async () => {
    const pair = svc().issue('ghost', 'Г', true);
    await expect(svc().refresh(pair.refreshToken, async () => null)).rejects.toThrow();
  });
});
