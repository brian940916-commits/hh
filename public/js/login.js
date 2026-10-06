(() => {
  'use strict';
  const api = window.AgentAPI;
  const byId = id => document.getElementById(id);
  let ready = false;
  let pending = false;
  const accounts = { guest: 'test@test.com', host: 'host@test.com', admin: 'admin@test.com' };

  function showError(message) {
    byId('login-error').textContent = message;
    byId('login-error').style.display = message ? 'block' : 'none';
  }
  function setPending(value) {
    pending = value;
    byId('login-submit-btn').disabled = value || !ready;
    byId('login-submit-btn').textContent = value ? '連線中…' : '登入';
    byId('session-retry-btn').disabled = value;
    document.querySelectorAll('.role-card').forEach(button => { button.disabled = value; });
    byId('login-email').readOnly = value;
    byId('login-password').readOnly = value;
  }

  window.selectRole = role => {
    if (pending || !accounts[role]) return;
    document.querySelectorAll('.role-card').forEach(button => {
      button.className = 'role-card';
      button.setAttribute('aria-pressed', 'false');
    });
    const button = byId('role-' + role);
    button.classList.add('selected-' + role);
    button.setAttribute('aria-pressed', 'true');
    byId('login-email').value = accounts[role];
    byId('login-password').value = '';
    showError('');
  };

  async function bootstrap() {
    if (pending) return;
    ready = false;
    setPending(true);
    showError('');
    byId('session-status').textContent = '正在確認登入狀態…';
    byId('session-retry-btn').hidden = true;
    try {
      const session = await api.loadSession();
      if (session.user) { window.location.replace('trip-list.php'); return; }
      ready = true;
      byId('session-status').textContent = '請輸入帳號與密碼。';
    } catch (error) {
      showError(error.message);
      byId('session-status').textContent = '尚未連上平台。';
      byId('session-retry-btn').hidden = false;
    } finally { setPending(false); }
  }

  async function handleLogin(event) {
    if (event) event.preventDefault();
    if (!ready || pending) return;
    if (!byId('login-form').reportValidity()) return;
    const email = byId('login-email').value.trim();
    const password = byId('login-password').value;
    setPending(true);
    showError('');
    try {
      const session = api.setSession(await api.request('/login', { method: 'POST', body: { email, password } }));
      if (!session.user) throw new api.ApiError('登入未完成，請重新嘗試。');
      byId('login-password').value = '';
      window.location.replace('trip-list.php');
    } catch (error) {
      showError(error.message);
      // A server restart/expired anonymous session needs a fresh CSRF token.
      if (error.status === 403 && /csrf/i.test(error.code)) {
        ready = false;
        byId('session-retry-btn').hidden = false;
        byId('session-status').textContent = '請重新連線後再登入。';
      }
    } finally { setPending(false); }
  }
  window.handleLogin = handleLogin;
  byId('login-form').addEventListener('submit', handleLogin);
  byId('session-retry-btn').addEventListener('click', bootstrap);
  bootstrap();
})();
