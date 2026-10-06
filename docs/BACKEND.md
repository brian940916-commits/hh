# 第一階段後端

PHP 8.2以上／PDO SQLite，不使用Composer或框架。頁面與API同源；API透過 `api/index.php?path=...`，因此XAMPP子目錄不需要mod_rewrite。資料庫、session及後端實作位於public之外。

## API

以下路徑是query參數 `path` 的值。成功回應包在 `data`，失敗包在 `error`，DELETE成功為204空內容。

| 方法 | path | 內容與權限 |
| --- | --- | --- |
| GET | /health | 服務檢查 |
| GET | /session | 目前使用者或null、csrfToken |
| POST | /login | email、password；回safe user與新csrfToken |
| POST | /logout | 撤銷session |
| GET | /trips | 当前使用者擁有／加入的行程 |
| GET | /trips/{id} | owner／member可讀；無權查看回404 |
| POST | /trips | 旅客建立基本資料，後端決定ID與owner |
| PATCH | /trips/{id} | owner更新允許的基本欄位，附version |
| DELETE | /trips/{id} | owner删除，JSON body附version |

登入及其他寫入請求需 `X-CSRF-Token`，由session API取得。Cookies使用HttpOnly／SameSite，HTTPS加Secure；登入會重建session ID，登出使舊session失效。回應不包含密碼或password hash。

建立行程欄位：`name`、`startDate`、`endDate`、`station`、`budget`。日期為YYYY-MM-DD、結束不早於開始；預算為非負整數台幣。前端不能提交ownerId或任意角色取得權限。

POST行程另需 `Idempotency-Key`：相同使用者、key與內容重試不會建立第二筆，key相同但內容不同回409。前端在連線失敗後保留同一次建立操作的key。

PATCH／DELETE需帶目前version，過期回409，避免另一個分頁的內容被覆蓋。只更新明確允許的基本欄位，沒有整份localStorage物件上傳。member在第一階段只能閱讀owner的行程。

常見狀態碼：401未登入、403 CSRF／角色／操作權限不符、404找不到或不可讀、409版本或冪等衝突、422欄位錯誤。未預期錯誤不把SQL與檔案路徑送到前端。

受保護回應带 `X-AgentTT-User-Id`，以目前session帳號為準。另一分頁切換帳號後，API client在顯示資料前發現帳號改變，清除舊畫面並重新取得身分，避免把新資料呈現在舊帳號名稱下。

## 狀態與持久化

`status` 是保存的planning／completed／cancelled。使用者明確改狀態後 `statusManual=true`。若未手動設定且行程結束日期早於台北今天，回傳 `effectiveStatus=completed`；GET不為了顯示而修改資料庫。列表使用effectiveStatus顯示與篩選。

SQLite使用users、trips、trip_members與request_receipts資料表。SQL參數化，foreign_keys啟用，建立行程及冪等紀錄一併提交。密碼以PHP password_hash儲存；初始化只補首次資料，重跑保留已有帳号與行程。

預設資料保存在 `storage/`；測試可用 `AGENTTT_DATA_DIR` 指定獨立資料夾。不要把自己的資料庫提交到Git。備份資料前停止寫入，備份整个storage。

## 前端範圍

`public/login.php`、`public/trip-list.php`與共用API client使用session及SQLite。API錯誤不会回退至localStorage，也不因空快取提早顯示沒有行程。建立成功返回列表；目前不把後端ID傳到尚未串接的景點／協作頁。

舊根目錄HTML／JS保留供後續串接，不當作第一階段PHP入口。前端不自動匯入舊localStorage帳號、票券與模擬訂單。註冊、社群／SMS登入、完整行程、住宿及票券需後續獨立實作。
