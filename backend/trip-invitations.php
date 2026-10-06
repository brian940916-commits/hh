<?php
declare(strict_types=1);

namespace AgentTT;

function invitationSelectSql(): string
{
    return <<<'SQL'
SELECT i.*, recipient.name AS recipient_name, recipient.email AS recipient_email,
       inviter.name AS inviter_name, inviter.email AS inviter_email,
       t.name AS trip_name, t.start_date, t.end_date, t.station,
       CASE WHEN t.owner_id = i.recipient_id OR EXISTS (
           SELECT 1 FROM trip_members m WHERE m.trip_id = i.trip_id AND m.user_id = i.recipient_id
       ) THEN 1 ELSE 0 END AS can_open_trip
FROM trip_invitations i
JOIN users recipient ON recipient.id = i.recipient_id
JOIN users inviter ON inviter.id = i.invited_by
JOIN trips t ON t.id = i.trip_id
SQL;
}

function serializeInvitation(array $row): array
{
    return [
        'id' => $row['id'], 'tripId' => $row['trip_id'], 'status' => $row['status'],
        'version' => (int) $row['version'],
        'recipient' => ['id' => $row['recipient_id'], 'name' => $row['recipient_name'], 'email' => $row['recipient_email']],
        'inviter' => ['id' => $row['invited_by'], 'name' => $row['inviter_name'], 'email' => $row['inviter_email']],
        'trip' => [
            'id' => $row['trip_id'], 'name' => $row['trip_name'],
            'startDate' => $row['start_date'], 'endDate' => $row['end_date'], 'station' => $row['station'],
        ],
        'canOpenTrip' => (bool) $row['can_open_trip'],
        'createdAt' => $row['created_at'], 'updatedAt' => $row['updated_at'],
    ];
}

function invitationOrderSql(): string
{
    return " ORDER BY CASE i.status WHEN 'pending' THEN 0 ELSE 1 END, i.updated_at DESC, i.created_at DESC, i.id DESC";
}

function getOwnerInvitations(\PDO $db, string $tripId): array
{
    $query = $db->prepare(invitationSelectSql() . ' WHERE i.trip_id = ?' . invitationOrderSql());
    $query->execute([$tripId]);
    return array_map(__NAMESPACE__ . '\\serializeInvitation', $query->fetchAll());
}

function getIncomingInvitations(\PDO $db, array $user): array
{
    $db->beginTransaction();
    try {
        $query = $db->prepare(invitationSelectSql() . ' WHERE i.recipient_id = ?' . invitationOrderSql());
        $query->execute([$user['id']]);
        $invitations = array_map(__NAMESPACE__ . '\\serializeInvitation', $query->fetchAll());
        $db->commit();
        return $invitations;
    } catch (\Throwable $error) {
        $db->rollBack();
        throw $error;
    }
}

function invitationEmail(mixed $value): string
{
    $email = is_string($value) ? strtolower(trim($value)) : '';
    if ($email === '' || strlen($email) > 254 || !preg_match('/^[\x00-\x7F]+$/D', $email)
        || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        throw new ApiError(422, 'VALIDATION_ERROR', '請確認受邀帳號。', ['email' => '請填寫有效的 ASCII 電子郵件地址。']);
    }
    return $email;
}

