/* Same-origin cookie session; browser demo storage is deliberately unused. */
(() => {
  'use strict';
  let session = { user: null, csrfToken: null };

  class ApiError extends Error {
    constructor(message, status = 0, code = 'connection_error', fields = null) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
      this.fields = fields;
    }
  }

  function clearSession() {
    session = { user: null, csrfToken: null };
    window.dispatchEvent(new Event('agenttt:unauthorized'));
  }

  function setSession(data) {
    if (!data || typeof data.csrfToken !== 'string' || !data.csrfToken) {
      throw new ApiError('登入資訊格式不正確，請重新連線。', 0, 'invalid_response');
    }
    session = { user: data.user || null, csrfToken: data.csrfToken };
    return session;
  }

  async function request(path, options = {}) {
    const method = options.method || 'GET';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout || 15000);
    const headers = { Accept: 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET' && session.csrfToken) headers['X-CSRF-Token'] = session.csrfToken;
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
    try {
      const response = await fetch('api/index.php?path=' + encodeURIComponent(path), {
        method,
        headers,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      const actorId = response.headers.get('X-AgentTT-User-Id');
      if (path !== '/login' && path !== '/session' && session.user && actorId && actorId !== session.user.id) {
        clearSession();
        throw new ApiError('帳號已在其他分頁切換，請重新確認登入狀態。', 401, 'SESSION_CHANGED');
      }
      if (response.status === 401 && path !== '/login') clearSession();
      if (response.status === 204 && response.ok) return null;
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.toLowerCase().includes('application/json')) {
        throw new ApiError('伺服器回應異常，請確認平台已正確啟動後再試。', response.status, 'invalid_response');
      }
      let payload;
      try { payload = await response.json(); }
      catch (_) { throw new ApiError('伺服器回應無法讀取，請稍後重試。', response.status, 'invalid_response'); }
      if (!response.ok) {
        throw new ApiError(payload?.error?.message || '操作未完成，請稍後重試。', response.status,
          payload?.error?.code || 'request_failed', payload?.error?.fields || null);
      }
      if (!payload || !Object.prototype.hasOwnProperty.call(payload, 'data')) {
        throw new ApiError('伺服器回應缺少資料，請重新載入。', response.status, 'invalid_response');
      }
      return payload.data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error.name === 'AbortError') throw new ApiError('連線逾時，資料尚未確認儲存。請保留表單並重試。', 0, 'timeout');
      throw new ApiError('無法連線，請確認網路與平台是否啟動後再試。');
    } finally {
      clearTimeout(timeout);
    }
  }

  async function loadSession() { return setSession(await request('/session')); }
  function newRequestKey() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return Array.from(crypto.getRandomValues(new Uint8Array(24)), value => value.toString(16).padStart(2, '0')).join('');
  }

  window.AgentAPI = { request, loadSession, setSession, clearSession, newRequestKey, ApiError,
    get user() { return session.user; } };
})();
