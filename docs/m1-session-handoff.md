# M1 Flight Price Checker — Session Handoff

Updated 2026-09-19 (adds the M2 ECPay paywall — see "M2 status" and "Lessons
learned" below; supersedes the 2026-09-17 version, which described a
half-built state that no longer applies).

## Where things stand

M1 is **built, deployed and verified end-to-end** against the shared Supabase
project (`luugfvsrawnuzwpjvddt`, "demo_app"). The verification checklist is
`.claude/skills/m1-code-flight-price-checker-checklist/SKILL.md`; it was run on
2026-09-18. Subscribe → 30-min scheduled fetch → deduplicated email all work.
M1 shipped with no payment gate; **M2 (2026-09-19) added the paywall on top**,
so today only paying (or cancelled-but-paid-through) subscribers are alerted.

| Area | Status | Evidence |
|---|---|---|
| Schema, RLS, seeded routes, no `subscription_status` | ✅ | `flight.routes`, `subscriptions`, `notification_history` |
| RLS cross-user write blocked / read scoped | ✅ | tested in a rolled-back transaction: 42501, other user sees 0 rows |
| Subscribe UI (write + subscribed state) | ✅ | `POST /rest/v1/subscriptions?on_conflict=user_id,route` from `localhost:8080`: 200 on update (更新目標價), 201 on insert (開始追蹤); 已訂閱 badge shown |
| `flight-parser` / `flight-notification` deployed | ✅ | v3 each, `verify_jwt = true`; no-bearer calls → 401 |
| `pg_cron` job `flight-price-check` (`*/30 * * * *`) | ✅ | fires every tick; `routes.last_checked_at` refreshes |
| Manual parser invoke with service-role key | ✅ | `{"routes":2,"matches":1}` |
| Email arrives (NT$ headline, 約 US$, target, 立即訂購) | ✅ | in Gmail inbox, subject `✈️ 台北 → 東京 降價通知！NT$6,556 已達標` |
| Re-alert on big drop (≥20% or ≥NT$2,000) | ✅ | raised last history price to 9,500 → fresh email at 6,556 + new history row |
| Dedup blocks repeat | ✅ | 16:00 UTC tick on 09-18: both functions returned 200 (a match was handed off), but no new history row and no new email, since the fare equalled the last alerted price within 24h. The "skipped (deduped)" console line itself was never seen |
| USD-fetch-fails → TWD-only handoff (H3) | 🟡 | verified in code only |
| Below-target subscriber excluded (H5) | ✅ | 2026-09-19 04:16 UTC: a Seoul test subscription (target NT$4,000 vs fare NT$5,127) was created via the UI, then the parser was run. No `TPE-SEL` history row and no email, so it was excluded (a wrongly matched Seoul sub has no dedup history and would have been emailed). Test row deleted afterwards |

## M2 status — ECPay 定期定額 paywall (2026-09-19)

Built and deployed on ECPay's **stage** shared test merchant (`3002607`);
everything below was exercised against the real stage cashier with the stage
test card, except the rows marked 🟡. Skill:
`.claude/skills/m2-code-ecpay-subscription/SKILL.md`.

Lifecycle: `pending_payment → active → cancelled (grace, still alerted) →
expired`. Only the verified ECPay callbacks write `active`.

