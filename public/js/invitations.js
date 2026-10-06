(() => {
  'use strict';
  const api = window.AgentAPI;
  const byId = id => document.getElementById(id);
  const labels = { pending: '等待回覆', accepted: '已接受', declined: '已拒絕', revoked: '已取消' };
  let user = null;
  let invitations = [];
  let busy = false;
  let ready = false;
  let invalidated = false;
  let action = null;
  function node(tag, className, text) {
    const value = document.createElement(tag);
    if (className) value.className = className;
    if (text !== undefined) value.textContent = text;
    return value;
  }
  function feedback(text) {
    byId('invitation-action-error').textContent = text;
    byId('invitation-action-error').hidden = !text;
  }
  function message(text, error = false) {
    byId('page-message').textContent = text;
    byId('page-message').style.color = error ? 'var(--color-danger-text)' : 'var(--color-success-text)';
  }
  function controls() {
    if (invalidated) return;
    document.querySelectorAll('button,input').forEach(control => { control.disabled = busy; });
    document.querySelectorAll('[data-action="accept"],[data-action="decline"]').forEach(control => { control.disabled = busy || !ready || user?.role !== 'guest'; });
    byId('invitation-action-confirm-btn').disabled = busy || !action || action.blocked || (action.review && !byId('invitation-action-reviewed').checked);
    byId('invitation-action-confirm-btn').textContent = busy ? '連線中…' : action?.kind === 'decline' ? '確認拒絕' : '確認接受';
  }
  async function run(operation) {
    if (busy || invalidated) return;
    busy = true;
    controls();
    try { await operation(); }
    finally { busy = false; controls(); }
  }
  function closeAction() {
    byId('invitation-action-modal').classList.add('hidden');
    action = null;
    controls();
  }
  function renderNav() {
    const nav = node('nav');
    nav.id = 'navbar';
    const inner = node('div', 'navbar-inner');
    const brand = node('a', 'navbar-brand-name', 'Agent TT');
    brand.href = 'trip-list.php';
    const trips = node('a', 'navbar-link', '我的行程');
    trips.href = 'trip-list.php';
    const inbox = node('a', 'navbar-link active', '收到的邀請');
    inbox.href = 'invitations.php';
    const account = node('div', 'nav-user');
    account.style.marginLeft = 'auto';
    account.append(node('span', 'account-info', `${user.name} · ${user.email}`));
    const logout = node('button', 'btn btn-outline btn-sm', '登出');
    logout.id = 'logout-btn';
    logout.addEventListener('click', () => run(async () => {
      try { await api.request('/logout', { method: 'POST' }); api.clearSession(); }
      catch (error) { if (!invalidated) message('登出未完成。' + error.message, true); }
    }));
    account.append(logout);
    inner.append(brand, trips, inbox, account);
    nav.append(inner);
    byId('navbar-container').replaceChildren(nav);
    byId('footer-container').replaceChildren(node('footer', 'backend-footer', 'Agent TT · 行程練習平台'));
  }
  function render() {
    const cards = invitations.map(invitation => {
      const card = node('article', 'membership-card invitation-card');
      card.dataset.id = invitation.id;
      card.dataset.status = invitation.status;
      const body = node('div', 'membership-body');
      body.append(node('strong', 'membership-name invitation-trip-name', invitation.trip.name),
        node('p', 'membership-meta', `${invitation.trip.startDate} — ${invitation.trip.endDate} · ${invitation.trip.station}`),
        node('p', 'membership-meta', `邀請人：${invitation.inviter.name} · ${invitation.inviter.email}`),
        node('span', 'membership-status ' + invitation.status, labels[invitation.status] || invitation.status));
      card.append(body);
      const actions = node('div', 'membership-actions');
      if (invitation.status === 'pending' && user.role === 'guest') {
        [['accept', '接受'], ['decline', '拒絕']].forEach(([kind, text]) => {
          const button = node('button', 'btn btn-outline btn-sm', text);
          button.dataset.action = kind;
          button.addEventListener('click', () => openAction(invitation, kind));
          actions.append(button);
        });
      }
      if (invitation.canOpenTrip === true) {
        const link = node('a', 'btn btn-primary btn-sm', '查看行程');
        link.href = 'trip-edit.php?tripId=' + encodeURIComponent(invitation.tripId);
        link.dataset.action = 'open';
        actions.append(link);
      }
      card.append(actions);
      return card;
    });
    byId('invitations-list').replaceChildren(...(cards.length ? cards : [node('p', 'empty-state', '目前沒有收到邀請。')]));
    byId('invitations-loading').hidden = true;
    byId('invitations-error').hidden = true;
    controls();
  }
  async function refresh() {
    const result = await api.request('/invitations');
    if (!Array.isArray(result)) throw new api.ApiError('邀請資料格式不正確，請重新載入。');
    if (invalidated) return;
    invitations = result;
    ready = true;
    render();
  }
  function readFailed(text) {
    if (invalidated) return;
    ready = false;
    invitations = [];
    byId('invitations-list').replaceChildren();
    byId('invitations-loading').hidden = true;
    byId('invitations-error-text').textContent = text;
    byId('invitations-error').hidden = false;
  }
  function openAction(invitation, kind) {
    if (busy || !ready || user.role !== 'guest' || invitation.status !== 'pending') return;
    action = { id: invitation.id, kind, version: invitation.version, blocked: false, review: false, attempt: null };
    byId('invitation-action-title').textContent = kind === 'accept' ? '接受邀請' : '拒絕邀請';
    byId('invitation-action-name').textContent = `「${invitation.trip.name}」 · 邀請人 ${invitation.inviter.name}`;
    byId('invitation-action-status').textContent = '目前狀態：' + labels[invitation.status];
    byId('invitation-action-review').hidden = true;
    byId('invitation-action-reviewed').checked = false;
    byId('invitation-action-retry-btn').hidden = true;
    feedback('');
    byId('invitation-action-modal').classList.remove('hidden');
    controls();
  }
  async function reviewLatest(reason, confirmedWrite = false) {
    if (!action || invalidated) return;
    action.blocked = true;
    byId('invitation-action-reviewed').checked = false;
    byId('invitation-action-retry-btn').hidden = true;
    try {
      await refresh();
      if (!action || invalidated) return;
      const latest = invitations.find(invitation => invitation.id === action.id);
      if (!latest) {
        byId('invitation-action-status').textContent = '這筆邀請已無法查看。';
        byId('invitation-action-review').hidden = true;
        feedback('邀請或行程已不存在，請關閉此視窗。');
        return;
      }
      byId('invitation-action-name').textContent = `「${latest.trip.name}」 · 邀請人 ${latest.inviter.name}`;
      byId('invitation-action-status').textContent = '最新狀態：' + labels[latest.status];
      if (latest.status !== 'pending') {
        const status = labels[latest.status] || latest.status;
        closeAction();
        message(`最新狀態已確認：${status}。` + (latest.status === 'accepted' && !latest.canOpenTrip ? '目前沒有查看此行程的權限。' : ''));
        return;
      }
      action.version = latest.version;
      action.blocked = false;
      action.review = true;
      byId('invitation-action-review').hidden = false;
      byId('invitation-action-latest').textContent = `最新狀態仍為等待回覆；目前${latest.canOpenTrip ? '可以' : '無法'}查看行程。請核對後，再決定是否${action.kind === 'accept' ? '接受' : '拒絕'}這份邀請。`;
      feedback(confirmedWrite ? '操作回應已收到，但目前邀請又有新狀態。請以最新資料為準。' : reason || '尚未確認操作結果，請核對最新狀態後再操作。');
    } catch (error) {
      if (!action || invalidated) return;
      readFailed('最新邀請狀態載入失敗。請重新載入核對。 ' + error.message);
      byId('invitation-action-retry-btn').hidden = false;
      feedback(confirmedWrite ? '操作回應已收到，但最新狀態尚未確認。請重新取得最新狀態；系統不會再次送出操作。' : '操作結果尚未確認，請重新取得最新狀態。 ' + error.message);
    }
  }
  async function confirm() {
    if (busy || !action || action.blocked || (action.review && !byId('invitation-action-reviewed').checked)) return;
    const payload = { version: action.version };
    const signature = action.kind + ':' + JSON.stringify(payload);
    if (action.attempt?.signature !== signature) action.attempt = { signature, key: api.newRequestKey() };
    await run(async () => {
      feedback('');
      try {
        const result = await api.request('/invitations/' + encodeURIComponent(action.id) + '/' + action.kind, { method: 'POST', body: payload, idempotencyKey: action.attempt.key });
        if (invalidated) return;
        if (result?.invitation?.id !== action.id) throw new api.ApiError('操作結果無法確認，請核對最新狀態。');
        await reviewLatest('', true);
      } catch (error) {
        if (invalidated || !action) return;
        if (error.status === 409 || error.status === 404 || error.status === 0 || error.status >= 500) await reviewLatest(error.message);
        else feedback(error.message);
      }
    });
  }
  async function load() {
    await run(async () => {
      byId('invitations-error').hidden = true;
      if (!ready) byId('invitations-loading').hidden = false;
      try {
        if (!user) {
          const session = await api.loadSession();
          if (!session.user) { api.clearSession(); return; }
          user = session.user;
          renderNav();
        }
        if (action?.blocked) await reviewLatest('最新資料已載入，請核對後再操作。');
        else await refresh();
      } catch (error) { readFailed(error.message); }
    });
  }
  byId('invitations-retry-btn').addEventListener('click', load);
  byId('invitation-action-confirm-btn').addEventListener('click', confirm);
  byId('invitation-action-retry-btn').addEventListener('click', () => run(() => reviewLatest('最新狀態已載入，請核對後再操作。')));
  byId('invitation-action-reviewed').addEventListener('change', controls);
  document.querySelectorAll('[data-close="invitation-action-modal"]').forEach(button => button.addEventListener('click', () => { if (!busy) closeAction(); }));
  byId('invitation-action-modal').addEventListener('click', event => { if (event.target.id === 'invitation-action-modal' && !busy) closeAction(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !busy) closeAction(); });
  window.addEventListener('agenttt:unauthorized', () => {
    invalidated = true;
    user = null;
    invitations = [];
    action = null;
    ready = false;
    byId('invitations-list').replaceChildren();
    byId('navbar-container').replaceChildren();
    byId('invitation-action-modal').classList.add('hidden');
    byId('invitation-action-name').textContent = '';
    byId('app').hidden = true;
    location.replace('login.php');
  });
  load();
})();
