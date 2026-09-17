---
name: m1-code-flight-price-checker
description: Flight Price Notifier Milestone 1 — build the whole free notifier end-to-end in one shot, running entirely in Claude Code against Supabase (no AWS). Part 1 a signed-in user subscribes to a route (Tokyo/Seoul) + TWD target → flight.subscriptions; Part 2 a pg_cron-scheduled Edge Function fetches the cheapest fare (TWD primary, USD supplementary) and calls the notification Edge Function directly for matches; Part 3 that notification Edge Function dedups against flight.notification_history and emails the subscriber via Resend. NO payment guard in M1 — a subscription row means "eligible for alerts" (subscription_status + the paywall arrive in M2). Use when the student says "啟動 M1", "start M1", "做機票降價通知器", "build the flight price checker", or the older "啟動 M1.1/M1.2/M1.3".
---

# M1 — Flight Price Checker（Supabase 版，一次做出整個免費降價通知器）

Build the complete **free** notifier in one pass: **subscribe → fetch on a schedule → email on target**. It's structured in three parts (the old M1.1 / M1.2 / M1.3), but you do them back-to-back in a single session — this time entirely inside **Supabase**, driven from **Claude Code** with a normal shell (no AWS, no Cowork-only constraints).

## What this skill builds

| Part | Goal | Key pieces |
|---|---|---|
| **1.1 Subscribe** | A signed-in user picks a plan (Tokyo/Seoul) + TWD target → a row in `flight.subscriptions`; the UI shows the subscribed state. | `flight` schema + tables, RLS policies, front-end talks to Supabase directly (no custom API) |
| **1.2 Fetch on schedule** | Every 30 min, fetch each route's cheapest fare (TWD + USD) and hand off whoever's target is met. | `flight.routes` table, `flight-parser` Edge Function, `pg_cron` + `pg_net` |
| **1.3 Email on target** | Turn a match into a real, de-duplicated email. | `flight-notification` Edge Function, `flight.notification_history` dedup, Resend |

