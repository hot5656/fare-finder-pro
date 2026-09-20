---
name: m2-code-ecpay-subscription-checklist
description: Flight Price Notifier Milestone 2 verification (Supabase version) — confirms the ECPay recurring checkout works, the callback Edge Functions verify CheckMacValue and flip subscription_status active/cancelled/expired on flight.subscriptions, cancel calls CreditCardPeriodAction, RLS actually blocks the client from self-activating, and only paying users get alerts. Use when the student says "驗收 M2", "check M2", or after `m2-code-ecpay-subscription` Step 6.
---

# M2 — ECPay Checklist（Supabase 版）

## What this skill does

Confirms the paywall really works end-to-end: recurring checkout → callback (CMV-verified) → `active`; cancel → `cancelled` (grace) → `expired`; the grace-aware gating actually controls who gets emailed; and — the check that didn't exist in the AWS version — the client genuinely **cannot** write its own `subscription_status`. Also checks the lifecycle emails (welcome, cancel, payment-failed, expired) go out **once** each. Emits `READY for M3`. Run after `m2-code-ecpay-subscription` Step 8.

## Architecture

```
Product Site ──POST (user JWT)──▶ flight-subscribe ──form──▶ ECPay cashier
ECPay ──ReturnURL/PeriodReturnURL──▶ flight-ecpay-return / flight-ecpay-period ──update──▶ flight.subscriptions
ECPay ──OrderResultURL (browser POST)──▶ flight-ecpay-result ──302──▶ Product Site
Product Site ──POST /flight-cancel-subscription (user JWT)──▶ flight-cancel-subscription ──update──▶ flight.subscriptions
flight-ecpay-return / -period / flight-cancel-subscription / flight-parser ──direct call──▶ flight-status-notification ──▶ Resend
   (welcome / renewed / payment_failed / expired / cancel — each once)
flight-parser ──grace-aware select──▶ only active/cancelled-in-grace rows get fare emails; lapsed rows → expired (+ email)
```

## Execution mode

Claude Code with a normal shell, `supabase` CLI, SQL access, and `curl`. No AWS, no Cowork-only mode-dependent branching — every check below can just be run directly. There is still **no ECPay CLI/MCP** — the ECPay-side steps are driven from the **廠商後台** (模擬付款 button + 信用卡定期定額訂單查詢) and from a real **stage test-card** run in the browser, same as the AWS version.

## How to run

Run each check and report. Ask the student for: the Supabase **project ref**, the live product site URL, and a test inbox.

> **⚠️ Use the Resend-account owner's email as the test subscriber for B3/C1/E1.** Until a domain is verified, the Resend sandbox only delivers to the account owner's own verified address — any other recipient 403s and the welcome/cancel email silently never arrives. Substitute your Resend-account email everywhere `<your-resend-account-email>` appears below.

`flight.subscriptions` rows are the authoritative source throughout — read them with SQL (`select ... from flight.subscriptions where ...`) in the Supabase SQL editor or via `psql`.

