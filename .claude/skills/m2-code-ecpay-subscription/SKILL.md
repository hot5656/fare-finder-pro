---
name: m2-code-ecpay-subscription
description: Flight Price Notifier Milestone 2 — set up an ECPay (綠界) 信用卡定期定額 monthly subscription so only paying users get alerts, running on Supabase (no AWS). An ECPay AIO recurring-payment checkout (built inside a `flight-subscribe` Edge Function, replacing M1's direct client write) + two callback Edge Functions (ecpay-return for the first charge, ecpay-period for renewals) drive a subscription lifecycle pending_payment → active → cancelled (grace period) → expired on flight.subscriptions (the callbacks, verified by CheckMacValue, are the source of truth for paid status — RLS write access to the table is locked down in this milestone so the browser can no longer set its own status). ecpay-result handles the OrderResultURL browser-POST redirect. Cancelling calls ECPay's CreditCardPeriodAction but keeps service until current_period_end. Use when the student says "啟動 M2", "start M2", "接金流", "接綠界", "接 ECPay", "做訂閱付款", or "讓只有付費者收得到通知".
---

# M2 — ECPay 定期定額（接金流，只有付費者收得到通知）（Supabase 版）

## What this skill does

Turns the working **free** notifier (M1, Supabase version) into a **paid** service using **ECPay 綠界** — Taiwan's payment gateway, charging in **TWD**. **This is where the paywall is born** — M1 had no `subscription_status` and emailed anyone; M2 introduces the column, the callbacks that set it, and the parser filter that enforces it:

1. An ECPay **信用卡定期定額** (credit-card recurring) checkout — built as an **AIO auto-submit form**, not an SDK call.
2. **A new `flight-subscribe` Edge Function replaces M1's direct client-side `upsert`.** This is the one real architecture change M2 forces on the M1 design: once the row carries `subscription_status` — actual proof of payment — the browser can no longer be allowed to write it directly (M1's RLS let a signed-in user `upsert` their own row freely, which was fine when the row was just a target-price preference). `flight-subscribe` now writes `subscription_status = pending_payment` and builds the ECPay recurring-checkout form (signed with a **CheckMacValue**), returning its auto-submit HTML so the browser POSTs the user to ECPay's cashier to pay.
3. **Two callback Edge Functions** that **verify the CheckMacValue** (the SOURCE OF TRUTH for paid status) and flip the row's `subscription_status`:
   - **`flight-ecpay-return`** — receives the **first** authorization result (paid at checkout) → `active`.
   - **`flight-ecpay-period`** — receives **every subsequent monthly** authorization result → keeps `active`, refreshes `current_period_end` and sends the user a **"renewal charged"** email (`renewed`, once per charge). A **failed** charge does not expire the row: the user gets a one-time `payment_failed` email, and the row only ends if ECPay reports the run is over (see Step 4 and Step 5 for the case ECPay never tells you about).
   - both **call `flight-status-notification` directly** (same fire-and-forget HTTP pattern M1 uses between `flight-parser` and `flight-notification` — no queue): `flight-ecpay-return` sends `{ event_type: "welcome", ... }`; `flight-ecpay-period` sends `"payment_failed"` / `"expired"`.
   - **ECPay's servers (and the user's browser, for `flight-ecpay-result`) call these with no Supabase JWT, so all three ECPay-facing functions must be deployed with `verify_jwt = false`** — the CheckMacValue is their authentication. With the default (`true`) the gateway 401s every callback and you never see one arrive (Step 4).
4. A **`flight-cancel-subscription`** Edge Function that calls ECPay's **`CreditCardPeriodAction` `Action=Cancel`** to stop future charges, flips the row to `cancelled` (grace period, not instantly `expired`), and calls `flight-status-notification` with `{event_type:"cancel", ...}`.

> **One notification function, routed by `event_type`.** Subscribe and unsubscribe emails both flow through the **same** `flight-status-notification` Edge Function — every caller passes an `event_type` (`"welcome"` / `"cancel"` / `"expired"` / `"payment_failed"` / `"renewed"`) and the one function branches on it to render the right email. (Don't build two notification functions — same principle as M1's single `flight-notification`.)
5. **`flight-parser` (M1.2) gains a grace-aware `active`-or-`cancelled` filter** in its `select`, and lazily retires lapsed rows (emailing each user once). *This* is what makes only paying users get alerts.

End state: a test payment flips a row `pending_payment → active` (and it starts getting alerts); cancelling flips it to `cancelled` (still alerted through the paid period, then lazily `expired` with an "ended" email). A failed renewal emails the user once. A `pending_payment` (unpaid) row is never emailed.

> **Why ECPay, not Stripe?** This course targets a Taiwan audience charging in **TWD**. ECPay (綠界) is the standard local gateway. The *shape* of M2 is identical to a Stripe paywall — payment flips a status field, a verified callback is the source of truth, the parser gates on `active` — but ECPay's mechanics differ in four ways you must learn (see "Things to watch out for"): **two callbacks instead of one webhook**, **CheckMacValue instead of a signature header**, **cancel is an API call you make, not an event you receive**, and **no SDK needed** (CMV is a plain SHA-256 you compute with Deno's built-in `crypto.subtle`).

