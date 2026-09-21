# Flight Price Notifier 測試報告（Test Report）

報告日期：2026-09-21
對應測試計畫：`docs/test-plan.md`
資料來源：`docs/m1-session-handoff.md`（各次測試的實測記錄）、`.claude/skills/*-checklist`、
`no_1` ～ `no_5` 匯出的 session 記錄、`src/` 與 `supabase/` 程式碼。

> **本報告主要彙整既有測試記錄；另於 2026-09-21 補測了 20 個原本沒有記錄的用例**（91 個用例至此全部有執行記錄）
> （在 `https://fare-finder-pro.vercel.app/` 與 Supabase Edge Functions 上執行，見 4.6 與第 2 章最後一列）。
> 其餘每一項結果都對應 handoff 文件中已記錄的證據；沒有記錄的項目一律標為「未執行」，
> 不推測、不補寫結果。

---

## 1. 摘要

| 項目 | 結果 |
|---|---|
| 受測版本 | M1（免費通知器）＋ M2（ECPay 付費牆）＋ M2 後續（三種生命週期 email、取消修正、trigger 加固） |
| 測試期間 | 2026-09-18（M1 驗收）～ 2026-09-21（補測至 91 個用例全部有記錄） |
| 測試環境 | `localhost:8080` ＋ 共用 Supabase 專案 `luugfvsrawnuzwpjvddt` ＋ ECPay **stage**（特店 `3002607`） |
| 測試計畫用例數 | 91 |
| ✅ 通過 | **88** |
| 🟡 部分驗證（僅程式碼審查或缺少一環） | **3** |
| ⬜ 未執行（無測試記錄） | **0** |
| ❌ 最終失敗 | **0** |
| 測試中發現並已修正的缺陷 | 6 項（見第 5 章） |
| 開放中的已知問題 | 8 項（見第 6 章；K-3 已於 2026-09-21 處理） |

**結論：M1 與 M2 的後端功能與安全性驗收通過**（M2 checklist 21／21，含 ECPay 排程真實續扣 B4）；
阻擋項 F（使用者不能自我啟用付費）通過。
2026-09-21 補測後，**沒有任何用例失敗，也沒有用例缺少執行記錄**；仍有 3 項只驗到一部分（🟡，見第 7 章）。
補測同時找到幾個**需要決定或處理的問題**（K-6～K-9，見第 6 章），最值得注意的是：**註冊確認信會進垃圾郵件**（K-6，已改善：範本改版部署後，在另一個信箱進了收件匣；建議再加 DMARC 並持續觀察）、
**註冊時「密碼相符」即自動補標記（不需驗證信箱）與文件描述不一致**（K-3，已由實測確認，並已於 2026-09-21 把文件改成描述實際行為）。
此外尚未使用正式 ECPay 特店，因此**可進入 M3 的後端條件已具備，但上線前仍需處理第 6、7 章所列項目**。

---

## 2. 測試執行紀錄

| 日期（本地／UTC） | 測試內容 | 結果 |
|---|---|---|
| 2026-09-18 | M1 完整驗收：訂閱 UI、每 30 分鐘排程、去重、大幅降價重寄；修正 `nextMonth()` | 通過（H3 僅程式碼審查） |
| 2026-09-19 04:16Z | H5：Seoul 測試訂閱（目標 4,000 ＜ 現價 5,127）→ 未被比對、未寄信；測試列已刪 | 通過 |
| 2026-09-19 | M2 建置後逐項驗證：cashier 接受表單、真實 stage 付款、回呼、302、取消、寬限、expired | 通過 |
| 2026-09-19 晚 | M2 checklist 完整跑一輪（21 項）；B4 當時 ⚠️（隔天才能驗） | 20／21，B4 待次日 |
| 2026-09-19 ~22:50 | Seoul／London 結帳補測；parser `{"routes":3,"matches":2}` | 通過 |
| 2026-09-19 23:57:11Z | **B4：ECPay 排程真實送出第 2 期扣款回呼**，`TotalSuccessTimes=2` | 通過 → M2 21／21 |
| 2026-09-19 | 後續：`expired`、`payment_failed` email；`payment_failed_at` 一次性旗標 | 通過 |
| 2026-09-20 | 後續：`renewed` email（每期只寄一次）、`total_success_times` migration；使用者於信箱確認兩封信 | 通過 |
| 2026-09-20 05:06–05:10Z | 取消已被 ECPay 終止的訂單：修正前 502，修正部署後通過 | 通過 |
| 2026-09-20 | trigger 加固 migration 套用；rollback-only 驗證 trigger 仍會觸發 | 通過（DB-04 當時未做，2026-09-21 由真實註冊補上，見 4.4） |
| 2026-09-20 | dashboard：label `htmlFor`／`id`、按鈕游標與 hover／busy 樣式，於瀏覽器確認 | 通過 |
| 2026-09-21 | **補測（本報告新增）**：Vercel 站台未登入前端（FE-01／02／03／05／10）、bundle 機密掃描（SEC-07）、公開金鑰打 service-role 函式（SEC-02）、`flight-subscribe` 無效身分（A4）、自簽回呼 MerchantID 不符（B6） | 通過 |
| 2026-09-21（稍後） | **補測（登入相關）**：使用者於 chrome-devtools 視窗自行登入（`k***@gmail.com`，帶 `fare-finder-pro` 標記）後：dashboard 行動版（FE-02 剩餘）、非法 `target_price`（A5）、登出與路由守衛（FE-12）；FE-04 於 Vercel 站台再確認 | 通過；FE-06 首次嘗試因帳號已帶標記而無效（見下一列） |
| 2026-09-21（再稍後） | **FE-06 重測**：先以唯讀 SQL 確認 `pm3.demo@example.com` 的 `apps` 只有 `project-management`、從未登入過，再由使用者自行輸入密碼登入 | 通過 |
| 2026-09-21 07:12–07:52Z | **註冊／重設／金流負面案例補測**：建立一次性測試帳號 `k***+fe07a@gmail.com`（id `8b7871c2-…`）。07:12 FE-07 註冊；07:26 使用者點確認信連結（FE-11）；07:40–07:41 G5／G6／C3（自簽回呼）；07:45 E6（測試帳號 JWT 呼叫取消）；07:47 FE-09（錯誤密碼註冊）；07:49 使用者點重設連結並設新密碼（FE-09／FE-11）；07:51 FE-08（密碼相符註冊）。寫入資料庫的動作（測試列、去除標記）皆由使用者以 `supabase db query` 執行 | 全部通過；發現 K-6～K-9 |

---

## 3. 結果彙總（依測試計畫章節）

| 章節 | 用例數 | ✅ | 🟡 | ⬜ | ❌ |
|---|---:|---:|---:|---:|---:|
| 6 前端與登入（FE） | 12 | 12 | 0 | 0 | 0 |
| 7 M1（A–L） | 28 | 27 | 1 | 0 | 0 |
| 8 M2（A–G） | 38 | 38 | 0 | 0 | 0 |
| 9 資料庫與 auth trigger（DB） | 5 | 5 | 0 | 0 | 0 |
| 10 安全（SEC） | 8 | 6 | 2 | 0 | 0 |
| **合計** | **91** | **88** | **3** | **0** | **0** |

圖例：✅ 有實測證據　🟡 僅程式碼審查或只驗證一部分　⬜ 沒有測試記錄

---

## 4. 詳細結果

### 4.1 前端與登入（計畫第 6 章）

