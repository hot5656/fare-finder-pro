# Travelpayouts API 限制與查價監控（查價紀錄 Price checks）

這份文件整理三件事：Travelpayouts API 有哪些使用限制、航線加到多少條可能碰到上限，以及怎麼用 admin 後台的「查價紀錄 Price checks」（`/admin/runs`）判斷查價是否正常。

最後整理：2026-09-25。

## 1. Travelpayouts 的限制

### 官方規定（已知部分）

- 2024-06-14 起，限額改以「每分鐘請求數（RPM）」計算（以前是每 5 分鐘與每小時），各 endpoint 上限不同。官方公開的例子：Data API 的 `/v1/prices/calendar` 為 300 RPM，`/statistics/v1/execute_query` 為 30 RPM。
- 超過上限時回 **HTTP 429**。
- 即時搜尋的 Flights Search API 限得最嚴（同一 IP 每小時約 100～200 次）。**本專案沒有使用這支 API。**

**尚未確認**：本專案實際呼叫的三個 endpoint 的確切 RPM。官方限額頁面擋在 Cloudflare 驗證後面，程式抓不到，需要登入 Travelpayouts 後台或直接問官方支援：

| Endpoint | 用途 | 誰呼叫 |
| --- | --- | --- |
| `api.travelpayouts.com/aviasales/v3/prices_for_dates` | 觸發通知的票價（TWD）與附帶的 USD | `flight-parser`、`flight-admin-routes` |
| `api.travelpayouts.com/v1/prices/cheap` | 通知信裡的 v1 對照（admin 可關閉） | `flight-parser` |
| `autocomplete.travelpayouts.com/places2` | 中文地名轉 IATA 代碼 | `flight-admin-routes`（新增航線時） |

