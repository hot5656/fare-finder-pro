# Flight Price Notifier（機票降價通知）— 系統全功能簡報大綱 v1.1

> 主題：介紹本 app 的**全部功能與操作**：使用者端（免費與付費兩種模式）、管理員後台、系統運作
> 對象：專案成員、合作夥伴、技術審查者（比 v1.1 使用者版多了付款、Admin 與架構）
> 建議長度：約 26 張投影片、30–35 分鐘（含 Demo）
> 語言：中文為主，畫面上的英文字保留原樣
> 標示說明：**畫面** = 建議放的截圖；**備註** = 講者備註；**〔沿用 v1.1 user〕** = 內容直接取自 `docs/ppt-outline_1.1_user.md`
> 相關檔案（本檔不取代它們）：
> - v1.0 大綱（付費流程＋技術）：`docs/ppt-outline.md` → `docs/flight-price-notifier_v1.0_2026_0921.pptx`
> - v1.1 使用者版（只有免費訂閱）：`docs/ppt-outline_1.1_user.md` → `docs/flight-price-notifier_v1.1_user_2026_0926.pptx`
> 預定成品：`docs/flight-price-notifier_v1.1_system_2026_0926.pptx`

---

## 第一部分：開場

### Slide 1 — 封面 〔沿用 v1.1 user〕
- 標題：Flight Price Notifier　機票降價通知
- 副標：設定航線與目標價，機票降價就通知你（系統全功能介紹 v1.1）
- 網址：**https://flights.roberthut.com/**
- 講者姓名／日期
- **畫面**：`16-landing-hero.png`

### Slide 2 — 你是不是也這樣買機票？ 〔沿用 v1.1 user〕
- 機票價格天天變，要一直手動刷網站
- 其實**不在意哪天飛，只在意預算**
- 一不注意就錯過低價，多花好幾千

### Slide 3 — 一句話介紹與今天的範圍
- 幫你盯著熱門航線，**來回最低價低於你的目標價**，就寄 email 通知你
- 兩種訂閱模式，由管理員一鍵切換：
  - **免費模式**（目前上線中）：一次一個月，到期可無限次免費續訂
  - **付費模式**：綠界信用卡定期定額 NT$300／月，隨時取消
- 今天的四段：使用者功能 → 使用者操作 → 管理員後台 → 系統運作與品質

---

## 第二部分：使用者功能

### Slide 4 — 三大功能 〔沿用 v1.1 user〕
- ✈️ **盯緊熱門航線**：自動查詢熱門航線的來回最低票價
- 🔔 **達標自動通知**：低於目標價就寄 email，附「立即訂購」連結
- 🚫 **隨時取消**：不想收了，一鍵取消
- **畫面**：`17-landing-full.png`

### Slide 5 — 可以追蹤哪些航線 〔沿用 v1.1 user，補充 Admin 新增〕
- 目前 4 條：台北 ✈ 東京、台北 ✈ 首爾、台北 ✈ 倫敦、東京 ✈ 紐約
- 航線由管理員從後台新增（見 Slide 19），不用改程式
- 每條航線各自設定目標價、各自訂閱；票價以**來回、新台幣**計算，附約當美金
- 卡片顯示「最後查詢（來回）」價格與時間，約**每 30 分鐘**更新
- **新（v1.1）**：某航線一段時間查不到新票價時，卡片顯示「目前暫無最新票價，系統仍會持續查詢。」
- **畫面**：`24-dashboard-free-desktop.png`、`33-dashboard-stale-fare.png`（倫敦卡片「目前暫無最新票價」＋「上次查到（來回）」）

### Slide 6 — 降價通知信 〔沿用 v1.1 user〕
- 主旨：`✈️ 台北 → 東京 降價通知！NT$6,938 已達標`
- 內容：最低價 NT$／約 US$、你的目標價、航空公司與航班、去回程時間、日期提醒、**立即訂購**按鈕
- 防洗版：仍低於目標價時**約 24 小時一封**；大幅再降（≥20% 或 ≥NT$2,000）提早通知
- 不想每天收到：把目標價調低到真正想買的價格
- **畫面**：`29-email-alert.png`

### Slide 7 — 兩種訂閱模式比較（新）
| | 免費模式 | 付費模式（綠界） |
|---|---|---|
| 開始方式 | 按「開始免費追蹤（一個月）」立即生效 | 按「開始追蹤」→ 綠界收銀台付款 |
| 費用 | 免費 | NT$300／月，信用卡定期定額 |
| 期間 | 一個月，到期自動結束 | 每月自動續扣 |
| 取消 | **立即**停止通知 | 停止之後的扣款，**已付款期間內仍通知** |
| 到期後 | 「免費重新訂閱」，次數不限 | 「重新訂閱」，重新付款 |
| 卡片標籤 | 免費 · 有效至 yyyy/mm/dd | 已訂閱（有效）／已取消 · 有效至 yyyy/mm/dd |
- 切回付費模式時，既有免費訂閱保留到各自到期日
- **備註**：目前綠界用的是測試特店，不會真的扣款

