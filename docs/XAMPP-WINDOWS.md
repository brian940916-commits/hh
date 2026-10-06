# Windows／XAMPP：第一次啟動

這份步驟針對 `hh` 的 PHP＋SQLite 練習版。XAMPP 只需 Apache，資料庫是 SQLite，不需要啟動 MySQL。

## 1. 安裝與放置檔案

1. 若目前只有下載安裝檔，先完成 XAMPP 安裝。以下以預設路徑 `C:\xampp` 為例。
2. 取得本次更新的 `hh` 或交付 ZIP。將專案放在新的資料夾 `C:\xampp\htdocs\hh-lab`，保留之前下載的副本。
3. 確认該資料夾直接含有 `public`、`backend`、`scripts`、`docs` 及原本的 HTML 檔。避免解壓後多一層資料夾。
4. `.htaccess` 是 Apache 的存取設定檔，要一併保留；不要只複製 `public`。

## 2. 啟用 SQLite

在 XAMPP Control Panel，點 Apache 旁的 **Config → PHP (php.ini)**。搜尋 `pdo_sqlite`，確認這行未被前面的分號註解：

```ini
extension=pdo_sqlite
```

有些版本寫成 `extension=php_pdo_sqlite.dll`，啟用原本那一行即可，不要重複加兩行。SQLite3 擴充不是這版必要條件；程式透過 PDO SQLite 使用資料庫。儲存後，在 Control Panel 停止並重新啟動 Apache。

也可在 PowerShell 檢查 CLI：

```powershell
& 'C:\xampp\php\php.exe' -r 'echo PHP_VERSION, PHP_EOL; print_r(PDO::getAvailableDrivers());'
```

版本需至少8.2，drivers清單需有 `sqlite`。若 Apache 使用不同的 PHP 設定，以 Control Panel 的 Config 指向檔案為準。

## 3. 開啟平台

在 Control Panel 按 **Apache → Start**，等狀態變成執行中。接著用瀏覽器開啟：

```text
http://localhost/hh-lab/public/
```

若 Apache 設為8080埠，網址改為 `http://localhost:8080/hh-lab/public/`。首次 API 請求會建立資料庫與示範帳號；重新整理不會重置資料。

旅客使用 `test@test.com / test123`，第二位旅客使用 `other@test.com / test123`。房東及管理員可登入驗證角色，但業務功能在後續階段串接。

也可先執行一次初始化，重複執行不會清空資料：

```powershell
Set-Location 'C:\xampp\htdocs\hh-lab'
& 'C:\xampp\php\php.exe' scripts\init-db.php
```

## 4. 自己確認一次

1. 以旅客登入，建立行程，確認留在行程列表並能看到新行程。
2. 編輯名稱／日期／車站／預算，設定狀態，重新整理後確認內容仍存在。
3. 停止 Apache，再啟動，重新登入確認行程仍存在。
4. 登出後以 `other@test.com` 登入，確認看不到第一位旅客建立的行程。
5. 回第一位旅客，從行程列表開啟「行程編排」，新增每日項目、調整順序與日期，重新整理確認保存。
6. 開啟「費用管理」，新增與編輯支出、調整預算，確認總支出與餘額更新。
7. 刪除練習項目、支出或行程，再重新整理確認已刪除。
8. 登出後從登入頁註冊自己的旅客帳號，再登入。在另一個帳號的行程「行程成員」邀請新帳號；切回新帳號，在「收到的邀請」接受，確認列表新增該行程且可查看內容。
9. 用建立者記一筆兩人分攤的支出，切到同行者確認分帳。若要移除同行者，先調整引用他的費用，再從「行程成員」移除。

每日安排、費用、註冊及邀請已使用後端；公開分享、訂房與票券仍待後續實作。

## 更新既有版本：保留資料

已經使用第一／二階段的人，請依下列方式更新。下載檔不含你的資料庫，不能拿空資料夾取代原有 `storage`。

1. 在 XAMPP **停止 Apache**，讓資料庫停止寫入。
2. 備份整個 `C:\xampp\htdocs\hh-lab` 資料夾到另一個位置；確認備份裡有 `storage\agenttt.sqlite`。
3. 將新版本 ZIP 解壓到另一個資料夾。把新版本完整程式內容複製到 `C:\xampp\htdocs\hh-lab`，允許取代同名程式檔，**保留原有 `storage` 資料夾**。不要刪除資料庫。
4. 確認根目錄及 `public` 裡的 `.htaccess` 都有更新，並確認 `public\trip-edit.php`、`public\trip-expense.php`、`public\register.php`、`public\trip-collab.php`、`public\invitations.php` 存在。
5. 重新啟動 Apache，開啟原本網址，按 **Ctrl+F5** 更新瀏覽器快取，再登入。
6. 第一個 API 請求會自動將資料庫由版本1／2升級到版本3，保留帳號、密碼、既有行程、明細、費用及登入資料。缺少的新資料表會新增，原有資料不會重設。
7. 開啟你之前建立的行程，確認名稱、日期與預算仍在，再新增每日安排與支出。

若升級遇到錯誤，先停止 Apache；不要刪除資料庫。保留錯誤文字與備份，由錯誤訊息定位問題。已升級的資料庫如需退回先前版本，應整份還原停止 Apache 時的備份，不能只換回舊 PHP 檔案。

## 遇到問題

| 現象 | 處理方式 |
| --- | --- |
| Apache無法Start | 開啟Apache的Logs，看是否80／443埠被占用；若換埠，網址也加上該埠 |
| 404找不到頁面 | 確认是 `htdocs\hh-lab\public\index.php`，以及網址包含 `/public/` |
| PHP程式變成下載檔或原始文字 | 要從Apache網址進入，確認Apache及PHP模組啟動，不使用檔案總管直接開PHP檔 |
| API連不上／SQLite不可用 | 核對PDO SQLite設定並重啟Apache，再查看Apache error log |
| 403禁止存取 | `/hh-lab/` 根目錄被刻意保護；請開 `/hh-lab/public/`。若public也403，確認完整保留 `public/.htaccess` |
| 資料庫無法寫入 | 確认專案的 `storage` 可由XAMPP Apache寫入，且未放在唯讀磁碟；先用初始化命令檢查 |

可以提供錯誤訊息與你使用的網址來定位問題；不需要提供密碼或session cookie。

## 資料保存

資料庫與session保存在專案 `storage/`，不是瀏覽器localStorage。重新整理、清掉localStorage或重啟Apache不會删除SQLite資料。要搬移練習資料，先停止Apache，備份整個storage資料夾；登入session不必搬移。初始化不會自動匯入舊版瀏覽器的模擬資料。

後端設定、storage與`.git`不應由HTTP直接下載；`.htaccess`需要Apache允許覆寫存取設定。若自行建立VirtualHost，將DocumentRoot直接設為專案的 `public` 資料夾，並允許該資料夾的存取設定。
