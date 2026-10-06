'use strict';

// Meaningful UI acceptance against an isolated PHP/SQLite application. Each case
// owns its browser contexts and creates fresh trips; no live database is used.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = (process.env.AGENTTT_BASE_URL || 'http://127.0.0.1:8090').replace(/\/$/, '');
const password = 'Practicepass123!';
const unique = prefix => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
const email = () => `${unique('browser')}@example.com`;
const apiPath = request => new URL(request.url()).searchParams.get('path')?.replace(/^\//, '');
const apiUrl = path => `${base}/api/index.php?path=${encodeURIComponent('/' + path.replace(/^\//, ''))}`;
const errorBody = (code, message) => JSON.stringify({ error: { code, message } });
const gate = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const ownerCard = (page, id) => page.locator(`.trip-invitation-card[data-id="${id}"]`);
const inboxCard = (page, id) => page.locator(`.invitation-card[data-id="${id}"]`);
const memberCard = (page, id) => page.locator(`.member-card[data-user-id="${id}"]`);

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
async function login(page, account = { email: 'test@test.com', password: 'test123' }) {
  const response = await page.goto(`${base}/login.php`);
  assert.equal(response.status(), 200);
  await enabled(page, 'login-submit-btn');
  await page.locator('#login-email').fill(account.email);
  await page.locator('#login-password').fill(account.password);
  await page.locator('#login-submit-btn').click();
  await page.waitForURL(`${base}/trip-list.php`);
  await readyList(page);
  return page.evaluate(() => AgentAPI.user);
}
async function logout(page) {
  await page.locator('#logout-btn').click();
  await page.waitForURL(`${base}/login.php`);
  await enabled(page, 'login-submit-btn');
}
async function registerForm(page, account) {
  await page.goto(`${base}/register.php`);
  await enabled(page, 'register-submit-btn');
  await page.locator('#register-name').fill(account.name);
  await page.locator('#register-email').fill(account.email);
  await page.locator('#register-password').fill(account.password);
  await page.locator('#register-confirm').fill(account.password);
}
async function registrationSuccess(page, account) {
  await page.locator('#register-success').waitFor();
  assert.equal(await page.locator('#register-success-email').innerText(), account.email.toLowerCase());
  assert.equal(await page.locator('#register-password').inputValue(), '');
  assert.equal(await page.locator('#register-confirm').inputValue(), '');
  assert.equal(await page.evaluate(() => AgentAPI.user), null);
  const link = await page.locator('#register-login-link').getAttribute('href');
  assert.equal(new URL(link, base).searchParams.get('email'), account.email.toLowerCase());
  assert.equal(new URL(link, base).searchParams.has('password'), false);
  assert.equal(link.includes(account.password), false);
}
async function register(page, name = '瀏覽器新旅客') {
  const account = { name, email: email(), password };
  await registerForm(page, account);
  await mutation(page, 'POST', 'register', () => page.locator('#register-submit-btn').click(), 201);
  await registrationSuccess(page, account);
  return account;
}
async function mutation(page, method, path, click, status = 200) {
  const pending = page.waitForResponse(response => apiPath(response.request()) === path && response.request().method() === method);
  await click();
  const response = await pending;
  assert.equal(response.status(), status, await response.text());
  return response.status() === 204 ? null : (await response.json()).data;
}
async function createTrip(page, name = unique('成員行程')) {
  await page.locator('#create-trip-btn').click();
  await page.locator('#new-trip-name').fill(name);
  await page.locator('#new-trip-start').fill('2099-01-02');
  await page.locator('#new-trip-end').fill('2099-01-04');
  await page.locator('#new-trip-budget').fill('3000');
  await page.locator('#modal-next-btn').click();
  await page.locator('#new-trip-station').selectOption('台中站');
  await page.locator('#modal-next-btn').click();
  await page.locator('#create-step-3').waitFor();
  const trip = await mutation(page, 'POST', 'trips', () => page.locator('#modal-next-btn').click(), 201);
  await page.locator('#create-modal').waitFor({ state: 'hidden' });
  await page.locator(`.trip-card[data-id="${trip.id}"]`).waitFor();
  return trip;
}
async function detail(page, tripId, file = 'trip-collab.php') {
  const response = await page.goto(`${base}/${file}?tripId=${encodeURIComponent(tripId)}`);
  assert.equal(response.status(), 200);
  await page.locator('#detail-content').waitFor();
  assert.equal(await page.locator('#detail-error').isVisible(), false);
}
async function details(context, tripId) {
  const response = await context.request.get(apiUrl(`trips/${tripId}/details`));
  assert.equal(response.status(), 200, await response.text());
  return (await response.json()).data;
}
async function invite(page, tripId, recipientEmail = 'other@test.com') {
  await page.locator('#invite-email').fill(recipientEmail);
  const snapshot = await mutation(page, 'POST', `trips/${tripId}/invitations`, () => page.locator('#invite-save-btn').click(), 201);
  const invitation = snapshot.invitations.find(value => value.recipient.email === recipientEmail.toLowerCase());
  assert.ok(invitation);
  await ownerCard(page, invitation.id).waitFor();
  await enabled(page, 'invite-save-btn');
  return invitation;
}
async function readyInbox(page) {
  await page.waitForFunction(() => {
    const loading = document.getElementById('invitations-loading');
    const error = document.getElementById('invitations-error');
    return loading?.hidden && error?.hidden;
  });
  assert.equal(await page.locator('#invitations-error').isVisible(), false);
}
async function inbox(page) {
  const response = await page.goto(`${base}/invitations.php`);
  assert.equal(response.status(), 200);
  await readyInbox(page);
}
async function state(page, id, status) {
  await page.locator(`.invitation-card[data-id="${id}"][data-status="${status}"]`).waitFor();
}
async function respond(page, id, kind = 'accept') {
  await inboxCard(page, id).locator(`[data-action="${kind}"]`).click();
  await mutation(page, 'POST', `invitations/${id}/${kind}`, () => page.locator('#invitation-action-confirm-btn').click());
  await page.locator('#invitation-action-modal').waitFor({ state: 'hidden' });
  await state(page, id, kind === 'accept' ? 'accepted' : 'declined');
}
async function remove(page, tripId, memberId, status = 200) {
  await memberCard(page, memberId).locator('[data-action="remove"]').click();
  const result = await mutation(page, 'DELETE', `trips/${tripId}/members/${memberId}`, () => page.locator('#membership-delete-confirm-btn').click(), status);
  if (status === 200) await page.locator('#membership-delete-modal').waitFor({ state: 'hidden' });
  return result;
}
async function cancel(page, tripId, inviteId) {
  await ownerCard(page, inviteId).locator('[data-action="cancel"]').click();
  await mutation(page, 'DELETE', `trips/${tripId}/invitations/${inviteId}`, () => page.locator('#membership-delete-confirm-btn').click());
  await page.locator('#membership-delete-modal').waitFor({ state: 'hidden' });
  await ownerCard(page, inviteId).locator('.membership-status.revoked').waitFor();
}
async function addItem(page, tripId, name = '成員可看的景點') {
  await page.locator('#item-add-btn').click();
  await page.locator('#item-name').fill(name);
  await page.locator('#item-date').fill('2099-01-02');
  await page.locator('#item-start').fill('09:00');
  await page.locator('#item-end').fill('10:00');
  const snapshot = await mutation(page, 'POST', `trips/${tripId}/items`, () => page.locator('#item-save-btn').click(), 201);
  await page.locator('#item-modal').waitFor({ state: 'hidden' });
  return snapshot.items.find(value => value.name === name);
}
async function addExpense(page, tripId, participants, amount = 101) {
  await page.locator('#expense-add-btn').click();
  await page.locator('#expense-name').fill('成員分攤支出');
  await page.locator('#expense-amount').fill(String(amount));
  await page.locator('#expense-category').selectOption('food');
  await page.locator('#expense-date').fill('2099-01-02');
  for (const checkbox of await page.locator('#expense-participants input').all()) {
    if (participants.includes(await checkbox.getAttribute('value'))) await checkbox.check();
    else await checkbox.uncheck();
  }
  const snapshot = await mutation(page, 'POST', `trips/${tripId}/expenses`, () => page.locator('#expense-save-btn').click(), 201);
  await page.locator('#expense-modal').waitFor({ state: 'hidden' });
  return snapshot.expenses.find(value => value.name === '成員分攤支出');
}
async function setup(page, newContext, options = {}) {
  const owner = await login(page);
  const trip = await createTrip(page, options.name);
  await detail(page, trip.id);
  const invitation = await invite(page, trip.id);
  const recipient = await newContext();
  const user = await login(recipient.page, { email: 'other@test.com', password: 'test123' });
  await inbox(recipient.page);
  await state(recipient.page, invitation.id, 'pending');
  return { trip, invitation, owner, recipient: { ...recipient, user } };
}
async function contextCase(browser, callback) {
  const contexts = [];
  const exceptions = [];
  const newContext = async () => {
    const context = await browser.newContext();
    contexts.push(context);
    await context.addInitScript(() => {
      window.__unhandledRejections = [];
      window.addEventListener('unhandledrejection', event => window.__unhandledRejections.push(String(event.reason)));
    });
    context.on('page', page => { page.setDefaultTimeout(10000); page.on('pageerror', error => exceptions.push(error.message)); });
    return { context, page: await context.newPage() };
  };
  try {
    const { page, context } = await newContext();
    await callback(page, context, newContext);
    for (const context of contexts) {
      for (const tab of context.pages()) {
        if (!tab.isClosed()) assert.deepEqual(await tab.evaluate(() => window.__unhandledRejections || []), [], 'Unhandled browser promises');
      }
    }
    assert.deepEqual(exceptions, [], 'Browser JavaScript exceptions');
  } finally { for (const context of contexts.reverse()) await context.close(); }
}

async function main() {
  const launch = { headless: true };
  if (process.env.CHROMIUM_EXECUTABLE) launch.executablePath = process.env.CHROMIUM_EXECUTABLE;
  const browser = await chromium.launch(launch);
  const cases = [
    ['Two real registered accounts complete an invitation and the member can read persisted items and split expenses only', async (page, context, newContext) => {
      await page.goto(`${base}/login.php`);
      await page.locator('#register-link').click();
      await page.waitForURL(`${base}/register.php`);
      const ownerAccount = await register(page, '新行程建立者');
      await page.locator('#register-login-link').click();
      await enabled(page, 'login-submit-btn');
      assert.equal(await page.locator('#login-email').inputValue(), ownerAccount.email);
      const owner = await login(page, ownerAccount);
      const recipient = await newContext();
      const recipientAccount = await register(recipient.page, '新行程成員');
      const member = await login(recipient.page, recipientAccount);
      const trip = await createTrip(page);
      await page.locator(`.trip-card[data-id="${trip.id}"] [data-action="members"]`).click();
      await page.waitForURL(url => url.pathname.endsWith('/trip-collab.php') && url.searchParams.get('tripId') === trip.id);
      await page.locator('#detail-content').waitFor();
      const invitation = await invite(page, trip.id, recipientAccount.email);
      assert.equal(await memberCard(page, member.id).count(), 0, 'An invitation alone never creates membership');
      await recipient.page.locator('a[href="invitations.php"]').first().click();
      await readyInbox(recipient.page);
      await respond(recipient.page, invitation.id);
      await detail(page, trip.id, 'trip-edit.php');
      const item = await addItem(page, trip.id);
      await detail(page, trip.id, 'trip-expense.php');
      const expense = await addExpense(page, trip.id, [owner.id, member.id]);
      await inboxCard(recipient.page, invitation.id).locator('[data-action="open"]').click();
      await recipient.page.locator('#detail-content').waitFor();
      await recipient.page.locator(`.item-card[data-id="${item.id}"]`).waitFor();
      assert.equal(await recipient.page.locator('#item-add-btn').isDisabled(), true);
      assert.equal(await recipient.page.locator('.item-card [data-action="edit"]').count(), 0);
      await recipient.page.locator('#detail-links a[href^="trip-expense.php"]').click();
      await recipient.page.locator('#detail-content').waitFor();
      await recipient.page.locator(`.expense-card[data-id="${expense.id}"]`).waitFor();
      assert.equal(await recipient.page.locator('#expense-add-btn').isDisabled(), true);
      assert.equal(await recipient.page.locator('#budget-save-btn').isDisabled(), true);
      assert.equal(await recipient.page.locator('.expense-card [data-action="edit"]').count(), 0);
      assert.equal((await details(recipient.context, trip.id)).summary.totalSpent, 101);
      assert.equal((await details(recipient.context, trip.id)).invitations.length, 0, 'A member never receives the owner invitation history');
      await recipient.page.reload();
      await recipient.page.locator('#detail-content').waitFor();
      await recipient.page.locator(`.expense-card[data-id="${expense.id}"]`).waitFor();
    }],
    ['Registration 500 preserves every input, disables pending submission and retries with one stable request key', async page => {
      const account = { name: '保留註冊表單', email: email(), password };
      await registerForm(page, account);
      const requested = gate();
      const release = gate();
      const keys = [];
      let first = true;
      await page.route('**/api/index.php?**', async route => {
        if (apiPath(route.request()) === 'register' && route.request().method() === 'POST') {
          keys.push(route.request().headers()['idempotency-key']);
          if (first) {
            first = false;
            requested.resolve();
            await release.promise;
            await route.fulfill({ status: 500, contentType: 'application/json', body: errorBody('server_error', '測試：註冊暫時無法完成。') });
            return;
          }
        }
        await route.continue();
      });
      await page.locator('#register-submit-btn').click();
      await requested.promise;
      try {
        assert.equal(await page.locator('#register-submit-btn').isDisabled(), true);
        assert.equal(await page.locator('#register-password').isDisabled(), true);
      } finally { release.resolve(); }
      await page.locator('#register-error').waitFor();
      await enabled(page, 'register-submit-btn');
      for (const [field, value] of Object.entries({ name: account.name, email: account.email, password, confirm: password })) assert.equal(await page.locator(`#register-${field}`).inputValue(), value);
      await mutation(page, 'POST', 'register', () => page.locator('#register-submit-btn').click(), 201);
      await registrationSuccess(page, account);
      assert.equal(keys.length, 2);
      assert.ok(keys[0]);
      assert.equal(keys[1], keys[0]);
    }],
    ['Registration session and CSRF failures offer read-only reconnection while preserving the draft and rejecting password mismatch', async page => {
      let sessionFailed = false;
      let csrfFailed = false;
      let posts = 0;
      const keys = [];
      await page.route('**/api/index.php?**', async route => {
        const path = apiPath(route.request());
        if (path === 'session' && !sessionFailed) {
          sessionFailed = true;
          await route.fulfill({ status: 500, contentType: 'application/json', body: errorBody('server_error', '測試：初始化失敗。') });
        } else if (path === 'register' && route.request().method() === 'POST') {
          posts += 1;
          keys.push(route.request().headers()['idempotency-key']);
          if (!csrfFailed) {
            csrfFailed = true;
            await route.fulfill({ status: 403, contentType: 'application/json', body: errorBody('CSRF_INVALID', '請重新連線。') });
          } else await route.continue();
        } else await route.continue();
      });
      await page.goto(`${base}/register.php`);
      await page.locator('#register-session-retry-btn').waitFor();
      assert.equal(await page.locator('#register-submit-btn').isDisabled(), true);
      await page.locator('#register-session-retry-btn').click();
      await enabled(page, 'register-submit-btn');
      const account = { name: 'CSRF 恢復旅客', email: email(), password };
      for (const [field, value] of Object.entries({ name: account.name, email: account.email, password, confirm: 'Differentpass123!' })) await page.locator(`#register-${field}`).fill(value);
      await page.locator('#register-submit-btn').click();
      await page.locator('#register-error').waitFor();
      assert.ok((await page.locator('#register-error').innerText()).includes('密碼不同'));
      assert.equal(posts, 0);
      await page.locator('#register-confirm').fill(password);
      await mutation(page, 'POST', 'register', () => page.locator('#register-submit-btn').click(), 403);
      await page.locator('#register-session-retry-btn').waitFor();
      assert.equal(await page.locator('#register-submit-btn').isDisabled(), true);
      await page.locator('#register-session-retry-btn').click();
      await enabled(page, 'register-submit-btn');
      assert.equal(await page.locator('#register-email').inputValue(), account.email);
      assert.equal(await page.locator('#register-password').inputValue(), password);
      assert.equal(posts, 1, 'Session reconnection must never automatically resubmit registration');
      await mutation(page, 'POST', 'register', () => page.locator('#register-submit-btn').click(), 201);
      await registrationSuccess(page, account);
      assert.equal(keys[0], keys[1]);
    }],
    ['A lost registration reply replays once; duplicate email is honest and authenticated users see their current account', async (page, context, newContext) => {
      const account = { name: '註冊回應遺失', email: email(), password };
      await registerForm(page, account);
      let dropped = false;
      const keys = [];
      await page.route('**/api/index.php?**', async route => {
        if (apiPath(route.request()) === 'register' && route.request().method() === 'POST') {
          keys.push(route.request().headers()['idempotency-key']);
          if (!dropped) {
            dropped = true;
            const response = await route.fetch();
            assert.equal(response.status(), 201);
            await route.abort('failed');
            return;
          }
        }
        await route.continue();
      });
      await page.locator('#register-submit-btn').click();
      await page.locator('#register-error').waitFor();
      await enabled(page, 'register-submit-btn');
      assert.equal(await page.locator('#register-password').inputValue(), password);
      await mutation(page, 'POST', 'register', () => page.locator('#register-submit-btn').click(), 201);
      await registrationSuccess(page, account);
      assert.equal(keys.length, 2);
      assert.equal(keys[0], keys[1]);
      const duplicate = await newContext();
      await registerForm(duplicate.page, { ...account, email: account.email.toUpperCase(), password: 'Otherpass123!' });
      await mutation(duplicate.page, 'POST', 'register', () => duplicate.page.locator('#register-submit-btn').click(), 409);
      await duplicate.page.locator('#register-error').waitFor();
      assert.ok((await duplicate.page.locator('#register-error').innerText()).includes('已有帳號'));
      assert.equal(await duplicate.page.locator('#register-password').inputValue(), 'Otherpass123!');
      await login(page, account);
      await page.goto(`${base}/register.php`);
      await page.locator('#register-account-note').waitFor();
      assert.ok((await page.locator('#register-current-account').innerText()).includes(account.email));
      assert.equal(await page.locator('#register-form').isVisible(), false);
      assert.equal(await page.locator('#register-password').inputValue(), '');
    }],
    ['Decline, reinvite, accept, remove and cancel use one invitation identity and current permissions', async (page, context, newContext) => {
      const { trip, invitation, recipient } = await setup(page, newContext);
      await respond(recipient.page, invitation.id, 'decline');
      assert.equal(await inboxCard(recipient.page, invitation.id).locator('[data-action="open"]').count(), 0);
      await detail(page, trip.id);
      const reinvited = await invite(page, trip.id);
      assert.equal(reinvited.id, invitation.id);
      assert.ok(reinvited.version > invitation.version);
      await inbox(recipient.page);
      await respond(recipient.page, invitation.id);
      await detail(page, trip.id);
      await memberCard(page, recipient.user.id).waitFor();
      await remove(page, trip.id, recipient.user.id);
      await memberCard(page, recipient.user.id).waitFor({ state: 'detached' });
      await inbox(recipient.page);
      await state(recipient.page, invitation.id, 'revoked');
      assert.equal(await inboxCard(recipient.page, invitation.id).locator('[data-action="open"]').count(), 0);
      const again = await invite(page, trip.id);
      assert.equal(again.id, invitation.id);
      await cancel(page, trip.id, invitation.id);
      await inbox(recipient.page);
      await state(recipient.page, invitation.id, 'revoked');
      const snapshot = await details(context, trip.id);
      assert.equal(snapshot.invitations.length, 1);
      assert.equal(snapshot.trip.members.length, 1);
    }],
    ['Expense references block removal; after adjustment removal clears a member page on 404', async (page, context, newContext) => {
      const { trip, invitation, owner, recipient } = await setup(page, newContext);
      await respond(recipient.page, invitation.id);
      await detail(page, trip.id, 'trip-edit.php');
      const item = await addItem(page, trip.id, '移除後不得顯示的私人行程');
      await detail(page, trip.id, 'trip-expense.php');
      const expense = await addExpense(page, trip.id, [owner.id, recipient.user.id], 333);
      await detail(recipient.page, trip.id, 'trip-edit.php');
      await recipient.page.locator(`.item-card[data-id="${item.id}"]`).waitFor();
      await detail(page, trip.id);
      const before = await details(context, trip.id);
      await remove(page, trip.id, recipient.user.id, 409);
      await page.locator('#membership-delete-error').waitFor();
      assert.ok((await page.locator('#membership-delete-error').innerText()).includes('請先調整費用'));
      assert.equal(await page.locator('#membership-delete-confirm-btn').isDisabled(), true);
      assert.equal((await details(context, trip.id)).trip.version, before.trip.version);
      assert.ok((await details(context, trip.id)).trip.members.some(value => value.userId === recipient.user.id));
      await page.locator('#membership-delete-modal [data-close]').last().click();
      await detail(page, trip.id, 'trip-expense.php');
      await page.locator(`.expense-card[data-id="${expense.id}"] [data-action="delete"]`).click();
      await mutation(page, 'DELETE', `trips/${trip.id}/expenses/${expense.id}`, () => page.locator('#expense-delete-confirm-btn').click());
      await page.locator('#expense-delete-modal').waitFor({ state: 'hidden' });
      await detail(page, trip.id);
      await remove(page, trip.id, recipient.user.id);
      await recipient.page.reload();
      await recipient.page.locator('#detail-error').waitFor();
      assert.equal(await recipient.page.locator('#detail-content').isVisible(), false);
      assert.equal(await recipient.page.locator('.item-card').count(), 0);
      assert.equal(await recipient.page.locator('#detail-title').innerText(), '行程無法查看');
      assert.equal(await recipient.page.locator('#item-add-btn').isDisabled(), true);
      const response = await recipient.context.request.get(apiUrl(`trips/${trip.id}/details`));
      assert.equal(response.status(), 404);
    }],
    ['Invite 500 preserves the email, disables pending submission and retries with one request key', async page => {
      await login(page);
      const trip = await createTrip(page);
      await detail(page, trip.id);
      await page.locator('#invite-email').fill('other@test.com');
      const requested = gate();
      const release = gate();
      let first = true;
      const keys = [];
      await page.route('**/api/index.php?**', async route => {
        if (apiPath(route.request()) === `trips/${trip.id}/invitations` && route.request().method() === 'POST') {
          keys.push(route.request().headers()['idempotency-key']);
          if (first) {
            first = false;
            requested.resolve();
            await release.promise;
            await route.fulfill({ status: 500, contentType: 'application/json', body: errorBody('server_error', '測試：邀請建立失敗。') });
            return;
          }
        }
        await route.continue();
      });
      await page.locator('#invite-save-btn').click();
      await requested.promise;
      try { assert.equal(await page.locator('#invite-save-btn').isDisabled(), true); }
      finally { release.resolve(); }
      await page.locator('#invite-error').waitFor();
      await enabled(page, 'invite-save-btn');
      assert.equal(await page.locator('#invite-email').inputValue(), 'other@test.com');
      await mutation(page, 'POST', `trips/${trip.id}/invitations`, () => page.locator('#invite-save-btn').click(), 201);
      await enabled(page, 'invite-save-btn');
      assert.equal(await page.locator('.trip-invitation-card').count(), 1);
      assert.equal(keys.length, 2);
      assert.ok(keys[0]);
      assert.equal(keys[0], keys[1]);
    }],
    ['A lost owner invite reply followed by cancellation refreshes current truth rather than the old pending receipt', async (page, context) => {
      await login(page);
      const trip = await createTrip(page);
      await detail(page, trip.id);
      let first = true;
      let inviteId;
      const keys = [];
      await page.route('**/api/index.php?**', async route => {
        if (apiPath(route.request()) === `trips/${trip.id}/invitations` && route.request().method() === 'POST') {
          keys.push(route.request().headers()['idempotency-key']);
          if (first) {
            first = false;
            const response = await route.fetch();
            assert.equal(response.status(), 201);
            inviteId = (await response.json()).data.invitations[0].id;
            await route.abort('failed');
            return;
          }
        }
        await route.continue();
      });
      await page.locator('#invite-email').fill('other@test.com');
      await page.locator('#invite-save-btn').click();
      await page.locator('#invite-error').waitFor();
      await enabled(page, 'invite-save-btn');
      const second = await context.newPage();
      await detail(second, trip.id);
      await cancel(second, trip.id, inviteId);
      await mutation(page, 'POST', `trips/${trip.id}/invitations`, () => page.locator('#invite-save-btn').click(), 201);
      await enabled(page, 'invite-save-btn');
      await ownerCard(page, inviteId).locator('.membership-status.revoked').waitFor();
      assert.equal(await ownerCard(page, inviteId).locator('[data-action="cancel"]').count(), 0);
      assert.equal((await details(context, trip.id)).invitations.length, 1);
      assert.equal(keys[0], keys[1]);
    }],
    ['Confirmed invite plus failed refresh reports saved state and retries only GET', async (page, context) => {
      await login(page);
      const trip = await createTrip(page);
      await detail(page, trip.id);
      let posts = 0;
      let failed = false;
      await page.route('**/api/index.php?**', async route => {
        const path = apiPath(route.request());
        if (path === `trips/${trip.id}/invitations` && route.request().method() === 'POST') posts += 1;
        if (posts && !failed && path === `trips/${trip.id}/details` && route.request().method() === 'GET') {
          failed = true;
          await route.fulfill({ status: 500, contentType: 'application/json', body: errorBody('server_error', '測試：邀請已寫入，讀取失敗。') });
        } else await route.continue();
      });
      await page.locator('#invite-email').fill('other@test.com');
      await mutation(page, 'POST', `trips/${trip.id}/invitations`, () => page.locator('#invite-save-btn').click(), 201);
      await page.locator('#detail-error').waitFor();
      assert.ok((await page.locator('#detail-error').innerText()).includes('邀請已建立'));
      assert.equal(await page.locator('#detail-content').isVisible(), false);
      assert.equal(await page.locator('#invite-save-btn').isDisabled(), true);
      assert.equal((await details(context, trip.id)).invitations.length, 1);
      await page.locator('#detail-retry-btn').click();
      await page.locator('#detail-content').waitFor();
      await enabled(page, 'invite-save-btn');
      assert.equal(await page.locator('.trip-invitation-card').count(), 1);
      assert.equal(posts, 1);
    }],
    ['Invite 409 plus latest GET 500 preserves email and requires an unchecked review after read recovery', async (page, context) => {
      await login(page);
      const trip = await createTrip(page);
      await detail(page, trip.id);
      await page.locator('#invite-email').fill('other@test.com');
      const second = await context.newPage();
      await detail(second, trip.id, 'trip-edit.php');
      await addItem(second, trip.id);
      const latest = await details(context, trip.id);
      let writes = 0;
      let failed = false;
      const versions = [];
      const navigations = [];
      page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations.push(frame.url()); });
      await page.route('**/api/index.php?**', async route => {
        const path = apiPath(route.request());
        if (path === `trips/${trip.id}/invitations` && route.request().method() === 'POST') {
          writes += 1;
          versions.push(route.request().postDataJSON().version);
        }
        if (writes && !failed && path === `trips/${trip.id}/details` && route.request().method() === 'GET') {
          failed = true;
          await route.fulfill({ status: 500, contentType: 'application/json', body: errorBody('server_error', '測試：衝突後讀取失敗。') });
        } else await route.continue();
      });
      await mutation(page, 'POST', `trips/${trip.id}/invitations`, () => page.locator('#invite-save-btn').click(), 409);
      await page.locator('#invite-conflict-retry-btn').waitFor();
      assert.equal(await page.locator('#invite-email').inputValue(), 'other@test.com');
      assert.equal(await page.locator('#invite-save-btn').isDisabled(), true);
      await page.locator('#invite-conflict-retry-btn').click();
      await page.locator('#invite-conflict-latest').waitFor();
      assert.equal(await page.locator('#invite-conflict-reviewed').isChecked(), false);
      assert.equal(await page.locator('#invite-save-btn').isDisabled(), true);
      assert.equal(await page.locator('#invite-email').inputValue(), 'other@test.com');
      assert.equal(writes, 1);
      assert.deepEqual(navigations, []);
      await page.locator('#invite-conflict-reviewed').check();
      await enabled(page, 'invite-save-btn');
      await mutation(page, 'POST', `trips/${trip.id}/invitations`, () => page.locator('#invite-save-btn').click(), 201);
      await enabled(page, 'invite-save-btn');
      assert.equal(writes, 2);
      assert.equal(versions[1], latest.trip.version);
      assert.equal((await details(context, trip.id)).invitations.length, 1);
    }],
    ['A lost accept reply followed by removal and reinvitation shows fresh pending truth and requires a new review', async (page, context, newContext) => {
      const { trip, invitation, recipient } = await setup(page, newContext);
      const readRequested = gate();
      const release = gate();
      let dropped = false;
      let delayed = false;
      const keys = [];
      const versions = [];
      await recipient.page.route('**/api/index.php?**', async route => {
        const path = apiPath(route.request());
        if (path === `invitations/${invitation.id}/accept` && route.request().method() === 'POST') {
          keys.push(route.request().headers()['idempotency-key']);
          versions.push(route.request().postDataJSON().version);
          if (!dropped) {
            dropped = true;
            const response = await route.fetch();
            assert.equal(response.status(), 200);
            await route.abort('failed');
            return;
          }
        }
        if (dropped && !delayed && path === 'invitations' && route.request().method() === 'GET') {
          delayed = true;
          readRequested.resolve();
          await release.promise;
        }
        await route.continue();
      });
      const misleading = [];
      await recipient.page.exposeFunction('__recordMisleadingJoin', value => misleading.push(value));
      await recipient.page.evaluate(id => {
        const observer = new MutationObserver(() => {
          const card = document.querySelector(`.invitation-card[data-id="${id}"]`);
          if (card && (card.dataset.status === 'accepted' || card.querySelector('[data-action="open"]'))) window.__recordMisleadingJoin(card.textContent);
        });
        observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
        window.__joinObserver = observer;
      }, invitation.id);
      await inboxCard(recipient.page, invitation.id).locator('[data-action="accept"]').click();
      await recipient.page.locator('#invitation-action-confirm-btn').click();
      await readRequested.promise;
      try {
        assert.equal(await recipient.page.locator('#invitation-action-confirm-btn').isDisabled(), true);
        await detail(page, trip.id);
        await remove(page, trip.id, recipient.user.id);
        const latest = await invite(page, trip.id);
        assert.equal(latest.id, invitation.id);
        assert.ok(latest.version > invitation.version);
      } finally { release.resolve(); }
      await recipient.page.locator('#invitation-action-review').waitFor();
      await state(recipient.page, invitation.id, 'pending');
      assert.equal(await inboxCard(recipient.page, invitation.id).locator('[data-action="open"]').count(), 0);
      assert.equal(await recipient.page.locator('#invitation-action-reviewed').isChecked(), false);
      assert.equal(await recipient.page.locator('#invitation-action-confirm-btn').isDisabled(), true);
      assert.equal(keys.length, 1);
      assert.deepEqual(misleading, [], 'The old accepted receipt must not render joined access');
      await recipient.page.evaluate(() => window.__joinObserver.disconnect());
      await recipient.page.locator('#invitation-action-reviewed').check();
      await enabled(recipient.page, 'invitation-action-confirm-btn');
      await mutation(recipient.page, 'POST', `invitations/${invitation.id}/accept`, () => recipient.page.locator('#invitation-action-confirm-btn').click());
      await recipient.page.locator('#invitation-action-modal').waitFor({ state: 'hidden' });
      await state(recipient.page, invitation.id, 'accepted');
      assert.equal(keys.length, 2);
      assert.notEqual(keys[0], keys[1], 'A new invitation version needs a new confirmed request');
      assert.ok(versions[1] > versions[0]);
      assert.equal((await details(context, trip.id)).trip.members.filter(value => value.userId === recipient.user.id).length, 1);
    }],
    ['Confirmed acceptance with failed GET blocks further writes and recovers through a read-only retry', async (page, context, newContext) => {
      const { invitation, recipient } = await setup(page, newContext);
      let posts = 0;
      let failed = false;
      await recipient.page.route('**/api/index.php?**', async route => {
        const path = apiPath(route.request());
        if (path === `invitations/${invitation.id}/accept` && route.request().method() === 'POST') posts += 1;
        if (posts && !failed && path === 'invitations' && route.request().method() === 'GET') {
          failed = true;
          await route.fulfill({ status: 500, contentType: 'application/json', body: errorBody('server_error', '測試：接受完成，但讀取失敗。') });
        } else await route.continue();
      });
      await inboxCard(recipient.page, invitation.id).locator('[data-action="accept"]').click();
      await mutation(recipient.page, 'POST', `invitations/${invitation.id}/accept`, () => recipient.page.locator('#invitation-action-confirm-btn').click());
      await recipient.page.locator('#invitation-action-retry-btn').waitFor();
      assert.equal(await recipient.page.locator('#invitation-action-confirm-btn').isDisabled(), true);
      assert.equal(await recipient.page.locator('.invitation-card').count(), 0);
      assert.ok((await recipient.page.locator('#invitation-action-error').innerText()).includes('不會再次送出操作'));
      await recipient.page.locator('#invitation-action-retry-btn').click();
      await recipient.page.locator('#invitation-action-modal').waitFor({ state: 'hidden' });
      await state(recipient.page, invitation.id, 'accepted');
      await inboxCard(recipient.page, invitation.id).locator('[data-action="open"]').waitFor();
      assert.equal(posts, 1);
    }],
    ['Recipient 409 plus latest GET 500 retains the action and requires fresh unchecked review before retrying', async (page, context, newContext) => {
      const { trip, invitation, recipient } = await setup(page, newContext);
      await inboxCard(recipient.page, invitation.id).locator('[data-action="accept"]').click();
      await cancel(page, trip.id, invitation.id);
      const latest = await invite(page, trip.id);
      let posts = 0;
      let failed = false;
      const versions = [];
      await recipient.page.route('**/api/index.php?**', async route => {
        const path = apiPath(route.request());
        if (path === `invitations/${invitation.id}/accept` && route.request().method() === 'POST') {
          posts += 1;
          versions.push(route.request().postDataJSON().version);
        }
        if (posts && !failed && path === 'invitations' && route.request().method() === 'GET') {
          failed = true;
          await route.fulfill({ status: 500, contentType: 'application/json', body: errorBody('server_error', '測試：讀取新邀請失敗。') });
        } else await route.continue();
      });
      await mutation(recipient.page, 'POST', `invitations/${invitation.id}/accept`, () => recipient.page.locator('#invitation-action-confirm-btn').click(), 409);
      await recipient.page.locator('#invitation-action-retry-btn').waitFor();
      assert.equal(await recipient.page.locator('#invitation-action-modal').isVisible(), true);
      assert.equal(await recipient.page.locator('#invitation-action-title').innerText(), '接受邀請');
      assert.equal(await recipient.page.locator('#invitation-action-confirm-btn').isDisabled(), true);
      await recipient.page.locator('#invitation-action-retry-btn').click();
      await recipient.page.locator('#invitation-action-review').waitFor();
      assert.equal(await recipient.page.locator('#invitation-action-reviewed').isChecked(), false);
      assert.equal(await recipient.page.locator('#invitation-action-confirm-btn').isDisabled(), true);
      assert.equal(posts, 1);
      await state(recipient.page, invitation.id, 'pending');
      await recipient.page.locator('#invitation-action-reviewed').check();
      await enabled(recipient.page, 'invitation-action-confirm-btn');
      await mutation(recipient.page, 'POST', `invitations/${invitation.id}/accept`, () => recipient.page.locator('#invitation-action-confirm-btn').click());
      await recipient.page.locator('#invitation-action-modal').waitFor({ state: 'hidden' });
      await state(recipient.page, invitation.id, 'accepted');
      assert.equal(posts, 2);
      assert.equal(versions[1], latest.version);
    }],
    ['Cross-tab account changes clear inbox snapshots and anonymous registration passwords before loading the actual account', async (page, context, newContext) => {
      const { invitation, recipient } = await setup(page, newContext);
      let failed = false;
      await recipient.page.route('**/api/index.php?**', async route => {
        if (apiPath(route.request()) === 'invitations' && !failed) {
          failed = true;
          await route.fulfill({ status: 500, contentType: 'application/json', body: errorBody('server_error', '測試：邀請讀取失敗。') });
        } else await route.continue();
      });
      await recipient.page.reload();
      await recipient.page.locator('#invitations-error').waitFor();
      const second = await recipient.context.newPage();
      await second.goto(`${base}/trip-list.php`);
      await readyList(second);
      await logout(second);
      await login(second);
      await recipient.page.locator('#invitations-retry-btn').click();
      await recipient.page.waitForURL(`${base}/trip-list.php`);
      await readyList(recipient.page);
      assert.equal(await recipient.page.evaluate(() => AgentAPI.user.id), 'u_guest_01');
      assert.equal(await inboxCard(recipient.page, invitation.id).count(), 0);
      assert.ok((await recipient.page.locator('.account-info').innerText()).includes('test@test.com'));

      const anonymous = await newContext();
      const account = { name: '切帳號前未送出註冊', email: email(), password };
      await registerForm(anonymous.page, account);
      const switched = await anonymous.context.newPage();
      await login(switched);
      await anonymous.page.locator('#register-submit-btn').click();
      await anonymous.page.waitForURL(`${base}/trip-list.php`);
      await readyList(anonymous.page);
      assert.equal(await anonymous.page.locator('#register-password').count(), 0);
      assert.equal(await anonymous.page.locator('#register-confirm').count(), 0);
      assert.equal(await anonymous.page.evaluate(() => AgentAPI.user.id), 'u_guest_01');
    }],
    ['Names render as literal HTML text and registration, collaboration, inbox and confirmations fit 390px screens', async (page, context, newContext) => {
      const target = await newContext();
      await target.page.setViewportSize({ width: 390, height: 844 });
      const check = async (tab, label) => {
        const widths = await tab.evaluate(() => ({ viewport: document.documentElement.clientWidth, body: document.body.scrollWidth, document: document.documentElement.scrollWidth }));
        assert.ok(widths.body <= widths.viewport + 1 && widths.document <= widths.viewport + 1, `${label}: ${JSON.stringify(widths)}`);
      };
      const guestName = '<svg onload=alert(88)>旅客</svg>';
      const account = { name: guestName, email: email(), password };
      await registerForm(target.page, account);
      await check(target.page, 'registration form');
      await mutation(target.page, 'POST', 'register', () => target.page.locator('#register-submit-btn').click(), 201);
      await registrationSuccess(target.page, account);
      await check(target.page, 'registration success');
      const guest = await login(target.page, account);
      await page.setViewportSize({ width: 390, height: 844 });
      await login(page);
      const tripName = '<img src=x onerror=alert(99)>';
      const dialogs = [];
      for (const tab of [page, target.page]) tab.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
      const trip = await createTrip(page, tripName);
      await detail(page, trip.id);
      const invitation = await invite(page, trip.id, account.email);
      assert.equal(await ownerCard(page, invitation.id).locator('.membership-name').innerText(), guestName);
      assert.equal(await ownerCard(page, invitation.id).locator('svg,img').count(), 0);
      await check(page, 'collaboration cards');
      await ownerCard(page, invitation.id).locator('[data-action="cancel"]').click();
      await check(page, 'owner confirmation');
      await page.locator('#membership-delete-modal [data-close]').last().click();
      await inbox(target.page);
      assert.equal(await inboxCard(target.page, invitation.id).locator('.invitation-trip-name').innerText(), tripName);
      assert.equal(await inboxCard(target.page, invitation.id).locator('svg,img').count(), 0);
      await check(target.page, 'invitation inbox');
      await inboxCard(target.page, invitation.id).locator('[data-action="accept"]').click();
      await check(target.page, 'recipient confirmation');
      await mutation(target.page, 'POST', `invitations/${invitation.id}/accept`, () => target.page.locator('#invitation-action-confirm-btn').click());
      await target.page.locator('#invitation-action-modal').waitFor({ state: 'hidden' });
      await detail(page, trip.id);
      assert.equal(await memberCard(page, guest.id).locator('.membership-name').innerText(), guestName);
      assert.equal(await memberCard(page, guest.id).locator('svg,img').count(), 0);
      await check(page, 'member cards');
      assert.deepEqual(dialogs, []);
    }],
  ];
  let failed = 0;
  try {
    for (const [name, test] of cases) {
      try {
        await contextCase(browser, test);
        console.log(`PASS: ${name}`);
      } catch (error) {
        failed += 1;
        console.error(`FAIL: ${name}\n${error.stack || error}`);
      }
    }
  } finally { await browser.close(); }
  console.log(`Phase 3 browser acceptance: ${cases.length - failed}/${cases.length} passed`);
  if (failed) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