> **Logs:** the CLI (2.109) has **no `supabase functions logs`**. Wherever a check below says "read the logs", use the dashboard (Edge Functions → function → Logs) or the Supabase MCP `query_logs`: source `function_logs` has the `console.log` lines in `event_message`; `function_edge_logs` has path / status in `log_attributes`. Logs lag by about a minute — re-query once before deciding a line is missing, and cross-check with the DB.
>
> **Triggering `flight-parser` from SQL:** `net.http_post(...)` gives up after 5 s (`Timeout of 5000 ms reached`) while the parser takes a few seconds. Pass `timeout_milliseconds := 60000` and read `net._http_response`; the body is `{"routes":N,"matches":N}` and **`matches` is the cleanest gate assertion** (dedup can hide a wrongly-included subscriber; the count can't).

### Section A — ECPay checkout form + secrets
- **A1** Secrets present: `supabase secrets list` → `ECPAY_MERCHANT_ID`, `ECPAY_HASH_KEY`, `ECPAY_HASH_IV`, `ECPAY_ENV`, `ECPAY_AMOUNT` (our implemented price is `300` = NT$300; any integer the student chose is acceptable).
- **A2** `flight-subscribe` returns an **auto-submit HTML form** whose `action` is the ECPay cashier and contains a `CheckMacValue` hidden field + `PeriodType`/`PeriodAmount`:
  ```bash
  curl -s -X POST "https://<ref>.supabase.co/functions/v1/flight-subscribe" \
    -H "Authorization: Bearer <the signed-in test user's access token>" \
    -H "content-type: application/json" \
    -d '{"plan_name":"tokyo","target_price":10000}' \
    | grep -oE 'AioCheckOut/V5|CheckMacValue|PeriodType'
  ```
  Expect all three tokens. (The body is just `plan_name` + `target_price`; the function derives `route` from `flight.routes` and `email`/`user_id` from the JWT, so a `route` sent by the client is ignored.) ECPay's cashier showing the order page — not a "CheckMacValue Error" — is the proof the signature and params are right.
- **A3** The `pending_payment` row with a `merchant_trade_no` was written:
  ```sql
  select subscription_status, merchant_trade_no
  from flight.subscriptions
  where email = '<your-resend-account-email>' and route = 'TPE-TYO';
  ```

### Section B — Callbacks verify CMV + flip to active
> **No card handy? Verify the callback path with a validly-signed synthetic callback (same-day).** The real cashier needs a human (card + OTP), but B2/B3 (and D3a's grace case) can be proven **without a card** by POSTing a callback you sign yourself with the real ECPay secrets — `RtnCode=1`, `CustomField1=<email>`, `CustomField2=<route>`, **including the empty `CustomField3=&CustomField4=`**, a real `CheckMacValue` (no `SimulatePaid`) — to `flight-ecpay-return`, then assert the row flips to `active`. This catches CMV/empty-field/idempotency bugs early. It's a **backend** proof only (no cashier UI / `OrderResultURL`), so still do **one** real stage test-card run before signing off. The stage HashKey/HashIV are public, so the same trick works for `flight-ecpay-period` (`RtnCode=1` renewal / `RtnCode=0` failure) — see G1/G2.

- **B1** All three ECPay-facing functions exist, are active, and have **`verify_jwt = false`** (ECPay sends no JWT): `supabase functions list --output json` → `flight-ecpay-return`, `flight-ecpay-period`, `flight-ecpay-result` all `ACTIVE` with `verify_jwt=false`. Smoke test — a forged body must be *rejected by the function*, not the gateway:
  ```bash
  curl -s -X POST "https://<ref>.supabase.co/functions/v1/flight-ecpay-return" -d 'MerchantID=3002607&MerchantTradeNo=FAKE1&RtnCode=1&CheckMacValue=DEADBEEF'
  ```
  Expect `0|CheckMacValue error` (HTTP 200). A **401 `UNAUTHORIZED_NO_AUTH_HEADER`** means `verify_jwt` is still on — no real callback would ever arrive.
- **B2** CheckMacValue verification works. Trigger the first-period callback via the stage 後台「模擬付款」 (or a real test-card run) and read the `flight-ecpay-return` logs (dashboard or MCP `query_logs`, see *Logs* above). Look for "CMV verified" + the update + replied `1|OK`, no CMV-mismatch error. **And** a bare 模擬付款 (`SimulatePaid=1`) must NOT grant active (the row stays `pending_payment` — confirm via the query in B3).
- **B3** **The decisive test:** complete a real **stage test-card** payment (`4311-9522-2222-2222`, `12/30`, CVV `222`, OTP `1234`) via the form → the row flips to `active`:
  ```sql
  select subscription_status, merchant_trade_no, current_period_end
  from flight.subscriptions where email = '<your-resend-account-email>' and route = 'TPE-TYO';
  ```
  Expect `active`, `merchant_trade_no` + `current_period_end` set. *(Don't expect `Gwsr` — it comes back **empty** on the real 定期定額 first-period callback; idempotency keys on `merchant_trade_no`.)*
- **B4** *(renewal — `flight-ecpay-period`; optional/time-gated)* Subscribe once with a **daily** period (`PeriodType=D, Frequency=1, ExecTimes=2`, per the M2 skill's Step 6 test procedure) and pay the first charge **successfully** (a failed first auth never enters the scheduler). **The next day**, confirm the scheduler fired the 2nd charge by reading the `flight-ecpay-period` logs. Expect CMV-verified, replied `1|OK`, `TotalSuccessTimes=2`, no `SimulatePaid`. *(Fast smoke-only alternative: 模擬付款 on the recurring order reaches `flight-ecpay-period` with `SimulatePaid=1` — proves reachability + CMV + `1|OK` but not the real bookkeeping.)* Mark ⚠️ "pending next-day check" if you ran the checklist same-day.
- **B5** *(`ecpay-result` returns 302, not an error)* The browser-return function redirects instead of erroring. ECPay delivers it as a **POST**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://<ref>.supabase.co/functions/v1/flight-ecpay-result" -d "RtnCode=1"
  ```
  Expect **`302`** to `<SITE_URL>/dashboard?purchase=success` (`SITE_URL` secret, default `http://localhost:8080`). As a cross-check, confirm `OrderResultURL` in `flight-subscribe`'s checkout params points at this function's URL, not the product site's own route — pointing it at the site directly would 405 there (the site is a static SPA), even though Supabase Edge Functions themselves handle any HTTP method fine.

### Section C — Status-change email (one function, routed by event_type)
- **C0** The function exists: `supabase functions list` → `flight-status-notification`, `ACTIVE`. (No queue to check — confirm from `flight-ecpay-return`'s source that it calls this function directly.)
- **C1** After B3, a **welcome** email arrives at the test inbox (`flight-ecpay-return` called `flight-status-notification` with `{event_type:"welcome"}`).
- **C2** `flight-status-notification` handles all five event types with an **explicit branch each** (`welcome` / `cancel` / `expired` / `payment_failed` / `renewed`) and rejects an unknown `event_type` with 400 — there must be no "anything else is a cancel email" fallthrough. It also rejects a call without the service-role bearer (401).

### Section D — Gating works, grace-aware (the point of M2)
- **D0** The parser gate (Step 5) is **grace-aware**, not plain `active` — invoking `flight-parser` for a route with a `pending_payment` row whose target is met does NOT match it. Invoke it and read the JSON it returns:
  ```bash
  curl -s -X POST "https://<ref>.supabase.co/functions/v1/flight-parser" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
  ```
  The body is `{"routes":N,"matches":N}`. Assert on **`matches`**: with one `active` and one `pending_payment` subscriber on routes whose targets are both met, expect **1**, not 2. (Don't rely on "no new email" — the M1 dedup can hide a wrongly-included subscriber.) If you trigger it from SQL instead of `curl`, use `net.http_post(..., timeout_milliseconds := 60000)` and read `net._http_response`, see *Triggering `flight-parser` from SQL* above.
- **D1** The now-`active` row (target above live fare) **is** matched + emailed when the parser runs → fare email arrives (via `flight-notification`, per M1).
- **D2** A `pending_payment` (unpaid) row is NOT matched/emailed. Confirms payment gates alerts.
- **D3a** *(cancelled, before expiry — still alerted)* This is the paid-through month a user is owed after cancelling. Right after E1, the `cancelled` row with a **future** `current_period_end` is **served**: the parser's `matches` includes it **and the fare email actually arrives** (a new `flight.notification_history` row is written for that user + route). "Matched" alone is not proof — the email is the deliverable. Use a target above the live fare. **Dedup can hide this** (within 24 h of an earlier alert for the same route the email is skipped): use M1's big-drop trick — raise that user+route's latest `notification_history.price` (e.g. to 9,500) so the live fare is ≥20 % / ≥NT$2,000 below it, run the parser, then **restore the original price**. The subject is the fare alert (`降價通知！NT$… 已達標`), not the cancel email from E1.
- **D3b** *(cancelled, after expiry — ended)* A `cancelled` row with a **past** `current_period_end` is NOT served, and is flipped to `expired` on that run — the run's log shows `expired 1 subscription(s)`, **one "ended" email** arrives, no fare email follows, and a **second** parser run sends nothing more:
  ```sql
  select subscription_status, current_period_end from flight.subscriptions where email = '<...>' and route = 'TPE-TYO';
  ```
  (D3a and D3b are the two sides of `current_period_end`: run D3a first, then back-date the same row for D3b — and write down / restore what you back-date.)
- **D4** *(renewals that silently stopped)* An `active` row whose `current_period_end` is more than `RENEWAL_GRACE_DAYS` (7) in the past — what a series ECPay auto-terminated after 6 failed charges looks like — is flipped to `expired` by the parser (with a "payment lapsed" email) and no longer matched. Back-date a test row to confirm; **write down / restore any row you back-date.**

### Section E — Cancellation (an API call you make; grace, not instant expiry)
- **E1** `flight-cancel-subscription` calls `CreditCardPeriodAction` and flips the row to **`cancelled`** (NOT `expired`), preserving `current_period_end`:
  ```bash
  curl -s -X POST "https://<ref>.supabase.co/functions/v1/flight-cancel-subscription" \
    -H "Authorization: Bearer <the signed-in test user's access token>" \
    -H "content-type: application/json" -d '{"plan_name":"tokyo"}'
  ```
  Then read the authoritative row:
  ```sql
  select subscription_status, current_period_end from flight.subscriptions where email = '<...>' and route = 'TPE-TYO';
  ```
  Expect `status=cancelled` with `current_period_end` set. A **cancel** email also arrives (same `flight-status-notification`, `{event_type:"cancel"}`). In the 後台 → 信用卡定期定額訂單查詢, the series shows terminated. ECPay's answer should log as `RtnCode=1 停用成功` for a real paid order. *(Stage-cancelling a never-paid synthetic order returns `90100150 不存在的訂單編號` — expected; the function should log it and still cancel locally. **Any other rejection** must return 502 and leave the row unchanged, so the user isn't charged with alerts off.)*
- **E2** A `cancelled`-in-grace subscriber can **update their target price** in place (no re-payment, status stays `cancelled`) — re-call `flight-subscribe` with a new `target_price` and expect an **`application/json`** response (not an ECPay form). Confirm by query: `target_price` changed, `subscription_status` still `cancelled`, no new `pending_payment`.
- **E3** Lifecycle end-to-end: `pending_payment → active → cancelled (grace, still alerted) → expired` (after `current_period_end` passes, via the parser). The expired row is no longer matched/emailed.

### Section F — RLS actually blocks self-activation (new check, no AWS equivalent)
This is the Supabase-specific check that replaces "the browser has no AWS credentials" — without it, M2's paywall is decorative.
- **F1** As the signed-in test user (browser console or a short script using their session, **not** the service role), attempt:
  ```ts
  await supabase.schema('flight').from('subscriptions')
    .update({ subscription_status: 'active' })
    .eq('user_id', user.id).eq('route', 'TPE-TYO');
  ```
  This must **fail** (RLS policy violation / zero rows affected). If it succeeds, the M1 `update` policy was never dropped in Step 2 of the build skill — a user can grant themselves the product for free. **Treat this as a blocking failure**, not a nice-to-have.
- **F1b** The table privileges are locked too, not just the policies: `select grantee, privilege_type from information_schema.role_table_grants where table_schema='flight' and table_name='subscriptions'` shows **only `SELECT` for `authenticated`** (INSERT/UPDATE only for `service_role`), and `pg_policies` lists only the select policy.
- **F2** The client can still **read** its own row's `subscription_status` (the select policy from M1 stays) — confirm a normal `select` still works for the signed-in user.

### Section G — Lifecycle emails go out once (payment failed / expired)
Both are driven by `flight-ecpay-period` and `flight-parser`; both must be **once-only**. You can drive `flight-ecpay-period` without ECPay by POSTing a **self-signed** `PeriodReturnURL` body (public stage HashKey/HashIV, same CMV algorithm, keep empty `CustomField3=&CustomField4=`) for a real `MerchantTradeNo` of an `active` test row.
- **G1** *(payment failed)* Send a signed `RtnCode=0` callback → `1|OK`, the row stays `active`, `payment_failed_at` is set, **one** `payment_failed` email arrives. Send the **same failure again** → `1|OK`, `payment_failed_at` unchanged, **no second email** (only one `flight-status-notification` call in the edge logs).
- **G2** *(recovery)* Send a signed `RtnCode=1` callback → `payment_failed_at` is cleared and `current_period_end` refreshed.
- **G4** *(renewal charged, once per charge)* A signed `RtnCode=1` callback whose `TotalSuccessTimes` is **higher than the stored `total_success_times`** → `1|OK`, `total_success_times` updated, **one** "本期已扣款" (`renewed`) email arrives with the amount and the new `current_period_end`. Send the **same callback again** → `1|OK`, no second email (the log says `already processed`, and only one `flight-status-notification` call). Then `TotalSuccessTimes` + 1 → a new email. Also confirm the first charge sets `total_success_times = 1` (`flight-ecpay-return`). A real ECPay renewal (B4) should produce the same single email.
- **G3** *(expired, once)* Covered by D3b/D4: each row that flips to `expired` produces exactly one email; a second parser run produces none.

## Reporting

| Check | Status | Notes |
|---|---|---|
| A1/A2/A3 secrets + checkout form + pending row | ✅/❌ | |
| B1 three ECPay functions deployed with verify_jwt=false; forged body → `0|CheckMacValue error` | ✅/❌ | a 401 = gateway JWT still on |
| B2 CMV verified + SimulatePaid guarded | ✅/❌ | the fiddly one |
| B3 payment → active (+ current_period_end) | ✅/❌ | the key one |
| B4 renewal → flight-ecpay-period (daily test) | ✅/❌/⚠️ | ⚠️ if next-day check pending |
| B5 ecpay-result → 302 | ✅/❌ | |
| C0/C1 status function + welcome email | ✅/❌ | event_type routing |
| C2 five explicit event branches, unknown → 400, no bearer → 401 | ✅/❌ | no fallthrough |
| D0 parser gate grace-aware | ✅/❌ | the gate itself |
| D1/D2 active emailed / pending_payment not | ✅/❌ | gating proof |
| D3a cancelled **before** expiry: matched **and fare email arrives** | ✅/❌ | grace period — the email, not just `matches` |
| D3b cancelled **after** expiry: flipped to expired, one "ended" email, no fare email, 2nd run silent | ✅/❌ | grace ends |
| D4 active row with renewals long overdue → expired | ✅/❌ | the case ECPay never reports |
| E1 cancel → cancelled (NOT expired) + email | ✅/❌ | API call, grace not instant |
| E2 cancelled-in-grace can update target | ✅/❌ | in-place, no re-pay |
| E3 lifecycle → expired after period passes | ✅/❌ | parser lazily expires |
| F1 RLS blocks client self-activation | ✅/❌ | **blocking** — the paywall's real gate |
| F1b grants: authenticated has SELECT only | ✅/❌ | |
| F2 client can still read own status | ✅/❌ | |
| G1/G2 payment_failed once; cleared on recovery | ✅/❌ | `payment_failed_at` |
| G4 renewed email once per charge; resend silent; first charge sets count 1 | ✅/❌ | `total_success_times` |
| G3 expired emailed exactly once | ✅/❌ | `update … returning` |

**Verdict:**
- All ✅ → 「M2 驗收通過 ✅ 產品會賺錢了，只有付費者收得到通知。READY for M3。跟我說『啟動 M3』來掛自己的網域、正式開張。」
- Any ❌ → name failures + recovery:
  - **callbacks never arrive and the forged-body smoke test returns 401** → `verify_jwt` is still `true` on `flight-ecpay-return` / `-period` / `-result`. ECPay sends no JWT: set `verify_jwt = false` in `supabase/config.toml` and redeploy with `--no-verify-jwt`.
  - **user gets several `renewed` emails for one charge** → the once-per-charge guard is missing: compare the callback's `TotalSuccessTimes` with the stored `total_success_times` **inside** the update (`where … is null or < N … returning`) and only email the call that gets a row back.
  - **user gets several `payment_failed` (or `expired`) emails** → the once-only guard is missing: `payment_failed_at` must be set with `where payment_failed_at is null … returning`, and `expired` must be sent only for rows a `update … returning` actually flipped.
  - **a subscriber whose card stopped working is still being alerted weeks later** → the parser has no "active but `current_period_end` far past → expired" rule (ECPay ends the series after 6 failures without telling you).
  - CMV reject / callback "never arrives" but 後台 shows paid → you're **dropping empty-string fields** before hashing; keep `CustomField3=`/`CustomField4=`. For a `~` in any value, check the `ecpayUrlEncode` implementation.
  - not flipping → check `CustomField1/2` (email+route) map to the right row + the `update` actually runs; idempotency on **`merchant_trade_no`, not `Gwsr`** (`Gwsr` is empty on recurring).
  - **error right after paying instead of a redirect** → `OrderResultURL` points at the product site's own route instead of `flight-ecpay-result`; fix per Step 4c of the build skill. Payment still succeeded.
  - renewals don't update → you only built `flight-ecpay-return`; add/fix `flight-ecpay-period`.
  - **cancel expires instantly instead of granting grace** → cancel must set `cancelled` + keep `current_period_end`, and the parser must serve `cancelled`-in-grace + lazily expire. Don't set `expired` in `flight-cancel-subscription`.
  - 模擬付款 grants free access → guard `SimulatePaid` in `flight-ecpay-return`/`flight-ecpay-period`.
  - cancel does nothing → cancel is `CreditCardPeriodAction Action=Cancel` that **you** call, not an event you wait for. `90100150` on a never-paid order is expected.
  - emails not arriving → Resend sandbox only reaches your own account email (verify a domain later).
  - **welcome/cancel email never arrives, log shows `403` with body `error code: 1010`** → `flight-status-notification` is POSTing to Resend **without a `User-Agent` header**, so Cloudflare bans it. Not an account/recipient issue — add a `User-Agent` header, reusing M1's `flight-notification` pattern. Distinguish from the sandbox `validation_error` 403 by the `1010` code.
  - **F1 fails (client CAN self-activate)** → the M1 `insert`/`update` RLS policies on `flight.subscriptions` were never dropped, or a new permissive policy was added since. Re-run Step 2 of the build skill's migration and re-check.

  then re-run `驗收 M2`.
