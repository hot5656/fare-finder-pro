---
name: m1-code-flight-price-checker-checklist
description: Flight Price Notifier Milestone 1 verification (Supabase version) — the whole free notifier in one pass, checked against Supabase instead of AWS. Part 1.1 the flight.subscriptions table + RLS + the subscribe form (no Lambda, no API Gateway) + subscribed-state; Part 1.2 flight.routes + the flight-parser Edge Function fetch dual-currency fares and hand matches directly to flight-notification (no SQS); Part 1.3 flight-notification dedups against flight.notification_history and sends a Resend email. M1 has NO payment guard (no subscription_status — that's M2). Use when the student says "驗收 M1", "check M1", or after `m1-code-flight-price-checker` is built.
---

# M1 — Flight Price Checker Checklist（Supabase 版，one shot）

Verify the whole free notifier end-to-end, then emit a single **READY for M2** verdict. Run after `m1-code-flight-price-checker` is built. You (Claude Code) run each check and report.

## Execution mode

Claude Code with a normal shell, the `supabase` CLI linked to the project, and SQL access (Supabase SQL editor or `psql`/`supabase db`). No AWS, no Cowork-only quirks. Ask the student for: the **Supabase project ref**, the **live product site URL**, and a real inbox to test with — specifically their **Resend-account verified email**, since the free/demo Resend sender usually only delivers to that address until a custom domain is verified.

## Architecture

```
 Product Site ──insert (RLS, auth.uid()=user_id)──▶ flight.subscriptions          (Part 1.1: A,B,C,D,E)
 pg_cron ──▶ flight-parser ──(Travelpayouts)──▶ match ──direct HTTP call──▶ flight-notification   (Part 1.2: F,G,H,I)
 flight-notification ──dedup: flight.notification_history──▶ Email [Resend]        (Part 1.3: J,K,L)
```

There is **no SQS, no Lambda, no API Gateway, no IAM** in this version — everything server-side is one of two Supabase Edge Functions, and the "queue" is just `flight-parser` calling `flight-notification` over HTTP directly. Keep that in mind when a check below feels like it's missing a step compared to the old AWS checklist — it's missing on purpose, not an oversight.

## Flow being verified

Part 1.1 = Sections A–E · Part 1.2 = Sections F–I · Part 1.3 = Sections J–L

---

## Part 1.1 — Subscribe

### Section A — `flight` schema & tables
- **A1** All three tables exist: `select table_name from information_schema.tables where table_schema = 'flight';` → `routes`, `subscriptions`, `notification_history`.
- **A2** RLS is enabled on all three: `select relname, relrowsecurity from pg_class where relnamespace = 'flight'::regnamespace;` → all `true`.
- **A3** Routes seeded: `select * from flight.routes;` → `tokyo`→`TPE-TYO`, `seoul`→`TPE-SEL`, both with sane `display_name`.
- **A4** **No `subscription_status` column** (M2-only): `select column_name from information_schema.columns where table_schema='flight' and table_name='subscriptions';` → confirm it's absent.

### Section B — Secrets, exposed schema, Edge Functions deployed
- **B1** Secrets present: `supabase secrets list` → `TRAVELPAYOUTS_TOKEN`, `RESEND_API_KEY`. (`SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_URL` are auto-injected — don't expect them in this list.)
- **B2** Both functions deployed and active: `supabase functions list` → `flight-parser`, `flight-notification`, both `ACTIVE`.
- **B3** `flight` schema is reachable from the client (or the team deliberately used `public` instead — check the front-end code to see which): in the live site's browser console, a signed-in `supabase.schema('flight').from('routes').select('*')` returns rows, not a 404/`PGRST` schema error. If it errors, check Project Settings → API → Data API → Exposed schemas for `flight`.

### Section C — Subscribe write path (RLS, no Lambda)
- **C1** A signed-in test user can write their own row (front-end console or a short script using that user's session):
  ```ts
  await supabase.schema('flight').from('subscriptions').upsert(
    { user_id, email: 'checklist@test.com', plan_name: 'tokyo', route: 'TPE-TYO', target_price: 10000, currency: 'TWD' },
    { onConflict: 'user_id,route' }
  );
  ```
  → no error.
- **C2** (authoritative) The row landed correctly: `select * from flight.subscriptions where email = 'checklist@test.com';` → `route=TPE-TYO`, `currency=TWD`, `target_price=10000`, **no `subscription_status`**.
- **C3** RLS actually blocks cross-user writes: from the same client, attempt to upsert a row with a **different** `user_id` than the signed-in session → rejected with an RLS policy violation. If this succeeds, `with check (auth.uid() = user_id)` is missing or wrong.

### Section D — Live front-end path (end-to-end)
- **D1** The exposed-schema setting really works from the browser, not just the SQL editor: on the live site, signed in, dev console → `supabase.schema('flight').from('routes').select('*')` returns data with no console errors.
- **D2** **Decisive:** the student submits the **real form** on the live site → a new row appears in `flight.subscriptions` with the correct `user_id`/`email`, no `subscription_status`.

### Section E — Subscribed state (closed loop)
- **E1** On the live site, after subscribing + reloading, the card shows a **已訂閱 / Subscribed** badge + the saved target + an **更新目標價 / Update** button (not write-only).
- **E2** Read-side RLS proof: with more than one subscriber in the table, confirm the signed-in user's query only ever returns **their own** rows, never another user's.

---

## Part 1.2 — Fetch on schedule

### Section F — Routes + functions in place (replaces the old S3/SQS/zip section)
- **F1** `flight.routes` has both plans (cross-check with A3).
- **F2** There is intentionally **no queue** — confirm by reading `flight-parser`'s source that matched subscribers are POSTed directly to `flight-notification`'s URL, in batches, rather than written anywhere durable. (You'll confirm this actually happens at runtime in Section H.)

### Section G — `flight-parser` runs
- **G1** Manual invoke with a valid service-role bearer succeeds:
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/flight-parser" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
  ```
  → `200`.
- **G2** **New security check that didn't exist in the AWS version:** the same call **without** a valid bearer is rejected:
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/flight-parser"
  ```
  → `401`. If this returns `200`, anyone who finds the function URL can trigger scraping for free — treat as a failure.
- **G3** Realistic fares in the logs: `supabase functions logs flight-parser --project-ref <ref>` → a sane TWD fare (Tokyo ~NT$8–12k, Seoul ~NT$5–8k). Empty fares despite a live route = check `departure_at`/`return_at` keys (not `depart_date`/`return_date`), the `TRAVELPAYOUTS_TOKEN` secret, and that `flight.routes` was actually read.

### Section H — Match + direct handoff (no payment guard)
- **H1** Seed a subscriber whose `target_price` is ABOVE the live fare (`update flight.subscriptions set target_price = 999999 where email = '...';`), re-run G1's curl, then check `supabase functions logs flight-notification --project-ref <ref>` shows it received that subscriber in a batch.
- **H2** The payload `flight-notification` receives has **`cheapest` (TWD) always present**, and `cheapest_usd` **only when** the USD fetch succeeded — confirm from the logs (or a temporary debug log of the incoming body).
- **H3** **USD best-effort:** if the USD call fails, `flight-parser` still hands the match off **TWD-only** — it never skips the subscriber or crashes the whole run over a missing USD price.
- **H4** **No payment guard:** the matched subscriber has no `subscription_status` field at all (schema-level, per A4) and was still matched — there is no such filter to check per-row.
- **H5** A subscriber whose `target_price` is BELOW the live fare is **not** included in the match (comparison direction correct) — confirm they don't appear in `flight-notification`'s logs and no history row is created for them.

### Section I — Schedule wired
- **I1** `pg_cron`/`pg_net` extensions enabled: `select extname from pg_extension where extname in ('pg_cron','pg_net');` → both present.
- **I2** The job exists and is active: `select jobname, schedule, active from cron.job where jobname = 'flight-price-check';` → `active=true`, `schedule='*/30 * * * *'` (or whatever cadence was chosen).
- **I3** It actually fires and succeeds: `select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname='flight-price-check') order by start_time desc limit 5;` → recent runs with `status = succeeded`.

---

## Part 1.3 — Email on target

### Section J — Resend + `flight-notification` wired
- **J1** Resend secret present: `supabase secrets list` → `RESEND_API_KEY`.
- **J2** Same security check as G2, on the other function:
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/flight-notification" -d '{"matches":[]}'
  ```
  → `401` without a valid bearer.
- **J3** Dedup thresholds are set correctly (in the function's code or its secrets, whichever the implementation used): `NOTIFY_FLOOR_HOURS=24`, `REALERT_PCT=20`, `REALERT_ABS_TWD=2000`.

### Section K — Email fires (no payment guard)
- **K1** Seed a subscriber whose `email` is the tester's own **Resend-account verified** address, `target_price` ABOVE the live fare; run `flight-parser` (G1's curl) to kick off the whole chain.
- **K2** **Decisive:** the inbox receives the alert — subject 「✈️ 台北 → 東京 降價通知！NT$9,325 已達標」 (or the matching route), an **NT$ headline** (+ a small **約 US$** line only when `cheapest_usd` was present), the target price, and the 「立即訂購」 button.
- **K3** No payment guard, reaffirmed at the email stage: the emailed subscriber has no `subscription_status` field.

### Section L — Dedup + re-alert
- **L1** Re-run `flight-parser` immediately → **no** second email; `flight-notification`'s logs say "skipped (deduped)".
- **L2** A history row was written: `select * from flight.notification_history where route = 'TPE-TYO' order by sent_at desc limit 3;` → a recent `sent_at` + `price`.
- **L3** Lower the target (or wait for a genuinely cheaper fare) so the new price is ≥20% or ≥NT$2,000 below the last alerted price → a fresh email **does** go out, and a new history row appears.

---

## Reporting

| Check | Status | Notes |
|---|---|---|
| A1/A2/A3/A4 schema+tables+RLS+no status col | ✅/❌ | flight.routes/subscriptions/notification_history |
| B1/B2/B3 secrets + functions deployed + exposed schema | ✅/❌ | |
| C1/C2 subscribe writes correctly (no status) | ✅/❌ | authoritative |
| C3 RLS blocks cross-user write | ✅/❌ | security check |
| D2 form → row (live) | ✅/❌ | the key 1.1 one |
| E1/E2 subscribed-state + RLS read scoping | ✅/❌ | closed loop |
| F1/F2 routes seeded + no queue confirmed by design | ✅/❌ | |
| G1/G3 parser runs, realistic fares | ✅/❌ | supabase functions logs |
| G2 parser rejects missing bearer | ✅/❌ | security check |
| H1/H2 match → notification received, dual-currency | ✅/❌ | cheapest=TWD always, usd optional |
| H3/H4/H5 USD best-effort / no guard / below-target | ✅/❌ | |
| I1/I2/I3 pg_cron+pg_net enabled, job active, fires | ✅/❌ | |
| J1/J2/J3 Resend secret, auth check, dedup env | ✅/❌ | |
| K2 email received (NT$ headline) | ✅/❌ | the key 1.3 one |
| K3 no payment guard | ✅/❌ | M1 design |
| L1 dedup blocks repeat | ✅/❌ | |
| L3 re-alert on big drop | ✅/❌ | |

**Verdict:**
- All ✅ → 「M1 驗收通過 ✅ 你有一個能動的*免費*降價通知器了。READY for M2。跟我說『啟動 M2』來加上付款門檻。」
- Any ❌ → name the failures + recovery:
  - **1.1:** exposed-schema 404 → check Project Settings → API → Data API → Exposed schemas, or confirm the code actually uses `public` instead; no row → check the upsert code + the insert RLS policy's `with check`; cross-user write not blocked → RLS policy missing/wrong; subscribed-state missing → check the `select` query is scoped by `user_id`.
  - **1.2:** `401` where you expected `200` → wrong/missing `SUPABASE_SERVICE_ROLE_KEY` in the `Authorization` header; `200` where you expected `401` → the function isn't actually checking the bearer token, fix before shipping; empty fares → `departure_at`/`return_at` keys, `TRAVELPAYOUTS_TOKEN`, or `flight.routes` not read; nothing reaches `flight-notification` → check the fetch call in `flight-parser`, the `SUPABASE_URL` env var, and that the match filter (`target_price >= cheapest.price`) is correct; cron not firing → `pg_cron`/`pg_net` not enabled, or the Vault secret referenced in the cron job is wrong/expired.
  - **1.3:** no email → recipient must be the **Resend-account verified** address (until a custom domain is set up) + check `RESEND_API_KEY` + a custom `User-Agent` header (Cloudflare sometimes blocks the default one); duplicate sent → dedup window logic or the history row being written before the 2xx instead of after; permanent-failure loop (403/422) → should drop and log, not retry.
  Then re-run `驗收 M1`. (See `[[resend-best-practice]]` for the Resend-specific failure modes — the AWS-specific `[[aws-best-practice]]` reference no longer applies to this version.)
