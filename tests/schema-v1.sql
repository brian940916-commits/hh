-- Frozen schema from first-phase commit 625fea6; migration regression fixture.
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    phone TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('guest', 'host', 'admin')),
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS trips (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL CHECK (end_date >= start_date),
    station TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'completed', 'cancelled')),
    status_manual INTEGER NOT NULL DEFAULT 0 CHECK (status_manual IN (0, 1)),
    budget INTEGER NOT NULL DEFAULT 0 CHECK (budget >= 0),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS trip_members (
    trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
    joined_at TEXT NOT NULL,
    PRIMARY KEY (trip_id, user_id)
);
CREATE TABLE IF NOT EXISTS request_receipts (
    user_id TEXT NOT NULL REFERENCES users(id),
    operation TEXT NOT NULL,
    request_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, operation, request_key)
);
CREATE INDEX IF NOT EXISTS trips_owner_idx ON trips(owner_id);
CREATE INDEX IF NOT EXISTS trip_members_user_idx ON trip_members(user_id);
PRAGMA user_version=1;
