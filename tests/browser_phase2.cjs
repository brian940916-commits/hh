'use strict';

// Run against the isolated database prepared by run_acceptance.py. This suite
// exercises the actual PHP pages, cookie sessions and HTTP API through Chromium.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = (process.env.AGENTTT_BASE_URL || 'http://127.0.0.1:8090').replace(/\/$/, '');
const memberTripId = process.env.AGENTTT_PHASE2_MEMBER_TRIP_ID;
const apiPath = request => new URL(request.url()).searchParams.get('path')?.replace(/^\//, '');
const apiUrl = path => `${base}/api/index.php?path=${encodeURIComponent('/' + path.replace(/^\//, ''))}`;
const errorBody = (code, message) => JSON.stringify({ error: { code, message } });
const unique = prefix => `${prefix} ${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
const gate = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

async function enabled(page, id) {
  await page.waitForFunction(id => {
    const control = document.getElementById(id);
    return control && !control.disabled;
  }, id);
}

async function readyList(page) {
  await enabled(page, 'create-trip-btn');
  assert.equal(await page.locator('#list-error').isVisible(), false);
}

async function login(page, email = 'test@test.com') {
  const response = await page.goto(`${base}/login.php`);
  assert.equal(response.status(), 200);
  await enabled(page, 'login-submit-btn');
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill('test123');
  await page.locator('#login-submit-btn').click();
  await page.waitForURL(`${base}/trip-list.php`);
  await readyList(page);
}

async function mutation(page, method, path, click, status = 200) {
  const pending = page.waitForResponse(response => apiPath(response.request()) === path && response.request().method() === method);
  await click();
  const response = await pending;
  assert.equal(response.status(), status, await response.text());
  return response.status() === 204 ? null : (await response.json()).data;
}

async function createTrip(page, name = unique('第二階段'), budget = 3000) {
  await page.locator('#create-trip-btn').click();
  await page.locator('#new-trip-name').fill(name);
  await page.locator('#new-trip-start').fill('2099-01-02');
  await page.locator('#new-trip-end').fill('2099-01-04');
  await page.locator('#new-trip-budget').fill(String(budget));
  await page.locator('#modal-next-btn').click();
  await page.locator('#new-trip-station').selectOption('台中站');
  await page.locator('#modal-next-btn').click();
  await page.locator('#create-step-3').waitFor();
  const trip = await mutation(page, 'POST', 'trips', () => page.locator('#modal-next-btn').click(), 201);
  await page.locator('#create-modal').waitFor({ state: 'hidden' });
  await page.locator(`.trip-card[data-id="${trip.id}"]`).waitFor();
  return trip;
}

async function readyDetails(page) {
  await page.locator('#detail-content').waitFor();
  assert.equal(await page.locator('#detail-error').isVisible(), false);
}

async function openDetails(page, tripId, kind = 'items', fromList = false) {
  const filename = kind === 'items' ? 'trip-edit.php' : 'trip-expense.php';
  if (fromList) {
    await page.locator(`.trip-card[data-id="${tripId}"] [data-action="${kind === 'items' ? 'details' : 'expenses'}"]`).click();
    await page.waitForURL(url => url.pathname.endsWith('/' + filename) && url.searchParams.get('tripId') === tripId);
  } else {
    const response = await page.goto(`${base}/${filename}?tripId=${encodeURIComponent(tripId)}`);
    assert.equal(response.status(), 200);
  }
  await readyDetails(page);
}

async function details(context, tripId) {
  const response = await context.request.get(apiUrl(`trips/${tripId}/details`));
  assert.equal(response.status(), 200, await response.text());
  return (await response.json()).data;
}

async function fillItem(page, name, options = {}) {
  if (options.open !== false) await page.locator('#item-add-btn').click();
  await page.locator('#item-name').fill(name);
  await page.locator('#item-date').fill(options.date || '2099-01-02');
  await page.locator('#item-start').fill(options.start || '09:00');
  await page.locator('#item-end').fill(options.end || '10:00');
  await page.locator('#item-type').selectOption(options.type || 'attraction');
  await page.locator('#item-priority').selectOption(options.priority || 'must');
  await page.locator('#item-note').fill(options.note || '瀏覽器驗收備註');
}

async function addItem(page, tripId, name, options = {}) {
  await fillItem(page, name, options);
  const data = await mutation(page, 'POST', `trips/${tripId}/items`, () => page.locator('#item-save-btn').click(), 201);
  await page.locator('#item-modal').waitFor({ state: 'hidden' });
  const item = data.items.find(value => value.name === name);
  assert.ok(item, 'Created item appears in authoritative details');
  return item;
}

async function day(page, date = '2099-01-02') {
  await page.locator(`#day-tabs [data-date="${date}"]`).click();
}

const itemCard = (page, id) => page.locator(`.item-card[data-id="${id}"]`);
const expenseCard = (page, id) => page.locator(`.expense-card[data-id="${id}"]`);

