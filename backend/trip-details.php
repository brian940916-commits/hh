<?php
declare(strict_types=1);

namespace AgentTT;

function buildTripDetails(\PDO $db, array $row, array $user): array
{
    $trip = serializeTrip($db, $row, $user);
    $itemQuery = $db->prepare('SELECT * FROM trip_items WHERE trip_id = ? ORDER BY date, position, id');
    $itemQuery->execute([$row['id']]);
    $items = [];
    foreach ($itemQuery->fetchAll() as $item) {
        $items[] = serializeItem($item);
    }
    $participantQuery = $db->prepare('SELECT expense_id, user_id FROM expense_participants WHERE trip_id = ? ORDER BY expense_id, user_id');
    $participantQuery->execute([$row['id']]);
    $participants = [];
    foreach ($participantQuery->fetchAll() as $participant) {
        $participants[$participant['expense_id']][] = $participant['user_id'];
    }
    $expenseQuery = $db->prepare('SELECT * FROM trip_expenses WHERE trip_id = ? ORDER BY date, id');
    $expenseQuery->execute([$row['id']]);
    $expenses = [];
    foreach ($expenseQuery->fetchAll() as $expense) {
        $expenses[] = serializeExpense($expense, $participants[$expense['id']] ?? []);
    }
    return [
        'trip' => $trip, 'items' => $items, 'expenses' => $expenses,
        'summary' => calculateExpenseSummary($trip, $expenses),
    ];
}

function getTripDetails(\PDO $db, array $user, string $id): array
{
    // One SQLite read snapshot keeps the global version and all detail rows aligned.
    $db->beginTransaction();
    try {
        $details = buildTripDetails($db, findReadableTrip($db, $id, $user['id']), $user);
        $db->commit();
        return $details;
    } catch (\Throwable $error) {
        $db->rollBack();
        throw $error;
    }
}

function serializeItem(array $item): array
{
    return [
        'id' => $item['id'], 'tripId' => $item['trip_id'], 'date' => $item['date'],
        'startTime' => $item['start_time'], 'endTime' => $item['end_time'],
        'name' => $item['name'], 'type' => $item['type'], 'note' => $item['note'],
        'priority' => $item['priority'], 'position' => (int) $item['position'],
    ];
}

function serializeExpense(array $expense, array $participants): array
{
    return [
        'id' => $expense['id'], 'tripId' => $expense['trip_id'], 'name' => $expense['name'],
        'amount' => (int) $expense['amount'], 'category' => $expense['category'],
        'date' => $expense['date'], 'payerId' => $expense['payer_id'],
        'participantIds' => $participants, 'note' => $expense['note'],
    ];
}

function detailText(mixed $value, string $field, int $maximum, bool $required, array &$errors): string
{
    if (!is_string($value)) {
        $errors[$field] = '請填寫有效的文字。';
        return '';
    }
    $value = preg_replace('/^\s+|\s+$/u', '', $value);
    $length = preg_match_all('/./us', $value);
    $controlPattern = $field === 'note' ? '/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u' : '/[\x00-\x1F\x7F]/u';
    if ($length === false || $length > $maximum || ($required && $length < 1) || preg_match($controlPattern, $value)) {
        $errors[$field] = $required ? "此欄位須為 1 至 {$maximum} 個字。" : "此欄位不可超過 {$maximum} 個字或含非法控制字元。";
    }
    return $value;
}

function dateWithinTrip(mixed $date, array $trip, array &$errors): string
{
    if (!validDate($date)) {
        $errors['date'] = '日期必須是有效的 YYYY-MM-DD。';
        return '';
    }
    if ($date < $trip['start_date'] || $date > $trip['end_date']) {
        $errors['date'] = '日期必須在行程出發與返回日期之間。';
    }
    return $date;
}

