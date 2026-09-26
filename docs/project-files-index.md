# 專案文件索引

列出 repo 內非程式碼的 `.md` / `.txt` 檔案，說明各自的用途。排除 `.vercel/`、`public/`、`.claude/` 等框架或工具自動產生的檔案。

## 專案說明文件（根目錄）

| 檔案 | 用途 |
| --- | --- |
| `README.md` | 產品需求說明：Flight Price Notifier 的頁面規格（landing page、feature cards 等），原始建置需求文件。 |
| `CLAUDE.md` | Claude Code 的專案指引：架構總覽、前後端慣例、部署指令、常見陷阱，開發前必讀。 |
| `AGENTS.md` | Lovable 同步注意事項：連接分支不可 force-push / rebase / amend 已推送的 commit。 |
| `supabase-auth-多app-權限管理.md` | 共用 Supabase 專案下，多個 App 共用 `auth.users` 時的權限管理方案設計稿（做法比較、trade-off）。 |
| `supabase-auth-多app-權限管理_claude_plan.md` | 對上一份設計稿的技術拆解與實作計畫，後來落地為 `flight.tag_app_metadata_on_signup()` trigger 與 `docs/shared-supabase-auth.md` 的共用 auth 慣例。 |

## `docs/` 資料夾

| 檔案 | 用途 |
| --- | --- |
| `docs/m1-session-handoff.md` | 專案的 living 狀態文件：目前部署了什麼、已驗證過什麼、留下的測試資料、經驗教訓、待辦（backlog，例如 B-1 admin 存取控制）。動 payment / cron / Edge Functions 前必讀。 |
| `docs/shared-supabase-auth.md` | 共用 Supabase 專案下的 auth 隔離慣例說明：`apps` tag 只是 client 宣告、不能當作授權依據，真正的存取控制要用 `auth.uid()`。 |
| `docs/change-site-url.md` | 更換網站網址（例如改用公司網域）時要改的地方：`SITE_URL` secret、Supabase Auth Redirect URLs、Vercel 網域、ECPay 導回 origin 允許清單，以及不用改的項目與驗證步驟。 |
| `docs/travelpayouts-limits-and-monitoring.md` | Travelpayouts API 的使用限制（每分鐘請求數、429）、航線數的容量估算與擴充做法，以及如何分析 admin「查價紀錄 Price checks」（`/admin/runs`、`flight.parser_runs`）：狀態判斷、問題種類與處理方式、趨勢查詢 SQL。 |
| `docs/test-plan.md` | 手動測試計畫：把 M1/M2 驗收清單、handoff 記錄整理成可重複執行的測試項目（無自動化測試框架）。 |
| `docs/test-report.md` | 對應 `test-plan.md` 的測試報告，彙整已執行/未執行的用例結果。 |
| `docs/ppt-outline.md` | 產品功能介紹簡報的投影片大綱（18 張、20–25 分鐘），含截圖存放路徑與遮蔽帳號的提醒。 |
| `docs/ppt-outline_1.1_user.md` | 給一般使用者的簡報大綱 v1.1：只含免費訂閱，不含管理員、綠界付款與技術內容；含截圖清單（`ppt-screenshots/16`–`32`）。 |
| `docs/flight-price-notifier_v1.1_user_2026_0926.pptx` | 依 v1.1 大綱產生的 15 張使用者簡報。 |
| `docs/deck/` | 產生上述簡報的腳本（`build.js`，獨立的 `package.json`，不屬於 app）；用法見該資料夾的 `README.md`。 |
| `docs/project-files-index.md` | 本檔案：專案文件索引。 |

## 其他

| 檔案 | 用途 |
| --- | --- |
| `src/routes/README.md` | TanStack Start 檔案式路由慣例說明（`_layout.tsx`、`__root.tsx`、動態/選用/splat 路由命名規則）。 |

## Session 匯出紀錄（`no_*.txt`）

Claude Code 對話紀錄的匯出檔，非程式碼，依序記錄各次開發工作：

