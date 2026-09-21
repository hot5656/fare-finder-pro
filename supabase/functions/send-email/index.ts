// Supabase Auth "Send Email" hook.
// Receives the webhook Supabase Auth fires instead of sending mail itself,
// verifies it, and sends the actual email through Resend's API.
//
// Env vars required (set via `supabase secrets set`):
//   RESEND_API_KEY        - Resend API key
//   SEND_EMAIL_HOOK_SECRET - the secret shown when you create the hook in
//                            Authentication → Hooks → Send Email (Supabase
//                            prefixes it with "v1,whsec_"; pass it as-is)
//
// SUPABASE_URL and SUPABASE_ANON_KEY are injected automatically by the
// Supabase Edge Functions runtime — no need to set them yourself.

import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";
import { Resend } from "https://esm.sh/resend@4.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY") as string);
const hookSecret = (Deno.env.get("SEND_EMAIL_HOOK_SECRET") as string).replace(
  "v1,whsec_",
  "",
);
// The verify link must point at the Supabase project's own API domain (not
// the app's site_url) and must carry an apikey — the browser hits this
// endpoint directly via a clicked link, so it can't send an apikey header.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") as string;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") as string;

const SENDER = "Flight Price Notifier <noreply@roberthut.com>"; // TODO: replace with your verified Resend domain

const SUBJECTS: Record<string, string> = {
  signup: "確認你的帳號 / Confirm your account",
  recovery: "重設密碼 / Reset your password",
  email_change: "確認變更 email / Confirm your new email",
  magiclink: "登入連結 / Your sign-in link",
  invite: "邀請你加入 / You've been invited",
};

// A bare "click Continue" mail with no product name and no reason looks like phishing
// to spam filters (and to people), so every mail says who we are, why they got it and
// that it can be ignored.
const PRODUCT = "Flight Price Notifier（機票降價通知）";
const INTROS: Record<string, string> = {
  signup: `你剛剛用這個 email 在 ${PRODUCT}註冊了帳號。請點擊下方按鈕確認你的 email，完成註冊。`,
  recovery: `我們收到重設你 ${PRODUCT}帳號密碼的請求。請點擊下方按鈕設定新密碼。`,
  email_change: `你要求變更 ${PRODUCT}帳號使用的 email。請點擊下方按鈕確認這項變更。`,
  magiclink: `你要求用登入連結登入 ${PRODUCT}。請點擊下方按鈕登入。`,
  invite: `有人邀請你加入 ${PRODUCT}。請點擊下方按鈕接受邀請。`,
};
const DEFAULT_INTRO = `請點擊下方按鈕完成 ${PRODUCT}的驗證。`;
const IGNORE_NOTE = "如果這不是你本人的操作，請直接忽略這封信，你的帳號不會有任何變更。";

function buildHtml(actionType: string, confirmUrl: string): string {
  const subject = SUBJECTS[actionType] ?? "驗證通知 / Verification";
  const intro = INTROS[actionType] ?? DEFAULT_INTRO;
  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2>${subject}</h2>
      <p>${intro}</p>
      <p>
        <a href="${confirmUrl}"
           style="display:inline-block;padding:12px 20px;background:#7c3aed;color:#fff;
                  border-radius:8px;text-decoration:none;font-weight:600;">
          繼續 / Continue
        </a>
      </p>
      <p style="color:#666;font-size:13px;">
        如果按鈕無法點擊，請複製以下連結到瀏覽器：<br/>
        <a href="${confirmUrl}">${confirmUrl}</a>
      </p>
      <p style="color:#666;font-size:13px;">${IGNORE_NOTE}</p>
    </div>
  `;
}

// Plain-text alternative. HTML-only mail is one of the signals mailbox providers
// weigh against a message (the confirmation mail landed in Gmail's spam folder while
// flight-status-notification, which sends both parts, reached the inbox).
function buildText(actionType: string, confirmUrl: string): string {
  const subject = SUBJECTS[actionType] ?? "驗證通知 / Verification";
  const intro = (INTROS[actionType] ?? DEFAULT_INTRO).replace("下方按鈕", "以下連結");
  return `${subject}\n\n${intro}\n${confirmUrl}\n\n${IGNORE_NOTE}\n`;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const payload = await req.text();
  const headers = Object.fromEntries(req.headers);
  const wh = new Webhook(hookSecret);

  try {
    const {
      user,
      email_data: { token_hash, redirect_to, email_action_type },
    } = wh.verify(payload, headers) as {
      user: { email: string };
      email_data: {
        token_hash: string;
        redirect_to: string;
        email_action_type: string;
      };
    };

    const confirmUrl = `${SUPABASE_URL}/auth/v1/verify?token=${token_hash}&type=${email_action_type}&redirect_to=${redirect_to}&apikey=${SUPABASE_ANON_KEY}`;

    const { error } = await resend.emails.send({
      from: SENDER,
      to: [user.email],
      subject: SUBJECTS[email_action_type] ?? "驗證通知 / Verification",
      html: buildHtml(email_action_type, confirmUrl),
      text: buildText(email_action_type, confirmUrl),
    });

    if (error) {
      throw error;
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: {
          http_code: 500,
          message: error instanceof Error ? error.message : "Unknown error",
        },
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(JSON.stringify({}), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
