# Flight Price Notifier（機票降價通知）— 簡報大綱

> 主題：介紹 app 的功能與操作
> 建議長度：約 18 張投影片、20–25 分鐘（含 Demo）
> 語言：中文為主，產品名與畫面文字保留英文原樣
> 標示說明：**畫面** = 建議放的截圖／圖表；**備註** = 講者備註
> Demo 與截圖環境：正式站 `https://fare-finder-pro.vercel.app/`（已部署最新版程式碼）
> 截圖存放：`docs/ppt-screenshots/`（登入後的畫面待補拍；帳號 email 一律遮蔽）

---

## 第一部分：開場

### Slide 1 — 封面
- 標題：Flight Price Notifier　機票降價通知
- 副標：設定航線與目標價，機票降價就通知你
- 英文副標：Set a route and a target price — we email you when the fare drops.
- 講者姓名／日期
- **畫面**：`ppt-screenshots/01-landing-hero.png`（首頁 hero；右側有捲軸，介意的話改用 02 裁切上半）

### Slide 2 — 為什麼需要它？（問題）
- 出國買機票，價格天天變，要一直手動刷網站
- 很多人**不在意哪天飛，只在意預算**
- 錯過低價就是多花好幾千
- **備註**：用「你上次買機票是不是查了很多天？」開場

### Slide 3 — 產品一句話介紹
- 監控台北出發的熱門航線，最低價**低於你的目標價**就寄 email 通知
- 目標客群：預算導向、出發日彈性的旅客
- 月訂閱 NT$300，隨時可取消、沒有綁約

---

## 第二部分：功能介紹

### Slide 4 — 三大核心功能
- ✈️ **盯緊熱門航線**（Always-on route watching）：持續監控台北出發的東京、首爾、倫敦，自動抓最低票價
- 🔔 **達標自動通知**（Target-price email alerts）：低於目標價就寄 email，附立即訂購連結
- 🚫 **隨時取消**（Cancel anytime）：月訂閱制，不想用隨時停
- **畫面**：`ppt-screenshots/02-landing-full.png`（首頁全頁：hero、三張 feature card、頁尾）

### Slide 5 — 支援的航線
- 台北 ✈ 東京
- 台北 ✈ 首爾
- 台北 ✈ 倫敦（後來新增）
- 每條航線各自設定目標價、各自訂閱
- 票價以 TWD 為主，另附 USD 參考

### Slide 6 — 通知信長什麼樣
- 標題：`✈️ 台北 → 東京 降價通知！NT$6,610 已達標`（實際收到的信）
- 內容：NT$ 票價、約當 US$、你的目標價、**立即訂購**按鈕
- 避免洗版：同價 24 小時內不重寄；大幅降價（降 ≥20% 或 ≥NT$2,000）才會再通知
- **畫面**：`ppt-screenshots/12-alert-email.png`（實際通知信：NT$6,610、約 US$208、你的目標價 NT$10,000、紫色「立即訂購」按鈕）
- 注意：信件的按鈕是紫色，網站是青綠底＋紅色按鈕，兩者配色不一致，簡報放在一起時可以說明「信件樣式獨立」，或之後統一
- **備註**：強調「不會一直轟炸你」是設計出來的

### Slide 7 — 訂閱的生命週期
- 未付款 → **已訂閱（有效）** → **已取消（有效至 yyyy/mm/dd）** → 已結束
- 取消後，已付款的期間內**仍會收到通知**
- 已結束後可以「重新訂閱」
- 每個狀態都有對應的 email（訂閱成功、取消、續扣成功、扣款失敗、到期）
- **畫面**：狀態流程圖（4 個狀態＋箭頭）；訂閱成功信用 `ppt-screenshots/13-welcome-email.png`（「每月扣款 NT$300（信用卡定期定額），你可以隨時取消」、服務期間至 2026/10/21）；取消信用 `ppt-screenshots/15-cancel-email.png`（「已取消 台北 → 東京 的降價通知訂閱」：已停止之後的扣款、已付款期間內仍會收到通知直到 2026/10/21、隨時可以重新訂閱）

---

## 第三部分：操作示範（Demo）

### Slide 8 — 操作流程總覽
1. 註冊／登入
2. 在 Dashboard 選航線、輸入目標價
3. 到綠界（ECPay）付款
4. 回到 Dashboard，看到「已訂閱（有效）」
5. 等降價通知信
6. 需要時調整目標價或取消
- **畫面**：6 步驟橫向流程圖