| 檔案 | 對應工作 |
| --- | --- |
| `no_1_run_m1-code-flight-price-checker_2026_0917.txt` | 啟動並建置 M1（免費版降價通知器：訂閱、pg_cron 抓價、Email 通知）。 |
| `no_2_run_m1-code-flight-price-continue_2026-09-19.txt` | 接續 M1 建置。 |
| `no_3_run_m1-code-flight-price-checker_ 2026-09-19.txt` | M1 驗收（checklist）。 |
| `no_4_set_chapter_8_2_2026-09-19.txt` | 課程章節相關設定工作。 |
| `no_5_run_m2-code-ecpay-subscription-xx_2026-09-20.txt` | 啟動並建置 M2（接 ECPay 定期定額金流、付費才通知）。 |
| `no_6_run_test_2026-09-21.txt` | 依 `docs/test-plan.md` 執行測試、補齊未執行用例，產出 `docs/test-report.md`。 |
| `no_7_create_ppt_2026-09-21.txt` | 製作功能介紹簡報（`docs/ppt-outline.md`）。 |
| `no_8_fix_pay_return_url_2026-09-21.txt` | 修正 ECPay 付款完成後導回原站網址的問題。 |
| `no_9_fix_flight_url_2026-09-22.txt` | 修正通知信裡 Aviasales 訂購連結的日期格式問題。 |
| `no_10_add_admin_2026-09-22.txt` | 新增 admin 唯讀後台（`/admin`）與手動觸發降價通知功能。 |
| `no_11_check_tickets_raw_data_2026-09.txt` | 查票價掃描（`flight-parser`）觸發機制與手動測試腳本（`supabase/scripts/manual-flight-parser-run.sql`）；修掉 `routeTree.gen.ts` 因行尾符號造成的假 diff（新增 `.gitattributes`）；臨時加 log 撈 Travelpayouts 原始回應後移除並重新部署。 |
| `no_12_change_to_v3_api_2026-09-23.txt` | 查手動通知信「看不到」的原因（Gmail 同主旨併入對話串、送達延遲）；改用 Travelpayouts v3 API 觸發通知，信中列出航班詳情（航空公司、航班號、去回程起降時間、飛行時間、轉機、機場）並附 v1 對照（`flight.routes.last_offer_v3` / `last_offer_v1`）；信中註明來回票價僅適用所列日期、dashboard 標示「來回」；`/admin` 新增 v1 對照開關（`flight.settings`、`flight-admin-settings`）。 |
| `no_13_payment_1_2026-09-23.txt` | 討論（未實作）admin「是否需要付款」開關：關閉時免費訂閱一個月、到期自動取消、取消立即生效；決定可無限重新訂閱，切回付款時免費訂閱保留到到期。 |
| `no_14_sendmail_ref_app_name_2026-09-24.txt` | 討論換網址對 app 判斷的影響；共用的 `send-email` hook 改成依 `redirect_to` 的 `?app=` 選擇各 app 的寄件人與信件標題（`APPS` 白名單，找不到時用 `user_metadata.app`，再不行用通用身分），前端註冊、密碼重設都帶上 `?app=`，並實測驗證信與重設信。 |
| `no_15_payment_2_2026-09-24.txt` | 實作 no_13 的 admin「使用綠界付款／不需付款」開關：`flight.settings.payment_required`、`subscriptions.payment_method`（`ecpay`／`free`）、免費訂閱一個月、到期不留寬限期、取消立即失效、`/admin` 營收只計付費；部署後用 chrome-devtools 端對端驗證（含 cron 到期與四封狀態信）。另整理換公司網域的檢查清單 `docs/change-site-url.md`。 |
| `no_16_admin_add_page_and_force_2026-09-24.txt` | `/admin` 拆成多頁（總覽、註冊用戶、所有訂閱、通知紀錄）並加分頁、修正切換分頁的延遲；新增註冊本 app 的用戶列表；admin 看到的航線改顯示中文名稱；新增測試用「強制到期」開關（`force_expire_enabled`），開啟時 admin 可把 `cancelled` 訂閱逐筆立即改為 `expired`（`flight-admin-expire`）。 |
| `no_17_set_final_url_2026-09-25.txt` | 移除使用者看得到的「v3」字樣（通知信標題、admin 設定說明）；網站改用正式網域 `https://flights.roberthut.com`（`SITE_URL`、`ALLOWED_ORIGINS`、Auth Redirect URLs）並在新網域實測註冊與 ECPay 付款；找到並修正 email 含 `+` 的使用者付款後無法啟用的問題（`flight-ecpay-return` 改用交易編號查詢）；註冊與忘記密碼改成只輸入 email，密碼一律在信中連結的 `/auth/reset` 設定；更新測試計畫、測試報告與相關文件。 |
