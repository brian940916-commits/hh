<?php
declare(strict_types=1);

// This router is for `php -S ... -t public public/router.php`, never a public endpoint.
$requested = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$path = is_string($requested) ? rawurldecode($requested) : '';
$segments = explode('/', $path);
$unsafe = strpos($path, "\0") !== false || strpos($path, '\\') !== false;
foreach ($segments as $segment) {
    if ($segment !== '' && ($segment[0] === '.' || $segment === 'storage' || $segment === 'backend' || $segment === 'node_modules')) {
        $unsafe = true;
    }
}
if ($unsafe || $path === '/router.php') {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Not found';
    return true;
}
if ($path === '/api/index.php' || $path === '/api' || str_starts_with($path, '/api/')) {
    if ($path !== '/api/index.php') {
        $_GET['path'] = substr($path, 4) ?: '/';
    }
    require __DIR__ . '/api/index.php';
    return true;
}
if (str_ends_with(strtolower($path), '.php') && !in_array($path, ['/index.php', '/login.php', '/trip-list.php', '/assets.php'], true)) {
    http_response_code(404);
    echo 'Not found';
    return true;
}
$candidate = realpath(__DIR__ . ($path === '/' ? '/index.php' : $path));
if ($candidate !== false && is_file($candidate) && str_starts_with($candidate, __DIR__ . DIRECTORY_SEPARATOR)) {
    return false;
}
http_response_code(404);
header('Content-Type: text/plain; charset=utf-8');
echo 'Not found';
return true;