function validateItemFields(array $values, array $trip): array
{
    $errors = [];
    $values['name'] = detailText($values['name'] ?? null, 'name', 80, true, $errors);
    $values['note'] = detailText($values['note'] ?? null, 'note', 1000, false, $errors);
    $values['date'] = dateWithinTrip($values['date'] ?? null, $trip, $errors);
    foreach (['startTime', 'endTime'] as $field) {
        if (!is_string($values[$field] ?? null) || !preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/D', $values[$field])) {
            $errors[$field] = '時間必須是有效的 HH:MM。';
        }
    }
    if (!isset($errors['startTime']) && !isset($errors['endTime']) && $values['endTime'] <= $values['startTime']) {
        $errors['endTime'] = '結束時間必須晚於開始時間。';
    }
    if (!is_string($values['type'] ?? null) || !in_array($values['type'], ['attraction', 'restaurant', 'activity', 'hotel', 'train'], true)) {
        $errors['type'] = '活動類型無效。';
    }
    if (!is_string($values['priority'] ?? null) || !in_array($values['priority'], ['must', 'optional'], true)) {
        $errors['priority'] = '優先順序必須為 must 或 optional。';
    }
    if ($errors !== []) {
        throw new ApiError(422, 'VALIDATION_ERROR', '請確認活動資料。', $errors);
    }
    return $values;
}

function validateExpenseFields(\PDO $db, array $values, array $trip): array
{
    $errors = [];
    $values['name'] = detailText($values['name'] ?? null, 'name', 80, true, $errors);
    $values['note'] = detailText($values['note'] ?? null, 'note', 1000, false, $errors);
    $values['date'] = dateWithinTrip($values['date'] ?? null, $trip, $errors);
    if (!is_int($values['amount'] ?? null) || $values['amount'] < 1 || $values['amount'] > 1000000000) {
        $errors['amount'] = '金額須為 1 至 1,000,000,000 的整數台幣。';
    }
    if (!is_string($values['category'] ?? null) || !in_array($values['category'], ['transport', 'accommodation', 'food', 'activity', 'other'], true)) {
        $errors['category'] = '費用類別無效。';
    }
    $membersQuery = $db->prepare('SELECT user_id FROM trip_members WHERE trip_id = ?');
    $membersQuery->execute([$trip['id']]);
    $memberIds = $membersQuery->fetchAll(\PDO::FETCH_COLUMN);
    if (!is_string($values['payerId'] ?? null) || !in_array($values['payerId'], $memberIds, true)) {
        $errors['payerId'] = '付款人必須是這個行程的成員。';
    }
    $participants = $values['participantIds'] ?? null;
    if (!is_array($participants) || !array_is_list($participants) || $participants === []) {
        $errors['participantIds'] = '請至少選擇一位行程成員分攤。';
    } else {
        foreach ($participants as $participant) {
            if (!is_string($participant) || !in_array($participant, $memberIds, true)) {
                $errors['participantIds'] = '分攤人必須全部是這個行程的成員。';
                break;
            }
        }
        if (!isset($errors['participantIds'])) {
            $participants = array_values(array_unique($participants, SORT_STRING));
            sort($participants, SORT_STRING);
            $values['participantIds'] = $participants;
        }
    }
    if ($errors !== []) {
        throw new ApiError(422, 'VALIDATION_ERROR', '請確認費用資料。', $errors);
    }
    return $values;
}

function idempotencyKey(): string
{
    $key = $_SERVER['HTTP_IDEMPOTENCY_KEY'] ?? '';
    if (!is_string($key) || !preg_match('/^[A-Za-z0-9._:-]{8,128}$/D', $key)) {
        throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', '請提供有效的建立請求識別碼。');
    }
    return $key;
}

function detailPayloadHash(array $body): string
{
    ksort($body, SORT_STRING);
    return hash('sha256', json_encode($body, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));
}

function replayDetailReceipt(\PDO $db, array $user, string $operation, string $key, string $hash): ?array
{
    $query = $db->prepare('SELECT payload_hash, response_json FROM request_receipts WHERE user_id = ? AND operation = ? AND request_key = ?');
    $query->execute([$user['id'], $operation, $key]);
    $receipt = $query->fetch();
    if ($receipt === false) {
        return null;
    }
    if (!hash_equals($receipt['payload_hash'], $hash)) {
        throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', '此請求識別碼已用於不同的資料。');
    }
    return json_decode($receipt['response_json'], true, 32, JSON_THROW_ON_ERROR);
}

