import { describe, expect, it } from 'vitest';
import { FakeGateway, LiveKitGateway } from './livekit.gateway.js';

describe('media gateway', () => {
  it('FakeGateway records calls without network (test double)', async () => {
    const g = new FakeGateway();
    await g.ensureRoom('R1', 10);
    await g.setParticipantMuted('R1', 'u1', true);
    await g.removeParticipant('R1', 'u1');
    await g.endRoom('R1');
    expect(g.calls.map((c) => c.method)).toEqual([
      'ensureRoom',
      'setParticipantMuted',
      'removeParticipant',
      'endRoom',
    ]);
  });

  it('LiveKitGateway constructs offline (connection happens per call)', () => {
    const g = new LiveKitGateway('ws://localhost:7880', 'devkey', 'secret');
    expect(g).toBeDefined();
  });
});
