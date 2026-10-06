# Agent TT：PHP＋SQLite 練習版

這個 `hh` 副本在原本前端上加入第一階段後端：session 登入／登出、行程基本資料 CRUD、帳號權限、版本衝突處理及 SQLite 持久化。原版 `SAD_AgentTT` 保留。

**Windows／XAMPP 啟動步驟：[docs/XAMPP-WINDOWS.md](docs/XAMPP-WINDOWS.md)。** 不需要 MySQL、Composer、AWS 或付費服務。PHP 8.2以上，需啟用 PDO SQLite。

## 使用方式

將專案放到新的 `C:\xampp\htdocs\hh-lab` 資料夾，在 XAMPP 開啟 Apache，瀏覽 `http://localhost/hh-lab/public/`。資料庫首次使用時初始化，之後保留既有帳號與行程。

| 示範角色 | Email | 密碼 |
| --- | --- | --- |
| 旅客 | test@test.com | test123 |
| 第二位旅客 | other@test.com | test123 |
| 房東 | host@test.com | test123 |
| 管理員 | admin@test.com | test123 |

所有角色均能驗證登入身分；第一階段行程建立／基本資料修改提供給旅客。房東、管理員業務、景點編輯、協作、住宿、票券與註冊尚未串接此後端。它們不會暗中使用 localStorage 冒充後端成功。

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
