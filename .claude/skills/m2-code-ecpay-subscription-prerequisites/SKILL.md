---
name: m2-code-ecpay-subscription-prerequisites
description: Prerequisites before M2 (Supabase version) of the Flight Price Notifier course — an ECPay (綠界) merchant (the public stage test merchant is fine for the whole course), the ECPay Supabase secrets, and confirmation that the M1 notifier works. Use when the student starts M2, or when `m2-code-ecpay-subscription` / `-checklist` detects ECPay isn't set up.
---

# M2 Prerequisites — ECPay 綠界（Supabase 版）

## What this skill does

M2 adds one account: **ECPay 綠界**. Unlike Stripe there's **no CLI to install and no live/test "mode" toggle** — you just need merchant credentials (MerchantID / HashKey / HashIV) stored as Supabase secrets. For the whole course you can use ECPay's **public stage test merchant**; applying for a real one is a later milestone ([[ecpay-go-live]]). This skill stores the secrets + confirms the M1 notifier carryover.

## Architecture

```
Product Site ──POST (user JWT)──▶ flight-subscribe ──form──▶ ECPay cashier
ECPay ──ReturnURL/PeriodReturnURL──▶ flight-ecpay-return / flight-ecpay-period ──update──▶ flight.subscriptions
flight-parser (M1) ──grace-aware select──▶ only paying users get fare emails via flight-notification
```

## When to load this skill

- "M2 環境準備" / any time M2 detects the ECPay secrets are missing.

## Execution mode

Claude Code with a normal shell, the `supabase` CLI, and `curl`. No AWS. ECPay itself has **no CLI** — it's a hosted gateway with a dashboard only, driven from the **廠商後台** (`vendor-stage.ecpay.com.tw`).

## Step 1 — ECPay credentials (stage test merchant is fine)

You don't need a real merchant account to build and test M2. Use ECPay's **public shared stage test merchant** (published by ECPay, safe to commit as defaults):

| Field | Stage value |
|---|---|
| `MerchantID` | `3002607` |
| `HashKey` | `pwFHCqoQZGmho4w6` |
| `HashIV` | `EkRm7iFT261dpevs` |

**Stage 廠商後台 (shared, public — for 模擬付款 + 訂單查詢):** the shared test merchant comes with a **public test backoffice** you log into — a *separate* host from production. The login form needs **four** fields (the 統一編號 one trips everyone up):

| 欄位 | Stage value (use this in M2) | Production (go-live) |
|---|---|---|
| 後台網址 | **`https://vendor-stage.ecpay.com.tw/`** | `https://vendor.ecpay.com.tw/` |
| 廠商編號 (MerchantID) | `3002607` — goes in your **checkout form/secrets**, **NOT** the login field | your own |
| 賣家帳號 (login) | `stagetest3` | your own |
| 登入密碼 | `test1234` | your own |
| 統一編號 | `00000000` (eight zeros — **required** on the login page) | your real 統編 |
| 驗證碼 | whatever the page shows (refresh ↻ for a clearer one) | — |

