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
// Deployed with verify_jwt = true (see supabase/config.toml), so the gateway
// rejects requests without a valid JWT. That accepts any project JWT (e.g. the
// anon key), so the exact service-role check below is what actually stops a
// random caller from spamming emails.

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

// One offer from either Travelpayouts endpoint (see flight-parser). v3 fills
// every field; v1 has no airports, transfers or link.
type Cheapest = {
  source?: "v3" | "v1";
  price: number;
  currency: string;
  airline: string;
  flight_number?: string;
  depart_date: string;
  return_date: string;
  origin_airport?: string;
  destination_airport?: string;
  transfers?: number | null;
  return_transfers?: number | null;
  duration?: number | null;
  duration_to?: number | null;
  duration_back?: number | null;
  link?: string;
};

type OfferPair = { twd: Cheapest | null; usd: Cheapest | null };

type Match = {
  user_id: string;
  email: string;
  route: string; // e.g. "TPE-TYO"
  plan_name: string;
  target_price: number;
  cheapest: Cheapest; // v3, the price that triggered this alert
  cheapest_usd?: Cheapest | null;
  // v1's cheapest offer at the same check, listed in the email for comparison.
  compare_v1?: OfferPair | null;
  // When this price was actually checked -- "just now" from flight-parser's live
  // fetch, or flight.routes.last_checked_at (possibly stale) from a manual send.
  // Lets the recipient tell which point-in-time price triggered this email.
  checked_at?: string | null;
};

// force: bypass shouldSend()'s dedup floor for this call. Only flight-admin-notify
// sets this (one match at a time); flight-parser never does, so the automatic path
// is unaffected. triggered_by records which admin forced the send, for audit.

const PLAN_LABELS: Record<string, string> = {
  tokyo: "台北 → 東京",
  seoul: "台北 → 首爾",
  london: "台北 → 倫敦",
};

// IATA carrier codes seen (or likely) on TPE-TYO/SEL/LON. Unknown codes are shown as-is.
const AIRLINES: Record<string, string> = {
  CI: "中華航空",
  BR: "長榮航空",
  JX: "星宇航空",
  IT: "台灣虎航",
  AE: "華信航空",
  B7: "立榮航空",
  MM: "樂桃航空",
  JL: "日本航空",
  NH: "全日空",
  GK: "捷星日本",
  TR: "酷航",
  KE: "大韓航空",
  OZ: "韓亞航空",
  "7C": "濟州航空",
  LJ: "真航空",
  TW: "德威航空",
  ZE: "易斯達航空",
  BX: "釜山航空",
  RS: "首爾航空",
  CX: "國泰航空",
  UO: "香港快運",
  HX: "香港航空",
  MU: "中國東方航空",
  CA: "中國國際航空",
  CZ: "中國南方航空",
  MF: "廈門航空",
  FM: "上海航空",
  HO: "吉祥航空",
  "9C": "春秋航空",
  BA: "英國航空",
  VS: "維珍航空",
  EK: "阿聯酋航空",
  QR: "卡達航空",
  EY: "阿提哈德航空",
  TK: "土耳其航空",
  SQ: "新加坡航空",
  TG: "泰國航空",
  VN: "越南航空",
  KL: "荷蘭皇家航空",
  AF: "法國航空",
  LH: "漢莎航空",
  LX: "瑞士航空",
  AY: "芬蘭航空",
  PR: "菲律賓航空",
  "5J": "宿霧太平洋航空",
  D7: "亞洲航空 X",
  AK: "亞洲航空",
};

// Local time zone per city/airport code, so each time is shown where it happens.
const TIME_ZONES: Record<string, string> = {
  TPE: "Asia/Taipei",
  TSA: "Asia/Taipei",
  TYO: "Asia/Tokyo",
  NRT: "Asia/Tokyo",
  HND: "Asia/Tokyo",
  SEL: "Asia/Seoul",
  ICN: "Asia/Seoul",
  GMP: "Asia/Seoul",
  LON: "Europe/London",
  LHR: "Europe/London",
  LGW: "Europe/London",
  STN: "Europe/London",
  LTN: "Europe/London",
  LCY: "Europe/London",
};

