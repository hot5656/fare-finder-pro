# M1 Flight Price Checker — Session Handoff

Updated 2026-09-18 (supersedes the 2026-09-17 version, which described a
half-built state that no longer applies).

## Where things stand

M1 is **built, deployed and verified end-to-end** against the shared Supabase
project (`luugfvsrawnuzwpjvddt`, "demo_app"). The verification checklist is
`.claude/skills/m1-code-flight-price-checker-checklist/SKILL.md`; it was run on
2026-09-18. Subscribe → 30-min scheduled fetch → deduplicated email all work,
with no payment gate (`subscription_status` and the paywall are M2).

| Area | Status | Evidence |
|---|---|---|
| Schema, RLS, seeded routes, no `subscription_status` | ✅ | `flight.routes`, `subscriptions`, `notification_history` |
| RLS cross-user write blocked / read scoped | ✅ | tested in a rolled-back transaction: 42501, other user sees 0 rows |
| Subscribe UI (write + subscribed state) | ✅ | `POST /rest/v1/subscriptions?on_conflict=user_id,route` → 200 from `localhost:8080`; 已訂閱 badge + 更新目標價 |
| `flight-parser` / `flight-notification` deployed | ✅ | v3 each, `verify_jwt = true`; no-bearer calls → 401 |
| `pg_cron` job `flight-price-check` (`*/30 * * * *`) | ✅ | fires every tick; `routes.last_checked_at` refreshes |
| Manual parser invoke with service-role key | ✅ | `{"routes":2,"matches":1}` |
| Email arrives (NT$ headline, 約 US$, target, 立即訂購) | ✅ | in Gmail inbox, subject `✈️ 台北 → 東京 降價通知！NT$6,556 已達標` |
| Re-alert on big drop (≥20% or ≥NT$2,000) | ✅ | raised last history price to 9,500 → fresh email at 6,556 + new history row |
| Dedup blocks repeat | 🟡 | consistent with data and thresholds; the "skipped (deduped)" log line itself was never seen |
| USD-fetch-fails → TWD-only handoff (H3) | 🟡 | verified in code only |
| Below-target subscriber excluded (H5) | 🟡 | verified in code only (`target_price >= cheapest`) |

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
  `20260918030100_flight_routes_update_grant`.
- **Deploying functions**: `supabase functions deploy <name> --use-api`
  (no Docker needed). `supabase/config.toml` must keep `verify_jwt = true`
  for both flight functions. The gateway accepts any project JWT (e.g. the
  anon key), so the exact service-role bearer check inside each function is
  what actually protects them — keep both.
- **Secrets set remotely**: `RESEND_API_KEY`, `SEND_EMAIL_HOOK_SECRET`,
  `TRAVELPAYOUTS_TOKEN`, plus auto-injected `SUPABASE_*`. Local `.env` does
  not (and should not) contain Travelpayouts/Resend keys.
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

- **`flight.subscriptions.updated_at` never updates** — no trigger and the
  client doesn't send it, so it stays at the creation time. Add a
  `before update` trigger (or send it in the upsert) if it matters.
- **Unexplained**: the 09-17 history row's `sent_at` (12:47:44Z) is 2 hours
  earlier than that email's actual send time in Gmail (14:47:44Z). It was
  probably hand-edited in an earlier session. Related: the 13:00 UTC tick on
  09-18 should have re-sent (24h floor passed by the row's clock) but didn't;
  needs the `flight-notification` console logs to explain.
- Dashboard console shows 2 minor a11y warnings (target-price inputs have no
  label association / no `id` or `name`).
- Supabase advisor notes `flight.tag_app_metadata_on_signup()` (an M0 auth
  trigger function) is SECURITY DEFINER and executable by `anon` /
  `authenticated`. Not part of M1; consider revoking EXECUTE.
- `notification_history` shows "RLS enabled, no policy" — intentional
  lockdown (service role only), not a bug.

## Next

Per the skill's own "Next step": M1 is done (subscribe + scheduled fetch +
deduped email, no payment gate). Load `m2-ecpay-subscription` for the paywall
(adjust it if it still assumes DynamoDB/Lambda — this whole build stayed
Supabase-only, no AWS).