function createTripInvitation(\PDO $db, array $user, string $tripId, array $body): array
{
    rejectUnknownFields($body, ['version', 'email']);
    $version = validateVersion($body['version'] ?? null);
    $email = invitationEmail($body['email'] ?? null);
    $key = idempotencyKey();
    $hash = detailPayloadHash(['version' => $version, 'email' => $email]);
    $operation = 'create_invitation:' . $tripId;
    return writeTransaction($db, function () use ($db, $user, $tripId, $version, $email, $key, $hash, $operation): array {
        $trip = findReadableTrip($db, $tripId, $user['id']);
        requireTripOwner($trip, $user);
        $receipt = replayDetailReceipt($db, $user, $operation, $key, $hash);
        if ($receipt !== null) {
            return $receipt;
        }
        requireCurrentVersion($trip, $version);
        $recipientQuery = $db->prepare('SELECT id, role FROM users WHERE email = ?');
        $recipientQuery->execute([$email]);
        $recipient = $recipientQuery->fetch();
        if ($recipient === false || $recipient['role'] !== 'guest') {
            throw new ApiError(422, 'VALIDATION_ERROR', '請確認受邀帳號。', ['email' => '邀請對象必須是已註冊的旅客帳號。']);
        }
        if ($recipient['id'] === $user['id']) {
            throw new ApiError(422, 'VALIDATION_ERROR', '不能邀請自己。', ['email' => '請輸入其他旅客的電子郵件地址。']);
        }
        $memberQuery = $db->prepare('SELECT 1 FROM trip_members WHERE trip_id = ? AND user_id = ?');
        $memberQuery->execute([$tripId, $recipient['id']]);
        if ($memberQuery->fetchColumn() !== false) {
            throw new ApiError(409, 'MEMBER_ALREADY_JOINED', '這位旅客已是行程成員。');
        }
        $existingQuery = $db->prepare('SELECT id, status FROM trip_invitations WHERE trip_id = ? AND recipient_id = ?');
        $existingQuery->execute([$tripId, $recipient['id']]);
        $existing = $existingQuery->fetch();
        $now = utcNow();
        if ($existing === false) {
            $statement = $db->prepare("INSERT INTO trip_invitations (id, trip_id, recipient_id, invited_by, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', 1, ?, ?)");
            $statement->execute(['invite_' . bin2hex(random_bytes(12)), $tripId, $recipient['id'], $user['id'], $now, $now]);
        } else {
            if ($existing['status'] === 'pending') {
                throw new ApiError(409, 'INVITATION_PENDING', '這位旅客已有待處理的邀請。');
            }
            if (!in_array($existing['status'], ['declined', 'revoked'], true)) {
                throw new ApiError(409, 'INVITATION_ALREADY_HANDLED', '這份邀請已處理，請重新載入成員資料。');
            }
            $statement = $db->prepare("UPDATE trip_invitations SET status = 'pending', invited_by = ?, version = version + 1, updated_at = ? WHERE id = ? AND trip_id = ?");
            $statement->execute([$user['id'], $now, $existing['id'], $tripId]);
        }
        $response = buildTripDetails($db, incrementTripVersion($db, $trip, $user), $user);
        saveDetailReceipt($db, $user, $operation, $key, $hash, $response);
        return $response;
    });
}

function revokeTripInvitation(\PDO $db, array $user, string $tripId, string $invitationId, array $body): array
{
    rejectUnknownFields($body, ['version']);
    $version = validateVersion($body['version'] ?? null);
    return writeTransaction($db, function () use ($db, $user, $tripId, $invitationId, $version): array {
        $trip = findReadableTrip($db, $tripId, $user['id']);
        requireTripOwner($trip, $user);
        requireCurrentVersion($trip, $version);
        $query = $db->prepare('SELECT status FROM trip_invitations WHERE trip_id = ? AND id = ?');
        $query->execute([$tripId, $invitationId]);
        $row = $query->fetch();
        if ($row === false) {
            throw new ApiError(404, 'INVITATION_NOT_FOUND', '找不到這份邀請。');
        }
        if ($row['status'] !== 'pending') {
            throw new ApiError(409, 'INVITATION_ALREADY_HANDLED', '邀請已處理，請重新載入後再操作。');
        }
        $statement = $db->prepare("UPDATE trip_invitations SET status = 'revoked', version = version + 1, updated_at = ? WHERE trip_id = ? AND id = ?");
        $statement->execute([utcNow(), $tripId, $invitationId]);
        return buildTripDetails($db, incrementTripVersion($db, $trip, $user), $user);
    });
}

