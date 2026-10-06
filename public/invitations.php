<?php
declare(strict_types=1);
require __DIR__ . '/includes/page.php';
pageHead('Agent TT — 收到的邀請', 'trip-edit.html', ['css/details.css', 'css/membership.css']);
?>
<body class="detail-page invitations-page">
<div id="navbar-container"></div>
<main id="app">
  <header class="detail-header">
    <div class="page-container">
      <nav class="breadcrumb" aria-label="目前位置">
        <a href="trip-list.php">我的行程</a><span class="breadcrumb-sep" aria-hidden="true">›</span>
        <span aria-current="page">收到的邀請</span>
      </nav>
      <h1 class="trip-main-title">收到的邀請</h1>
      <p class="detail-meta">查看邀請你的行程，並決定是否加入。</p>
    </div>
  </header>
  <div class="page-container detail-main">
    <p class="scope-note">接受邀請後可查看該行程與費用。加入成員不會取得修改權限；平台不會寄送邀請郵件。</p>
    <div id="page-message" class="detail-message" role="status" aria-live="polite"></div>
    <div id="invitations-loading" class="detail-loading" role="status">正在載入邀請…</div>
    <div id="invitations-error" class="page-error" role="alert" hidden>
      <p id="invitations-error-text"></p>
      <button class="btn btn-outline btn-sm" id="invitations-retry-btn" type="button">重新載入</button>
    </div>
    <section class="membership-list membership-inbox" id="invitations-list" aria-label="邀請清單" aria-live="polite"></section>
  </div>
</main>

<div class="modal-backdrop hidden" id="invitation-action-modal" role="dialog" aria-modal="true" aria-labelledby="invitation-action-title">
  <div class="modal detail-modal">
    <div class="modal-header">
      <h2 class="modal-title" id="invitation-action-title">確認邀請</h2>
      <button class="modal-close" type="button" data-close="invitation-action-modal" aria-label="關閉邀請確認">×</button>
    </div>
    <div class="modal-body">
      <p id="invitation-action-name"></p>
      <p class="membership-action-status" id="invitation-action-status" role="status"></p>
      <div class="detail-conflict conflict-review" id="invitation-action-review" hidden>
        <p id="invitation-action-latest"></p>
        <label><input type="checkbox" id="invitation-action-reviewed">我已核對最新狀態，仍要執行這個操作</label>
      </div>
      <p class="membership-error" id="invitation-action-error" role="alert" hidden></p>
      <button class="btn btn-outline btn-sm membership-retry" id="invitation-action-retry-btn" type="button" hidden>重新取得最新狀態</button>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" type="button" data-close="invitation-action-modal">取消</button>
      <button class="btn btn-primary" id="invitation-action-confirm-btn" type="button">確認</button>
    </div>
  </div>
</div>
<div id="footer-container"></div>
<script src="js/api.js" defer></script>
<script src="js/invitations.js" defer></script>
</body>
</html>