async function fillExpense(page, name, amount, options = {}) {
  if (options.open !== false) await page.locator('#expense-add-btn').click();
  await page.locator('#expense-name').fill(name);
  await page.locator('#expense-amount').fill(String(amount));
  await page.locator('#expense-category').selectOption(options.category || 'food');
  await page.locator('#expense-date').fill(options.date || '2099-01-02');
  await page.locator('#expense-payer').selectOption(options.payer || 'u_guest_01');
  await page.locator('#expense-note').fill(options.note || '費用驗收備註');
  const selected = options.participants || ['u_guest_01'];
  for (const checkbox of await page.locator('#expense-participants input[name="expense-participant"]').all()) {
    if (selected.includes(await checkbox.getAttribute('value'))) await checkbox.check();
    else await checkbox.uncheck();
  }
}

async function addExpense(page, tripId, name, amount, options = {}) {
  await fillExpense(page, name, amount, options);
  const data = await mutation(page, 'POST', `trips/${tripId}/expenses`, () => page.locator('#expense-save-btn').click(), 201);
  await page.locator('#expense-modal').waitFor({ state: 'hidden' });
  const expense = data.expenses.find(value => value.name === name);
  assert.ok(expense, 'Created expense appears in authoritative details');
  return expense;
}

async function textAmount(page, id, amount) {
  await page.waitForFunction(({ id, amount }) => {
    const text = document.getElementById(id)?.textContent || '';
    const number = text.match(/-?\d[\d,]*/)?.[0];
    return number !== undefined && Number(number.replace(/,/g, '')) === amount;
  }, { id, amount });
}

function conflictReadFailureForRecord(kind) {
  return async (page, context) => {
    const prefix = kind === 'items' ? 'item' : 'expense';
    const card = kind === 'items' ? itemCard : expenseCard;
    await login(page);
    const trip = await createTrip(page);
    await openDetails(page, trip.id, kind);
    const record = kind === 'items'
      ? await addItem(page, trip.id, '衝突前的安排')
      : await addExpense(page, trip.id, '衝突前的支出', 200);
    const second = await context.newPage();
    await openDetails(second, trip.id, kind);
    await card(page, record.id).locator('[data-action="edit"]').click();
    if (kind === 'items') {
      await fillItem(page, '不能消失的安排草稿', { open: false, date: '2099-01-03', start: '13:15', end: '14:30', priority: 'optional', note: '讀取失敗時保留備註' });
    } else {
      await fillExpense(page, '不能消失的費用草稿', 1234, { open: false, date: '2099-01-03', category: 'activity', note: '讀取失敗時保留備註' });
    }
    await card(second, record.id).locator('[data-action="edit"]').click();
    await second.locator(`#${prefix}-name`).fill('其他分頁已儲存的最新資料');
    await mutation(second, 'PATCH', `trips/${trip.id}/${kind}/${record.id}`, () => second.locator(`#${prefix}-save-btn`).click());
    const latest = await details(context, trip.id);

    let writes = 0;
    let failedRead = false;
    const versions = [];
    const navigations = [];
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations.push(frame.url()); });
    await page.route('**/api/index.php?**', async route => {
      const path = apiPath(route.request());
      if (path === `trips/${trip.id}/${kind}/${record.id}` && route.request().method() === 'PATCH') {
        writes += 1;
        versions.push(route.request().postDataJSON().version);
      }
      if (writes && !failedRead && path === `trips/${trip.id}/details` && route.request().method() === 'GET') {
        failedRead = true;
        await route.fulfill({ status: 500, contentType: 'application/json', body: errorBody('server_error', '測試：衝突後讀取最新資料失敗。') });
      } else await route.continue();
    });
    await mutation(page, 'PATCH', `trips/${trip.id}/${kind}/${record.id}`, () => page.locator(`#${prefix}-save-btn`).click(), 409);
    await page.locator(`#${prefix}-conflict-retry-btn`).waitFor();
    assert.equal(await page.locator(`#${prefix}-modal`).isVisible(), true);
    assert.equal(await page.locator(`#${prefix}-name`).inputValue(), kind === 'items' ? '不能消失的安排草稿' : '不能消失的費用草稿');
    assert.equal(await page.locator(`#${prefix}-date`).inputValue(), '2099-01-03');
    assert.equal(await page.locator(`#${prefix}-note`).inputValue(), '讀取失敗時保留備註');
    assert.equal(await page.locator(`#${prefix}-save-btn`).isDisabled(), true);
    assert.equal(writes, 1);
    assert.equal((await details(context, trip.id))[kind].find(value => value.id === record.id).name, '其他分頁已儲存的最新資料');

    await page.locator(`#${prefix}-conflict-retry-btn`).click();
    await page.locator(`#${prefix}-conflict-latest`).waitFor();
    assert.ok((await page.locator(`#${prefix}-conflict-latest`).innerText()).includes('其他分頁已儲存的最新資料'));
    assert.equal(await page.locator(`#${prefix}-conflict-reviewed`).isChecked(), false);
    assert.equal(await page.locator(`#${prefix}-save-btn`).isDisabled(), true);
    assert.equal(await page.locator(`#${prefix}-date`).inputValue(), '2099-01-03');
    assert.equal(await page.locator(`#${prefix}-note`).inputValue(), '讀取失敗時保留備註');
    assert.equal(writes, 1, 'Retrieving conflict data must never automatically retry a write');
    assert.deepEqual(navigations, [], 'Recovering conflict data must preserve the open page and form');
    await page.locator(`#${prefix}-conflict-reviewed`).check();
    await enabled(page, `${prefix}-save-btn`);
    await mutation(page, 'PATCH', `trips/${trip.id}/${kind}/${record.id}`, () => page.locator(`#${prefix}-save-btn`).click());
    await page.locator(`#${prefix}-modal`).waitFor({ state: 'hidden' });
    assert.equal(writes, 2);
    assert.equal(versions[1], latest.trip.version, 'Reviewed retry must use the latest trip version');
    const saved = (await details(context, trip.id))[kind].find(value => value.id === record.id);
    assert.equal(saved.date, '2099-01-03');
    assert.equal(saved.note, '讀取失敗時保留備註');
    if (kind === 'items') {
      assert.equal(saved.name, '不能消失的安排草稿');
      assert.equal(saved.startTime, '13:15');
      assert.equal(saved.endTime, '14:30');
      assert.equal(saved.priority, 'optional');
    } else {
      assert.equal(saved.name, '不能消失的費用草稿');
      assert.equal(saved.amount, 1234);
      assert.equal(saved.category, 'activity');
    }
  };
}

