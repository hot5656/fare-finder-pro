# Flight Price Notifier 測試計畫（Test Plan）

版本日期：2026-09-21
依據資料：`docs/m1-session-handoff.md`、`docs/shared-supabase-auth.md`、`README.md`、
`.claude/skills/m1-code-flight-price-checker-checklist`、`.claude/skills/m2-code-ecpay-subscription-checklist`，
以及 `src/`、`supabase/` 內的實際程式碼。

> 本文件把既有的驗收清單（M1 / M2 checklist）、handoff 文件記錄的實測結果與程式碼行為，
> 整理成一份可重複執行的測試計畫。**沒有自動化測試框架**（`package.json` 無 test script），
> 所有測試皆為手動或以 SQL / curl / 瀏覽器 console 驅動，直接打真實的共用 Supabase 專案。

---

## 1. 目的與範圍

### 1.1 目的
確認下列端到端流程正確、安全、且每一種通知只寄一次：

1. 使用者註冊／登入，且只有標記過本 app 的帳號能進入 dashboard。
2. 使用者訂閱航線（東京、首爾、倫敦）並設定 TWD 目標價。
3. 透過 ECPay 信用卡定期定額付費（NT$300／月），只有付費者收得到降價通知。
4. `pg_cron` 每 30 分鐘觸發 `flight-parser` 抓最低價，達標者經 `flight-notification` 去重後寄信。
5. 訂閱生命週期 `pending_payment → active → cancelled（寬限期）→ expired` 與對應 email。

### 1.2 範圍內
| 層級 | 項目 |
|---|---|
| 前端 | 首頁、`/auth`、`/auth/reset`、`/_authenticated` 路由守衛、`/dashboard` |
| 資料庫 | `flight` schema（`routes`、`subscriptions`、`notification_history`）、RLS、grants、`pg_cron` |
| Edge Functions | `flight-subscribe`、`flight-ecpay-return`、`flight-ecpay-period`、`flight-ecpay-result`、`flight-cancel-subscription`、`flight-parser`、`flight-notification`、`flight-status-notification`、`send-email` |
| 整合 | ECPay stage cashier、Travelpayouts 票價 API、Resend 寄信 |

### 1.3 範圍外
- ECPay **正式環境**（prod merchant、真實扣款）：屬 M3 上線前測試，目前全程在 stage 共用特店 `3002607`。
- 其他共用同一 Supabase 專案的 app（`project-management`、`udemy-coupon`）自己的功能。
- Vercel 上的 `fare-finder-pro.vercel.app`：**不是最終程式碼**，除非被要求，不在其上測試或部署。
- 效能／壓力測試、無障礙完整稽核、瀏覽器相容性矩陣（目前無需求，列為後續項目）。

---

## 2. 測試環境

| 項目 | 設定 |
|---|---|
| 前端 | `npm run dev` → `http://localhost:8080`（port 固定） |
| 後端 | Supabase 專案 `luugfvsrawnuzwpjvddt`（共用、多 app） |
| 金流 | ECPay **stage**：`ECPAY_ENV=stage`、MerchantID `3002607`、`ECPAY_AMOUNT=300` |
| 寄信 | Resend，寄件人 `noreply@roberthut.com` |
| 票價 | Travelpayouts（`TRAVELPAYOUTS_TOKEN`） |
| 工具 | `supabase` CLI（已 link）、Supabase MCP（`execute_sql`、`query_logs`）、`curl`、Node（自簽 CheckMacValue 腳本）、chrome-devtools / 瀏覽器 |
| 測試信箱 | 使用者自己的信箱（例：`k***@gmail.com`）；其他收件人不保證收得到信 |

### 2.1 前置條件
- `.env` 含 `VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`、`SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY`（兩組指向同一專案）。
- Edge secrets 已設定：`RESEND_API_KEY`、`SEND_EMAIL_HOOK_SECRET`、`TRAVELPAYOUTS_TOKEN`、`ECPAY_MERCHANT_ID`、`ECPAY_HASH_KEY`、`ECPAY_HASH_IV`、`ECPAY_ENV`、`ECPAY_AMOUNT`（`SITE_URL` 未設，預設 `http://localhost:8080`）。
- Vault 內有 `flight_service_role_key`（cron 用）。
- Supabase Auth 的 Redirect URLs 包含 `http://localhost:8080/**`。
- 三支 ECPay 回呼函式 `verify_jwt = false`；其餘見 `supabase/config.toml`。

