<?php
declare(strict_types=1);
require __DIR__ . '/includes/page.php';
pageHead('Agent TT — 費用管理', 'trip-expense.html', ['css/details.css']);
?>
<body class="detail-page expenses-page">
<div id="navbar-container"></div>
<main id="app">
  <header class="detail-header">
    <div class="page-container">
      <nav class="breadcrumb" aria-label="目前位置">
        <a href="trip-list.php">我的行程</a><span class="breadcrumb-sep" aria-hidden="true">›</span>
        <span aria-current="page">費用管理</span>
      </nav>
      <div class="trip-title-row">
        <h1 class="trip-main-title" id="detail-title">費用管理</h1>
        <nav class="header-actions" id="detail-links" aria-label="行程功能"></nav>
      </div>
      <p class="detail-meta" id="detail-meta"></p>
      <p class="permission-note" id="permission-note"></p>
    </div>
  </header>
  <div class="page-container detail-main">
    <p class="scope-note">支出為手動記錄，以新臺幣整數計算。可選擇付款人與分攤成員；結算建議只供核對，不會執行轉帳。</p>
    <div id="page-message" class="detail-message" role="status" aria-live="polite"></div>
    <div id="detail-loading" class="detail-loading" role="status">正在載入費用…</div>
    <div id="detail-error" class="page-error" role="alert" hidden>
      <p id="detail-error-text"></p>
      <button type="button" class="btn btn-outline btn-sm" id="detail-retry-btn">重新載入</button>
    </div>
    <div id="detail-content" hidden>
      <section class="stats-grid detail-stats" aria-label="費用概況">
        <div class="stats-card budget"><p class="stats-label">總預算</p><p class="stats-value" id="summary-budget">—</p><p class="stats-sub">NT$</p></div>
        <div class="stats-card spent"><p class="stats-label">已記錄支出</p><p class="stats-value" id="summary-spent">—</p><p class="stats-sub">NT$</p></div>
        <div class="stats-card remaining"><p class="stats-label">剩餘預算</p><p class="stats-value" id="summary-remaining">—</p><p class="stats-sub">NT$</p></div>
        <div class="stats-card over-budget"><p class="stats-label">超出預算</p><p class="stats-value" id="summary-over-budget">—</p><p class="stats-sub">NT$</p></div>
      </section>
      <section class="detail-panel budget-panel" aria-labelledby="budget-heading" data-write>
        <h2 class="detail-section-title" id="budget-heading">調整總預算</h2>
        <div class="detail-budget-controls">
          <div class="form-group">
            <label class="form-label" for="budget-input">預算（NT$）</label>
            <input class="form-input" type="number" id="budget-input" min="0" max="1000000000" step="1" inputmode="numeric" data-write disabled>
          </div>
          <button type="button" class="btn btn-outline" id="budget-save-btn" data-write disabled>儲存預算</button>
        </div>
        <div id="budget-conflict" class="detail-conflict conflict-review" hidden>
          <p id="budget-conflict-latest"></p>
          <label><input type="checkbox" id="budget-conflict-reviewed">我已核對最新預算，仍要儲存這個金額</label>
        </div>
        <p id="budget-error" class="detail-form-error" role="alert" hidden></p>
      </section>
      <section aria-labelledby="expenses-heading">
        <div class="detail-section-header">
          <h2 class="detail-section-title" id="expenses-heading">支出明細</h2>
          <button type="button" class="btn btn-primary btn-sm" id="expense-add-btn" data-write disabled>＋ 新增支出</button>
        </div>
        <div id="expense-list" class="detail-expense-list" aria-live="polite"></div>
      </section>
      <div class="detail-summary-grid">
        <section class="detail-panel" aria-labelledby="categories-heading">
          <h2 class="detail-section-title" id="categories-heading">依類別彙整</h2>
          <div id="category-summary"></div>
        </section>
        <section class="detail-panel" aria-labelledby="balances-heading">
          <h2 class="detail-section-title" id="balances-heading">成員分帳</h2>
          <p class="detail-help">依各筆支出的付款人與分攤對象計算。除不盡的元數依成員順序分配，確保總額一致。</p>
          <div id="balances-list"></div>
        </section>
      </div>
      <section class="detail-panel" aria-labelledby="settlements-heading">
        <h2 class="detail-section-title" id="settlements-heading">結算建議</h2>
        <p class="detail-help">以下為尚需互相支付的建議金額，請自行核對並處理款項。</p>
        <div id="settlements-list"></div>
      </section>
    </div>
  </div>
