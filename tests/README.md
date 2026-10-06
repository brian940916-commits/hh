# PHP 與瀏覽器驗收

測試會真的啟動 PHP 伺服器，以臨時 SQLite 與 session 目錄測試；不會讀寫你在 XAMPP 建立的資料。失敗會回傳非零退出碼。GitHub Actions 使用同一份測試，而 GitHub Pages 不能執行 PHP。

環境需有 PHP 8.2 以上與 `pdo_sqlite`、Python 3、Node.js，以及專案鎖定的 Playwright。安裝 Chromium 後執行：

```sh
npm ci
npx playwright install chromium
python3 tests/run_acceptance.py
```

Windows 已安裝 XAMPP 時，可以指定 PHP 路徑：

```powershell
python tests/run_acceptance.py --php C:\xampp\php\php.exe
```

只驗證 HTTP 後端、資料庫與伺服器重啟：

```sh
python3 tests/run_acceptance.py --http-only
```

此模式明確略過瀏覽器檢查，不宣稱所有驗收已完成。完整模式驗證登入、cookie 身分隔離、清除 localStorage 後的持久化、行程 CRUD、載入畫面、寫入失敗保留表單、回應遺失後的冪等重試、多分頁版本衝突、另一分頁切換帳號後的身分同步、401 重新登入與文字轉義。

第二階段增加逐日行程項目的新增、修改、刪除、排序及移動日期，費用、付款者、分攤成員、預算與結算。HTTP 檢查包含成員唯讀、子項目不能跨行程修改、全行程版本衝突、同時重送的冪等性、整數金額餘數與零和結算。瀏覽器檢查以實際頁面操作驗證，包含手機寬度、表單失敗保留輸入與多分頁操作。

版本衝突後若最新資料讀取也失敗，預算、行程項目與費用草稿必須保留；重試只能讀取資料，取得最新內容並明確核對後才能再次寫入。測試會核對請求次數，防止重新載入頁面丟失草稿或自動重送修改。

第三階段增加匿名註冊、兩個真實新帳號的邀請與接受流程、拒絕後重邀、取消邀請、成員移除及費用引用保護。HTTP 檢查涵蓋角色欄位拒絕、email 正規化與重複帳號、密碼字元／72 bytes 上限、CSRF、權限與邀請版本、匿名冪等 HMAC、接受與拒絕並發、舊收據與目前權限區別。瀏覽器從實際註冊頁、成員頁及收到邀請頁操作。

`migration_acceptance.py` 分別從凍結的 schema 1（提交 `625fea6`）與完整 schema 2（提交 `5201d4f`）建立既有資料，驗證升級至 schema 3 後帳號、密碼雜湊、自訂行程、項目、費用、分攤成員、請求紀錄與 session 原始內容保持原值，重複執行也不重建資料。已刪掉的示範帳號與行程不會重新 seed；未知較新 schema 會失敗且不改資料。runner 會真正停止、重啟 PHP，核對所有 SQLite 表與既有 session 檔的內容。

HTTP 測試也可連接已啟動的**隔離測試伺服器**；因為會建立行程與 member fixture，請勿指向練習者自己的資料庫。Apache 子目錄也支援：

```sh
python3 tests/backend_http.py --base-url http://127.0.0.1/hh/public --data-dir /tmp/agenttt-test-data --php php
python3 tests/backend_phase2.py --base-url http://127.0.0.1/hh/public --data-dir /tmp/agenttt-test-data --php php
python3 tests/backend_phase3.py --base-url http://127.0.0.1/hh/public --data-dir /tmp/agenttt-test-data --php php
```

若環境已備有 Playwright 與 Chromium，可透過 `--playwright-module` 與 `--chromium` 指定既有安裝。原有 `npm test` 是失敗占位指令，`test-bugs.js` 檢查的是舊的公開靜態網站，兩者都不能取代這些驗收。
