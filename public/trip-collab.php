<?php
declare(strict_types=1);
require __DIR__ . '/includes/page.php';
pageHead('Agent TT — 行程成員', 'trip-edit.html', ['css/details.css', 'css/membership.css']);
?>
<body class="detail-page membership-page">
<div id="navbar-container"></div>
<main id="app">
  <header class="detail-header">
    <div class="page-container">
      <nav class="breadcrumb" aria-label="目前位置">
        <a href="trip-list.php">我的行程</a><span class="breadcrumb-sep" aria-hidden="true">›</span>
        <span aria-current="page">行程成員</span>
      </nav>
      <div class="trip-title-row">
        <h1 class="trip-main-title" id="detail-title">行程成員</h1>
        <nav class="header-actions" id="detail-links" aria-label="行程功能"></nav>
      </div>
      <p class="detail-meta" id="detail-meta"></p>
      <p class="permission-note" id="permission-note"></p>
    </div>
  </header>
  <div class="page-container detail-main">
    <p class="scope-note">行程建立者可邀請已註冊的旅客帳號。成員接受邀請後可查看行程與費用，修改權限仍由建立者保留。</p>
    <div id="page-message" class="detail-message" role="status" aria-live="polite"></div>
    <div id="detail-loading" class="detail-loading" role="status">正在載入行程成員…</div>
    <div id="detail-error" class="page-error" role="alert" hidden>
      <p id="detail-error-text"></p>
      <button type="button" class="btn btn-outline btn-sm" id="detail-retry-btn">重新載入</button>
    </div>
    <div id="detail-content" hidden>
      <section class="membership-section" aria-labelledby="members-heading">
        <div class="detail-section-header">
          <h2 class="detail-section-title" id="members-heading">行程成員</h2>
        </div>
        <div class="membership-list" id="members-list" aria-live="polite"></div>
      </section>
      <section class="detail-panel" id="owner-invitations" aria-labelledby="invite-heading" hidden>
        <h2 class="detail-section-title" id="invite-heading">邀請成員</h2>
        <p class="detail-help">請輸入對方已註冊的旅客帳號 Email。平台不會寄信；對方登入後，可在「收到的邀請」接受或拒絕。</p>
        <form id="invite-form" data-write>
          <div class="membership-invite-controls">
            <div class="form-group">
              <label class="form-label" for="invite-email">旅客帳號 Email</label>
              <input class="form-input" type="email" id="invite-email" name="email" maxlength="254" autocomplete="off" placeholder="friend@email.com" required>
            </div>
            <button class="btn btn-primary" id="invite-save-btn" type="submit" data-write disabled>建立邀請</button>
          </div>
          <div id="invite-conflict" class="detail-conflict conflict-review" hidden>
            <p id="invite-conflict-latest"></p>
            <label><input type="checkbox" id="invite-conflict-reviewed">我已核對最新資料，仍要邀請上述帳號</label>
          </div>
          <p id="invite-error" class="membership-error" role="alert" hidden></p>
          <button class="btn btn-outline btn-sm membership-retry" id="invite-conflict-retry-btn" type="button" hidden>重新取得最新資料</button>
        </form>
        <div class="detail-section-header membership-invitations-heading">
          <h3 class="detail-section-title">邀請紀錄</h3>
        </div>
        <div class="membership-list" id="trip-invitations-list" aria-live="polite"></div>
      </section>
    </div>
  </div>
</main>

<div class="modal-backdrop hidden" id="membership-delete-modal" role="dialog" aria-modal="true" aria-labelledby="membership-delete-title">
  <div class="modal detail-modal">
    <div class="modal-header">
      <h2 class="modal-title" id="membership-delete-title">確認操作</h2>
      <button class="modal-close" type="button" data-close="membership-delete-modal" aria-label="關閉成員操作確認">×</button>
    </div>
    <div class="modal-body">
      <p id="membership-delete-name"></p>
      <p class="detail-help">取消邀請後，對方無法使用該邀請加入；移除成員後，對方將無法查看此行程。若成員仍被支出引用，請先調整相關費用。</p>
      <p id="membership-delete-error" class="membership-error" role="alert" hidden></p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" type="button" data-close="membership-delete-modal">取消</button>
      <button class="btn btn-danger" id="membership-delete-confirm-btn" type="button" data-write>確認</button>
    </div>
  </div>
</div>
<div id="footer-container"></div>
<script src="js/api.js" defer></script>
<script src="js/trip-page.js" defer></script>
<script src="js/trip-collab.js" defer></script>
</body>
</html>