**End state:** pick a plan + budget on the live site → a row appears in `flight.subscriptions` (and the card shows you're subscribed) → the schedule fetches fares → when a watched route hits the target, a real **email** lands (NT$ headline + optional 約 US$, 「立即訂購」 button), with **no duplicate spam** and **no payment required**.

> **NO payment guard in M1.** A subscription row's mere existence = eligible for alerts. There is **no `subscription_status`** field anywhere in M1 — it, the payment-confirmation flow, and the `active`-only parser filter are all **introduced in M2** (the paywall). Don't add a status here.
>
> **Architecture invariants:** **Everything lives in Supabase** — Postgres auth (`auth.users`) + a dedicated `flight` schema for app data + Edge Functions for the two pieces of server-side logic. The join key is **`user_id` (`auth.uid()`)**, not email — email is only *denormalized* onto `flight.subscriptions` so the notification function never needs a cross-schema join into `auth.users` to find a recipient address. The browser talks to Postgres directly via the Supabase client + RLS for read/write of its own rows; it never sees a service-role key. Only Edge Functions (which run with the service role) touch `flight.notification_history`, call Travelpayouts, or call Resend.

## When to load this skill

- "啟動 M1" / "start M1" / "做機票降價通知器" / "build the flight price checker" (or the older "啟動 M1.1/M1.2/M1.3").

**Before Part 1.1, confirm:** a Supabase project exists with auth already wired up (the M0 login), the Supabase CLI is installed and linked (`supabase link`), and you have a Travelpayouts token and a Resend API key ready to store as function secrets. If not, set those up first.

## Execution mode: Claude Code

This runs as a normal Claude Code session with full shell access — no Cowork-only tool constraints, no 4096-char inline-CFN limit, no base64/S3 seeding tricks. Use the `supabase` CLI directly: `supabase migration new …` + `supabase db push` for schema changes, `supabase functions new …` + `supabase functions deploy …` for Edge Functions, `supabase secrets set …` for API keys. Edge Functions are TypeScript/Deno.

## Architecture

```
                     Product Site (front-end)
                              │  Supabase client (anon key + user JWT)
                              │  insert/select flight.subscriptions, select flight.routes
                              ▼
 ┌───────────────────────────────────────────── Supabase project ─────────────────────────────────────────────┐
 │                                                                                                              │
 │   pg_cron (every 30 min) ──net.http_post──▶ flight-parser (Edge Function)                                   │
 │                                                   │  1. select * from flight.routes                         │
 │                                                   │  2. fetch cheapest fare per route (Travelpayouts)        │
 │                                                   │  3. select subscriptions for that route                 │
 │                                                   │  4. filter target_price >= cheapest (TWD)                │
 │                                                   │  5. batch matches, POST to flight-notification           │
 │                                                   ▼                                                          │
 │                                    flight-notification (Edge Function)                                       │
 │                                                   │  1. per match: query flight.notification_history          │
 │                                                   │     (latest row for user_id+route) — dedup / re-alert     │
 │                                                   │  2. render email (NT$ headline + optional 約US$)          │
 │                                                   │  3. POST to Resend                                        │
 │                                                   │  4. on 2xx: insert flight.notification_history row        │
 │                                                   ▼                                                          │
 │                                              Email [Resend]                                                  │
 │                                                                                                              │
 │   flight.routes (admin-managed, small reference table)                                                       │
 │   flight.subscriptions (user data, RLS: user can only see/write their own rows)                              │
 │   flight.notification_history (dedup ledger, no client access — Edge Functions only via service role)        │
 └──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Both Edge Functions check that the caller sent `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` before doing anything — that's what stops `pg_cron`→`flight-parser` and `flight-parser`→`flight-notification` from being callable by a random person who finds the URL.

---

# Part 1.1 — Subscribe to a plan

### Step 1 — Create the `flight` schema and tables

```sql
create schema if not exists flight;

-- admin-managed reference table (replaces the old S3 flight-routes.json)
create table flight.routes (
  plan_name text primary key,       -- 'tokyo' | 'seoul'
  display_name text not null,       -- '台北 ✈ 東京'
  origin text not null,             -- 'TPE'
  destination text not null,        -- 'TYO' | 'SEL'
  route text generated always as (origin || '-' || destination) stored
);

insert into flight.routes (plan_name, display_name, origin, destination) values
  ('tokyo', '台北 ✈ 東京', 'TPE', 'TYO'),
  ('seoul', '台北 ✈ 首爾', 'TPE', 'SEL');

create table flight.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,              -- denormalized: lets flight-notification send without joining auth.users
  plan_name text not null references flight.routes(plan_name),
  route text not null,
  target_price numeric not null,    -- TWD
  currency text not null default 'TWD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, route)
);
-- NO subscription_status column in M1 — that's M2's paywall gate.

create table flight.notification_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  route text not null,
  price numeric not null,
  currency text not null,
  sent_at timestamptz not null default now()
);
create index on flight.notification_history (user_id, route, sent_at desc);
```

Put this in a migration file (`supabase migration new flight_m1_schema`) and run `supabase db push`.

### Step 2 — Row Level Security

```sql
alter table flight.subscriptions enable row level security;
alter table flight.notification_history enable row level security;
alter table flight.routes enable row level security;

-- routes: everyone signed in can read the two plans, nobody from the client can write
create policy "routes are readable" on flight.routes for select to authenticated using (true);

-- subscriptions: users can only see/write their own row
create policy "select own subscriptions" on flight.subscriptions for select to authenticated using (auth.uid() = user_id);
create policy "insert own subscriptions" on flight.subscriptions for insert to authenticated with check (auth.uid() = user_id);
create policy "update own subscriptions" on flight.subscriptions for update to authenticated using (auth.uid() = user_id);