| ID | 結果 | 說明 |
|---|:-:|---|
| FE-04 已標記帳號登入 → dashboard | ✅ | M1／M2 全程以此登入使用；2026-09-21 於 Vercel 站台再確認：登入後進入 `/dashboard`，顯示 "Signed in as k***@gmail.com"，console 無訊息；該帳號 `app_metadata.apps` 含 `fare-finder-pro`、`project-management`、`udemy-coupon` |
| FE-01 首頁內容 | ✅ | 2026-09-21 Vercel 站台：產品名、中英文標語、右上角與 Hero 的 Sign in / 登入、三張功能卡、頁尾皆在；console 無訊息 |
| FE-02 行動版 | ✅ | 390×844 mobile 模擬，首頁、`/auth`、`/dashboard` 皆無水平捲軸（dashboard 無任何元素超出視窗寬度，三張航線卡片直向排列、按鈕與輸入框未被截斷）；首頁第三張卡片一開始 opacity 0，捲到後變 1（捲動淡入動畫，非缺陷） |
| FE-03 `/auth` 登入模式 | ✅ | 標題 "Welcome back．登入"、副標、Email placeholder `you@example.com`、密碼欄（password 型別）、"No account yet? Create one" 皆正確 |
| FE-05 密碼錯誤登入 | ✅ | 假帳號 `no-such-user-fe05@example.com`：`token?grant_type=password` 回 400，畫面顯示 "Invalid login credentials"，停留 `/auth` |
| FE-10 未登入開 `/dashboard` | ✅ | 導向 `/auth` |
| FE-12 登出 | ✅ | 2026-09-21：按 Sign out / 登出 → `POST /auth/v1/logout?scope=global` 回 204、session 從 localStorage 清除、導向首頁 `/`（符合 `handleSignOut` 的 `navigate({ to: "/" })`；原測試計畫寫成 `/auth`，已更正計畫）；再開 `/dashboard` → 導向 `/auth` |
| FE-06 未標記帳號被拒 | ✅ | **重測通過（第二次嘗試）**。2026-09-21 07:01Z，使用者自行輸入密碼，以 `pm3.demo@example.com`（`project-management` 示範帳號，事前以唯讀 SQL 確認 `apps = ["project-management"]`、`user_metadata.app` 為空、信箱已驗證、從未登入）登入：`token?grant_type=password` 回 **200**（密碼正確）、回應 `apps = ["project-management"]`（不含 `fare-finder-pro`）→ 約 0.36 秒後前端呼叫 `logout?scope=global` 回 204 → 畫面顯示 "Invalid login credentials"、停在 `/auth`、localStorage 無 session、未進 `/dashboard`。**事後資料庫查詢**：`apps` 仍為 `["project-management"]`、`user_metadata.app` 仍為空，證明登入頁沒有自動補標記（符合嚴格隔離）。首次嘗試（06:51Z，`pm.demo@example.com`）因該帳號已帶標記而無效，見 4.6 |
| FE-07 全新 email 註冊 | ✅ | 2026-09-21 07:12Z，用 `k***+fe07a@gmail.com`：`signup?redirect_to=https://fare-finder-pro.vercel.app` 回 200、`hasSession: false`；請求 body 帶 `data: {app: "fare-finder-pro"}`；畫面顯示 "Check your email to confirm your account…" 並切回登入模式；資料庫：帳號建立、`apps = ["fare-finder-pro"]`、`email_confirmed_at` 為空（等待驗證）。`send-email` hook 回 200。**確認信實際進了垃圾郵件匣**（見 K-6） |
| FE-08 既有 email、密碼相符 | ✅ | 2026-09-21 07:51Z，帳號事前以 SQL 去除標記，用**正確密碼**走註冊流程：`signup` 回 200（`identities: 0`，obfuscated）→ 隨即以該密碼 `token?grant_type=password` 回 200 → `PUT /user` 送 `data: {app: "fare-finder-pro"}` 回 200 → `refresh_token` 換發後 `apps = ["fare-finder-pro"]` → 進入 `/dashboard`；資料庫確認標記已補上。**行為**：密碼相符時**不需驗證信箱**即自動補標記並登入，與 `docs/shared-supabase-auth.md`／README 原本「只走重設流程」的描述不一致（兩份文件已於 2026-09-21 改成描述實際行為），見 K-3 |
| FE-09 既有 email、密碼不符 | ✅ | 2026-09-21 07:47Z，帳號事前去除標記，用**錯誤密碼**走註冊流程：`signup` 200（`identities: 0`、無 session、`apps` null）→ `token` 400 `invalid_credentials` → `recover?redirect_to=…/auth/reset` 200；畫面顯示「此 email 已有帳號。我們已寄送一封密碼重設信…」並切回登入模式；沒有 session；資料庫 `apps` 仍為空。07:49:19Z 使用者點重設連結、`/auth/reset` 出現設定密碼表單；07:49:26Z 設好新密碼後 `apps` 才變成 `["fare-finder-pro"]`；舊密碼登入 400、新密碼 200。重設流程為 implicit（storage 無 code verifier），連結可在任何瀏覽器開啟 |
| FE-11 驗證信／重設信連結導向 | ✅ | 註冊確認連結：使用者於 07:26:45Z 點擊，最終網址 `https://fare-finder-pro.vercel.app/#`（token 已被 supabase-js 從網址列清除），無 `otp_expired`／`access_denied`，帳號變為已驗證且已登入。重設連結：導向 `https://fare-finder-pro.vercel.app/auth/reset`，可完成密碼設定並自動登入。**兩者導向皆通過；但確認信進垃圾郵件**（K-6）。重設信的所在資料夾未記錄 |

**另外已於瀏覽器確認的前端項目**（不在計畫編號內，來自 handoff）：

| 項目 | 結果 | 證據 |
|---|:-:|---|
| 訂閱表單寫入（M1，已由 M2 取代） | ✅ | `POST /rest/v1/subscriptions?on_conflict=user_id,route`：更新 200、新增 201；顯示 已訂閱 badge |
| 付款後回到 `/dashboard?purchase=success`，卡片變 已訂閱（有效） | ✅ | 真實 stage 付款 |
| 付款導回後目標價輸入框不空白 | ✅ | 以 `useEffect` 同步已儲存目標價 |
| 取消後顯示 已取消 · 有效至 2026/10/19 | ✅ | |
| 目標價 `<label>` 與輸入框關聯 | ✅ | 三張卡 id 各自唯一（`target-price-<plan>`）、可及名稱為 label、點 label 聚焦輸入框、console 無警告 |
| 所有 `<button>` 游標為 pointer；確定取消 hover 由框線變實心紅；取消中顯示 `取消中…` | ✅ | 瀏覽器檢查（London 的確認提示開啟後以 保留 關閉，London 未被取消） |

### 4.2 M1（計畫第 7 章）— 2026-09-18

| ID | 結果 | 證據 |
|---|:-:|---|
| A1–A3 資料表、RLS、路由種子 | ✅ | `flight.routes`／`subscriptions`／`notification_history` 存在，RLS enabled；tokyo→`TPE-TYO`、seoul→`TPE-SEL` |
| A4 `subscription_status` | ✅ | M1 時不存在；M2 起按設計新增 |
| B1–B3 secrets、部署、schema 可由前端存取 | ✅ | 函式 v3、`verify_jwt = true`；訂閱 UI 由瀏覽器讀寫 `flight` schema 成功（此三項為間接證據） |
| C3 跨使用者寫入被擋 | ✅ | rollback 交易中測試：`42501` |
| D2 真實表單 → 資料列 | ✅ | 200／201 |
| E1、E2 已訂閱狀態、讀取範圍 | ✅ | badge 顯示；他人查詢 0 列 |
| F2 無佇列，直接呼叫 | ✅ | 程式碼確認（每批 25 筆 POST 至 `flight-notification`） |
| G1 以 service-role 呼叫 parser | ✅ | `{"routes":2,"matches":1}` |
| G2、J2 不帶 bearer | ✅ | 兩支函式皆 `401` |
| G3 票價與 `last_checked_at` | ✅ | cron 每次觸發都更新 `last_checked_at` |
| H1、H2 比對與雙幣別 payload | ✅ | 東京達標被比對並寄出 |
| **H3 USD 失敗仍以 TWD-only 交付** | 🟡 | **僅程式碼審查**，未實際製造 USD 失敗 |
| H5 目標價低於現價被排除 | ✅ | Seoul 測試列：無 `TPE-SEL` history、無信 |
| I1–I3 `pg_cron`／`pg_net`、job、實際觸發 | ✅ | `*/30 * * * *`；每個 tick 觸發 |
| J3 去重參數 | ✅ | 由 L1、L3 行為證實（24h 內不重寄；≥20%／≥NT$2,000 重寄） |
| K2 收信內容 | ✅ | Gmail 收件匣：`✈️ 台北 → 東京 降價通知！NT$6,556 已達標`，含 NT$ 主標、約 US$、目標價、立即訂購 |
| L1 去重擋下重複 | ✅ | 16:00Z tick 兩函式皆 200，但無新 history 列、無新信（「skipped (deduped)」log 行本身未親眼看到） |
| L2、L3 history 與大幅降價重寄 | ✅ | 最新 history 調至 9,500 → 新信（6,556）＋新 history 列；測後還原 |

