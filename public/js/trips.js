(() => {
  'use strict';
  const api = window.AgentAPI;
  const byId = id => document.getElementById(id);
  const statuses = {
    planning: { label: '規劃中', cls: 'badge-warning' },
    completed: { label: '已完成', cls: 'badge-success' },
    cancelled: { label: '已取消', cls: 'badge-neutral' },
  };
  let user = null;
  let trips = [];
  let ready = false;
  let busy = false;
  let filter = 'all';
  let createStep = 1;
  let createAttempt = null;
  let editing = null;
  let deleting = null;
  let deleteConflict = false;
  let conflictVersion = null;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function showError(id, message) {
    const node = byId(id);
    node.textContent = message;
    node.classList.toggle('hidden', !message);
    node.style.display = message ? 'block' : 'none';
  }
  function message(text, isError = false) {
    const node = byId('page-message');
    node.textContent = text;
    node.style.color = isError ? 'var(--color-danger-text)' : 'var(--color-success-text)';
  }
  function editable(trip) { return user?.role === 'guest' && trip?.canEdit === true; }
  function setBusy(value) {
    busy = value;
    document.querySelectorAll('button, .trip-status-select').forEach(node => { node.disabled = value; });
    byId('create-trip-btn').disabled = value || !ready || user?.role !== 'guest';
    document.querySelectorAll('.filter-btn').forEach(node => { node.disabled = value || !ready; });
    document.querySelectorAll('#create-modal input, #create-modal select, #edit-modal input:not([type="hidden"]), #edit-modal select')
      .forEach(node => { node.disabled = value; });
    if (conflictVersion !== null && !byId('edit-conflict-reviewed').checked) byId('edit-save-btn').disabled = true;
    if (conflictVersion === false) byId('edit-save-btn').disabled = true;
    if (deleteConflict) byId('delete-confirm-btn').disabled = true;
    byId('modal-next-btn').textContent = value && createStep === 3 ? '儲存中…' : createStep === 3 ? '建立行程' : '下一步 →';
    byId('edit-save-btn').textContent = value && editing ? '儲存中…' : '儲存變更';
  }
  function fmtDate(value) { return value ? value.replaceAll('-', '/') : '—'; }
  function days(start, end) { return Math.round((Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86400000) + 1; }
  function findTrip(id) { return trips.find(trip => trip.id === id); }
  function data(prefix) {
    return { name: byId(prefix + '-name').value.trim(), startDate: byId(prefix + '-start').value,
      endDate: byId(prefix + '-end').value, station: byId(prefix + '-station').value,
      budget: Number(byId(prefix + '-budget').value || 0) };
  }
  function validate(payload, stationRequired = true) {
    if (!payload.name) return '請輸入行程名稱';
    if (Array.from(payload.name).length > 40) return '行程名稱最多 40 個字';
    if (!payload.startDate || !payload.endDate) return '請選擇出發與返回日期';
    if (payload.endDate < payload.startDate) return '返回日期不能早於出發日期';
    if (!Number.isInteger(payload.budget) || payload.budget < 0 || payload.budget > 1000000000) return '預算須為 0 至 1,000,000,000 的整數';
    if (stationRequired && !payload.station) return '請選擇出發車站';
    return '';
  }

  function renderNav() {
    const nav = element('nav');
    nav.id = 'navbar';
    nav.setAttribute('aria-label', '主導覽列');
    const inner = element('div', 'navbar-inner');
    const brand = element('a', 'navbar-brand');
    brand.href = 'trip-list.php';
    brand.append(element('span', 'navbar-brand-name', 'Agent TT'));
    inner.append(brand);
    const link = element('a', 'navbar-link active', '我的行程');
    link.href = 'trip-list.php';
    inner.append(link);
    const account = element('div', 'nav-user');
    account.style.marginLeft = 'auto';
    const role = { guest: '旅客', host: '房東', admin: '管理員' }[user.role] || '會員';
    account.append(element('span', 'account-info', `${user.name} · ${role} · ${user.email}`));
    const logout = element('button', 'btn btn-outline btn-sm', '登出');
    logout.id = 'logout-btn';
    logout.style.color = 'var(--color-primary)';
    logout.addEventListener('click', doLogout);
    account.append(logout);
    inner.append(account);
    nav.append(inner);
    byId('navbar-container').replaceChildren(nav);
    byId('footer-container').replaceChildren(element('footer', 'backend-footer', 'Agent TT · 行程練習平台'));
  }

  function card(trip) {
    const row = element('article', 'trip-card');
    row.dataset.id = trip.id;
    const date = element('div', 'trip-date-box');
    const parts = trip.startDate.split('-');
    date.append(element('div', 'trip-date-month', Number(parts[1]) + '月'), element('div', 'trip-date-day', String(Number(parts[2]))));
    row.append(date);
    const info = element('div');
    const title = element('div', 'trip-name-row');
    const status = statuses[trip.effectiveStatus || trip.status] || statuses.planning;
    title.append(element('span', 'trip-name', trip.name), element('span', 'badge ' + status.cls, status.label));
    const meta = element('div', 'trip-meta');
    meta.append(element('span', 'trip-meta-item', '📍 ' + trip.station),
      element('span', 'trip-meta-item', '📅 ' + fmtDate(trip.startDate) + ' — ' + fmtDate(trip.endDate)),
      element('span', 'trip-meta-item', '🗓 ' + days(trip.startDate, trip.endDate) + ' 天'));
    info.append(title, meta, element('p', 'trip-budget', '預估預算：NT$ ' + Number(trip.budget).toLocaleString('zh-TW')));
    row.append(info);
    const actions = element('div', 'trip-actions');
    const query = '?tripId=' + encodeURIComponent(trip.id);
    const details = element('a', 'btn btn-primary btn-sm', '行程編排');
    details.href = 'trip-edit.php' + query;
    details.dataset.action = 'details';
    const expenses = element('a', 'btn btn-outline btn-sm', '費用管理');
    expenses.href = 'trip-expense.php' + query;
    expenses.dataset.action = 'expenses';
    actions.append(details, expenses);
    if (editable(trip)) {
      const edit = element('button', 'btn btn-primary btn-sm', '編輯基本資料');
      edit.dataset.action = 'edit';
      edit.addEventListener('click', () => openEditModal(trip.id));
      const select = element('select', 'trip-status-select');
      select.setAttribute('aria-label', '行程狀態');
      Object.entries(statuses).forEach(([value, entry]) => {
        const option = element('option', '', entry.label);
        option.value = value;
        select.append(option);
      });
      select.value = trip.effectiveStatus || trip.status;
      select.addEventListener('change', () => setTripStatus(trip.id, select.value));
      const remove = element('button', 'btn btn-ghost btn-sm', '刪除');
      remove.dataset.action = 'delete';
      remove.addEventListener('click', () => openDeleteModal(trip.id));
      actions.append(edit, select, remove);
    }
    row.append(actions);
    return row;
  }

  function renderList() {
    if (!ready) return;
    const visible = trips.filter(trip => filter === 'all' || (trip.effectiveStatus || trip.status) === filter);
    byId('trip-count-text').textContent = `共 ${trips.length} 個行程` + (filter === 'all' ? '' : `，目前顯示 ${visible.length} 個`);
    if (visible.length) byId('trip-list').replaceChildren(...visible.map(card));
    else {
      const empty = element('div', 'empty-state');
      empty.append(element('div', 'empty-state-icon', '🗺️'), element('div', 'empty-state-title', filter === 'all' ? '目前沒有行程' : '沒有符合的行程'),
        element('div', 'empty-state-desc', user.role === 'guest' ? '可建立行程，或切換篩選條件。' : '目前行程建立功能提供給旅客帳號。'));
      byId('trip-list').replaceChildren(empty);
    }
    setBusy(busy);
  }

  async function refreshSnapshot() {
    const result = await api.request('/trips');
    if (!Array.isArray(result)) throw new api.ApiError('行程資料格式不正確，請重新載入。');
    if (!api.user) return;
    trips = result;
    ready = true;
    renderList();
  }

  async function loadTrips() {
    if (busy || !user) return;
    setBusy(true);
    byId('list-error').hidden = true;
    try { await refreshSnapshot(); }
    catch (error) {
      byId('list-error-text').textContent = error.message + (ready ? ' 目前顯示上次載入的資料。' : '');
      byId('list-error').hidden = false;
      if (!ready) { byId('trip-list').replaceChildren(); byId('trip-count-text').textContent = '行程尚未載入'; }
    } finally { setBusy(false); }
  }

  function updateTrip(trip) {
    const index = trips.findIndex(item => item.id === trip.id);
    if (index === -1) trips.unshift(trip); else trips[index] = trip;
    renderList();
  }

  window.setFilter = value => {
    if (busy || !ready || (value !== 'all' && !statuses[value])) return;
    filter = value;
    document.querySelectorAll('.filter-btn').forEach(button => { button.classList.toggle('active', button.dataset.filter === value); });
    renderList();
  };

  function updateSteps() {
    [1, 2, 3].forEach(number => {
      byId('create-step-' + number).style.display = number === createStep ? 'block' : 'none';
      const node = byId('step-ind-' + number);
      node.classList.toggle('active', number === createStep);
      node.classList.toggle('done', number < createStep);
      node.querySelector('.step-circle').textContent = number < createStep ? '✓' : String(number);
    });
    byId('modal-back-btn').style.display = createStep > 1 ? 'inline-flex' : 'none';
    setBusy(busy);
  }
  function openCreateModal() {
    if (busy || !ready || user?.role !== 'guest') return;
    createStep = 1;
    createAttempt = null;
    ['name', 'start', 'end', 'budget', 'station'].forEach(field => { byId('new-trip-' + field).value = ''; });
    ['step1-error', 'step2-error', 'step3-error'].forEach(id => showError(id, ''));
    updateSteps();
    byId('create-modal').classList.remove('hidden');
    byId('new-trip-name').focus();
  }
  function closeCreateModal(force = false) { if (!busy || force) byId('create-modal').classList.add('hidden'); }
  function nextStep() {
    if (busy) return;
    const payload = data('new-trip');
    if (createStep === 1) {
      const error = validate(payload, false);
      showError('step1-error', error);
      if (error) return;
      createStep = 2;
    } else if (createStep === 2) {
      const error = validate(payload);
      showError('step2-error', error);
      if (error) return;
      byId('confirm-name').textContent = payload.name;
      byId('confirm-station').textContent = payload.station;
      byId('confirm-start').textContent = fmtDate(payload.startDate);
      byId('confirm-end').textContent = fmtDate(payload.endDate);
      byId('confirm-days').textContent = days(payload.startDate, payload.endDate) + ' 天';
      byId('confirm-budget').textContent = 'NT$ ' + payload.budget.toLocaleString('zh-TW');
      createStep = 3;
    } else { doCreateTrip(); return; }
    updateSteps();
  }
  function prevStep() { if (!busy && createStep > 1) { createStep--; updateSteps(); } }
  async function doCreateTrip() {
    if (busy || user?.role !== 'guest') return;
    const payload = data('new-trip');
    const error = validate(payload);
    if (error) { showError('step3-error', error); return; }
    const signature = JSON.stringify(payload);
    if (!createAttempt || createAttempt.signature !== signature) createAttempt = { signature, key: api.newRequestKey() };
    setBusy(true);
    showError('step3-error', '');
    try {
      const trip = await api.request('/trips', { method: 'POST', body: payload, idempotencyKey: createAttempt.key });
      updateTrip(trip);
      closeCreateModal(true);
      createAttempt = null;
      message('行程已建立並儲存。');
    } catch (failure) { showError('step3-error', failure.message); }
    finally { setBusy(false); }
  }

  function openEditModal(id) {
    if (busy || !editable(findTrip(id))) return;
    editing = { id, version: findTrip(id).version };
    conflictVersion = null;
    const trip = findTrip(id);
    byId('edit-trip-id').value = id;
    ['name', 'startDate', 'endDate', 'station', 'budget'].forEach(field => {
      const suffix = { startDate: 'start', endDate: 'end' }[field] || field;
      byId('edit-trip-' + suffix).value = trip[field];
    });
    showError('edit-trip-error', '');
    byId('edit-conflict').hidden = true;
    byId('edit-conflict-reviewed').checked = false;
    byId('edit-modal').classList.remove('hidden');
    setBusy(false);
  }
  function closeEditModal(force = false) {
    if (busy && !force) return;
    byId('edit-modal').classList.add('hidden');
    editing = null;
    conflictVersion = null;
  }
  async function editConflict() {
    byId('edit-conflict-reviewed').checked = false;
    try {
      await refreshSnapshot();
      const latest = findTrip(editing.id);
      if (!latest) {
        conflictVersion = false;
        showError('edit-trip-error', '此行程已被刪除。已保留表單內容，請先關閉此視窗。');
        return;
      }
      conflictVersion = latest.version;
      byId('edit-conflict').hidden = false;
      byId('edit-conflict-latest').textContent = `最新資料：「${latest.name}」，${fmtDate(latest.startDate)} — ${fmtDate(latest.endDate)}，${latest.station}，預算 NT$ ${Number(latest.budget).toLocaleString('zh-TW')}。`;
      showError('edit-trip-error', '行程已在其他頁面更新。已保留你的輸入；核對最新資料後，再決定是否儲存。');
    } catch (error) {
      conflictVersion = false;
      showError('edit-trip-error', '行程已在其他頁面更新，但最新資料載入失敗。你的輸入仍保留，請關閉此視窗並重新載入列表後再修改。 ' + error.message);
    }
  }
  async function saveEditTrip() {
    if (busy || !editing || conflictVersion === false) return;
    if (conflictVersion !== null && !byId('edit-conflict-reviewed').checked) return;
    const payload = data('edit-trip');
    const error = validate(payload);
    if (error) { showError('edit-trip-error', error); return; }
    payload.version = conflictVersion === null ? editing.version : conflictVersion;
    setBusy(true);
    showError('edit-trip-error', '');
    try {
      const trip = await api.request('/trips/' + encodeURIComponent(editing.id), { method: 'PATCH', body: payload });
      updateTrip(trip);
      closeEditModal(true);
      message('行程已更新。');
    } catch (failure) {
      if (failure.status === 409) await editConflict();
      else showError('edit-trip-error', failure.message);
    } finally { setBusy(false); }
  }

  async function setTripStatus(id, status) {
    const trip = findTrip(id);
    if (busy || !editable(trip) || !statuses[status]) return;
    setBusy(true);
    message('');
    try {
      updateTrip(await api.request('/trips/' + encodeURIComponent(id), { method: 'PATCH', body: { status, version: trip.version } }));
      message('行程狀態已更新。');
    } catch (error) {
      if (error.status === 409) {
        try { await refreshSnapshot(); message('行程已在其他頁面更新，已載入最新狀態。請確認後再操作。', true); }
        catch (failure) { message('狀態尚未更新。' + failure.message, true); }
      } else { renderList(); message(error.message, true); }
    } finally { setBusy(false); }
  }

  function openDeleteModal(id) {
    const trip = findTrip(id);
    if (busy || !editable(trip)) return;
    deleting = { id, version: trip.version };
    deleteConflict = false;
    setBusy(false);
    byId('delete-trip-name').textContent = trip.name;
    showError('delete-error', '');
    byId('delete-modal').classList.remove('hidden');
  }
  function closeDeleteModal(force = false) {
    if (busy && !force) return;
    deleting = null;
    deleteConflict = false;
    byId('delete-modal').classList.add('hidden');
  }
  async function confirmDelete() {
    if (busy || !deleting || deleteConflict) return;
    setBusy(true);
    showError('delete-error', '');
    try {
      await api.request('/trips/' + encodeURIComponent(deleting.id), { method: 'DELETE', body: { version: deleting.version } });
      trips = trips.filter(trip => trip.id !== deleting.id);
      renderList();
      closeDeleteModal(true);
      message('行程已刪除。');
    } catch (error) {
      if (error.status === 409) {
        try { await refreshSnapshot(); }
        catch (_) { /* Keep the conflict message and never retry a destructive action. */ }
        showError('delete-error', '行程已在其他頁面更新。請取消刪除、確認最新資料後，再重新開啟刪除視窗。');
        deleteConflict = true;
      } else showError('delete-error', error.message);
    } finally {
      setBusy(false);
    }
  }

  async function doLogout() {
    if (busy) return;
    setBusy(true);
    try {
      await api.request('/logout', { method: 'POST' });
      trips = [];
      user = null;
      ready = false;
      byId('trip-list').replaceChildren();
      api.clearSession();
    } catch (error) { message('登出未完成。' + error.message, true); setBusy(false); }
  }

  Object.assign(window, { openCreateModal, closeCreateModal, nextStep, prevStep, doCreateTrip,
    openEditModal, closeEditModal, saveEditTrip, setTripStatus, openDeleteModal, closeDeleteModal, confirmDelete });
  window.addEventListener('agenttt:unauthorized', () => {
    trips = [];
    user = null;
    ready = false;
    editing = null;
    deleting = null;
    createAttempt = null;
    ['create-modal', 'edit-modal', 'delete-modal'].forEach(id => byId(id).classList.add('hidden'));
    document.querySelectorAll('.modal-backdrop input').forEach(input => { input.value = ''; });
    byId('trip-list').replaceChildren();
    byId('navbar-container').replaceChildren();
    byId('app').hidden = true;
    window.location.replace('login.php');
  });
  byId('list-retry-btn').addEventListener('click', () => { if (user) loadTrips(); else bootstrap(); });
  byId('edit-conflict-reviewed').addEventListener('change', () => setBusy(busy));
  byId('new-trip-start').addEventListener('change', () => { byId('new-trip-end').min = byId('new-trip-start').value; });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !busy) { closeCreateModal(); closeEditModal(); closeDeleteModal(); }
  });
  document.querySelectorAll('.modal-backdrop').forEach(modal => {
    modal.addEventListener('click', event => {
      if (event.target !== modal || busy) return;
      if (modal.id === 'create-modal') closeCreateModal();
      if (modal.id === 'edit-modal') closeEditModal();
      if (modal.id === 'delete-modal') closeDeleteModal();
    });
  });

  async function bootstrap() {
    if (busy) return;
    setBusy(true);
    try {
      const session = await api.loadSession();
      if (!session.user) { window.location.replace('login.php'); return; }
      user = session.user;
      renderNav();
      await refreshSnapshot();
    } catch (error) {
      byId('trip-count-text').textContent = '行程尚未載入';
      byId('trip-list').replaceChildren();
      byId('list-error-text').textContent = error.message;
      byId('list-error').hidden = false;
    } finally { setBusy(false); }
  }
  bootstrap();
})();
