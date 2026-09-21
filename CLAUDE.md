# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Flight Price Notifier (機票降價通知): users subscribe to a Taipei route (Tokyo / Seoul / London) with a target price in TWD, pay NT$300/month through ECPay (綠界) 定期定額, and get an email when the cheapest fare drops to or below the target. Two halves in one repo:

- **Front-end** (`src/`): TanStack Start (React 19, file-based routing, SSR) + Tailwind v4 + shadcn/Radix UI in `src/components/ui/`. Built with Lovable and synced with it.
- **Back-end** (`supabase/`): Postgres schema `flight` + Deno Edge Functions on a **shared, multi-app Supabase project** (`luugfvsrawnuzwpjvddt`). There is no application server of our own.

`docs/m1-session-handoff.md` is the living state-of-the-world doc (what is deployed, verified, test data left behind, lessons learned, backlog). Read it before touching payments, cron or the Edge Functions. The M1/M2 build and verification recipes are in `.claude/skills/`.

## Commands

```sh
npm run dev        # Vite dev server on http://localhost:8080 (the port is fixed; use it for all manual testing)
npm run build      # production build
npm run lint       # eslint (prettier is enforced through eslint)
npm run format     # prettier --write .
npx tsc --noEmit -p .   # typecheck the front-end (strict; there is no `typecheck` script)
```

There is no test runner. Verification is manual against the real Supabase project (see the checklist skills). `README.md` uses npm; both `package-lock.json` and `bun.lock` exist, and `bunfig.toml` enforces a 24h minimum release age on new packages.

Edge Functions cannot be typechecked locally (no Deno). The deploy is the compile check.

```sh
supabase functions deploy <name> --use-api                  # no Docker needed
supabase functions deploy flight-ecpay-return --use-api --no-verify-jwt   # same for -period and -result, and send-email
supabase db query --linked --file supabase/migrations/<file>.sql
supabase migration repair --status applied <version>        # ALWAYS follow a db query with this
```

**Never run `supabase db push`.** Other apps' migrations live in the same remote history table but not in this repo, and `db push` would mark them reverted. Apply a schema change with the two commands above, then read `supabase_migrations.schema_migrations` to confirm the repair line actually ran.

Production DDL, function deploys and manual parser runs are blocked in auto mode; hand the user a copy-paste block to run with `!`. Function `version` numbers are not a reliable "was it redeployed" signal; compare `ezbr_sha256`/`updated_at` from `supabase functions list --output json`.

## Front-end architecture

- **Routing.** `src/routes/` is file-based; `routeTree.gen.ts` is generated, never edit it. `__root.tsx` is the only layout. `_authenticated/route.tsx` is the guard for everything under it (`ssr: false`, `beforeLoad` checks `getUser()` then `hasAppAccess()`, else redirects to `/auth`). The dashboard is `_authenticated/dashboard.tsx`; there is no `/app` route.
- **`src/integrations/supabase/`** is mostly Lovable-generated ("do not edit"): `client.ts` (browser client, schema pinned to `flight`), `client.server.ts` (service-role `supabaseAdmin`; import only from server code, never from route files), `auth-attacher.ts` + `auth-middleware.ts` (bearer token from the browser to server functions; the attacher must stay registered in `src/start.ts`), `types.ts`. `app-scope.ts` is hand-written and holds `APP_NAME` and `hasAppAccess`.
- **`src/server.ts` / `src/start.ts`** wrap SSR: error-page fallback (h3 swallows throws into a JSON 500), CSRF middleware for server functions (re-added explicitly because defining `start.ts` opts out of the default).
- **Env vars come in two pairs** that must point at the same project: `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` (browser) and `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` (server); `SUPABASE_SERVICE_ROLE_KEY` is server-only and must never get a `VITE_` prefix. Local `.env` and Vercel need the identical set; restart the dev server after changing `.env`.
- **`vite.config.ts`** is a thin wrapper over `@lovable.dev/vite-tanstack-config`, which already adds TanStack Start, React, Tailwind, tsconfig paths, Nitro and the `@` alias. Do not add those plugins again (duplicates break the app).
- The dashboard **reads** `flight.routes` and `flight.subscriptions` directly with the user's session (RLS `select own`), but **writes only by calling Edge Functions** (`flight-subscribe`, `flight-cancel-subscription`) with `fetch` and the user's JWT. `flight-subscribe` answers either `text/html` (an auto-submitting ECPay checkout form: `document.write` it) or `application/json` (in-place target-price update); branch on `Content-Type`.
- Tailwind v4 gives `<button>` no pointer cursor; `styles.css` has a global rule for enabled buttons.

## Back-end architecture

The data flow spans several files, so read them together:

1. **Subscribe/pay.** Dashboard → `flight-subscribe` (derives `route` from `flight.routes` and `email`/`user_id` from the JWT, never from the body) → writes `pending_payment` + a fresh `merchant_trade_no` → returns the ECPay checkout form built by `_shared/ecpay.ts`.
2. **ECPay callbacks** (no JWT; the CheckMacValue is the only authentication, so `verify_jwt = false` in `supabase/config.toml` and `--no-verify-jwt` on deploy): `flight-ecpay-return` (first charge → `active`, sets `current_period_end` and `total_success_times = 1`, sends welcome email), `flight-ecpay-period` (renewals and failed charges; a guarded atomic update makes the "renewed" email once-per-charge and `payment_failed_at` makes the failure email once-only), `flight-ecpay-result` (302s the user's browser to `${SITE_URL}/dashboard?purchase=…`). Callbacks reply plain-text `1|OK` (or `0|reason` with HTTP 200), and a `SimulatePaid=1` callback must never activate a row. Only these verified callbacks write `active`.
3. **Cancel.** `flight-cancel-subscription` calls ECPay `CreditCardPeriodAction`, then sets `cancelled` while keeping service until `current_period_end`. ECPay codes `90100150` (not found) and `90100149` (already deactivated) are treated as "nothing to stop, cancel locally"; any other rejection is a 502 that leaves the row alone.
4. **Price check.** `pg_cron` job `flight-price-check` (every 30 min) POSTs to `flight-parser` with the service-role key stored in Vault as `flight_service_role_key`. The parser first lazily expires rows (`cancelled` past its period end; `active` more than `RENEWAL_GRACE_DAYS`=7 past it) and emails them, then fetches the cheapest TWD (and supplementary USD) fare per route from Travelpayouts, updates `routes.last_price`, and hands matches for **paying** subscribers only (`active`, or `cancelled` still inside the paid period) to `flight-notification` in batches of 25.
5. **Alert email.** `flight-notification` dedups against `flight.notification_history` (same price within 24h is skipped; a drop of ≥20% or ≥NT$2,000 re-alerts) and sends via Resend. `flight-status-notification` sends lifecycle emails (`welcome | cancel | expired | payment_failed | renewed`). Both send from `noreply@roberthut.com`. `send-email` is the Supabase Auth "Send Email" hook (auth mails through Resend), unrelated to fare alerts.

Subscription lifecycle: `pending_payment → active → cancelled (grace, still alerted) → expired`, with re-subscribe from `expired` creating a new trade number.

Conventions that matter:
- The service-role functions (`flight-parser`, `flight-notification`, `flight-status-notification`) have `verify_jwt = true`, but the gateway accepts any project JWT (e.g. the anon key), so each also checks `Authorization === Bearer ${SERVICE_ROLE_KEY}` inside. Keep both.
- Client write access to `flight.subscriptions` was revoked in M2 (`authenticated` has SELECT only). New writes must go through an Edge Function using the service role.
- Follow-up emails use `EdgeRuntime.waitUntil` (see `sendStatusEmail` in `_shared/ecpay.ts`) so the request isn't cut off after replying to ECPay. Empty-string fields must stay in the CheckMacValue.
- Function URLs are the slug (`/functions/v1/flight-ecpay-return`), and the URLs handed to ECPay must use the full slugs.
- ECPay runs on the shared **stage** merchant (`ECPAY_ENV=stage`; public test HashKey/HashIV). Going live also needs real merchant credentials, `ECPAY_ENV=prod` and a real `SITE_URL`. Edge secrets (`RESEND_API_KEY`, `SEND_EMAIL_HOOK_SECRET`, `TRAVELPAYOUTS_TOKEN`, `ECPAY_*`, optional `SITE_URL`) are set with `supabase secrets set`; do not paste `supabase secrets list` output (use `--output json` and print names only).
- Reading logs: the CLI has no `functions logs`; use the Supabase MCP `query_logs` (`function_edge_logs` for status codes, `function_logs` for `console.log`). Logs lag about a minute.
- To run `flight-parser` from SQL with `net.http_post`, pass `timeout_milliseconds := 60000`, otherwise the default 5s timeout hides the response. `matches` in its reply is the cleanest paywall test.

## Shared Supabase project and auth isolation

`auth.users` is shared with unrelated apps (`project-management`, `udemy-coupon`). The trigger `flight.tag_app_metadata_on_signup()` copies `raw_user_meta_data.app` into `raw_app_meta_data.apps`; this app's tag is `APP_NAME = "fare-finder-pro"` and the sign-in page accepts only accounts already tagged and never auto-adds the tag on a correct password. Tagging happens on the sign-up path in `src/routes/auth/index.tsx`: for an email already registered by another app, a matching password tags the account immediately, otherwise a password-reset email is sent and the tag is added after `/auth/reset`. The docs describe this as reset-only, so check with the user before changing either. The tag is **client-declared, not a permission**: it is a UI route guard only, never key RLS or data access on it (RLS uses `auth.uid() = user_id`). Any new trigger on `auth.users` must skip its side effects when `new.raw_app_meta_data->'apps'` does not include its own app. Full convention: `docs/shared-supabase-auth.md`; open decision B-1 in the handoff doc covers real access control.

Verification touches production data, so prefer rollback-only tests (a `DO` block that raises at the end) and restore anything you back-date or raise (e.g. `notification_history.price` for the dedup workaround).

## Repo notes

- **Lovable sync** (`AGENTS.md`): never rewrite published git history (no force-push, rebase, amend or squash of pushed commits), and keep the pushed branch in a working state.
- Test against `http://localhost:8080`; the Vercel site `fare-finder-pro.vercel.app` is not the final code, so don't test against or deploy to it unless asked. `/deploy_vercel` is the project's deploy command and confirms preview vs production first.
- Supabase Auth Redirect URLs allow the Vercel domain, Vercel preview wildcard and `http://localhost:8080/**`; sign-up passes `emailRedirectTo: window.location.origin`.
- Root-level `no_*_run_*.txt` files are exported session transcripts, not code.