### 4.3 M2（計畫第 8 章）— 2026-09-19 ～ 09-20

**A 結帳表單**

| ID | 結果 | 證據 |
|---|:-:|---|
| A1 secrets | ✅ | 五個 `ECPAY_*` 皆在（`SITE_URL` 未設） |
| A2 結帳表單內容 | ✅ | `text/html`；含 cashier URL、`CheckMacValue`、`PeriodType=M`；`PeriodAmount = TotalAmount = 300`；完整 slug 的三個 URL；cashier 顯示 NT$300「每 1 個月扣 1 次」，訂單 `FPMU8DUXVA5K5Z3B`；用戶端亂送的 `route` 被忽略（`CustomField2` 維持 `TPE-LON`） |
| A3 pending 列 | ✅ | |
| A4 無效 JWT 呼叫 `flight-subscribe` → 401 | ✅ | 2026-09-21：不帶 header → gateway `401 UNAUTHORIZED_NO_AUTH_HEADER`；亂填 bearer → gateway `401 Invalid JWT`；以公開金鑰 `sb_publishable_…` 當 bearer → 通過 gateway，由函式回 `401 {"error":"unauthorized"}` |
| A5 非法 `target_price`／缺 `plan_name` → 400 | ✅ | 2026-09-21，以已登入使用者的 JWT（在頁面內使用，未顯示）呼叫 `flight-subscribe`，`plan_name` 用不存在的名稱以避免驗證失效時動到真實列：`target_price` 為 0、-5、`"abc"`、缺 `plan_name`、空物件 → 全部 `400 {"error":"plan_name and a positive target_price are required"}`；壞 JSON → `400 {"error":"invalid JSON body"}`。事後重載 dashboard，三筆目標價（8000／6000／22000）不變 |

**B 回呼與啟用**

| ID | 結果 | 證據 |
|---|:-:|---|
| B1 `verify_jwt=false`、偽造 body | ✅ | 三支皆 `False`；偽造 → `0|CheckMacValue error`（證明未被 gateway 擋、CMV 有強制） |
| B2 CMV ＋ `SimulatePaid` 防護 | ✅ | log `CMV mismatch FAKE1`；簽章正確的 `SimulatePaid=1` → `CMV verified`、`1|OK`、London 維持 `pending_payment` |
| B3 真實付款 → active | ✅ | 只有 1 次 ECPay 呼叫、200 `text/plain`、無重送；`active`，`current_period_end` ＋1 個月。**註**：`total_success_times = 1` 為程式碼審查，未在真實新結帳驗證 |
| B4 ECPay 排程真實續扣 | ✅ | 訂單 `FPMU8IP18O712217`，2026-09-19 23:57:11Z 收到 `RtnCode=1 TotalSuccessTimes=2 ExecTimes=2`，`1|OK`，僅呼叫一次；`payment_failed_at` 為 null。測後 `flight-subscribe` 已由 repo 重新部署（v3）並讀回確認 `PeriodType: "M"`／`ExecTimes: "999"` |
| B5 `flight-ecpay-result` → 302 | ✅ | curl 與真實付款皆導向 `/dashboard?purchase=success` |
| B6 `MerchantID` 不符 → 拒絕 | ✅ | 2026-09-21，以公開 stage HashKey／HashIV 自簽回呼（皆帶 `SimulatePaid=1`，即使檢查失效也會在寫入前回 `1|OK`，不會動資料）。`flight-ecpay-return`、`flight-ecpay-period` 結果一致：對照組（`MerchantID=3002607`）→ `1|OK`；簽章正確但 `MerchantID=2000132` → `0|MerchantID mismatch`；簽章後再竄改 `MerchantID` → `0|CheckMacValue error` |
| B7 空字串欄位保留於 CMV | ✅ | 隱含於 B3、B4 成功（cashier 與真實回呼皆通過） |

**C 狀態通知**

| ID | 結果 | 證據 |
|---|:-:|---|
| C1 welcome 信 | ✅ | 收件匣 `✈️ 訂閱成功！台北 → 東京 降價通知已開始`，內文（每月扣款 NT$300、服務期間至 2026/10/19）與範本一致 |
| C2 未知 `event_type` → 400；無 bearer → 401 | ✅ | `bogus` 事件 → 400（訊息列出四種事件名稱）；無 bearer → 401 |
| C3 Resend 拒絕時回 502 | ✅ | 2026-09-21 07:41Z：測試列 email 設為 `c3-invalid-email`，自簽 `RtnCode=0` 回呼 → `flight-ecpay-period` 回 `1|OK`；`flight-status-notification` edge log **502**；function log `payment_failed email failed for c3-invalid-email { statusCode: 422, name: "validation_error", message: "Invalid `to` field…" }`。寄信失敗不會讓 ECPay 重送。**注意**：`payment_failed_at` 在寄信前就已設定（07:41:24Z），失敗後不會補寄（見 K-8） |

**D 付費門檻與寬限期**

| ID | 結果 | 證據 |
|---|:-:|---|
| D0 gate | ✅ | `{"routes":3,"matches":1}`：London（`pending_payment`、達標）被排除，Tokyo（`active`）入列；M2 前會是 2 |
| D1 active 收降價信 | ✅ | Tokyo 新 history 列（NT$6,579） |
| D2 pending_payment 不寄 | ✅ | 同 D0 |
| D3a cancelled 且期限未到 → 仍收降價信 | ✅ | `matches: 1`；新 history NT$6,610（14:04Z）；無 dedup 跳過、無錯誤 |
| D3b cancelled 且期限已過 → expired | ✅ | `cancelled → expired`、`matches: 0`、一封「已結束」信；第二次 parser 不再寄 |
| D4 active 逾期 >7 天 → expired | ✅ | 回推 8 天 → `expired`、一封「本期扣款…已結束」信 |

**E 取消**

| ID | 結果 | 證據 |
|---|:-:|---|
| E1 取消 → `cancelled`（非 expired） | ✅ | ECPay `RtnCode=1 停用成功`；`current_period_end` 保留；取消信已寄 |
| E2 寬限期內改目標價 | ✅ | 8000 → 8500，無跳轉、仍 `cancelled`、同一 trade no |
| E3 完整生命週期 | ✅ | `expired → active → cancelled → expired` 全走過 |
| **E4 取消 ECPay 已終止的訂單（90100149）** | ✅ | 首次測試**失敗**（見缺陷 D-3），修正後 2026-09-20 05:10Z 通過 |
| E5 取消查無訂單（90100150） | ✅ | 依 checklist 說明與程式碼；一次性測試訂單在 stage 取消回此碼並於本地取消 |
| E6 ECPay 回其他錯誤碼 → 502 且列不變 | ✅ | 2026-09-21 07:45Z。先對 ECPay stage 探測 16 種壞格式訂單號：15 種回 `90100150`（被視為無可停止），只有單一空白字元 `" "` 回 `10200052`。測試列 `merchant_trade_no = ' '`、`active`，以測試帳號 JWT 呼叫 `flight-cancel-subscription`：**502** `{"error":"ECPay could not cancel the subscription","detail":""}`；log `ECPay cancel  : HTTP 200 RtnCode=10200052`＋`ECPay cancel rejected …`；資料庫該列狀態、`current_period_end`、`updated_at` 皆不變；期間沒有任何 `flight-status-notification` 呼叫（沒寄取消信）。`detail` 為空是因 ECPay 對此碼的 `RtnMsg` 為空 |
| E7 按鈕 hover／busy 樣式 | ✅ | 見 4.1 |
| E8 從 `expired` 重新訂閱 | ✅ | Tokyo：新 trade no `FPMU8GFF402A0U33`（舊為 `FPMU8DUXVA5K5Z3B`）→ 付款 → `active` → welcome |