### Slide 9 — Step 1：註冊與登入
- 進入 `/auth`，畫面標題「Welcome back．登入」
- 輸入 Email 與 Password，按 **Sign in / 登入**
- 沒有帳號：點「No account yet? Create one」切到註冊，收確認信後再登入
- 登入成功自動進入 Dashboard
- 未登入直接開 `/dashboard` 會被導回登入頁
- **畫面**：`ppt-screenshots/05-auth-signin.png`（登入）、`06-auth-signup.png`（註冊模式，標題「Create account．註冊」）

### Slide 10 — Step 2：選航線與設定目標價
- Dashboard 每條航線一張卡片
- 在「目標價 TWD」輸入預算（例如 10000）
- 按 **開始追蹤**
- 卡片上會顯示每條航線的「最後查詢」票價與時間，幫你判斷目標價設多少合理
- 輸入無效（空白、0、負數）會顯示錯誤提示
- 畫面上的「最後查詢」時間會隨排程更新（實測 19:30 → 20:00，正是每 30 分鐘一次）
- 欄位預設 placeholder 是 10000；尚未訂閱的航線按鈕都顯示「開始追蹤」
- **畫面**：`ppt-screenshots/03-dashboard-desktop.png`（桌面，兩欄卡片）、`07-dashboard-target-entered.png`（已輸入目標價、按下前）、`04-dashboard-mobile.png`（行動版，單欄，Slide 3 或 Q&A 談「手機也能用」時用）

### Slide 11 — Step 3：付款（綠界 ECPay 信用卡定期定額）
- 按下「開始追蹤」後跳轉到綠界收銀台
- 金額 NT$300，每 1 個月扣款 1 次
- 付款完成後自動導回 Dashboard，顯示「付款完成，訂閱正在生效中…」
- 卡片標籤變成 **已訂閱（有效）**，並收到訂閱成功信
- 付款失敗或中途離開：卡片顯示「未完成付款」，按 **完成付款** 重試
- **畫面**：
  - `ppt-screenshots/08-ecpay-cashier-top.png`：收銀台上半（訂單資訊、NT$300、定期定額 每 1 個月扣 1 次）；已裁掉卡片欄位，建議簡報用這張
  - `ppt-screenshots/09-ecpay-cashier-filled.png`：完整收銀台（含綠界 stage 公開測試卡資料），需要展示完整表單時才用
  - `ppt-screenshots/10-dashboard-payment-success.png`：付款完成提示＋東京卡片「已訂閱（有效）」、目前目標 NT$10,000
- **備註**：目前用綠界測試特店與測試卡，不會真的扣款
- **備註（已修正 2026-09-21）**：原本付款後綠界會導回未設定的 `SITE_URL`（預設 `http://localhost:8080`），從正式站付款會落到 localhost。現在 `flight-subscribe` 把下單網域寫進 ECPay `CustomField3`，`flight-ecpay-result` 驗過白名單後導回原站；已從 Vercel 站用 stage 商店實測，付款後落在 `https://fare-finder-pro.vercel.app/dashboard?purchase=success`。`SITE_URL` 已於同日設為 `https://fare-finder-pro.vercel.app`，作為 fallback 與 email 重新訂閱連結，正式網域確定後要改成正式網域

### Slide 12 — Step 4：管理訂閱
- **調整目標價**：直接改數字、按「更新目標價」，不用重新付款
- **取消訂閱**：按「取消訂閱」→ 確認「確定取消 / 保留」
  - 取消後標籤變成「已取消 · 有效至 yyyy/mm/dd」，到期前照樣收通知
- **重新訂閱**：狀態為「已結束」時按「重新訂閱」
- **畫面**：`ppt-screenshots/11-cancel-confirm.png`（「確定要取消訂閱？已付款的期間內仍會收到通知。」＋「確定取消／保留」兩顆按鈕；只拍確認畫面，未真的取消）
- `ppt-screenshots/14-dashboard-cancelled.png`：取消後的東京卡片，標籤「已取消 · 有效至 2026/10/21」，「取消訂閱」連結消失，但目標價與「更新目標價」仍可操作（服務照常到期為止）
- 注意：標籤是紅字＋深色底，對比偏低；簡報上建議裁切放大，或旁邊加文字說明
- 取消後寄出的信見 Slide 7 的 `15-cancel-email.png`

### Slide 13 — Demo 時間
- 現場示範：登入 → 設定目標價 → 付款 → 已訂閱 → 收信
- **備註（Demo 清單）**：
  - Demo 用正式站，事先備好一個已驗證的帳號，避免現場等確認信
  - 付款走綠界測試特店，現場不會真的扣款；但會在該帳號留下一筆訂閱，Demo 完要記得取消
  - 準備好綠界測試卡
  - 通知信不一定能現場觸發（要等價格達標），請準備一張事先收到的信的截圖當備案

---

## 第四部分：背後怎麼運作