| Area | Status | Evidence |
|---|---|---|
| Migration: `subscription_status`, `merchant_trade_no` (unique), `current_period_end`; client writes removed | ✅ | columns present; only `select own subscriptions` policy left; `authenticated` has SELECT only. Self-activation attempted as the signed-in user (checklist run F1): `update` **and** `insert` both `42501 permission denied`; own-row `select` still works |
| `flight-subscribe` → ECPay cashier | ✅ | text/html form; cashier showed NT$300, "每 1 個月扣 1 次", order `FPMU8DUXVA5K5Z3B`. The cashier accepting the form is itself the CheckMacValue check |
| First charge → `flight-ecpay-return` | ✅ | one ECPay call, 200 `text/plain`, no retries; row `active`, `current_period_end` +1 month |
| `flight-ecpay-result` browser redirect | ✅ | 302 → `/dashboard?purchase=success`; card flipped to 已訂閱（有效） |
| Welcome email (`flight-status-notification`) | ✅ | function returned 200 right after activation (it returns 502 if Resend rejects the send). Arrival confirmed in the Gmail inbox during the checklist run (subject `✈️ 訂閱成功！台北 → 東京 降價通知已開始`) |
| Forged callback rejected | ✅ | curl with bad CMV to return/period → `0|CheckMacValue error` (proves reachable without JWT and CMV enforced) |
| Paywall gate in `flight-parser` | ✅ | parser returned `{"routes":3,"matches":1}`: London (`pending_payment`, target met) excluded, Tokyo (`active`) matched. Pre-M2 this would have been 2 |
| Cancel → `flight-cancel-subscription` | ✅ | ECPay `RtnCode=1 停用成功`; row `cancelled`, `current_period_end` kept; card 已取消 · 有效至 2026/10/19; cancel email sent |
| Cancelled-in-grace still alerted | ✅ | parser `matches: 1` while `cancelled` with a future period end |
| Grace lapse → lazily `expired` | ✅ | Tokyo was back-dated to a past `current_period_end`; the 13:00 UTC cron tick flipped it `cancelled → expired` (read back at 13:13 UTC) |
| Fare-alert email for a paying user, after the M2 + follow-up parser | ✅ | Tokyo `cancelled` with a future period end, last history price raised to 9,500 → parser `matches: 1`, new history row (NT$6,579), no dedup skip, no error |
| `expired` email (follow-up) | ✅ | Tokyo back-dated past its period end → log `expired 1 subscription(s)` + `expired email sent to kyp001@gmail.com`; row `expired`; a second parser run sent nothing (no `flight-status-notification` call, `matches: 0`) |
| `payment_failed` email (follow-up) | ✅ | self-signed `RtnCode=0` callback → `payment_failed email sent`, `payment_failed_at` set, row stays `active`; identical 2nd failure → `1|OK`, flag unchanged, **no 2nd email** (only one status-notification call) |
| Renewal callback `flight-ecpay-period` (**real ECPay scheduler**) | ✅ | B4 passed: on the daily test order `FPMU8IP18O712217` ECPay itself fired the 2nd charge at **2026-09-19 23:57:11Z** (07:57 local next morning) → `CMV verified: period … RtnCode=1 TotalSuccessTimes=2 ExecTimes=2 SimulatePaid=undefined`, HTTP 200 `1|OK`, called once with no resend; `current_period_end` refreshed, `payment_failed_at` null, no false alarm. See "B4" below for what it taught us |
| `renewed` ("本期已扣款") email (follow-up, 2026-09-20) | ✅ | see "M2 follow-up 2" below: new charge → 1 email; identical resend → none; next charge → 1 email |
| Re-subscribe from `expired` | ✅ | checklist run: Tokyo `expired` → 重新訂閱 → a **new** trade no (`FPMU8GFF402A0U33`, old was `FPMU8DUXVA5K5Z3B`) → stage payment → `active`, welcome email |
| Seoul / London checkout | ✅ | follow-up run (~22:50 local): London 完成付款 (existing `pending_payment`, order `FPMU8I5Y0K3J125F`) and Seoul 開始追蹤 (a **new** row, target 6,000, order `FPMU8I7IZE1L0Z63`) each paid with the stage card → `CMV verified` → `activated … until 2026-10-19` → `welcome email sent` (`TPE-LON` / `TPE-SEL`), rows `active`, cards 已訂閱（有效） on `?purchase=success`. Parser then `{"routes":3,"matches":2}` (Tokyo `expired` excluded) and each route got its fare-alert history row (London NT$20,345, Seoul NT$5,127, both 14:51Z). So there was no route-specific problem, including for London, which was added later by a migration |

**Test data left behind (state after the London/Seoul follow-up, ~22:55 local / 14:55 UTC, 2026-09-19):**
- `TPE-TYO` (user kyp001@gmail.com): **`active` on the B4 daily test order**
  `FPMU8IP18O712217`, `target_price` 8000, `total_success_times` 2,
  `current_period_end` 2026-10-19 23:57Z (set by the real renewal), `payment_failed_at`
  null. It was a 2-charge order (`ExecTimes=2`), so ECPay's series is complete and
  it will not charge again; the parser will retire the row 7 days after that
  period end. (During the renewed-email test its count/period end were temporarily
  raised to 4 / 2026-10-20 by self-signed callbacks and then put back.) The earlier
  back-dated order `FPMU8GFF402A0U33` is cancelled at ECPay.
- `TPE-LON` and `TPE-SEL` are now **genuinely `active`** (both paid with the stage
  card): London target 22000, trade no `FPMU8I5Y0K3J125F`, period end
  2026-10-19 14:49Z; Seoul target 6000, trade no `FPMU8I7IZE1L0Z63`, period end
  2026-10-19 14:50Z. They were **not** cancelled, so the parser keeps serving them
  every 30 minutes (real fare alerts to kyp001@gmail.com on a big drop) and ECPay's
  stage scheduler will try to charge them monthly. Cancel via the dashboard (E1) if
  the test data should go away; a `cancelled` row is still alerted until its
  `current_period_end`.