-- notification_history: no policies for authenticated/anon at all → only the service role
-- (used inside Edge Functions) can read or write it.
```

### Step 3 — Expose the `flight` schema to the client (or use `public` instead)

Supabase's Data API only serves the `public` schema by default. To let the front-end call `supabase.schema('flight').from('subscriptions')` directly, go to **Project Settings → API → Data API → Exposed schemas** and add `flight`.

> If you'd rather skip that dashboard step, put the tables straight in `public` (`public.subscriptions`, `public.routes`, `public.notification_history`) instead of a `flight` schema — functionally identical, just less naming isolation. Either is fine for M1; this doc assumes `flight` was exposed.

**Verify:** `select * from flight.routes;` in the SQL editor returns the two plans; from the browser console, a signed-in `supabase.schema('flight').from('routes').select('*')` also returns them (confirms the exposed-schema setting took).

### Step 4 — The subscribe UI (talks to Supabase directly — no custom backend)

Add two plan cards (台北✈東京 / 台北✈首爾) to the M0 site, each with a **TWD target-price input** + a 「開始追蹤」 button. On click, insert straight into `flight.subscriptions` with the Supabase client:

```ts
const { data: { user } } = await supabase.auth.getUser();
await supabase.schema('flight').from('subscriptions').upsert({
  user_id: user.id,
  email: user.email,
  plan_name: 'tokyo',
  route: 'TPE-TYO',
  target_price: 10000,
  currency: 'TWD',
}, { onConflict: 'user_id,route' });
```

RLS's `with check (auth.uid() = user_id)` is what stops a user from writing someone else's row — there's no server-side validation Lambda to write. (Hint the current cheapest so they pick a sane budget — Tokyo ~NT$9,325, Seoul ~NT$5,989.)

**Verify:** picking 台北✈東京 + NT$10,000 on the live site creates a `TPE-TYO` row you can see with `select * from flight.subscriptions;`.

### Step 5 — Show the subscribed state (close the write-only loop)

On mount, `supabase.schema('flight').from('subscriptions').select('*').eq('user_id', user.id)` and mark subscribed plans with a **已訂閱** badge + current target + an **更新目標價** button (an `upsert` again, same as Step 4). No separate "list subscriptions" endpoint needed — RLS already scopes the `select` to the signed-in user, so there's nothing to build server-side here.

**Verify:** reload the live site → subscribed cards show the badge + target + Update button.

---

# Part 1.2 — Fetch prices on a schedule

> **Dates:** M1 has no user dates — the parser picks **next month** (`YYYY-MM`). **Currency:** **TWD is the gate** (vs `target_price`); a **USD** call is best-effort for the email's supplementary line. **No payment guard:** the match includes every subscriber whose target is met (no `subscription_status` filter — that's M2).

### Step 6 — Store secrets and scaffold the Edge Functions

```bash
supabase secrets set TRAVELPAYOUTS_TOKEN=<token>
supabase secrets set RESEND_API_KEY=<key>
supabase functions new flight-parser
supabase functions new flight-notification
```

`SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_URL` are already available to every Edge Function's environment automatically — you don't set those yourself.

### Step 7 — Write `flight-parser`

Per invocation (there's only one call per scheduled tick — it loops routes internally, unlike the old per-route Lambda fan-out):

1. Verify `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` — reject anything else with 401.
2. Create a Supabase client with the **service role** key (needed to bypass RLS and read every subscriber, and to read `flight.notification_history` isn't needed here — that's `flight-notification`'s job).
3. `select * from flight.routes`.
4. For each route, fetch cheapest **TWD** (the gate), then best-effort **USD**, from Travelpayouts:

```ts
const UA = "Mozilla/5.0 (compatible; flight-notifier/1.0)"; // some hosts behind Cloudflare 403 the default UA
async function fetchCheapest(origin: string, destination: string, month: string, token: string, currency: string) {
  const q = new URLSearchParams({ origin, destination, depart_date: month, currency, token });
  const res = await fetch(`https://api.travelpayouts.com/v1/prices/cheap?${q}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  const body = await res.json();
  if (!body.success || !body.data?.[destination]) return null;
  const offers = Object.values(body.data[destination]) as any[];
  if (!offers.length) return null;
  const best = offers.reduce((a, b) => (a.price < b.price ? a : b));
  // NOTE: the real keys are departure_at / return_at — NOT depart_date / return_date.
  return { price: best.price, currency: currency.toUpperCase(), airline: best.airline,
           depart_date: best.departure_at, return_date: best.return_at };
}
```

TWD empty/`429` → log + skip the route (never crash the whole run over one route); **USD empty/`429` → just omit it**, never block on USD.

5. `select * from flight.subscriptions where route = :route` (service role bypasses RLS, so this sees every subscriber, not just the caller's).
6. For each subscriber where `target_price >= cheapest.price` (TWD): add to a match list `{ user_id, email, route, plan_name, target_price, cheapest, cheapest_usd? }`.
7. **Fan out to `flight-notification` in batches of ~20–50** (not one giant payload, not one call per user):

```ts
const BATCH = 25;
for (let i = 0; i < matches.length; i += BATCH) {
  const batch = matches.slice(i, i + BATCH);
  // fire-and-forget: don't await the full response body, just kick it off and move on,
  // so a slow batch of emails never makes flight-parser itself time out.
  fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/flight-notification`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ matches: batch }),
  }).catch((e) => console.error("notify batch failed", e));
}
```

Because there's no queue in this design, a batch that fails outright (network error, `flight-notification` down) just gets **retried naturally on the next scheduled run 30 minutes later** — nothing is lost, since a match only stops recurring once `flight.notification_history` has a fresh row for it.

### Step 8 — Deploy and wire the schedule

```bash
supabase functions deploy flight-parser
supabase functions deploy flight-notification
```

Then schedule it. Store the service-role key in **Supabase Vault** rather than a plain Postgres setting, and reference it from the cron job:

```sql
select vault.create_secret('<SUPABASE_SERVICE_ROLE_KEY>', 'flight_service_role_key');