> **`3002607` is the MerchantID, NOT the login.** Typing `3002607` into 賣家帳號 gives `帳號格式錯誤` — the login is `stagetest3` + `test1234` + 統編 `00000000`. (These are ECPay's **published shared** test creds, from `developers.ecpay.com.tw/?p=2856` — verify there if ECPay rotates them.)

This shared backoffice is what lets you press **模擬付款** and open **信用卡定期定額訂單查詢** on the `3002607` orders **without** a real merchant account. It's **shared/public** (you'll see other testers' orders too — filter by your `MerchantTradeNo`) — fine for testing, but it is **not** your private console; a real MerchantID + your own backoffice is **not** required until go-live ([[ecpay-go-live]]).

> **Why this matters:** an order you pay via `3002607` does **not** appear in any *private* console (you don't have one yet) — it lives in this **shared `vendor-stage` backoffice**. Your real M2 acceptance evidence is **the callback hitting your Edge Function (`supabase functions logs`) + the `flight.subscriptions` row flipping** — the backoffice is only for the optional 模擬付款 / 查單 convenience.

> **Don't bother applying for your own "專屬測試帳號".** ECPay's private test merchant takes a 1–3 工作天 review — it is NOT instant/self-service. The shared `3002607` + `stagetest3` backoffice tests **everything** in M2. So **M2 uses the shared account only**; you apply for a real merchant at go-live ([[ecpay-go-live]]), skipping the private-test-account step entirely.

**Stage test card** (for the whole course): card `4311-9522-2222-2222`, expiry `12/30`, CVV `222`, OTP `1234`. No real money moves.

## Step 2 — Store the ECPay credentials as Supabase secrets

```bash
supabase secrets set ECPAY_MERCHANT_ID=3002607
supabase secrets set ECPAY_HASH_KEY=pwFHCqoQZGmho4w6
supabase secrets set ECPAY_HASH_IV=EkRm7iFT261dpevs
supabase secrets set ECPAY_ENV=stage
supabase secrets set ECPAY_AMOUNT=300
```

`ECPAY_AMOUNT` is our **implemented monthly price: `300` (NT$300)**. Students can later set it to any integer TWD value they want — everything downstream reads it from this secret, so the price is a one-line change with no code edits. Keep it realistic — ECPay hides credit-card payment below the card minimum (~NT$6–11), so don't use NT$1.

**Verify:**
```bash
supabase secrets list --output json | python3 -c "import sys,json; d=json.load(sys.stdin); d=d['secrets'] if isinstance(d,dict) else d; print('\n'.join(sorted(s['name'] for s in d)))"
```
Shows all five keys above — presence is what you're confirming. **Don't just run bare `supabase secrets list` and paste it:** it prints a `value` field per secret (SHA-256 digests rather than plaintext, but still not something to leave in a transcript), so print the names only.

**Optional sixth secret — `SITE_URL`** (e.g. `https://your-domain.com`): where the browser lands after paying and the base of the 重新訂閱 link in the "subscription ended" email. Not needed yet — it defaults to `http://localhost:8080` and the email just omits the link when unset. Set it once there's a deployed front-end.

## Step 3 — Confirm the M1 carryover

```bash
# the M1 notifier pipeline exists and sends email
supabase functions list   # expect flight-parser and flight-notification, both ACTIVE
supabase secrets list     # expect RESEND_API_KEY and TRAVELPAYOUTS_TOKEN already present from M1
```
```sql
-- flight.subscriptions exists with the M1 shape (M2's migration will ALTER it, not create it)
select column_name from information_schema.columns where table_schema='flight' and table_name='subscriptions';
```
If any are missing, finish `m1-code-flight-price-checker-checklist` first. (`flight-parser` and `flight-notification` should keep `verify_jwt = true` — M2 doesn't change that, and the new user-facing functions keep it too; only the three ECPay-facing ones turn it off.)

> **Note for anyone comparing against the AWS version of this course:** the AWS version checks for a `flight-save-subscription` Lambda here, because M1.1 already had a subscribe *function* that M2 upgrades. Our M1 has the front-end write `flight.subscriptions` **directly** (via RLS), with no subscribe function at all — so there's nothing to "upgrade" here. Instead, M2 Step 3 of the build skill **creates** a brand-new `flight-subscribe` Edge Function from scratch, specifically to take that write access back from the client now that the row will carry real payment state. Don't go looking for a pre-existing subscribe function to check in this prerequisites skill — it doesn't exist yet at this point in the course.

## Heads-up — things that look like failures (or will bite you) but aren't your mistake

- **Resend sandbox only delivers to YOUR OWN address.** Until a sending domain is verified, welcome/cancel/fare emails reach **only the Resend account's own verified email**; any other recipient 403s `validation_error`. So test M2's emails **to yourself** — it's not broken, it's the sandbox. Real delivery to anyone needs a **verified sending domain** (see [[resend-best-practice]]).
- **`OrderResultURL` needs a dedicated redirect function, or you get an error right after paying.** ECPay returns the browser via a **POST**; a static SPA (Vercel/Netlify) only serves GET on a page route → an error page (the payment still succeeded via the S2S `ReturnURL`). The M2 build skill's Step 4 builds a tiny `flight-ecpay-result` 302-redirect Edge Function for `OrderResultURL` — know this symptom up front.

- **ECPay's servers can't send a Supabase JWT.** The three functions ECPay/the browser calls (`flight-ecpay-return`, `flight-ecpay-period`, `flight-ecpay-result`) must be deployed with `verify_jwt = false`, or the gateway 401s every callback and nothing ever activates. The M2 build skill sets this up; the symptom to recognise is "payment succeeded but the row never leaves `pending_payment` and no callback appears in the logs". The CheckMacValue is what authenticates those calls.
- **Deploys, migrations and manual parser runs may need you to run them.** Claude Code's auto mode can block production deploys / DDL / runs that change shared state; if that happens, run the printed `supabase db query …` / `supabase functions deploy …` lines yourself (`! <command>`), then have Claude verify.

## Verify (all must pass)

- All five `ECPAY_*` secrets present ✅
- `flight-parser` + `flight-notification` functions exist and are ACTIVE, `RESEND_API_KEY`/`TRAVELPAYOUTS_TOKEN` secrets present (M1 done) ✅
- `flight.subscriptions` exists with its M1 columns (M2 will `alter table` it, not create it) ✅

## Next step

Return to `m2-code-ecpay-subscription` Step 1 (its Step 1 is the same `supabase secrets set` block — if you already ran Step 2 above, it's done).

## Reference

- [[ecpay-best-practice]] — the CMV + callback rules you'll apply throughout M2 (written against the AWS Lambda model; the rules themselves are unchanged, only the deploy target is different).
- ECPay stage test info / 測試帳號: https://developers.ecpay.com.tw/?p=2856