## Architecture

```
訂閱表單 ──POST──▶ flight-subscribe (Edge Function, called with the user's JWT — not service role)
                     · looks up flight.subscriptions for (user_id, route)
                     · new / expired row → insert as pending_payment + fresh merchant_trade_no,
                       build ECPay 定期定額 AIO params, sign with CheckMacValue,
                       return an auto-submit HTML form (browser → ECPay cashier)
                     · active/cancelled row, target_price-only change → plain update, return JSON (no re-payment)
瀏覽器自動 POST 去 ECPay 收銀台，付款（第一期，當下立即授權）
   ├─ ReturnURL（S2S，幕後）──▶ flight-ecpay-return (Edge Function) — paid 狀態的唯一真相來源
   │                        · 驗 CheckMacValue（含空字串欄位）+ MerchantID + RtnCode=="1"
   │                        · update flight.subscriptions set subscription_status='active', current_period_end=...
   │                        · 直接呼叫 flight-status-notification {event_type:"welcome",...}
   │                        · 回純文字 1|OK
   └─ OrderResultURL（瀏覽器 POST）──▶ flight-ecpay-result (Edge Function)
                            · 302 redirect to <site>/dashboard?purchase=success|failed（用你 App 登入後的頁面；不可指向前端靜態路由）
之後（第 2 期起，每月自動扣款）
   └─ PeriodReturnURL ──▶ flight-ecpay-period (Edge Function)
                           · 驗 CMV；續扣成功 → 維持 active + 刷新 current_period_end + 清掉 payment_failed_at + 寄 renewed（本期已扣款；用 total_success_times 確保每次扣款只寄一封）
                           · 續扣失敗 → 維持 active；每個週期只在「第一次」失敗寄一封 payment_failed（payment_failed_at 去重）
                           · 用完所有期數 → expired（寄 expired）· 回 1|OK
                           · 連續失敗 6 次 ECPay 會自動終止，但不會通知我們 → 由 flight-parser 依 current_period_end 逾期判定（Step 5）
退訂（給寬限期，不是立刻 expired）
   └─ 「取消訂閱」─POST /functions/v1/flight-cancel-subscription──▶ flight-cancel-subscription (Edge Function)
                           · 驗使用者 JWT，查該使用者的 merchant_trade_no
                           · POST ECPay CreditCardPeriodAction, Action=Cancel
                           · subscription_status → cancelled（保留 current_period_end，期間內仍收得到）
                           · 直接呼叫 flight-status-notification {event_type:"cancel",...}
flight-parser 的 select 加上：WHERE subscription_status='active' OR (subscription_status='cancelled' AND current_period_end >= now())
                              （順手把過期的 row 懶惰改成 expired 並寄 expired 通知：cancelled 且已過期；或 active 但 current_period_end 逾期超過 7 天沒續扣）
```

## When to load this skill

- "啟動 M2" / "start M2" / "接金流" / "接綠界" / "接 ECPay" / "做訂閱付款"

Requires M1 done (`m1-code-flight-price-checker-checklist` green — the free notifier works on Supabase). Adds one account: **ECPay 綠界** (start with the shared stage test merchant).

## Execution mode