function removeTripMember(\PDO $db, array $user, string $tripId, string $memberId, array $body): array
{
    rejectUnknownFields($body, ['version']);
    $version = validateVersion($body['version'] ?? null);
    return writeTransaction($db, function () use ($db, $user, $tripId, $memberId, $version): array {
        $trip = findReadableTrip($db, $tripId, $user['id']);
        requireTripOwner($trip, $user);
        requireCurrentVersion($trip, $version);
        if ($memberId === $trip['owner_id']) {
            throw new ApiError(409, 'OWNER_CANNOT_REMOVE', '行程建立者不能被移除。');
        }
        $query = $db->prepare('SELECT 1 FROM trip_members WHERE trip_id = ? AND user_id = ?');
        $query->execute([$tripId, $memberId]);
        if ($query->fetchColumn() === false) {
            throw new ApiError(404, 'MEMBER_NOT_FOUND', '找不到這位行程成員。');
        }
        $references = $db->prepare('SELECT EXISTS (SELECT 1 FROM trip_expenses WHERE trip_id = ? AND payer_id = ?) OR EXISTS (SELECT 1 FROM expense_participants WHERE trip_id = ? AND user_id = ?)');
        $references->execute([$tripId, $memberId, $tripId, $memberId]);
        if ((bool) $references->fetchColumn()) {
            throw new ApiError(409, 'MEMBER_HAS_EXPENSES', '這位成員仍是費用付款人或分攤人，請先調整相關費用再移除。');
        }
        $delete = $db->prepare('DELETE FROM trip_members WHERE trip_id = ? AND user_id = ?');
        $delete->execute([$tripId, $memberId]);
        $revoke = $db->prepare("UPDATE trip_invitations SET status = 'revoked', version = version + 1, updated_at = ? WHERE trip_id = ? AND recipient_id = ?");
        $revoke->execute([utcNow(), $tripId, $memberId]);
        return buildTripDetails($db, incrementTripVersion($db, $trip, $user), $user);
    });
}

function incrementMembershipTripVersion(\PDO $db, string $tripId, int $version): void
{
    // Recipient actions are authorized by their invitation rather than ownership.
    $statement = $db->prepare('UPDATE trips SET version = version + 1, updated_at = ? WHERE id = ? AND version = ?');
    $statement->execute([utcNow(), $tripId, $version]);
    if ($statement->rowCount() !== 1) {
        throw new ApiError(409, 'VERSION_CONFLICT', '行程已更新，請重新載入後再操作。');
    }
}

function respondToInvitation(\PDO $db, array $user, string $invitationId, string $action, array $body): array
{
    rejectUnknownFields($body, ['version']);
    $version = validateVersion($body['version'] ?? null);
    $key = idempotencyKey();
    $hash = detailPayloadHash(['version' => $version]);
    $operation = $action . '_invitation:' . $invitationId;
    return writeTransaction($db, function () use ($db, $user, $invitationId, $action, $version, $key, $hash, $operation): array {
        $query = $db->prepare('SELECT i.*, t.version AS trip_version, t.owner_id FROM trip_invitations i JOIN trips t ON t.id = i.trip_id WHERE i.id = ? AND i.recipient_id = ?');
        $query->execute([$invitationId, $user['id']]);
        $row = $query->fetch();
        if ($row === false || $row['owner_id'] === $user['id']) {
            throw new ApiError(404, 'INVITATION_NOT_FOUND', '找不到這份邀請。');
        }
        if ($user['role'] !== 'guest') {
            throw new ApiError(403, 'FORBIDDEN', '只有受邀旅客本人可以處理邀請。');
        }
        $receipt = replayDetailReceipt($db, $user, $operation, $key, $hash);
        if ($receipt !== null) {
            return $receipt;
        }
        if ((int) $row['version'] !== $version) {
            throw new ApiError(409, 'VERSION_CONFLICT', '邀請已更新，請重新載入後再操作。');
        }
        if ($row['status'] !== 'pending') {
            throw new ApiError(409, 'INVITATION_ALREADY_HANDLED', '邀請已處理，請重新載入後再操作。');
        }
        $now = utcNow();
        if ($action === 'accept') {
            $member = $db->prepare("INSERT OR IGNORE INTO trip_members (trip_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)");
            $member->execute([$row['trip_id'], $user['id'], $now]);
        }
        $status = $action === 'accept' ? 'accepted' : 'declined';
        $update = $db->prepare('UPDATE trip_invitations SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND recipient_id = ? AND version = ?');
        $update->execute([$status, $now, $invitationId, $user['id'], $version]);
        if ($update->rowCount() !== 1) {
            throw new ApiError(409, 'VERSION_CONFLICT', '邀請已更新，請重新載入後再操作。');
        }
        incrementMembershipTripVersion($db, $row['trip_id'], (int) $row['trip_version']);
        $resultQuery = $db->prepare(invitationSelectSql() . ' WHERE i.id = ? AND i.recipient_id = ?');
        $resultQuery->execute([$invitationId, $user['id']]);
        $response = ['invitation' => serializeInvitation($resultQuery->fetch())];
        saveDetailReceipt($db, $user, $operation, $key, $hash, $response);
        return $response;
    });
}
