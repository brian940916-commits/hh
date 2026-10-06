# 第一階段驗收

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

HTTP 測試也可連接已啟動的**隔離測試伺服器**；因為會建立行程與 member fixture，請勿指向練習者自己的資料庫。Apache 子目錄也支援：

```sh
python3 tests/backend_http.py --base-url http://127.0.0.1/hh/public --data-dir /tmp/agenttt-test-data --php php
```

若環境已備有 Playwright 與 Chromium，可透過 `--playwright-module` 與 `--chromium` 指定既有安裝。原有 `npm test` 是失敗占位指令，`test-bugs.js` 檢查的是舊的公開靜態網站，兩者都不能取代這些驗收。