### 2.2 讀取 log 的方式
- CLI 沒有 `supabase functions logs`；用 Dashboard 或 Supabase MCP `query_logs`（`function_edge_logs` 看狀態碼、`function_logs` 看 `console.log`）。
- log 約延遲 1 分鐘；「沒看到某行」不等於沒發生，須與 DB 交叉確認並重查一次。
- 從 SQL 觸發 `flight-parser` 時，`net.http_post` 要帶 `timeout_milliseconds := 60000`，否則預設 5 秒會逾時看不到回應。

---

## 3. 測試策略

| 類型 | 做法 |
|---|---|
| 功能（手動） | 依第 5–10 章用例，在 `localhost:8080` 以真實帳號操作 |
| API／後端 | `curl` 直接打 Edge Function；SQL 讀寫驗證資料狀態 |
| 安全 | 無 bearer／偽造 CheckMacValue／以使用者身分嘗試自我啟用（RLS） |
| 金流整合 | ECPay stage cashier 真實走一次；其餘用「自簽 CheckMacValue」回呼腳本（stage HashKey/HashIV 為公開值） |
| 只寄一次（冪等） | 重送相同回呼／重跑 parser，斷言 email 數量與 `flight-status-notification` 呼叫次數 |
| 回歸 | 每次改動 Edge Function、migration、RLS 後，重跑第 11 章冒煙清單 |

### 3.1 關鍵斷言原則
- **付費門檻用 `flight-parser` 回傳的 `matches` 數量判斷**，不要用「沒收到信」——去重機制可能遮蔽錯誤納入的訂閱者。
- 「有 match」不等於「有寄信」：寬限期案例必須確認 `notification_history` 新增一列且信真的到。
- 測試會動到正式資料，**凡是回填／改期／調高的欄位（`notification_history.price`、`current_period_end`）都要記錄並還原**。
- 高風險寫入測試優先用「rollback-only」：`DO` 區塊執行後 `raise exception` 讓交易整個回滾，再重讀確認沒殘留。

---

## 4. 測試資料

| 資料 | 說明 |
|---|---|
| 路由 | `TPE-TYO`（tokyo）、`TPE-SEL`（seoul）、`TPE-LON`（london，migration 新增） |
| 測試帳號 | 已標記 `fare-finder-pro` 的帳號；另備一個「未標記」帳號、一個「別的 app 已註冊」的 email |
| ECPay 測試卡 | `4311-9522-2222-2222`、`12/30`、CVV `222`、OTP `1234`（持卡人姓名／電話填通用假資料，勿用真實個資） |
| 目標價 | 高於現價（必達標，如 999999 或 10000）與低於現價（不達標，如 4000 vs 5127）各一組 |
| 目前留存的 stage 資料（見 handoff） | `TPE-LON` **active**（月訂單 `FPMU8I5Y0K3J125F`）；`TPE-TYO`、`TPE-SEL` **cancelled**（服務至約 2026-10-19）。開始新一輪測試前先確認現況，勿覆蓋未還原的資料 |

---

## 5. 進入／退出準則

**進入**：第 2.1 節前置條件全部成立；`npm run dev` 可啟動；`supabase functions list` 顯示所有函式 `ACTIVE`。

**退出（M2 通過）**：
- 第 6–10 章所有「必測」用例通過，且 **F（RLS 自我啟用）為阻擋項，必須通過**。
- 無「重複寄信」缺陷（每種通知每次事件只寄一封）。
- 未通過項目皆已記錄原因與處置。

---

## 6. 前端與登入測試

依 `README.md` 需求與 `src/routes/auth/index.tsx`、`src/routes/_authenticated/route.tsx` 實際行為。

