# M1 Flight Price Checker — Session Handoff

Written 2026-09-17. Continue this on another host by reading this file, then
either re-run `/m1-code-flight-price-checker` or just pick up the TODOs below
directly — the skill file is at
`.claude/skills/m1-code-flight-price-checker/SKILL.md` (already committed).

## Where things stand

Part 1.1 (schema + RLS + subscribe UI) is functionally complete and
type-checks. Part 1.2/1.3 (Edge Functions) are written and deployed but
**not yet verified end-to-end**, and `pg_cron` is **not wired up yet**.
Nothing from this session is committed to git yet except the skill file
itself (commit `131278d`).

## Project / environment facts (don't re-derive these)

- This is a **shared multi-app Supabase project** (`luugfvsrawnuzwpjvddt`,
  "demo_app", org `jpeobbygqqrulizmotaf`). Other apps' migrations live in the
  same remote history table but aren't in this repo's `supabase/migrations/`.
  **Never run `supabase db push`** here — it wants to mark all those
  other-app remote migrations as "reverted" first, which is destructive to
  shared state. See "How the schema migration was actually applied" below.
- Supabase CLI is linked (`supabase/config.toml` → `luugfvsrawnuzwpjvddt`).
  The CLI must be logged into an account with access to this project (the
  account tied to org `hot5656` did **not** have access; a re-login fixed
  it earlier this session — if you hit 403s on `supabase secrets list` /
  `supabase migration list`, that's the symptom, and `supabase login` with
  the right account is the fix).
- Auth (M0) is already wired and real: `flight` schema, cross-app auth
  tagging trigger (`supabase/migrations/20260904120000_flight_app_scoped_auth.sql`),
  `flight` schema already exposed in Data API (`config.toml`
  `[api] schemas = [...]`).
- Secrets already set remotely (`supabase secrets list`): `RESEND_API_KEY`,
  `SEND_EMAIL_HOOK_SECRET`, `TRAVELPAYOUTS_TOKEN` (this session renamed it
  from the old `TRAVEL_PLAYOUTS_API_TOKEN`), plus the auto-injected
  `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / etc. **Nothing more to set
  up here** — Travelpayouts + Resend are both ready.
- Local `.env` / `.env.example` intentionally do **not** contain the
  Travelpayouts or Resend keys — Edge Functions only ever read Supabase
  secrets at runtime, never local `.env`.

## What's done this session

1. **Schema migration** — `supabase/migrations/20260917071738_flight_m1_schema.sql`
   (untracked, needs `git add`). Creates `flight.routes` (seeded with
   tokyo/seoul), `flight.subscriptions`, `flight.notification_history`, all
   RLS policies. **No `subscription_status` column** — that's M2.

   **How it was actually applied** (since `db push` is unsafe here — see
   above): ran the SQL directly with
   `supabase db query --linked --file supabase/migrations/20260917071738_flight_m1_schema.sql`,
   then registered it in the remote history table *without* touching any
   other app's entries: `supabase migration repair --status applied 20260917071738`.
   Verified with `supabase db query --linked "select * from flight.routes;"`.
   **If you need another schema change here, repeat this pattern** — write
   the migration file, apply via `db query --file`, then `migration repair
   --status applied <version>`. Don't touch `db push` on this project.

2. **TypeScript types** — `src/integrations/supabase/types.ts` regenerated,
   but **scoped to `flight` only** (`supabase gen types typescript --linked
   --schema flight`), not `public` — the shared project's `public` schema
   belongs to unrelated apps (case management, ISO docs, etc.) and pulling
   it in would bloat this app's types with things it never queries. The
   `flight` schema's tables were hand-merged into the existing file structure
   (kept the `public: { ... never }` stub and the `DefaultSchema =
   Extract<keyof Database, "flight">` line as they already were).

3. **Subscribe UI** — `src/routes/_authenticated/dashboard.tsx` rewritten.
   Two plan cards (from `flight.routes`), TWD target-price input, upsert on
   `user_id,route` conflict, "已訂閱" badge + current target when subscribed.
   Uses React Query (already set up in `__root.tsx`). Client's default
   schema is already `flight` (see `src/integrations/supabase/client.ts`
   `db: { schema: 'flight' }`), so calls are plain `supabase.from(...)`, not
   `supabase.schema('flight').from(...)` like the skill's generic example.
   **Typechecked clean (`npx tsc --noEmit`), not yet clicked through in a
   real browser** (blocked — see TODOs).

4. **Edge Functions** — `supabase/functions/flight-parser/index.ts` and
   `supabase/functions/flight-notification/index.ts`, both hand-written
   `Deno.serve` handlers (matching the existing `supabase/functions/send-email`
   style in this repo, not the newer `withSupabase`/`@supabase/server`
   scaffold the CLI generates by default — that scaffold's auth model
   wasn't verifiable offline, so this went with the skill's original,
   well-documented design: manual `Authorization: Bearer
   <SUPABASE_SERVICE_ROLE_KEY>` check inside the function).
   - `flight-parser`: loads routes, calls Travelpayouts (TWD gate, USD
     best-effort), matches subscribers, batches (25/batch) fire-and-forget
     POSTs to `flight-notification`.
   - `flight-notification`: dedup against `flight.notification_history`
     (24h floor, 20%/NT$2000 re-alert threshold), renders NT$/約US$ email,
     sends via Resend, writes history row only on confirmed 2xx.
   - Both deployed via `supabase functions deploy <name> --use-api`
     (`--use-api` avoids needing Docker, which isn't running on this
     machine). **`--no-verify-jwt` is blocked by the Claude Code sandbox's
     auto-mode classifier** (flagged as removing platform-level auth from a
     publicly reachable endpoint) — deployed *without* it instead, relying
     on the platform's default `verify_jwt = true` gateway check + the
     function's own manual bearer check as defense in depth. Confirmed via
     `curl -X POST https://luugfvsrawnuzwpjvddt.supabase.co/functions/v1/flight-parser`
     (no auth) → `401`, i.e. the gateway check is actually active.
   - **Important side-effect to know about**: `supabase functions new` wrote
     `verify_jwt = false` into `supabase/config.toml` for both functions
     (its default scaffold assumption). This was **fixed to `verify_jwt =
     true`** in this session, because if a future deploy ever goes through
     the Docker-based path (plain `supabase functions deploy` without
     `--use-api`), that config value — not just the CLI flag — controls
     whether the gateway check is applied, and leaving it `false` would have
     silently disabled auth on next deploy. Double-check this stays `true`
     if you touch `config.toml` again.