### Slide 8 — 訂閱狀態流程
- 免費：尚未訂閱 → 免費 · 有效中 →（到期或取消）→ 已結束 → 免費重新訂閱
- 付費：未完成付款 → 已訂閱（有效）→ 已取消（有效至到期日）→ 已結束
  - 續扣失敗：寄扣款失敗信；超過到期日 7 天寬限期仍未續扣 → 已結束
- **畫面**：雙泳道狀態圖；旁放 `27-dashboard-free-subscribed.png`、`31-dashboard-free-ended.png`、`14-dashboard-cancelled.png` 的卡片裁切

### Slide 9 — 你會收到哪些信（兩種模式合併）
| 時機 | 免費模式 | 付費模式 |
|---|---|---|
| 訂閱成功 | ✅ `28-email-free-welcome.png` | ✅ `13-welcome-email.png` |
| 價格達標 | ✅ `29-email-alert.png` | ✅ 同左 |
| 主動取消 | ✅ `32-email-free-cancel.png` | ✅ `15-cancel-email.png` |
| 每月續扣成功 | — | ✅（文字帶過） |
| 扣款失敗 | — | ✅（文字帶過） |
| 到期結束 | ✅（文字帶過，附重新訂閱連結） | ✅（文字帶過） |
- 另有帳號信：註冊確認信（`22-email-signup.png`）、重設密碼信

---

## 第三部分：使用者操作

### Slide 10 — 操作流程總覽
1. 註冊（只要 email）→ 從信中連結設定密碼
2. 登入 Dashboard
3. 選航線、輸入目標價，開始追蹤（免費立即生效／付費到綠界付款）
4. 等降價通知信
5. 調整目標價、取消、重新訂閱
- **畫面**：5 步驟流程圖，第 3 步分岔「免費／付費」

### Slide 11 — Step 1：註冊與設定密碼 〔沿用 v1.1 user〕
- 右上角「Sign in / 登入」→「No account yet? Create one」
- **只需輸入 Email** →「Send sign-up link / 寄送註冊連結」→ 信中連結 →「Set your password．設定密碼」
- 同一帳號系統的其他服務註冊過的 email，會收到重設密碼信，設定後即可使用本服務
- **畫面**：`20-auth-signup.png` → `22-email-signup.png` → `23-auth-set-password.png`

### Slide 12 — Step 2：登入、忘記密碼、登出 〔沿用 v1.1 user〕
- 「Welcome back．登入」輸入 Email、Password
- 未登入開 Dashboard 會被帶回登入頁
- 「Forgot password? 忘記密碼？」→ 寄送重設連結 → 設定新密碼
- **畫面**：`18-auth-signin.png`、`19-auth-forgot.png`

### Slide 13 — Step 3a：免費模式開始追蹤 〔沿用 v1.1 user〕
- 輸入「來回目標價 TWD」→「開始免費追蹤（一個月）」→ 標籤「免費 · 有效至 …」＋訂閱成功信
- 無效輸入（空白、0、負數）顯示「請輸入有效的目標價」
- **畫面**：`26-dashboard-free-target-entered.png` → `27-dashboard-free-subscribed.png`；`25-dashboard-free-mobile.png`

### Slide 14 — Step 3b：付費模式開始追蹤（綠界）〔取自 v1.0〕
- 按「開始追蹤」→ 綠界收銀台：NT$300，每 1 個月扣款 1 次
- 付款完成自動導回 Dashboard，顯示「付款完成，訂閱正在生效中…」→ 標籤「已訂閱（有效）」
- 付款失敗或中途離開：標籤「未完成付款」，按「完成付款」重試
- **畫面**：`08-ecpay-cashier-top.png`、`10-dashboard-payment-success.png`
- **備註**：`10` 是舊網址（fare-finder-pro.vercel.app）時拍的，網址列要裁掉，或在 flights.roberthut.com 付費模式下重拍

### Slide 15 — Step 4：管理訂閱
- **調整目標價**：改數字 →「更新目標價」，立即生效（付費模式不用重新付款）
- **取消訂閱**：
  - 免費：「確定要取消訂閱？取消後立即停止通知。」（`30-dashboard-free-cancel-confirm.png`）
  - 付費：「確定要取消訂閱？已付款的期間內仍會收到通知。」（`11-cancel-confirm.png`）
- **重新訂閱**：已結束後按「免費重新訂閱」／「重新訂閱」（`31-dashboard-free-ended.png`）

