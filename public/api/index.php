<?php
declare(strict_types=1);

ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

try {
    require_once dirname(__DIR__, 2) . '/backend/bootstrap.php';
    \AgentTT\dispatchApi();
} catch (\AgentTT\ApiError $error) {
    http_response_code($error->status);
    $payload = ['code' => $error->errorCode, 'message' => $error->getMessage()];
    if ($error->fields !== []) {
        $payload['fields'] = $error->fields;
    }
    echo json_encode(['error' => $payload], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (\Throwable $error) {
    http_response_code(500);
    // Log only the exception class; SQL, filesystem paths and session contents stay private.
    error_log('[AgentTT] API failure: ' . get_class($error));
    echo json_encode(['error' => [
        'code' => 'SERVER_ERROR',
        'message' => '服務暫時無法完成操作，請確認 PHP PDO SQLite 已啟用與資料目錄可寫入。',
    ]], JSON_UNESCAPED_UNICODE);
}
