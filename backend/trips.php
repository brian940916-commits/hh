<?php
declare(strict_types=1);

namespace AgentTT;

function findReadableTrip(\PDO $db, string $id, string $userId): array
{
    $statement = $db->prepare('SELECT t.* FROM trips t WHERE t.id = ? AND (t.owner_id = ? OR EXISTS (SELECT 1 FROM trip_members m WHERE m.trip_id = t.id AND m.user_id = ?))');
    $statement->execute([$id, $userId, $userId]);
    $row = $statement->fetch();
    if ($row === false) {
        throw new ApiError(404, 'TRIP_NOT_FOUND', '找不到這個行程。');
    }
    return $row;
}

function requireTripOwner(array $row, array $user): void
{
    if ($row['owner_id'] !== $user['id'] || $user['role'] !== 'guest') {
        throw new ApiError(403, 'FORBIDDEN', '只有行程建立者可以修改基本資料。');
    }
}

function serializeTrip(\PDO $db, array $row, array $user): array
{
    $statement = $db->prepare('SELECT m.user_id, u.name, u.email, m.role, m.joined_at FROM trip_members m JOIN users u ON u.id = m.user_id WHERE m.trip_id = ? ORDER BY CASE m.role WHEN \'owner\' THEN 0 ELSE 1 END, m.joined_at, m.user_id');
    $statement->execute([$row['id']]);
    $members = [];
    foreach ($statement->fetchAll() as $member) {
        $members[] = [
            'userId' => $member['user_id'], 'name' => $member['name'],
            'email' => $member['email'], 'role' => $member['role'], 'joinedAt' => $member['joined_at'],
        ];
    }
    $today = (new \DateTimeImmutable('today', new \DateTimeZone('Asia/Taipei')))->format('Y-m-d');
    $statusManual = (bool) $row['status_manual'];
    $effectiveStatus = $row['status'] === 'planning' && !$statusManual && $row['end_date'] < $today
        ? 'completed' : $row['status'];
    return [
        'id' => $row['id'], 'ownerId' => $row['owner_id'], 'name' => $row['name'],
        'startDate' => $row['start_date'], 'endDate' => $row['end_date'],
        'station' => $row['station'], 'status' => $row['status'],
        'effectiveStatus' => $effectiveStatus, 'statusManual' => $statusManual,
        'budget' => (int) $row['budget'], 'version' => (int) $row['version'],
        'createdAt' => $row['created_at'], 'updatedAt' => $row['updated_at'],
        'members' => $members,
        'canEdit' => $row['owner_id'] === $user['id'] && $user['role'] === 'guest',
    ];
}

function validateVersion(mixed $version): int
{
    if (!is_int($version) || $version < 1) {
        throw new ApiError(422, 'VALIDATION_ERROR', '請確認行程版本。', ['version' => '版本必須是正整數。']);
    }
    return $version;
}

function requireCurrentVersion(array $row, int $version): void
{
    if ((int) $row['version'] !== $version) {
        throw new ApiError(409, 'VERSION_CONFLICT', '行程已在其他頁面更新，請重新載入後再操作。');
    }
}

function validDate(mixed $value): bool
{
    if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}$/D', $value)) {
        return false;
    }
    if (!checkdate((int) substr($value, 5, 2), (int) substr($value, 8, 2), (int) substr($value, 0, 4))) {
        return false;
    }
    $date = \DateTimeImmutable::createFromFormat('!Y-m-d', $value, new \DateTimeZone('Asia/Taipei'));
    return $date !== false && $date->format('Y-m-d') === $value;
}

/** Validate merged fields for PATCH so date order is checked across old/new values. */
function validateTripFields(array $values): array
{
    $errors = [];
    foreach (['name' => '行程名稱', 'station' => '目的地車站'] as $key => $label) {
        $value = $values[$key] ?? null;
        if (is_string($value)) {
            $value = preg_replace('/^\s+|\s+$/u', '', $value);
            $length = preg_match_all('/./us', $value);
            if ($length === false || $length < 1 || $length > 80 || preg_match('/[\x00-\x1F\x7F]/u', $value)) {
                $errors[$key] = $label . '須為 1 至 80 個字，且不能含控制字元。';
            }
            $values[$key] = $value;
        } else {
            $errors[$key] = '請填寫' . $label . '。';
        }
    }
    foreach (['startDate' => '出發日期', 'endDate' => '返回日期'] as $key => $label) {
        if (!validDate($values[$key] ?? null)) {
            $errors[$key] = $label . '必須是有效的 YYYY-MM-DD 日期。';
        }
    }
    if (validDate($values['startDate'] ?? null)
        && validDate($values['endDate'] ?? null) && $values['endDate'] < $values['startDate']) {
        $errors['endDate'] = '返回日期不能早於出發日期。';
    }
    if (!isset($values['budget']) || !is_int($values['budget']) || $values['budget'] < 0 || $values['budget'] > 1000000000) {
        $errors['budget'] = '預算須為 0 至 1,000,000,000 的整數。';
    }
    if (!is_string($values['status'] ?? null) || !in_array($values['status'], ['planning', 'completed', 'cancelled'], true)) {
        $errors['status'] = '行程狀態無效。';
    }
    if ($errors !== []) {
        throw new ApiError(422, 'VALIDATION_ERROR', '請確認行程資料。', $errors);
    }
    return $values;
}

