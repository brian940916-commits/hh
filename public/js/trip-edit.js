(() => {
  'use strict';
  const { TripPage, TripForm, TripDelete, byId, node, feedback, validDate } = window.TripUI;
  const api = window.AgentAPI;
  const types = { attraction: '景點', restaurant: '餐廳', activity: '活動', hotel: '住宿安排', train: '交通安排' };
  let selectedDate = '';
  let orderState = null;
  const dayNumber = (start, end) => Math.round((Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86400000);
  const dateAt = (start, offset) => new Date(Date.parse(start + 'T00:00:00Z') + offset * 86400000).toISOString().slice(0, 10);
  const page = new TripPage({ file: 'trip-edit.php', render });

  function dayItems(date = selectedDate) {
    return page.snapshot.items.filter(item => item.date === date).sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
  }
  function renderDays(trip) {
    if (!validDate(selectedDate, trip)) selectedDate = trip.startDate;
    const total = dayNumber(trip.startDate, trip.endDate) + 1;
    const selected = dayNumber(trip.startDate, selectedDate);
    const first = Math.floor(selected / 14) * 14;
    const tabs = [];
    if (first > 0) {
      const previous = node('button', 'day-tab', '← 前 14 天');
      previous.addEventListener('click', () => { selectedDate = dateAt(trip.startDate, first - 14); render(page.snapshot); page.updateControls(); });
      tabs.push(previous);
    }
    for (let offset = first; offset < Math.min(total, first + 14); offset++) {
      const date = dateAt(trip.startDate, offset);
      const button = node('button', 'day-tab' + (date === selectedDate ? ' active' : ''), `第 ${offset + 1} 天 · ${date.slice(5)}`);
      button.dataset.date = date;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(date === selectedDate));
      button.addEventListener('click', () => { if (!page.busy) { selectedDate = date; render(page.snapshot); page.updateControls(); } });
      tabs.push(button);
    }
    if (first + 14 < total) {
      const next = node('button', 'day-tab', '後 14 天 →');
      next.addEventListener('click', () => { selectedDate = dateAt(trip.startDate, first + 14); render(page.snapshot); page.updateControls(); });
      tabs.push(next);
    }
    byId('day-tabs').replaceChildren(...tabs);
    byId('day-label').textContent = `${selectedDate} · 第 ${selected + 1} 天`;
  }
  function action(label, type, item, callback, boundary = false) {
    const button = node('button', 'btn btn-ghost btn-sm', label);
    button.dataset.action = type;
    button.setAttribute('data-write', '');
    if (boundary) button.dataset.boundary = 'true';
    button.addEventListener('click', () => { if (!page.busy) callback(item); });
    return button;
  }
  function render(snapshot) {
    renderDays(snapshot.trip);
    const items = dayItems();
    const conflicting = new Set();
    let overlaps = 0;
    for (let left = 0; left < items.length; left++) {
      for (let right = left + 1; right < items.length; right++) {
        if (items[left].startTime < items[right].endTime && items[right].startTime < items[left].endTime) {
          overlaps++;
          conflicting.add(items[left].id);
          conflicting.add(items[right].id);
        }
      }
    }
    byId('conflict-banner').hidden = overlaps === 0;
    byId('conflict-banner').classList.toggle('show', overlaps > 0);
    byId('conflict-banner').textContent = overlaps ? `有 ${overlaps} 組安排時間重疊，請核對時間；仍可儲存這些安排。` : '';
    const cards = items.map((item, index) => {
      const card = node('article', 'item-card');
      card.dataset.id = item.id;
      const body = node('div', 'item-body');
      const title = node('div', 'item-name-row');
      title.append(node('span', 'item-name', item.name), node('span', 'badge badge-neutral', types[item.type] || item.type),
        node('span', 'badge ' + (item.priority === 'must' ? 'badge-danger' : 'badge-neutral'), item.priority === 'must' ? '必去' : '候補'));
      if (conflicting.has(item.id)) { card.dataset.conflict = 'true'; title.append(node('span', 'badge badge-warning', '時間重疊')); }
      body.append(title, node('div', 'item-meta', `${item.startTime} — ${item.endTime}`));
      if (item.note) body.append(node('p', 'item-note', item.note));
      card.append(body);
      if (page.canEdit) {
        const actions = node('div', 'item-actions');
        actions.append(action('上移', 'up', item, value => move(value, -1), index === 0),
          action('下移', 'down', item, value => move(value, 1), index === items.length - 1),
          action('編輯', 'edit', item, value => form.open(value)), action('刪除', 'delete', item, value => deletion.open(value)));
        card.append(actions);
      }
      return card;
    });
    byId('item-list').replaceChildren(...(cards.length ? cards : [node('p', 'empty-state', '這一天還沒有安排。')]));
  }

  const form = new TripForm(page, {
    prefix: 'item', collection: 'items', createTitle: '新增行程安排', editTitle: '編輯行程安排', savedMessage: '行程安排已儲存。',
    fill(record) {
      byId('item-name').value = record?.name || '';
      byId('item-date').value = record?.date || selectedDate;
      byId('item-start').value = record?.startTime || '09:00';
      byId('item-end').value = record?.endTime || '10:00';
      byId('item-type').value = record?.type || 'attraction';
      byId('item-priority').value = record?.priority || 'must';
      byId('item-note').value = record?.note || '';
    },
    read() {
      return { name: byId('item-name').value.trim(), date: byId('item-date').value, startTime: byId('item-start').value,
        endTime: byId('item-end').value, type: byId('item-type').value, priority: byId('item-priority').value, note: byId('item-note').value.trim() };
    },
    validate(item, snapshot) {
      if (!item.name || Array.from(item.name).length > 80) return '請輸入 1 至 80 個字的名稱';
      if (!validDate(item.date, snapshot.trip)) return '安排日期須在行程起訖日期內';
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(item.startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.endTime) || item.endTime <= item.startTime) return '請輸入有效時間，結束時間須晚於開始時間';
      if (!types[item.type] || !['must', 'optional'].includes(item.priority)) return '請選擇有效類型與優先順序';
      if (Array.from(item.note).length > 1000) return '備註最多 1000 個字';
      return '';
    },
    describe(item) { return `最新安排：「${item.name}」，${item.date} ${item.startTime} — ${item.endTime}，${types[item.type]}，${item.priority === 'must' ? '必去' : '候補'}。備註：${item.note || '無'}。`; },
    updateControls(snapshot) {
      if (!snapshot) return;
      byId('item-date').min = snapshot.trip.startDate;
      byId('item-date').max = snapshot.trip.endDate;
    },
  });
  const deletion = new TripDelete(page, 'items', 'item');
  byId('item-add-btn').addEventListener('click', () => form.open());

  async function submitOrder() {
    if (!orderState || page.busy || !page.canEdit || orderState.blocked) return;
    await page.run(async () => {
      try {
        page.apply(await api.request(page.path + '/items/order', { method: 'PUT', body: { version: orderState.version, date: orderState.date, itemIds: orderState.ids } }));
        if (page.invalidated) return;
        page.closeModal('order-conflict-modal');
        orderState = null;
        page.message('同日安排順序已更新。');
      } catch (error) {
        if (page.invalidated || !orderState) return;
        if (error.status !== 409) { page.message(error.message, true); return; }
        try {
          await page.refresh();
          if (page.invalidated || !orderState) return;
          const latest = dayItems(orderState.date);
          const index = latest.findIndex(item => item.id === orderState.itemId);
          const target = index + orderState.direction;
          byId('order-conflict-reviewed').checked = false;
          byId('order-conflict-latest').textContent = '最新順序：' + latest.map(item => item.name).join(' → ') + '。請核對後，再確認原本的上移或下移操作。';
          if (index < 0 || target < 0 || target >= latest.length) {
            orderState.blocked = true;
            byId('order-conflict-latest').textContent += ' 此安排已刪除、移到其他日期，或無法繼續移動；請取消。';
          } else {
            const ids = latest.map(item => item.id);
            if (ids.every((id, position) => id === orderState.ids[position]) && ids.length === orderState.ids.length) {
              orderState.blocked = true;
              byId('order-conflict-latest').textContent += ' 最新順序已符合剛才的安排，無需再次儲存。';
            } else {
              [ids[index], ids[target]] = [ids[target], ids[index]];
              orderState.ids = ids;
              orderState.version = page.trip.version;
            }
          }
          byId('order-conflict-modal').classList.remove('hidden');
        } catch (failure) { orderState.blocked = true; page.message('最新順序載入失敗，請重新載入後再操作。 ' + failure.message, true); }
      }
    });
  }
  function move(item, direction) {
    if (!page.canEdit || page.busy) return;
    const list = dayItems(item.date);
    const index = list.findIndex(value => value.id === item.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= list.length) return;
    const ids = list.map(value => value.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    orderState = { itemId: item.id, date: item.date, direction, ids, version: page.trip.version, blocked: false };
    submitOrder();
  }
  byId('order-conflict-confirm-btn').addEventListener('click', () => {
    if (byId('order-conflict-reviewed').checked) submitOrder();
  });
  byId('order-conflict-reviewed').addEventListener('change', () => page.updateControls());
  byId('order-conflict-modal').addEventListener('tripmodal:closed', () => { orderState = null; });
  page.controls.push(() => {
    document.querySelectorAll('[data-boundary="true"]').forEach(button => { button.disabled = true; });
    byId('order-conflict-confirm-btn').disabled = page.busy || !page.canEdit || !orderState || orderState.blocked || !byId('order-conflict-reviewed').checked;
  });
  page.clearHandlers.push(() => { orderState = null; selectedDate = ''; });
  page.load();
})();