**F RLS 自我啟用（阻擋項）**

| ID | 結果 | 證據 |
|---|:-:|---|
| F1 | ✅ | 以登入使用者身分 `update` **與** `insert` 皆 `42501 permission denied` |
| F1b | ✅ | `authenticated` 僅 SELECT；僅剩 `select own subscriptions` policy |
| F2 | ✅ | 自己的列仍可 `select` |

**G 生命週期信件只寄一次**

| ID | 結果 | 證據 |
|---|:-:|---|
| G1 payment_failed 一次 | ✅ | 自簽 `RtnCode=0`：寄一封、`payment_failed_at` 設定、列維持 `active`；相同失敗再送 → `1|OK`、旗標不變、**無第二封**（僅一次 status-notification 呼叫） |
| G2 恢復清旗標 | ✅ | `RtnCode=1` 清除 `payment_failed_at` |
| G3 expired 各寄一次 | ✅ | 整個測試窗口內只有 3 次 `flight-status-notification` 呼叫（expired、payment_failed、expired） |
| G4 renewed 每期一次 | ✅ | `TotalSuccessTimes=3`（原值 null）→ 寄信、計數 3；**相同回呼再送** → log `charge #3 already processed, no email`、`updated_at` 不變；`=4` → 第二封。三次 period 呼叫、兩次 status 呼叫；使用者於信箱確認**恰好兩封**且版面正常 |
| G5 缺 `TotalSuccessTimes` → 延期但不寄 | ✅ | 2026-09-21 07:40:47Z，自簽 `RtnCode=1`（不帶 `SimulatePaid`、不帶 `TotalSuccessTimes`）→ `1|OK`；`current_period_end` 由 09-22 延到 10-21（+1 個月）、`total_success_times` 維持 1、狀態仍 `active`；log `renewal FPTESTG5A0001: no usable TotalSuccessTimes (undefined), period extended without an email`；期間沒有 `flight-status-notification` 呼叫 |
| G6 用完排程次數 → expired | ✅ | 2026-09-21 07:41:08Z，自簽 `RtnCode=0`、`TotalSuccessTimes=6`、`ExecTimes=6`：狀態 → `expired`、`payment_failed_at` 設定；log 兩次寄信：`payment_failed email sent`＋`expired email sent`（收件匣兩封皆收到：「⚠️ 台北 → 倫敦 本期扣款失敗」「台北 → 倫敦 降價通知已結束」，使用者確認）。**重送相同回呼**：`1|OK`、`updated_at` 與旗標不變，整個窗口只有 2 次寄信呼叫（非 4 次）。**注意**：此路徑只存在於**失敗**回呼；用完次數的最後一期若扣款成功，列維持 `active`（見 K-9），且同一事件會同時寄出兩封語意矛盾的信（見 K-7） |

**信箱對帳**（Gmail，使用者提供兩張截圖；時區 UTC+8）：
10:01 PM 訂閱成功 · 10:02 降價 NT$6,579 · 10:03 已取消 · 10:04 降價 NT$6,610 · 10:04 已結束 ·
10:05 ⚠️ 本期扣款失敗 · 10:06 已結束。每封信都對得上一行 log，Gmail 依主旨分組的計數也對應「每次測試各一封」，
**沒有重複寄出**。「已結束」兩種文案（`period_ended`、`payment_lapsed`）皆完整看過；寄件人 `noreply@roberthut.com`。

### 4.4 資料庫與 auth trigger（計畫第 9 章）

| ID | 結果 | 證據 |
|---|:-:|---|
| DB-01 | ✅ | 回滾式 `DO` 區塊：`apps` 新增 `trigger-test-app`；事後重讀確認無殘留 |
| DB-02 | ✅ | 以 anon 呼叫 RPC → `404 PGRST202`；SQL 直接呼叫 → `trigger functions can only be called as triggers` |
| DB-03 | ✅ | `proacl` 為 `{postgres=X/postgres,supabase_auth_admin=X/postgres}`；`SECURITY DEFINER`、`search_path=""` 不變；兩個 trigger 皆 enabled；`has_function_privilege`：兩個內部角色 true，`anon`／`authenticated`／`service_role` false |
| DB-04 以 `supabase_auth_admin` 實際觸發（真實 GoTrue 寫入） | ✅ | 2026-09-20 當時：連線無法 `set role supabase_auth_admin`（`permission denied`），只驗到權限，標為 🟡。**2026-09-21 改列 ✅（使用者確認）**，依據是真實 GoTrue 路徑（GoTrue 以 `supabase_auth_admin` 寫入 `auth.users`，且都發生在 09-20 加固 migration 撤銷 PUBLIC 的 EXECUTE 之後）：FE-07 真實註冊時 trigger 在 `INSERT` 把 `apps` 寫成 `["fare-finder-pro"]`；FE-09 重設密碼與 FE-08 密碼相符註冊的 `updateUser` 使 trigger 在 `UPDATE` 補上標記。若該角色沒有 EXECUTE 權限，這些寫入會失敗而不是成功。**限制**：這是經真實路徑的間接證明，並非在 SQL 裡手動切換成該角色執行 |
| DB-05 migration 登錄流程 | ✅ | 兩次 `migration repair` 被漏掉（使用者只執行了區塊第一行），皆由讀取 `schema_migrations` 發現並補上 |

### 4.5 安全（計畫第 10 章）

| ID | 結果 | 說明 |
|---|:-:|---|
| SEC-01 無 bearer → 401 | ✅ | parser、notification、status-notification 皆已驗 |
| SEC-02 公開金鑰當 bearer | ✅ | 2026-09-21：以 `sb_publishable_…` 當 bearer，`flight-parser`、`flight-notification`、`flight-status-notification` 皆由函式內部回 `401 Unauthorized`。**限制**：測的是新式公開金鑰，舊式 anon JWT 未測（函式內比對邏輯對兩者相同） |
| SEC-03 偽造 CMV | ✅ | `0|CheckMacValue error`，非 gateway 401 |
| SEC-04 body 夾帶他人資料 | 🟡 | 已驗證亂送 `route` 被忽略；email／user_id 取自 JWT 僅由程式碼審查確認 |
| SEC-05 使用者直接寫 subscriptions | ✅ | 同 F1 |
| SEC-06 使用者讀 `notification_history` | 🟡 | 已確認「RLS enabled、無 policy」（設計上僅 service role）；未記錄實際以使用者身分讀取的嘗試 |
| SEC-07 前端 bundle 不含機密 | ✅ | 2026-09-21 掃描 Vercel 站台 8 個 JS 檔（約 591 KB，含延遲載入的 dashboard chunk，內有 `flight-subscribe` 呼叫）：無 service-role、`sb_secret_`、HashKey／HashIV、Resend、Travelpayouts、`ECPAY_*` 字串，也沒有任何 JWT；只有公開的 `sb_publishable_…` 金鑰。**限制**：掃的是 Vercel 上的版本，不是最終程式碼 |
| SEC-08 `apps` 為使用者自訂標籤 | ✅ | 在資料庫層級確認可自行加入（見 DB-01）；**未**經 GoTrue 對真實帳號執行。RLS 不依賴 `apps`，僅前端路由守衛使用，真正的存取控制列為 backlog B-1 |

### 4.6 2026-09-21 補測的環境與觀察