function shouldSend(newPrice: number, last: { price: number; sent_at: string } | null): boolean {
  if (!last) return true;
  const hoursSince = (Date.now() - new Date(last.sent_at).getTime()) / 3_600_000;
  if (hoursSince >= NOTIFY_FLOOR_HOURS) return true;
  const pctDrop = newPrice <= last.price * (1 - REALERT_PCT / 100);
  const absDrop = last.price - newPrice >= REALERT_ABS_TWD;
  return pctDrop || absDrop;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function withMarker(url: string): string {
  if (!TRAVELPAYOUTS_MARKER) return url;
  const u = new URL(url);
  u.searchParams.set("marker", TRAVELPAYOUTS_MARKER);
  return u.toString();
}

function bookingUrl(route: string, offer: Cheapest): string {
  // v3 hands us a deep link to this exact itinerary; prefer it.
  if (offer.link) return withMarker(`https://www.aviasales.com${offer.link}`);
  const [origin, destination] = route.split("-");
  // Aviasales deep-link dates are DDMM (day+month, 2 digits each), not the
  // full YYYY-MM-DD the API gives us — an 8-digit date makes the whole path
  // unparseable and Aviasales silently drops destination/dates ("search
  // failed to launch"), leaving only the origin recognized.
  const departDate = offer.depart_date ? new Date(offer.depart_date) : null;
  const depart =
    departDate && !isNaN(departDate.getTime())
      ? `${String(departDate.getDate()).padStart(2, "0")}${String(departDate.getMonth() + 1).padStart(2, "0")}`
      : "";
  return withMarker(`https://www.aviasales.com/search/${origin}${depart}${destination}1`);
}

function fmtCheckedAt(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  try {
    return d.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
  } catch {
    return iso;
  }
}

// "2026/10/29（四）17:15" in the given IANA zone.
function fmtLocal(d: Date, code: string): string {
  const timeZone = TIME_ZONES[code] ?? "Asia/Taipei";
  try {
    const date = d.toLocaleDateString("zh-TW", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const weekday = d.toLocaleDateString("zh-TW", { timeZone, weekday: "narrow" });
    const time = d.toLocaleTimeString("zh-TW", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return `${date}（${weekday}）${time}`;
  } catch {
    return d.toISOString();
  }
}

// Date only ("2026/10/29（四）") in the zone of the city the leg departs from.
function fmtDay(iso: string, code: string): string {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d.getTime())) return "";
  return fmtLocal(d, code)
    .replace(/\s*\d{2}:\d{2}$/, "")
    .replace(/）.*$/, "）");
}

// The fare is for this exact date pair; spell that out, since changing either
// date (the return included) reprices the ticket.
function dateNote(route: string, o: Cheapest): string {
  const [routeFrom, routeTo] = route.split("-");
  const out = fmtDay(o.depart_date, o.origin_airport || routeFrom);
  const back = fmtDay(o.return_date, o.destination_airport || routeTo);
  const dates =
    out && back
      ? `去程 ${out}、回程 ${back}這組日期`
      : out
        ? `去程 ${out}出發的這組行程`
        : "上列日期";
  return (
    `此為來回票價，僅適用於${dates}。更改任一日期（包含回程）價格都可能不同；` +
    "廉價航空等優惠票購買後改期，通常需支付改票手續費與票價差額，部分票種不可更改。"
  );
}

function fmtDuration(min: number | null | undefined): string {
  if (min == null || min <= 0) return "";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} 小時${m ? ` ${m} 分` : ""}` : `${m} 分`;
}

function fmtStops(n: number | null | undefined): string {
  if (n == null) return "";
  return n === 0 ? "直飛" : `轉機 ${n} 次`;
}

function airlineLabel(code: string): string {
  if (!code) return "";
  return AIRLINES[code] ? `${AIRLINES[code]}（${code}）` : code;
}

type Leg = { title: string; line: string };

// One line per leg: "10/29（四）17:15 TPE → 10/29（四）21:30 NRT · 3 小時 15 分 · 直飛".
// Arrival is departure + leg duration (which includes layovers), shown in the
// arrival city's zone -- an estimate, so the email says so.
function legs(route: string, o: Cheapest): Leg[] {
  const [routeFrom, routeTo] = route.split("-");
  const from = o.origin_airport || routeFrom;
  const to = o.destination_airport || routeTo;
  const out: Leg[] = [];
  const add = (
    title: string,
    iso: string,
    dur: number | null | undefined,
    stops: number | null | undefined,
    a: string,
    b: string,
  ) => {
    const dep = iso ? new Date(iso) : null;
    if (!dep || isNaN(dep.getTime())) return;
    const arrive = dur
      ? ` → ${fmtLocal(new Date(dep.getTime() + dur * 60_000), b)} ${b}`
      : ` → ${b}`;
    const parts = [`${fmtLocal(dep, a)} ${a}${arrive}`, fmtDuration(dur), fmtStops(stops)];
    out.push({ title, line: parts.filter(Boolean).join(" · ") });
  };
  add("去程", o.depart_date, o.duration_to, o.transfers, from, to);
  add("回程", o.return_date, o.duration_back, o.return_transfers, to, from);
  return out;
}

function fmtPrice(twd: Cheapest | null | undefined, usd: Cheapest | null | undefined): string {
  if (!twd) return "";
  const usdPart = usd ? `（約 US$${Math.round(usd.price).toLocaleString()}）` : "";
  return `NT$${Math.round(twd.price).toLocaleString()}${usdPart}`;
}

// Rows describing one offer, as [label, value] pairs shared by the HTML and text bodies.
function offerRows(
  route: string,
  twd: Cheapest,
  usd: Cheapest | null | undefined,
): Array<[string, string]> {
  const rows: Array<[string, string]> = [["票價（來回）", fmtPrice(twd, usd)]];
  if (twd.airline) rows.push(["航空公司", airlineLabel(twd.airline)]);
  if (twd.flight_number) rows.push(["去程航班", `${twd.airline}${twd.flight_number}`]);
  for (const leg of legs(route, twd)) rows.push([leg.title, leg.line]);
  // Sum the legs rather than using the API's `duration`: on TPE-LON it came back
  // as 2860 min against legs of 925 + 805, so it isn't a plain total.
  if (twd.duration_to && twd.duration_back) {
    rows.push(["去回程合計", `${fmtDuration(twd.duration_to + twd.duration_back)}（含轉機等候）`]);
  }
  return rows;
}

function rowsHtml(rows: Array<[string, string]>): string {
  return rows
    .map(
      ([k, v]) =>
        `<tr><td style="color:#888;padding:3px 12px 3px 0;white-space:nowrap;vertical-align:top;">${esc(k)}</td>` +
        `<td style="padding:3px 0;">${esc(v)}</td></tr>`,
    )
    .join("");
}

function rowsText(rows: Array<[string, string]>): string {
  return rows.map(([k, v]) => `  ${k}：${v}`).join("\n");
}

function renderEmail(
  match: Match,
  manual: boolean,
): { subject: string; html: string; text: string } {
  const label = PLAN_LABELS[match.plan_name] ?? match.route;
  const price = Math.round(match.cheapest.price).toLocaleString();
  const target = Math.round(match.target_price).toLocaleString();
  const usdLine = match.cheapest_usd
    ? `<p style="color:#666;font-size:14px;margin:4px 0 0;">約 US$${Math.round(match.cheapest_usd.price).toLocaleString()}</p>`
    : "";
  const usdText = match.cheapest_usd
    ? ` (約 US$${Math.round(match.cheapest_usd.price).toLocaleString()})`
    : "";
  const checkedAt = fmtCheckedAt(match.checked_at);
  const checkedAtLine = checkedAt ? `<p style="margin:2px 0;">查價時間：${checkedAt}</p>` : "";
  const checkedAtText = checkedAt ? `\n查價時間：${checkedAt}` : "";
  const manualLine = manual ? `<p style="margin:2px 0;">此通知由客服人員手動觸發。</p>` : "";
  const manualText = manual ? "\n（此通知由客服人員手動觸發）" : "";
  const url = bookingUrl(match.route, match.cheapest);

  const mainRows = offerRows(match.route, match.cheapest, match.cheapest_usd);
  const datesNote = dateNote(match.route, match.cheapest);

  // v1 comparison block. Also says how far v1's price is from the v3 one.
  const v1 = match.compare_v1?.twd ?? null;
  let v1Html = "";
  let v1Text = "";
  if (v1) {
    const v1Rows = offerRows(match.route, v1, match.compare_v1?.usd);
    const diff = Math.round(v1.price - match.cheapest.price);
    const diffLabel =
      diff === 0
        ? "與上方價格相同"
        : `比上方${diff > 0 ? "高" : "低"} NT$${Math.abs(diff).toLocaleString()}`;
    v1Rows.splice(1, 0, ["價差", diffLabel]);
    const v1Url = bookingUrl(match.route, v1);
    v1Html = `
      <h3 style="font-size:15px;margin:24px 0 6px;color:#555;">對照：Aviasales 另一資料來源（v1）的最低價</h3>
      <table style="font-size:13px;border-collapse:collapse;color:#555;">${rowsHtml(v1Rows)}</table>
      <p style="font-size:13px;margin:8px 0 0;"><a href="${esc(v1Url)}" style="color:#7c3aed;">查看此航班日期的搜尋結果</a></p>`;
    v1Text = `\n\n對照：Aviasales 另一資料來源（v1）的最低價\n${rowsText(v1Rows)}\n  搜尋連結：${v1Url}`;
  } else if (match.compare_v1) {
    v1Html = `<p style="font-size:13px;color:#888;margin-top:24px;">對照：v1 資料來源此次未回傳票價。</p>`;
    v1Text = "\n\n對照：v1 資料來源此次未回傳票價。";
  }

  const note =
    "票價與航班為 Aviasales 近期搜尋的快取資料，實際價格、時間與座位以訂購頁為準；抵達時間依出發時間與飛行時間推算（當地時間），僅供參考。";

  const subject = `✈️ ${label} 降價通知！NT$${price} 已達標`;

  const html = `
    <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto;">
      <h2>${subject}</h2>
      <p style="font-size:22px;font-weight:700;margin:12px 0 0;">NT$${price}</p>
      ${usdLine}
      <p style="color:#666;font-size:13px;margin-top:4px;">你的目標價：NT$${target}</p>
      <h3 style="font-size:15px;margin:20px 0 6px;">航班詳情（v3 最低價，觸發本通知）</h3>
      <table style="font-size:14px;border-collapse:collapse;">${rowsHtml(mainRows)}</table>
      <p style="font-size:13px;color:#92400e;background:#fef3c7;border-radius:6px;padding:8px 10px;margin:12px 0 0;">${esc(datesNote)}</p>
      <p style="margin-top:16px;">
        <a href="${esc(url)}"
           style="display:inline-block;padding:12px 20px;background:#7c3aed;color:#fff;
                  border-radius:8px;text-decoration:none;font-weight:600;">
          立即訂購
        </a>
      </p>
      ${v1Html}
      <div style="color:#999;font-size:12px;margin-top:24px;">
        <p style="margin:2px 0;">${note}</p>
        ${checkedAtLine}
        ${manualLine}
      </div>
    </div>
  `;
  const text =
    `${subject}\nNT$${price}${usdText}\n你的目標價：NT$${target}` +
    `\n\n航班詳情（v3 最低價，觸發本通知）\n${rowsText(mainRows)}\n※ ${datesNote}\n立即訂購: ${url}` +
    `${v1Text}\n\n${note}${checkedAtText}${manualText}`;

  return { subject, html, text };
}

Deno.serve(async (req) => {
  const auth = req.headers.get("Authorization");
  if (auth !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { matches, force, triggered_by } = (await req.json()) as {
    matches: Match[];
    force?: boolean;
    triggered_by?: string | null;
  };
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

    if (!force && !shouldSend(match.cheapest.price, last)) {
      console.log(`skipped (deduped) ${match.user_id}/${match.route}`);
      skipped++;
      continue;
    }

    const { subject, html, text } = renderEmail(match, !!force);

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
      triggered_by: force ? (triggered_by ?? null) : null,
    });
    if (insertError) {
      console.error(`failed to write history for ${match.user_id}/${match.route}`, insertError);
      continue;
    }

    sent++;
  }

  return Response.json({ sent, skipped });
});
