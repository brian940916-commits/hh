(() => {
  'use strict';
  const { TripPage, TripForm, TripDelete, byId, node, feedback, money, validDate } = window.TripUI;
  const api = window.AgentAPI;
  const categories = { transport: '交通', accommodation: '住宿', food: '餐飲', activity: '活動', other: '其他' };
  const budget = { dirty: false, version: null, conflict: null };
  const page = new TripPage({ file: 'trip-expense.php', render });
  const memberName = id => page.trip.members.find(member => member.userId === id)?.name || '未知成員';

  function render(snapshot) {
    const summary = snapshot.summary;
    byId('summary-budget').textContent = Number(summary.budget).toLocaleString('zh-TW');
    byId('summary-spent').textContent = Number(summary.totalSpent).toLocaleString('zh-TW');
    byId('summary-remaining').textContent = Number(summary.remaining).toLocaleString('zh-TW');
    byId('summary-remaining').classList.toggle('over', summary.overBudget === true);
    byId('summary-over-budget').textContent = Math.max(0, -Number(summary.remaining)).toLocaleString('zh-TW');
    byId('summary-over-budget').classList.toggle('over', summary.overBudget === true);
    if (!budget.dirty) {
      byId('budget-input').value = snapshot.trip.budget;
      budget.version = snapshot.trip.version;
    }
    if (budget.conflict === false && budget.dirty) {
      budget.conflict = snapshot.trip.version;
      byId('budget-conflict-reviewed').checked = false;
      byId('budget-conflict').hidden = false;
      byId('budget-conflict-latest').textContent = '最新預算：' + money(snapshot.trip.budget) + '。你的輸入仍保留，請核對後再儲存。';
      feedback('budget-error', '最新資料已載入，請核對後再儲存。');
    }
    const expenseCards = snapshot.expenses.map(expense => {
      const card = node('article', 'expense-card');
      card.dataset.id = expense.id;
      const body = node('div', 'expense-body');
      const title = node('div', 'item-name-row');
      title.append(node('span', 'expense-name', expense.name), node('span', 'badge badge-neutral', categories[expense.category] || expense.category),
        node('strong', 'expense-amount', money(expense.amount)));
      body.append(title, node('div', 'expense-meta', `${expense.date} · 付款：${memberName(expense.payerId)} · 分攤：${expense.participantIds.map(memberName).join('、')}`));
      if (expense.note) body.append(node('p', 'expense-note', expense.note));
      card.append(body);
      if (page.canEdit) {
        const actions = node('div', 'expense-actions');
        const edit = node('button', 'btn btn-ghost btn-sm', '編輯');
        edit.dataset.action = 'edit';
        edit.setAttribute('data-write', '');
        edit.addEventListener('click', () => form.open(expense));
        const remove = node('button', 'btn btn-ghost btn-sm', '刪除');
        remove.dataset.action = 'delete';
        remove.setAttribute('data-write', '');
        remove.addEventListener('click', () => deletion.open(expense));
        actions.append(edit, remove);
        card.append(actions);
      }
      return card;
    });
    byId('expense-list').replaceChildren(...(expenseCards.length ? expenseCards : [node('p', 'empty-state', '目前沒有支出記錄。')]));
    byId('category-summary').replaceChildren(...summary.byCategory.map(entry => {
      const row = node('div', 'detail-summary-row');
      row.append(node('span', '', categories[entry.category] || entry.category), node('strong', '', money(entry.amount)));
      return row;
    }));
    byId('balances-list').replaceChildren(...summary.balances.map(balance => {
      const row = node('div', 'balance-row');
      row.dataset.userId = balance.userId;
      const info = node('div');
      info.append(node('strong', '', balance.name), node('p', 'detail-help', `已付 ${money(balance.paid)} · 應分攤 ${money(balance.share)}`));
      const label = balance.balance > 0 ? '待收 ' : balance.balance < 0 ? '待付 ' : '已平衡 ';
      row.append(info, node('strong', 'balance-amount', label + money(Math.abs(balance.balance))));
      return row;
    }));
    const settlements = summary.settlements.map(entry => node('p', 'settlement-row', `${memberName(entry.fromUserId)} → ${memberName(entry.toUserId)}：${money(entry.amount)}`));
    byId('settlements-list').replaceChildren(...(settlements.length ? settlements : [node('p', 'detail-help', '目前不需要互相補付。')]));
  }

  const form = new TripForm(page, {
    prefix: 'expense', collection: 'expenses', createTitle: '新增支出', editTitle: '編輯支出', savedMessage: '支出已儲存，分帳金額已更新。',
    fill(record, snapshot) {
      byId('expense-name').value = record?.name || '';
      byId('expense-amount').value = record?.amount || '';
      byId('expense-category').value = record?.category || 'food';
      byId('expense-date').value = record?.date || snapshot.trip.startDate;
      byId('expense-note').value = record?.note || '';
      byId('expense-payer').replaceChildren(...snapshot.trip.members.map(member => {
        const option = node('option', '', member.name);
        option.value = member.userId;
        return option;
      }));
      byId('expense-payer').value = record?.payerId || (snapshot.trip.members.some(member => member.userId === api.user.id) ? api.user.id : snapshot.trip.members[0].userId);
      const selected = record?.participantIds || snapshot.trip.members.map(member => member.userId);
      byId('expense-participants').replaceChildren(...snapshot.trip.members.map(member => {
        const label = node('label');
        const checkbox = node('input');
        checkbox.type = 'checkbox';
        checkbox.name = 'expense-participant';
        checkbox.value = member.userId;
        checkbox.checked = selected.includes(member.userId);
        label.append(checkbox, node('span', '', member.name));
        return label;
      }));
    },
    read() {
      return { name: byId('expense-name').value.trim(), amount: Number(byId('expense-amount').value), category: byId('expense-category').value,
        date: byId('expense-date').value, payerId: byId('expense-payer').value,
        participantIds: Array.from(document.querySelectorAll('#expense-participants input:checked'), input => input.value).sort(), note: byId('expense-note').value.trim() };
    },
    validate(expense, snapshot) {
      if (!expense.name || Array.from(expense.name).length > 80) return '請輸入 1 至 80 個字的名稱';
      if (!Number.isInteger(expense.amount) || expense.amount < 1 || expense.amount > 1000000000) return '金額須為 1 至 1,000,000,000 的整數';
      if (!categories[expense.category]) return '請選擇有效類別';
      if (!validDate(expense.date, snapshot.trip)) return '支出日期須在行程起訖日期內';
      const ids = snapshot.trip.members.map(member => member.userId);
      if (!ids.includes(expense.payerId) || !expense.participantIds.length || expense.participantIds.some(id => !ids.includes(id))) return '請選擇有效付款人與至少一位分攤成員';
      if (Array.from(expense.note).length > 1000) return '備註最多 1000 個字';
      return '';
    },
    describe(expense) { return `最新支出：「${expense.name}」，${expense.date}，${money(expense.amount)}，${categories[expense.category]}，付款人 ${memberName(expense.payerId)}，分攤 ${expense.participantIds.map(memberName).join('、')}。備註：${expense.note || '無'}。`; },
    updateControls(snapshot) {
      if (!snapshot) return;
      byId('expense-date').min = snapshot.trip.startDate;
      byId('expense-date').max = snapshot.trip.endDate;
    },
  });
  const deletion = new TripDelete(page, 'expenses', 'expense');
  byId('expense-add-btn').addEventListener('click', () => form.open());

  byId('budget-input').addEventListener('input', () => { budget.dirty = true; });
  byId('budget-conflict-reviewed').addEventListener('change', () => page.updateControls());
  byId('budget-save-btn').addEventListener('click', async () => {
    if (page.busy || !page.canEdit || budget.conflict === false) return;
    if (budget.conflict !== null && !byId('budget-conflict-reviewed').checked) return;
    if (!byId('budget-input').reportValidity()) return;
    const amount = Number(byId('budget-input').value);
    if (!Number.isInteger(amount) || amount < 0 || amount > 1000000000) { feedback('budget-error', '預算須為 0 至 1,000,000,000 的整數'); return; }
    budget.dirty = true;
    await page.run(async () => {
      feedback('budget-error', '');
      try {
        const updated = await api.request(page.path, { method: 'PATCH', body: { budget: amount, version: budget.conflict === null ? budget.version : budget.conflict } });
        if (page.invalidated) return;
        budget.dirty = false;
        budget.version = updated.version;
        budget.conflict = null;
        byId('budget-conflict').hidden = true;
        byId('budget-input').value = updated.budget;
        // No client-side recalculation: retrieve the new authoritative summary.
        page.snapshot = null;
        byId('detail-content').hidden = true;
        try { await page.refresh(); page.message('預算已儲存，統計已更新。'); }
        catch (error) { page.savedButRefreshFailed('預算已儲存，但最新統計載入失敗。請重新載入核對。 ' + error.message); }
      } catch (failure) {
        if (page.invalidated) return;
        if (failure.status !== 409) { feedback('budget-error', failure.message); return; }
        byId('budget-conflict-reviewed').checked = false;
        try {
          await page.refresh();
          if (page.invalidated) return;
          budget.conflict = page.trip.version;
          byId('budget-conflict').hidden = false;
          byId('budget-conflict-latest').textContent = '最新預算：' + money(page.trip.budget) + '。你的輸入仍保留，請核對後再儲存。';
          feedback('budget-error', '行程已在其他頁面更新，尚未套用你的預算。');
        } catch (error) {
          if (page.invalidated) return;
          budget.conflict = false;
          feedback('budget-error', '最新資料載入失敗，你的預算仍保留。請重新載入最新資料，再核對後儲存。');
          byId('detail-error-text').textContent = '最新資料載入失敗，尚未儲存你的預算。請按「重新載入」核對最新資料。 ' + error.message;
          byId('detail-error').hidden = false;
        }
      }
    });
  });
  page.controls.push(() => {
    byId('budget-save-btn').disabled = page.busy || !page.canEdit || budget.conflict === false || (budget.conflict !== null && !byId('budget-conflict-reviewed').checked);
    byId('budget-save-btn').textContent = page.busy ? '連線中…' : '儲存預算';
  });
  page.clearHandlers.push(() => { budget.dirty = false; budget.version = null; budget.conflict = null; });
  page.load();
})();
