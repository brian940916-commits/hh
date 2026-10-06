<?php
declare(strict_types=1);

namespace AgentTT;

function openDatabase(): \PDO
{
    if (!extension_loaded('pdo_sqlite')) {
        throw new \RuntimeException('PDO SQLite is required.');
    }
    $directory = dataDirectory();
    ensureDirectory($directory);
    $databaseFile = $directory . DIRECTORY_SEPARATOR . 'agenttt.sqlite';
    $db = new \PDO('sqlite:' . $databaseFile, null, null, [
        \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
        \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
        \PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    @chmod($databaseFile, 0600);
    $db->exec('PRAGMA foreign_keys = ON');
    $db->exec('PRAGMA busy_timeout = 5000');
    if ((int) $db->query('PRAGMA user_version')->fetchColumn() === 0) {
        initializeDatabase($db);
    }
    return $db;
}

/** SQLite IMMEDIATE writes serialize before reading receipt/version state. */
function writeTransaction(\PDO $db, callable $operation): mixed
{
    $db->exec('BEGIN IMMEDIATE');
    try {
        $result = $operation();
        $db->exec('COMMIT');
        return $result;
    } catch (\Throwable $error) {
        try {
            $db->exec('ROLLBACK');
        } catch (\Throwable $ignored) {
            // Keep the original failure if SQLite already rolled back.
        }
        throw $error;
    }
}

function initializeDatabase(\PDO $db): void
{
    writeTransaction($db, function () use ($db): void {
        // Another connection may have initialized while this connection waited.
        if ((int) $db->query('PRAGMA user_version')->fetchColumn() !== 0) {
            return;
        }
        $db->exec(<<<'SQL'
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
SQL);
        $now = utcNow();
        $insertUser = $db->prepare('INSERT OR IGNORE INTO users (id, name, email, phone, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
        $passwordHash = password_hash('test123', PASSWORD_DEFAULT);
        foreach ([
            ['u_guest_01', '王小明', 'test@test.com', '0912345678', 'guest'],
            ['u_guest_02', '另一位旅客', 'other@test.com', '0922334455', 'guest'],
            ['u_host_01', '民宿主人', 'host@test.com', '0987654321', 'host'],
            ['u_admin_01', '平台管理員', 'admin@test.com', '', 'admin'],
        ] as [$id, $name, $email, $phone, $role]) {
            $insertUser->execute([$id, $name, $email, $phone, $passwordHash, $role, $now]);
        }
        $today = new \DateTimeImmutable('today', new \DateTimeZone('Asia/Taipei'));
        $insertTrip = $db->prepare('INSERT OR IGNORE INTO trips (id, owner_id, name, start_date, end_date, station, budget, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
        $insertTrip->execute([
            'trip_demo_01', 'u_guest_01', '集集鐵道練習行程',
            $today->modify('+7 days')->format('Y-m-d'),
            $today->modify('+8 days')->format('Y-m-d'), '集集站', 3000, $now, $now,
        ]);
        $ownerMember = $db->prepare("INSERT OR IGNORE INTO trip_members (trip_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)");
        $ownerMember->execute(['trip_demo_01', 'u_guest_01', $now]);
        $db->exec('PRAGMA user_version = 1');
    });
}

function safeUser(array $row): array
{
    return [
        'id' => $row['id'],
        'name' => $row['name'],
        'email' => $row['email'],
        'phone' => $row['phone'],
        'role' => $row['role'],
        'createdAt' => $row['created_at'],
    ];
}

function currentUser(\PDO $db): ?array
{
    $id = $_SESSION['user_id'] ?? null;
    if (!is_string($id)) {
        return null;
    }
    $statement = $db->prepare('SELECT id, name, email, phone, role, created_at FROM users WHERE id = ?');
    $statement->execute([$id]);
    $row = $statement->fetch();
    if ($row === false) {
        unset($_SESSION['user_id']);
        return null;
    }
    return safeUser($row);
}

function requireUser(\PDO $db): array
{
    $user = currentUser($db);
    if ($user === null) {
        throw new ApiError(401, 'UNAUTHENTICATED', '請先登入再操作。');
    }
    // Another tab may have changed the shared session. Identify the server's
    // actual actor even when a later authorization, CSRF or version check fails.
    header('X-AgentTT-User-Id: ' . $user['id']);
    return $user;
}