### Slide 14 — 系統架構
- **前端**：TanStack Start（React 19）＋ Tailwind ＋ shadcn/ui，用 Lovable 建置
- **後端**：Supabase（Postgres ＋ Edge Functions），沒有自己的伺服器
- **付款**：綠界 ECPay 信用卡定期定額
- **寄信**：Resend
- **票價來源**：Travelpayouts
- **部署**：Vercel
- **畫面**：架構方塊圖（瀏覽器 → Supabase → ECPay／Resend／Travelpayouts）

### Slide 15 — 降價通知的資料流程
1. 排程（pg_cron）**每 30 分鐘**觸發抓價函式
2. 抓每條航線的最低票價，更新「最後查詢」
3. 比對「有付費資格」的訂閱者的目標價
4. 通知函式去重（避免重複寄）
5. 透過 Resend 寄出降價通知
- **畫面**：時序圖或流水線圖
- **備註**：「有付費資格」= 已訂閱，或已取消但還在已付款期間內
- **實測時間軸（可當作 Demo 證據）**：2026-09-21 21:28 付款完成 → 收到訂閱成功信；21:30 排程跑完 → 收到達標通知信。付款後 2 分鐘內就收到降價通知

### Slide 16 — 付款與訂閱狀態怎麼保持正確
- 只有**通過檢核碼驗證**的綠界回呼，才能把訂閱改成「有效」
- 瀏覽器端**沒有**寫入訂閱狀態的權限，使用者無法自己改成已付費
- 首期扣款、每月續扣、扣款失敗，各有對應的回呼處理
- 到期未續扣超過寬限期（7 天）自動轉為「已結束」並通知
- 取消時先通知綠界停止扣款，成功才改本地狀態

---

## 第五部分：品質與收尾

### Slide 17 — 測試結果
- 測試計畫 91 個用例，**88 通過、3 部分驗證、0 失敗**
- 涵蓋：前端與登入、抓價比對、寄信去重、ECPay 付費牆、資料庫與安全
- 包含綠界排程**真實續扣**的驗證
- 測試中發現並修正 6 個缺陷
- 尚有已知問題與上線前待辦（見 `docs/test-report.md` 第 6、7 章）
- **備註**：數字取自 2026-09-21 的測試報告；簡報前請再確認是否有更新

### Slide 18 — 未來規劃與 Q&A
- 改用**正式**綠界特店上線（目前是測試特店）
- 註冊確認信的送達率（曾進垃圾郵件）持續改善
- 更嚴謹的跨 app 存取控制（backlog B-1）
- 更多出發地／航線
- 謝謝！Q&A

---

## 附錄（備用投影片，Q&A 時用）

### A1 — 多 app 共用同一個 Supabase 專案
- 這個 Supabase 專案的登入帳號同時給其他 app 使用
- 用 `app_metadata.apps` 標記「這個帳號屬於哪些 app」
- 只有明確註冊過的帳號才能登入本 app，登入頁不會自動加入
- 該標記是使用者自行宣告的，僅作為畫面路由守衛，**不是權限**；資料權限一律由資料庫 RLS 控管

### A2 — 資料表與 Edge Functions 一覽
- 資料表（schema `flight`）：`routes`、`subscriptions`、`notification_history`
- Edge Functions：`flight-subscribe`、`flight-cancel-subscription`、`flight-ecpay-return`、`flight-ecpay-period`、`flight-ecpay-result`、`flight-parser`、`flight-notification`、`flight-status-notification`、`send-email`

### A3 — 開發里程碑
- **M1**：免費通知器（訂閱 → 定時抓價 → 去重寄信）
- **M2**：綠界定期定額付費牆
- **M2 後續**：三種生命週期信件、取消修正、trigger 加固
- **M3**：上線前準備（正式特店、網域與寄信）

---

## 待補截圖
- 本次要補的截圖已全部完成：降價通知信 `12-alert-email.png`、訂閱成功信 `13-welcome-email.png`、已取消標籤 `14-dashboard-cancelled.png`、取消信 `15-cancel-email.png`
- 仍未截到、簡報以文字帶過的：到期（已結束）信、扣款失敗信、續扣成功信、「重新訂閱」按鈕畫面（需要等到期或製造失敗，成本高，非必要）
- 注意：東京訂閱已取消，但**服務期間到 2026/10/21 為止**，期間內達標仍會收到通知信（設計如此，不是錯誤）

## 製作提醒
- 風格：深青綠底、紅色強調（取自正式站實際畫面），簡報配色與 app 一致
- 截圖建議：用正式站截；登入頁要截乾淨的（欄位留空），Dashboard 上的 email 請遮蔽
- 不要放任何金鑰、Supabase project 內部識別碼或真實訂單編號
