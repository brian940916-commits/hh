<?php
declare(strict_types=1);

namespace AgentTT;

/** The dispatcher checks the anonymous actor and CSRF before calling this. */
function registerGuest(\PDO $db, array $body): array
{
    rejectUnknownFields($body, ['name', 'email', 'password']);
    $errors = [];
    $name = $body['name'] ?? null;
    if (is_string($name)) {
        $name = preg_replace('/^[\s\p{Z}]+|[\s\p{Z}]+$/u', '', $name);
    }
    if (!is_string($name)) {
        $errors['name'] = '姓名須為 1 至 80 個字，且不能含控制字元。';
    } else {
        $nameLength = preg_match_all('/./us', $name);
        if ($nameLength === false || $nameLength < 1 || $nameLength > 80 || preg_match('/\p{Cc}/u', $name)) {
            $errors['name'] = '姓名須為 1 至 80 個字，且不能含控制字元。';
        }
    }

    $email = $body['email'] ?? null;
    if (is_string($email)) {
        $email = strtolower(trim($email));
    }
    if (!is_string($email) || strlen($email) > 254 || preg_match('/[^\x00-\x7F]/', $email)
        || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        $errors['email'] = '請填寫有效的電子郵件，且不得超過 254 個字元。';
    }

    $password = $body['password'] ?? null;
    if (!is_string($password) || strlen($password) > 72 || str_contains($password, "\0")) {
        $errors['password'] = '密碼至少須有 8 個字，最多 72 bytes，且不能含空字元。';
    } else {
        $passwordLength = preg_match_all('/./us', $password);
        if ($passwordLength === false || $passwordLength < 8) {
            $errors['password'] = '密碼至少須有 8 個字，最多 72 bytes，且不能含空字元。';
        }
    }
    if ($errors !== []) {
        throw new ApiError(422, 'VALIDATION_ERROR', '請確認註冊資料。', $errors);
    }

    $key = idempotencyKey();
    $scope = $_SESSION['registration_scope'] ?? null;
    $hmacKey = $_SESSION['registration_hmac_key'] ?? null;
    if (!is_string($scope) || !preg_match('/^[a-f0-9]{64}$/D', $scope)
        || !is_string($hmacKey) || !preg_match('/^[a-f0-9]{64}$/D', $hmacKey)) {
        // Recreate the pair together if either value is absent or invalid.
        $scope = bin2hex(random_bytes(32));
        $hmacKey = bin2hex(random_bytes(32));
        $_SESSION['registration_scope'] = $scope;
        $_SESSION['registration_hmac_key'] = $hmacKey;
    }
    // The receipt alone must not permit offline password guesses. Its HMAC key
    // remains in the anonymous PHP session, never in the receipt or response.
    $payloadHash = hash_hmac('sha256', json_encode([
        'name' => $name, 'email' => $email, 'password' => $password,
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), $hmacKey);
    $operation = 'register_guest';

    return writeTransaction($db, function () use ($db, $name, $email, $password, $scope, $key, $payloadHash, $operation): array {
        $receiptQuery = $db->prepare('SELECT payload_hash, response_json FROM registration_receipts WHERE scope_id = ? AND operation = ? AND request_key = ?');
        $receiptQuery->execute([$scope, $operation, $key]);
        $receipt = $receiptQuery->fetch();
        if ($receipt !== false) {
            if (!hash_equals($receipt['payload_hash'], $payloadHash)) {
                throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', '此請求識別碼已用於不同的註冊資料。');
            }
            return json_decode($receipt['response_json'], true, 32, JSON_THROW_ON_ERROR);
        }

        $emailQuery = $db->prepare('SELECT 1 FROM users WHERE email = ?');
        $emailQuery->execute([$email]);
        if ($emailQuery->fetchColumn() !== false) {
            throw new ApiError(409, 'ACCOUNT_EXISTS', '這個電子郵件已有帳號，請直接登入。');
        }
        $passwordHash = password_hash($password, PASSWORD_DEFAULT);
        if ($passwordHash === false) {
            throw new \RuntimeException('Unable to prepare account credentials.');
        }
        $now = utcNow();
        $insertUser = $db->prepare("INSERT INTO users (id, name, email, phone, password_hash, role, created_at) VALUES (?, ?, ?, '', ?, 'guest', ?)");
        $insertUser->execute(['user_' . bin2hex(random_bytes(12)), $name, $email, $passwordHash, $now]);
        $response = ['created' => true, 'email' => $email];
        $insertReceipt = $db->prepare('INSERT INTO registration_receipts (scope_id, operation, request_key, payload_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)');
        $insertReceipt->execute([
            $scope, $operation, $key, $payloadHash,
            json_encode($response, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), $now,
        ]);
        // Leave the anonymous session and its CSRF token intact for retries.
        return $response;
    });
}
