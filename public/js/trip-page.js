/* Shared session, loading and mutation behavior for API-backed trip pages. */
(() => {
  'use strict';
  const api = window.AgentAPI;
  const byId = id => document.getElementById(id);
  function node(tag, className, text) {
    const value = document.createElement(tag);
    if (className) value.className = className;
    if (text !== undefined) value.textContent = text;
    return value;
  }
  function feedback(id, text) {
    const target = byId(id);
    target.textContent = text;
    target.hidden = !text;
    target.style.display = text ? 'block' : 'none';
  }
  const money = value => 'NT$ ' + Number(value).toLocaleString('zh-TW');
  const validDate = (date, trip) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= trip.startDate && date <= trip.endDate;

  class TripPage {
    constructor(options) {
      this.options = options;
      const query = new URLSearchParams(location.search);
      this.id = query.get('tripId') || query.get('id') || '';
      this.path = '/trips/' + encodeURIComponent(this.id);
      this.snapshot = null;
      this.user = null;
      this.busy = false;
      this.invalidated = false;
      this.controls = [];
      this.clearHandlers = [];
      byId('detail-retry-btn').addEventListener('click', () => this.load());
      window.addEventListener('agenttt:unauthorized', () => this.clearAndLogin());
      document.querySelectorAll('[data-close]').forEach(button => {
        button.addEventListener('click', () => { if (!this.busy) this.closeModal(button.dataset.close); });
      });
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !this.busy) document.querySelectorAll('.modal-backdrop').forEach(modal => this.closeModal(modal.id));
      });
      document.querySelectorAll('.modal-backdrop').forEach(modal => modal.addEventListener('click', event => {
        if (event.target === modal && !this.busy) this.closeModal(modal.id);
      }));
    }
    get trip() { return this.snapshot?.trip; }
    get canEdit() { return this.trip?.canEdit === true; }
    get ready() { return !!this.snapshot && !this.invalidated; }
    message(text, error = false) {
      byId('page-message').textContent = text;
      byId('page-message').style.color = error ? 'var(--color-danger-text)' : 'var(--color-success-text)';
    }
    closeModal(id) {
      byId(id).classList.add('hidden');
      byId(id).dispatchEvent(new Event('tripmodal:closed'));
    }
    updateControls() {
      if (this.invalidated) return;
      document.querySelectorAll('button, input, select, textarea').forEach(control => {
        const write = !control.hasAttribute('data-close') && (control.hasAttribute('data-write') || !!control.closest('[data-write]'));
        control.disabled = this.busy || (write && (!this.ready || !this.canEdit));
      });
      this.controls.forEach(update => update());
    }
    async run(operation) {
      if (this.busy || this.invalidated) return;
      this.busy = true;
      this.updateControls();
      try { await operation(); }
      finally { this.busy = false; this.updateControls(); }
    }
    apply(snapshot) {
      if (this.invalidated || !api.user) return;
      if (!snapshot?.trip || snapshot.trip.id !== this.id || !Number.isInteger(snapshot.trip.version) || !Array.isArray(snapshot.items) || !Array.isArray(snapshot.expenses) || !snapshot.summary) {
        throw new api.ApiError('行程資料格式不正確，請重新載入。');
      }
      if (this.snapshot && snapshot.trip.version < this.snapshot.trip.version) return;
      this.snapshot = snapshot;
      byId('detail-title').textContent = snapshot.trip.name;
      byId('detail-meta').textContent = `${snapshot.trip.startDate} — ${snapshot.trip.endDate} · ${snapshot.trip.station}`;
      byId('permission-note').textContent = this.canEdit ? '你可以修改此行程。' : '你可查看此行程；只有行程建立者可修改。';
      byId('detail-loading').hidden = true;
      byId('detail-content').hidden = false;
      byId('detail-error').hidden = true;
      this.options.render(snapshot);
      this.updateControls();
    }
    async refresh() {
      try { this.apply(await api.request(this.path + '/details')); }
      catch (error) {
        if (error.status === 404 && !this.invalidated) {
          this.snapshot = null;
          byId('detail-content').hidden = true;
          byId('detail-title').textContent = '行程無法查看';
          byId('detail-meta').textContent = '';
          byId('permission-note').textContent = '行程已刪除，或你已不再是此行程的成員。';
          ['item-list', 'expense-list', 'category-summary', 'balances-list', 'settlements-list', 'members-list', 'trip-invitations-list']
            .forEach(id => { const value = byId(id); if (value) value.replaceChildren(); });
          this.updateControls();
        }
        throw error;
      }
    }
    savedButRefreshFailed(text) {
      if (this.invalidated) return;
      this.snapshot = null;
      byId('detail-content').hidden = true;
      byId('detail-error-text').textContent = text;
      byId('detail-error').hidden = false;
      this.updateControls();
    }
    renderNav() {
      const nav = node('nav');
      nav.id = 'navbar';
      nav.setAttribute('aria-label', '主導覽列');
      const inner = node('div', 'navbar-inner');
      const brand = node('a', 'navbar-brand-name', 'Agent TT');
      brand.href = 'trip-list.php';
      const list = node('a', 'navbar-link', '我的行程');
      list.href = 'trip-list.php';
      const inbox = node('a', 'navbar-link', '收到的邀請');
      inbox.href = 'invitations.php';
      const account = node('div', 'nav-user');
      account.style.marginLeft = 'auto';
      account.append(node('span', 'account-info', `${this.user.name} · ${this.user.email}`));
      const logout = node('button', 'btn btn-outline btn-sm', '登出');
      logout.id = 'logout-btn';
      logout.addEventListener('click', () => this.run(async () => {
        try { await api.request('/logout', { method: 'POST' }); api.clearSession(); }
        catch (error) { if (!this.invalidated) this.message('登出未完成。' + error.message, true); }
      }));
      account.append(logout);
      inner.append(brand, list, inbox, account);
      nav.append(inner);
      byId('navbar-container').replaceChildren(nav);
      const links = [['trip-edit.php', '行程編排'], ['trip-expense.php', '費用管理'], ['trip-collab.php', '行程成員']].map(([file, label]) => {
        const link = node('a', 'btn btn-outline btn-sm', label);
        link.href = file + '?tripId=' + encodeURIComponent(this.id);
        if (file === this.options.file) link.classList.add('active');
        return link;
      });
      byId('detail-links').replaceChildren(...links);
      byId('footer-container').replaceChildren(node('footer', 'backend-footer', 'Agent TT · 行程練習平台'));
    }
    clearAndLogin() {
      if (this.invalidated) return;
      this.invalidated = true;
      this.snapshot = null;
      this.user = null;
      this.clearHandlers.forEach(clear => clear());
      document.querySelectorAll('.modal-backdrop').forEach(modal => modal.classList.add('hidden'));
      document.querySelectorAll('input, textarea, select').forEach(input => { input.value = ''; if (input.type === 'checkbox') input.checked = false; });
      byId('detail-content').replaceChildren();
      byId('navbar-container').replaceChildren();
      byId('app').hidden = true;
      location.replace('login.php');
    }
    async load() {
      await this.run(async () => {
        byId('detail-error').hidden = true;
        if (!this.ready) byId('detail-loading').hidden = false;
        try {
          if (!this.id) throw new api.ApiError('請回到「我的行程」選擇要查看的行程。');
          if (!this.user) {
            const session = await api.loadSession();
            if (!session.user) { this.clearAndLogin(); return; }
            this.user = session.user;
            this.renderNav();
          }
          await this.refresh();
        } catch (error) {
          if (this.invalidated) return;
          byId('detail-loading').hidden = true;
          byId('detail-error-text').textContent = error.message + (this.ready ? ' 目前顯示上次載入的資料。' : '');
          byId('detail-error').hidden = false;
        }
      });
    }
  }

  class TripForm {
    constructor(page, options) {
      this.page = page;
      this.options = options;
      this.prefix = options.prefix;
      this.state = null;
      byId(this.prefix + '-form').addEventListener('submit', event => { event.preventDefault(); this.save(); });
      byId(this.prefix + '-conflict-reviewed').addEventListener('change', () => page.updateControls());
      this.retry = node('button', 'btn btn-outline btn-sm', '重新取得最新資料');
      this.retry.type = 'button';
      this.retry.id = this.prefix + '-conflict-retry-btn';
      this.retry.hidden = true;
      byId(this.prefix + '-error').after(this.retry);
      this.retry.addEventListener('click', () => {
        if (this.state && !page.busy) page.run(() => this.conflict());
      });
      byId(this.prefix + '-modal').addEventListener('tripmodal:closed', () => { this.state = null; this.retry.hidden = true; page.updateControls(); });
      page.controls.push(() => this.updateControls());
      page.clearHandlers.push(() => { this.state = null; });
    }
    open(record = null) {
      if (!this.page.canEdit || this.page.busy) return;
      this.state = { id: record?.id || null, version: this.page.trip.version, conflict: null, attempt: null };
      this.retry.hidden = true;
      this.options.fill(record, this.page.snapshot);
      feedback(this.prefix + '-error', '');
      byId(this.prefix + '-conflict').hidden = true;
      byId(this.prefix + '-conflict-reviewed').checked = false;
      byId(this.prefix + '-modal-title').textContent = record ? this.options.editTitle : this.options.createTitle;
      byId(this.prefix + '-modal').classList.remove('hidden');
      this.page.updateControls();
      byId(this.prefix + '-name').focus();
    }
    updateControls() {
      if (!this.state || this.page.invalidated) return;
      const blocked = this.state.conflict === false || (this.state.conflict !== null && !byId(this.prefix + '-conflict-reviewed').checked);
      byId(this.prefix + '-save-btn').disabled = this.page.busy || !this.page.canEdit || blocked;
      byId(this.prefix + '-save-btn').textContent = this.page.busy ? '儲存中…' : '儲存';
      this.options.updateControls?.(this.page.snapshot);
    }
    async conflict() {
      byId(this.prefix + '-conflict-reviewed').checked = false;
      this.retry.hidden = true;
      try {
        await this.page.refresh();
        if (this.page.invalidated || !this.state) return;
        const latest = this.state.id ? this.page.snapshot[this.options.collection].find(record => record.id === this.state.id) : null;
        if ((this.state.id && !latest) || !this.page.canEdit) {
          this.state.conflict = false;
          feedback(this.prefix + '-error', '這筆資料已刪除或無法修改。你的輸入仍保留，請先關閉視窗。');
          return;
        }
        this.state.conflict = this.page.trip.version;
        byId(this.prefix + '-conflict').hidden = false;
        byId(this.prefix + '-conflict-latest').textContent = latest ? this.options.describe(latest) : '行程已有新修改，列表已更新為最新資料。';
        feedback(this.prefix + '-error', '行程已在其他頁面更新。你的輸入仍保留，請核對最新資料後再儲存。');
      } catch (error) {
        if (!this.state || this.page.invalidated) return;
        this.state.conflict = false;
        this.retry.hidden = error.status === 404;
        feedback(this.prefix + '-error', error.status === 404 ? '行程已刪除或無法查看。你的輸入仍保留，請關閉視窗。' : '最新資料載入失敗。你的輸入仍保留，請重新取得最新資料，再核對後儲存。 ' + error.message);
      }
    }
    async save() {
      if (this.page.busy || !this.page.canEdit || !this.state || this.state.conflict === false) return;
      if (this.state.conflict !== null && !byId(this.prefix + '-conflict-reviewed').checked) return;
      if (!byId(this.prefix + '-form').reportValidity()) return;
      const payload = this.options.read();
      const error = this.options.validate(payload, this.page.snapshot);
      if (error) { feedback(this.prefix + '-error', error); return; }
      payload.version = this.state.conflict === null ? this.state.version : this.state.conflict;
      const signature = JSON.stringify(payload);
      if (!this.state.id && this.state.attempt?.signature !== signature) this.state.attempt = { signature, key: api.newRequestKey() };
      await this.page.run(async () => {
        feedback(this.prefix + '-error', '');
        try {
          const path = this.page.path + '/' + this.options.collection + (this.state.id ? '/' + encodeURIComponent(this.state.id) : '');
          const creating = !this.state.id;
          this.page.apply(await api.request(path, { method: creating ? 'POST' : 'PATCH', body: payload, idempotencyKey: creating ? this.state.attempt.key : undefined }));
          if (this.page.invalidated) return;
          if (creating) {
            try { await this.page.refresh(); }
            catch (error) {
              this.page.savedButRefreshFailed('資料已儲存，但最新內容載入失敗。請重新載入核對。 ' + error.message);
            }
          }
          if (this.page.invalidated) return;
          this.page.closeModal(this.prefix + '-modal');
          this.page.message(this.options.savedMessage);
        } catch (failure) {
          if (this.page.invalidated) return;
          if (failure.status === 409) await this.conflict();
          else feedback(this.prefix + '-error', failure.message);
        }
      });
    }
  }

  class TripDelete {
    constructor(page, collection, prefix) {
      this.page = page;
      this.collection = collection;
      this.prefix = prefix;
      this.state = null;
      byId(prefix + '-delete-confirm-btn').addEventListener('click', () => this.confirm());
      byId(prefix + '-delete-modal').addEventListener('tripmodal:closed', () => { this.state = null; });
      page.controls.push(() => { if (this.state?.blocked) byId(prefix + '-delete-confirm-btn').disabled = true; });
      page.clearHandlers.push(() => { this.state = null; });
    }
    open(record) {
      if (!this.page.canEdit || this.page.busy) return;
      this.state = { id: record.id, version: this.page.trip.version, blocked: false };
      byId(this.prefix + '-delete-name').textContent = record.name;
      feedback(this.prefix + '-delete-error', '');
      byId(this.prefix + '-delete-modal').classList.remove('hidden');
      this.page.updateControls();
    }
    async confirm() {
      if (this.page.busy || !this.page.canEdit || !this.state || this.state.blocked) return;
      await this.page.run(async () => {
        feedback(this.prefix + '-delete-error', '');
        try {
          this.page.apply(await api.request(this.page.path + '/' + this.collection + '/' + encodeURIComponent(this.state.id), { method: 'DELETE', body: { version: this.state.version } }));
          if (this.page.invalidated) return;
          this.page.closeModal(this.prefix + '-delete-modal');
          this.page.message('資料已刪除。');
        } catch (error) {
          if (this.page.invalidated || !this.state) return;
          if (error.status === 409) {
            this.state.blocked = true;
            try { await this.page.refresh(); } catch (_) { /* Never silently retry a deletion. */ }
            if (!this.page.invalidated) feedback(this.prefix + '-delete-error', '行程已在其他頁面更新。請取消刪除、核對最新資料後，再重新開啟確認視窗。');
          } else feedback(this.prefix + '-delete-error', error.message);
        }
      });
    }
  }
  window.TripUI = { TripPage, TripForm, TripDelete, byId, node, feedback, money, validDate };
})();