## TODOs / where to pick up

1. **Browser-test the subscribe flow.** Dev server: `npm run dev` (on this
   machine it landed on `localhost:8080`, not the Vite default 5173 — check
   `vite dev` output or listening ports if unsure). Sign in as a real user,
   go to `/dashboard`, subscribe to a plan, confirm the row appears
   (`supabase db query --linked "select * from flight.subscriptions;"`) and
   the "已訂閱" badge shows after reload.
   - **Blocker hit this session**: the Claude-in-Chrome browser extension
     reported `localhost:8080` as blocked by site permissions. If you're
     continuing via Claude Code + the Chrome extension, grant it permission
     for `localhost:8080` (or whatever port `npm run dev` picks) first.

2. **End-to-end test the Edge Functions.** Needs the real
   `SUPABASE_SERVICE_ROLE_KEY` value for the `Authorization: Bearer ...`
   header. **Blocker hit this session**: `supabase projects api-keys
   --reveal` is treated as a credential-materialization action the sandbox
   won't let the agent run unilaterally. Either:
   - run `supabase projects api-keys --project-ref luugfvsrawnuzwpjvddt --reveal`
     yourself and grab the `service_role`/`secret` key, or
   - grant Bash permission for that command,

   then:
   ```bash
   curl -X POST "https://luugfvsrawnuzwpjvddt.supabase.co/functions/v1/flight-parser" \
     -H "Authorization: Bearer <SERVICE_ROLE_KEY>"
   ```
   should return `{"routes":2,"matches":<n>}`, and
   `supabase functions logs flight-parser` /
   `supabase functions logs flight-notification` should show the fare fetch
   and any dedup/send activity.

3. **Wire `pg_cron`** (skill Step 8) — also needs the real service-role key,
   stored in Supabase Vault so cron can attach it as a header:
   ```sql
   select vault.create_secret('<SERVICE_ROLE_KEY>', 'flight_service_role_key');

   select cron.schedule(
     'flight-price-check',
     '*/30 * * * *',
     $$
     select net.http_post(
       url := 'https://luugfvsrawnuzwpjvddt.supabase.co/functions/v1/flight-parser',
       headers := jsonb_build_object(
         'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'flight_service_role_key'),
         'Content-Type', 'application/json'
       ),
       body := '{}'::jsonb
     );
     $$
   );
   ```
   Run via `supabase db query --linked --file <sql file>` (same
   don't-use-`db push` reasoning as the schema migration). Confirm
   `pg_cron`/`pg_net` extensions are enabled first (Database → Extensions,
   or check `select * from pg_extension where extname in ('pg_cron','pg_net');`).

4. **Prove dedup** (skill Step 10) — invoke `flight-parser` twice in a row,
   confirm the second run logs "skipped (deduped)" for the same match, then
   lower a test subscription's `target_price` and confirm a fresh email goes
   out.

5. **Commit everything** once verified — nothing from this session is
   committed yet except the skill file (`131278d`). Uncommitted as of
   writing this:
   ```
   M  src/integrations/supabase/types.ts
   M  src/routeTree.gen.ts        (auto-generated by the router, harmless)
   M  src/routes/_authenticated/dashboard.tsx
   M  supabase/config.toml
   ?? supabase/functions/flight-notification/deno.json
   ?? supabase/functions/flight-notification/index.ts
   ?? supabase/functions/flight-parser/deno.json
   ?? supabase/functions/flight-parser/index.ts
   ?? supabase/migrations/20260917071738_flight_m1_schema.sql
   ```
   (`run_2029_0917.txt` in the repo root is a `/export` transcript dump from
   this session — not part of the app, fine to leave, gitignore, or delete
   per your preference.)

## Once M1 is fully green

Per the skill's own "Next step": tell the student M1 is done (subscribe +
scheduled fetch + deduped email, no payment gate yet), then load
`m2-ecpay-subscription` for the paywall (adjust it if it still assumes
DynamoDB/Lambda — this whole build stayed Supabase-only, no AWS).