### Slide 16 — Demo（使用者端）
- 現場示範：登入 → 開始免費追蹤 → 收到訂閱成功信 → 調整目標價 → 取消
- **備註（Demo 清單）**：事先準備已設定密碼的帳號；通知信備好截圖當備案；Demo 完取消訂閱

---

## 第四部分：管理員後台（/admin）

### Slide 17 — 誰看得到後台
- 只有管理員帳號的 Dashboard 右上角會出現「Admin」按鈕
- 按鈕只是入口；後台資料由資料庫權限（`flight.is_admin()` + RLS）把關，一般帳號直接輸入網址也讀不到
- 後台分頁：總覽、航線、所有訂閱、註冊用戶、通知紀錄、查價紀錄
- **畫面**：`34-dashboard-admin-button.png`（Dashboard 右上角 Admin 按鈕）

### Slide 18 — 總覽 Overview 與設定 Settings
- 統計卡片：有效訂閱、預估月營收 MRR、總訂閱數、付款失敗，以及各狀態（PENDING_PAYMENT／ACTIVE／CANCELLED／EXPIRED）筆數
- 查價健康橫幅：最近一次查價有異常、超過 65 分鐘沒有查價（排程可能停了）、查價卡在執行中；可點「查看查價紀錄 →」
- 同一頁下方有「航線最新價格」表（各航線最新價格與檢查時間）
- 設定開關（也在總覽頁）：
  - **使用綠界付款 / Require ECPay payment**：開＝付費模式；關＝免費模式（Slide 7）
  - **價格對照 / v1 price comparison**：通知信是否附另一個票價來源的對照區塊
  - **測試：強制到期 / Testing: force expire**：僅供測試，開啟後可把已取消的訂閱立即到期
- **畫面**：`35-admin-overview.png`（橫幅＋統計卡片）、`36-admin-settings.png`（三個開關＋航線最新價格）

### Slide 19 — 航線管理 Routes
- 「新增航線 Add route」：輸入中文城市名（例如「台北」「大阪」）或三碼代碼（例如 OSA）
- 「查詢價格」：系統即時查下個月的來回最低價並顯示辨識結果，**查得到價格才可新增**
- 「確認新增」後使用者 Dashboard 立即看到新航線
- 只能切換「啟用 Active」；航線名稱取自辨識結果，與代碼一樣建立後不可修改
  - 停用：不再開放新訂閱，只對仍持有訂閱的使用者顯示；付費中的訂閱照常通知到到期
- 機場代碼建立後不可修改；代碼錯誤請停用後重新新增
- **畫面**：`37-admin-routes-add.png`（台北 → 大阪：TPE／OSA、2026-10 來回最低 NT$6,992，未按確認新增）、`38-admin-routes-list.png`

### Slide 20 — 所有訂閱、註冊用戶、手動發送
- **所有訂閱**：搜尋 email 或航線；看狀態、付款方式（免費／綠界）、到期日、扣款失敗時間、成功扣款次數
  - **手動發送**：目前已達標的訂閱可按「手動發送」→「確定發送？」立即寄通知信（紀錄標記為 admin 手動觸發）
  - **強制到期**：測試開關開啟時，已取消的訂閱可立即改為已結束並寄到期信
- **註冊用戶**：本 app 的使用者清單（搜尋 email；註冊時間、email 驗證時間、最後登入、訂閱數、付費中數；管理員帳號有 Admin 標籤）
- **畫面**：`39-admin-subscriptions.png`、`40-admin-users.png`

### Slide 21 — 通知紀錄與查價紀錄
- **通知紀錄 Notification history**：每封降價通知的時間、航線、價格，區分「自動 Auto／手動 Manual」
- **查價紀錄 Price checks**：每 30 分鐘一次的自動查價，保留 90 天
  - 狀態、耗時、API 呼叫次數、異常（429 = 被票價來源限流；某航線查無票價）
  - 「只看異常 Problems only」快速篩選
- **畫面**：`41-admin-notifications.png`、`42-admin-runs.png`（只看異常：倫敦查無票價的 warning，正好對應 Slide 5 的提示）

---

## 第五部分：系統怎麼運作

### Slide 22 — 系統架構 〔取自 v1.0，補網域〕
- 前端：TanStack Start（React 19）＋ Tailwind ＋ shadcn/ui，Vercel 部署於 flights.roberthut.com
- 後端：Supabase（Postgres schema `flight` ＋ Edge Functions），沒有自己的伺服器
- 外部服務：綠界 ECPay（付款）、Resend（寄信）、Travelpayouts（票價來源）
- **畫面**：架構方塊圖（瀏覽器 → Supabase → ECPay／Resend／Travelpayouts）