function createTrip(\PDO $db, array $user, array $body): array
{
    if ($user['role'] !== 'guest') {
        throw new ApiError(403, 'FORBIDDEN', '旅客帳號才可以建立行程。');
    }
    rejectUnknownFields($body, ['name', 'startDate', 'endDate', 'station', 'budget']);
    $fields = validateTripFields([
        'name' => $body['name'] ?? null, 'startDate' => $body['startDate'] ?? null,
        'endDate' => $body['endDate'] ?? null, 'station' => $body['station'] ?? null,
        'budget' => array_key_exists('budget', $body) ? $body['budget'] : 0, 'status' => 'planning',
    ]);
    $key = $_SERVER['HTTP_IDEMPOTENCY_KEY'] ?? '';
    if (!is_string($key) || !preg_match('/^[A-Za-z0-9._:-]{8,128}$/D', $key)) {
        throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', '請提供有效的建立請求識別碼。');
    }
    $payloadHash = hash('sha256', json_encode($fields, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));
    return writeTransaction($db, function () use ($db, $user, $fields, $key, $payloadHash): array {
        $receipt = $db->prepare("SELECT payload_hash, response_json FROM request_receipts WHERE user_id = ? AND operation = 'create_trip' AND request_key = ?");
        $receipt->execute([$user['id'], $key]);
        $previous = $receipt->fetch();
        if ($previous !== false) {
            if (!hash_equals($previous['payload_hash'], $payloadHash)) {
                throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', '此請求識別碼已用於不同的行程資料。');
            }
            return json_decode($previous['response_json'], true, 32, JSON_THROW_ON_ERROR);
        }
        $id = 'trip_' . bin2hex(random_bytes(12));
        $now = utcNow();
        $statement = $db->prepare('INSERT INTO trips (id, owner_id, name, start_date, end_date, station, budget, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
        $statement->execute([$id, $user['id'], $fields['name'], $fields['startDate'], $fields['endDate'], $fields['station'], $fields['budget'], $now, $now]);
        $member = $db->prepare("INSERT INTO trip_members (trip_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)");
        $member->execute([$id, $user['id'], $now]);
        $response = serializeTrip($db, findReadableTrip($db, $id, $user['id']), $user);
        $saveReceipt = $db->prepare("INSERT INTO request_receipts (user_id, operation, request_key, payload_hash, response_json, created_at) VALUES (?, 'create_trip', ?, ?, ?, ?)");
        $saveReceipt->execute([$user['id'], $key, $payloadHash, json_encode($response, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), $now]);
        return $response;
    });
}

function updateTrip(\PDO $db, array $user, string $id, array $body): array
{
    rejectUnknownFields($body, ['version', 'name', 'startDate', 'endDate', 'station', 'budget', 'status']);
    $version = validateVersion($body['version'] ?? null);
    if (count($body) < 2) {
        throw new ApiError(422, 'VALIDATION_ERROR', '請至少選擇一個要修改的欄位。');
    }
    return writeTransaction($db, function () use ($db, $user, $id, $body, $version): array {
        $row = findReadableTrip($db, $id, $user['id']);
        requireTripOwner($row, $user);
        requireCurrentVersion($row, $version);
        $values = [
            'name' => $row['name'], 'startDate' => $row['start_date'], 'endDate' => $row['end_date'],
            'station' => $row['station'], 'budget' => (int) $row['budget'], 'status' => $row['status'],
        ];
        foreach ($values as $field => $unused) {
            if (array_key_exists($field, $body)) {
                $values[$field] = $body[$field];
            }
        }
        $values = validateTripFields($values);
        $manual = array_key_exists('status', $body) ? 1 : (int) $row['status_manual'];
        $statement = $db->prepare('UPDATE trips SET name = ?, start_date = ?, end_date = ?, station = ?, budget = ?, status = ?, status_manual = ?, version = version + 1, updated_at = ? WHERE id = ? AND owner_id = ? AND version = ?');
        $statement->execute([$values['name'], $values['startDate'], $values['endDate'], $values['station'], $values['budget'], $values['status'], $manual, utcNow(), $id, $user['id'], $version]);
        if ($statement->rowCount() !== 1) {
            throw new ApiError(409, 'VERSION_CONFLICT', '行程已更新，請重新載入後再操作。');
        }
        return serializeTrip($db, findReadableTrip($db, $id, $user['id']), $user);
    });
}

function removeTrip(\PDO $db, array $user, string $id, array $body): void
{
    rejectUnknownFields($body, ['version']);
    $version = validateVersion($body['version'] ?? null);
    writeTransaction($db, function () use ($db, $user, $id, $version): void {
        $row = findReadableTrip($db, $id, $user['id']);
        requireTripOwner($row, $user);
        requireCurrentVersion($row, $version);
        $statement = $db->prepare('DELETE FROM trips WHERE id = ? AND owner_id = ? AND version = ?');
        $statement->execute([$id, $user['id'], $version]);
        if ($statement->rowCount() !== 1) {
            throw new ApiError(409, 'VERSION_CONFLICT', '行程已更新，請重新載入後再操作。');
        }
    });
}
