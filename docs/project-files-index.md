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
| `docs/test-plan.md` | 手動測試計畫：把 M1/M2 驗收清單、handoff 記錄整理成可重複執行的測試項目（無自動化測試框架）。 |
| `docs/test-report.md` | 對應 `test-plan.md` 的測試報告，彙整已執行/未執行的用例結果。 |
| `docs/ppt-outline.md` | 產品功能介紹簡報的投影片大綱（18 張、20–25 分鐘），含截圖存放路徑與遮蔽帳號的提醒。 |
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
