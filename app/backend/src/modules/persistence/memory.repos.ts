import { randomUUID } from 'node:crypto';
import type { Participant, Role, Room, User } from './models.js';
import type { RoomRepo, UserRepo } from './repos.js';

// In-memory implementations: used by unit tests and as a zero-dependency dev fallback.
export class MemoryUserRepo implements UserRepo {
  private users = new Map<string, User>();
  async create(name: string, guest: boolean): Promise<User> {
    const user: User = { id: randomUUID(), name, guest };
    this.users.set(user.id, user);
    return user;
  }
  async findById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }
}

export class MemoryRoomRepo implements RoomRepo {
  private rooms = new Map<string, Room>();
  private parts = new Map<string, Map<string, Participant>>(); // roomId -> userId -> p
  readonly sessions: Array<{ roomId: string; userId: string | null; event: string }> = [];

  async getOrCreate(id: string, defaults: { openMic: boolean; maxPeers: number }): Promise<Room> {
    let room = this.rooms.get(id);
    if (!room) {
      room = { id, openMic: defaults.openMic, maxPeers: defaults.maxPeers };
      this.rooms.set(id, room);
      this.parts.set(id, new Map());
    }
    return room;
  }
  async get(id: string): Promise<Room | null> {
    return this.rooms.get(id) ?? null;
  }
  private bucket(roomId: string): Map<string, Participant> {
    let b = this.parts.get(roomId);
    if (!b) {
      b = new Map();
      this.parts.set(roomId, b);
    }
    return b;
  }
  async listParticipants(roomId: string): Promise<Participant[]> {
    return [...this.bucket(roomId).values()];
  }
  async upsertParticipant(p: Participant): Promise<Participant> {
    this.bucket(p.roomId).set(p.userId, { ...p });
    return p;
  }
  async removeParticipant(roomId: string, userId: string): Promise<void> {
    this.bucket(roomId).delete(userId);
  }
  async setRole(roomId: string, userId: string, role: Role): Promise<Participant | null> {
    const p = this.bucket(roomId).get(userId);
    if (!p) return null;
    p.role = role;
    return p;
  }
  async setMuted(roomId: string, userId: string, muted: boolean): Promise<Participant | null> {
    const p = this.bucket(roomId).get(userId);
    if (!p) return null;
    p.muted = muted;
    return p;
  }
  async setHandRaised(roomId: string, userId: string, raised: boolean): Promise<Participant | null> {
    const p = this.bucket(roomId).get(userId);
    if (!p) return null;
    p.handRaised = raised;
    return p;
  }
  async countParticipants(roomId: string): Promise<number> {
    return this.bucket(roomId).size;
  }
  async logSession(roomId: string, userId: string | null, event: string): Promise<void> {
    this.sessions.push({ roomId, userId, event });
  }
}