- **環境**：chrome-devtools 開啟**隔離的乾淨瀏覽器環境**（無既有 session），網址 `https://fare-finder-pro.vercel.app/`；行動版以 `390x844x2,mobile,touch` 模擬。後端請求以 `curl`／Node 直接打 `https://luugfvsrawnuzwpjvddt.supabase.co/functions/v1/…`。
- **資料影響（本節前半，FE-01～FE-12、A4／A5、B6、SEC-02／07）**：沒有建立帳號、沒有寫入或修改任何資料列、沒有寄出 email。FE-05 用不存在的假帳號，只產生一次被拒絕的登入請求；B6 的回呼全部帶 `SimulatePaid=1` 且使用不存在的交易編號與 email。**後半輪（FE-07／08／09／11、C3／E6／G5／G6）會寫入資料，見 4.7。**
- **注意（Vercel 不是最終程式碼）**：本次前端結果只代表目前部署在 Vercel 的版本。Edge Function 的 `SITE_URL` 尚未設定，付款完成後會導回 `localhost:8080`，因此沒有在 Vercel 上測付款流程。
- **觀察（非缺陷）**：
  1. 網站目前為深青綠加紅色主題，與 `README.md` v1 需求的紫色調不同，應是後續設計變更；README 的舊描述可一併更新。
  2. 首頁第一張卡片文案已列出「東京、首爾、倫敦」，與 README 的「東京、首爾」不同（倫敦為 M2 期間新增）。
  3. `flight-subscribe` 用公開金鑰當 bearer 時，是通過 gateway 後由函式自己回 401（訊息 `{"error":"unauthorized"}`），與亂填 bearer 時 gateway 直接回 401 的訊息格式不同；行為都正確。
  4. **登出使用 `scope=global`**：`supabase.auth.signOut()` 預設會撤銷該使用者**所有裝置與所有 app** 的 session。這個專案的 `auth.users` 與 `project-management`、`udemy-coupon` 共用，所以在本 app 按登出，同一個帳號在其他 app／裝置上也會被登出。屬 supabase-js 預設行為、非缺陷，但在共用專案裡可能出乎使用者意料；若不希望如此，可改為 `signOut({ scope: "local" })`。
  5. **資料與 handoff 不同**：handoff 記錄倫敦為 `active`（月訂單 `FPMU8I5Y0K3J125F`），但 2026-09-21 dashboard 顯示三條航線**都是「已取消」**（東京有效至 2026/10/20、首爾與倫敦有效至 2026/10/19）。此變更不是本次測試造成（本次沒有按任何訂閱或取消按鈕）。**佐證**：信箱中有一封倫敦的取消信「已取消 台北 → 倫敦 的降價通知訂閱」，寄出時間 2026-09-20 11:41:16Z（取消信只在 ECPay 回 `1`、`90100149` 或 `90100150` 之後才寄），與首爾的取消信（2026-09-20 05:10:42Z）相同格式；推測為使用者在 handoff 之後自行取消。
- **登入相關補測**：由使用者在 chrome-devtools 視窗自行輸入帳密（測試者看不到密碼）。A5 只從瀏覽器 session 取 token 在頁面內使用，沒有顯示或保存；事後重載 dashboard 確認目標價未變。登出後該隔離視窗已關閉。
- **FE-06 第二次嘗試（通過）**：改用 `pm3.demo@example.com`，測前先確認前置條件，過程與結果見 4.1 的 FE-06 列。對該帳號的影響：`last_sign_in_at` 由 null 變成 2026-09-21 07:01Z、`updated_at` 隨之更新（登入本身造成），並因前端的全域登出撤銷了它的 session（它原本就沒有其他 session）；`apps`、`user_metadata` 沒有被改動。
- **FE-06 第一次嘗試紀錄（前置條件不成立）**：
  1. 首次登入的 `k***@gmail.com` 三個標記都有，不適用。
  2. 第二次由使用者改用 `pm.demo@example.com` 登入（頁面載入前注入一個只記錄 `/auth/v1/token` 回應狀態與 `app_metadata.apps`、不記 token 與密碼的監聽器）：回應 200、`apps = ["fare-finder-pro","project-management"]`，前端放行。使用者原本預期該帳號不該登入成功，但資料庫顯示它**登入前就已帶有本 app 標記**。
  3. 資料庫唯讀查詢（僅此一列）：帳號建立於 2026-08-25，早於 M0 trigger（09-04）；`raw_user_meta_data` 含 `app: "fare-finder-pro"` 與 `project-management` 的員工欄位（`role`、`employee_no` 等）；`raw_app_meta_data.apps` 含兩個 app。`auth.audit_log_entries` 查無此帳號紀錄，M0 migration 也沒有回填舊帳號，因此**無法從現有資料判斷是何時、經由哪條路徑被標記**。
  4. 可能的路徑（皆未證實）：曾用此 email 在本 app 走過「註冊且密碼相符 → 自動補標記」的流程（即 FE-08／K-3 描述的行為）；或有人以 `updateUser({ data: { app: "fare-finder-pro" } })` 自行加上（B-1 所述的使用者自訂標籤）。需請使用者回想是否曾用此帳號登入或註冊過本 app。
  5. **意義**：這是 K-3 與 B-1 的一個具體例子——`project-management` 的員工帳號可以取得本 app 的存取標記。本次沒有證據顯示有人濫用；付費保護不依賴此標記（由 ECPay 驗證的 Edge Function 才能寫 `active`），它只影響前端路由守衛。
  6. **結論（使用者決定）**：使用者認為應是很早期的 session 測試時建立，決定不再追查。此說明未經資料佐證，僅作記錄。
  7. **清理**：測試結束後，以 `scope=local` 登出並移除該隔離視窗的 session（回 204），只結束本次測試建立的 session，沒有影響該帳號其他裝置／app 的登入；也沒有修改任何帳號資料。
- **自簽回呼腳本**：`b6-merchantid.mjs`、`period-callback.mjs`、`ecpay-cancel-probe3.mjs`（使用技能文件中公開的 stage HashKey／HashIV，演算法與 `_shared/ecpay.ts` 相同）僅存在於 session scratchpad，尚未收進 repo。

### 4.7 2026-09-21 後半輪（會寫入資料）的做法與影響

**測試帳號**：`k***+fe07a@gmail.com`（Gmail 別名，信件實際寄到使用者信箱），id `8b7871c2-7c60-4ec3-99c4-ca5a341243d2`，密碼為測試用一次性字串。

**誰做了什麼**
- **由助理執行**：註冊、登入、呼叫 Edge Function、自簽 ECPay 回呼、讀 log、唯讀 SQL、讀 Gmail（搜尋範圍限該別名與 `noreply@roberthut.com`）。
- **由使用者以 `supabase db query --linked --file …` 執行**（因為助理寫入共用正式資料庫被自動模式擋下，也未繞過）：`test-setup.sql`（插入 G5／G6／C3 的三筆測試列）、`test-e6.sql`（把 tokyo 測試列改成 `merchant_trade_no = ' '`）、`strip-tag.sql`（兩次，去除測試帳號標記以模擬其他 app 的帳號）。所有 SQL 皆以 id＋email 限定，只動測試帳號。
- **由使用者手動操作**：點確認信連結（FE-11）、點重設信連結並設定新密碼（FE-09／FE-11）。

**被自動模式擋下、且未繞過的動作（2 次）**
1. 從資料庫讀出測試帳號的 `confirmation_token`、自行組確認連結替帳號完成驗證（分類為「憑證具體化」）。改由使用者在信箱點連結。（該 token 已出現在對話記錄中，僅屬這個一次性測試帳號、單次有效，帳號刪除後失效。）
2. 由助理直接 `INSERT` 測試訂閱列到正式資料庫（分類為「修改共用資源」）。改由使用者執行 SQL。

**環境問題**：使用者第一次執行時 `supabase db query --linked` 回 403（CLI 登入的帳號看不到專案 `luugfvsrawnuzwpjvddt`，只列得出 `blog_robert_hut`、`apps_product`）；使用者處理後第二次即可執行（處理方式未記錄）。這表示 handoff 中的 CLI 流程（`db query`、`functions deploy`、`migration repair`）取決於 CLI 登入的是哪個帳號（見第 7 章環境限制）。