async function withContext(browser, callback, options = {}) {
  const context = await browser.newContext(options);
  const exceptions = [];
  await context.addInitScript(() => {
    window.__unhandledRejections = [];
    window.addEventListener('unhandledrejection', event => window.__unhandledRejections.push(String(event.reason)));
  });
  context.on('page', page => page.on('pageerror', error => exceptions.push(error.message)));
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    await callback(page, context);
    for (const tab of context.pages()) {
      if (!tab.isClosed()) assert.deepEqual(await tab.evaluate(() => window.__unhandledRejections || []), [], 'Unhandled browser promise rejections');
    }
    assert.deepEqual(exceptions, [], 'Browser JavaScript exceptions');
  } finally { await context.close(); }
}

async function main() {
  assert.ok(memberTripId, 'AGENTTT_PHASE2_MEMBER_TRIP_ID must name the isolated member fixture; no cases may silently skip');
  const launch = { headless: true };
  if (process.env.CHROMIUM_EXECUTABLE) launch.executablePath = process.env.CHROMIUM_EXECUTABLE;
  const browser = await chromium.launch(launch);
  const cases = [
    ['List links reach PHP detail pages; item CRUD, daily order and day move persist after reload', async (page, context) => {
      await login(page);
      const trip = await createTrip(page);
      await openDetails(page, trip.id, 'items', true);
      const first = await addItem(page, trip.id, '第一個景點');
      const second = await addItem(page, trip.id, '第二個景點');
      await day(page);
      await mutation(page, 'PUT', `trips/${trip.id}/items/order`, () => itemCard(page, second.id).locator('[data-action="up"]').click());
      await page.waitForFunction(id => document.querySelector('.item-card')?.dataset.id === id, second.id);
      assert.deepEqual(await page.locator('.item-card').evaluateAll(cards => cards.map(card => card.dataset.id)), [second.id, first.id]);
      await itemCard(page, first.id).locator('[data-action="edit"]').click();
      await fillItem(page, '移至隔天的景點', { open: false, date: '2099-01-03', start: '13:20', end: '14:40', priority: 'optional', note: '修改後備註' });
      await mutation(page, 'PATCH', `trips/${trip.id}/items/${first.id}`, () => page.locator('#item-save-btn').click());
      await page.locator('#item-modal').waitFor({ state: 'hidden' });
      await day(page, '2099-01-03');
      await itemCard(page, first.id).waitFor();
      assert.ok((await itemCard(page, first.id).innerText()).includes('移至隔天的景點'));
      await page.evaluate(() => { localStorage.clear(); localStorage.setItem('agenttt_trips', '[]'); });
      await page.reload();
      await readyDetails(page);
      await day(page, '2099-01-03');
      await itemCard(page, first.id).waitFor();
      const snapshot = await details(context, trip.id);
      const stored = snapshot.items.find(item => item.id === first.id);
      assert.equal(stored.date, '2099-01-03');
      assert.equal(stored.startTime, '13:20');
      assert.equal(stored.endTime, '14:40');
      assert.equal(stored.note, '修改後備註');
      assert.equal(stored.priority, 'optional');
      await itemCard(page, first.id).locator('[data-action="delete"]').click();
      await mutation(page, 'DELETE', `trips/${trip.id}/items/${first.id}`, () => page.locator('#item-delete-confirm-btn').click());
      await itemCard(page, first.id).waitFor({ state: 'detached' });
      await page.reload();
      await readyDetails(page);
      await day(page, '2099-01-03');
      assert.equal(await itemCard(page, first.id).count(), 0);
      await page.goto(`${base}/trip-list.php`);
      await readyList(page);
      await openDetails(page, trip.id, 'expenses', true);
      assert.ok((await page.locator('#detail-title').innerText()).includes(trip.name));
    }],
    ['Expense CRUD, budget and category totals refresh immediately and survive reload', async (page, context) => {
      await login(page);
      const trip = await createTrip(page, unique('費用 CRUD'), 2000);
      await openDetails(page, trip.id, 'expenses', true);
      const food = await addExpense(page, trip.id, '午餐', 1250);
      const transport = await addExpense(page, trip.id, '車資', 250, { category: 'transport' });
      await textAmount(page, 'summary-spent', 1500);
      await textAmount(page, 'summary-remaining', 500);
      assert.ok((await page.locator('#category-summary').innerText()).includes('1,250'));
      await expenseCard(page, food.id).locator('[data-action="edit"]').click();
      await fillExpense(page, '晚餐', 1500, { open: false, note: '已編輯' });
      await mutation(page, 'PATCH', `trips/${trip.id}/expenses/${food.id}`, () => page.locator('#expense-save-btn').click());
      await page.locator('#expense-modal').waitFor({ state: 'hidden' });
      await page.locator('#budget-input').fill('1500');
      await mutation(page, 'PATCH', `trips/${trip.id}`, () => page.locator('#budget-save-btn').click());
      await textAmount(page, 'summary-spent', 1750);
      await textAmount(page, 'summary-over-budget', 250);
      await page.reload();
      await readyDetails(page);
      assert.equal(await page.locator('#budget-input').inputValue(), '1500');
      assert.ok((await expenseCard(page, food.id).innerText()).includes('晚餐'));
      const snapshot = await details(context, trip.id);
      assert.equal(snapshot.summary.totalSpent, 1750);
      assert.equal(snapshot.summary.remaining, -250);
      assert.equal(snapshot.summary.overBudget, true);
      await expenseCard(page, transport.id).locator('[data-action="delete"]').click();
      await mutation(page, 'DELETE', `trips/${trip.id}/expenses/${transport.id}`, () => page.locator('#expense-delete-confirm-btn').click());
      await expenseCard(page, transport.id).waitFor({ state: 'detached' });
      await textAmount(page, 'summary-spent', 1500);
      await page.reload();
      await readyDetails(page);
      assert.equal(await expenseCard(page, transport.id).count(), 0);
      assert.equal((await details(context, trip.id)).summary.totalSpent, 1500);
    }],
    ['Odd-dollar shared expense displays exact balances and settlement without creating duplicate debt', async (page, context) => {
      await login(page);
      await openDetails(page, memberTripId, 'expenses');
      const previous = await details(context, memberTripId);
      const shared = await addExpense(page, memberTripId, unique('兩人平分'), 2501, { participants: ['u_guest_01', 'u_guest_02'] });
      const snapshot = await details(context, memberTripId);
      assert.equal(snapshot.summary.totalSpent, previous.summary.totalSpent + 2501);
      const beforeOwner = previous.summary.balances.find(row => row.userId === 'u_guest_01');
      const beforeMember = previous.summary.balances.find(row => row.userId === 'u_guest_02');
      const owner = snapshot.summary.balances.find(row => row.userId === 'u_guest_01');
      const member = snapshot.summary.balances.find(row => row.userId === 'u_guest_02');
      assert.equal(owner.share, beforeOwner.share + 1251);
      assert.equal(member.share, beforeMember.share + 1250);
      assert.equal(owner.balance, beforeOwner.balance + 1250);
      assert.equal(member.balance, beforeMember.balance - 1250);
      assert.equal(snapshot.summary.settlements.length, 1);
      assert.equal(snapshot.summary.settlements[0].amount, owner.balance);
      await textAmount(page, 'summary-spent', snapshot.summary.totalSpent);
      assert.ok((await page.locator('#balances-list').innerText()).includes(owner.share.toLocaleString('zh-TW')));
      assert.ok((await page.locator('#settlements-list').innerText()).includes(owner.balance.toLocaleString('zh-TW')));
      await page.reload();
      await readyDetails(page);
      assert.ok((await page.locator('#settlements-list').innerText()).includes(owner.balance.toLocaleString('zh-TW')));
      await expenseCard(page, shared.id).locator('[data-action="delete"]').click();
      await mutation(page, 'DELETE', `trips/${memberTripId}/expenses/${shared.id}`, () => page.locator('#expense-delete-confirm-btn').click());
      await expenseCard(page, shared.id).waitFor({ state: 'detached' });
      assert.equal((await details(context, memberTripId)).summary.totalSpent, previous.summary.totalSpent);
    }],
    ['Delayed detail loading disables mutation; a detail 500 offers a working retry', async page => {
      await login(page);
      const trip = await createTrip(page);
      const requested = gate();
      const release = gate();
      let first = true;
      await page.route('**/api/index.php?**', async route => {
        if (apiPath(route.request()) === `trips/${trip.id}/details` && first) {
          first = false;
          requested.resolve();
          await release.promise;
          await route.fulfill({ status: 500, contentType: 'application/json', body: errorBody('server_error', '測試：資料暫時無法讀取。') });
        } else await route.continue();
      });
      await page.goto(`${base}/trip-edit.php?tripId=${trip.id}`, { waitUntil: 'domcontentloaded' });
      await requested.promise;
      try {
        assert.equal(await page.locator('#detail-loading').isVisible(), true);
        assert.equal(await page.locator('#detail-content').isVisible(), false);
        assert.equal(await page.locator('#item-add-btn').isDisabled(), true);
      } finally { release.resolve(); }
      await page.locator('#detail-error').waitFor();
      await page.locator('#detail-retry-btn').click();
      await readyDetails(page);
      await enabled(page, 'item-add-btn');
    }],
    ['Item 500 preserves all form values and request key, then a retry saves exactly once', async (page, context) => {
      await login(page);
      const trip = await createTrip(page);
      await openDetails(page, trip.id);
      let first = true;
      const requested = gate();
      const release = gate();
      const keys = [];
      await page.route('**/api/index.php?**', async route => {
        if (apiPath(route.request()) === `trips/${trip.id}/items` && route.request().method() === 'POST') {
          keys.push(route.request().headers()['idempotency-key']);
          if (first) {
            first = false;
            requested.resolve();
            await release.promise;
            await route.fulfill({ status: 500, contentType: 'application/json', body: errorBody('server_error', '測試：保留表單後重試。') });
            return;
          }
        }
        await route.continue();
      });
      const name = unique('失敗保留景點');
      await fillItem(page, name, { date: '2099-01-03', start: '11:15', end: '12:30', priority: 'optional', note: '不可消失' });
      await page.locator('#item-save-btn').click();
      await requested.promise;
      try { assert.equal(await page.locator('#item-save-btn').isDisabled(), true); }
      finally { release.resolve(); }
      await page.locator('#item-error').waitFor();
      await enabled(page, 'item-save-btn');
      assert.equal(await page.locator('#item-name').inputValue(), name);
      assert.equal(await page.locator('#item-date').inputValue(), '2099-01-03');
      assert.equal(await page.locator('#item-start').inputValue(), '11:15');
      assert.equal(await page.locator('#item-note').inputValue(), '不可消失');
      assert.equal(await page.locator('#item-priority').inputValue(), 'optional');
      await mutation(page, 'POST', `trips/${trip.id}/items`, () => page.locator('#item-save-btn').click(), 201);
      await page.locator('#item-modal').waitFor({ state: 'hidden' });
      assert.equal(keys.length, 2);
      assert.ok(keys[0]);
      assert.equal(keys[1], keys[0]);
      assert.equal((await details(context, trip.id)).items.filter(item => item.name === name).length, 1);
    }],
    ['Committed expense with a lost response retries with the same key and creates one expense', async (page, context) => {
      await login(page);
      const trip = await createTrip(page);
      await openDetails(page, trip.id, 'expenses');
      let first = true;
      const keys = [];
      let committedId;
      await page.route('**/api/index.php?**', async route => {
        if (apiPath(route.request()) === `trips/${trip.id}/expenses` && route.request().method() === 'POST') {
          keys.push(route.request().headers()['idempotency-key']);
          if (first) {
            first = false;
            const response = await route.fetch();
            assert.equal(response.status(), 201);
            committedId = (await response.json()).data.expenses[0].id;
            await route.abort('failed');
            return;
          }
        }
        await route.continue();
      });
      const name = unique('回應遺失費用');
      await fillExpense(page, name, 777, { category: 'activity', note: '保留費用內容' });
      await page.locator('#expense-save-btn').click();
      await page.locator('#expense-error').waitFor();
      await enabled(page, 'expense-save-btn');
      assert.equal(await page.locator('#expense-name').inputValue(), name);
      assert.equal(await page.locator('#expense-amount').inputValue(), '777');
      assert.equal(await page.locator('#expense-note').inputValue(), '保留費用內容');
      const second = await context.newPage();
      await openDetails(second, trip.id, 'expenses');
      const later = await addExpense(second, trip.id, '另一分頁在重試前新增', 123);
      await mutation(page, 'POST', `trips/${trip.id}/expenses`, () => page.locator('#expense-save-btn').click(), 201);
      await page.locator('#expense-modal').waitFor({ state: 'hidden' });
      assert.equal(keys.length, 2);
      assert.ok(keys[0]);
      assert.equal(keys[1], keys[0]);
      assert.equal((await details(context, trip.id)).expenses.filter(expense => expense.name === name).length, 1);
      await expenseCard(page, committedId).waitFor();
      await expenseCard(page, later.id).waitFor();
      await textAmount(page, 'summary-spent', 900);
    }],
    ['A confirmed POST followed by a failed refresh reports saved data and retries only the read', async (page, context) => {
      await login(page);
      const trip = await createTrip(page);
      await openDetails(page, trip.id, 'expenses');
      let posts = 0;
      let failedRefresh = false;
      await page.route('**/api/index.php?**', async route => {
        const path = apiPath(route.request());
        if (path === `trips/${trip.id}/expenses` && route.request().method() === 'POST') posts += 1;
        if (posts && !failedRefresh && path === `trips/${trip.id}/details` && route.request().method() === 'GET') {
          failedRefresh = true;
          await route.fulfill({ status: 500, contentType: 'application/json', body: errorBody('server_error', '測試：儲存成功，但新列表暫時無法讀取。') });
        } else await route.continue();
      });
      const name = unique('已儲存但讀取失敗');
      await fillExpense(page, name, 666);
      await mutation(page, 'POST', `trips/${trip.id}/expenses`, () => page.locator('#expense-save-btn').click(), 201);
      await page.locator('#expense-modal').waitFor({ state: 'hidden' });
      await page.locator('#detail-error').waitFor();
      assert.ok((await page.locator('#detail-error').innerText()).includes('已儲存'));
      assert.equal(await page.locator('#detail-content').isVisible(), false);
      assert.equal(await page.locator('#expense-add-btn').isDisabled(), true);
      assert.equal(posts, 1);
      const snapshot = await details(context, trip.id);
      assert.equal(snapshot.expenses.filter(expense => expense.name === name).length, 1);
      await page.locator('#detail-retry-btn').click();
      await readyDetails(page);
      await expenseCard(page, snapshot.expenses[0].id).waitFor();
      await textAmount(page, 'summary-spent', 666);
      assert.equal(posts, 1, 'A confirmed save needs a GET retry, never another POST');
    }],
    ['Two tabs editing the same item require review before retrying a 409', async (page, context) => {
      await login(page);
      const trip = await createTrip(page);
      await openDetails(page, trip.id);
      const item = await addItem(page, trip.id, '原始景點');
      const second = await context.newPage();
      await openDetails(second, trip.id);
      await itemCard(page, item.id).locator('[data-action="edit"]').click();
      await itemCard(second, item.id).locator('[data-action="edit"]').click();
      await page.locator('#item-name').fill('分頁 A 已儲存');
      await second.locator('#item-name').fill('分頁 B 保留草稿');
      await mutation(page, 'PATCH', `trips/${trip.id}/items/${item.id}`, () => page.locator('#item-save-btn').click());
      await mutation(second, 'PATCH', `trips/${trip.id}/items/${item.id}`, () => second.locator('#item-save-btn').click(), 409);
      await second.locator('#item-conflict-latest').waitFor();
      assert.equal(await second.locator('#item-name').inputValue(), '分頁 B 保留草稿');
      assert.ok((await second.locator('#item-conflict-latest').innerText()).includes('分頁 A 已儲存'));
      assert.equal(await second.locator('#item-save-btn').isDisabled(), true);
      assert.equal((await details(context, trip.id)).items[0].name, '分頁 A 已儲存');
      await second.locator('#item-conflict-reviewed').check();
      await enabled(second, 'item-save-btn');
      await mutation(second, 'PATCH', `trips/${trip.id}/items/${item.id}`, () => second.locator('#item-save-btn').click());
      await page.reload();
      await readyDetails(page);
      assert.equal(await itemCard(page, item.id).locator('.item-name').innerText(), '分頁 B 保留草稿');
    }],
    ['Cross-page mutations invalidate a stale budget; review retains the proposed amount and unrelated item', async (page, context) => {
      await login(page);
      const trip = await createTrip(page);
      await openDetails(page, trip.id, 'expenses');
      const second = await context.newPage();
      await openDetails(second, trip.id);
      await page.locator('#budget-input').fill('4321');
      await addItem(second, trip.id, '另一分頁新增的景點');
      await mutation(page, 'PATCH', `trips/${trip.id}`, () => page.locator('#budget-save-btn').click(), 409);
      await page.locator('#budget-conflict-latest').waitFor();
      assert.equal(await page.locator('#budget-input').inputValue(), '4321');
      assert.equal(await page.locator('#budget-save-btn').isDisabled(), true);
      assert.equal((await details(context, trip.id)).trip.budget, 3000);
      await page.locator('#budget-conflict-reviewed').check();
      await enabled(page, 'budget-save-btn');
      await mutation(page, 'PATCH', `trips/${trip.id}`, () => page.locator('#budget-save-btn').click());
      const snapshot = await details(context, trip.id);
      assert.equal(snapshot.trip.budget, 4321);
      assert.equal(snapshot.items.length, 1);
      assert.equal(snapshot.items[0].name, '另一分頁新增的景點');
    }],
    ['Budget conflict followed by a failed latest read preserves the amount and recovers without a reload or write retry', async (page, context) => {
      await login(page);
      const trip = await createTrip(page);
      await openDetails(page, trip.id, 'expenses');
      const second = await context.newPage();
      await openDetails(second, trip.id);
      await page.locator('#budget-input').fill('5678');
      await addItem(second, trip.id, '衝突恢復後仍需保留的安排');
      const latest = await details(context, trip.id);
      let writes = 0;
      let failedRead = false;
      const versions = [];
      const navigations = [];
      page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations.push(frame.url()); });
      await page.route('**/api/index.php?**', async route => {
        const path = apiPath(route.request());
        if (path === `trips/${trip.id}` && route.request().method() === 'PATCH') {
          writes += 1;
          versions.push(route.request().postDataJSON().version);
        }
        if (writes && !failedRead && path === `trips/${trip.id}/details` && route.request().method() === 'GET') {
          failedRead = true;
          await route.fulfill({ status: 500, contentType: 'application/json', body: errorBody('server_error', '測試：衝突後讀取最新預算失敗。') });
        } else await route.continue();
      });
      await mutation(page, 'PATCH', `trips/${trip.id}`, () => page.locator('#budget-save-btn').click(), 409);
      await page.locator('#detail-error').waitFor();
      assert.equal(await page.locator('#budget-input').inputValue(), '5678');
      assert.equal(await page.locator('#budget-save-btn').isDisabled(), true);
      assert.equal(writes, 1);
      assert.equal((await details(context, trip.id)).trip.budget, 3000);
      await page.locator('#detail-retry-btn').click();
      await page.locator('#budget-conflict-latest').waitFor();
      assert.equal(await page.locator('#budget-input').inputValue(), '5678');
      assert.equal(await page.locator('#budget-conflict-reviewed').isChecked(), false);
      assert.equal(await page.locator('#budget-save-btn').isDisabled(), true);
      assert.equal(writes, 1, 'Retrying the latest data must never automatically save the draft budget');
      assert.deepEqual(navigations, [], 'The budget draft recovers without a page reload');
      await page.locator('#budget-conflict-reviewed').check();
      await enabled(page, 'budget-save-btn');
      await mutation(page, 'PATCH', `trips/${trip.id}`, () => page.locator('#budget-save-btn').click());
      await textAmount(page, 'summary-budget', 5678);
      assert.equal(writes, 2);
      assert.equal(versions[1], latest.trip.version);
      const snapshot = await details(context, trip.id);
      assert.equal(snapshot.trip.budget, 5678);
      assert.equal(snapshot.items[0].name, '衝突恢復後仍需保留的安排');
    }],
    ['Item conflict followed by a failed latest read preserves every field until explicit review and retry', conflictReadFailureForRecord('items')],
    ['Expense conflict followed by a failed latest read preserves every field until explicit review and retry', conflictReadFailureForRecord('expenses')],
    ['Reordering stale daily items requires an explicit conflict review', async (page, context) => {
      await login(page);
      const trip = await createTrip(page);
      await openDetails(page, trip.id);
      const first = await addItem(page, trip.id, '排序 A');
      const secondItem = await addItem(page, trip.id, '排序 B');
      const second = await context.newPage();
      await openDetails(second, trip.id);
      await addItem(page, trip.id, '排序 C');
      await mutation(second, 'PUT', `trips/${trip.id}/items/order`, () => itemCard(second, secondItem.id).locator('[data-action="up"]').click(), 409);
      await second.locator('#order-conflict-modal').waitFor();
      assert.equal(await second.locator('#order-conflict-confirm-btn').isDisabled(), true);
      assert.equal((await details(context, trip.id)).items[0].id, first.id);
      await second.locator('#order-conflict-reviewed').check();
      await enabled(second, 'order-conflict-confirm-btn');
      await mutation(second, 'PUT', `trips/${trip.id}/items/order`, () => second.locator('#order-conflict-confirm-btn').click());
      await second.locator('#order-conflict-modal').waitFor({ state: 'hidden' });
      const snapshot = await details(context, trip.id);
      assert.equal(snapshot.items.length, 3, 'Reviewing stale order must retain newly added items');
      assert.equal(snapshot.items[0].id, secondItem.id);
      assert.equal(snapshot.items[1].id, first.id);
    }],
    ['Member sees persisted items and expenses but cannot access enabled write controls', async (page, context) => {
      await login(page);
      await openDetails(page, memberTripId, 'expenses');
      const expense = await addExpense(page, memberTripId, unique('成員可讀費用'), 321);
      const expectedTotal = (await details(context, memberTripId)).summary.totalSpent;
      await page.locator('#logout-btn').click();
      await page.waitForURL(`${base}/login.php`);
      await login(page, 'other@test.com');
      await openDetails(page, memberTripId);
      assert.ok((await page.locator('#permission-note').innerText()).includes('只有行程建立者可修改'));
      assert.equal(await page.locator('#item-add-btn').isDisabled(), true);
      assert.ok(await page.locator('.item-card').count() > 0, 'Member can read the isolated fixture item');
      assert.equal(await page.locator('.item-card [data-action="edit"]:enabled, .item-card [data-action="delete"]:enabled, .item-card [data-action="up"]:enabled, .item-card [data-action="down"]:enabled').count(), 0);
      await openDetails(page, memberTripId, 'expenses');
      assert.equal(await page.locator('#expense-add-btn').isDisabled(), true);
      assert.equal(await page.locator('#budget-save-btn').isDisabled(), true);
      assert.equal(await page.locator('#budget-input').isDisabled(), true);
      assert.equal(await page.locator('.expense-card [data-action="edit"]:enabled, .expense-card [data-action="delete"]:enabled').count(), 0);
      await expenseCard(page, expense.id).waitFor();
      await textAmount(page, 'summary-spent', expectedTotal);
      assert.equal(await page.evaluate(() => AgentAPI.user.id), 'u_guest_02');
    }],
    ['A real logout in another tab makes a detail write return to login and removes private content', async (page, context) => {
      await login(page);
      const trip = await createTrip(page);
      await openDetails(page, trip.id);
      await fillItem(page, '不得在登出後儲存');
      const second = await context.newPage();
      await second.goto(`${base}/trip-list.php`);
      await readyList(second);
      await second.locator('#logout-btn').click();
      await second.waitForURL(`${base}/login.php`);
      await page.locator('#item-save-btn').click();
      await page.waitForURL(`${base}/login.php`);
      await enabled(page, 'login-submit-btn');
      assert.equal(await page.locator('#detail-content').count(), 0);
      assert.equal(await page.locator('.item-card').count(), 0);
      assert.equal(await page.evaluate(() => AgentAPI.user), null);
    }],
    ['Changing accounts during detail retry clears the old snapshot before reloading the actual session', async (page, context) => {
      await login(page);
      let first = true;
      await page.route('**/api/index.php?**', async route => {
        if (apiPath(route.request()) === `trips/${memberTripId}/details` && first) {
          first = false;
          await route.fulfill({ status: 500, contentType: 'application/json', body: errorBody('server_error', '測試：重新載入行程。') });
        } else await route.continue();
      });
      await page.goto(`${base}/trip-expense.php?tripId=${memberTripId}`);
      await page.locator('#detail-error').waitFor();
      assert.equal(await page.evaluate(() => AgentAPI.user.id), 'u_guest_01');
      const second = await context.newPage();
      await second.goto(`${base}/trip-list.php`);
      await readyList(second);
      await second.locator('#logout-btn').click();
      await second.waitForURL(`${base}/login.php`);
      await login(second, 'other@test.com');
      const invalid = [];
      const navigations = [];
      page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations.push(frame.url()); });
      await page.exposeFunction('__recordInvalidPhase2Identity', value => invalid.push(value));
      await page.evaluate(() => {
        const observer = new MutationObserver(() => {
          const content = document.getElementById('detail-content');
          if (content && !content.hidden && content.getClientRects().length && window.AgentAPI?.user?.id === 'u_guest_01') {
            window.__recordInvalidPhase2Identity(content.textContent);
          }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      });
      await page.locator('#detail-retry-btn').click();
      await page.waitForURL(`${base}/trip-list.php`);
      await readyList(page);
      assert.ok(navigations.some(url => url.endsWith('/login.php')));
      assert.equal(await page.evaluate(() => AgentAPI.user.id), 'u_guest_02');
      assert.deepEqual(invalid, [], 'New actor detail data must not render under the previous identity');
      assert.equal(await page.locator('#detail-content').count(), 0);
    }],
    ['Item and expense names and notes render as literal text without executing HTML', async page => {
      await login(page);
      const trip = await createTrip(page);
      const dialogs = [];
      page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
      const name = '<img src=x onerror=alert(99)>';
      const note = '<svg onload=alert(98)>文字</svg>';
      await openDetails(page, trip.id);
      const item = await addItem(page, trip.id, name, { note });
      await day(page);
      assert.equal(await itemCard(page, item.id).locator('.item-name').innerText(), name);
      assert.equal(await itemCard(page, item.id).locator('.item-note').innerText(), note);
      assert.equal(await itemCard(page, item.id).locator('img,svg').count(), 0);
      await openDetails(page, trip.id, 'expenses');
      const expense = await addExpense(page, trip.id, name, 123, { note });
      assert.equal(await expenseCard(page, expense.id).locator('.expense-name').innerText(), name);
      assert.equal(await expenseCard(page, expense.id).locator('.expense-note').innerText(), note);
      assert.equal(await expenseCard(page, expense.id).locator('img,svg').count(), 0);
      assert.deepEqual(dialogs, []);
    }],
    ['390px mobile pages, detail cards and open forms do not overflow horizontally', async page => {
      await page.setViewportSize({ width: 390, height: 844 });
      const check = async label => {
        const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, body: document.body.scrollWidth, document: document.documentElement.scrollWidth }));
        assert.ok(widths.body <= widths.viewport + 1 && widths.document <= widths.viewport + 1, `${label}: ${JSON.stringify(widths)}`);
      };
      await login(page);
      const trip = await createTrip(page);
      await check('trip list');
      await openDetails(page, trip.id);
      await addItem(page, trip.id, '很長的行程項目名稱與備註內容測試'.repeat(3), { note: 'a'.repeat(500) });
      await day(page);
      await check('item cards');
      await page.locator('#item-add-btn').click();
      await check('item form');
      await openDetails(page, trip.id, 'expenses');
      await addExpense(page, trip.id, '很長的費用名稱與備註'.repeat(4), 222, { note: 'b'.repeat(500) });
      await check('expense cards and summary');
      await page.locator('#expense-add-btn').click();
      await check('expense form');
    }],
  ];
  let failed = 0;
  try {
    for (const [name, test] of cases) {
      try {
        await withContext(browser, test);
        console.log(`PASS: ${name}`);
      } catch (error) {
        failed += 1;
        console.error(`FAIL: ${name}\n${error.stack || error}`);
      }
    }
  } finally { await browser.close(); }
  console.log(`Phase 2 browser acceptance: ${cases.length - failed}/${cases.length} passed`);
  if (failed) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
