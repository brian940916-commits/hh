<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

try {
    require_once dirname(__DIR__) . '/backend/bootstrap.php';
    $db = \AgentTT\openDatabase();
    $version = (int) $db->query('PRAGMA user_version')->fetchColumn();
    fwrite(STDOUT, "Database ready (schema version {$version}); existing data preserved.\n");
} catch (Throwable $error) {
    fwrite(STDERR, "Database initialization failed. Check PDO SQLite and data directory permissions.\n");
    exit(1);
}