**對真實資料的影響**：測試列全部掛在測試帳號名下（`target_price = 1`，cron 不會比對到、不會寄降價信），沒有碰任何真實使用者的訂閱列；`flight.notification_history` 沒有新增。寄出的真實 email 皆寄到使用者自己的信箱：註冊確認信（垃圾郵件匣）、重設信、G6 的兩封（收件匣）。**測試帳號與其三筆列已於 2026-09-21 由使用者執行 `test-cleanup.sql` 刪除並經查詢驗證**，見第 8 章。

---

## 5. 測試中發現並已修正的缺陷

| 編號 | 缺陷 | 發現方式 | 處置與驗證 |
|---|---|---|---|
| D-1 | `flight-parser` 的 `nextMonth()` 回傳**當月**而非下個月 | M1 驗收（2026-09-18） | 已修正（`Date.UTC` 進位）。票價隨之改變：東京 7,682 → 6,556、首爾 5,370 → 5,127 |
| D-2 | ECPay 回呼被 gateway 以 401 擋下（`verify_jwt` 預設 true，ECPay 不帶 JWT） | M2 建置／偽造 body 冒煙測試 | 三支回呼設 `verify_jwt = false` 並以 `--no-verify-jwt` 部署；偽造 body 回 `0|CheckMacValue error` 證實 |
| D-3 | 按 取消訂閱 顯示「ECPay could not cancel the subscription」，列仍 `active`：ECPay 對已自行終止的訂單回 `90100149`，函式只容許 `1` 與 `90100150` | 使用者回報（2026-09-20 05:06:52Z） | 加入 `NOTHING_TO_STOP` 集合（`90100150`、`90100149`）並回傳 ECPay `detail`；部署 v2 後 05:10Z 重試通過。這不只是測試造成：ECPay 在 6 次失敗或卡片過期時也會靜默終止，真實使用者同樣會卡住 |
| D-4 | dashboard 按鈕（Tailwind v4）無 pointer 游標，確定取消 無 hover／busy 狀態，看起來像壞掉 | 使用者回報 | 全域 `button:not(:disabled) { cursor: pointer }`；確定取消／保留 重做為真按鈕，含 hover、focus ring、disabled 與 `取消中…`；瀏覽器確認 |
| D-5 | `flight.tag_app_metadata_on_signup()` 為 SECURITY DEFINER 且 `PUBLIC` 可執行；註解稱 `app_metadata` "tamper-proof" 不準確 | Supabase advisor | 驗證**不可利用**後仍套用 `20260920110000_flight_tag_app_metadata_hardening`（撤銷 PUBLIC／anon／authenticated 的 EXECUTE）；更正 `app-scope.ts` 註解。標籤本身為使用者自訂之設計問題保留為 B-1 |
| D-6 | 設計缺口：ECPay 6 次失敗後靜默終止，`active` 列會永遠留著並持續被通知；此外使用者在續扣成功、續扣失敗、期滿時沒有任何通知 | M2 後續審視 | parser 新增規則（`active` 逾期超過 `RENEWAL_GRACE_DAYS`=7 → `expired`）；新增 `expired`、`payment_failed`、`renewed` 三種 email，皆以 `update … returning` 或欄位旗標保證每事件只寄一次；皆已驗證 |

另有一項付款後畫面問題（未載入完成的查詢造成目標價輸入框空白）已以 `useEffect` 同步修正；
兩個 a11y 警告（label 未關聯輸入框）已修正並於瀏覽器確認。

**經查證屬誤報／非缺陷**
- 「`flight-notification` 與 `send-email` 被重新部署」：兩者 `ezbr_sha256` 與 `updated_at` 完全相同，只是所有函式的 `version` 數字一起加 1。**結論：`version` 不可作為是否重新部署的判斷依據。**
- 09-17 history 列 `sent_at` 差 2 小時：是先前測試時為清除 24 小時去重視窗而刻意回推，不是缺陷（已記錄，該列不再影響去重）。

---

## 6. 開放中的已知問題

| 編號 | 問題 | 影響 | 建議 |
|---|---|---|---|
| K-1 | 歡迎信硬編碼「每月扣款 NT$…」；B4 每日測試訂單的歡迎信也寫「每月」 | 目前正式維持月繳，無影響；日後若提供其他週期會出錯 | 屆時由結帳流程把週期傳入 |
| K-2 | `flight.subscriptions.updated_at` 沒有 trigger；parser 的 lazy `cancelled → expired` 不會更新它 | 僅影響稽核時間戳 | 需要時加 `before update` trigger |
| K-3 | **已處理（2026-09-21）**。原問題：`docs/shared-supabase-auth.md`／README 寫「已存在 email 一律走密碼重設」，但 `src/routes/auth/index.tsx` 在密碼相符時會直接補標記並登入（FE-08 實測確認：不需驗證信箱，只要知道另一個 app 帳號的密碼就能經註冊流程取得標記） | 取得標記需先知道該帳號密碼，且標記只影響前端路由守衛（見 K-4）；註冊時要求驗證信箱並不會增加實質保護，因為已登入的使用者本來就能自己 `updateUser` 加標籤 | **處理方式：以程式碼為準，改文件。** `docs/shared-supabase-auth.md` 與 `README.md` 已改成描述實際行為（登入頁不補標記；註冊時密碼相符即補、不符走重設），並新增「標籤是什麼、不是什麼」說明。`CLAUDE.md` 同步更新。程式碼未動 |
| K-4 | B-1：`apps` 標籤為使用者自訂，不是權限 | 目前僅影響前端路由守衛；付費保護不依賴它（由 ECPay 驗證的 Edge Function 才能寫 `active`） | 只在 backlog 列出的觸發條件成立時處理 |
| K-5 | `RENEWAL_GRACE_DAYS = 7` 為推估值 | 若 ECPay 實際重試窗口更長，可能提早把仍在重試的訂閱轉 `expired` | 取得 ECPay 實際重試視窗後調整 |
| K-6 | **註冊確認信進了垃圾郵件**（FE-07）。Gmail 標示「與先前歸類為垃圾郵件的郵件相似」。同一寄件人 `noreply@roberthut.com` 的生命週期信（G6）與降價信進收件匣。`send-email`（Auth hook）只寄 HTML、無純文字版；`flight-status-notification` 則同時寄 HTML 與純文字。以上為觀察到的差異，**因果未驗證** | 新使用者可能收不到確認信而無法完成註冊；Gmail 也可能因先前的測試信而對此寄件人有既有判斷 | **已改善（收尾中）**。DNS 檢查（2026-09-21）：`send.roberthut.com` 的 SPF（amazonses）、退信 MX、`resend._domainkey` 的 DKIM 都在，**缺 `_dmarc.roberthut.com`（沒有 DMARC 記錄）**。因為同網域的降價信與生命週期信進收件匣，DNS 不是「只有確認信進垃圾郵件」的主因。**已做**：(a) `send-email` 加純文字版，2026-09-21 08:30Z 已部署（v8，`verify_jwt` 仍為 false，線上程式碼已讀回確認）。(b) 部署後用新別名（`k***+fe07b@gmail.com`，經公開 signup API 註冊）再測：`send-email` 回 200，**信仍進垃圾郵件**，Gmail 同樣註明「與先前歸類為垃圾郵件的郵件相似」。此結果**削弱**了「缺純文字版是主因」的假說，但有干擾：第一封確認信已被 Gmail 歸為垃圾郵件，第二封內容幾乎相同，可能只是沿用該判斷，因此**不能證明純文字版有效或無效**。(c) 使用者已對兩封確認信按「回報為非垃圾郵件」。(d) 範本內容改寫：信中寫明產品名稱、收到此信的原因、以及「不是本人請忽略」（HTML 與純文字皆有；原本只有「請點擊以下按鈕完成操作」與長連結，缺產品名稱與原因，內容像典型的釣魚信範本）。本機渲染六種 action type 皆正常，**已於 2026-09-21 08:39Z 由使用者部署（v9，線上程式碼已讀回確認）**。(e) 部署後對 `fe07b` 用 `/auth/v1/resend` 重寄（08:40:09Z，回 200）：**新範本的確認信進了收件匣，並被 Gmail 標為「重要」**（未讀），信件摘要顯示新內文（「你剛剛用這個 email 在 Flight Price Notifier（機票降價通知）註冊了帳號…」），大小 8.5 KB（舊版 7.2 KB）。**限制**：此時前兩封舊信已被使用者按「非垃圾郵件」移回收件匣，三封主旨相同、被歸在同一個對話串，Gmail 對同串同寄件人的新信本來就較寬容，因此**無法區分是範本改動還是使用者的回報造成進收件匣**。(f) **另一個信箱的驗證（2026-09-21 08:44Z）**：對 `k***`（使用者另一個 Gmail 信箱）的 `+` 別名 `r***+k6@…` 註冊（公開 signup API），`send-email` 回 200；**使用者確認新範本的確認信進了收件匣**（測試前未做任何「非垃圾郵件」標記）。**結論**：目前版本（v9：純文字版＋新範本）在一個沒有人為干擾的信箱可正常送達，問題在此信箱**未重現**，範本改動很可能有效。**限制**：沒有對照組（沒有在同一信箱送舊範本），所以無法證明「舊範本在那個信箱也會進垃圾郵件」；樣本只有 1 個信箱，且同為 Gmail；Gmail 判斷含個人化與信譽因素，之後仍可能變動。**待辦**：(1) ~~部署~~ 已完成；(2) ~~重寄看結果~~ 已完成；(3) ~~用乾淨信箱測~~ 已完成（見 (f)），若要更有把握，可再用非 Gmail 信箱（Outlook／Hotmail）測一次；(4) 使用者在 DNS 加 `_dmarc` TXT（例如 `v=DMARC1; p=none; rua=mailto:<信箱>`，`p=none` 只監控）；(5) ~~清除測試帳號~~ 已完成（2026-09-21 由使用者執行清理 SQL，`fe07b` 與 `k6` 兩個一次性帳號已刪除，唯讀查詢確認 `auth.users` 回到 25、標記帳號仍為 5、原本的真實帳號完好） |
| K-7 | 失敗回呼剛好用完排程次數時（G6），同一事件同時寄出「本期扣款失敗，系統會自動再試幾次」與「訂閱已結束」兩封語意矛盾的信（使用者已實際收到） | 使用者困惑；第一封承諾會重試，第二封說已結束 | 已進入 `expired` 路徑時略過 `payment_failed` 信，或改寫其文案 |
| K-8 | `payment_failed_at` 在寄信**之前**就設定（C3）；Resend 拒絕或暫時失敗時該期的通知永遠不會補寄，`flight-ecpay-period` 仍回 `1|OK` 所以 ECPay 也不重送 | 罕見（Resend 失敗才會發生），但使用者當期不會被通知扣款失敗 | 寄信成功後才設旗標；或寄信失敗時清除旗標讓下次回呼重試（需評估與「只寄一次」的取捨） |
| K-9 | 「用完排程次數 → `expired`」只在**失敗**回呼的路徑上（G6）。若最後一期扣款成功，列維持 `active`（延期一個月），要等 parser 的「逾期 7 天」規則才轉 `expired` | 不影響收費（ECPay 已終止該系列），只是服務多維持一段時間 | 確認是否為刻意設計；若否，於成功回呼且 `TotalSuccessTimes >= ExecTimes` 時標記為將到期 |