Claude Code with a normal shell, `supabase` CLI, `curl`/a short Deno or Node script (ECPay has **no CLI** like Stripe's). No AWS, no Cowork-only constraints.

## Required external accounts (new)

| # | Service | Used for |
|---|---|---|
| 1 | ECPay 綠界 (`ecpay.com.tw`) | 信用卡定期定額 checkout + callbacks |

> For the whole course you can run on ECPay's **shared stage test merchant** — `MerchantID=3002607`, `HashKey=pwFHCqoQZGmho4w6`, `HashIV=EkRm7iFT261dpevs` (public, safe as defaults). Applying for a **real** MerchantID (and confirming 定期定額 is enabled on it) is a later milestone — [[ecpay-go-live]].

---

## Step 1 — Store the ECPay credentials as Supabase secrets

ECPay has no `products`/`prices` objects (unlike Stripe) — the price is just the `TotalAmount` you put in the checkout form. We implement a fixed monthly price of **NT$300**, stored as a secret so changing it later is a one-line update, never a code change.

```bash
supabase secrets set ECPAY_MERCHANT_ID=3002607
supabase secrets set ECPAY_HASH_KEY=pwFHCqoQZGmho4w6
supabase secrets set ECPAY_HASH_IV=EkRm7iFT261dpevs
supabase secrets set ECPAY_ENV=stage
supabase secrets set ECPAY_AMOUNT=300
```

**Verify:** `supabase secrets list` shows all five. *(Heads-up: the CLI prints a `value` field for each secret — SHA-256 digests, not plaintext, but still don't paste that output around. `supabase secrets list --output json` and print only the names.)*

Optional sixth secret, **`SITE_URL`** (e.g. `https://your-domain.com`): where `flight-ecpay-result` sends the browser after payment, and the base of the 重新訂閱 link in the "expired" email. Unset, the redirect defaults to `http://localhost:8080` and the email simply has no link (better than a localhost link in a real inbox). Set it once there is a deployed front-end.

## Step 2 — Migration: add payment columns, and lock down direct client writes

```sql
alter table flight.subscriptions
  add column subscription_status text not null default 'pending_payment'
    check (subscription_status in ('pending_payment', 'active', 'cancelled', 'expired')),
  add column merchant_trade_no text,
  add column current_period_end timestamptz,
  -- set on the first failed renewal of a cycle so the "payment failed" email is once-only
  -- (ECPay calls back on every retry); cleared again on a successful renewal.
  add column payment_failed_at timestamptz,
  -- the last successful-charge count we processed (ECPay's TotalSuccessTimes), so the
  -- "renewal charged" email is sent once per charge even though ECPay resends callbacks.
  add column total_success_times integer;

create unique index subscriptions_merchant_trade_no_key
  on flight.subscriptions (merchant_trade_no) where merchant_trade_no is not null;

-- Architecture change from M1: the client no longer writes flight.subscriptions directly.
-- Every write now happens inside an Edge Function (flight-subscribe, flight-ecpay-return,
-- flight-ecpay-period, flight-cancel-subscription), all running with the service role
-- after their own verification (a valid user JWT, or a verified CheckMacValue).
drop policy if exists "insert own subscriptions" on flight.subscriptions;
drop policy if exists "update own subscriptions" on flight.subscriptions;
-- Postgres checks GRANTs as well as policies; revoke the table privileges too so a re-added
-- policy later can't silently re-open the hole.
revoke insert, update on flight.subscriptions from authenticated;
-- the select policy from M1 stays — users can still read their own row's live status.
```

> **Why this matters more than it looks:** M1's `with check (auth.uid() = user_id)` was enough when the worst a user could do was set their own target price. Now that the same row also carries `subscription_status`, a client that can still `update` its own row could simply set itself to `active` from the browser console and get the product for free. In the AWS version, "the browser has no AWS credentials" made this attack impossible by construction; here, RLS policies are doing that job, and they have to be tightened by hand the moment the stakes change. **This is the single most important difference from the AWS version of M2** — don't skip it.

Apply it the way this shared project needs (never `supabase db push`): `supabase db query --linked --file <migration>.sql`, then `supabase migration repair --status applied <version>`.

**Verify:** as a signed-in test user, attempting `supabase.schema('flight').from('subscriptions').update({ subscription_status: 'active' })` from the browser console now fails (no matching policy, and no UPDATE grant) — confirming the client truly can't self-activate. In SQL: `select policyname from pg_policies where schemaname='flight' and tablename='subscriptions'` should list only the select policy.

## Step 3 — Write `flight-subscribe` (replaces M1's direct client upsert)

```bash
supabase functions new flight-subscribe
```

Unlike the two ECPay callbacks below, this function is called **by the signed-in user** (from the front-end, with their normal session), not by `pg_cron` or ECPay — so it verifies the caller's **Supabase user JWT** (`admin.auth.getUser(jwt)`), not a service-role bearer, and reads `user_id`/`email` off it. Keep `verify_jwt = true` in `supabase/config.toml` for it (and for `flight-cancel-subscription` / `flight-status-notification`).

Because a **browser** calls it, it must answer the CORS preflight (`OPTIONS` → 204) and put the CORS headers on every response, including the `text/html` one. The request body is just `{ plan_name, target_price }`: **derive `route` from `flight.routes` by `plan_name`, and `email`/`user_id` from the JWT — never trust them from the body.**

1. Look up the existing row for `(user_id, route)`.
2. **No row, or the row is `expired` (or still `pending_payment` — user retrying):** insert/overwrite as `subscription_status='pending_payment'` with a fresh, unique `merchant_trade_no` (≤20 chars — store it, you need it later to cancel). Build the ECPay AIO 定期定額 params and sign them:
   - `MerchantID` (from `ECPAY_MERCHANT_ID`), `MerchantTradeNo`, `MerchantTradeDate` (`yyyy/MM/dd HH:mm:ss`), `PaymentType=aio`, `ChoosePayment=Credit`, `EncryptType=1`.
   - `TotalAmount=PeriodAmount=<ECPAY_AMOUNT>` — **they must be equal** (ECPay rule); read the amount from the secret, never hard-code `300` in the handler.
   - `PeriodType=M`, `Frequency=1`, `ExecTimes=999` (monthly; 999 ≈ "effectively indefinite" — ECPay has no true ∞, see watch-out 6). `ExecTimes` must be ≥ 2.
   - `ItemName`, `TradeDesc` (avoid WAF-flagged keywords like `curl`/`python`, and glyphs like `✈` — use the route code, e.g. `Flight Price Notifier TPE-TYO 月訂閱`).
   - `ReturnURL=https://<ref>.supabase.co/functions/v1/flight-ecpay-return`, `PeriodReturnURL=.../flight-ecpay-period`, **`OrderResultURL=.../flight-ecpay-result`** — **a function's URL is its slug**, so use the full `flight-…` names. Point `OrderResultURL` at the redirect function, not your product site's own route (see Step 4 / watch-out 10).
   - `CustomField1=email`, `CustomField2=route` — the join key the callbacks read to find the row.
   - compute `CheckMacValue` (see [[ecpay-best-practice]] for the exact algorithm + the 7-character `ecpayUrlEncode` table — this part is unchanged from the AWS version, it's pure string/hash logic).
   - Return an **auto-submit HTML form** (`<form action="https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5" method="post">`, one hidden input per field, a trailing `<script>document.forms[0].submit()</script>`).
3. **Row is `active` or `cancelled` (in grace) and only `target_price` changed:** just `update flight.subscriptions set target_price = ...` — no new payment, no ECPay call. Return **`application/json`**.
4. **Idempotency:** never knock an `active` row back to `pending_payment`.

Deploy: `supabase functions deploy flight-subscribe --use-api`.

> **Front-end contract (unchanged from the AWS version, still the part that silently breaks if missed):** the client must branch on the response's `Content-Type`.
> - **`text/html`** → hand the browser to ECPay's cashier: `const html = await res.text(); document.open(); document.write(html); document.close();` (the returned form's inline `<script>` then auto-submits).
> - **`application/json`** → an in-place update; refresh the card without navigating.

**Verify:** calling `flight-subscribe` for a new route returns HTML whose form `action` is the ECPay cashier URL and contains a `CheckMacValue` hidden field; `select * from flight.subscriptions where email = '...';` shows the row as `pending_payment` with a `merchant_trade_no` set. **The real test that the hash is right is ECPay's cashier: if it shows the order page (not a "CheckMacValue Error") the signature and params were accepted.**

## Step 4 — Build the ECPay callback Edge Functions (highest-risk files)

The CheckMacValue algorithm, the two-callback split, and every pitfall here are **unchanged from the AWS version** — only the runtime moved from Python/Lambda to Deno/TypeScript, and a DynamoDB `UpdateItem` becomes a Postgres `update`.

> **`verify_jwt = false` on all three functions below — the step this skill used to miss.** ECPay's servers send no Supabase JWT. Set `verify_jwt = false` for `flight-ecpay-return`, `flight-ecpay-period` and `flight-ecpay-result` in `supabase/config.toml`, and deploy them with `--no-verify-jwt` so the flag can't drift. Otherwise the gateway answers 401 and no callback ever reaches your code. The CheckMacValue is what authenticates the call.

**`flight-ecpay-return`** (`POST /functions/v1/flight-ecpay-return` — first period, source of truth for activation):
1. Parse the **form-urlencoded** body (ECPay callbacks are always `application/x-www-form-urlencoded`, never JSON).
2. **Verify the CheckMacValue** over the returned fields — **keep empty-string fields in the hash** (ECPay sends and signs `CustomField3=&CustomField4=`; dropping them gives a wrong hash — the single most common ECPay bug). Also verify `MerchantID` matches `ECPAY_MERCHANT_ID`.
3. If `RtnCode === "1"` (string!) **and** not a bare `SimulatePaid=1` test (see watch-out 7): `update flight.subscriptions set subscription_status='active', total_success_times = 1, current_period_end = now() + interval '1 month' where merchant_trade_no = <MerchantTradeNo> and email = <CustomField1> and route = <CustomField2>` (the trade number pins it to *this* checkout attempt; `flight-subscribe` already stored it).
4. **Idempotency: key on `MerchantTradeNo` + "is the row already `active`?", NOT on `Gwsr`.** `Gwsr` comes back **empty** on the real 定期定額 first-period callback. If already activated for this trade-no, skip the write but still ack.
5. On success, **call `flight-status-notification` directly** (service-role bearer, fire-and-forget — same pattern as M1's `flight-parser`→`flight-notification` handoff) with `{ event_type: "welcome", email, route }`. Register the request with `EdgeRuntime.waitUntil(...)` so the runtime doesn't cut it off once you've replied `1|OK`.
6. Reply with the **plain-text body `1|OK`**, `Content-Type: text/plain` (anything else → ECPay resends 4× over ~20–60 min). On a verification failure reply `0|<reason>`.

**`flight-ecpay-period`** (`POST /functions/v1/flight-ecpay-period` — 2nd charge onward): same verify, same `SimulatePaid` guard. Look the row up by `MerchantTradeNo`.
- **`RtnCode=="1"`:** keep `active`, **refresh `current_period_end`** (extend by one period), **clear `payment_failed_at`**, and email the user a `renewed` notice ("本期已扣款 NT$300，服務延長至 …"). A renewal that lands after a cancel must not resurrect a `cancelled`/`expired` row.
  - **Once per charge:** ECPay resends the callback until it gets `1|OK`. `TotalSuccessTimes` is the running count of successful charges, so make the guard part of the update: `update … set total_success_times = N, current_period_end = …, payment_failed_at = null where id = … and status in ('active','pending_payment') and (total_success_times is null or total_success_times < N) returning email, route, current_period_end` — only the call that gets a row back sends the email; a resend gets nothing back and just acks. Without a usable `TotalSuccessTimes` you can't tell a new charge from a resend, so extend the period but **don't** email.
  - The real callback has **no `SimulatePaid` field at all** (it reads as `undefined`), so test `=== "1"`, never a truthy check that a missing field could trip.
- **Failure:** **don't expire on the first miss** — ECPay auto-retries and only auto-terminates after **6 consecutive failures**. Instead, send the user **one** `payment_failed` email per cycle. ECPay calls back on *every* retry, so make "first" atomic: `update … set payment_failed_at = now() where id = … and subscription_status = 'active' and payment_failed_at is null returning email, route` — only the call that gets a row back sends the email.
- **Series over:** if ECPay reports every scheduled execution used (`TotalSuccessTimes >= ExecTimes`), flip to `expired` with `… where subscription_status <> 'expired' returning email, route` and email `expired` (`reason: "payment_lapsed"`) only if a row came back — once-only.
- ⚠️ **What ECPay does *not* tell you:** after 6 consecutive failures it terminates the series with far fewer successes than `ExecTimes`, and sends no final callback. A row in that state would stay `active` forever. That case is caught by `flight-parser` in Step 5, not here.
- Reply `1|OK`.

**`flight-ecpay-result`** (`ANY /functions/v1/flight-ecpay-result` — the browser-return redirect): ECPay delivers `OrderResultURL` as a **browser POST**. Your product site is (presumably) a static SPA, which would 405 on a POST to a page route — this tiny function exists purely to turn that POST into a redirect. It does **no** auth/activation (that's `ecpay-return`'s job). Read `RtnCode` from the body if you want success/fail branching, then:
```ts
return new Response(null, { status: 302, headers: { Location: `${SITE_URL}/dashboard?purchase=${rtnCode === "1" ? "success" : "failed"}` } });
```
(`SITE_URL` from the optional secret, default `http://localhost:8080`. The front-end reads `?purchase=` to show a banner and, on `success`, polls the subscription for a few seconds — the S2S callback can land slightly after the browser does.)

Put the shared CheckMacValue / checkout-form code in `supabase/functions/_shared/ecpay.ts` and import it as `../_shared/ecpay.ts` — `--use-api` bundles it.

Deploy all three **without** the JWT gate: `for f in flight-ecpay-return flight-ecpay-period flight-ecpay-result; do supabase functions deploy $f --use-api --no-verify-jwt; done`.

**Verify (no card needed):** ECPay callbacks need a **publicly reachable URL** — Supabase Edge Functions are public the moment they're deployed, so there's nothing extra to expose. Smoke-test first:
```bash
B=https://<ref>.supabase.co/functions/v1
curl -s -X POST $B/flight-ecpay-return -d 'MerchantID=3002607&MerchantTradeNo=FAKE1&RtnCode=1&CheckMacValue=DEADBEEF'   # expect: 0|CheckMacValue error   (HTTP 200)
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -X POST $B/flight-ecpay-result -d 'RtnCode=1'                  # expect: 302 <SITE_URL>/dashboard?purchase=success
```
`0|CheckMacValue error` proves the function is reachable **without a JWT** and enforces the hash; a `401` means `verify_jwt` is still on. Then do a **real stage test-card** run through the form (Step 6). **The CLI (2.109) has no `supabase functions logs`** — read logs in the dashboard (Edge Functions → function → Logs) or with the Supabase MCP `query_logs` (`function_logs` has the `console.log` lines in `event_message`; `function_edge_logs` has path/status). Look for "CMV verified" + the row flipping to `active`. Logs lag by about a minute; re-query once before concluding a line is missing.

## Step 5 — Turn ON the paywall: the grace-aware gate in `flight-parser`

Not a plain `status == active` filter — cancellation grants a grace period. Update `flight-parser` (from M1) to, once per invocation, first lazily retire two kinds of lapsed row — **and email each user once**:
```sql
-- 1) cancelled, and the period they paid for is over
update flight.subscriptions set subscription_status = 'expired'
where subscription_status = 'cancelled' and current_period_end < now()
returning email, route;                                   -- reason: 'period_ended'

-- 2) still 'active' but renewals stopped arriving (RENEWAL_GRACE_DAYS = 7)
update flight.subscriptions set subscription_status = 'expired'
where subscription_status = 'active' and current_period_end < now() - interval '7 days'
returning email, route;                                   -- reason: 'payment_lapsed'
```
(In supabase-js: `.update({...}).eq(...).lt(...).select("email, route")`.) Each statement returns **only the rows it actually flipped**, so a row can only ever trigger one email — for each returned row POST `{ event_type: "expired", email, route, reason }` to `flight-status-notification` (service-role bearer, `EdgeRuntime.waitUntil`). Rule 2 exists because ECPay gives up after 6 consecutive failed charges **without telling you**; a `current_period_end` that has passed with no renewal to move it is the only signal. Pick the grace so it is longer than ECPay's retry window.

Then change its subscriber query from `select * from flight.subscriptions where route = :route` to:
```sql
select * from flight.subscriptions
where route = :route
  and (subscription_status = 'active'
       or (subscription_status = 'cancelled' and current_period_end >= now()));
```
(In supabase-js the `or` form is `.or("subscription_status.eq.active,and(subscription_status.eq.cancelled,current_period_end.gte.<nowIso>)")`.) `pending_payment`/`expired` rows are never served. Redeploy: `supabase functions deploy flight-parser --use-api`.

**Verify:** a `pending_payment` row whose target is met is NOT matched; an `active` row IS; a `cancelled` row with a **future** `current_period_end` IS (grace); a `cancelled` row with a **past** `current_period_end` gets flipped to `expired` on the next run and stops matching (and that user gets one "ended" email; a second parser run sends nothing). (Old M1-only rows: since Step 2's migration added `subscription_status` as `not null default 'pending_payment'`, every pre-existing row became `pending_payment` automatically and stops matching until re-subscribed + paid.)

## Step 6 — Test a real recurring payment end-to-end

Run the full flow: submit the form (writes a `pending_payment` row + returns the auto-submit HTML) → the browser lands on ECPay's cashier → pay with the **stage test card** `4311-9522-2222-2222`, expiry `12/30`, CVV `222`, OTP `1234` → land back on `/dashboard?purchase=success` (via `flight-ecpay-result`'s redirect) → confirm the row flips to `active` (the `flight-ecpay-return` callback did it).

**Verify:**
```sql
select subscription_status, merchant_trade_no, current_period_end
from flight.subscriptions where email = '<payer>' and route = 'TPE-TYO';
```
→ `active`, `merchant_trade_no` + `current_period_end` set. Then manually invoke `flight-parser` → the now-active row is matched and emailed (if at/below target). A `pending_payment` payer is NOT.

> **Stage cashier walkthrough** (works from a browser-automation tool too): `立即付款` → an "you are in the test environment" modal (close it) → `立即付款` again → a "確定使用信用卡" modal (`確定`) → ECPay's simulated 3D-Secure page: `取得OTP服務密碼` reveals the OTP (`1234`), type it, `送出` → ECPay POSTs the browser to `OrderResultURL`. Cardholder name and phone are required (any test values — use generic ones, not a real person's).

**Testing the callback handlers without ECPay (fast):** the stage HashKey/HashIV are public, so a ~40-line script can build a **validly-signed** `PeriodReturnURL` body (same CMV algorithm, keep the empty `CustomField3=`/`CustomField4=`) and POST it to `flight-ecpay-period`: `RtnCode=0` → one `payment_failed` email and `payment_failed_at` set; the same body again → `1|OK`, no second email; `RtnCode=1` → `payment_failed_at` cleared and `current_period_end` refreshed. Use a real `MerchantTradeNo` from your test row. (A validly-signed callback for an unknown trade number returns `1|OK`; a forged one returns `0|CheckMacValue error`.) This does not replace the real renewal test below.

**To test the renewal callback without waiting a month:** temporarily change `flight-subscribe`'s checkout params to `PeriodType=D, Frequency=1, ExecTimes=2`, redeploy, pay the first period (it **must succeed** — a failed first auth never enters ECPay's scheduler, so you'd get no renewal at all). The next day, ECPay's scheduler runs the 2nd charge and POSTs a real (non-`SimulatePaid`) result to `flight-ecpay-period` — check its logs for "CMV verified", `1|OK`, `TotalSuccessTimes=2`. Revert to `PeriodType=M` afterward. (Pressing 模擬付款 in the stage 後台 instead proves the function is reached + verifies + replies `1|OK`, but per watch-out 7 the handler ignores `SimulatePaid`, so it doesn't exercise the real renewal bookkeeping — the daily-period method above is the faithful test.)

## Step 7 — Build + test cancellation

Unlike Stripe, ECPay cancellation is something **you call**, and it grants a **grace period** — it does not expire instantly.

```bash
supabase functions new flight-cancel-subscription
```

`flight-cancel-subscription` (`POST /functions/v1/flight-cancel-subscription`, body `{ plan_name }`, called with the user's JWT; answer CORS like `flight-subscribe`):
1. Verify the caller's session; look up their row (`user_id` + `plan_name`) and its stored `merchant_trade_no`. Already `cancelled` → return the current state (idempotent); `expired` → 409.
2. `POST` to `https://payment-stage.ecpay.com.tw/Cashier/CreditCardPeriodAction` with `MerchantID`, `MerchantTradeNo`, `Action=Cancel`, `TimeStamp`, and a `CheckMacValue` over them. Success is `RtnCode=1` (`停用成功`). **Only** `90100150 不存在的訂單編號` (a never-paid synthetic order) is treated as "nothing to stop charging — log it and cancel locally". **Any other rejection: return 502 and leave the row untouched**, otherwise the user keeps being charged with their alerts switched off.
3. `update flight.subscriptions set subscription_status='cancelled' where user_id = auth.uid() and route = :route` — a **transition state, not `expired`** — **keep `current_period_end`** so the parser keeps serving them until the period lapses. Migration fallback: if `current_period_end` is null (a pre-existing `active` row from before period-tracking), set it to `now() + interval '1 month'` first, so the parser doesn't expire them immediately.
4. Call `flight-status-notification` directly with `{ event_type: "cancel", email, route }`.

> A `cancelled`-in-grace user can still update their target price — that goes through `flight-subscribe`'s in-place JSON path (Step 3.3), no re-payment, status stays `cancelled`.

Deploy: `supabase functions deploy flight-cancel-subscription --use-api`. Wire a 「取消訂閱」button on the dashboard card to call it (a two-click confirm inside the page beats `window.confirm`), then test:
```bash
curl -s -X POST "https://<ref>.supabase.co/functions/v1/flight-cancel-subscription" \
  -H "Authorization: Bearer <the signed-in user's access token>" \
  -H "content-type: application/json" -d '{"plan_name":"tokyo"}'
```
**Verify:** the row flips to **`cancelled`** with `current_period_end` preserved; `flight-parser` **still matches it** (grace) until that date passes, then lazily flips it to `expired` (Step 5). In the ECPay 廠商後台 → 信用卡定期定額訂單查詢, the order shows terminated (no more renewals).

## Step 8 — `flight-status-notification` + status-aware UI

```bash
supabase functions new flight-status-notification
```

Structurally identical to M1's `flight-notification` (verify a service-role bearer, render an email, POST to Resend) — the only difference is it branches on `event_type` instead of running fare-dedup logic (the *callers* guarantee once-only, see Steps 4–5): `welcome` (from `flight-ecpay-return`), `cancel` (from `flight-cancel-subscription`), `renewed` (from `flight-ecpay-period`, with `amount` and `charge_no`), `payment_failed` (from `flight-ecpay-period`), `expired` with `reason` `"period_ended"` | `"payment_lapsed"` (from `flight-parser` and `flight-ecpay-period`). Make each event an **explicit** branch — no "anything else is cancel" fallthrough — and validate `event_type` against the list. The `expired` email includes a 重新訂閱 link only if `SITE_URL` is set. It's called directly, never scheduled. Send with a `User-Agent` header (see the checklist's `1010` note).

Update the subscribed-state UI (M1's `select` from `flight.subscriptions`) to read `subscription_status` and show:

| `subscription_status` | Card shows |
|---|---|
| `active` | 已訂閱（有效） |
| `pending_payment` | 未完成付款 + a **「完成付款」** button (re-calls `flight-subscribe`) |
| `cancelled` | 已取消 · **有效至 `current_period_end`**（仍會通知到該日） |
| `expired` | 已結束 + a 重新訂閱 button |

**Migration: keep, don't delete.** Every pre-existing M1 row became `pending_payment` the moment Step 2's migration ran (the `not null default` did it automatically) — surface those with the 完成付款 reminder so users self-migrate by paying.

> **Subscription lifecycle (one line to remember):** `pending_payment → active ⇄ (target updates) → cancelled (grace, still alerted) → expired`. Re-subscribe + pay goes `expired/pending_payment → active`.

---

## Things to watch out for

1. **CheckMacValue, not a signature header** — every ECPay callback carries a `CheckMacValue`; verify it on **every** call. The #1 bug: dropping empty-string fields before hashing. ECPay sends and signs `CustomField3=&CustomField4=`; keep them.
2. **Two callbacks, not one webhook** — first charge → `flight-ecpay-return`; 2nd-onward → `flight-ecpay-period`. Both must verify CMV and flip status, or renewals silently never update.
3. **Reply `1|OK` plain text** — anything else (JSON, HTML, quotes, even `OK`) makes ECPay resend the callback 4× over ~20–60 min.
4. **`CustomField1/2` are the join key** — `email`/`route`, echoed back by ECPay, tell the callbacks which row to update.
5. **Callbacks = source of truth** — only `flight-ecpay-return`/`flight-ecpay-period` write `active`. `flight-subscribe` only ever writes `pending_payment`; `flight-ecpay-result` is UX-only and must never activate.
6. **No true "indefinite" subscription** — `ExecTimes` is a count (max 999, our default). `PeriodAmount` must equal `TotalAmount`.
7. **Guard `SimulatePaid`** — the stage 後台's 「模擬付款」 button sends `SimulatePaid=1`. Verify the CMV and reply `1|OK`, but **do not write `active`** for a bare simulate, or anyone hitting simulate gets the product free.
8. **The gate lives in the parser, and it's grace-aware** — payment alone doesn't stop emails; `flight-parser` (Step 5) enforces it, serving `active` **and** `cancelled`-in-grace, and lazily expiring grace-lapsed rows. Skip Step 5 and everyone still gets emailed (M1 behavior).
9. **Cancel grants a grace period — sets `cancelled`, NOT `expired`** — track and refresh `current_period_end` on every charge; cancel keeps it; the parser expires it later. There's no Stripe Customer Portal — the self-service 退訂 is your `flight-cancel-subscription` function.
10. **`OrderResultURL` is a browser POST, and your product site is (presumably) a static SPA route** — point it at `flight-ecpay-result`'s 302 redirect, never at your own site's route directly. (Edge Functions themselves handle any HTTP method fine — it's your *front-end*, not Supabase, that would 405 here.)
11. **Idempotency on `MerchantTradeNo`, not `Gwsr`** — `Gwsr` is empty on the real recurring first-period callback.
12. **Front-end must branch on `Content-Type`** — `flight-subscribe` returns `text/html` (→ `document.write` to ECPay) or `application/json` (→ in-place update). `res.json()` on the HTML silently breaks the button.
13. **No SDK needed** — CMV is a plain SHA-256 (Deno's built-in `crypto.subtle.digest`, or a small hashing helper) over a `ecpayUrlEncode`'d parameter string; the cancel POST is a plain `fetch`. No extra package required.
14. **TWD is a whole-number currency** — `ECPAY_AMOUNT=300` means exactly NT$300/month, no ×100-cents trap. ECPay silently hides credit-card payment below the card minimum (~NT$6–11) — don't drop it that low or test with NT$1.
15. **Resend sandbox only reaches your own account email** — test M2's welcome/cancel emails **to yourself** until a domain is verified.
16. **Stage vs prod** — M2 runs entirely on the **stage** merchant + cashier URL (`payment-stage.ecpay.com.tw`). Applying for a real MerchantID + switching to `payment.ecpay.com.tw` is a later milestone ([[ecpay-go-live]]).
17. **RLS write lockdown is what makes this a real paywall (new vs. the AWS version)** — Step 2 dropping the M1 insert/update policies is the Supabase equivalent of "the browser has no AWS credentials." Skip it, and a signed-in user can self-activate from the browser console for free. Revoke the `insert, update` grants too, not just the policies. Re-verify this any time you touch `flight.subscriptions`'s policies later.
18. **`verify_jwt = false` on the three ECPay-facing functions** (`flight-ecpay-return`, `-period`, `-result`) — ECPay sends no JWT. Default `true` = the gateway 401s every callback and nothing ever activates. Smoke-test with a forged body: you want `0|CheckMacValue error`, not `401`.
19. **Function URLs are the function slug** — `ReturnURL`/`PeriodReturnURL`/`OrderResultURL` and the front-end's calls must use the full `flight-…` names.
20. **ECPay terminates after 6 failed charges *silently*** — no final callback. Without the parser's "active but `current_period_end` long past → expired" rule (Step 5) such a row stays `active` and keeps getting alerts for free.
21. **Make lifecycle emails once-only at the source** — `total_success_times` (atomic `where … is null or < N`) for `renewed`; `payment_failed_at` (atomic `where … is null`) for failures; `update … returning` on the row that actually flips for `expired`. ECPay retries and the parser runs every 30 minutes, so anything weaker emails repeatedly.
22. **`pg_net` gives up after 5 s** — triggering `flight-parser` from SQL with `net.http_post(...)` logs `Timeout of 5000 ms reached` because the parser takes a few seconds. Pass `timeout_milliseconds := 60000` and read `net._http_response` for the real `{"routes":N,"matches":N}`. `matches` is the cleanest paywall assertion: dedup can hide a wrongly-included subscriber, the count can't.

## Expected duration

60–90 minutes — a bit faster than the AWS version (no IAM/API Gateway wiring), but the CheckMacValue + two-callback split are just as fiddly the first time.

## Next step

When the milestone is verified: 「M2 完成！只有付費者收得到通知，取消就停。你的產品會賺錢了。跟我說『啟動 M3』，我們把它掛到你自己的網域、正式開張。」Then load the M3 skill (check whether it still assumes the AWS version and needs the same treatment).

## Reference

- ECPay 信用卡定期定額: https://developers.ecpay.com.tw/?p=2868
- 定期定額付款結果通知 (ReturnURL 第一期 / PeriodReturnURL 第二期起): https://developers.ecpay.com.tw/?p=5631
- 信用卡定期定額訂單作業 (CreditCardPeriodAction，取消): https://developers.ecpay.com.tw/?p=2900
- CheckMacValue 機制: https://developers.ecpay.com.tw/?p=2902
- [[ecpay-best-practice]] — the callback hard rules (CMV, empty-string fields, `1|OK`, two callbacks, SimulatePaid); written against the AWS Lambda model, so read it for the ECPay-specific rules and translate the deploy mechanics per this skill.
- [[resend-best-practice]] — Resend sandbox limits, unchanged from M1.
- [[ecpay-go-live]] — applying for a real MerchantID + switching to prod.