select cron.schedule(
  'flight-price-check',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/flight-parser',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'flight_service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

(`pg_cron` and `pg_net` need to be enabled once via **Database → Extensions** if they aren't already.)

**Change frequency live:** `select cron.alter_job(job_id, schedule := '*/15 * * * *');` (look up `job_id` from `cron.job`).

**Verify:** `supabase functions deploy` succeeds; a manual invoke —

```bash
curl -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/flight-parser" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

— returns 200, and `supabase functions logs flight-parser` shows something like `TPE-TYO … 9325 TWD`. Then confirm the cron job ran: `select * from cron.job_run_details order by start_time desc limit 5;`.

---

# Part 1.3 — Email on target

### Step 9 — Write `flight-notification`

Per request (a batch of matches from `flight-parser`):

1. Verify `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` — same check as `flight-parser`.
2. Create a service-role Supabase client (needed for `flight.notification_history`, which has no client-facing RLS policies at all).
3. For each match in the batch (sequentially, or with modest concurrency — Resend rate-limits at ~5 req/s so don't blast all 25 at once):
   - Query the latest row: `select price, sent_at from flight.notification_history where user_id = :user_id and route = :route order by sent_at desc limit 1`.
   - **Decide to send:** no row, or last `sent_at` older than `NOTIFY_FLOOR_HOURS` (24) → send; else within the floor, send only if `new <= last * (1 - REALERT_PCT/100)` (20%) **or** `(last - new) >= REALERT_ABS_TWD` (NT$2,000); else skip and log "skipped (deduped)".
   - **Render the email** from `cheapest` (TWD, always) + optional `cheapest_usd`:
     - subject: `` `✈️ ${planLabel} 降價通知！NT$${price} 已達標` `` (leads with NT$).
     - HTML: NT$ headline + optional 約 US$ line (only when `cheapest_usd` is present) + a 「立即訂購」 button linking the Aviasales deep link. Keep it simple/table-free — a marketing-style HTML template reads as spam to filters.
     - Always send both `html` and a plain-text fallback.
   - **POST to Resend** (`https://api.resend.com/emails`, with a custom `User-Agent` — Cloudflare sometimes blocks the default one).
   - On a real **2xx**: `insert into flight.notification_history (user_id, route, price, currency, sent_at) values (...)`.
   - **Failure classes:** `429`/`5xx` → transient, just log and move to the next match in the batch (the unsent one will naturally retry on the next parser run since no history row was written); `403`/`422` → permanent (e.g. the free Resend sender can only mail your own verified address until you set up a custom domain) → log and drop, don't retry.
   - Write the history row **only after a confirmed 2xx** — this ordering is what keeps dedup correct even if the function crashes mid-batch.

### Step 10 — Prove dedup + the re-alert threshold

1. Manually invoke `flight-parser` again right away → the same match should **not** re-email (within `NOTIFY_FLOOR_HOURS`); `supabase functions logs flight-notification` should show "skipped (deduped)".
2. Lower a test subscriber's `target_price` or wait for a genuinely cheaper fare that's ≥20% or ≥NT$2,000 below the last alerted price → a fresh email **does** go out.

**Verify:**
```sql
select * from flight.notification_history where route = 'TPE-TYO' order by sent_at desc limit 3;
```
A recent `sent_at` + `price`; the immediate re-run skipped; the big-drop wrote a new row. Check your inbox for the actual email (subject 「✈️ 台北 → 東京 降價通知！NT$9,325 已達標」, NT$ headline + optional 約 US$, 「立即訂購」 button).

### Optional: monetize the booking link (affiliate marker)

**Skippable — the notifier works without it.** Travelpayouts gives you a **marker** (affiliate ID, e.g. `736582`); a booking link with `?marker=<id>` credits bookings to you (30-day cookie). To enable: `supabase secrets set TRAVELPAYOUTS_MARKER=<marker>`, read it in `flight-notification`, and append `?marker=` to the booking URL only when it's set. Skip it and the milestone is still complete.

---

## Things to watch out for (whole milestone)

1. **No payment guard in M1** — no `subscription_status` anywhere; everyone who subscribes is eligible. The paywall (status + payment confirmation + active-only parser filter) is **M2**.
2. **Exposed schemas** — `flight` (or whatever custom schema you use) must be added under Project Settings → API → Data API → Exposed schemas, or the front-end's `supabase.schema('flight')` calls 404. Using `public` instead sidesteps this entirely.
3. **`flight.subscriptions.email` is intentionally denormalized** — don't "normalize it away" later without checking that `flight-notification` doesn't need it; it exists specifically so the notification function never has to touch `auth.users` (a separate schema with its own access rules) just to find a recipient address.
4. **`flight.notification_history` has RLS enabled with zero client-facing policies** — that's deliberate lockdown, not a bug to "fix" by adding a select policy. Only Edge Functions (via the service role, which bypasses RLS) should ever touch it.
5. **Two Edge Functions, not one** — keep `flight-parser` (scrape + match) and `flight-notification` (dedup + send) separate. This lets you tune fetch frequency and email throughput independently, and means a slow Resend call can never make the fare-fetching cron job itself time out.
6. **Both Edge Functions must check the service-role bearer token** — otherwise anyone who finds the function URL can trigger a scrape or spam emails.
7. **Batch the parser→notification handoff (~20–50 per call), fire-and-forget** — don't await the full batch's completion inside `flight-parser`, and don't send one HTTP call per matched subscriber.
8. **No queue means the parser's next run is the retry mechanism** — a failed batch just gets picked up again in ~30 minutes because `notification_history` has no fresh row for it. That's fine for M1's volume; revisit if scale ever demands a real queue.
9. **Parse the API's real keys** — `departure_at`/`return_at`, not `depart_date`/`return_date`, or you get silently-empty fares.
10. **TWD primary, USD supplementary** — gate/dedup/headline on `cheapest` (TWD); render 約US$ only when `cheapest_usd` is present.
11. **`numeric`, not float** — `target_price`/`price` columns are `numeric`; don't let a client library coerce them through JS `number` and back without care around precision.
12. **Resend: drop permanent (403/422), just log-and-skip transient (429/5xx); custom User-Agent (Cloudflare blocks the default); the free/demo sender can usually only mail your own verified address** until a custom domain is set up.
13. **`notification_history` dedup happens BEFORE send, and the row is written only after a 2xx** — this ordering is what keeps things correct if a batch partially fails.

## Expected duration

2–4 hours for the full milestone (schema + RLS + 2 Edge Functions + pg_cron + Resend + the subscribe/subscribed-state UI) — shorter than the AWS version since there's no IAM, no API Gateway, and no inline-CFN/zip-bridge deploy dance.

## Next step

When the milestone is green: 「M1 完成！你有一個能動的*免費*降價通知器了 — 訂閱、定時抓價、達標寄信（含去重），而且還沒有付款門檻。跟我說『啟動 M2』，我們來接金流，加上『只有付費者才收得到通知』的門檻。」Then load `m2-ecpay-subscription` (adjust it too if it still assumes DynamoDB/Lambda).

## Reference

- Supabase CLI: https://supabase.com/docs/guides/cli · Edge Functions: https://supabase.com/docs/guides/functions
- `pg_cron`: https://supabase.com/docs/guides/database/extensions/pg_cron · `pg_net`: https://supabase.com/docs/guides/database/extensions/pg_net
- Supabase Vault (for storing the service-role key used by cron): https://supabase.com/docs/guides/database/vault
- Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Travelpayouts `/v1/prices/cheap`: https://travelpayouts.github.io/slate/ — `data[<DEST>][<idx>]` with `price`/`airline`/`departure_at`/`return_at`.
- Resend: https://resend.com/docs/api-reference/emails/send-email