---

## 7. 未驗證與覆蓋缺口

**功能上尚未驗證**
1. `flight-ecpay-return` 於真實首扣是否寫入 `total_success_times = 1`（僅程式碼審查）。
2. 真實續扣回呼中金額欄位名稱（`Amount` 或 `amount`；有 fallback 至 `ECPAY_AMOUNT`，顯示金額不受影響）。
3. H3（USD 取價失敗仍以 TWD-only 交付）。（DB-04 已於 2026-09-21 由真實註冊與 `updateUser` 補驗，見 4.4。）
4. 取消信、扣款失敗信、降價信的完整內文（只看過主旨與摘要；歡迎信與「已結束」兩種、「本期已扣款」的內文已確認）；ECPay 廠商後台顯示系列已終止（證據僅為 `RtnCode=1`；定期定額查詢頁在 stage 回傳 500／空白，無法作為證據）。
5. 「skipped (deduped)」log 行本身沒有親眼看到（以無新 history、無新信推論）。

**沒有測試記錄的計畫用例：無。** 2026-09-21 已補測 20 項：FE-01、02、03、05、06、07、08、09、10、11、12、A4、A5、B6、C3、E6、G5、G6、SEC-02、SEC-07（見 4.6、4.7）。
**仍為 🟡 的 3 項**：H3（USD 取價失敗仍以 TWD-only 交付，僅程式碼審查）、SEC-04（body 夾帶他人 email／user_id，僅驗證了亂送 `route` 被忽略，email／user_id 取自 JWT 為程式碼審查）、SEC-06（無 policy 的 `notification_history` 未以使用者身分實際讀取）。
DB-04 已於 2026-09-21 改列 ✅（使用者確認）。

**環境限制**
- 全部金流測試在 ECPay stage 共用特店，**未使用正式特店與 `ECPAY_ENV=prod`**；`SITE_URL` 未設（預設 `localhost:8080`）。
- 沒有自動化測試；每次驗證需人工執行（含使用者以 `!` 執行正式環境 DDL、部署與手動 parser、以及寫入測試資料）。自動模式會擋下助理對共用正式資料庫的寫入與「讀出憑證再使用」的動作。
- **Supabase CLI 登入帳號**：2026-09-21 第一次 `supabase db query --linked` 回 403（CLI 帳號看不到專案 `luugfvsrawnuzwpjvddt`，只列出 `blog_robert_hut`、`apps_product`）；之後可以執行。CLI 目前版本 2.115.0（有 2.117.0 可更新）。部署或 migration 前應先確認 CLI 登入的是擁有該專案的帳號。
- Gmail 搜尋工具看不到垃圾郵件匣，需請使用者確認信件位置。
- 只用 chrome-devtools（Chromium）操作；行動版僅以 390×844 模擬檢查首頁、`/auth`、`/dashboard`，未做真機或多瀏覽器檢查。
- 未做效能／壓力測試。

---

## 8. 目前留存的測試資料（2026-09-20 ~13:10 本地／05:10Z 之後狀態）

| 路線 | 狀態 | 訂單 | 備註 |
|---|---|---|---|
| `TPE-TYO` | `cancelled` | `FPMU8IP18O712217`（B4 每日訂單，ECPay 已終止） | `total_success_times` 2；服務至 2026-10-19 23:57Z |
| `TPE-SEL` | `cancelled` | `FPMU8I7IZE1L0Z63`（ECPay `停用成功`） | 服務至 2026-10-19 14:50Z；於 05:10:40Z 由 dashboard 取消，**非 assistant 操作**（log 顯示瀏覽器的 CORS preflight 後接取消，推測為使用者整理） |
| `TPE-LON` | **`active`**（handoff 記錄；**2026-09-21 dashboard 已顯示「已取消 · 有效至 2026/10/19」**，見 4.6 觀察 5） | `FPMU8I5Y0K3J125F`（月訂單） | 目標價 22000；`current_period_end` 2026-10-19 14:49Z。`k***@gmail.com` 的三條航線目前都是 `cancelled`；ECPay 端是否已停用尚未確認 |
| `k***@yahoo.com.tw`／`TPE-TYO` | **`active`**（2026-09-21 查詢） | 未記錄（handoff 沒有此筆） | 目標價 7000；`current_period_end` 2026-10-20 12:58Z。**這是仍在運作、ECPay stage 排程會續扣的訂閱**，也是 cron 對 `f385ba49-…／TPE-TYO` 顯示 `skipped (deduped)` 的那位使用者 |
| `k***@yahoo.com.tw`／`TPE-SEL` | `pending_payment`（2026-09-21 查詢） | — | 目標價 6000；尚未付款，不會被通知 |