</main>

<div class="modal-backdrop hidden" id="expense-modal" role="dialog" aria-modal="true" aria-labelledby="expense-modal-title">
  <form class="modal detail-modal" id="expense-form" data-write>
    <div class="modal-header">
      <h2 class="modal-title" id="expense-modal-title">新增支出</h2>
      <button type="button" class="modal-close" data-close="expense-modal" aria-label="關閉支出表單">×</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label" for="expense-name">項目名稱 <span class="required-mark">*</span></label>
        <input class="form-input" type="text" id="expense-name" name="name" maxlength="80" required autocomplete="off" placeholder="例：午餐">
      </div>
      <div class="detail-form-grid">
        <div class="form-group">
          <label class="form-label" for="expense-amount">金額（NT$）<span class="required-mark">*</span></label>
          <input class="form-input" type="number" id="expense-amount" name="amount" min="1" max="1000000000" step="1" inputmode="numeric" required placeholder="例：350">
        </div>
        <div class="form-group">
          <label class="form-label" for="expense-category">類別</label>
          <select class="form-select" id="expense-category" name="category">
            <option value="transport">交通</option>
            <option value="accommodation">住宿</option>
            <option value="food" selected>餐飲</option>
            <option value="activity">活動</option>
            <option value="other">其他</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="expense-date">日期 <span class="required-mark">*</span></label>
          <input class="form-input" type="date" id="expense-date" name="date" required>
        </div>
        <div class="form-group">
          <label class="form-label" for="expense-payer">付款人 <span class="required-mark">*</span></label>
          <select class="form-select" id="expense-payer" name="payerId" required></select>
        </div>
      </div>
      <fieldset class="detail-participants-fieldset">
        <legend class="form-label">分攤對象 <span class="required-mark">*</span></legend>
        <p class="detail-help">至少選擇一位成員。金額會平均分攤給所選成員。</p>
        <div id="expense-participants" class="detail-participant-options"></div>
      </fieldset>
      <div class="form-group">
        <label class="form-label" for="expense-note">備註（選填）</label>
        <textarea class="form-textarea" id="expense-note" name="note" maxlength="1000" rows="3" placeholder="記錄費用用途或分攤說明"></textarea>
      </div>
      <div id="expense-conflict" class="detail-conflict conflict-review" hidden>
        <p id="expense-conflict-latest"></p>
        <label><input type="checkbox" id="expense-conflict-reviewed">我已核對最新資料，仍要儲存這份修改</label>
      </div>
      <p id="expense-error" class="detail-form-error" role="alert" hidden></p>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn btn-outline" data-close="expense-modal">取消</button>
      <button type="submit" class="btn btn-primary" id="expense-save-btn" data-write>儲存支出</button>
    </div>
  </form>
</div>

<div class="modal-backdrop hidden" id="expense-delete-modal" role="dialog" aria-modal="true" aria-labelledby="expense-delete-title">
  <div class="modal modal-sm detail-modal">
    <div class="modal-header">
      <h2 class="modal-title" id="expense-delete-title">刪除支出</h2>
      <button type="button" class="modal-close" data-close="expense-delete-modal" aria-label="關閉刪除確認">×</button>
    </div>
    <div class="modal-body">
      <p>確定刪除「<strong id="expense-delete-name"></strong>」？</p>
      <p class="detail-help">此操作無法復原，分帳與結算金額將重新計算。</p>
      <p id="expense-delete-error" class="detail-form-error" role="alert" hidden></p>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn btn-outline" data-close="expense-delete-modal">取消</button>
      <button type="button" class="btn btn-danger" id="expense-delete-confirm-btn" data-write>確認刪除</button>
    </div>
  </div>
</div>
<div id="footer-container"></div>
<script src="js/api.js" defer></script>
<script src="js/trip-page.js" defer></script>
<script src="js/trip-expense.js" defer></script>
</body>
</html>