- (The migration flipped **both** pre-existing M1 rows, Tokyo and London, to
  `pending_payment` by design; Seoul had no row until the follow-up run.)
- `flight.notification_history`: every price I raised for the dedup workaround
  (ids `096c300a…`, `9d03e8cd…`, earlier `6a254506…`, and London's `557f89c6…`
  raised to 30,000) was restored. Rows left on purpose because real emails went
  out: `TPE-TYO` NT$6,579 (13:35Z), NT$6,579 (14:02Z), NT$6,610 (14:04Z);
  `TPE-SEL` NT$5,127 and `TPE-LON` NT$20,345 (both 14:51Z).
- Stage orders: `FPMU8DUXVA5K5Z3B` and `FPMU8GFF402A0U33` (Tokyo) are cancelled;
  `FPMU8I5Y0K3J125F` (London) and `FPMU8I7IZE1L0Z63` (Seoul) are **active** in
  ECPay's shared stage backoffice. Nothing real was charged.

**Where M2 differs from the skill as written** (folded back into all three `m2-code-ecpay-subscription*` skills on 2026-09-19, so the skills now match the build):
- Edge Function URLs are the function slug — `/functions/v1/flight-ecpay-return`,
  not `/functions/v1/ecpay-return`; cancel is `/functions/v1/flight-cancel-subscription`,
  not `/cancel`.
- Post-payment redirect goes to `/dashboard?purchase=…` (this app has no `/app`).
- The migration also `revoke insert, update … from authenticated` (not just
  `drop policy`) and adds a unique index on `merchant_trade_no`.
- Cancel only treats ECPay `90100150` (order not found) as "fine, cancel
  locally"; any other rejection returns 502 and leaves the row alone, so nobody
  keeps being charged with alerts switched off.
- The status email is handed off with `EdgeRuntime.waitUntil` so the request
  isn't cut off after we reply `1|OK`.
- `flight-subscribe` derives `route` from `flight.routes` and `email`/`user_id`
  from the JWT — never from the request body.

### M2 checklist run — full pass (`m2-code-ecpay-subscription-checklist`, 2026-09-19 evening)

Run end to end on the stage merchant with the real cashier for B3. **20 of 21
checks ✅, B4 ⚠️ at the time — B4 then passed the next morning (see below), so
it is 21 of 21 and M2 is passed and READY for M3.**

| Check | Result | Evidence |
|---|---|---|
| A1/A2/A3 secrets, checkout form, pending row | ✅ | five `ECPAY_*` present (`SITE_URL` unset); `text/html`, cashier URL + `CheckMacValue` + `PeriodType=M`, `PeriodAmount = TotalAmount = 300`, full-slug `ReturnURL`/`PeriodReturnURL`/`OrderResultURL`. A client-sent wrong `route` was ignored (`CustomField2` stayed `TPE-LON`) |
| B1 three ECPay functions `verify_jwt=false`; forged body | ✅ | all three `False`; forged → `0|CheckMacValue error`, not 401 |
| B2 CMV + `SimulatePaid` guard | ✅ | logs `CMV mismatch FAKE1`; a signed `SimulatePaid=1` callback → `CMV verified`, `1|OK`, London **stayed `pending_payment`** |
| B3 real payment → `active` | ✅ | `activated FPMU8GFF402A0U33 until 2026-10-19`, row `active` |
| B4 real renewal from ECPay's scheduler | ✅ (was ⚠️) | passed the next morning: real callback 2026-09-19 23:57:11Z, see "B4" below |
| B5 `ecpay-result` 302 | ✅ | curl → `302` to `http://localhost:8080/dashboard?purchase=success`; the real payment landed there too |
| C0/C1/C2 status function | ✅ | welcome email logged; `bogus` event with the service-role bearer → 400 (`event_type (welcome|cancel|expired|payment_failed)…`); no bearer → 401 |
| D0/D1/D2 parser gate | ✅ | `matches: 1` (Tokyo active in, London pending-but-target-met out); Tokyo got a new history row |
| **D3a** cancelled **before** expiry → fare email | ✅ | `cancelled`, future end → `matches: 1`, new history NT$6,610 (14:04Z) |
| **D3b** cancelled **after** expiry | ✅ | → `expired`, `matches: 0`, one "ended" email, second parser run silent |
| D4 `active` but renewals overdue > 7 days | ✅ | back-dated 8 days → `expired`, one "payment lapsed" email |
| E1/E2/E3 cancel, in-place target update, lifecycle | ✅ | `ECPay cancel … RtnCode=1 停用成功`, `cancel email sent`; target 8000→8500 with no navigation, still `cancelled`, same trade no; `expired → active → cancelled → expired` all walked |
| F1/F1b/F2 RLS + grants | ✅ | as the signed-in user `update`/`insert` → `42501`; `authenticated` has SELECT only; own-row `select` works |
| G1/G2/G3 once-only lifecycle emails | ✅ | two identical failures → **one** `payment_failed`; `RtnCode=1` clears `payment_failed_at`; only **3** `flight-status-notification` calls in the whole window (expired, payment_failed, expired) |

