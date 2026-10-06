# Agent TT：PHP＋SQLite 練習版

這個 `hh` 副本在原本前端上加入 PHP／SQLite 後端：會員註冊、session 登入／登出、行程基本資料、每日安排、費用管理、同行者邀請、帳號權限及版本衝突處理。原版 `SAD_AgentTT` 保留。

**Windows／XAMPP 啟動步驟：[docs/XAMPP-WINDOWS.md](docs/XAMPP-WINDOWS.md)。** 不需要 MySQL、Composer、AWS 或付費服務。PHP 8.2以上，需啟用 PDO SQLite。

## 使用方式

將專案放到新的 `C:\xampp\htdocs\hh-lab` 資料夾，在 XAMPP 開啟 Apache，瀏覽 `http://localhost/hh-lab/public/`。資料庫首次使用時初始化，之後保留既有帳號與行程。

| 示範角色 | Email | 密碼 |
| --- | --- | --- |
| 旅客 | test@test.com | test123 |
| 第二位旅客 | other@test.com | test123 |
| 房東 | host@test.com | test123 |
| 管理員 | admin@test.com | test123 |

旅客可以建立行程，從列表開啟「行程編排」安排每日景點、餐廳與活動，並在「費用管理」記錄支出、調整預算。行程擁有者可以修改，已加入的成員可以閱讀。手動加入住宿／交通項目只用於規劃，不會產生訂房或車票。

登入頁可建立自己的旅客帳號；註冊成功後再登入。在行程「行程成員」輸入對方已註冊的 Email，對方登入後從「收到的邀請」接受，才會在自己的列表看見行程及分帳。邀請保存在平台裡，不會寄出 Email。建立者可取消待接受邀請或移除成員；若成員已出現在費用的付款／分攤名單，需先調整費用才能移除。

房東、管理員業務、公開分享、住宿訂單、票券及社群登入尚未串接此後端。費用分帳僅計算記錄，沒有轉帳或付款。

**已有第一／二階段資料時，請依 [Windows 更新步驟](docs/XAMPP-WINDOWS.md#更新既有版本保留資料) 保留 `storage`。** 程式會自動升級資料庫，不需要刪除或重新建立資料。

## 其他本機環境

```bash
php scripts/init-db.php
php -S 127.0.0.1:8080 -t public public/router.php
```

網頁入口是 `public/`。`backend/` 是 PHP 實作，`storage/` 是資料庫與 session，`scripts/` 是初始化工具；根目錄原有 HTML／JS 保留作後續模組串接的來源。Apache 的存取規則禁止直接下載根目錄與後端資料；PHP 開發路由也只提供 public 內容。

API 採 `public/api/index.php?path=/session` 形式，在 XAMPP 子目錄不依賴 URL rewrite。詳見 [API 與資料規則](docs/BACKEND.md)。

## 驗證

初始化可重複執行，不清空既有資料。測試使用獨立的 `AGENTTT_DATA_DIR`，避免修改自己的練習資料：

```bash
python3 tests/run_acceptance.py --http-only
```

瀏覽器驗收使用 Playwright；測試命令與已完成驗證會整理於 [docs/VALIDATION.md](docs/VALIDATION.md)。GitHub Actions 的後端工作流程用來測試 PHP／SQLite，GitHub Pages 提供靜態展示，不能執行這個後端。
