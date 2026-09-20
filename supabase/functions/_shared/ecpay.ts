// Shared ECPay (綠界) helpers for the M2 Edge Functions: CheckMacValue,
// the auto-submit checkout form, and the small pieces every callback needs.
//
// Secrets (set via `supabase secrets set`):
//   ECPAY_MERCHANT_ID, ECPAY_HASH_KEY, ECPAY_HASH_IV
//   ECPAY_ENV     - "stage" (default) | "prod"
//   ECPAY_AMOUNT  - monthly price in whole TWD

export const ECPAY_MERCHANT_ID = Deno.env.get("ECPAY_MERCHANT_ID") as string;
const ECPAY_HASH_KEY = Deno.env.get("ECPAY_HASH_KEY") as string;
const ECPAY_HASH_IV = Deno.env.get("ECPAY_HASH_IV") as string;
export const ECPAY_AMOUNT = Number(Deno.env.get("ECPAY_AMOUNT"));

const HOST = Deno.env.get("ECPAY_ENV") === "prod"
  ? "https://payment.ecpay.com.tw"
  : "https://payment-stage.ecpay.com.tw";
export const CHECKOUT_URL = `${HOST}/Cashier/AioCheckOut/V5`;
export const PERIOD_ACTION_URL = `${HOST}/Cashier/CreditCardPeriodAction`;

// Where ECPay's browser redirect (OrderResultURL) finally lands the user.
// Defaults to the dev server; set SITE_URL once there's a deployed front-end.
export const SITE_URL = (Deno.env.get("SITE_URL") ?? "http://localhost:8080").replace(/\/$/, "");

const PROJECT_URL = Deno.env.get("SUPABASE_URL") as string;
export const fnUrl = (slug: string) => `${PROJECT_URL}/functions/v1/${slug}`;

// .NET-style URL encode, as ECPay specifies: encode, lowercase the hex, then
// put back the 7 characters ECPay leaves literal ( - _ . ! * ( ) ), and
// encode the two that encodeURIComponent leaves alone (~ and ').
function ecpayUrlEncode(s: string): string {
  return encodeURIComponent(s)
    .replace(/~/g, "%7e")
    .replace(/'/g, "%27")
    .replace(/%20/g, "+")
    .replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase());
}

async function sha256Upper(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

// Sort keys case-insensitively, wrap in HashKey/HashIV, encode, SHA-256.
// Empty-string values MUST stay in the hash (ECPay signs `CustomField3=`).
export async function checkMacValue(params: Record<string, string>): Promise<string> {
  const keys = Object.keys(params).filter((k) => k !== "CheckMacValue").sort((a, b) => {
    const x = a.toLowerCase(), y = b.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  });
  const raw = `HashKey=${ECPAY_HASH_KEY}&${keys.map((k) => `${k}=${params[k]}`).join("&")}&HashIV=${ECPAY_HASH_IV}`;
  return sha256Upper(ecpayUrlEncode(raw).toLowerCase());
}

export async function verifyCheckMacValue(params: Record<string, string>): Promise<boolean> {
  const given = (params.CheckMacValue ?? "").toUpperCase();
  const expected = await checkMacValue(params);
  if (!given || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function parseCallback(req: Request): Promise<Record<string, string>> {
  const form = new URLSearchParams(await req.text());
  const out: Record<string, string> = {};
  for (const [k, v] of form) out[k] = v;
  return out;
}

// ECPay wants Taiwan time, "yyyy/MM/dd HH:mm:ss".
export function tradeDate(d = new Date()): string {
  const tw = new Date(d.getTime() + 8 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${tw.getUTCFullYear()}/${p(tw.getUTCMonth() + 1)}/${p(tw.getUTCDate())} ` +
    `${p(tw.getUTCHours())}:${p(tw.getUTCMinutes())}:${p(tw.getUTCSeconds())}`;
}

// MerchantTradeNo: <= 20 chars, alphanumeric, unique per checkout attempt.
export function newTradeNo(): string {
  const rand = crypto.getRandomValues(new Uint8Array(4));
  const r = [...rand].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 6);
  return `FP${Date.now().toString(36)}${r}`.toUpperCase().slice(0, 20);
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// 信用卡定期定額 AIO checkout, returned as an auto-submitting HTML form.
export async function buildCheckoutForm(opts: {
  tradeNo: string;
  email: string;
  route: string;
  itemName: string;
}): Promise<string> {
  const params: Record<string, string> = {
    MerchantID: ECPAY_MERCHANT_ID,
    MerchantTradeNo: opts.tradeNo,
    MerchantTradeDate: tradeDate(),
    PaymentType: "aio",
    ChoosePayment: "Credit",
    EncryptType: "1",
    TotalAmount: String(ECPAY_AMOUNT),
    TradeDesc: "flight price alert subscription",
    ItemName: opts.itemName,
    // First charge -> ReturnURL, every later charge -> PeriodReturnURL.
    ReturnURL: fnUrl("flight-ecpay-return"),
    PeriodReturnURL: fnUrl("flight-ecpay-period"),
    // Browser POST-back; a redirect function, never a static front-end route.
    OrderResultURL: fnUrl("flight-ecpay-result"),
    PeriodAmount: String(ECPAY_AMOUNT), // must equal TotalAmount
    PeriodType: "M",
    Frequency: "1",
    ExecTimes: "999", // ECPay has no "forever"; 999 is the max
    CustomField1: opts.email,
    CustomField2: opts.route,
  };
  params.CheckMacValue = await checkMacValue(params);

  const inputs = Object.entries(params)
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${escapeHtml(v)}">`)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>前往付款…</title></head>` +
    `<body><p>正在前往綠界付款頁面…</p>` +
    `<form id="ecpay" action="${CHECKOUT_URL}" method="post">${inputs}</form>` +
    `<script>document.getElementById("ecpay").submit()</script></body></html>`;
}

export const ok = () =>
  new Response("1|OK", { status: 200, headers: { "Content-Type": "text/plain" } });
export const fail = (reason: string) =>
  new Response(`0|${reason}`, { status: 200, headers: { "Content-Type": "text/plain" } });

// Fire-and-forget hand-off to flight-status-notification (same pattern as
// flight-parser -> flight-notification).
export function sendStatusEmail(payload: {
  event_type: "welcome" | "cancel" | "expired" | "payment_failed" | "renewed";
  email: string;
  route: string;
  current_period_end?: string | null;
  // "expired" only: why the service ended.
  reason?: "period_ended" | "payment_lapsed";
  // "renewed" only: what was charged, and which charge it was (1 = first).
  amount?: number;
  charge_no?: number;
}) {
  const p = fetch(fnUrl("flight-status-notification"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  }).catch((e) => console.error("status notification dispatch failed", e));
  // Let the runtime finish the request after we've already replied to ECPay.
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil?.(p);
}