### Slide 23 — 降價通知資料流程 〔取自 v1.0，補查價紀錄〕
1. pg_cron **每 30 分鐘**觸發查價
2. 先處理到期（已取消過期、付費逾寬限期、免費到期）並寄信
3. 查每條航線的最低票價，更新「最後查詢」
4. 只比對**有效**訂閱（付費已付款期間內、或免費有效期內）的目標價
5. 通知函式去重後透過 Resend 寄出
6. 每次查價寫一筆「查價紀錄」給管理員看
- **畫面**：流水線圖

### Slide 24 — 付款與資料安全
- 只有通過檢核碼驗證的綠界回呼才能把訂閱改成「有效」；測試模擬付款不會啟用
- 瀏覽器端沒有寫入訂閱的權限，所有寫入都經過伺服器函式
- 取消時先通知綠界停止扣款，成功才改本地狀態
- 共用登入系統：本 app 帳號與其他服務共用同一個帳號系統，登入頁只接受已註冊本 app 的帳號；資料一律以使用者本人為範圍（RLS）

---

## 第六部分：品質與收尾

### Slide 25 — 測試結果 〔取自 v1.0，更新到 09-25〕
- 測試計畫 92 個用例：**90 通過、2 部分驗證、0 失敗**（含綠界排程真實續扣；不含 8.8、8.9）
- 免費模式開關 10 項全數通過（2026-09-24，P10 於 09-26 補測）
- 2026-09-25 新網域實測註冊與付款，找到並修正 email 含 `+` 無法啟用的問題
- **備註**：數字取自 `docs/test-report.md`，製作前再確認一次

### Slide 26 — 未來規劃、Q&A 與聯絡
- 改用正式綠界特店、決定何時從免費模式切回付費
- 更多出發地與航線（歡迎來信提需求）
- 更嚴謹的跨 app 存取控制（backlog B-1）
- Q&A 備用題：沿用 v1.1 user Slide 14 的常見問題
- 立即試用：**https://flights.roberthut.com/**（QR code）
- 聯絡：Robert　📧 robertkao5656@gmail.com

---

## 截圖清單

### 直接沿用（已存在於 `docs/ppt-screenshots/`）
| 檔案 | 來源 | 用於 |
|---|---|---|
| `16`–`32` | v1.1 user（flights.roberthut.com，免費模式，2026-09-25） | Slide 1、4–6、8、9、11–13、15 |
| `08-ecpay-cashier-top.png` | v1.0（綠界收銀台，網址與網域無關） | Slide 14 |
| `10-dashboard-payment-success.png`、`11-cancel-confirm.png`、`14-dashboard-cancelled.png` | v1.0（**舊網址**，裁掉網址列或重拍） | Slide 8、14、15 |
| `13-welcome-email.png`、`15-cancel-email.png` | v1.0（付費版信件） | Slide 9 |

- 不使用：`01`–`07`（舊首頁、舊註冊頁）、`09`（完整測試卡表單）、`12`（已被 `29` 取代）

### 新拍（2026-09-26 於 flights.roberthut.com，管理員帳號；email 已替換為 demo@／user1–8@example.com）
| 檔案 | 內容 | 用於 |
|---|---|---|
| `33-dashboard-stale-fare.png` | 卡片「目前暫無最新票價」提示 | Slide 5 |
| `34-dashboard-admin-button.png` | 管理員 Dashboard 右上角 Admin 按鈕 | Slide 17 |
| `35-admin-overview.png` | 總覽統計卡片＋查價健康橫幅 | Slide 18 |
| `36-admin-settings.png` | 三個設定開關 | Slide 18 |
| `37-admin-routes-add.png` | 新增航線：查詢價格後的辨識結果 | Slide 19 |
| `38-admin-routes-list.png` | 航線列表（啟用開關；部署後重拍，舊圖有「編輯名稱」） | Slide 19 |
| `39-admin-subscriptions.png` | 所有訂閱（含手動發送按鈕） | Slide 20 |
| `40-admin-users.png` | 註冊用戶 | Slide 20 |
| `41-admin-notifications.png` | 通知紀錄（自動／手動） | Slide 21 |
| `42-admin-runs.png` | 查價紀錄（只看異常） | Slide 21 |

## 製作提醒
- 成品另存 `docs/flight-price-notifier_v1.1_system_2026_0926.pptx`，**不覆蓋** v1.0 與 v1.1 user 的 pptx、大綱與截圖；產生器沿用 `docs/deck/build.js` 時另開 `build-system.js`（或加參數），不要改掉 user 版的輸出
- 截圖用 localhost:8080 或正式站皆可，Admin 頁的 email 一律遮成 `demo@example.com`；不放訂單編號、金鑰、Supabase 專案識別碼
- 付費模式截圖若要在正式站重拍，需暫時開啟「使用綠界付款」，拍完記得切回免費模式並取消測試訂閱
- 風格沿用 v1.1 user：深青綠底、紅色強調