| ID | 用例 | 預期 | 目前狀態 |
|---|---|---|---|
| FE-01 | 開啟 `/` | 顯示 "Flight Price Notifier"、中文主標語與英文副標、右上角 "Sign in / 登入"、三張功能卡、頁尾 "© 2026 Flight Price Notifier" | 未於 handoff 記錄，待驗 |
| FE-02 | 行動版寬度檢視首頁／`/auth`／dashboard | 版面不破、無水平捲軸 | 待驗 |
| FE-03 | `/auth` 登入模式 | 標題 "Welcome back．登入"；Email placeholder `you@example.com`；密碼欄；切換連結 "No account yet? Create one" | 待驗 |
| FE-04 | 以已標記本 app 的帳號登入 | 導向 `/dashboard` | ✅ 已在 M1／M2 實測中使用 |
| FE-05 | 密碼錯誤登入 | 顯示 Supabase 錯誤訊息，不導頁 | 待驗 |
| FE-06 | 帳號存在、密碼正確，但 `app_metadata.apps` **未含** `fare-finder-pro` | 登出並顯示 "Invalid login credentials"，不進 dashboard（嚴格隔離，登入頁不自動加標記） | 待驗（程式碼已實作） |
| FE-07 | 全新 email 註冊 | 帶 `data.app = fare-finder-pro`；需信箱驗證時顯示確認提示並切回登入模式 | 待驗 |
| FE-08 | 註冊時 email 已被別的 app 使用、且密碼**相符** | 依現行程式碼：登入後 `updateUser({data:{app}})` 補標記並導向 dashboard | 已於 2026-09-21 執行，見測試報告。原本與 `docs/shared-supabase-auth.md`、README 的描述有出入，兩份文件已於同日改成描述實際行為 |
| FE-09 | 註冊時 email 已被別的 app 使用、密碼**不符** | 寄出密碼重設信，顯示說明訊息並切回登入模式；點連結至 `/auth/reset` 設定新密碼後才補標記 | 待驗 |
| FE-10 | 未登入直接開 `/dashboard` | 導向 `/auth` | 待驗 |
| FE-11 | 驗證信／重設信連結導向 | 導回 `localhost:8080`，不出現 `otp_expired` 或導到無法開啟的網址 | 待驗（依 Redirect URLs 設定） |
| FE-12 | 登出 | 導向首頁 `/`（`handleSignOut` 的設計）、session 從 storage 清除；之後再開 `/dashboard` 被導到 `/auth` | 待驗（程式碼有 `signOut`，handoff 無專門測試記錄） |

---

## 7. M1：訂閱、抓價、寄信

對應 `m1-code-flight-price-checker-checklist`（A–L）。M1 已於 2026-09-18 驗收通過，M2 之後部分項目的條件已改變（標註於備註）。

### 7.1 資料庫與資料表（A）
| ID | 用例 | 預期 | 狀態 |
|---|---|---|---|
| A1 | 查 `information_schema.tables` | `flight` 有 `routes`、`subscriptions`、`notification_history` | ✅ |
| A2 | 查 `pg_class.relrowsecurity` | 三張表皆 RLS enabled | ✅ |
| A3 | 查 `flight.routes` | `tokyo→TPE-TYO`、`seoul→TPE-SEL`（另有 `TPE-LON`），`display_name` 合理 | ✅ |
| A4 | 查 `subscriptions` 欄位 | M1 時**沒有** `subscription_status`；**M2 起改為必須有**，另有 `merchant_trade_no`（唯一）、`current_period_end`、`payment_failed_at`、`total_success_times` | M1 ✅ / M2 已更新 |

### 7.2 秘密與部署（B）
| ID | 用例 | 預期 | 狀態 |
|---|---|---|---|
| B1 | `supabase secrets list --output json`（只看名稱） | 含 `TRAVELPAYOUTS_TOKEN`、`RESEND_API_KEY` 等 | ✅ |
| B2 | `supabase functions list` | 各函式 `ACTIVE`（比對 `ezbr_sha256`／`updated_at`，不看 version 數字） | ✅ |
| B3 | 瀏覽器 console 以登入身分 `supabase.schema('flight').from('routes').select('*')` | 回傳資料，無 `PGRST` schema 錯誤（`config.toml` 的 exposed schemas 含 `flight`） | ✅ |

