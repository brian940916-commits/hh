<?php
declare(strict_types=1);
require __DIR__ . '/includes/page.php';
pageHead('Agent TT — 登入', 'login.html');
$legacy = prototypeHtml('login.html');
$start = strpos($legacy, '<div class="login-left">');
$end = strpos($legacy, '<!-- ═══ 右欄');
$illustration = ($start !== false && $end !== false) ? substr($legacy, $start, $end - $start) : '';
?>
<body>
<main class="login-wrap">
  <?= $illustration ?>
  <div class="login-right">
    <div class="login-logo-row"><div class="login-logo-name">Agent TT</div></div>
    <h1 style="font-size:22px;margin-bottom:12px">登入練習平台</h1>
    <p class="scope-note" style="margin-bottom:20px">可管理行程、安排每日活動並記錄費用。住宿訂單、票券與分享尚未開放。</p>
    <div style="font-size:12px;color:#8A8073;margin-bottom:10px">選擇練習帳號（身份由帳號決定）</div>
    <div class="role-cards" role="group" aria-label="練習帳號">
      <button type="button" class="role-card selected-guest" id="role-guest" onclick="selectRole('guest')"><span class="role-icon">🧳</span><span class="role-label">旅客</span></button>
      <button type="button" class="role-card" id="role-host" onclick="selectRole('host')"><span class="role-icon">🏡</span><span class="role-label">房東</span></button>
      <button type="button" class="role-card" id="role-admin" onclick="selectRole('admin')"><span class="role-icon">⚙️</span><span class="role-label">管理員</span></button>
    </div>
    <form id="login-form">
      <div class="form-group"><label class="form-label" for="login-email">Email</label><input class="form-input" type="email" id="login-email" placeholder="your@email.com" autocomplete="username" maxlength="254" required></div>
      <div class="form-group"><label class="form-label" for="login-password">密碼</label><input class="form-input" type="password" id="login-password" placeholder="請輸入密碼" autocomplete="current-password" required></div>
      <p id="session-status" role="status" style="font-size:13px;margin-bottom:12px">正在確認登入狀態…</p>
      <div class="error-msg" id="login-error" role="alert" style="display:none"></div>
      <button class="btn btn-primary btn-full" id="login-submit-btn" type="submit" disabled>登入</button>
      <button class="btn btn-outline btn-full" id="session-retry-btn" type="button" hidden style="margin-top:12px">重新連線</button>
    </form>
    <p style="font-size:12px;color:#8A8073;line-height:1.8;margin-top:20px">練習帳號請見啟動說明。註冊、忘記密碼、Google 與手機登入尚未開放。</p>
    <noscript><p class="error-msg">請開啟 JavaScript 後使用此平台。</p></noscript>
  </div>
</main>
<script src="js/api.js" defer></script>
<script src="js/login.js" defer></script>
</body></html>
