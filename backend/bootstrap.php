<?php
declare(strict_types=1);

namespace AgentTT;

final class ApiError extends \RuntimeException
{
    public int $status;
    public string $errorCode;
    public array $fields;

    public function __construct(int $status, string $errorCode, string $message, array $fields = [])
    {
        parent::__construct($message);
        $this->status = $status;
        $this->errorCode = $errorCode;
        $this->fields = $fields;
    }
}

function dataDirectory(): string
{
    $configured = getenv('AGENTTT_DATA_DIR');
    return $configured !== false && $configured !== ''
        ? rtrim($configured, '/\\')
        : dirname(__DIR__) . DIRECTORY_SEPARATOR . 'storage';
}

function ensureDirectory(string $path): void
{
    if (!is_dir($path) && !@mkdir($path, 0700, true) && !is_dir($path)) {
        throw new \RuntimeException('Unable to prepare data directory.');
    }
}

function utcNow(): string
{
    return gmdate('Y-m-d\TH:i:s\Z');
}

function initializeSession(): void
{
    $sessionDirectory = dataDirectory() . DIRECTORY_SEPARATOR . 'sessions';
    ensureDirectory($sessionDirectory);
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.save_path', $sessionDirectory);
    session_name('agenttt_session');
    $https = isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== '' && $_SERVER['HTTPS'] !== 'off';
    // XAMPP may host several practice copies. Keep each copy's cookie scoped to
    // its public directory; the PHP development server serves public at '/'.
    $scriptName = $_SERVER['SCRIPT_NAME'] ?? '/api/index.php';
    $publicBase = PHP_SAPI === 'cli-server' ? '/' : dirname($scriptName, 2);
    $cookiePath = $publicBase === '/' || $publicBase === '.' ? '/' : rtrim($publicBase, '/') . '/';
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => $cookiePath,
        'secure' => $https,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    if (!session_start()) {
        throw new \RuntimeException('Unable to initialize session.');
    }
    if (!isset($_SESSION['csrf_token']) || !is_string($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
}

function requireCsrf(): void
{
    $supplied = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (!is_string($supplied) || !hash_equals($_SESSION['csrf_token'], $supplied)) {
        throw new ApiError(403, 'CSRF_INVALID', '請重新整理頁面後再試一次。');
    }
}

function readJsonBody(): array
{
    $contentType = strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0]));
    if ($contentType !== 'application/json') {
        throw new ApiError(400, 'INVALID_JSON', '請使用 JSON 格式傳送資料。');
    }
    if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 16384) {
        throw new ApiError(413, 'REQUEST_TOO_LARGE', '資料內容超過允許長度。');
    }
    $raw = file_get_contents('php://input', false, null, 0, 16385);
    if ($raw === false || strlen($raw) > 16384) {
        throw new ApiError(413, 'REQUEST_TOO_LARGE', '資料內容超過允許長度。');
    }
    try {
        $decoded = json_decode($raw, false, 32, JSON_THROW_ON_ERROR);
    } catch (\JsonException $error) {
        throw new ApiError(400, 'INVALID_JSON', '資料格式錯誤，請重新確認。');
    }
    if (!$decoded instanceof \stdClass) {
        throw new ApiError(400, 'INVALID_JSON', '資料必須是 JSON 物件。');
    }
    return get_object_vars($decoded);
}

function rejectUnknownFields(array $body, array $allowed): void
{
    $unexpected = array_diff(array_keys($body), $allowed);
    if ($unexpected !== []) {
        $fields = [];
        // Do not echo arbitrary caller-controlled keys into an error payload.
        $fields['request'] = '請只傳送此操作允許的欄位。';
        throw new ApiError(422, 'VALIDATION_ERROR', '請確認資料欄位。', $fields);
    }
}

function jsonResponse(mixed $data, int $status = 200): void
{
    http_response_code($status);
    if ($status !== 204) {
        echo json_encode(['data' => $data], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }
}

require_once __DIR__ . '/database.php';
require_once __DIR__ . '/trips.php';
require_once __DIR__ . '/trip-details.php';
require_once __DIR__ . '/expense-summary.php';
require_once __DIR__ . '/api.php';