### 7.3 訂閱寫入與 RLS（C、D、E）
> M2 起前端不再直接寫 `subscriptions`，寫入改走 `flight-subscribe`（見第 8 章）。下列 RLS 讀取項目仍有效。

| ID | 用例 | 預期 | 狀態 |
|---|---|---|---|
| C3 | 以登入使用者嘗試寫入他人 `user_id` | 被拒（`42501`） | ✅（M2 後所有客戶端寫入皆 `42501`） |
| D2 | 在網站送出真實表單 | `subscriptions` 出現正確 `user_id`／`email` 的列 | ✅（M2 後為 `pending_payment`） |
| E1 | 訂閱並重新整理 | 卡片顯示 已訂閱 badge、儲存的目標價、更新目標價按鈕 | ✅ |
| E2 | 多位訂閱者存在時以使用者身分查詢 | 只回傳自己的列 | ✅（他人查詢為 0 列） |

### 7.4 抓價與比對（F、G、H）
| ID | 用例 | 預期 | 狀態 |
|---|---|---|---|
| F2 | 讀 `flight-parser` 原始碼 | 比對結果直接 POST 給 `flight-notification`（每批 25），沒有佇列 | ✅ |
| G1 | 以 service-role bearer 呼叫 `flight-parser` | `200`，回 `{"routes":N,"matches":N}` | ✅ |
| G2 | 不帶 bearer 呼叫 `flight-parser` | `401` | ✅ |
| G3 | 看 log 的 TWD 票價 | 合理區間；`routes.last_checked_at` 更新 | ✅ |
| H1 | 目標價高於現價的訂閱者（且已付費） | `matches` 含該人；`flight-notification` 收到 | ✅ |
| H2 | 收到的 payload | `cheapest`（TWD）必有；`cheapest_usd` 僅在 USD 抓取成功時出現 | ✅ |
| H3 | USD 抓取失敗 | 仍以 TWD-only 交付，不跳過訂閱者、不中斷整批 | 🟡 只驗證過程式碼 |
| H5 | 目標價**低於**現價 | 不在 match 內、無 `notification_history` 新列（例：Seoul 目標 4,000 vs 5,127） | ✅ |

### 7.5 排程（I）
| ID | 用例 | 預期 | 狀態 |
|---|---|---|---|
| I1 | 查 `pg_extension` | `pg_cron`、`pg_net` 皆存在 | ✅ |
| I2 | 查 `cron.job` | `flight-price-check`、`*/30 * * * *`、`active = true` | ✅ |
| I3 | 查 `cron.job_run_details` 與 `routes.last_checked_at` | 每個整點／半點觸發；`succeeded` 只代表請求已排入，須以 `last_checked_at` 或 edge log 確認真的執行 | ✅ |

### 7.6 寄信與去重（J、K、L）
| ID | 用例 | 預期 | 狀態 |
|---|---|---|---|
| J2 | 不帶 bearer 呼叫 `flight-notification` | `401` | ✅ |
| J3 | 去重參數 | `NOTIFY_FLOOR_HOURS=24`、`REALERT_PCT=20`、`REALERT_ABS_TWD=2000` | ✅ |
| K2 | 收信 | 主旨 `✈️ 台北 → 東京 降價通知！NT$… 已達標`；NT$ 主標、約 US$ 小字、目標價、立即訂購按鈕 | ✅ |
| L1 | 24 小時內重跑 parser | 不再寄第二封、無新 history 列 | ✅（「skipped (deduped)」log 行本身未見到） |
| L2 | 查 `notification_history` | 有 `sent_at`、`price` 的新列 | ✅ |
| L3 | 現價比上次通知價低 ≥20% 或 ≥NT$2,000 | 再寄一封，新增 history 列（把最新一列 `price` 調高到 9,500 測，**測完還原**） | ✅ |

---

## 8. M2：ECPay 付費牆

對應 `m2-code-ecpay-subscription-checklist`（A–G）。M2 於 2026-09-19 至 09-20 完整通過（21／21）。