**Inbox verification (Gmail, from two screenshots the user supplied).** Every
email lines up with a log line (mailbox time is UTC+8): 10:01 PM 訂閱成功
(`welcome` 14:01Z) · 10:02 PM 降價 NT$6,579 (D1) · 10:03 PM 已取消 (E1) · 10:04 PM
降價 NT$6,610 (D3a) · 10:04 PM 已結束 (D3b) · 10:05 PM ⚠️ 本期扣款失敗 (G1) ·
10:06 PM 已結束 (D4). Gmail groups by subject, so the thread counts include the
earlier session's emails: welcome 2, cancel 2, NT$6,579 alert 2, payment failed 2,
ended 3, NT$6,610 alert 1 — each run contributed exactly one of each, so nothing
was double-sent. **Both "ended" wordings were seen in full:** "訂閱期間已結束…也不會
再向你收費" (`period_ended`) and "因為多次扣款未成功…訂閱已結束" (`payment_lapsed`),
sender `noreply@roberthut.com`, no resubscribe link because `SITE_URL` is unset.

**Not verified:** the full bodies of the cancel / payment-failed / fare emails (only
the subjects and snippets were seen); the stage 廠商後台 showing the cancelled series
as terminated (evidence is ECPay's `RtnCode=1`). The **welcome** email body *was*
seen in full (the user pasted it: title, greeting, 每月扣款 NT$300, 服務期間至
2026/10/19 — it matches the template). (Seoul and London checkout, listed here
earlier, was done in a follow-up — see the status table.)

**B4 — PASSED.** `flight-subscribe` was temporarily deployed with
`PeriodType=D, Frequency=1, ExecTimes=2` (a temporary edit to `_shared/ecpay.ts`,
reverted in the repo right after). The form was checked (`PeriodType=D`,
`ExecTimes=2`, 300), the cashier showed 每 1 日扣 1 次, and Tokyo's order
`FPMU8IP18O712217` paid its first period at 2026-09-19 15:04Z. ECPay's own scheduler
then delivered the 2nd charge at **23:57:11Z** (log above). On 2026-09-20 04:48Z
`flight-subscribe` was **redeployed from the repo (v3)** and the deployed source was
read back to confirm `PeriodType: "M"` / `ExecTimes: "999"`, i.e. monthly is restored.
What it taught us:
- **The stage scheduler does fire, and it works by calendar day, not by 24 hours:**
  the first charge was 23:04 local and the second came at 07:57 the next morning,
  about 9 hours later. Don't wait a full day for a `PeriodType=D` test.
- **The real callback has no `SimulatePaid` field at all** (logged as `undefined`).
  The guard is `=== "1"`, so it is not tripped; earlier tests only used self-signed
  bodies that carried `SimulatePaid=0`. The self-signing script can now omit it.
- The renewal itself sent **no email** at that time (the `renewed` email did not
  exist yet — added the same morning, below).
- The ECPay stage 廠商後台 was no help for the schedule: 定期定額查詢
  (`/TradeCreditPeriod/TradeCreditPeriodQuery`) returned a 500 after ~31 s once and an
  empty result area twice. The page does confirm ECPay auto-terminates after 6
  consecutive failed charges. Logs are the evidence.

### M2 follow-up 2: "renewal charged" email (2026-09-20 — deployed and verified)

A user used to hear nothing when a renewal succeeded. `flight-status-notification`
now also sends `renewed` ("✅ 台北 → 東京 本期已扣款 NT$300", with the charge number and
the extended service period), from `flight-ecpay-period`.
- **Once per charge.** ECPay resends a callback until it gets `1|OK`, so a plain
  "email on every success" would double-send. Migration
  `20260920100000_flight_total_success_times` adds `total_success_times`; the renewal
  update carries the guard (`where total_success_times is null or < N … returning`),
  so "is this a new charge?" and "record it" are one atomic step and only the call
  that gets a row back sends the email. `flight-ecpay-return` sets it to 1 for the
  first charge. With no usable `TotalSuccessTimes` the period is extended but **no**
  email is sent (better to miss one than to double-send).
- **Deployed 2026-09-20 04:47–04:48Z by the user, migration first:** migration applied
  and registered (`migration repair`), then `flight-status-notification` v3,
  `flight-ecpay-period` v3, `flight-ecpay-return` v2 (both `--no-verify-jwt`),
  `flight-subscribe` v3. (The `migration repair` line was initially skipped because
  the user ran only the first line of the block — caught by reading
  `supabase_migrations.schema_migrations`; check that after any multi-step block.)
- **Tested with self-signed callbacks on Tokyo, shaped like the real one (no
  `SimulatePaid`):** `TotalSuccessTimes=3` (stored null) → `renewed email sent`, count 3,
  period refreshed; the **identical** callback again → log `charge #3 already
  processed, no email`, row untouched (`updated_at` unchanged); `TotalSuccessTimes=4` →
  second email. Edge logs: three `flight-ecpay-period` calls, only **two**
  `flight-status-notification` calls. Two real emails went to kyp001@gmail.com.
- **Not verified:** that `flight-ecpay-return` really stores 1 on a real first charge
  (code review only — every route is already `active`, so no new checkout was made);
  the real callback's amount field name (`Amount` vs `amount`; the code falls back to
  `ECPAY_AMOUNT`); and the emails' rendered body in the inbox (log lines only).

