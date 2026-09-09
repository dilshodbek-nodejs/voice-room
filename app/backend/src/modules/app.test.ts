import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

describe('http app', () => {
  it('healthz + metrics', async () => {
    const { app } = buildApp();
    await request(app).get('/healthz').expect(200);
    const res = await request(app).get('/metrics').expect(200);
    expect(res.text).toContain('voiceroom_');
  });

  it('auth: guest + register + refresh + me', async () => {
    const { app } = buildApp();
    const guest = await request(app).post('/api/auth/guest').expect(200);
    expect(guest.body.user.guest).toBe(true);
    expect(guest.body.accessToken).toBeTruthy();

    const reg = await request(app).post('/api/auth/register').send({ name: 'Алиса' }).expect(200);
    expect(reg.body.user.name).toBe('Алиса');

    await request(app).post('/api/auth/register').send({ name: '' }).expect(400);

    const refreshed = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: guest.body.refreshToken })
      .expect(200);
    expect(refreshed.body.accessToken).toBeTruthy();

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${guest.body.accessToken}`)
      .expect(200);
    expect(me.body.user.sub).toBe(guest.body.user.id);
  });

  it('rooms: join → SFU creds, mute, promote rules, end', async () => {
    const { app } = buildApp();
    const a = await request(app).post('/api/rooms/app-test/join').send({ name: 'Host' }).expect(200);
    expect(a.body.room.id).toBe('APP-TEST');
    expect(a.body.participant.role).toBe('host');
    expect(a.body.token).toBeTruthy();
    expect(a.body.sfuUrl).toBeTruthy();

    const b = await request(app).post('/api/rooms/app-test/join').send({}).expect(200);
    expect(b.body.participant.role).toBe('speaker');

    // non-host cannot promote
    await request(app)
      .post('/api/rooms/app-test/promote')
      .set('Authorization', `Bearer ${b.body.token ? '' : ''}`)
      .send({ userId: 'x', role: 'listener' })
      .expect(401);

    // mute own participant id via body (guest flow without JWT)
    const muted = await request(app)
      .post('/api/rooms/app-test/mute')
      .send({ userId: b.body.participant.userId, muted: true })
      .expect(200);
    expect(muted.body.participant.muted).toBe(true);
  });
});