### 8.1 結帳表單與秘密（A）
| ID | 用例 | 預期 | 狀態 |
|---|---|---|---|
| A1 | 查 ECPay secrets 名稱 | 五個 `ECPAY_*` 皆在；`ECPAY_AMOUNT` 為正整數（300） | ✅ |
| A2 | 以使用者 JWT POST `flight-subscribe`（`{plan_name, target_price}`） | `text/html` 自動送出表單；action 指向 cashier（`AioCheckOut/V5`）；含 `CheckMacValue`、`PeriodType=M`、`PeriodAmount = TotalAmount = 300`；`ReturnURL`／`PeriodReturnURL`／`OrderResultURL` 為完整函式 slug。Body 中多送的 `route` 被忽略 | ✅ |
| A3 | 查該列 | `subscription_status = pending_payment`，`merchant_trade_no` 已寫入 | ✅ |
| A4 | 不帶／帶無效 JWT 呼叫 `flight-subscribe` | `401`；body 內任何 email／user_id 皆不被採信 | 程式碼已實作，建議補測 |
| A5 | `target_price` 為 0、負數、非數字或缺 `plan_name` | `400`，不建立列 | 程式碼已實作，建議補測 |

### 8.2 回呼驗證與啟用（B）
| ID | 用例 | 預期 | 狀態 |
|---|---|---|---|
| B1 | 三個 ECPay 函式 `verify_jwt=false`；POST 偽造 body（`CheckMacValue=DEADBEEF`） | 回 `0|CheckMacValue error`（HTTP 200），**不是** 401 | ✅ |
| B2 | 自簽 `SimulatePaid=1` 的合法回呼 | `CMV verified`、`1|OK`，列**維持** `pending_payment` | ✅ |
| B3 | ECPay stage 測試卡實際付款 | 列 → `active`、`current_period_end` +1 個月、`total_success_times`＝1；回 `1|OK` 只被呼叫一次 | ✅（`total_success_times=1` 為程式碼審查，真實首扣未另驗） |
| B4 | 每日週期訂單（臨時 `PeriodType=D, ExecTimes=2`）等 ECPay 排程真實續扣 | 收到 `TotalSuccessTimes=2` 的回呼、`1|OK`、`current_period_end` 更新、`payment_failed_at` 為 null | ✅ 2026-09-19 23:57:11Z 通過（測後已還原月訂閱程式碼） |
| B5 | POST `flight-ecpay-result` | `302` → `${SITE_URL}/dashboard?purchase=success`；付款後瀏覽器實際落地該頁、卡片變 已訂閱（有效） | ✅ |
| B6 | 回呼的 `MerchantID` 與設定不符 | `0|MerchantID mismatch` | 程式碼已實作，建議補測 |
| B7 | 回呼中保留空字串欄位（`CustomField3=`、`CustomField4=`）計算 CMV | 驗證通過（丟掉空欄位會導致 CMV 錯誤） | ✅（隱含於 B3、B4） |

### 8.3 狀態通知函式（C）
| ID | 用例 | 預期 | 狀態 |
|---|---|---|---|
| C1 | 付款成功後 | 收到 `訂閱成功！台北 → 東京 降價通知已開始`（含 每月扣款 NT$300、服務期間至 …） | ✅ |
| C2 | 對 `flight-status-notification` 送未知 `event_type`（帶 service-role bearer） | `400`；不帶 bearer → `401`；五種事件各有明確分支（`welcome`／`cancel`／`expired`／`payment_failed`／`renewed`），無 fallthrough | ✅ |
| C3 | Resend 拒絕寄送（測法：測試列 email 設為非法字串，觸發 `payment_failed`，Resend 回 422） | 函式回 `502`；回給 ECPay 的仍是 `1|OK` | 已於 2026-09-21 執行，見測試報告 |

