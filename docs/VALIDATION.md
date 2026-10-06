# 第一階段驗證結果

2026-10-06完成實際驗證。所有功能測試使用獨立臨時SQLite／session資料，未修改原版專案，也不包含使用者的本機資料。

| 檢查 | 結果 |
| --- | --- |
| PHP 8.2語法 | 12個PHP檔通過 |
| 前端JS語法 | 3個JS檔通過 |
| 真正HTTP驗收 | 25／25通過 |
| Chromium瀏覽器情境 | 11／11通過 |
| PHP真正停止再重啟 | SQLite行程完整保留 |
| Apache 2.4／PHP 8.4子目錄 | `/hh-lab/public/`登入及行程CRUD／登出通過；HTTP驗收25項通過 |
| 檔案保護 | Apache禁止HTTP下載storage、backend及.git；PHP開發伺服器亦阻擋私有路徑 |
| 畫面 | 桌面1280px與手機390px無橫向溢出；房東／管理員能確認身分，行程建立依角色限制 |

Windows本機尚未執行；以PHP 8.2及相同Apache 2.4子目錄機制驗證相容行為。XAMPP步驟見 [XAMPP-WINDOWS.md](XAMPP-WINDOWS.md)。

## 驗收範圍

HTTP檢查包含錯誤帳密、session ID更新、Cookie屬性、登出後舊cookie失效、全部寫入CSRF、帳號與member／owner權限、CRUD、有效日期／預算／欄位驗證、SQL字元作一般資料、GET不修改狀態、版本409與冪等重試。

瀏覽器驗收包含登入、清除localStorage後行程仍存在、不同cookie context資料隔離、CRUD／預算／狀態、延遲載入、500保留表單、已提交但回應遺失時重試不重複、兩分頁版本衝突、401清除快照、初始化失敗恢復，以及使用者輸入以文字呈現。

獨立覆核另外重現「另一個分頁切換帳號後，舊分頁重試把新帳號行程顯示在舊姓名下」。已由後端回傳實際帳號標頭、前端在使用回應前核對並清除舊畫面修正。第11項瀏覽器回歸案例及獨立DOM觀察都確認不再出現錯誤帳號下的行程。

## 重跑

完整指令、相依套件與Apache隔離測試方法見 [tests/README.md](../tests/README.md)。

```bash
python3 tests/run_acceptance.py
```

runner自動建立臨時資料、啟動PHP、執行HTTP驗收、停止重啟確認資料、執行瀏覽器驗收，最後關閉伺服器與清理臨時資料。任一失敗會回非零退出碼。

僅檢查後端時：

```bash
python3 tests/run_acceptance.py --http-only
```

此模式明確略過瀏覽器，不宣稱完整驗收通過。GitHub Actions使用同一完整runner；遠端執行結果以該提交的Actions紀錄為準。

## 本次範圍外

註冊、Google／SMS登入、完整行程內容、協作、公開分享、住宿、票券與真實付款尚未串接新後端；先前唯讀報告中的這些模組問題不因此全部修正。沒有建立AWS資源。未聲稱其他瀏覽器、真實台鐵API或金流已測試。
