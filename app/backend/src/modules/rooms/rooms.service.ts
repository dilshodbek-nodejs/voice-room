import type { MediaGateway } from '../media/gateway.interface.js';
import type { Participant, Role, Room } from '../persistence/models.js';
import type { RoomRepo, UserRepo } from '../persistence/repos.js';
import type { TokenService } from '../tokens/token.service.js';

export interface JoinResult {
  room: Room;
  participant: Participant;
  sfuUrl: string;
  token: string;
}

const normalizeRoom = (raw: string): string => (raw || 'FRI-09').toUpperCase().slice(0, 12);
const guestName = (): string => 'Гость-' + Math.floor(1000 + Math.random() * 9000);

export class RoomService {
  // Per-room promise chain: concurrent joins serialize so exactly one host is elected.
  private locks = new Map<string, Promise<void>>();

  constructor(
    private rooms: RoomRepo,
    private users: UserRepo,
    private tokens: TokenService,
    private gateway: MediaGateway,
    private defaults: { maxPeers: number; openMic: boolean; sfuTokenTtlSec: number },
  ) {}

  private async withRoomLock<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(roomId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((res) => {
      release = res;
    });
    this.locks.set(roomId, prev.then(() => current));
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(roomId) === current) this.locks.delete(roomId);
    }
  }

  async join(opts: { roomRaw: string; userId?: string; name?: string }): Promise<JoinResult> {
    const roomId = normalizeRoom(opts.roomRaw);
    return this.withRoomLock(roomId, async () => this.joinInner(roomId, opts.userId, opts.name));
  }

  private async joinInner(roomId: string, userIdOpt?: string, nameOpt?: string): Promise<JoinResult> {
    const room = await this.rooms.getOrCreate(roomId, {
      openMic: this.defaults.openMic,
      maxPeers: this.defaults.maxPeers,
    });

    let userId = userIdOpt ?? null;
    let displayName = (nameOpt ?? '').trim().slice(0, 20);
    let guest = false;
    if (userId) {
      const u = await this.users.findById(userId);
      if (u) {
        displayName = displayName || u.name;
        guest = u.guest;
      } else {
        userId = null;
      }
    }
    if (!userId) {
      if (!displayName) {
        displayName = guestName();
        guest = true;
      }
      const created = await this.users.create(displayName, guest);
      userId = created.id;
    }

    const existing = await this.rooms.listParticipants(roomId);
    if (!existing.some((p) => p.userId === userId) && existing.length >= room.maxPeers) {
      throw Object.assign(new Error('ROOM_FULL'), { code: 'ROOM_FULL', status: 409 });
    }

    // First participant becomes host; later ones follow the room's open-mic policy.
    const role: Role =
      existing.length === 0 ? 'host' : room.openMic ? 'speaker' : 'listener';

    const participant: Participant = {
      roomId,
      userId,
      name: displayName,
      guest,
      role,
      muted: false,
      handRaised: false,
    };
    await this.rooms.upsertParticipant(participant);
    await this.rooms.logSession(roomId, userId, 'join');

    // Resilient: LiveKit auto-creates rooms on first participant connect,
    // so a temporarily unreachable SFU must not fail the join itself.
    await this.gateway.ensureRoom(roomId, room.maxPeers).catch(() => undefined);
    const { url, token } = await this.tokens.credentialsFor(userId, displayName, roomId, role);
    return { room, participant, sfuUrl: url, token };
  }

  async leave(roomId: string, userId: string): Promise<void> {
    const id = normalizeRoom(roomId);
    await this.gateway.removeParticipant(id, userId).catch(() => undefined);
    await this.rooms.removeParticipant(id, userId);
    await this.rooms.logSession(id, userId, 'leave');
  }

  async setMuted(roomId: string, userId: string, muted: boolean): Promise<Participant | null> {
    const id = normalizeRoom(roomId);
    await this.gateway.setParticipantMuted(id, userId, muted).catch(() => undefined);
    return this.rooms.setMuted(id, userId, muted);
  }

  async raiseHand(roomId: string, userId: string, raised: boolean): Promise<Participant | null> {
    return this.rooms.setHandRaised(normalizeRoom(roomId), userId, raised);
  }

  async promote(roomId: string, actorUserId: string, targetUserId: string, role: Role): Promise<Participant | null> {
    const id = normalizeRoom(roomId);
    const parts = await this.rooms.listParticipants(id);
    const actor = parts.find((p) => p.userId === actorUserId);
    if (!actor || actor.role !== 'host') {
      throw Object.assign(new Error('FORBIDDEN'), { code: 'FORBIDDEN', status: 403 });
    }
    const updated = await this.rooms.setRole(id, targetUserId, role);
    if (updated && role === 'listener') {
      await this.gateway.setParticipantMuted(id, targetUserId, true).catch(() => undefined);
    }
    return updated;
  }

  async endRoom(roomId: string, actorUserId: string): Promise<void> {
    const id = normalizeRoom(roomId);
    const parts = await this.rooms.listParticipants(id);
    const actor = parts.find((p) => p.userId === actorUserId);
    if (!actor || actor.role !== 'host') {
      throw Object.assign(new Error('FORBIDDEN'), { code: 'FORBIDDEN', status: 403 });
    }
    await this.gateway.endRoom(id);
    for (const p of parts) await this.rooms.removeParticipant(id, p.userId);
    await this.rooms.logSession(id, actorUserId, 'end');
  }
}
