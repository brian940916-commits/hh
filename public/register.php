<?php
declare(strict_types=1);
require __DIR__ . '/includes/page.php';
pageHead('Agent TT — 註冊旅客帳號', 'login.html', ['css/membership.css']);
$legacy = prototypeHtml('login.html');
$start = strpos($legacy, '<div class="login-left">');
$end = strpos($legacy, '<!-- ═══ 右欄');
$illustration = ($start !== false && $end !== false) ? substr($legacy, $start, $end - $start) : '';
?>
<body class="register-page">
<main class="login-wrap register-wrap">
  <?= $illustration ?>
  <div class="login-right">
    <div class="login-logo-row"><div class="login-logo-name">Agent TT</div></div>
    <h1 class="register-title">註冊旅客帳號</h1>
    <p class="scope-note register-scope">建立帳號後，可管理自己的行程或接受成員邀請。註冊完成後請使用新帳號登入。</p>
    <div class="membership-notice" id="register-account-note" role="status" hidden>
      <p>目前已登入：<strong id="register-current-account"></strong></p>
      <p>若要註冊另一個帳號，請先登出。</p>
      <a class="membership-text-link" href="trip-list.php">回到我的行程</a>
    </div>
    <form id="register-form">
      <div class="form-group">
        <label class="form-label" for="register-name">姓名</label>
        <input class="form-input" type="text" id="register-name" name="name" maxlength="80" autocomplete="name" placeholder="請輸入姓名" required>
      </div>
      <div class="form-group">
        <label class="form-label" for="register-email">Email</label>
        <input class="form-input" type="email" id="register-email" name="email" maxlength="254" autocomplete="email" placeholder="your@email.com" required>
      </div>
      <div class="form-group">
        <label class="form-label" for="register-password">密碼</label>
        <input class="form-input" type="password" id="register-password" name="password" minlength="8" autocomplete="new-password" placeholder="至少 8 個字元" aria-describedby="register-password-help" required>
        <p class="membership-help" id="register-password-help">至少 8 個字元。</p>
      </div>
      <div class="form-group">
        <label class="form-label" for="register-confirm">確認密碼</label>
        <input class="form-input" type="password" id="register-confirm" name="confirm" minlength="8" autocomplete="new-password" placeholder="再次輸入相同密碼" required>
      </div>
      <p class="register-status" id="register-status" role="status" aria-live="polite">正在確認登入狀態…</p>
      <p class="membership-error" id="register-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-full" id="register-submit-btn" type="submit" disabled>建立帳號</button>
      <button class="btn btn-outline btn-full membership-retry" id="register-session-retry-btn" type="button" hidden>重新連線</button>
    </form>
    <div class="membership-success" id="register-success" role="status" hidden>
      <h2>帳號已建立</h2>
      <p>請使用 <strong id="register-success-email"></strong> 與剛設定的密碼登入。</p>
      <a class="btn btn-primary btn-full" id="register-login-link" href="login.php">前往登入</a>
    </div>
    <p class="register-login-note">已有帳號？<a class="membership-text-link" href="login.php">登入</a></p>
    <noscript><p class="membership-error">請開啟 JavaScript 後使用此平台。</p></noscript>
  </div>
</main>
<script src="js/api.js" defer></script>
<script src="js/register.js" defer></script>
</body>
</html>
