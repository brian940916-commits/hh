(() => {
  'use strict';
  const api = window.AgentAPI;
  const byId = id => document.getElementById(id);
  let ready = false;
  let busy = false;
  let invalidated = false;
  let attempt = null;
  function error(text) {
    byId('register-error').textContent = text;
    byId('register-error').hidden = !text;
  }
  function controls() {
    if (invalidated) return;
    document.querySelectorAll('#register-form input').forEach(input => { input.disabled = busy || !ready; });
    byId('register-submit-btn').disabled = busy || !ready;
    byId('register-submit-btn').textContent = busy ? '連線中…' : '建立帳號';
    byId('register-session-retry-btn').disabled = busy;
  }
  window.addEventListener('agenttt:unauthorized', () => {
    invalidated = true;
    ready = false;
    attempt = null;
    document.querySelectorAll('#register-form input').forEach(input => { input.value = ''; });
    byId('register-form').hidden = true;
    byId('register-success').hidden = true;
    location.replace('login.php');
  });
  async function bootstrap() {
    if (busy || invalidated) return;
    ready = false;
    busy = true;
    controls();
    error('');
    byId('register-status').textContent = '正在確認登入狀態…';
    byId('register-session-retry-btn').hidden = true;
    try {
      const session = await api.loadSession();
      if (session.user) {
        attempt = null;
        byId('register-password').value = '';
        byId('register-confirm').value = '';
        byId('register-current-account').textContent = `${session.user.name} · ${session.user.email}`;
        byId('register-account-note').hidden = false;
        byId('register-form').hidden = true;
      } else {
        ready = true;
        byId('register-form').hidden = false;
        byId('register-account-note').hidden = true;
        byId('register-status').textContent = '請填寫以下資料。';
      }
    } catch (failure) {
      error(failure.message);
      byId('register-status').textContent = '尚未連上平台。';
      byId('register-session-retry-btn').hidden = false;
    } finally { busy = false; controls(); }
  }
  byId('register-session-retry-btn').addEventListener('click', bootstrap);
  byId('register-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!ready || busy || invalidated) return;
    if (!byId('register-form').reportValidity()) return;
    const payload = { name: byId('register-name').value.trim(), email: byId('register-email').value.trim().toLowerCase(), password: byId('register-password').value };
    if (!payload.name || Array.from(payload.name).length > 80) { error('姓名請填寫 1 至 80 個字'); return; }
    if (!/^[\x00-\x7F]+$/.test(payload.email)) { error('請使用有效的英文 Email 地址'); return; }
    if (Array.from(payload.password).length < 8) { error('密碼至少需要 8 個字元'); return; }
    if (new TextEncoder().encode(payload.password).length > 72 || payload.password.includes('\0')) { error('密碼太長或包含無效字元，請調整後再試'); return; }
    if (payload.password !== byId('register-confirm').value) { error('兩次輸入的密碼不同'); return; }
    const signature = JSON.stringify(payload);
    if (!attempt || attempt.signature !== signature) attempt = { signature, key: api.newRequestKey() };
    busy = true;
    controls();
    error('');
    try {
      const result = await api.request('/register', { method: 'POST', body: payload, idempotencyKey: attempt.key });
      if (result?.created !== true || typeof result.email !== 'string') throw new api.ApiError('註冊結果無法確認，請保留資料並重試。');
      attempt = null;
      ready = false;
      byId('register-password').value = '';
      byId('register-confirm').value = '';
      byId('register-success-email').textContent = result.email;
      byId('register-login-link').href = 'login.php?email=' + encodeURIComponent(result.email);
      byId('register-form').hidden = true;
      byId('register-success').hidden = false;
    } catch (failure) {
      if (invalidated) return;
      error(failure.code === 'ACCOUNT_EXISTS' ? '這個 Email 已有帳號。請使用原帳號登入，或填寫另一個 Email。' : failure.message);
      if (failure.status === 403 && /csrf/i.test(failure.code)) {
        ready = false;
        byId('register-session-retry-btn').hidden = false;
        byId('register-status').textContent = '連線已過期，請重新連線後再試。';
      }
    } finally { busy = false; controls(); }
  });
  bootstrap();
})();