### M2 follow-up: lifecycle emails (2026-09-19 — deployed and verified)

Until now users only got `welcome` and `cancel` emails: nothing when a
cancelled subscription ran out, and nothing when a renewal charge failed.
`flight-status-notification` now also handles two more `event_type`s:

- **`expired`** — with `reason` `period_ended` (cancelled and the paid month is
  over) or `payment_lapsed` (renewals stopped). Sent by `flight-parser` at the
  moment it flips the row, and by `flight-ecpay-period` if ECPay reports every
  scheduled execution used. Each `update … returning` only returns rows it
  actually flipped, so a row emails **once**. Includes a 重新訂閱 link only if the
  `SITE_URL` secret is set (never a localhost link).
- **`payment_failed`** — sent by `flight-ecpay-period` on the **first** failed
  renewal of a cycle. ECPay calls back on every retry (up to 6), so a new column
  `payment_failed_at` (migration `20260919150000_flight_payment_failed_at`)
  makes it once-only (`update … where payment_failed_at is null`); a successful
  renewal clears it.

**Decision beyond the request — please sanity-check:** `flight-ecpay-period`
originally only expired a row when ECPay's `TotalSuccessTimes >= ExecTimes`.
ECPay actually terminates after **6 consecutive failures** with far fewer
successes, so such a row would have stayed `active` forever and kept being
alerted. `flight-parser` now also expires an `active` row whose
`current_period_end` is more than `RENEWAL_GRACE_DAYS` (7) past with no
renewal, emailing it `payment_lapsed`. Change the constant if ECPay's retry
window turns out to be longer.

**Deployed 2026-09-19 (by the user, migration first):** migration
`20260919150000_flight_payment_failed_at` applied and registered;
`flight-status-notification` v2, `flight-parser` v6, `flight-ecpay-period` v2
(`--no-verify-jwt`). `flight-subscribe`, `flight-cancel-subscription` and
`flight-ecpay-return` were not redeployed (only a type in `_shared/ecpay.ts`
changed). Order matters: the renewal success path writes `payment_failed_at`,
so the column must exist before `flight-ecpay-period` is deployed.

**How the follow-up was tested** (order C → A → B, all on the one Tokyo row,
restored afterwards): C = fare alert (raise last history price, run parser),
A = expiry (back-date `current_period_end`, run parser twice), B = failed /
successful renewals via a self-signed callback. The signer is a ~40-line Node
script that reimplements the CheckMacValue with the **public** stage
HashKey/HashIV and POSTs to `flight-ecpay-period`; a validly-signed callback for
an unknown trade number returns `1|OK`, a forged one `0|CheckMacValue error`.
It lived in the session scratchpad and is not in the repo.

## Project / environment facts (don't re-derive these)

- **Shared multi-app Supabase project.** Other apps' migrations live in the
  same remote history table but not in this repo. **Never run
  `supabase db push`** — it wants to mark those other-app migrations as
  "reverted", which is destructive to shared state.
- **Applying a schema change** (repeat this pattern): write the migration
  file, run `supabase db query --linked --file <file>`, then register it with
  `supabase migration repair --status applied <version>`.
- **Migrations in this repo**: `20260904120000_flight_app_scoped_auth`,
  `20260917071738_flight_m1_schema`, `20260917140000_flight_schema_grants`,
  `20260917150000_flight_pg_cron`, `20260918030000_flight_routes_last_price`,
  `20260918030100_flight_routes_update_grant`,
  `20260919130000_flight_route_london`,
  `20260919140000_flight_m2_payment_columns` (M2),
  `20260919150000_flight_payment_failed_at`,
  `20260920100000_flight_total_success_times`.
