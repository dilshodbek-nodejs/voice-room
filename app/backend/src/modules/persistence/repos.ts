import type { Participant, Room, Role, User } from './models.js';

// Repository interfaces — Postgres implements these in prod, memory fakes in tests/dev.
export interface UserRepo {
  create(name: string, guest: boolean): Promise<User>;
  findById(id: string): Promise<User | null>;
}

export interface RoomRepo {
  getOrCreate(id: string, defaults: { openMic: boolean; maxPeers: number }): Promise<Room>;
  get(id: string): Promise<Room | null>;
  listParticipants(roomId: string): Promise<Participant[]>;
  upsertParticipant(p: Participant): Promise<Participant>;
  removeParticipant(roomId: string, userId: string): Promise<void>;
  setRole(roomId: string, userId: string, role: Role): Promise<Participant | null>;
  setMuted(roomId: string, userId: string, muted: boolean): Promise<Participant | null>;
  setHandRaised(roomId: string, userId: string, raised: boolean): Promise<Participant | null>;
  countParticipants(roomId: string): Promise<number>;
  logSession(roomId: string, userId: string | null, event: string): Promise<void>;
}