### 8.4 付費門檻與寬限期（D）
| ID | 用例 | 預期 | 狀態 |
|---|---|---|---|
| D0 | active 與 pending_payment 各一、目標價皆達標 | `flight-parser` 回 `matches` 為 **1**（不是 2） | ✅ |
| D1 | active 列、目標價高於現價 | 被比對並寄降價信、`notification_history` 新增列 | ✅ |
| D2 | `pending_payment` 列 | 不被比對、不寄信 | ✅ |
| D3a | `cancelled` 且 `current_period_end` 在未來 | `matches` 含該列，**且降價信真的到**（主旨為降價通知而非取消信；用調高最新 history `price` 避開去重，測後還原） | ✅ |
| D3b | `cancelled` 且 `current_period_end` 已過去 | parser 該次 log `expired 1 subscription(s)`、狀態→`expired`、寄一封「已結束」（`period_ended`）、無降價信；第二次跑 parser 完全不寄 | ✅ |
| D4 | `active` 但 `current_period_end` 逾期超過 `RENEWAL_GRACE_DAYS`（7 天，ECPay 6 次失敗後靜默終止的情況） | 轉 `expired`、寄「因為多次扣款未成功…」（`payment_lapsed`） | ✅ |

### 8.5 取消（E）
| ID | 用例 | 預期 | 狀態 |
|---|---|---|---|
| E1 | 已付費訂閱按 取消訂閱 → 確定取消 | ECPay `RtnCode=1 停用成功`；列 → `cancelled`（**不是** `expired`），`current_period_end` 保留；寄取消信；卡片顯示 已取消 · 有效至 … | ✅ |
| E2 | `cancelled`（寬限中）修改目標價 | 回 `application/json`（不是 ECPay 表單）、狀態仍 `cancelled`、無新的 `pending_payment` | ✅ |
| E3 | 完整生命週期 | `expired → active → cancelled → expired` 全走過 | ✅ |
| E4 | 取消一張 ECPay 已自行終止的訂單（`90100149`） | 仍在本地取消：`cancelled`、寄一封取消信、UI 不顯示錯誤 | ✅（2026-09-20 修正後驗證） |
| E5 | 取消一張 ECPay 查無的訂單（`90100150`） | 同上，本地取消 | ✅ |
| E6 | ECPay 回其他錯誤碼（測法：測試列 `merchant_trade_no = ' '`，ECPay stage 對單一空白回 `10200052`；一般壞格式訂單號都回 `90100150`，不能用） | `502`、列**不變**、不寄取消信（避免使用者仍被扣款卻關了通知）；dashboard 顯示 ECPay 訊息（`RtnMsg` 為空時 `detail` 也為空） | 已於 2026-09-21 執行，見測試報告 |
| E7 | 取消流程的 UI：確定取消／保留按鈕 | 有 hover 樣式與 pointer 游標；取消中顯示 `取消中…` 並 disabled | ✅ |
| E8 | 從 `expired` 重新訂閱 | 產生**新的** `merchant_trade_no`；付款後 `active` 並寄 welcome | ✅ |

### 8.6 RLS：使用者不能自我啟用（F，**阻擋項**）
| ID | 用例 | 預期 | 狀態 |
|---|---|---|---|
| F1 | 以登入使用者 `update({subscription_status:'active'})` 與 `insert` | 兩者皆 `42501 permission denied` | ✅ |
| F1b | 查 `role_table_grants` 與 `pg_policies` | `authenticated` 只有 `SELECT`；只剩 `select own subscriptions` 一條 policy | ✅ |
| F2 | 使用者查自己的列 | 仍可讀到自己的 `subscription_status` | ✅ |

### 8.7 生命週期信件只寄一次（G）
可用自簽 `PeriodReturnURL` 回呼（stage HashKey／HashIV、保留空欄位、**不帶 `SimulatePaid`** 以貼近真實）驅動 `flight-ecpay-period`。

