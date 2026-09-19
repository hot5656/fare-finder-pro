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
| Migration: `subscription_status`, `merchant_trade_no` (unique), `current_period_end`; client writes removed | ✅ | columns present; only `select own subscriptions` policy left; `authenticated` has SELECT only. Not tried: a self-activation attempt from the browser console |
| `flight-subscribe` → ECPay cashier | ✅ | text/html form; cashier showed NT$300, "每 1 個月扣 1 次", order `FPMU8DUXVA5K5Z3B`. The cashier accepting the form is itself the CheckMacValue check |
| First charge → `flight-ecpay-return` | ✅ | one ECPay call, 200 `text/plain`, no retries; row `active`, `current_period_end` +1 month |
| `flight-ecpay-result` browser redirect | ✅ | 302 → `/dashboard?purchase=success`; card flipped to 已訂閱（有效） |
| Welcome email (`flight-status-notification`) | ✅ | function returned 200 right after activation (it returns 502 if Resend rejects the send). Inbox delivery not opened/confirmed; the cancel email's log line `cancel email sent to kyp001@gmail.com` was seen |
| Forged callback rejected | ✅ | curl with bad CMV to return/period → `0|CheckMacValue error` (proves reachable without JWT and CMV enforced) |
| Paywall gate in `flight-parser` | ✅ | parser returned `{"routes":3,"matches":1}`: London (`pending_payment`, target met) excluded, Tokyo (`active`) matched. Pre-M2 this would have been 2 |
| Cancel → `flight-cancel-subscription` | ✅ | ECPay `RtnCode=1 停用成功`; row `cancelled`, `current_period_end` kept; card 已取消 · 有效至 2026/10/19; cancel email sent |
| Cancelled-in-grace still alerted | ✅ | parser `matches: 1` while `cancelled` with a future period end |
| Grace lapse → lazily `expired` | ✅ | Tokyo was back-dated to a past `current_period_end`; the 13:00 UTC cron tick flipped it `cancelled → expired` (read back at 13:13 UTC) |
| Fare-alert email for a paying user, after the M2 + follow-up parser | ✅ | Tokyo `cancelled` with a future period end, last history price raised to 9,500 → parser `matches: 1`, new history row (NT$6,579), no dedup skip, no error |
| `expired` email (follow-up) | ✅ | Tokyo back-dated past its period end → log `expired 1 subscription(s)` + `expired email sent to kyp001@gmail.com`; row `expired`; a second parser run sent nothing (no `flight-status-notification` call, `matches: 0`) |
| `payment_failed` email (follow-up) | ✅ | self-signed `RtnCode=0` callback → `payment_failed email sent`, `payment_failed_at` set, row stays `active`; identical 2nd failure → `1|OK`, flag unchanged, **no 2nd email** (only one status-notification call) |
| Renewal callback `flight-ecpay-period` | 🟡 partly | success path exercised with a **self-signed** `RtnCode=1` callback (CMV verified, `current_period_end` refreshed, `payment_failed_at` cleared). Not yet seen: a real renewal from ECPay's scheduler. To test: temporarily set `PeriodType=D, Frequency=1, ExecTimes=2` in `flight-subscribe`, pay the first period, check the logs the next day, then revert to `M` |
| Re-subscribe from `expired`; Seoul / London checkout | 🟡 | not exercised (code path shared with the Tokyo run) |

**Test data left behind (2026-09-19):**
- `TPE-TYO` (user kyp001@gmail.com) is now `expired`. Its `current_period_end`
  is still the **back-dated 2026-09-18 12:54:04Z** (originally 2026-10-19
  12:50:18Z) that was used to test the lapse — the cron tick did the flip.
  (Same lesson as the 09-17 history row: if you back-date to test, write it
  down.)
- After the follow-up tests (13:3x UTC): the Tokyo row was put back to `expired`
  (period end still back-dated), the history row raised to 9,500 was restored to
  6,556, and `payment_failed_at` is null. Left behind on purpose: one **new**
  `TPE-TYO` history row (NT$6,579, 13:35 UTC) from the fare-alert test. Three
  real emails went to kyp001@gmail.com (fare alert, expired, payment failed).
- `TPE-LON` is `pending_payment`, no checkout ever started. It is the old M1
  row; the migration flipped **both** pre-existing M1 rows to `pending_payment`
  by design (they stop being alerted until the user pays).
- The stage order `FPMU8DUXVA5K5Z3B` lives in ECPay's shared stage backoffice
  (already cancelled). Nothing real was charged.

**Where M2 differs from the skill as written** (fold these back into the skill):
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
  `20260919140000_flight_m2_payment_columns` (M2).
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

**Design**
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

1. **Finish the 🟡 items above.** First the lapse check: after the 13:00 UTC
   cron tick (or a parser run with `timeout_milliseconds := 60000`), Tokyo should
   read `expired` and `matches` should be 0. Then, if wanted, the daily-period
   renewal test and a re-subscribe run.
2. Fold the "differs from the skill" notes above back into
   `m2-code-ecpay-subscription` (and its `-checklist`), and correct the
   prerequisites skill's pointer to `m2-ecpay-subscription`
   (the real name is `m2-code-ecpay-subscription`).
3. **Before any real money:** M2 runs entirely on the shared **stage** merchant.
   Going live means a real MerchantID/HashKey/HashIV, `ECPAY_ENV=prod`, a real
   `SITE_URL`, and a deployed front-end that is the final code (the Vercel site
   is not yet). Per the skill, that is M3 ("啟動 M3", own domain / go-live) —
   check whether the M3 skill still assumes the AWS version first.
