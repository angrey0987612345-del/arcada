CREATE TABLE IF NOT EXISTS coop_rooms (
  id TEXT PRIMARY KEY,
  capacity INTEGER NOT NULL DEFAULT 2,
  started BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coop_members (
  room_id TEXT NOT NULL REFERENCES coop_rooms(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL,
  member_key TEXT NOT NULL,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room_id, slot),
  UNIQUE (room_id, member_key)
);

CREATE TABLE IF NOT EXISTS coop_messages (
  seq BIGSERIAL PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES coop_rooms(id) ON DELETE CASCADE,
  from_slot INTEGER NOT NULL,
  msg_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (room_id, msg_id)
);

CREATE INDEX IF NOT EXISTS coop_messages_room_seq_idx ON coop_messages (room_id, seq);