參考：[API rate limits](https://support.travelpayouts.com/hc/en-us/articles/4402565416594-API-rate-limits)、[What are the restrictions on API requests?](https://support.travelpayouts.com/hc/en-us/articles/205895848-What-are-the-restrictions-on-API-requests)、[Aviasales Data API](https://support.travelpayouts.com/hc/en-us/articles/203956163-Aviasales-Data-API)。

### 比呼叫次數更需要注意的限制

- **Data API 給的是快取價格**：來自其他使用者最近的搜尋紀錄，不是即時報價。冷門航線或冷門月份可能查不到價格；通知信的價格與使用者點進 Aviasales 看到的也可能不同。建立航線時要求「v3 查得到價格才存」就是這個原因。
- **聯盟行銷用途**：使用條款要求導流連結帶 marker，`flight-notification` 的 `withMarker` 已處理。

## 2. 本專案的用量與容量估算

### 用量（2026-09-25 實測）

- `pg_cron` 每 30 分鐘呼叫一次 `flight-parser`。
- 每條航線打 2 次 v3（TWD、USD）；v1 對照開啟時再加 2 次 v1，共 4 次。
- 航線**一條接一條**處理，同一時間最多 2 個請求（v1 開啟時 4 個）。
- 目前 4 條航線、v1 關閉：每次執行 **8 次 API 呼叫、約 4～5 秒**（偶爾 7 秒），換算不到 1 RPM。

### 航線加到多少可能被限制

關鍵：限額看的是「每分鐘打幾次」。航線是依序處理的，每條約 1 秒，所以一分鐘最多處理約 60 條。航線超過約 60 條後不會打得更快，只會讓整次執行拉得更長，RPM 大約停在：

- v1 關閉：約 **120 RPM**
- v1 開啟：約 **240 RPM**

依 v3 實際上限（未確認）推算，開始碰到 429 的航線數：

| v3 實際上限 | v1 關 | v1 開 |
| --- | --- | --- |
| ≥ 300 RPM（與 Data API 其他 endpoint 同級） | 不會碰到 | 不會碰到 |
| 約 100 RPM | 約 50 條 | 約 25 條 |
| 約 60 RPM | 約 30 條 | 約 15 條 |

### 比較可能先碰到的上限

1. **Edge Function 執行時間上限**：Supabase Free 150 秒、付費方案 400 秒。以每條約 1 秒計，約 **150 條（Free）／400 條（付費）** 會超時，後面的航線那一輪查不到價格。
2. **Data API 資料覆蓋率**：冷門航線常常沒有快取價格。這不是被限制，但航線加再多也沒有用。

### 擴充到上百條航線時要做的事

- 航線之間加延遲或限制併發，把 RPM 壓在確定安全的值。
- 把工作拆批，例如每次只跑一部分航線，或分成多個 cron 排程，避開執行時間上限。
- 先向 Travelpayouts 確認 `aviasales/v3/prices_for_dates` 的確切 RPM。

## 3. 查價紀錄怎麼記錄

每次 `flight-parser` 執行都寫一筆到 `flight.parser_runs`（migration `20260925100000_flight_parser_runs.sql`）：

- 開始時先寫一筆 `status = 'running'`，結束時補上結果。
- 只有 admin 讀得到（RLS `flight.is_admin()`）；只有 service role 能寫。
- 保留 90 天，由 `flight-parser` 每次結束時刪掉更舊的紀錄（每天約 48 筆）。
- 寫紀錄失敗不會影響查價本身，只會記在 function log。

| 欄位 | 意義 |
| --- | --- |
| `started_at` / `finished_at` | 開始、結束時間。`finished_at` 空白且狀態仍是 `running` = 沒跑完 |
| `duration_ms` | 整次執行耗時（含到期處理與資料庫操作） |
| `status` | `ok` / `warning` / `error` / `running`，判斷規則見下節 |
| `routes_total` | `flight.routes` 的航線總數（含停用的） |
| `routes_checked` | 實際去查了票價的航線數。停用且已無付費訂閱者的航線不查，所以會比總數少；**查了但沒有票價的航線也算在內**（會另外記一筆 `no_fare`） |
| `api_calls` | 這次打 Travelpayouts 的次數，用來對照 RPM 估算 |
| `matches` | 達到目標價、交給 `flight-notification` 的筆數。之後可能被 dedup 擋下，不等於實際寄出的信數（實際寄出看「通知紀錄」） |
| `expired` | 這次改成 `expired` 的訂閱數 |
| `issues` | 問題清單，每筆有 `kind`、`route`、`source`（v3/v1）、`currency`、`status`（HTTP 狀態碼）、`message` |

## 4. 如何分析查價紀錄

### 第一步：看總覽頁的狀態橫幅

`/admin` 最上方與 `/admin/runs` 都有「查價狀態」橫幅，依序判斷：

| 顏色 | 訊息 | 代表 |
| --- | --- | --- |
| 🔴 紅 | 超過 N 分鐘沒有查價 | 最新一筆紀錄超過 65 分鐘前：`pg_cron` 停了，或它用的 Vault 金鑰 `flight_service_role_key` 失效（parser 回 401，根本不會寫紀錄） |
| 🔴 紅 | 上一次查價沒有跑完 | 最新一筆仍是 `running` 且超過 10 分鐘：執行中途出錯或超過 Edge Function 時間上限 |
| 🔴 紅 | 被 Travelpayouts 限流（429）N 次 | 最近一次執行有 429 |
| 🔴 紅 | 最近一次查價有 N 個錯誤 | 其他 `error`（見下表） |
| 🟡 黃 | 最近一次查價有 N 個警告 | 有 `warning` 等級的問題 |
| 🟡 黃 | 耗時 N 秒，接近執行時間上限 | 沒有問題但執行超過 90 秒 |
| 🟢 綠 | 最近一次查價正常 | `ok` |

若最新一筆正在執行（`running` 且未滿 10 分鐘），橫幅會改看前一筆。

### 第二步：看單次執行的狀態與問題

`status` 的判斷：

- **error**：通知可能因此漏發。條件是出現任何 `rate_limited`、任何 `db`，或某條航線的 **v3 TWD**（觸發通知的那個價格）是 `http` / `error`。
- **warning**：功能降級但通知照常跑。例如 `no_fare`、USD 或 v1 的抓取失敗，或執行超過 90 秒。
- **ok**：沒有問題且 90 秒內跑完。

各種問題（`issues.kind`）與處理方式：

| kind（頁面顯示） | 意思 | 影響 | 怎麼處理 |
| --- | --- | --- | --- |
| `rate_limited`（被限流 429） | Travelpayouts 拒絕，超過 RPM | 該筆沒查到；若是 v3 TWD，該航線這輪不發通知 | 偶發一次可忽略（30 分鐘後自動重試）；連續出現就依第 2 節降低 RPM，並向官方確認上限 |
| `http`（HTTP 錯誤） | 其他非 2xx，例如 401／403（token 失效或被擋）、5xx（對方故障） | 同上 | 401/403 先檢查 `TRAVELPAYOUTS_TOKEN` secret；5xx 通常是暫時性的，持續多次再處理 |
| `error`（連線錯誤） | 連不上或回應解析失敗 | 同上 | 偶發可忽略；持續出現時查 function log 的完整錯誤 |
| `no_fare`（查無票價） | v3 TWD 回應成功但沒有資料 | 該航線這輪不發通知、`last_price` 不更新 | 看頻率（見下方 SQL）：偶爾出現是快取資料的正常空窗；長期出現代表這條航線資料覆蓋不足，考慮停用 |
| `db`（資料庫錯誤） | 讀寫 `flight` schema 失敗 | 視步驟而定：讀不到航線會整次失敗；到期處理失敗則該批訂閱未改成 expired | 看 `message` 找出哪一步，查 Postgres log |

### 第三步：看趨勢

「只看異常」勾選後只列出 `warning` / `error` / `running`，適合快速掃一段時間內的問題。要看趨勢，可以在 Supabase SQL Editor 執行下列查詢（唯讀）：

**近 7 天每種狀態的次數與耗時**

```sql
select status, count(*) runs, round(avg(duration_ms)) avg_ms, max(duration_ms) max_ms
from flight.parser_runs
where started_at > now() - interval '7 days'
group by status order by status;
```

**近 7 天哪條航線最常出問題**（`no_fare` 集中在某條航線 = 資料覆蓋不足）

```sql
select i->>'kind' kind, i->>'route' route, i->>'source' source, i->>'currency' currency,
       count(*) times, max(r.started_at) last_seen
from flight.parser_runs r, jsonb_array_elements(r.issues) i
where r.started_at > now() - interval '7 days'
group by 1, 2, 3, 4 order by times desc;
```

**每日的航線數、耗時與 API 呼叫量**（耗時跟著航線數上升時，對照第 2 節估算離 150 秒還有多遠）

```sql
select date_trunc('day', started_at) as day, count(*) runs, max(routes_total) routes,
       round(avg(duration_ms)) avg_ms, max(duration_ms) max_ms, sum(api_calls) api_calls,
       count(*) filter (where status = 'running' and started_at < now() - interval '10 minutes') stuck
from flight.parser_runs
where started_at > now() - interval '30 days'
group by 1 order by 1 desc;
```

**排程中斷的時段**（兩次執行間隔超過 35 分鐘）

```sql
select id, started_at, prev_started,
       round(extract(epoch from started_at - prev_started) / 60) gap_min
from (select id, started_at, lag(started_at) over (order by started_at) prev_started
      from flight.parser_runs
      where started_at > now() - interval '7 days') t
where started_at - prev_started > interval '35 minutes'
order by started_at desc;
```

手動執行 parser（例如測試時）會多出不在 :00 / :30 的紀錄，這是正常的。

### 常見情境

| 看到的狀況 | 判讀 |
| --- | --- |
| 同一條航線每次都 `no_fare` | Travelpayouts 沒有這條航線該月份的快取資料，訂閱者收不到通知。考慮停用該航線（`/admin/routes`） |
| `no_fare` 偶爾出現、下一輪就好 | 快取資料的正常空窗，不用處理 |
| 多條航線同一次出現 429 | 碰到 RPM 上限。航線數最近是否增加？是否剛打開 v1 對照（呼叫數加倍）？ |
| 所有航線都是 `http` 401／403 | Token 失效或被擋，檢查 `TRAVELPAYOUTS_TOKEN` |
| `duration_ms` 隨航線增加穩定上升並接近 90 秒 | 快到 Edge Function 時間上限，需要拆批（第 2 節） |
| 橫幅說超過 65 分鐘沒查價 | 查 `cron.job_run_details` 看 `flight-price-check` 有沒有執行、以及 parser 的 `function_edge_logs` 是否回 401 |

## 5. 目前的限制

- `flight-notification` 是 fire-and-forget 呼叫，寄信失敗不會記在查價紀錄裡；寄信結果看「通知紀錄」與 function log。
- 到期通知信（`flight-status-notification`）的寄送失敗也一樣不記錄。
- 沒有主動通知（email／Slack）；admin 要打開後台才看得到異常。
