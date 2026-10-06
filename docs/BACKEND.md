# PHP／SQLite 後端

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

`public/login.php`、`public/trip-list.php`、`public/trip-edit.php`、`public/trip-expense.php`與共用API client使用session及SQLite。API錯誤不會回退至localStorage，也不因空快取提早顯示沒有行程。列表提供明細與費用入口，使用伺服器產生的行程ID。

舊根目錄HTML／JS保留供後續串接，不當作PHP入口。前端不自動匯入舊localStorage帳號、票券與模擬訂單。註冊、社群／SMS登入、邀請協作、公開分享、住宿訂單及票券需後續獨立實作。

## 第二階段：每日安排與費用

`GET /trips/{id}/details` 回傳 `{trip, items, expenses, summary}`。`trip` 沿用基本資料格式與 `version`；owner與已加入的member可閱讀。所有明細、費用寫入只提供給行程owner，並驗證旅客角色及CSRF。

| 方法 | path | 請求內容 |
| --- | --- | --- |
| POST | /trips/{id}/items | version及新項目；另帶Idempotency-Key |
| PATCH | /trips/{id}/items/{itemId} | version及要修改的欄位 |
| DELETE | /trips/{id}/items/{itemId} | version |
| PUT | /trips/{id}/items/order | version、date、該日期完整itemIds陣列 |
| POST | /trips/{id}/expenses | version及新支出；另帶Idempotency-Key |
| PATCH | /trips/{id}/expenses/{expenseId} | version及要修改的欄位 |
| DELETE | /trips/{id}/expenses/{expenseId} | version |

這些寫入共享整個行程的version，成功後加1並回傳完整details；POST為201，其餘為200。跨分頁先修改費用或基本資料，也會使舊明細版本過期。409時前端保留輸入並載入新資料，使用者核對後才能重送；刪除需重新確認。相同POST的冪等重試可以恢復已提交的結果，沒有第二筆新增。

每日項目欄位為 `date`、`startTime`、`endTime`、`name`、`type`、`note`、`priority`；ID、tripId與position由後端決定。日期必須在行程範圍內，時間為HH:MM且結束晚於開始；名稱1–80字、備註最多1000字。type為attraction／restaurant／activity／hotel／train，priority為must／optional。position從0開始，同一天連續；跨日編輯追加在新日期尾端，排序API必須傳同一天完整、不重複的項目ID。時間重疊由前端提示，允許保留備選安排。

費用欄位為 `name`、`amount`、`category`、`date`、`payerId`、`participantIds`、`note`。金額為1至1,000,000,000的整數台幣；category為transport／accommodation／food／activity／other，日期在行程內。付款人與分攤人只能使用該行程真實成員的userId；分攤名單去重並排序，至少一人。

summary提供總支出、預算、餘額、是否超支、分類總額、各人已付與應分攤金額、建議結算。每筆支出均分給所選participantIds，無法整除的餘數依userId固定順序分配，每人差額為paid-share。計算使用整數，所有差額加總為0，結算金額可完全平衡；這些資料不代表真的付款或轉帳。預算仍使用基本資料PATCH更新。

基本資料修改若縮短日期會排除現有每日項目或費用，回422要求先移動或刪除範圍外資料，不會默默刪除。刪除整個行程則透過foreign key cascade移除其明細與費用。

## 資料庫升級

新版本使用schema2。啟動時，在SQLite IMMEDIATE交易內從schema1新增明細、費用與分攤資料表；保留原有users、密碼雜湊、trips、members與request_receipts，不重跑示範資料、不重設行程。新資料庫先完成基礎初始化再升級，重复初始化不會清空資料。完整Windows備份與更新方式見 [XAMPP-WINDOWS.md](XAMPP-WINDOWS.md#更新既有版本保留資料)。
