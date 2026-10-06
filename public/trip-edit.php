<?php
declare(strict_types=1);
require __DIR__ . '/includes/page.php';
pageHead('Agent TT — 行程編排', 'trip-edit.html', ['css/details.css']);
?>
<body class="detail-page itinerary-page">
<div id="navbar-container"></div>
<main id="app">
  <header class="detail-header">
    <div class="page-container">
      <nav class="breadcrumb" aria-label="目前位置">
        <a href="trip-list.php">我的行程</a><span class="breadcrumb-sep" aria-hidden="true">›</span>
        <span aria-current="page">行程編排</span>
      </nav>
      <div class="trip-title-row">
        <h1 class="trip-main-title" id="detail-title">行程編排</h1>
        <nav class="header-actions" id="detail-links" aria-label="行程功能"></nav>
      </div>
      <p class="detail-meta" id="detail-meta"></p>
      <p class="permission-note" id="permission-note"></p>
    </div>
  </header>
  <div class="page-container detail-main">
    <p class="scope-note">可手動安排景點、餐廳、活動、住宿與交通。填入住宿或火車項目只會記錄行程，不會產生訂房或車票。</p>
    <div id="page-message" class="detail-message" role="status" aria-live="polite"></div>
    <div id="detail-loading" class="detail-loading" role="status">正在載入行程…</div>
    <div id="detail-error" class="page-error" role="alert" hidden>
      <p id="detail-error-text"></p>
      <button type="button" class="btn btn-outline btn-sm" id="detail-retry-btn">重新載入</button>
    </div>
    <section id="detail-content" aria-label="行程內容" hidden>
      <div class="detail-day-tabs" id="day-tabs" role="tablist" aria-label="行程日期"></div>
      <div class="detail-section-header">
        <h2 class="detail-section-title" id="day-label"></h2>
        <button type="button" class="btn btn-primary btn-sm" id="item-add-btn" data-write disabled>＋ 新增項目</button>
      </div>
      <div id="conflict-banner" class="detail-warning" role="status" hidden></div>
      <div id="item-list" class="detail-item-list" aria-live="polite"></div>
      <p class="detail-help">以每一天的項目順序整理行程；時間重疊時會顯示提醒。修改日期或時間後，請再核對當日安排。</p>
    </section>
  </div>
</main>

<div class="modal-backdrop hidden" id="item-modal" role="dialog" aria-modal="true" aria-labelledby="item-modal-title">
  <form class="modal detail-modal" id="item-form" data-write>
    <div class="modal-header">
      <h2 class="modal-title" id="item-modal-title">新增行程項目</h2>
      <button type="button" class="modal-close" data-close="item-modal" aria-label="關閉行程項目表單">×</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label" for="item-name">名稱 <span class="required-mark">*</span></label>
        <input class="form-input" type="text" id="item-name" name="name" maxlength="80" required autocomplete="off" placeholder="例：集集車站散步">
      </div>
      <div class="detail-form-grid">
        <div class="form-group">
          <label class="form-label" for="item-date">日期 <span class="required-mark">*</span></label>
          <input class="form-input" type="date" id="item-date" name="date" required>
        </div>
        <div class="form-group">
          <label class="form-label" for="item-type">類型 <span class="required-mark">*</span></label>
          <select class="form-select" id="item-type" name="type" required>
            <option value="attraction">景點</option>
            <option value="restaurant">餐廳</option>
            <option value="activity">活動</option>
            <option value="hotel">住宿（手動記錄）</option>
            <option value="train">火車（手動記錄）</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="item-start">開始時間 <span class="required-mark">*</span></label>
          <input class="form-input" type="time" id="item-start" name="startTime" required>
        </div>
        <div class="form-group">
          <label class="form-label" for="item-end">結束時間 <span class="required-mark">*</span></label>
          <input class="form-input" type="time" id="item-end" name="endTime" required>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="item-priority">優先順序</label>
        <select class="form-select" id="item-priority" name="priority">
          <option value="must">必去</option>
          <option value="optional" selected>候選</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="item-note">備註（選填）</label>
        <textarea class="form-textarea" id="item-note" name="note" maxlength="1000" rows="3" placeholder="記錄集合地點、活動細節等資訊"></textarea>
      </div>
      <div id="item-conflict" class="detail-conflict conflict-review" hidden>
        <p id="item-conflict-latest"></p>
        <label><input type="checkbox" id="item-conflict-reviewed">我已核對最新資料，仍要儲存這份修改</label>
      </div>
      <p id="item-error" class="detail-form-error" role="alert" hidden></p>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn btn-outline" data-close="item-modal">取消</button>
      <button type="submit" class="btn btn-primary" id="item-save-btn" data-write>儲存項目</button>
    </div>
  </form>
</div>

<div class="modal-backdrop hidden" id="item-delete-modal" role="dialog" aria-modal="true" aria-labelledby="item-delete-title">
  <div class="modal modal-sm detail-modal">
    <div class="modal-header">
      <h2 class="modal-title" id="item-delete-title">刪除行程項目</h2>
      <button type="button" class="modal-close" data-close="item-delete-modal" aria-label="關閉刪除確認">×</button>
    </div>
    <div class="modal-body">
      <p>確定刪除「<strong id="item-delete-name"></strong>」？</p>
      <p class="detail-help">此操作無法復原。</p>
      <p id="item-delete-error" class="detail-form-error" role="alert" hidden></p>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn btn-outline" data-close="item-delete-modal">取消</button>
      <button type="button" class="btn btn-danger" id="item-delete-confirm-btn" data-write>確認刪除</button>
    </div>
  </div>
</div>

<div class="modal-backdrop hidden" id="order-conflict-modal" role="dialog" aria-modal="true" aria-labelledby="order-conflict-title">
  <div class="modal detail-modal">
    <div class="modal-header">
      <h2 class="modal-title" id="order-conflict-title">核對最新排列</h2>
      <button type="button" class="modal-close" data-close="order-conflict-modal" aria-label="關閉排列確認">×</button>
    </div>
    <div class="modal-body">
      <p id="order-conflict-latest"></p>
      <label class="conflict-review"><input type="checkbox" id="order-conflict-reviewed">我已核對最新項目，仍要套用這份排列</label>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn btn-outline" data-close="order-conflict-modal">取消</button>
      <button type="button" class="btn btn-primary" id="order-conflict-confirm-btn" data-write>確認排列</button>
    </div>
  </div>
</div>
<div id="footer-container"></div>
<script src="js/api.js" defer></script>
<script src="js/trip-page.js" defer></script>
<script src="js/trip-edit.js" defer></script>
</body>
</html>