| ID | 用例 | 預期 | 狀態 |
|---|---|---|---|
| G1 | 送 `RtnCode=0` | `1|OK`、列維持 `active`、`payment_failed_at` 被設定、寄**一封**扣款失敗信；**再送相同失敗** → `1|OK`、旗標不變、**沒有第二封**（`flight-status-notification` 只被呼叫一次） | ✅ |
| G2 | 之後送 `RtnCode=1` | `payment_failed_at` 清為 null、`current_period_end` 更新 | ✅ |
| G4 | 送 `TotalSuccessTimes` 高於已存 `total_success_times` 的成功回呼 | `1|OK`、計數更新、寄**一封**「本期已扣款」（含金額、期數、新服務期間）；**重送相同回呼** → 不寄（log `already processed`）；`+1` → 再寄一封 | ✅（信件內容版面已由使用者確認） |
| G3 | 各列轉 `expired` | 每列只寄一封；第二次跑 parser 無信 | ✅ |
| G5 | 成功回呼缺 `TotalSuccessTimes` | 延長期間但**不寄**信（寧可漏寄也不重複） | 已於 2026-09-21 執行，見測試報告 |
| G6 | **失敗**回呼且 `TotalSuccessTimes >= ExecTimes`（排程次數已用完） | `flight-ecpay-period` 轉 `expired` 並寄 `expired` 信（同一事件也會先寄一封 `payment_failed`）；重送相同回呼不再寄。此路徑只在失敗回呼上，成功的最後一期不會轉 `expired` | 已於 2026-09-21 執行，見測試報告 |

---

## 9. 資料庫與 auth 觸發器

| ID | 用例 | 預期 | 狀態 |
|---|---|---|---|
| DB-01 | rollback-only：更新自己帳號 `raw_user_meta_data.app` 後讀 `raw_app_meta_data.apps` | `apps` 新增該值；交易回滾後重讀確認無殘留 | ✅ |
| DB-02 | 以 anon 呼叫 `POST /rest/v1/rpc/tag_app_metadata_on_signup` | `404 PGRST202` | ✅ |
| DB-03 | `proacl` 與 `has_function_privilege` | 僅 `postgres`、`supabase_auth_admin` 可執行；`anon`／`authenticated`／`service_role` 為 false；trigger 仍 enabled | ✅ |
| DB-04 | 以 `supabase_auth_admin` 身分實際觸發（真實 GoTrue 註冊／`updateUser`） | trigger 正常寫入 `apps` | 🟡 未驗證（連線無法 `set role supabase_auth_admin`，只驗了權限） |
| DB-05 | 新 migration 套用流程 | `db query --file` 後 `migration repair --status applied`，再讀 `supabase_migrations.schema_migrations` 確認已登錄 | 每次都要做（曾兩度漏登錄） |

---

## 10. 安全測試彙總

| ID | 用例 | 預期 |
|---|---|---|
| SEC-01 | `flight-parser`／`flight-notification`／`flight-status-notification` 不帶 bearer | `401` |
| SEC-02 | 以 anon key 當 bearer 呼叫上述函式（gateway 會放行，函式內須檢查 service-role） | 被函式內比對擋下（`401`） |
| SEC-03 | ECPay 三個回呼函式偽造 CMV | `0|CheckMacValue error`，且不是 gateway 401 |
| SEC-04 | 使用者 JWT 呼叫 `flight-subscribe`／`flight-cancel-subscription` 時在 body 夾帶他人 email／user_id／route | 一律忽略，只用 JWT 與 `flight.routes` 推得的值 |
| SEC-05 | 使用者以自己的 session 直接寫 `flight.subscriptions` | `42501`（見 F1） |
| SEC-06 | 使用者讀 `flight.notification_history` | 無 policy → 讀不到（僅 service role） |
| SEC-07 | 前端 bundle 內搜尋 `SERVICE_ROLE`／`HASH_KEY` | 不得出現；`SUPABASE_SERVICE_ROLE_KEY` 不可加 `VITE_` 前綴 |
| SEC-08 | 任何使用者自行 `updateUser({data:{app}})` 為自己加上 `apps` | **已知行為**：可成功（client-declared tag），且僅影響 UI 路由守衛；確認 RLS 不依賴 `apps`。真正的存取控制列為 backlog **B-1** |

---

## 11. 回歸／冒煙清單（每次部署後跑）

依序執行，全部通過再結束：

