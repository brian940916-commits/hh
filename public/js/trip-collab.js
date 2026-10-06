(() => {
  'use strict';
  const { TripPage, byId, node, feedback } = window.TripUI;
  const api = window.AgentAPI;
  const labels = { pending: '等待回覆', accepted: '已接受', declined: '已拒絕', revoked: '已取消' };
  const draft = { dirty: false, version: null, conflict: null, attempt: null };
  let deleting = null;
  const page = new TripPage({ file: 'trip-collab.php', render });
  function button(text, action, callback) {
    const value = node('button', 'btn btn-outline btn-sm', text);
    value.type = 'button';
    value.dataset.action = action;
    value.setAttribute('data-write', '');
    value.addEventListener('click', callback);
    return value;
  }
  function render(snapshot) {
    if (!Array.isArray(snapshot.invitations)) throw new api.ApiError('邀請資料格式不正確，請重新載入。');
    if (!draft.dirty) draft.version = snapshot.trip.version;
    byId('owner-invitations').hidden = !page.canEdit;
    byId('members-list').replaceChildren(...snapshot.trip.members.map(member => {
      const card = node('article', 'membership-card member-card');
      card.dataset.userId = member.userId;
      const body = node('div', 'membership-body');
      body.append(node('strong', 'membership-name', member.name), node('p', 'membership-meta', `${member.email} · ${member.role === 'owner' ? '行程建立者' : '成員，可查看行程'}`));
      card.append(body);
      if (page.canEdit && member.role !== 'owner') {
        const actions = node('div', 'membership-actions');
        actions.append(button('移除成員', 'remove', () => openDelete('members', member.userId, member.name)));
        card.append(actions);
      }
      return card;
    }));
    const invitations = snapshot.invitations.map(invitation => {
      const card = node('article', 'membership-card trip-invitation-card');
      card.dataset.id = invitation.id;
      const body = node('div', 'membership-body');
      body.append(node('strong', 'membership-name', invitation.recipient.name), node('p', 'membership-meta', invitation.recipient.email),
        node('span', 'membership-status ' + invitation.status, labels[invitation.status] || invitation.status));
      card.append(body);
      if (page.canEdit && invitation.status === 'pending') {
        const actions = node('div', 'membership-actions');
        actions.append(button('取消邀請', 'cancel', () => openDelete('invitations', invitation.id, invitation.recipient.name)));
        card.append(actions);
      }
      return card;
    });
    byId('trip-invitations-list').replaceChildren(...(invitations.length ? invitations : [node('p', 'detail-help', '目前沒有邀請紀錄。')]));
  }
  byId('invite-email').addEventListener('input', () => { draft.dirty = true; });
  byId('invite-conflict-reviewed').addEventListener('change', () => page.updateControls());
  async function readConflict(reason = '') {
    byId('invite-conflict-reviewed').checked = false;
    byId('invite-conflict-retry-btn').hidden = true;
    try {
      await page.refresh();
      if (page.invalidated) return;
      if (!page.canEdit) { draft.conflict = false; feedback('invite-error', '目前無法建立邀請。你的輸入仍保留。'); return; }
      draft.conflict = page.trip.version;
      byId('invite-conflict').hidden = false;
      byId('invite-conflict-latest').textContent = '最新成員與邀請紀錄已載入。請核對名單後，再決定是否邀請上述帳號。';
      feedback('invite-error', reason || '行程已有新修改，你的 Email 仍保留。');
    } catch (error) {
      if (page.invalidated) return;
      draft.conflict = false;
      byId('invite-conflict-retry-btn').hidden = false;
      feedback('invite-error', '最新資料載入失敗，你的 Email 仍保留。請重新取得最新資料。 ' + error.message);
    }
  }
  byId('invite-conflict-retry-btn').addEventListener('click', () => { if (!page.busy) page.run(() => readConflict()); });
  byId('invite-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (page.busy || !page.canEdit || draft.conflict === false) return;
    if (draft.conflict !== null && !byId('invite-conflict-reviewed').checked) return;
    if (!byId('invite-form').reportValidity()) return;
    const payload = { email: byId('invite-email').value.trim().toLowerCase(), version: draft.conflict === null ? draft.version : draft.conflict };
    draft.dirty = true;
    const signature = JSON.stringify(payload);
    if (draft.attempt?.signature !== signature) draft.attempt = { signature, key: api.newRequestKey() };
    await page.run(async () => {
      feedback('invite-error', '');
      try {
        page.apply(await api.request(page.path + '/invitations', { method: 'POST', body: payload, idempotencyKey: draft.attempt.key }));
        if (page.invalidated) return;
        draft.dirty = false;
        draft.conflict = null;
        draft.attempt = null;
        byId('invite-email').value = '';
        byId('invite-conflict').hidden = true;
        byId('invite-conflict-retry-btn').hidden = true;
        try { await page.refresh(); page.message('邀請已建立，對方登入後可在「收到的邀請」回覆。'); }
        catch (error) { page.savedButRefreshFailed('邀請已建立，但最新紀錄載入失敗。請重新載入核對。 ' + error.message); }
      } catch (failure) {
        if (page.invalidated) return;
        if (failure.status === 409) await readConflict(failure.message);
        else feedback('invite-error', failure.message);
      }
    });
  });
  function openDelete(collection, id, name) {
    if (page.busy || !page.canEdit) return;
    deleting = { collection, id, version: page.trip.version, blocked: false };
    byId('membership-delete-title').textContent = collection === 'members' ? '移除成員' : '取消邀請';
    byId('membership-delete-name').textContent = collection === 'members' ? `確定移除「${name}」？` : `確定取消給「${name}」的邀請？`;
    feedback('membership-delete-error', '');
    byId('membership-delete-modal').classList.remove('hidden');
    page.updateControls();
  }
  byId('membership-delete-modal').addEventListener('tripmodal:closed', () => { deleting = null; });
  byId('membership-delete-confirm-btn').addEventListener('click', async () => {
    if (page.busy || !page.canEdit || !deleting || deleting.blocked) return;
    await page.run(async () => {
      try {
        page.apply(await api.request(page.path + '/' + deleting.collection + '/' + encodeURIComponent(deleting.id), { method: 'DELETE', body: { version: deleting.version } }));
        if (page.invalidated) return;
        page.closeModal('membership-delete-modal');
        page.message('操作已完成。');
      } catch (failure) {
        if (page.invalidated || !deleting) return;
        if (failure.status === 409) {
          deleting.blocked = true;
          try { await page.refresh(); } catch (_) { /* A destructive request always needs a new confirmation. */ }
          if (!page.invalidated) feedback('membership-delete-error', failure.code === 'MEMBER_HAS_EXPENSES' ? '這位成員仍是支出的付款人或分攤人，請先調整費用。資料未移除。' : '行程或邀請已有新修改。請取消此視窗、核對最新資料後，再重新確認操作。');
        } else feedback('membership-delete-error', failure.message);
      }
    });
  });
  page.controls.push(() => {
    byId('invite-save-btn').disabled = page.busy || !page.canEdit || draft.conflict === false || (draft.conflict !== null && !byId('invite-conflict-reviewed').checked);
    byId('invite-save-btn').textContent = page.busy ? '連線中…' : '建立邀請';
    if (deleting?.blocked) byId('membership-delete-confirm-btn').disabled = true;
  });
  page.clearHandlers.push(() => { draft.attempt = null; draft.dirty = false; draft.version = null; draft.conflict = null; deleting = null; });
  page.load();
})();
