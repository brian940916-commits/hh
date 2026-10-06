<?php
declare(strict_types=1);

namespace AgentTT;

function dispatchApi(): void
{
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $path = $_GET['path'] ?? '/';
    if (!is_string($path) || !preg_match('#^/[A-Za-z0-9_/-]*$#D', $path)) {
        throw new ApiError(404, 'NOT_FOUND', '找不到這個 API。');
    }
    $db = openDatabase();
    if ($path === '/health' && $method === 'GET') {
        jsonResponse(['status' => 'ok']);
        return;
    }
    initializeSession();
    if ($path === '/session' && $method === 'GET') {
        jsonResponse(['user' => currentUser($db), 'csrfToken' => $_SESSION['csrf_token']]);
        return;
    }
    if ($path === '/register' && $method === 'POST') {
        $actor = currentUser($db);
        if ($actor !== null) {
            header('X-AgentTT-User-Id: ' . $actor['id']);
            throw new ApiError(403, 'ALREADY_AUTHENTICATED', '你已登入，請先登出再建立其他帳號。');
        }
        requireCsrf();
        jsonResponse(registerGuest($db, readJsonBody()), 201);
        return;
    }
    if ($path === '/login' && $method === 'POST') {
        requireCsrf();
        $body = readJsonBody();
        rejectUnknownFields($body, ['email', 'password']);
        $email = is_string($body['email'] ?? null) ? strtolower(trim($body['email'])) : '';
        $password = is_string($body['password'] ?? null) ? $body['password'] : '';
        if (strlen($email) > 254 || strlen($password) > 72 || str_contains($password, "\0")) {
            throw new ApiError(401, 'INVALID_CREDENTIALS', '電子郵件或密碼不正確。');
        }
        $statement = $db->prepare('SELECT * FROM users WHERE email = ?');
        $statement->execute([$email]);
        $row = $statement->fetch();
        // Verify a fixed dummy hash for unknown email to avoid an immediate exit.
        $hash = $row !== false ? $row['password_hash'] : '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi.';
        $valid = password_verify($password, $hash);
        if ($row === false || !$valid) {
            throw new ApiError(401, 'INVALID_CREDENTIALS', '電子郵件或密碼不正確。');
        }
        if (!session_regenerate_id(true)) {
            throw new \RuntimeException('Unable to refresh session.');
        }
        $_SESSION['user_id'] = $row['id'];
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        jsonResponse(['user' => safeUser($row), 'csrfToken' => $_SESSION['csrf_token']]);
        return;
    }
    if ($path === '/logout' && $method === 'POST') {
        requireUser($db);
        requireCsrf();
        $_SESSION = [];
        $cookie = session_get_cookie_params();
        setcookie(session_name(), '', [
            'expires' => time() - 42000, 'path' => $cookie['path'], 'domain' => $cookie['domain'],
            'secure' => $cookie['secure'], 'httponly' => $cookie['httponly'], 'samesite' => $cookie['samesite'],
        ]);
        if (!session_destroy()) {
            throw new \RuntimeException('Unable to close session.');
        }
        jsonResponse(null, 204);
        return;
    }
    if ($path === '/invitations') {
        $user = requireUser($db);
        if ($method !== 'GET') {
            header('Allow: GET');
            throw new ApiError(405, 'METHOD_NOT_ALLOWED', '此 API 不支援這個操作。');
        }
        jsonResponse(getIncomingInvitations($db, $user));
        return;
    }
    if (preg_match('#^/invitations/([A-Za-z0-9_-]{1,100})/(accept|decline)$#D', $path, $matches)) {
        $user = requireUser($db);
        if ($method !== 'POST') {
            header('Allow: POST');
            throw new ApiError(405, 'METHOD_NOT_ALLOWED', '此 API 不支援這個操作。');
        }
        requireCsrf();
        jsonResponse(respondToInvitation($db, $user, $matches[1], $matches[2], readJsonBody()));
        return;
    }
    if ($path === '/trips') {
        $user = requireUser($db);
        if ($method === 'GET') {
            $statement = $db->prepare('SELECT t.* FROM trips t WHERE t.owner_id = ? OR EXISTS (SELECT 1 FROM trip_members m WHERE m.trip_id = t.id AND m.user_id = ?) ORDER BY t.created_at DESC, t.id DESC');
            $statement->execute([$user['id'], $user['id']]);
            $trips = [];
            foreach ($statement->fetchAll() as $row) {
                $trips[] = serializeTrip($db, $row, $user);
            }
            jsonResponse($trips);
            return;
        }
        if ($method === 'POST') {
            requireCsrf();
            jsonResponse(createTrip($db, $user, readJsonBody()), 201);
            return;
        }
        header('Allow: GET, POST');
        throw new ApiError(405, 'METHOD_NOT_ALLOWED', '此 API 不支援這個操作。');
    }
    if (preg_match('#^/trips/([A-Za-z0-9_-]{1,100})/invitations$#D', $path, $matches)) {
        $user = requireUser($db);
        if ($method !== 'POST') {
            header('Allow: POST');
            throw new ApiError(405, 'METHOD_NOT_ALLOWED', '此 API 不支援這個操作。');
        }
        requireCsrf();
        jsonResponse(createTripInvitation($db, $user, $matches[1], readJsonBody()), 201);
        return;
    }
    if (preg_match('#^/trips/([A-Za-z0-9_-]{1,100})/invitations/([A-Za-z0-9_-]{1,100})$#D', $path, $matches)) {
        $user = requireUser($db);
        if ($method !== 'DELETE') {
            header('Allow: DELETE');
            throw new ApiError(405, 'METHOD_NOT_ALLOWED', '此 API 不支援這個操作。');
        }
        requireCsrf();
        jsonResponse(revokeTripInvitation($db, $user, $matches[1], $matches[2], readJsonBody()));
        return;
    }
    if (preg_match('#^/trips/([A-Za-z0-9_-]{1,100})/members/([A-Za-z0-9_-]{1,100})$#D', $path, $matches)) {
        $user = requireUser($db);
        if ($method !== 'DELETE') {
            header('Allow: DELETE');
            throw new ApiError(405, 'METHOD_NOT_ALLOWED', '此 API 不支援這個操作。');
        }
        requireCsrf();
        jsonResponse(removeTripMember($db, $user, $matches[1], $matches[2], readJsonBody()));
        return;
    }
    if (preg_match('#^/trips/([A-Za-z0-9_-]{1,100})/details$#D', $path, $matches)) {
        $user = requireUser($db);
        if ($method !== 'GET') {
            header('Allow: GET');
            throw new ApiError(405, 'METHOD_NOT_ALLOWED', '此 API 不支援這個操作。');
        }
        jsonResponse(getTripDetails($db, $user, $matches[1]));
        return;
    }
    if (preg_match('#^/trips/([A-Za-z0-9_-]{1,100})/items/order$#D', $path, $matches)) {
        $user = requireUser($db);
        if ($method !== 'PUT') {
            header('Allow: PUT');
            throw new ApiError(405, 'METHOD_NOT_ALLOWED', '此 API 不支援這個操作。');
        }
        requireCsrf();
        jsonResponse(reorderItems($db, $user, $matches[1], readJsonBody()));
        return;
    }
    if (preg_match('#^/trips/([A-Za-z0-9_-]{1,100})/(items|expenses)$#D', $path, $matches)) {
        $user = requireUser($db);
        if ($method !== 'POST') {
            header('Allow: POST');
            throw new ApiError(405, 'METHOD_NOT_ALLOWED', '此 API 不支援這個操作。');
        }
        requireCsrf();
        $body = readJsonBody();
        $details = $matches[2] === 'items'
            ? mutateItem($db, $user, $matches[1], 'POST', null, $body)
            : mutateExpense($db, $user, $matches[1], 'POST', null, $body);
        jsonResponse($details, 201);
        return;
    }
    if (preg_match('#^/trips/([A-Za-z0-9_-]{1,100})/(items|expenses)/([A-Za-z0-9_-]{1,100})$#D', $path, $matches)) {
        $user = requireUser($db);
        if (!in_array($method, ['PATCH', 'DELETE'], true)) {
            header('Allow: PATCH, DELETE');
            throw new ApiError(405, 'METHOD_NOT_ALLOWED', '此 API 不支援這個操作。');
        }
        requireCsrf();
        $body = readJsonBody();
        $details = $matches[2] === 'items'
            ? mutateItem($db, $user, $matches[1], $method, $matches[3], $body)
            : mutateExpense($db, $user, $matches[1], $method, $matches[3], $body);
        jsonResponse($details);
        return;
    }
    if (preg_match('#^/trips/([A-Za-z0-9_-]{1,100})$#D', $path, $matches)) {
        $user = requireUser($db);
        $id = $matches[1];
        if ($method === 'GET') {
            jsonResponse(serializeTrip($db, findReadableTrip($db, $id, $user['id']), $user));
            return;
        }
        if ($method === 'PATCH') {
            requireCsrf();
            jsonResponse(updateTrip($db, $user, $id, readJsonBody()));
            return;
        }
        if ($method === 'DELETE') {
            requireCsrf();
            removeTrip($db, $user, $id, readJsonBody());
            jsonResponse(null, 204);
            return;
        }
        header('Allow: GET, PATCH, DELETE');
        throw new ApiError(405, 'METHOD_NOT_ALLOWED', '此 API 不支援這個操作。');
    }
    $methods = ['/health' => 'GET', '/session' => 'GET', '/register' => 'POST', '/login' => 'POST', '/logout' => 'POST'];
    if (isset($methods[$path])) {
        header('Allow: ' . $methods[$path]);
        throw new ApiError(405, 'METHOD_NOT_ALLOWED', '此 API 不支援這個操作。');
    }
    throw new ApiError(404, 'NOT_FOUND', '找不到這個 API。');
}
