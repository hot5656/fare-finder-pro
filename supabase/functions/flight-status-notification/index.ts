// flight-status-notification: subscribe / unsubscribe emails, routed by
// `event_type` ("welcome" | "cancel"). One function for both — like M1's single
// flight-notification. Only called by flight-ecpay-return and
// flight-cancel-subscription, never scheduled.
//
// Body: { event_type, email, route, current_period_end? }
//
// verify_jwt = true, and the exact service-role bearer check below is what
// actually keeps random callers from sending email through us.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@4.0.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") as string;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") as string;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") as string;
const ECPAY_AMOUNT = Deno.env.get("ECPAY_AMOUNT");

const SENDER = "Flight Price Notifier <noreply@roberthut.com>"; // same as flight-notification
const resend = new Resend(RESEND_API_KEY);

type Payload = {
  event_type: "welcome" | "cancel";
  email: string;
  route: string;
  current_period_end?: string | null;
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
  return wrap(`已取消 ${label} 的降價通知訂閱`, [
    "我們已停止之後的扣款，不會再向你收費。",
    until ? `你已付款的期間內仍會收到通知，直到 ${until}。` : "",
    "想再回來，隨時可以重新訂閱。",
  ].filter(Boolean));
}

Deno.serve(async (req) => {
  if (req.headers.get("Authorization") !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = (await req.json()) as Payload;
  if (!payload?.email || !payload.route || !["welcome", "cancel"].includes(payload.event_type)) {
    return Response.json({ error: "event_type (welcome|cancel), email and route are required" }, { status: 400 });
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