1. `npx tsc --noEmit -p .`、`npm run lint`、`npm run build` 皆通過。
2. `supabase functions list --output json`：函式 `ACTIVE`；三個 ECPay 回呼 `verify_jwt=false`（必要時讀已部署的原始碼確認）。
3. 偽造 CMV POST `flight-ecpay-return`／`-period` → `0|CheckMacValue error`（B1）。
4. 不帶 bearer 呼叫 `flight-parser` → `401`（G2）。
5. 觸發 `flight-parser` → `200` 且 `matches` 與「付費且達標」訂閱數一致（D0）。
6. 以登入使用者嘗試 `update`／`insert` `flight.subscriptions` → `42501`（F1）。
7. 登入 → dashboard → 開 `flight-subscribe` 結帳表單確認 cashier 接受（CMV 正確）。
8. 若動到 migration：確認 `schema_migrations` 已登錄。
9. 若動到 `_shared/ecpay.ts`：所有引用它的函式都要重新部署，並確認 `PeriodType=M`、`ExecTimes=999`（測試後務必還原）。

---

## 12. 已知缺口與風險

**未驗證項目**
- `flight-ecpay-return` 於真實首扣是否寫入 `total_success_times = 1`（僅程式碼審查，目前所有航線皆已 active，未做新結帳）。
- 真實續扣回呼中金額欄位名稱（`Amount` 或 `amount`；程式碼 fallback 至 `ECPAY_AMOUNT`，顯示金額不受影響）。
- H3（USD 抓取失敗時 TWD-only 交付）與 DB-04（`supabase_auth_admin` 實際觸發）。
- 取消信、扣款失敗信、降價信的**完整信件內文**（僅見過主旨與摘要）；ECPay 廠商後台看到系列已終止（證據為 `RtnCode=1`）。
- 第 6 章前端用例（首頁內容、行動版、登入流程細節）在 handoff 中沒有逐項記錄，本計畫列為待驗。

**風險與注意事項**
- **文件與程式碼不一致（已處理，2026-09-21）**：`docs/shared-supabase-auth.md` 與 README 原本寫註冊時 email 已存在應一律走密碼重設，但 `src/routes/auth/index.tsx` 在密碼**相符**時會直接 `updateUser` 補標記並登入（FE-08）。已決定以程式碼為準，兩份文件改成描述實際行為（並補充「標籤是使用者自訂、不是權限」的說明）。
- ECPay 只在 stage，尚未用真實特店與 `ECPAY_ENV=prod` 測過；`SITE_URL` 未設，正式上線前必設。
- 歡迎信硬編碼「每月扣款」，若日後提供其他週期需改為由結帳帶入。
- `flight.subscriptions.updated_at` 無 trigger；parser 的 lazy `cancelled → expired` 不會更新它。
- ECPay 在 6 次連續失敗後靜默終止；parser 用 7 天寬限推斷，若 ECPay 實際重試窗口更長需調整 `RENEWAL_GRACE_DAYS`。
- 測試會寄真實 email、寫入共用專案；stage 訂單存在共用後台。測試後須清理或記錄留存資料（見 handoff「Test data left behind」）。
- 自動模式會阻擋正式環境 DDL、部署與手動 parser 執行，這些步驟需由使用者以 `!` 執行。

---

## 13. 測試後清理

- 還原所有調高的 `notification_history.price`、改期的 `current_period_end`（並記錄）。
- 刪除臨時測試訂閱（例：為 H5 建立的 Seoul 測試列）。
- 將不再需要的 stage 訂單於 dashboard 取消；更新 `docs/m1-session-handoff.md` 的「Test data left behind」。
- 若曾臨時改 `_shared/ecpay.ts` 做每日週期測試，確認 repo 與已部署版本都已還原為 `PeriodType: "M"`／`ExecTimes: "999"`。

---

## 14. 後續建議（尚無自動化）

- 把 `flight-parser` 的門檻邏輯、`checkMacValue`、去重規則抽成純函式，補 Deno／Vitest 單元測試。
- 把「自簽 CheckMacValue 回呼」腳本收進 repo（目前只存在於 session scratchpad），並做成可重複執行的整合測試。
- 前端加 Playwright 冒煙測試（登入、路由守衛、訂閱表單）。
- M3 上線前：以真實特店／prod 環境重跑第 8 章，並新增網域、`SITE_URL`、Redirect URLs 的檢查項目。