function saveDetailReceipt(\PDO $db, array $user, string $operation, string $key, string $hash, array $response): void
{
    $statement = $db->prepare('INSERT INTO request_receipts (user_id, operation, request_key, payload_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    $statement->execute([$user['id'], $operation, $key, $hash, json_encode($response, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), utcNow()]);
}

function incrementTripVersion(\PDO $db, array $trip, array $user): array
{
    $statement = $db->prepare('UPDATE trips SET version = version + 1, updated_at = ? WHERE id = ? AND owner_id = ? AND version = ?');
    $statement->execute([utcNow(), $trip['id'], $user['id'], (int) $trip['version']]);
    if ($statement->rowCount() !== 1) {
        throw new ApiError(409, 'VERSION_CONFLICT', '行程已更新，請重新載入後再操作。');
    }
    return findReadableTrip($db, $trip['id'], $user['id']);
}

function nextItemPosition(\PDO $db, string $tripId, string $date): int
{
    $query = $db->prepare('SELECT COUNT(*) FROM trip_items WHERE trip_id = ? AND date = ?');
    $query->execute([$tripId, $date]);
    return (int) $query->fetchColumn();
}

function normalizeItemPositions(\PDO $db, string $tripId, string $date): void
{
    $query = $db->prepare('SELECT id FROM trip_items WHERE trip_id = ? AND date = ? ORDER BY position, id');
    $query->execute([$tripId, $date]);
    $update = $db->prepare('UPDATE trip_items SET position = ? WHERE trip_id = ? AND id = ?');
    foreach ($query->fetchAll(\PDO::FETCH_COLUMN) as $position => $id) {
        $update->execute([$position, $tripId, $id]);
    }
}

function mutateItem(\PDO $db, array $user, string $tripId, string $method, ?string $itemId, array $body): array
{
    $allowed = $method === 'DELETE' ? ['version'] : ['version', 'date', 'startTime', 'endTime', 'name', 'type', 'note', 'priority'];
    rejectUnknownFields($body, $allowed);
    $version = validateVersion($body['version'] ?? null);
    if ($method === 'PATCH' && count($body) < 2) {
        throw new ApiError(422, 'VALIDATION_ERROR', '請至少選擇一個要修改的欄位。');
    }
    $key = $method === 'POST' ? idempotencyKey() : '';
    $hash = $method === 'POST' ? detailPayloadHash($body) : '';
    $operation = 'create_item:' . $tripId;
    return writeTransaction($db, function () use ($db, $user, $tripId, $method, $itemId, $body, $version, $key, $hash, $operation): array {
        $trip = findReadableTrip($db, $tripId, $user['id']);
        requireTripOwner($trip, $user);
        if ($method === 'POST') {
            $receipt = replayDetailReceipt($db, $user, $operation, $key, $hash);
            if ($receipt !== null) {
                return $receipt;
            }
        }
        requireCurrentVersion($trip, $version);
        $existing = null;
        if ($method !== 'POST') {
            $query = $db->prepare('SELECT * FROM trip_items WHERE trip_id = ? AND id = ?');
            $query->execute([$tripId, $itemId]);
            $existing = $query->fetch();
            if ($existing === false) {
                throw new ApiError(404, 'ITEM_NOT_FOUND', '找不到這個活動。');
            }
        }
        if ($method === 'DELETE') {
            $delete = $db->prepare('DELETE FROM trip_items WHERE trip_id = ? AND id = ?');
            $delete->execute([$tripId, $itemId]);
            normalizeItemPositions($db, $tripId, $existing['date']);
        } else {
            $values = $existing !== null ? serializeItem($existing) : ['note' => '', 'priority' => 'must'];
            foreach (['date', 'startTime', 'endTime', 'name', 'type', 'note', 'priority'] as $field) {
                if (array_key_exists($field, $body)) {
                    $values[$field] = $body[$field];
                }
            }
            $values = validateItemFields($values, $trip);
            if ($method === 'POST') {
                $itemId = 'item_' . bin2hex(random_bytes(12));
                $statement = $db->prepare('INSERT INTO trip_items (id, trip_id, date, start_time, end_time, name, type, note, priority, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
                $statement->execute([$itemId, $tripId, $values['date'], $values['startTime'], $values['endTime'], $values['name'], $values['type'], $values['note'], $values['priority'], nextItemPosition($db, $tripId, $values['date'])]);
            } else {
                $position = $values['date'] === $existing['date'] ? (int) $existing['position'] : nextItemPosition($db, $tripId, $values['date']);
                $statement = $db->prepare('UPDATE trip_items SET date = ?, start_time = ?, end_time = ?, name = ?, type = ?, note = ?, priority = ?, position = ? WHERE trip_id = ? AND id = ?');
                $statement->execute([$values['date'], $values['startTime'], $values['endTime'], $values['name'], $values['type'], $values['note'], $values['priority'], $position, $tripId, $itemId]);
                if ($values['date'] !== $existing['date']) {
                    normalizeItemPositions($db, $tripId, $existing['date']);
                }
            }
        }
        $response = buildTripDetails($db, incrementTripVersion($db, $trip, $user), $user);
        if ($method === 'POST') {
            saveDetailReceipt($db, $user, $operation, $key, $hash, $response);
        }
        return $response;
    });
}

function reorderItems(\PDO $db, array $user, string $tripId, array $body): array
{
    rejectUnknownFields($body, ['version', 'date', 'itemIds']);
    $version = validateVersion($body['version'] ?? null);
    return writeTransaction($db, function () use ($db, $user, $tripId, $body, $version): array {
        $trip = findReadableTrip($db, $tripId, $user['id']);
        requireTripOwner($trip, $user);
        requireCurrentVersion($trip, $version);
        $errors = [];
        $date = dateWithinTrip($body['date'] ?? null, $trip, $errors);
        $ids = $body['itemIds'] ?? null;
        if (!is_array($ids) || !array_is_list($ids)) {
            $errors['itemIds'] = '請提供當天完整的活動清單。';
        } else {
            foreach ($ids as $id) {
                if (!is_string($id) || $id === '') {
                    $errors['itemIds'] = '活動識別碼無效。';
                    break;
                }
            }
            if (!isset($errors['itemIds']) && count(array_unique($ids, SORT_STRING)) !== count($ids)) {
                $errors['itemIds'] = '活動清單不能重複。';
            }
        }
        if ($errors !== []) {
            throw new ApiError(422, 'VALIDATION_ERROR', '請確認活動排序。', $errors);
        }
        $query = $db->prepare('SELECT id FROM trip_items WHERE trip_id = ? AND date = ?');
        $query->execute([$tripId, $date]);
        $actual = $query->fetchAll(\PDO::FETCH_COLUMN);
        $comparison = $ids;
        sort($actual, SORT_STRING);
        sort($comparison, SORT_STRING);
        if ($actual !== $comparison) {
            throw new ApiError(422, 'VALIDATION_ERROR', '排序必須包含當天全部活動，且不能包含其他日期或行程的活動。', ['itemIds' => '請重新載入完整的活動清單。']);
        }
        $update = $db->prepare('UPDATE trip_items SET position = ? WHERE trip_id = ? AND date = ? AND id = ?');
        foreach ($ids as $position => $id) {
            $update->execute([$position, $tripId, $date, $id]);
        }
        return buildTripDetails($db, incrementTripVersion($db, $trip, $user), $user);
    });
}

function saveExpenseParticipants(\PDO $db, string $tripId, string $expenseId, array $participants): void
{
    $delete = $db->prepare('DELETE FROM expense_participants WHERE trip_id = ? AND expense_id = ?');
    $delete->execute([$tripId, $expenseId]);
    $insert = $db->prepare('INSERT INTO expense_participants (expense_id, trip_id, user_id) VALUES (?, ?, ?)');
    foreach ($participants as $participant) {
        $insert->execute([$expenseId, $tripId, $participant]);
    }
}

function mutateExpense(\PDO $db, array $user, string $tripId, string $method, ?string $expenseId, array $body): array
{
    $allowed = $method === 'DELETE' ? ['version'] : ['version', 'name', 'amount', 'category', 'date', 'payerId', 'participantIds', 'note'];
    rejectUnknownFields($body, $allowed);
    $version = validateVersion($body['version'] ?? null);
    if ($method === 'PATCH' && count($body) < 2) {
        throw new ApiError(422, 'VALIDATION_ERROR', '請至少選擇一個要修改的欄位。');
    }
    $key = $method === 'POST' ? idempotencyKey() : '';
    $hash = $method === 'POST' ? detailPayloadHash($body) : '';
    $operation = 'create_expense:' . $tripId;
    return writeTransaction($db, function () use ($db, $user, $tripId, $method, $expenseId, $body, $version, $key, $hash, $operation): array {
        $trip = findReadableTrip($db, $tripId, $user['id']);
        requireTripOwner($trip, $user);
        if ($method === 'POST') {
            $receipt = replayDetailReceipt($db, $user, $operation, $key, $hash);
            if ($receipt !== null) {
                return $receipt;
            }
        }
        requireCurrentVersion($trip, $version);
        $existing = null;
        $participantIds = [];
        if ($method !== 'POST') {
            $query = $db->prepare('SELECT * FROM trip_expenses WHERE trip_id = ? AND id = ?');
            $query->execute([$tripId, $expenseId]);
            $existing = $query->fetch();
            if ($existing === false) {
                throw new ApiError(404, 'EXPENSE_NOT_FOUND', '找不到這筆費用。');
            }
            $participants = $db->prepare('SELECT user_id FROM expense_participants WHERE trip_id = ? AND expense_id = ? ORDER BY user_id');
            $participants->execute([$tripId, $expenseId]);
            $participantIds = $participants->fetchAll(\PDO::FETCH_COLUMN);
        }
        if ($method === 'DELETE') {
            $delete = $db->prepare('DELETE FROM trip_expenses WHERE trip_id = ? AND id = ?');
            $delete->execute([$tripId, $expenseId]);
        } else {
            $values = $existing !== null ? serializeExpense($existing, $participantIds) : ['note' => ''];
            foreach (['name', 'amount', 'category', 'date', 'payerId', 'participantIds', 'note'] as $field) {
                if (array_key_exists($field, $body)) {
                    $values[$field] = $body[$field];
                }
            }
            $values = validateExpenseFields($db, $values, $trip);
            if ($method === 'POST') {
                $expenseId = 'expense_' . bin2hex(random_bytes(12));
                $statement = $db->prepare('INSERT INTO trip_expenses (id, trip_id, name, amount, category, date, payer_id, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
                $statement->execute([$expenseId, $tripId, $values['name'], $values['amount'], $values['category'], $values['date'], $values['payerId'], $values['note']]);
            } else {
                $statement = $db->prepare('UPDATE trip_expenses SET name = ?, amount = ?, category = ?, date = ?, payer_id = ?, note = ? WHERE trip_id = ? AND id = ?');
                $statement->execute([$values['name'], $values['amount'], $values['category'], $values['date'], $values['payerId'], $values['note'], $tripId, $expenseId]);
            }
            saveExpenseParticipants($db, $tripId, $expenseId, $values['participantIds']);
        }
        $response = buildTripDetails($db, incrementTripVersion($db, $trip, $user), $user);
        if ($method === 'POST') {
            saveDetailReceipt($db, $user, $operation, $key, $hash, $response);
        }
        return $response;
    });
}

function assertDetailsWithinDates(\PDO $db, string $tripId, string $startDate, string $endDate): void
{
    $query = $db->prepare('SELECT MIN(date) AS first_date, MAX(date) AS last_date FROM (SELECT date FROM trip_items WHERE trip_id = ? UNION ALL SELECT date FROM trip_expenses WHERE trip_id = ?)');
    $query->execute([$tripId, $tripId]);
    $range = $query->fetch();
    $fields = [];
    if ($range['first_date'] !== null && $range['first_date'] < $startDate) {
        $fields['startDate'] = '新的出發日期會排除現有活動或費用，請先調整或刪除這些資料。';
    }
    if ($range['last_date'] !== null && $range['last_date'] > $endDate) {
        $fields['endDate'] = '新的返回日期會排除現有活動或費用，請先調整或刪除這些資料。';
    }
    if ($fields !== []) {
        throw new ApiError(422, 'VALIDATION_ERROR', '縮短行程日期會排除現有活動或費用，請先調整明細。', $fields);
    }
}
