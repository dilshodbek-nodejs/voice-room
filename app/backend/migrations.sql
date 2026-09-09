-- Voice Room schema (Postgres). Applied automatically by docker-compose on first boot.
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 20),
  guest       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rooms (
  id          TEXT PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 12),
  open_mic    BOOLEAN NOT NULL DEFAULT TRUE,
  max_peers   INT NOT NULL DEFAULT 10 CHECK (max_peers BETWEEN 2 AND 50),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  CREATE TYPE room_role AS ENUM ('host', 'speaker', 'listener');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS room_participants (
  room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        room_role NOT NULL DEFAULT 'speaker',
  muted       BOOLEAN NOT NULL DEFAULT FALSE,
  hand_raised BOOLEAN NOT NULL DEFAULT FALSE,
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS room_sessions (
  id          BIGSERIAL PRIMARY KEY,
  room_id     TEXT NOT NULL,
  user_id     UUID,
  event       TEXT NOT NULL,
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_room ON room_sessions(room_id, at DESC);
