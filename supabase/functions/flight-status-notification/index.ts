// flight-status-notification: subscription lifecycle emails, routed by
// `event_type` ("welcome" | "cancel" | "expired" | "payment_failed" | "renewed").
// One function for all of them — like M1's single flight-notification. Called by
// flight-ecpay-return (welcome), flight-cancel-subscription (cancel),
// flight-ecpay-period (renewed, payment_failed, expired) and flight-parser
// (expired); never scheduled itself.
//
// Body: { event_type, email, route, current_period_end?, reason?, amount?, charge_no? }
//   amount / charge_no ("renewed" only): what was charged and which charge it was.
//   reason ("expired" only): "period_ended" (a cancelled subscription ran out)
//   or "payment_lapsed" (renewals stopped succeeding).
//
// verify_jwt = true, and the exact service-role bearer check below is what
// actually keeps random callers from sending email through us.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@4.0.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") as string;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") as string;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") as string;
const ECPAY_AMOUNT = Deno.env.get("ECPAY_AMOUNT");
// Only used to build a 重新訂閱 link. Unset -> the email just has no link
// (better than a localhost link in a real inbox).
const SITE_URL = Deno.env.get("SITE_URL")?.replace(/\/$/, "");

const SENDER = "Flight Price Notifier <noreply@roberthut.com>"; // same as flight-notification
const resend = new Resend(RESEND_API_KEY);

const EVENT_TYPES = ["welcome", "cancel", "expired", "payment_failed", "renewed"] as const;

type Payload = {
  event_type: (typeof EVENT_TYPES)[number];
  email: string;
  route: string;
  current_period_end?: string | null;
  reason?: "period_ended" | "payment_lapsed";
  amount?: number;
  charge_no?: number;
};

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" }) : "";

function render(p: Payload, label: string): { subject: string; html: string; text: string } {
  const until = fmtDate(p.current_period_end);
  const wrap = (title: string, lines: string[]) => ({
    subject: title,
    html: `<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2>${title}</h2>${lines.map((l) => `<p>${l}</p>`).join("")}</div>`,
    text: `${title}\n${lines.join("\n")}`,
  });

  if (p.event_type === "welcome") {
    return wrap(`✈️ 訂閱成功！${label} 降價通知已開始`, [
      `謝謝你的訂閱。當 ${label} 的機票降到你的目標價，我們會立刻寄信通知你。`,
      ECPAY_AMOUNT ? `每月扣款 NT$${Number(ECPAY_AMOUNT).toLocaleString()}（信用卡定期定額），你可以隨時取消。` : "",
      until ? `目前的服務期間至 ${until}。` : "",
    ].filter(Boolean));
  }

  if (p.event_type === "cancel") {
    return wrap(`已取消 ${label} 的降價通知訂閱`, [
      "我們已停止之後的扣款，不會再向你收費。",
      until ? `你已付款的期間內仍會收到通知，直到 ${until}。` : "",
      "想再回來，隨時可以重新訂閱。",
    ].filter(Boolean));
  }

  if (p.event_type === "payment_failed") {
    return wrap(`⚠️ ${label} 本期扣款失敗`, [
      `我們嘗試向你的信用卡收取 ${label} 降價通知的月費，但這次扣款沒有成功。`,
      "系統會自動再試幾次。請確認信用卡的額度與有效期限，必要時聯絡發卡銀行。",
      "如果持續失敗，訂閱會結束，降價通知也會停止，屆時我們會再寄信告訴你。",
    ]);
  }

  if (p.event_type === "renewed") {
    const money = Number(p.amount) > 0 ? Number(p.amount) : Number(ECPAY_AMOUNT);
    const amt = money > 0 ? `NT$${Math.round(money).toLocaleString()}` : "";
    return wrap(`✅ ${label} 本期已扣款${amt ? ` ${amt}` : ""}`, [
      `你的 ${label} 降價通知訂閱已續訂${p.charge_no ? `（第 ${p.charge_no} 期）` : ""}。`,
      amt ? `本期已從你的信用卡扣款 ${amt}（信用卡定期定額）。` : "本期已從你的信用卡扣款（信用卡定期定額）。",
      until ? `服務期間延長至 ${until}。` : "",
      "不想繼續的話，可隨時取消；取消後，已付款的期間內仍會收到通知。",
    ].filter(Boolean));
  }

  // expired
  const resubscribe = SITE_URL ? `想繼續收到通知，隨時可以到 ${SITE_URL}/dashboard 重新訂閱。` : "想繼續收到通知，隨時可以重新訂閱。";
  return wrap(`${label} 降價通知已結束`, [
    p.reason === "payment_lapsed"
      ? `因為多次扣款未成功，你的 ${label} 訂閱已結束，我們不會再寄降價通知。`
      : `你的 ${label} 訂閱期間已結束，我們不會再寄降價通知，也不會再向你收費。`,
    resubscribe,
  ]);
}

Deno.serve(async (req) => {
  if (req.headers.get("Authorization") !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = (await req.json()) as Payload;
  if (!payload?.email || !payload.route || !EVENT_TYPES.includes(payload.event_type)) {
    return Response.json(
      { error: `event_type (${EVENT_TYPES.join("|")}), email and route are required` },
      { status: 400 },
    );
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { db: { schema: "flight" } });
  const { data: plan } = await admin
    .from("routes")
    .select("display_name")
    .eq("route", payload.route)
    .maybeSingle();
  const label = (plan?.display_name as string | undefined)?.replace("✈", "→") ?? payload.route;

  const { subject, html, text } = render(payload, label);
  try {
    const { error } = await resend.emails.send({
      from: SENDER,
      to: [payload.email],
      subject,
      html,
      text,
      headers: { "User-Agent": "flight-notifier/1.0" },
    });
    if (error) {
      console.error(`${payload.event_type} email failed for ${payload.email}`, error);
      return Response.json({ sent: false, error: (error as { message?: string }).message }, { status: 502 });
    }
  } catch (e) {
    console.error(`${payload.event_type} email threw for ${payload.email}`, e);
    return Response.json({ sent: false }, { status: 502 });
  }

  console.log(`${payload.event_type} email sent to ${payload.email} (${payload.route})`);
  return Response.json({ sent: true });
});