- `cancelled` 的列在 `current_period_end` 前仍會收到通知，之後由 parser 轉 `expired`。
- 較早的訂單 `FPMU8DUXVA5K5Z3B`、`FPMU8GFF402A0U33`（Tokyo）皆已在 ECPay 取消。
- `notification_history`：為繞過去重而調高的價格皆已還原；刻意保留的列（因為信真的寄出）：`TPE-TYO` NT$6,579（13:35Z、14:02Z）、NT$6,610（14:04Z）；`TPE-SEL` NT$5,127、`TPE-LON` NT$20,345（皆 14:51Z）。
- 測試期間曾暫時以自簽回呼調高 Tokyo 的計數與期限，已還原。
- 全程未產生任何真實扣款。

**2026-09-21 後半輪新增的測試資料（已清理）**：使用者執行 `test-cleanup.sql` 後，唯讀查詢確認測試帳號 0 個、測試列 0 筆、`auth.users` 總數回到 25、`fare-finder-pro` 標記帳號仍為 5 個、`flight.subscriptions` 剩下的 5 筆皆屬於 `k***@gmail.com`（3 筆 `cancelled`）與 `k***@yahoo.com.tw`（`active`、`pending_payment` 各 1 筆），沒有波及真實資料。以下為清理前的狀態紀錄：

| 資料 | 狀態 | 備註 |
|---|---|---|
| 測試帳號 `k***+fe07a@gmail.com`（id `8b7871c2-7c60-4ec3-99c4-ca5a341243d2`） | 已驗證、`apps = ["fare-finder-pro"]`；密碼為測試用字串 | 共用 `auth.users` 中的一個一次性帳號 |
| 其名下 `flight.subscriptions`：`seoul`／`TPE-SEL`（`FPTESTG5A0001`） | `active`，`target_price = 1`，`current_period_end` 2026-10-21 | G5 測試列 |
| 同上：`london`／`TPE-LON`（`FPTESTG6A0001`） | `expired`，`payment_failed_at` 已設定 | G6 測試列 |
| 同上：`tokyo`／`TPE-TYO`（`merchant_trade_no = ' '`） | `active`，`target_price = 1`，email 為測試帳號 | C3／E6 共用的測試列 |

- 這些列 `target_price = 1`，parser 不會比對到，所以不會寄降價信；也沒有任何 ECPay 訂單與之對應。
- **清理方式（已執行）**：`supabase db query --linked --file test-cleanup.sql` 刪除該測試帳號（以 id＋email 限定），`flight.subscriptions.user_id` 為 `ON DELETE CASCADE`，三筆測試列一併刪除。
- 使用者信箱中另有本輪產生的測試信：確認信（垃圾郵件匣）、重設信、G6 的兩封信（收件匣）。

---

## 9. 結論與建議

**判定：**
- **M1：通過**（27／28 ✅，H3 僅程式碼審查）。
- **M2：通過**（後端；checklist 21／21，含真實排程續扣；阻擋項 F 通過）。
- **前端與登入流程：通過**（12／12；FE-01～12 皆有執行記錄）。
- **整體：後端與前端功能都通過，91 個用例中沒有失敗、沒有缺少記錄。註冊確認信進垃圾郵件（K-6）已改善（新範本已部署，並在另一個信箱進了收件匣），建議再加 DMARC 並持續觀察；進入 M3 前需完成正式特店與正式前端。（K-3 已於 2026-09-21 處理。）**

**建議的後續行動（依優先順序）**
1. ~~釐清 `pm.demo@example.com` 是如何取得本 app 標記的~~ **已結案（不再追查）**：使用者表示可能是很早期的 session 測試時建立，決定不處理。此為使用者的說明，**未經資料佐證**（稽核日誌無紀錄）。FE-06 已於 2026-09-21 重測通過（`pm3.demo@example.com`，見 4.1），未標記帳號被拒的行為已驗證。B-1 仍維持開放，不因此結案（K-3 已於 2026-09-21 處理，見第 6 章）。路由守衛（FE-10）、登出（FE-12）、dashboard 行動版（FE-02）已於 2026-09-21 通過。
2. ~~補測剩餘的後端負面案例~~ **已完成**：A4、A5、B6、C3、E6、G5、G6、SEC-02、SEC-07 皆於 2026-09-21 通過。
3. ~~清理測試資料~~ **已完成**：測試帳號 `k***+fe07a@gmail.com` 與其三筆測試列已刪除並驗證（見第 8 章）。
4. **處理 K-6（確認信進垃圾郵件）——已改善，剩收尾**：`send-email` 已加純文字版並改寫範本（產品名稱、原因、忽略說明），2026-09-21 部署為 v9；在另一個信箱驗證進了收件匣。剩餘：(a) 在 DNS 加 DMARC（DNS 已確認 SPF／DKIM 正常，缺 `_dmarc`）；(b) 若要更有把握，用非 Gmail 信箱（Outlook／Hotmail）再測一次；(c) ~~清除測試帳號 `fe07b` 與 `k6`~~ 已完成（見 K-6 一列）。
5. **評估登出範圍**：見 4.6 觀察 4，決定是否把 `signOut()` 改為 `scope: "local"`，避免在共用專案中登出所有 app。
6. ~~決定 K-3~~ **已完成（2026-09-21）**：決定以程式碼為準，`docs/shared-supabase-auth.md` 與 `README.md` 已改成描述實際行為。
7. **處理 K-7、K-8、K-9**（生命週期信件的細節）：K-7 兩封矛盾信件與 K-8 寄信失敗不重試較值得優先評估；K-9 確認是否為刻意設計。
8. **確認 stage 訂閱的實際狀態，並更新 handoff**：(a) `TPE-LON` handoff 記為 `active`，但 2026-09-21 dashboard 顯示已取消（見 4.6 觀察 5），請在 ECPay stage 後台確認月訂單 `FPMU8I5Y0K3J125F` 確實已停用；(b) **`k***@yahoo.com.tw` 有一筆 `active` 的 `TPE-TYO`（服務至 2026-10-20）與一筆 `pending_payment` 的 `TPE-SEL`，handoff 沒有記錄**，其 ECPay stage 月訂單會持續續扣，請決定是否保留並補進 handoff 的測試資料清單。
9. **M3 上線前**：改用正式特店（MerchantID／HashKey／HashIV）、`ECPAY_ENV=prod`、設定真實 `SITE_URL`、部署最終前端（Vercel 目前不是最終程式碼），並以 prod 環境重跑第 8 章；同時補驗第 7 章的 `total_success_times = 1` 與金額欄位名稱。
10. 把自簽 CheckMacValue 回呼腳本（`b6-merchantid.mjs`、`period-callback.mjs`、`ecpay-cancel-probe3.mjs`，目前只存在於 session scratchpad）收進 repo，並把 H3、G5、G6、E6 等分支轉為可重複執行的自動化測試。

---

## 附錄 A：證據來源對照

| 內容 | 來源 |
|---|---|
| M1 驗收表、H5、去重與重寄 | `docs/m1-session-handoff.md`「Where things stand」 |
| M2 狀態表與 checklist 全部項目 | 同上「M2 status」「M2 checklist run」 |
| B4 真實排程續扣 | 同上「B4 — PASSED」 |
| 三種生命週期 email | 同上「M2 follow-up」「follow-up 2」 |
| 取消修正與 dashboard 樣式 | 同上「M2 follow-up 3」 |
| trigger 加固與 rollback-only 驗證 | 同上「Known issues / open items」 |
| 用例定義與編號 | `docs/test-plan.md`、`.claude/skills/m1-…-checklist`、`m2-…-checklist` |
| 匯出的 session 記錄 | 專案根目錄 `no_1_…` ～ `no_5_…` 的 `.txt` |
| 2026-09-21 補測（FE-01～12、SEC-02、SEC-07、A4、A5、B6、C3、E6、G5、G6） | 本次 session 直接執行的 chrome-devtools、`curl`、Node 自簽腳本輸出，以及 Supabase MCP 的唯讀 SQL 與 log 查詢、Gmail 搜尋，見 4.6、4.7 |
