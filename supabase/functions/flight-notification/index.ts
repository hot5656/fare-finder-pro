// flight-notification: turns a batch of matches from flight-parser into
// deduplicated emails via Resend. Never called directly by users — only by
// flight-parser (and manually for testing).
//
// Env vars required (set via `supabase secrets set`):
//   RESEND_API_KEY        - Resend API key (already set in this project)
//   TRAVELPAYOUTS_MARKER  - optional affiliate marker for the booking link
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically by
// the Supabase Edge Functions runtime.
//
// Deployed with --no-verify-jwt: the platform does not gate this endpoint,
// so the Authorization check below is the only thing stopping a random
// caller from spamming emails.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@4.0.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") as string;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") as string;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") as string;
const TRAVELPAYOUTS_MARKER = Deno.env.get("TRAVELPAYOUTS_MARKER");

const SENDER = "Flight Price Notifier <noreply@roberthut.com>"; // matches supabase/functions/send-email

const NOTIFY_FLOOR_HOURS = 24;
const REALERT_PCT = 20;
const REALERT_ABS_TWD = 2000;

const resend = new Resend(RESEND_API_KEY);

type Cheapest = {
  price: number;
  currency: string;
  airline: string;
  depart_date: string;
  return_date: string;
};

type Match = {
  user_id: string;
  email: string;
  route: string; // e.g. "TPE-TYO"
  plan_name: string;
  target_price: number;
  cheapest: Cheapest;
  cheapest_usd?: Cheapest | null;
};

const PLAN_LABELS: Record<string, string> = {
  tokyo: "台北 → 東京",
  seoul: "台北 → 首爾",
};

function shouldSend(newPrice: number, last: { price: number; sent_at: string } | null): boolean {
  if (!last) return true;
  const hoursSince = (Date.now() - new Date(last.sent_at).getTime()) / 3_600_000;
  if (hoursSince >= NOTIFY_FLOOR_HOURS) return true;
  const pctDrop = newPrice <= last.price * (1 - REALERT_PCT / 100);
  const absDrop = last.price - newPrice >= REALERT_ABS_TWD;
  return pctDrop || absDrop;
}

function bookingUrl(match: Match): string {
  const [origin, destination] = match.route.split("-");
  const depart = match.cheapest.depart_date?.slice(0, 10) ?? "";
  const base = `https://www.aviasales.com/search/${origin}${depart.replace(/-/g, "")}${destination}1`;
  return TRAVELPAYOUTS_MARKER ? `${base}?marker=${TRAVELPAYOUTS_MARKER}` : base;
}

function renderEmail(match: Match): { subject: string; html: string; text: string } {
  const label = PLAN_LABELS[match.plan_name] ?? match.route;
  const price = Math.round(match.cheapest.price).toLocaleString();
  const target = Math.round(match.target_price).toLocaleString();
  const usdLine = match.cheapest_usd
    ? `<p style="color:#666;font-size:14px;">約 US$${Math.round(match.cheapest_usd.price).toLocaleString()}</p>`
    : "";
  const usdText = match.cheapest_usd ? ` (約 US$${Math.round(match.cheapest_usd.price).toLocaleString()})` : "";
  const url = bookingUrl(match);

  const subject = `✈️ ${label} 降價通知！NT$${price} 已達標`;

  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2>${subject}</h2>
      <p style="font-size:22px;font-weight:700;margin:12px 0 0;">NT$${price}</p>
      ${usdLine}
      <p style="color:#666;font-size:13px;margin-top:4px;">你的目標價：NT$${target}</p>
      <p style="margin-top:16px;">
        <a href="${url}"
           style="display:inline-block;padding:12px 20px;background:#7c3aed;color:#fff;
                  border-radius:8px;text-decoration:none;font-weight:600;">
          立即訂購
        </a>
      </p>
    </div>
  `;
  const text = `${subject}\nNT$${price}${usdText}\n你的目標價：NT$${target}\n立即訂購: ${url}`;

  return { subject, html, text };
}

Deno.serve(async (req) => {
  const auth = req.headers.get("Authorization");
  if (auth !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { matches } = (await req.json()) as { matches: Match[] };
  if (!Array.isArray(matches) || matches.length === 0) {
    return Response.json({ sent: 0, skipped: 0 });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: "flight" },
  });

  let sent = 0;
  let skipped = 0;

  for (const match of matches) {
    const { data: last, error: historyError } = await admin
      .from("notification_history")
      .select("price, sent_at")
      .eq("user_id", match.user_id)
      .eq("route", match.route)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (historyError) {
      console.error(`history lookup failed for ${match.user_id}/${match.route}`, historyError);
      continue;
    }

    if (!shouldSend(match.cheapest.price, last)) {
      console.log(`skipped (deduped) ${match.user_id}/${match.route}`);
      skipped++;
      continue;
    }

    const { subject, html, text } = renderEmail(match);

    let sendError: unknown = null;
    let status = 0;
    try {
      const { error } = await resend.emails.send({
        from: SENDER,
        to: [match.email],
        subject,
        html,
        text,
        headers: { "User-Agent": "flight-notifier/1.0" },
      });
      sendError = error;
    } catch (e) {
      sendError = e;
      status = 500;
    }

    if (sendError) {
      const code = (sendError as { statusCode?: number })?.statusCode ?? status;
      if (code === 403 || code === 422) {
        console.error(`permanent send failure for ${match.user_id}/${match.route}`, sendError);
      } else {
        console.error(`transient send failure for ${match.user_id}/${match.route}`, sendError);
      }
      continue; // no history row written -> retried on next parser run
    }

    const { error: insertError } = await admin.from("notification_history").insert({
      user_id: match.user_id,
      route: match.route,
      price: match.cheapest.price,
      currency: match.cheapest.currency,
    });
    if (insertError) {
      console.error(`failed to write history for ${match.user_id}/${match.route}`, insertError);
      continue;
    }

    sent++;
  }

  return Response.json({ sent, skipped });
});
