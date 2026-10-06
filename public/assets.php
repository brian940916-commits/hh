<?php
declare(strict_types=1);

// Explicit filenames work on Windows and never expose backend files or SQLite.
$allowed = [
    'shared-styles.css' => 'text/css; charset=utf-8',
    'assets/images/車埕站.jpg' => 'image/jpeg',
    'assets/images/彰化扇形車庫.jpg' => 'image/jpeg',
    'assets/images/集集站.jpg' => 'image/jpeg',
];
$file = $_GET['file'] ?? '';
if (!is_string($file) || !isset($allowed[$file])) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo '找不到資源';
    exit;
}
$path = dirname(__DIR__) . '/' . $file;
if (!is_file($path)) {
    http_response_code(404);
    exit;
}
header('Content-Type: ' . $allowed[$file]);
header('X-Content-Type-Options: nosniff');
header('Cache-Control: public, max-age=300');
readfile($path);
