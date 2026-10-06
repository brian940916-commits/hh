-- Frozen complete schema from phase-two commit 5201d4f.
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
CREATE TABLE IF NOT EXISTS trip_items (
    id TEXT PRIMARY KEY,
    trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL CHECK (end_time > start_time),
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('attraction', 'restaurant', 'activity', 'hotel', 'train')),
    note TEXT NOT NULL DEFAULT '',
    priority TEXT NOT NULL CHECK (priority IN ('must', 'optional')),
    position INTEGER NOT NULL CHECK (position >= 0)
);
CREATE INDEX IF NOT EXISTS trip_items_day_idx ON trip_items(trip_id, date, position);
CREATE TABLE IF NOT EXISTS trip_expenses (
    id TEXT PRIMARY KEY,
    trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount BETWEEN 1 AND 1000000000),
    category TEXT NOT NULL CHECK (category IN ('transport', 'accommodation', 'food', 'activity', 'other')),
    date TEXT NOT NULL,
    payer_id TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    UNIQUE (id, trip_id),
    FOREIGN KEY (trip_id, payer_id) REFERENCES trip_members(trip_id, user_id)
);
CREATE INDEX IF NOT EXISTS trip_expenses_date_idx ON trip_expenses(trip_id, date, id);
CREATE TABLE IF NOT EXISTS expense_participants (
    expense_id TEXT NOT NULL,
    trip_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    PRIMARY KEY (expense_id, user_id),
    FOREIGN KEY (expense_id, trip_id) REFERENCES trip_expenses(id, trip_id) ON DELETE CASCADE,
    FOREIGN KEY (trip_id, user_id) REFERENCES trip_members(trip_id, user_id)
);
PRAGMA user_version=2;