- **Deploying functions**: `supabase functions deploy <name> --use-api`
  (no Docker needed). `supabase/config.toml` keeps `verify_jwt = true` for
  `flight-parser`, `flight-notification`, `flight-status-notification`
  (service-role bearer, checked inside), and `flight-subscribe` /
  `flight-cancel-subscription` (the signed-in user's own JWT). The gateway
  accepts any project JWT (e.g. the anon key), so the exact in-function check
  is what actually protects the service-role ones — keep both. **Exception:
  `flight-ecpay-return`, `flight-ecpay-period`, `flight-ecpay-result` are
  `verify_jwt = false`** (ECPay sends no JWT); deploy those with
  `--no-verify-jwt` too so the flag can't drift from config.toml.
- **Shared code**: `supabase/functions/_shared/ecpay.ts` (CheckMacValue,
  checkout form, `1|OK`, status-email hand-off) is imported by the M2
  functions via `../_shared/ecpay.ts`; `--use-api` bundles it fine.
- **Secrets set remotely**: `RESEND_API_KEY`, `SEND_EMAIL_HOOK_SECRET`,
  `TRAVELPAYOUTS_TOKEN`, `ECPAY_MERCHANT_ID` / `ECPAY_HASH_KEY` /
  `ECPAY_HASH_IV` / `ECPAY_ENV` (`stage`) / `ECPAY_AMOUNT` (`300`), plus
  auto-injected `SUPABASE_*`. Optional `SITE_URL` (where ECPay's browser
  redirect lands) is **not set** and defaults to `http://localhost:8080`; set
  it once there is a deployed front-end. Local `.env` does not (and should
  not) contain Travelpayouts/Resend/ECPay keys.
- **Cron**: job `flight-price-check` posts to `flight-parser` using the
  service-role key stored in Supabase Vault as `flight_service_role_key`.
  A cron run status of `succeeded` only means the HTTP request was enqueued —
  check `flight.routes.last_checked_at` or the function edge logs for real
  success.
- **Logs**: the CLI (2.109) has no `supabase functions logs`. Use the
  dashboard (Edge Functions → function → Logs). Edge status codes are also
  readable via the Supabase MCP `query_logs` (`function_edge_logs`).
- **Testing target**: use `http://localhost:8080` (dev server). The Vercel
  site `fare-finder-pro.vercel.app` is **not the final code** — don't test
  against it or deploy to it unless asked.
- **Sender**: both functions send from `noreply@roberthut.com` via Resend
  (same as the auth `send-email` hook).

## How to re-run the big-drop (L3) test

1. Raise the latest `flight.notification_history` row's `price` for your user
   and `TPE-TYO` (e.g. to 9,500) so the current fare is ≥20% / ≥NT$2,000
   below it.
2. Trigger `flight-parser` (wait for the next `:00`/`:30` UTC tick, or curl it
   with the service-role key).
3. A new email arrives and a new history row is written.
4. **Restore the row's original price** afterwards.

## Changes made during verification (2026-09-18)

- **Fixed `nextMonth()` in `flight-parser`.** It returned the *current* month;
  it now returns next month (Date.UTC rollover handles December). Live fares
  shifted accordingly (Tokyo 7,682 → 6,556, Seoul 5,370 → 5,127).
- Corrected stale "deployed with --no-verify-jwt" header comments in both
  functions.

## Known issues / open items

- **The welcome email hard-codes "每月扣款 NT$…".** `flight-status-notification`
  fills in the amount from `ECPAY_AMOUNT` but not the billing period, so the B4
  daily test order's welcome email also said 每月. Correct while production stays
  monthly; if other periods are ever offered, pass the period in from the checkout.
- **`flight.subscriptions.updated_at` has no trigger.** Since M2 every write
  goes through an Edge Function and `flight-subscribe`, `flight-cancel-subscription`
  and the ECPay callbacks set it explicitly, so it now moves. The parser's lazy
  `cancelled → expired` update does not. A `before update` trigger would cover
  everything if it ever matters.
- **`flight-notification` (v5) and `send-email` (v7) were deployed by something
  other than the M2 work** — their version numbers moved during the M2 session.
  Not investigated; if behaviour changes unexpectedly, check who deployed them.
- **Resolved (not a bug): the 09-17 history row's `sent_at` is 2 hours off.**
  The row reads 12:47:44Z but that email actually went out at 14:47:44Z. At
  2026-09-18 14:10 UTC an earlier session ran
  `update flight.notification_history set sent_at = sent_at - interval '2 hours'`
  on that row to clear the 24h dedup window, so the new "你的目標價" line could
  be tested by email (the 14:14 UTC email). This also explains why the
  13:00/13:30/14:00 UTC ticks on 09-18 did not re-send: the row still read
  14:47 then (~22h old), so dedup correctly blocked them. The row was left
  back-dated; it is no longer the latest row, so it has no effect on dedup.
  Lesson: if you back-date history rows to test, note it here or restore them.
- Dashboard console shows 2 minor a11y warnings (target-price inputs have no
  label association / no `id` or `name`).
- Supabase advisor notes `flight.tag_app_metadata_on_signup()` (an M0 auth
  trigger function) is SECURITY DEFINER and executable by `anon` /
  `authenticated`. Not part of M1; consider revoking EXECUTE.
- `notification_history` shows "RLS enabled, no policy" — intentional
  lockdown (service role only), not a bug.

## Lessons learned (M2 session, 2026-09-19)

**ECPay / Edge Functions**
- **ECPay's servers send no JWT, so the callback functions must be
  `verify_jwt = false`.** The skill never says so. With the default (`true`) the
  gateway 401s every callback and you'd never see one arrive. The CheckMacValue
  is the authentication. Smoke test after deploying: POST a forged body — you
  should get `0|CheckMacValue error` (HTTP 200), not a 401.
- **A function's URL is its slug** (`flight-ecpay-return`), so the URLs handed to
  ECPay (`ReturnURL`, `PeriodReturnURL`, `OrderResultURL`) must use the full
  slugs.
- **The cashier accepting your form is the CheckMacValue test.** A wrong hash
  or bad param makes the stage cashier show an error instead of the order page,
  so no separate CMV unit test was needed. Our first attempt was accepted.
- **Stage cashier walkthrough** (browser-drivable): `立即付款` → an "you're in
  the test environment" modal (close it) → click `立即付款` again → "確定使用信用卡"
  modal (`確定`) → ECPay's simulated 3D page: `取得OTP服務密碼` shows the OTP
  (`1234`), enter it, `送出` → ECPay POSTs the browser to `OrderResultURL`.
  Card `4311-9522-2222-2222`, 12/30, CVV 222; cardholder name/phone required
  (any test values). Use generic test details, not the user's.
- **Reply plain-text `1|OK`; keep empty-string fields in the CheckMacValue.**
  Both were built in from the start and worked first time.
- **Send follow-up email with `EdgeRuntime.waitUntil`**, not a bare
  fire-and-forget `fetch`, otherwise the runtime can end the request after the
  response is returned.
- **Can't typecheck Edge Functions locally** (no `deno` installed here). The
  deploy is the compile check — all seven deployed cleanly first time. Front-end
  code is checked with `npx tsc --noEmit -p .` (strict: bracket-access
  `import.meta.env['…']`, `| undefined` on optional search params).

**Testing / operations**
- **`pg_net` times out after 5 s by default.** Triggering `flight-parser` from
  SQL with `net.http_post(...)` shows `Timeout of 5000 ms reached` in
  `net._http_response` because the parser takes a few seconds — just over
  that limit — so you never see its response. Pass
  `timeout_milliseconds := 60000`, then read `net._http_response` for the real
  `{"routes":3,"matches":N}`. `matches` is the cleanest paywall test: compare it
  to the number of paying subscribers whose target is met.
- **Reading logs via the Supabase MCP `query_logs`:** `function_edge_logs`
  carries request path / status / auth (`log_attributes[...]`);
  `function_logs` carries the `console.log` output in `event_message`. There is
  no `body` field. `function_logs` occasionally returns "Backend error" —
  retry once, don't loop.
- **`supabase secrets list` prints a `value` field** (SHA-256 digests, not
  plaintext). Don't paste that output anywhere; use `--output json` and print
  names only.
- **`supabase db query` sometimes hangs** for minutes after working earlier.
  Retry, or use the Supabase MCP `execute_sql` for reads. The write pattern
  (`db query --file`, then `migration repair --status applied`) worked.
- **Auto-mode blocks production DDL, deploys and manual parser runs.** The
  migration and all function deploys had to be run by the user with `!`.
  Plan for that when building a milestone: write everything first, hand over
  one copy-paste block, then verify.
- **chrome-devtools:** a stale automation Chrome (`pid` from
  `ps -eo pid,etime,command | grep chrome-devtools-mcp/chrome-profile`) held the
  profile lock; the user approved `kill`. After that the fresh browser was
  **signed out** — the "logins persist" assumption did not hold this time, so
  the user had to sign in again in the tool's window.
- **After a multi-line `!` block, verify every step.** The user ran only the first
  line of the migration block, so the column existed but the migration history was
  not registered; reading `supabase_migrations.schema_migrations` caught it. Same
  habit for deploys: `supabase functions list` versions, and read the deployed source
  (Supabase MCP `get_edge_function`) when the question is "what config is live?".
- **Gmail can make an identical email look blank.** Three welcome emails with the
  same subject and body land in one conversation, and Gmail folds the repeated
  body of the newest one behind a `•••` button, so it *looks* empty (the earlier
  copies' snippets still show the text). It is not a send bug — click `•••` or
  "Show original". It only shows when the same person gets identical emails in one
  thread (e.g. re-subscribing to the same route); different routes have different
  subjects.
- **Emails send from `noreply@roberthut.com`**, and M1's alerts have reached
  kyp001@gmail.com. The skill's "Resend sandbox only reaches your own address"
  warning is still the safe assumption for any other recipient — test M2 emails
  to yourself.

- **Logs lag by a minute or so.** A `query_logs` run right after the action can
  return nothing (or miss the newest lines) even though the function ran, so
  "no email line" is not evidence of "no email" until later lines from the same
  window have appeared. Cross-check with the DB (`payment_failed_at`,
  `net._http_response`) and re-query once.
- **Self-sign ECPay callbacks to test the handlers.** The stage HashKey/HashIV are
  public, so a script can produce a valid `CheckMacValue` and drive success /
  failure / repeat-failure through `flight-ecpay-period` without waiting for
  ECPay's scheduler.

- **Act as the signed-in user from the dev server.** In `evaluate_script`,
  `await import('/src/integrations/supabase/client.ts')` gives the app's own
  Supabase client (already holding the user's session), so RLS checks (F1/F2) and
  calls to `flight-subscribe` need no token juggling. `import.meta` is not
  available inside `evaluate_script`; read the URL/key off the client instead.
- **Drive the stage cashier by element id.** After opening the 信用卡 tab the
  fields are `CCpart1`–`CCpart4`, `creditMM`, `creditYY`, `CreditBackThree`,
  `CCHolderTemp`, `CellPhoneCheck`, `EmailTemp`, `Address`; set them with the
  native value setter plus `input`/`change` events (a plain `.value =` isn't
  picked up). `wait_for` on the cashier text timed out once even though the page
  had loaded — check `location.href` before assuming the click failed.
- **Send a signed `SimulatePaid=1` first-charge callback** (the sibling of the
  `flight-ecpay-period` script) to test the guard without the stage 後台: it must
  reply `1|OK` and leave the row `pending_payment`.

**Design**
- **The dedup workaround must target the *latest* history row.** Every fare email
  writes a new latest row, so raise `price` on the newest `notification_history`
  row for that user+route each time (I had to look the id up again between D1 and
  D3a), and restore each one afterwards.
- **Dedup can mask a paywall test.** London's target was met but dedup would have
  blocked its email anyway, so "no new history row" proved nothing. Assert on the
  parser's own `matches` count instead.
- **After moving writes behind Edge Functions, remember the UI reads.** The
  dashboard still reads `flight.subscriptions` directly (SELECT policy kept) and
  only *writes* through `flight-subscribe` / `flight-cancel-subscription`.
- **Front-end contract:** `flight-subscribe` returns `text/html` (a checkout
  form → `document.write` it) or `application/json` (in-place target-price
  update). Branch on `Content-Type`. Card state initialised from a not-yet-loaded
  query rendered a blank input after the payment redirect — fixed with a
  `useEffect` that syncs the saved target.

## Next

1. **M2 has no open checks.** B4 passed, the lapse check, re-subscribe, Seoul/London
   checkout and the renewal email are done. Still unverified (small): the first-charge
   `total_success_times = 1` on a real checkout, and the real renewal callback's amount
   field name.
2. **Decide what to do with the three live stage subscriptions** (Tokyo, London, Seoul
   are all genuinely `active`; the parser serves them every 30 minutes and ECPay's stage
   scheduler will charge London/Seoul monthly). Cancel from the dashboard (E1) if the test
   data should go; a `cancelled` row is still alerted until its `current_period_end`.
3. ~~Fold the "differs from the skill" notes back into the M2 skills.~~ Done
   (2026-09-19): the main skill, its checklist (new C2, D4, F1b, a Section G
   for the lifecycle emails, and D3 split into D3a "cancelled before expiry: fare
   email actually arrives" / D3b "after expiry: ended") and the prerequisites skill were corrected and
   extended; the stale `m2-ecpay-subscription` pointer is fixed.
4. **Before any real money:** M2 runs entirely on the shared **stage** merchant.
   Going live means a real MerchantID/HashKey/HashIV, `ECPAY_ENV=prod`, a real
   `SITE_URL`, and a deployed front-end that is the final code (the Vercel site
   is not yet). Per the skill, that is M3 ("啟動 M3", own domain / go-live) —
   check whether the M3 skill still assumes the AWS version first.
