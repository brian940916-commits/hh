<?php
declare(strict_types=1);
require __DIR__ . '/includes/page.php';
pageHead('Agent TT — 我的行程', 'trip-list.html');
$legacy = prototypeHtml('trip-list.html');
preg_match('/<body>(.*?)<script/s', $legacy, $matches);
$body = $matches[1] ?? '';
$body = str_replace('<div id="app">', '<div id="app"><div class="page-container" style="padding-top:20px"><p class="scope-note">可管理基本資料、編排行程並記錄費用。住宿訂單、票券、成員邀請與分享尚未開放。</p><div id="page-message" role="status" style="margin-top:12px"></div></div>', $body);
$body = str_replace('<button class="btn btn-primary" onclick="openCreateModal()">', '<button class="btn btn-primary" id="create-trip-btn" onclick="openCreateModal()" disabled>', $body);
$body = str_replace('<div id="trip-list"></div>', '<div id="list-error" class="page-error" role="alert" hidden><p id="list-error-text"></p><button class="btn btn-outline btn-sm" id="list-retry-btn" type="button" style="margin-top:8px">重新載入</button></div><div id="trip-list" aria-live="polite"><p>正在載入行程…</p></div>', $body);
$body = str_replace('✅ 確認以下行程資訊後，點擊「建立行程」即可開始規劃！', '確認以下資訊後，點擊「建立行程」儲存。', $body);
$body = str_replace("<div class=\"modal-footer\">\n      <button class=\"btn btn-ghost\"", "<div class=\"error-msg form-feedback\" id=\"step3-error\" role=\"alert\" style=\"display:none;padding:0 24px 16px\"></div><div class=\"modal-footer\">\n      <button class=\"btn btn-ghost\"", $body);
$body = str_replace('此操作無法復原，行程內所有資料將一併刪除。', '此操作無法復原，請確認後再刪除。', $body);
$body = str_replace('<button class="btn btn-danger"  onclick="confirmDelete()">', '<div id="delete-error" class="error-msg" role="alert" style="display:none"></div><button class="btn btn-danger" id="delete-confirm-btn" onclick="confirmDelete()">', $body);
$body = str_replace('<div class="error-text hidden" id="edit-trip-error"', '<div class="form-group" style="margin-top:14px"><label class="form-label" for="edit-trip-budget">預估總預算（NT$）</label><input type="number" class="form-input" id="edit-trip-budget" min="0" step="1" max="1000000000"></div><div id="edit-conflict" class="conflict-review" hidden><p id="edit-conflict-latest"></p><label><input type="checkbox" id="edit-conflict-reviewed">已核對最新資料，仍要儲存上述修改</label></div><div class="error-text hidden" id="edit-trip-error"', $body);
$body = str_replace('<button class="btn btn-primary" onclick="saveEditTrip()">', '<button class="btn btn-primary" id="edit-save-btn" onclick="saveEditTrip()">', $body);
echo '<body>' . $body;
?>
<script src="js/api.js" defer></script>
<script src="js/trips.js" defer></script>
</body></html>
