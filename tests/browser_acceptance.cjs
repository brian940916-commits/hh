'use strict';

const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = (process.env.AGENTTT_BASE_URL || 'http://127.0.0.1:8090').replace(/\/$/, '');
const apiPath = request => new URL(request.url()).searchParams.get('path')?.replace(/^\//, '');
const delayGate = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const errorBody = (code, message) => JSON.stringify({ error: { code, message } });

async function waitEnabled(page, id) {
  await page.waitForFunction(id => {
    const element = document.getElementById(id);
    return element && !element.disabled;
  }, id);
}

async function readyList(page) {
  await page.locator('#create-trip-btn').waitFor();
  await waitEnabled(page, 'create-trip-btn');
  assert.equal(await page.locator('#list-error').isVisible(), false);
}

async function login(page, email = 'test@test.com') {
  const response = await page.goto(`${base}/login.php`);
  assert.equal(response.status(), 200);
  await waitEnabled(page, 'login-submit-btn');
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill('test123');
  await page.locator('#login-submit-btn').click();
  await page.waitForURL(`${base}/trip-list.php`);
  await readyList(page);
}

async function fillCreate(page, name) {
  await page.locator('#create-trip-btn').click();
  await page.locator('#new-trip-name').fill(name);
  await page.locator('#new-trip-start').fill('2099-01-02');
  await page.locator('#new-trip-end').fill('2099-01-04');
  await page.locator('#new-trip-budget').fill('3000');
  await page.locator('#modal-next-btn').click();
  await page.locator('#new-trip-station').selectOption('台中站');
  await page.locator('#modal-next-btn').click();
  await page.locator('#create-step-3').waitFor();
}

async function create(page, name) {
  await fillCreate(page, name);
  const responsePromise = page.waitForResponse(response => apiPath(response.request()) === 'trips' && response.request().method() === 'POST');
  await page.locator('#modal-next-btn').click();
  const response = await responsePromise;
  assert.equal(response.status(), 201);
  const trip = (await response.json()).data;
  await page.locator('#create-modal').waitFor({ state: 'hidden' });
  await page.locator(`.trip-card[data-id="${trip.id}"]`).waitFor();
  assert.ok(page.url().endsWith('/trip-list.php'), 'Creating a trip stays on the API-backed page');
  return trip;
}

async function edit(page, tripId, name) {
  await page.locator(`.trip-card[data-id="${tripId}"] [data-action="edit"]`).click();
  await page.locator('#edit-trip-name').fill(name);
}

async function saveEdit(page, expectedStatus = 200) {
  const promise = page.waitForResponse(response => apiPath(response.request())?.startsWith('trips/') && response.request().method() === 'PATCH');
  await page.locator('#edit-save-btn').click();
  const response = await promise;
  assert.equal(response.status(), expectedStatus);
  if (expectedStatus === 200) await page.locator('#edit-modal').waitFor({ state: 'hidden' });
  return response;
}

async function withContext(browser, callback) {
  const context = await browser.newContext();
  const exceptions = [];
  await context.addInitScript(() => {
    window.addEventListener('unhandledrejection', event => {
      window.__unhandledRejections = window.__unhandledRejections || [];
      window.__unhandledRejections.push(String(event.reason));
    });
  });
  context.on('page', page => {
    page.on('pageerror', error => exceptions.push(error.message));
  });
  try {
    const page = await context.newPage();
    await callback(page, context);
    for (const openPage of context.pages()) {
      const errors = await openPage.evaluate(() => window.__unhandledRejections || []);
      assert.deepEqual(errors, [], 'Unhandled browser promise rejections');
    }
    assert.deepEqual(exceptions, [], 'Browser JavaScript exceptions');
  } finally {
    await context.close();
  }
}

async function main() {
  const launch = { headless: true };
  if (process.env.CHROMIUM_EXECUTABLE) launch.executablePath = process.env.CHROMIUM_EXECUTABLE;
  const browser = await chromium.launch(launch);
  const cases = [
    ['Login rejects wrong password; cookies survive reload and localStorage clearing', async page => {
      await page.goto(`${base}/login.php`);
      await waitEnabled(page, 'login-submit-btn');
      await page.locator('#login-email').fill('test@test.com');
      await page.locator('#login-password').fill('wrong-password');
      await page.locator('#login-submit-btn').click();
      await page.locator('#login-error').waitFor();
      assert.ok(page.url().endsWith('/login.php'));
      await waitEnabled(page, 'login-submit-btn');
      assert.equal(await page.locator('#login-email').inputValue(), 'test@test.com');
      await page.locator('#login-password').fill('test123');
      await page.locator('#login-submit-btn').click();
      await page.waitForURL(`${base}/trip-list.php`);
      await readyList(page);
      const trip = await create(page, `持久化 ${Date.now()}`);
      await page.evaluate(() => {
        localStorage.clear();
        localStorage.setItem('agenttt_currentUser', JSON.stringify({ id: 'u_admin_01', role: 'admin' }));
      });
      await page.reload();
      await readyList(page);
      await page.locator(`.trip-card[data-id="${trip.id}"]`).waitFor();
      assert.equal(await page.evaluate(() => AgentAPI.user.id), 'u_guest_01');
    }],
    ['Trip create, update, status, reload and delete round trip', async page => {
      await login(page);
      const trip = await create(page, `CRUD ${Date.now()}`);
      const card = page.locator(`.trip-card[data-id="${trip.id}"]`);
      await edit(page, trip.id, '已修改的行程');
      await page.locator('#edit-trip-budget').fill('5500');
      await saveEdit(page);
      await card.locator('.trip-name').filter({ hasText: '已修改的行程' }).waitFor();
      const changed = page.waitForResponse(response => apiPath(response.request()) === `trips/${trip.id}` && response.request().method() === 'PATCH');
      await card.locator('.trip-status-select').selectOption('cancelled');
      assert.equal((await changed).status(), 200);
      await page.reload();
      await readyList(page);
      assert.equal(await card.locator('.trip-status-select').inputValue(), 'cancelled');
      assert.ok((await card.innerText()).includes('5,500'));
      await card.locator('[data-action="delete"]').click();
      const deleted = page.waitForResponse(response => apiPath(response.request()) === `trips/${trip.id}` && response.request().method() === 'DELETE');
      await page.locator('#delete-confirm-btn').click();
      assert.equal((await deleted).status(), 204);
      await card.waitFor({ state: 'detached' });
      await page.reload();
      await readyList(page);
      assert.equal(await card.count(), 0);
    }],
    ['A separate user context cannot see or read another owner trip', async (page, context) => {
      await login(page);
      const trip = await create(page, `隔離 ${Date.now()}`);
      const separate = await browser.newContext();
      try {
        const other = await separate.newPage();
        await login(other, 'other@test.com');
        assert.equal(await other.locator(`.trip-card[data-id="${trip.id}"]`).count(), 0);
        const response = await separate.request.get(`${base}/api/index.php?path=%2Ftrips%2F${trip.id}`);
        assert.equal(response.status(), 404);
        assert.equal(await other.evaluate(() => AgentAPI.user.id), 'u_guest_02');
      } finally { await separate.close(); }
      assert.equal(await page.evaluate(() => AgentAPI.user.id), 'u_guest_01');
    }],
    ['Switching accounts in another tab never renders new account trips under the cached identity', async (page, context) => {
      await login(page);
      let failed = false;
      await page.route('**/api/index.php?**', async route => {
        if (apiPath(route.request()) === 'trips' && route.request().method() === 'GET' && !failed) {
          failed = true;
          await route.fulfill({ status: 500, contentType: 'application/json', body: errorBody('server_error', '測試：請重新載入行程。') });
        } else await route.continue();
      });
      await page.reload();
      await page.locator('#list-error').waitFor();
      await waitEnabled(page, 'list-retry-btn');
      assert.equal(await page.evaluate(() => AgentAPI.user.id), 'u_guest_01');
      assert.ok((await page.locator('.account-info').innerText()).includes('test@test.com'));

      const second = await context.newPage();
      await second.goto(`${base}/trip-list.php`);
      await readyList(second);
      await second.locator('#logout-btn').click();
      await second.waitForURL(`${base}/login.php`);
      await login(second, 'other@test.com');
      const privateTrip = await create(second, `另一帳號的私人行程 ${Date.now()}`);
      const invalidFrames = [];
      const navigated = [];
      page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigated.push(frame.url()); });
      await page.exposeFunction('__recordInvalidIdentityFrame', frame => invalidFrames.push(frame));
      await page.evaluate(tripId => {
        const observer = new MutationObserver(() => {
          const privateCard = document.querySelector(`.trip-card[data-id="${tripId}"]`);
          const header = document.querySelector('.account-info')?.textContent || '';
          if (privateCard && !header.includes('other@test.com')) {
            window.__recordInvalidIdentityFrame({ header, trip: privateCard.textContent });
          }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
      }, privateTrip.id);
      await page.locator('#list-retry-btn').click();
      await page.locator('.account-info').filter({ hasText: 'other@test.com' }).waitFor();
      await readyList(page);
      await page.locator(`.trip-card[data-id="${privateTrip.id}"]`).waitFor();
      assert.equal(await page.evaluate(() => AgentAPI.user.id), 'u_guest_02');
      assert.deepEqual(invalidFrames, [], 'Another account data must never appear under the previous identity');
      assert.ok(navigated.some(url => url.endsWith('/login.php')), 'Account changes must clear the snapshot and reload session through login');
    }],
    ['Delayed list response keeps loading visible and creation disabled', async page => {
      await login(page);
      const requested = delayGate();
      const release = delayGate();
      await page.route('**/api/index.php?**', async route => {
        if (apiPath(route.request()) === 'trips' && route.request().method() === 'GET') {
          requested.resolve();
          await release.promise;
        }
        await route.continue();
      });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await requested.promise;
      try {
        assert.ok((await page.locator('#trip-list').innerText()).includes('載入'));
        assert.equal(await page.locator('#create-trip-btn').isDisabled(), true);
        assert.equal(await page.locator('#trip-list .trip-card').count(), 0);
      } finally { release.resolve(); }
      await readyList(page);
    }],
    ['Create server failure preserves fields, disables in-flight submission, and retries', async page => {
      await login(page);
      const requested = delayGate();
      const release = delayGate();
      let failed = false;
      const keys = [];
      await page.route('**/api/index.php?**', async route => {
        if (apiPath(route.request()) === 'trips' && route.request().method() === 'POST') {
          keys.push(route.request().headers()['idempotency-key']);
          if (!failed) {
            failed = true;
            requested.resolve();
            await release.promise;
            await route.fulfill({ status: 500, contentType: 'application/json', body: errorBody('server_error', '測試：暫時無法儲存，請重試。') });
            return;
          }
        }
        await route.continue();
      });
      const name = `保留表單 ${Date.now()}`;
      await fillCreate(page, name);
      await page.locator('#modal-next-btn').click();
      await requested.promise;
      try { assert.equal(await page.locator('#modal-next-btn').isDisabled(), true); }
      finally { release.resolve(); }
      await page.locator('#step3-error').waitFor();
      await waitEnabled(page, 'modal-next-btn');
      assert.equal(await page.locator('#new-trip-name').inputValue(), name);
      assert.equal(await page.locator('#new-trip-start').inputValue(), '2099-01-02');
      assert.equal(await page.locator('#create-modal').isVisible(), true);
      const saved = page.waitForResponse(response => apiPath(response.request()) === 'trips' && response.request().method() === 'POST');
      await page.locator('#modal-next-btn').click();
      assert.equal((await saved).status(), 201);
      await page.locator('#create-modal').waitFor({ state: 'hidden' });
      assert.equal(keys.length, 2);
      assert.ok(keys[0]);
      assert.equal(keys[1], keys[0], 'Retry must reuse the same request key');
    }],
    ['A committed request with a lost response retries without duplicate trips', async page => {
      await login(page);
      let dropped = false;
      let committedId;
      await page.route('**/api/index.php?**', async route => {
        if (apiPath(route.request()) === 'trips' && route.request().method() === 'POST' && !dropped) {
          dropped = true;
          const response = await route.fetch();
          assert.equal(response.status(), 201);
          committedId = (await response.json()).data.id;
          await route.abort('failed');
          return;
        }
        await route.continue();
      });
      const name = `回應遺失 ${Date.now()}`;
      await fillCreate(page, name);
      await page.locator('#modal-next-btn').click();
      await page.locator('#step3-error').waitFor();
      await waitEnabled(page, 'modal-next-btn');
      assert.equal(await page.locator('#new-trip-name').inputValue(), name);
      await page.locator('#modal-next-btn').click();
      await page.locator('#create-modal').waitFor({ state: 'hidden' });
      const rows = await page.locator('.trip-card .trip-name').allTextContents();
      assert.equal(rows.filter(value => value === name).length, 1);
      assert.equal(await page.locator(`.trip-card[data-id="${committedId}"]`).count(), 1);
    }],
    ['Two tabs cannot overwrite stale data without reviewing the conflict', async (page, context) => {
      await login(page);
      const trip = await create(page, `版本衝突 ${Date.now()}`);
      const second = await context.newPage();
      await second.goto(`${base}/trip-list.php`);
      await readyList(second);
      await edit(page, trip.id, '分頁 A 已儲存');
      await edit(second, trip.id, '分頁 B 未儲存');
      await saveEdit(page);
      await saveEdit(second, 409);
      await second.locator('#edit-conflict').waitFor();
      assert.equal(await second.locator('#edit-trip-name').inputValue(), '分頁 B 未儲存');
      assert.ok((await second.locator('#edit-conflict-latest').innerText()).includes('分頁 A 已儲存'));
      assert.equal(await second.locator('#edit-save-btn').isDisabled(), true);
      const response = await context.request.get(`${base}/api/index.php?path=%2Ftrips%2F${trip.id}`);
      assert.equal((await response.json()).data.name, '分頁 A 已儲存');
      await second.locator('#edit-conflict-reviewed').check();
      await waitEnabled(second, 'edit-save-btn');
      await saveEdit(second);
      await page.reload();
      await readyList(page);
      assert.equal(await page.locator(`.trip-card[data-id="${trip.id}"] .trip-name`).innerText(), '分頁 B 未儲存');
    }],
    ['Expired session removes the prior user list and returns to login', async page => {
      await login(page);
      assert.ok(await page.locator('.trip-card').count() > 0);
      let expired = false;
      await page.route('**/api/index.php?**', async route => {
        const path = apiPath(route.request());
        if (path === 'trips' && route.request().method() === 'GET') {
          expired = true;
          await route.fulfill({ status: 401, contentType: 'application/json', body: errorBody('unauthorized', '請重新登入。') });
        } else if (path === 'session' && expired) {
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { user: null, csrfToken: 'x'.repeat(64) } }) });
        } else await route.continue();
      });
      await page.reload();
      await page.waitForURL(`${base}/login.php`);
      await waitEnabled(page, 'login-submit-btn');
      assert.equal(await page.locator('.trip-card').count(), 0);
      assert.equal(await page.evaluate(() => AgentAPI.user), null);
    }],
    ['Session bootstrap failure prevents login until the connection recovers', async page => {
      let first = true;
      await page.route('**/api/index.php?**', async route => {
        if (apiPath(route.request()) === 'session' && first) {
          first = false;
          await route.fulfill({ status: 500, contentType: 'application/json', body: errorBody('server_error', '測試：服務暫時無法使用。') });
        } else await route.continue();
      });
      await page.goto(`${base}/login.php`);
      await page.locator('#session-retry-btn').waitFor();
      assert.equal(await page.locator('#login-submit-btn').isDisabled(), true);
      await page.locator('#session-retry-btn').click();
      await waitEnabled(page, 'login-submit-btn');
      assert.equal(await page.locator('#session-retry-btn').isVisible(), false);
    }],
    ['Trip names render as text without executing injected HTML', async page => {
      await login(page);
      const dialogs = [];
      page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
      const name = '<img src=x onerror=alert(1)>';
      const trip = await create(page, name);
      const title = page.locator(`.trip-card[data-id="${trip.id}"] .trip-name`);
      assert.equal(await title.innerText(), name);
      assert.equal(await title.locator('img').count(), 0);
      assert.deepEqual(dialogs, []);
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
  console.log(`Browser acceptance: ${cases.length - failed}/${cases.length} passed`);
  if (failed) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
