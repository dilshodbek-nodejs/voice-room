import { Pool } from 'pg';
import type { Participant, Role, Room, User } from './models.js';
import type { RoomRepo, UserRepo } from './repos.js';

// Postgres implementations. Pool is created lazily so unit tests never touch the network.
let pool: Pool | null = null;
export function getPool(databaseUrl: string): Pool {
  if (!pool) pool = new Pool({ connectionString: databaseUrl, max: 10 });
  return pool;
}

export class PgUserRepo implements UserRepo {
  constructor(private db: { query: Pool['query'] }) {}
  async create(name: string, guest: boolean): Promise<User> {
    const r = await this.db.query('INSERT INTO users(name, guest) VALUES ($1,$2) RETURNING id, name, guest', [name, guest]);
    return r.rows[0] as User;
  }
  async findById(id: string): Promise<User | null> {
    const r = await this.db.query('SELECT id, name, guest FROM users WHERE id=$1', [id]);
    return (r.rows[0] as User) ?? null;
  }
}

export class PgRoomRepo implements RoomRepo {
  constructor(private db: { query: Pool['query'] }) {}
  async getOrCreate(id: string, defaults: { openMic: boolean; maxPeers: number }): Promise<Room> {
    const r = await this.db.query(
      `INSERT INTO rooms(id, open_mic, max_peers) VALUES ($1,$2,$3)
       ON CONFLICT (id) DO UPDATE SET id=EXCLUDED.id
       RETURNING id, open_mic AS "openMic", max_peers AS "maxPeers"`,
      [id, defaults.openMic, defaults.maxPeers],
    );
    return r.rows[0] as Room;
  }
  async get(id: string): Promise<Room | null> {
    const r = await this.db.query('SELECT id, open_mic AS "openMic", max_peers AS "maxPeers" FROM rooms WHERE id=$1', [id]);
    return (r.rows[0] as Room) ?? null;
  }
  async listParticipants(roomId: string): Promise<Participant[]> {
    const r = await this.db.query(
      `SELECT p.room_id AS "roomId", p.user_id AS "userId", u.name, u.guest, p.role, p.muted,
              p.hand_raised AS "handRaised"
       FROM room_participants p JOIN users u ON u.id = p.user_id WHERE p.room_id=$1`,
      [roomId],
    );
    return r.rows as Participant[];
  }
  async upsertParticipant(p: Participant): Promise<Participant> {
    await this.db.query(
      `INSERT INTO room_participants(room_id, user_id, role, muted, hand_raised)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (room_id, user_id) DO UPDATE SET role=EXCLUDED.role, muted=EXCLUDED.muted, hand_raised=EXCLUDED.hand_raised`,
      [p.roomId, p.userId, p.role, p.muted, p.handRaised],
    );
    return p;
  }
  async removeParticipant(roomId: string, userId: string): Promise<void> {
    await this.db.query('DELETE FROM room_participants WHERE room_id=$1 AND user_id=$2', [roomId, userId]);
  }
  private async patch(roomId: string, userId: string, field: 'role' | 'muted' | 'hand_raised', value: unknown): Promise<Participant | null> {
    const r = await this.db.query(
      `UPDATE room_participants SET ${field}=$3 WHERE room_id=$1 AND user_id=$2
       RETURNING room_id AS "roomId", user_id AS "userId", role, muted, hand_raised AS "handRaised"`,
      [roomId, userId, value],
    );
    const row = r.rows[0];
    if (!row) return null;
    const list = await this.listParticipants(roomId);
    return list.find((p) => p.userId === userId) ?? ({ ...row, name: '', guest: false } as Participant);
  }
  setRole(roomId: string, userId: string, role: Role): Promise<Participant | null> {
    return this.patch(roomId, userId, 'role', role);
  }
  setMuted(roomId: string, userId: string, muted: boolean): Promise<Participant | null> {
    return this.patch(roomId, userId, 'muted', muted);
  }
  setHandRaised(roomId: string, userId: string, raised: boolean): Promise<Participant | null> {
    return this.patch(roomId, userId, 'hand_raised', raised);
  }
  async countParticipants(roomId: string): Promise<number> {
    const r = await this.db.query('SELECT COUNT(*)::int AS n FROM room_participants WHERE room_id=$1', [roomId]);
    return r.rows[0].n as number;
  }
  async logSession(roomId: string, userId: string | null, event: string): Promise<void> {
    await this.db.query('INSERT INTO room_sessions(room_id, user_id, event) VALUES ($1,$2,$3)', [roomId, userId, event]);
  }
}
