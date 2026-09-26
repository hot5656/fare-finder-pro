// Builds the v1.1 system deck (all features: free and paid modes, the admin
// pages and how it works) from the screenshots in docs/ppt-screenshots.
// Content follows docs/ppt-outline_1.1_system.md. Usage: see README.md.
// Shares its look with build.js (the v1.1 user deck) but is kept separate so
// rebuilding one never changes the other.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const pptxgen = require("pptxgenjs");
const QRCode = require("qrcode");

const SHOTS = path.join(__dirname, "..", "ppt-screenshots");
const BUILD = path.join(__dirname, ".build-system"); // generated crops + QR code
const OUT = path.resolve(
  process.argv[2] || path.join(__dirname, "..", "flight-price-notifier_v1.1_system_2026_0926.pptx"),
);
const SITE_URL = "https://flights.roberthut.com/";

// One card cut out of a Dashboard screenshot (pixel crop w:h:x:y). 26/27/30/31
// are 2560x1600 captures (same crops as build.js); 10/11/14/33 are 2880x1800.
// Re-check these if a screenshot is retaken with a different layout.
const CROPS = {
  "card-26.png": ["26-dashboard-free-target-entered.png", "845:397:422:454"],
  "card-27.png": ["27-dashboard-free-subscribed.png", "845:508:422:454"],
  "card-30.png": ["30-dashboard-free-cancel-confirm.png", "845:568:422:454"],
  "card-31.png": ["31-dashboard-free-ended.png", "845:443:422:454"],
  "card-10.png": ["10-dashboard-payment-success.png", "1698:655:592:432"],
  "card-11.png": ["11-cancel-confirm.png", "824:546:592:602"],
  "card-14.png": ["14-dashboard-cancelled.png", "824:420:592:465"],
  "card-33.png": ["33-dashboard-stale-fare.png", "824:469:592:933"],
  // Admin pages without the empty side margins and the page title, so the
  // tables stay readable at half-slide width.
  ...Object.fromEntries(
    [
      "35-admin-overview.png",
      "36-admin-settings.png",
      "37-admin-routes-add.png",
      "38-admin-routes-list.png",
      "39-admin-subscriptions.png",
      "40-admin-users.png",
      "41-admin-notifications.png",
      "42-admin-runs.png",
    ].map((f) => [`admin-${f.slice(0, 2)}.png`, [f, "2247:1440:302:360"]]),
  ),
};
const CROP_RATIO = Object.fromEntries(
  Object.entries(CROPS).map(([out, [, c]]) => {
    const [w, h] = c.split(":").map(Number);
    return [out, w / h];
  }),
);

function makeCrops() {
  fs.mkdirSync(BUILD, { recursive: true });
  for (const [out, [src, crop]] of Object.entries(CROPS)) {
    execFileSync("ffmpeg", [
      "-loglevel",
      "error",
      "-y",
      "-i",
      path.join(SHOTS, src),
      "-vf",
      `crop=${crop}`,
      path.join(BUILD, out),
    ]);
  }
}

const C = {
  bg: "03393E",
  card: "0E4A50",
  cardAlt: "0A4247",
  cardLine: "22626A",
  text: "F6F1E7",
  muted: "A9C6C4",
  red: "E5352F",
  amber: "F2B233",
  white: "FFFFFF",
};
const FONT = "PingFang TC";

const shot = (f) => path.join(SHOTS, f);
const local = (f) => path.join(BUILD, f);

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.333 x 7.5
pres.title = "Flight Price Notifier 機票降價通知 — 系統全功能介紹 v1.1";
pres.author = "Robert Kao";

function base() {
  const s = pres.addSlide();
  s.background = { color: C.bg };
  return s;
}

function txt(s, text, o) {
  s.addText(text, {
    fontFace: FONT,
    color: C.text,
    margin: 0,
    isTextBox: true,
    valign: "top",
    ...o,
  });
}

function header(s, kicker, title) {
  txt(s, kicker, {
    x: 0.6,
    y: 0.42,
    w: 12,
    h: 0.3,
    fontSize: 12,
    bold: true,
    color: C.red,
    charSpacing: 2,
  });
  txt(s, title, { x: 0.6, y: 0.72, w: 12.1, h: 0.7, fontSize: 30, bold: true });
}

function card(s, x, y, w, h, o = {}) {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x,
    y,
    w,
    h,
    rectRadius: 0.12,
    fill: { color: o.fill || C.card },
    line: { color: o.line || C.cardLine, width: o.lineW || 1 },
    shadow: o.noShadow
      ? undefined
      : { type: "outer", color: "000000", blur: 8, offset: 3, angle: 90, opacity: 0.35 },
  });
}

// Alt text per image. Without it pptxgenjs writes the image's absolute local
// path into the deck, so a missing entry is an error.
const ALT = {
  "08-ecpay-cashier-top.png": "綠界收銀台：定期定額 NT$300，每 1 個月扣款 1 次",
  "13-welcome-email.png": "付費訂閱成功信",
  "15-cancel-email.png": "付費訂閱取消信",
  "16-landing-hero.png": "首頁：Flight Price Notifier，設定航線與目標價，機票降價就通知你",
  "17-landing-full.png": "首頁全頁與三張功能卡片",
  "18-auth-signin.png": "登入頁",
  "19-auth-forgot.png": "忘記密碼頁",
  "20-auth-signup.png": "註冊頁，只需輸入 Email",
  "22-email-signup.png": "註冊確認信，含「繼續 / Continue」按鈕",
  "23-auth-set-password.png": "設定密碼頁",
  "24-dashboard-free-desktop.png": "Dashboard 上的四條航線卡片",
  "25-dashboard-free-mobile.png": "手機版 Dashboard",
  "28-email-free-welcome.png": "免費訂閱成功信",
  "29-email-alert.png": "降價通知信：台北到東京 NT$6,938 已達標",
  "32-email-free-cancel.png": "免費訂閱取消信",
  "34-dashboard-admin-button.png": "管理員的 Dashboard，右上角有 Admin 按鈕",
  "35-admin-overview.png": "Admin 總覽：查價狀態橫幅與統計卡片",
  "36-admin-settings.png": "Admin 設定：三個開關與航線最新價格",
  "37-admin-routes-add.png": "新增航線：台北到福岡的辨識結果、來回最低價與將顯示的名稱",
  "38-admin-routes-list.png": "所有航線列表與啟用開關",
  "39-admin-subscriptions.png": "所有訂閱列表，含手動發送與強制到期按鈕",
  "40-admin-users.png": "註冊用戶列表",
  "41-admin-notifications.png": "通知紀錄，區分自動與手動",
  "42-admin-runs.png": "查價紀錄，只看異常",
  "card-26.png": "東京航線卡片：已輸入目標價 10000，尚未訂閱",
  "card-27.png": "東京航線卡片：免費 · 有效至 2026/10/25",
  "card-30.png": "東京航線卡片：免費訂閱取消確認",
  "card-31.png": "東京航線卡片：已結束，可免費重新訂閱",
  "card-10.png": "付款完成提示與東京航線卡片：已訂閱（有效）",
  "card-11.png": "東京航線卡片：付費訂閱取消確認，已付款期間內仍會收到通知",
  "card-14.png": "東京航線卡片：已取消 · 有效至 2026/10/21",
  "card-33.png": "倫敦航線卡片：目前暫無最新票價，系統仍會持續查詢",
  "qr.png": `網站 QR code：${SITE_URL}`,
};
function altOf(file) {
  const base = path.basename(file);
  const src = CROPS[base] && base.startsWith("admin-") ? CROPS[base][0] : base;
  const alt = ALT[src];
  if (!alt) throw new Error(`no alt text for ${base}`);
  return alt;
}

// Screenshot on a floating rounded card: the deck's visual motif.
function framed(s, file, x, y, w, ratio) {
  const h = w / ratio;
  const pad = 0.07;
  card(s, x - pad, y - pad, w + pad * 2, h + pad * 2, { fill: "0A3F44" });
  s.addImage({ path: file, x, y, w, h, altText: altOf(file) });
  return h + pad;
}

// A cropped Dashboard card, ratio taken from its crop.
const crop = (s, name, x, y, w) => framed(s, local(name), x, y, w, CROP_RATIO[name]);

function caption(s, text, x, y, w) {
  txt(s, text, { x, y, w, h: 0.32, fontSize: 12, color: C.muted });
}

function bullets(s, items, o) {
  s.addText(
    items.map((p, i) => ({
      text: p,
      options: { bullet: true, breakLine: i < items.length - 1 },
    })),
    {
      fontFace: FONT,
      fontSize: 14,
      color: C.text,
      margin: 0,
      paraSpaceAfter: 6,
      isTextBox: true,
      valign: "top",
      ...o,
    },
  );
}

function dot(s, label, x, y, d, o = {}) {
  s.addShape(pres.shapes.OVAL, {
    x,
    y,
    w: d,
    h: d,
    fill: { color: o.fill || C.red },
    line: { color: o.fill || C.red },
  });
  txt(s, label, {
    x,
    y,
    w: d,
    h: d,
    align: "center",
    valign: "middle",
    fontSize: o.size || 16,
    bold: true,
    color: C.white,
  });
}

function arrow(s, x, y, w, back = false) {
  s.addShape(pres.shapes.LINE, {
    x,
    y,
    w,
    h: 0,
    line: { color: C.muted, width: 1.5, [back ? "beginArrowType" : "endArrowType"]: "triangle" },
  });
}

function stateBox(s, label, x, y, w, active) {
  card(s, x, y, w, 0.62, { line: active ? C.red : C.cardLine, lineW: 2, noShadow: true });
  txt(s, label, {
    x,
    y,
    w,
    h: 0.62,
    fontSize: 13,
    bold: true,
    align: "center",
    valign: "middle",
  });
}

// Table with a red header row and banded body rows.
function table(s, rows, o) {
  const body = rows.map((r, i) =>
    r.map((t, j) =>
      i === 0
        ? { text: t, options: { bold: true, color: C.white, fill: { color: C.red } } }
        : {
            text: t,
            options: { bold: j === 0, fill: { color: i % 2 ? C.card : C.cardAlt } },
          },
    ),
  );
  s.addTable(body, {
    fontFace: FONT,
    fontSize: 13,
    color: C.text,
    valign: "middle",
    border: { type: "solid", pt: 0.75, color: C.cardLine },
    margin: 0.08,
    ...o,
  });
}

// Admin slides: two screenshots side by side, a caption under each, then
// bullets across the bottom.
function adminSlide(kicker, title, [f1, c1], [f2, c2], points, notes) {
  const s = base();
  header(s, kicker, title);
  const w = 5.9;
  const name = (f) => `admin-${f.slice(0, 2)}.png`;
  crop(s, name(f1), 0.65, 1.65, w);
  crop(s, name(f2), 6.8, 1.65, w);
  caption(s, c1, 0.6, 5.58, w);
  caption(s, c2, 6.75, 5.58, w);
  bullets(s, points, { x: 0.6, y: 5.98, w: 12.1, h: 1.3, fontSize: 13, paraSpaceAfter: 4 });
  if (notes) s.addNotes(notes);
  return s;
}

async function main() {
  makeCrops();
  await QRCode.toFile(local("qr.png"), SITE_URL, {
    width: 900,
    margin: 1,
    color: { dark: "03393EFF", light: "FFFFFFFF" },
  });

  // 1 — Cover
  {
    const s = base();
    txt(s, "機票降價通知 ・ 系統全功能介紹 v1.1", {
      x: 0.6,
      y: 1.55,
      w: 6,
      h: 0.4,
      fontSize: 16,
      bold: true,
      color: C.red,
      charSpacing: 2,
    });
    txt(s, "Flight Price\nNotifier", {
      x: 0.6,
      y: 1.95,
      w: 5.8,
      h: 1.9,
      fontSize: 48,
      bold: true,
      lineSpacingMultiple: 0.95,
    });
    txt(s, "設定航線與目標價，機票降價就通知你", {
      x: 0.6,
      y: 3.95,
      w: 5.8,
      h: 0.5,
      fontSize: 20,
      bold: true,
    });
    txt(s, "使用者功能 ・ 操作教學 ・ 管理員後台 ・ 系統運作", {
      x: 0.6,
      y: 4.45,
      w: 5.8,
      h: 0.6,
      fontSize: 13,
      color: C.muted,
    });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: 0.6,
      y: 5.25,
      w: 3.5,
      h: 0.5,
      rectRadius: 0.25,
      fill: { color: C.red },
      line: { color: C.red },
    });
    txt(s, "flights.roberthut.com", {
      x: 0.6,
      y: 5.25,
      w: 3.5,
      h: 0.5,
      fontSize: 15,
      bold: true,
      align: "center",
      valign: "middle",
      color: C.white,
    });
    txt(s, "Robert Kao ｜ 2026-09-26", {
      x: 0.6,
      y: 6.55,
      w: 5,
      h: 0.35,
      fontSize: 13,
      color: C.muted,
    });
    framed(s, shot("16-landing-hero.png"), 6.75, 1.9, 6.0, 1.6);
    s.addNotes("封面。這一版涵蓋全部功能：使用者端（免費與付費）、管理員後台、系統運作與品質。");
  }

  // 2 — Problem
  {
    const s = base();
    header(s, "PART 1 ・ 開場", "你是不是也這樣買機票？");
    const items = [
      ["📈", "價格天天變", "機票價格每天浮動，只能一直手動刷網站。"],
      ["💰", "只在意預算", "其實不在意哪天飛，只想用預算內的價格出發。"],
      ["😩", "一錯過就多花好幾千", "一不注意低價就沒了，最後多付好幾千。"],
    ];
    items.forEach(([icon, head, body], i) => {
      const x = 0.6 + i * 4.1;
      card(s, x, 1.95, 3.85, 3.2);
      s.addShape(pres.shapes.OVAL, {
        x: x + 0.35,
        y: 2.3,
        w: 0.9,
        h: 0.9,
        fill: { color: C.red, transparency: 80 },
        line: { color: C.red },
      });
      txt(s, icon, {
        x: x + 0.35,
        y: 2.3,
        w: 0.9,
        h: 0.9,
        fontSize: 30,
        align: "center",
        valign: "middle",
      });
      txt(s, head, { x: x + 0.35, y: 3.45, w: 3.2, h: 0.5, fontSize: 20, bold: true });
      txt(s, body, { x: x + 0.35, y: 4.0, w: 3.2, h: 0.95, fontSize: 14, color: C.muted });
    });
    txt(s, "「你上次買機票，查了幾天？」", {
      x: 0.6,
      y: 5.75,
      w: 12.1,
      h: 0.6,
      fontSize: 22,
      italic: true,
      align: "center",
    });
    s.addNotes("用「你上次買機票查了幾天？」開場，讓聽眾回想自己手動比價的經驗。");
  }

  // 3 — One-liner, two modes, agenda
  {
    const s = base();
    header(s, "PART 1 ・ 開場", "一句話介紹與今天的範圍");
    s.addText(
      [
        { text: "幫你盯著熱門航線，", options: {} },
        { text: "來回最低價", options: {} },
        { text: "低於你的目標價", options: { color: C.red } },
        { text: "，就寄 email 通知你。", options: {} },
      ],
      {
        x: 0.6,
        y: 1.6,
        w: 12.1,
        h: 0.6,
        fontFace: FONT,
        fontSize: 24,
        bold: true,
        color: C.text,
        margin: 0,
        isTextBox: true,
      },
    );
    const modes = [
      ["免費模式", "目前上線中", "一次一個月，到期可無限次免費重新訂閱"],
      ["付費模式", "綠界信用卡定期定額", "NT$300／月，每月自動續扣，隨時取消"],
    ];
    modes.forEach(([head, tag, body], i) => {
      const x = 0.6 + i * 3.05;
      card(s, x, 2.55, 2.85, 2.2, { line: i === 0 ? C.red : C.cardLine, lineW: 1.5 });
      txt(s, head, { x: x + 0.25, y: 2.75, w: 2.4, h: 0.45, fontSize: 20, bold: true });
      txt(s, tag, {
        x: x + 0.25,
        y: 3.22,
        w: 2.4,
        h: 0.35,
        fontSize: 12,
        bold: true,
        color: C.red,
      });
      txt(s, body, { x: x + 0.25, y: 3.65, w: 2.4, h: 0.95, fontSize: 13, color: C.muted });
    });
    txt(s, "管理員在後台一鍵切換兩種模式", {
      x: 0.6,
      y: 4.9,
      w: 5.9,
      h: 0.35,
      fontSize: 13,
      color: C.muted,
    });
    const parts = [
      ["2", "使用者功能", "航線、通知信、訂閱模式"],
      ["3", "使用者操作", "註冊、登入、追蹤、管理"],
      ["4", "管理員後台", "航線、訂閱、用戶、紀錄"],
      ["5", "系統運作與品質", "架構、資料流程、安全、測試"],
    ];
    txt(s, "今天的四段", {
      x: 7.0,
      y: 2.55,
      w: 5.7,
      h: 0.4,
      fontSize: 16,
      bold: true,
      color: C.red,
    });
    parts.forEach(([n, head, body], i) => {
      const y = 3.05 + i * 0.95;
      dot(s, n, 7.0, y, 0.55, { size: 16 });
      txt(s, head, { x: 7.75, y: y - 0.03, w: 5, h: 0.35, fontSize: 16, bold: true });
      txt(s, body, { x: 7.75, y: y + 0.32, w: 5, h: 0.3, fontSize: 12.5, color: C.muted });
    });
    s.addNotes("目前網站是免費模式；付費模式（綠界）已完成並驗證，管理員可隨時切回。");
  }

  // 4 — Features
  {
    const s = base();
    header(s, "PART 2 ・ 使用者功能", "三大功能");
    const rows = [
      ["✈️", "盯緊熱門航線", "自動查詢熱門航線的來回最低票價。"],
      ["🔔", "達標自動通知", "低於你設定的目標價，就寄 email，附「立即訂購」連結。"],
      ["🚫", "隨時取消", "不想收了，一鍵取消。"],
    ];
    rows.forEach(([icon, head, body], i) => {
      const y = 1.85 + i * 1.6;
      s.addShape(pres.shapes.OVAL, {
        x: 0.6,
        y,
        w: 0.85,
        h: 0.85,
        fill: { color: C.red, transparency: 80 },
        line: { color: C.red },
      });
      txt(s, icon, {
        x: 0.6,
        y,
        w: 0.85,
        h: 0.85,
        fontSize: 26,
        align: "center",
        valign: "middle",
      });
      txt(s, head, { x: 1.75, y: y - 0.02, w: 4.6, h: 0.45, fontSize: 20, bold: true });
      txt(s, body, { x: 1.75, y: y + 0.47, w: 4.6, h: 0.75, fontSize: 14, color: C.muted });
    });
    framed(s, shot("17-landing-full.png"), 7.0, 1.75, 5.7, 2530 / 2018);
    s.addNotes("首頁第一張卡片寫「台北出發」，口頭補充目前也有東京 ✈ 紐約。");
  }

  // 5 — Routes
  {
    const s = base();
    header(s, "PART 2 ・ 使用者功能", "可以追蹤哪些航線");
    const routes = ["台北 ✈ 東京", "台北 ✈ 首爾", "台北 ✈ 倫敦", "東京 ✈ 紐約"];
    routes.forEach((r, i) => {
      const x = 0.6 + (i % 2) * 3.05;
      const y = 1.75 + Math.floor(i / 2) * 1.0;
      card(s, x, y, 2.85, 0.82);
      txt(s, r, {
        x,
        y,
        w: 2.85,
        h: 0.82,
        fontSize: 18,
        bold: true,
        align: "center",
        valign: "middle",
      });
    });
    bullets(
      s,
      [
        "航線由管理員從後台新增，不用改程式",
        "每條航線各自設定目標價、各自訂閱",
        "來回・新台幣計價（附美金參考）・約每 30 分鐘更新",
      ],
      { x: 0.6, y: 3.85, w: 5.9, h: 1.2, fontSize: 13.5, color: C.muted },
    );
    card(s, 0.6, 5.1, 5.9, 1.75, { line: C.amber, lineW: 1.5, noShadow: true });
    txt(s, "v1.1 新增：暫無最新票價提示", {
      x: 0.85,
      y: 5.25,
      w: 5.4,
      h: 0.38,
      fontSize: 15,
      bold: true,
      color: C.amber,
    });
    txt(
      s,
      "某條航線超過 2 小時查不到新票價，卡片會顯示「目前暫無最新票價，系統仍會持續查詢。」，價格改標「上次查到」。",
      { x: 0.85, y: 5.7, w: 5.4, h: 1.05, fontSize: 13, lineSpacingMultiple: 1.1 },
    );
    framed(s, shot("24-dashboard-free-desktop.png"), 6.95, 1.75, 5.8, 1.6);
    crop(s, "card-33.png", 8.55, 5.6, 2.6);
    s.addNotes("右下是倫敦卡片的實際畫面：9/25 之後查不到 10 月的票價，所以顯示暫無最新票價。");
  }

  // 6 — Alert email
  {
    const s = base();
    header(s, "PART 2 ・ 使用者功能", "降價通知信");
    framed(s, shot("29-email-alert.png"), 0.65, 1.75, 6.9, 2340 / 1504);
    const blocks = [
      [
        "通知頻率",
        "價格仍低於目標價時，約每 24 小時提醒一次；再大幅下降（降 20% 以上或少 NT$2,000 以上）會提早通知。",
      ],
      [
        "不想每天收到？",
        "把目標價調低到你真正想買的價格，價格再降時才通知；不需要了也可以隨時取消。",
      ],
      [
        "回程日期不理想？",
        "在訂票頁調整日期比價，有機會找到仍在預算內的組合（通常不會比通知價更低）。",
      ],
    ];
    blocks.forEach(([head, body], i) => {
      const y = 1.75 + i * 1.72;
      card(s, 7.95, y, 4.75, 1.55);
      txt(s, head, { x: 8.2, y: y + 0.17, w: 4.3, h: 0.4, fontSize: 16, bold: true, color: C.red });
      txt(s, body, {
        x: 8.2,
        y: y + 0.58,
        w: 4.3,
        h: 0.9,
        fontSize: 12.5,
        lineSpacingMultiple: 1.1,
      });
    });
    s.addNotes(
      "信件內容：NT$ 票價、約當 US$、你的目標價；航班詳情；黃色提醒：票價只適用這組日期；" +
        "「立即訂購」直接帶到訂票搜尋頁。實際價格以訂購頁為準。",
    );
  }

  // 7 — Two modes compared
  {
    const s = base();
    header(s, "PART 2 ・ 使用者功能", "兩種訂閱模式比較");
    table(
      s,
      [
        ["", "免費模式", "付費模式（綠界）"],
        ["開始方式", "按「開始免費追蹤（一個月）」立即生效", "按「開始追蹤」→ 綠界收銀台付款"],
        ["費用", "免費", "NT$300／月，信用卡定期定額"],
        ["期間", "一個月，到期自動結束", "每月自動續扣"],
        ["取消", "立即停止通知", "停止之後的扣款，已付款期間內仍通知"],
        ["到期後", "「免費重新訂閱」，次數不限", "「重新訂閱」，重新付款"],
        ["卡片標籤", "免費 · 有效至 yyyy/mm/dd", "已訂閱（有效）／已取消 · 有效至 yyyy/mm/dd"],
      ],
      { x: 0.6, y: 1.7, w: 12.1, colW: [1.9, 4.8, 5.4], rowH: 0.56, fontSize: 14 },
    );
    txt(
      s,
      "管理員切回付費模式時，既有的免費訂閱保留到各自的到期日。目前綠界使用測試特店，不會真的扣款。",
      { x: 0.6, y: 6.0, w: 12.1, h: 0.6, fontSize: 13, color: C.muted },
    );
  }

  // 8 — State flow
  {
    const s = base();
    header(s, "PART 2 ・ 使用者功能", "訂閱狀態流程");
    const lane = (y, label, states, edges) => {
      txt(s, label, {
        x: 0.6,
        y: y + 0.13,
        w: 1.3,
        h: 0.4,
        fontSize: 15,
        bold: true,
        color: C.red,
      });
      const w = 2.1;
      const gap = 0.8;
      states.forEach(([name, active], i) => stateBox(s, name, 2.0 + i * (w + gap), y, w, active));
      edges.forEach((e, i) => {
        const x = 2.0 + w + i * (w + gap) + 0.05;
        arrow(s, x, y + 0.31, gap - 0.1);
        txt(s, e, {
          x: x - 0.25,
          y: y - 0.34,
          w: gap + 0.4,
          h: 0.3,
          fontSize: 10,
          align: "center",
          color: C.muted,
        });
      });
    };
    lane(
      1.95,
      "免費",
      [
        ["尚未訂閱", false],
        ["免費 · 有效中", true],
        ["已結束", false],
        ["免費 · 有效中", true],
      ],
      ["開始追蹤", "到期或取消", "重新訂閱"],
    );
    lane(
      3.2,
      "付費",
      [
        ["未完成付款", false],
        ["已訂閱（有效）", true],
        ["已取消（有效至到期日）", true],
        ["已結束", false],
      ],
      ["付款成功", "取消", "到期"],
    );
    txt(s, "付費續扣失敗會寄扣款失敗信；超過到期日 7 天寬限期仍未續扣 → 已結束", {
      x: 2.0,
      y: 3.95,
      w: 10.7,
      h: 0.3,
      fontSize: 11.5,
      color: C.muted,
    });
    crop(s, "card-27.png", 0.65, 4.55, 3.5);
    caption(s, "免費 · 有效中", 0.6, 6.72, 3.6);
    crop(s, "card-31.png", 4.75, 4.55, 3.5);
    caption(s, "已結束（免費）", 4.7, 6.46, 3.6);
    crop(s, "card-14.png", 8.85, 4.55, 3.85);
    caption(s, "已取消 · 有效至 2026/10/21（付費）", 8.8, 6.6, 3.9);
    s.addNotes(
      "紅框的狀態會收到降價通知：免費有效中、付費已訂閱，以及付費已取消但還在已付款期間內。",
    );
  }

  // 9 — Emails
  {
    const s = base();
    header(s, "PART 2 ・ 使用者功能", "你會收到哪些信");
    table(
      s,
      [
        ["時機", "免費模式", "付費模式"],
        ["訂閱成功", "✅", "✅"],
        ["價格達標", "✅", "✅"],
        ["主動取消", "✅", "✅"],
        ["每月續扣成功", "—", "✅"],
        ["扣款失敗", "—", "✅"],
        ["到期結束", "✅ 附重新訂閱連結", "✅"],
      ],
      { x: 0.6, y: 1.7, w: 5.6, colW: [1.8, 2.1, 1.7], rowH: 0.52, fontSize: 13 },
    );
    txt(s, "另有帳號信：註冊確認信、重設密碼信", {
      x: 0.6,
      y: 5.5,
      w: 5.6,
      h: 0.35,
      fontSize: 13,
      color: C.muted,
    });
    framed(s, shot("28-email-free-welcome.png"), 6.75, 1.75, 5.95, 2372 / 732);
    caption(s, "免費訂閱成功信", 6.7, 3.66, 6);
    framed(s, shot("13-welcome-email.png"), 6.75, 4.2, 5.95, 2364 / 736);
    caption(s, "付費訂閱成功信（每月扣款 NT$300，可隨時取消）", 6.7, 6.12, 6);
    s.addNotes("取消信：免費版寫「降價通知即刻停止」；付費版寫「已付款期間內仍會收到通知」。");
  }

  // 10 — Flow overview
  {
    const s = base();
    header(s, "PART 3 ・ 使用者操作", "操作流程總覽");
    const steps = [
      ["註冊", "只要 email，從信中連結設定密碼"],
      ["登入", "進入 Dashboard"],
      ["開始追蹤", "免費：立即生效\n付費：到綠界付款"],
      ["收通知", "價格達標就寄 email 給你"],
      ["管理", "調整目標價、取消、重新訂閱"],
    ];
    const gap = 2.5;
    s.addShape(pres.shapes.LINE, {
      x: 1.65,
      y: 2.85,
      w: gap * 4,
      h: 0,
      line: { color: C.cardLine, width: 2 },
    });
    steps.forEach(([head, body], i) => {
      const cx = 1.65 + i * gap;
      dot(s, String(i + 1), cx - 0.45, 2.4, 0.9, { size: 24 });
      txt(s, head, {
        x: cx - 1.15,
        y: 3.55,
        w: 2.3,
        h: 0.45,
        fontSize: 19,
        bold: true,
        align: "center",
      });
      txt(s, body, {
        x: cx - 1.1,
        y: 4.05,
        w: 2.2,
        h: 1.0,
        fontSize: 13,
        color: C.muted,
        align: "center",
      });
    });
    card(s, 3.67, 5.65, 6.0, 0.8, { line: C.red, lineW: 1.5 });
    s.addText(
      [
        { text: "從這裡開始：", options: { color: C.muted } },
        { text: "flights.roberthut.com", options: { bold: true } },
      ],
      {
        x: 3.67,
        y: 5.65,
        w: 6.0,
        h: 0.8,
        fontFace: FONT,
        fontSize: 18,
        color: C.text,
        align: "center",
        valign: "middle",
        margin: 0,
        isTextBox: true,
      },
    );
  }

  // 11 — Step 1: sign up
  {
    const s = base();
    header(s, "STEP 1", "註冊與設定密碼");
    const w = 3.7;
    const xs = [0.6, 4.82, 9.03];
    framed(s, shot("20-auth-signup.png"), xs[0], 1.8, w, 1.6);
    card(s, xs[1] - 0.07, 1.73, w + 0.14, w / 1.6 + 0.14, { fill: "FFFFFF" });
    s.addImage({
      altText: altOf("22-email-signup.png"),
      path: shot("22-email-signup.png"),
      x: xs[1],
      y: 1.8 + (w / 1.6 - w / (2366 / 585)) / 2,
      w,
      h: w / (2366 / 585),
    });
    framed(s, shot("23-auth-set-password.png"), xs[2], 1.8, w, 1.6);
    arrow(s, xs[0] + w + 0.12, 1.8 + w / 3.2, 0.27);
    arrow(s, xs[1] + w + 0.12, 1.8 + w / 3.2, 0.27);
    const caps = [
      "打開網站 → 右上角「Sign in / 登入」→「Create one」，只填 Email",
      "到信箱收信，點「繼續 / Continue」",
      "設定密碼（至少 6 碼）即完成",
    ];
    caps.forEach((c, i) => {
      dot(s, String(i + 1), xs[i], 4.3, 0.42, { size: 13 });
      txt(s, c, { x: xs[i] + 0.55, y: 4.3, w: w - 0.55, h: 0.8, fontSize: 13 });
    });
    card(s, 0.6, 5.45, 12.13, 1.3, { noShadow: true });
    s.addText(
      [
        { text: "沒收到信？", options: { bold: true, color: C.red } },
        { text: "請檢查垃圾郵件匣。", options: { breakLine: true } },
        { text: "共用帳號系統：", options: { bold: true, color: C.red } },
        {
          text: "email 若已在同一帳號系統的其他服務註冊過，會改寄重設密碼信；設定的新密碼也會成為那些服務的密碼（頁面上有提示）。",
        },
      ],
      {
        x: 0.9,
        y: 5.6,
        w: 11.6,
        h: 1.0,
        fontFace: FONT,
        fontSize: 14,
        color: C.text,
        margin: 0,
        isTextBox: true,
        paraSpaceAfter: 6,
        valign: "top",
      },
    );
  }

  // 12 — Step 2: sign in / forgot
  {
    const s = base();
    header(s, "STEP 2", "登入、忘記密碼、登出");
    framed(s, shot("18-auth-signin.png"), 0.65, 1.8, 5.8, 1.6);
    framed(s, shot("19-auth-forgot.png"), 6.9, 1.8, 5.8, 1.6);
    txt(s, "輸入 Email、Password，按「Sign in / 登入」，自動進入 Dashboard", {
      x: 0.6,
      y: 5.6,
      w: 5.9,
      h: 0.7,
      fontSize: 14,
    });
    txt(
      s,
      "點「Forgot password? 忘記密碼？」→ 輸入 email →「Send reset link」→ 從信中連結設定新密碼",
      { x: 6.85, y: 5.6, w: 5.9, h: 0.7, fontSize: 14 },
    );
    txt(s, "登出：Dashboard 右上角「Sign out / 登出」　・　未登入直接開 Dashboard 會被帶回登入頁", {
      x: 0.6,
      y: 6.5,
      w: 12.1,
      h: 0.4,
      fontSize: 12,
      color: C.muted,
    });
  }

  // 13 — Step 3a: free
  {
    const s = base();
    header(s, "STEP 3a", "免費模式：開始追蹤");
    const steps = [
      ["輸入目標價", "在「來回目標價 TWD」輸入你的預算，例如 10000"],
      ["按「開始免費追蹤（一個月）」", "立即生效，不用付款，並收到訂閱成功信"],
      ["看到「免費 · 有效至 …」", "卡片標籤顯示服務到期日"],
    ];
    steps.forEach(([head, body], i) => {
      const y = 1.85 + i * 1.3;
      dot(s, String(i + 1), 0.6, y, 0.5, { size: 15 });
      txt(s, head, { x: 1.3, y: y - 0.02, w: 3.8, h: 0.42, fontSize: 16, bold: true });
      txt(s, body, { x: 1.3, y: y + 0.42, w: 3.8, h: 0.7, fontSize: 13, color: C.muted });
    });
    card(s, 0.6, 5.85, 4.5, 1.0, { line: C.red, lineW: 1.5, noShadow: true });
    txt(s, "小技巧：參考卡片下方「最後查詢（來回）」的價格，設一個合理的目標。", {
      x: 0.85,
      y: 5.95,
      w: 4.05,
      h: 0.8,
      fontSize: 13,
      valign: "middle",
    });
    crop(s, "card-26.png", 5.55, 1.85, 4.2);
    txt(s, "▼", {
      x: 5.55,
      y: 3.98,
      w: 4.2,
      h: 0.35,
      fontSize: 14,
      align: "center",
      color: C.muted,
    });
    crop(s, "card-27.png", 5.55, 4.4, 4.2);
    framed(s, shot("25-dashboard-free-mobile.png"), 10.45, 1.85, 2.2, 1170 / 2532);
    txt(s, "手機也能用", {
      x: 10.4,
      y: 6.72,
      w: 2.3,
      h: 0.3,
      fontSize: 12,
      align: "center",
      color: C.muted,
    });
    s.addNotes("輸入空白、0 或負數會顯示「請輸入有效的目標價」。");
  }

  // 14 — Step 3b: paid
  {
    const s = base();
    header(s, "STEP 3b", "付費模式：綠界付款");
    const steps = [
      ["按「開始追蹤」", "跳轉到綠界收銀台：NT$300，每 1 個月扣款 1 次"],
      ["付款完成自動導回", "Dashboard 顯示「付款完成，訂閱正在生效中…」"],
      ["看到「已訂閱（有效）」", "並收到訂閱成功信；之後每月自動續扣"],
    ];
    steps.forEach(([head, body], i) => {
      const y = 1.8 + i * 1.12;
      dot(s, String(i + 1), 0.6, y, 0.5, { size: 15 });
      txt(s, head, { x: 1.3, y: y - 0.02, w: 4.3, h: 0.42, fontSize: 16, bold: true });
      txt(s, body, { x: 1.3, y: y + 0.42, w: 4.3, h: 0.6, fontSize: 13, color: C.muted });
    });
    card(s, 0.6, 5.3, 5.0, 1.5, { line: C.red, lineW: 1.5, noShadow: true });
    txt(
      s,
      "付款失敗或中途離開：卡片顯示「未完成付款」，按「完成付款」重試。\n目前是綠界測試特店，不會真的扣款。",
      { x: 0.85, y: 5.42, w: 4.55, h: 1.3, fontSize: 13, lineSpacingMultiple: 1.15 },
    );
    framed(s, shot("08-ecpay-cashier-top.png"), 6.1, 1.75, 6.6, 2850 / 1300);
    crop(s, "card-10.png", 6.1, 5.0, 6.6 * 0.72);
    s.addNotes(
      "付費模式截圖是 2026-09-21 拍的，卡片文字是舊版（「目標價 TWD」「最後查詢：」，現在是「來回目標價 TWD」「最後查詢（來回）」），流程與按鈕相同。綠界收銀台已裁掉卡片欄位。",
    );
  }

  // 15 — Step 4: manage
  {
    const s = base();
    header(s, "STEP 4", "管理訂閱");
    const items = [
      ["調整目標價", "改數字後按「更新目標價」，立即生效（付費模式不用重新付款）。"],
      [
        "取消訂閱",
        "免費：「取消後立即停止通知。」\n付費：「已付款的期間內仍會收到通知。」→「確定取消」或「保留」",
      ],
      ["重新訂閱", "已結束後按「免費重新訂閱」／「重新訂閱」。"],
    ];
    const hs = [1.2, 1.55, 1.2];
    let y = 1.75;
    items.forEach(([head, body], i) => {
      card(s, 0.6, y, 5.2, hs[i]);
      txt(s, head, {
        x: 0.85,
        y: y + 0.15,
        w: 4.8,
        h: 0.4,
        fontSize: 16,
        bold: true,
        color: C.red,
      });
      txt(s, body, {
        x: 0.85,
        y: y + 0.55,
        w: 4.8,
        h: hs[i] - 0.6,
        fontSize: 13,
        lineSpacingMultiple: 1.1,
      });
      y += hs[i] + 0.2;
    });
    crop(s, "card-30.png", 6.2, 1.75, 3.15);
    caption(s, "免費：取消確認", 6.15, 1.75 + 3.15 / CROP_RATIO["card-30.png"] + 0.1, 3.2);
    crop(s, "card-11.png", 9.55, 1.75, 3.15);
    caption(s, "付費：取消確認", 9.5, 1.75 + 3.15 / CROP_RATIO["card-11.png"] + 0.1, 3.2);
    crop(s, "card-31.png", 7.9, 4.45, 3.15);
    caption(s, "已結束 → 免費重新訂閱", 7.85, 4.45 + 3.15 / CROP_RATIO["card-31.png"] + 0.1, 3.2);
    s.addNotes("達標後不想每天收到提醒，就把目標價調低到低於目前最低價。");
  }

  // 16 — Demo (user side)
  {
    const s = base();
    header(s, "PART 3 ・ 使用者操作", "Demo：使用者端");
    const steps = ["登入", "開始免費追蹤", "收到訂閱成功信", "調整目標價", "取消"];
    const gap = 2.5;
    steps.forEach((t, i) => {
      const x = 0.6 + i * gap;
      card(s, x, 2.1, 2.2, 1.2, { line: C.red, lineW: 1.5 });
      txt(s, t, {
        x,
        y: 2.1,
        w: 2.2,
        h: 1.2,
        fontSize: 17,
        bold: true,
        align: "center",
        valign: "middle",
      });
      if (i < steps.length - 1) arrow(s, x + 2.22, 2.7, gap - 2.26);
    });
    card(s, 0.6, 3.9, 12.1, 2.6, { noShadow: true });
    txt(s, "Demo 前準備", {
      x: 0.9,
      y: 4.08,
      w: 11.5,
      h: 0.4,
      fontSize: 16,
      bold: true,
      color: C.red,
    });
    bullets(
      s,
      [
        "確認網站處於免費模式（按鈕文字是「開始免費追蹤（一個月）」）",
        "準備一個已設定好密碼的帳號，避免現場等註冊信",
        "通知信無法保證現場觸發，備好事先收到的通知信截圖",
        "Demo 完記得取消 Demo 帳號的訂閱",
      ],
      { x: 0.9, y: 4.55, w: 11.5, h: 1.9, fontSize: 14 },
    );
  }

  // 17 — Admin entry
  {
    const s = base();
    header(s, "PART 4 ・ 管理員後台", "誰看得到後台");
    framed(s, shot("34-dashboard-admin-button.png"), 0.65, 1.75, 7.0, 1.6);
    bullets(
      s,
      [
        "只有管理員帳號的 Dashboard 右上角會出現「Admin」按鈕",
        "一般帳號直接輸入 /admin 會被導回 Dashboard；後台資料另由資料庫權限把關，就算畫面被繞過也讀不到",
      ],
      { x: 8.1, y: 1.75, w: 4.6, h: 1.9, fontSize: 14 },
    );
    txt(s, "後台六個分頁", {
      x: 8.1,
      y: 3.75,
      w: 4.6,
      h: 0.4,
      fontSize: 16,
      bold: true,
      color: C.red,
    });
    const tabs = [
      "總覽 Overview",
      "航線 Routes",
      "註冊用戶 Users",
      "所有訂閱 Subscriptions",
      "通知紀錄 Notifications",
      "查價紀錄 Price checks",
    ];
    tabs.forEach((t, i) => {
      const x = 8.1 + (i % 2) * 2.35;
      const y = 4.25 + Math.floor(i / 2) * 0.62;
      card(s, x, y, 2.25, 0.5, { noShadow: true });
      txt(s, t, { x, y, w: 2.25, h: 0.5, fontSize: 11.5, align: "center", valign: "middle" });
    });
    s.addNotes("權限檢查在資料庫（flight.is_admin() + RLS），畫面上的按鈕只是方便進入。");
  }

  // 18 — Overview & settings
  adminSlide(
    "PART 4 ・ 管理員後台",
    "總覽與設定",
    ["35-admin-overview.png", "查價狀態橫幅＋統計卡片"],
    ["36-admin-settings.png", "三個設定開關＋航線最新價格"],
    [
      "統計：有效訂閱、預估月營收 MRR、總訂閱數、付款失敗，以及各狀態筆數；查價有異常、超過 65 分鐘沒查價或卡在執行中時顯示橫幅",
      "開關：使用綠界付款（付費／免費模式）・v1 價格對照（通知信附另一來源的價格）・測試：強制到期（僅供測試）",
    ],
    "「使用綠界付款」就是 Slide 7 兩種模式的切換開關，立即套用於之後的新訂閱。",
  );

  // 19 — Routes
  adminSlide(
    "PART 4 ・ 管理員後台",
    "航線管理",
    ["37-admin-routes-add.png", "新增：台北 → 福岡，即時查到 NT$7,928 才能新增；名稱取自辨識結果"],
    ["38-admin-routes-list.png", "所有航線：只有啟用開關"],
    [
      "輸入中文城市名或三碼代碼 →「查詢價格」→ 確認辨識結果 →「確認新增」，使用者 Dashboard 立即看到",
      "名稱取自辨識結果，與代碼一樣建立後不可修改；停用：不再開放新訂閱，只對仍持有訂閱的人顯示",
    ],
    "截圖時只按了「查詢價格」，沒有新增福岡。列表中的台北 ✈ 大阪是 2026-09-26 測試時新增、測完停用的（航線不能刪除）。",
  );

  // 20 — Subscriptions & users
  adminSlide(
    "PART 4 ・ 管理員後台",
    "所有訂閱與註冊用戶",
    ["39-admin-subscriptions.png", "所有訂閱（email 已遮蔽）"],
    ["40-admin-users.png", "註冊用戶（email 已遮蔽）"],
    [
      "所有訂閱：搜尋 email 或航線、依狀態篩選；看付款方式、到期日、扣款失敗、續扣次數；「手動發送」立即寄出達標通知",
      "註冊用戶：註冊與驗證時間、最後登入、訂閱數與付費中數；管理員帳號標示 Admin",
    ],
    "「強制到期」只在測試開關開啟時出現（截圖時開啟，現在已關閉），可把已取消的訂閱立即改為已結束並寄到期信。",
  );

  // 21 — Notifications & runs
  adminSlide(
    "PART 4 ・ 管理員後台",
    "通知紀錄與查價紀錄",
    ["41-admin-notifications.png", "通知紀錄：自動 Auto／手動 Manual"],
    ["42-admin-runs.png", "查價紀錄：只看異常"],
    [
      "通知紀錄：每封降價通知的收件人、航線、價格、時間與觸發方式",
      "查價紀錄：每 30 分鐘一筆，保留 90 天；狀態、耗時、API 次數、比對數與異常（429 限流、查無票價）",
    ],
    "右圖的警告就是倫敦查無 10 月票價，也就是 Slide 5「暫無最新票價」的原因。",
  );

  // 22 — Architecture
  {
    const s = base();
    header(s, "PART 5 ・ 系統運作", "系統架構");
    const col = (x, w, title, sub, lines, line) => {
      card(s, x, 1.9, w, 3.9, { line: line || C.cardLine, lineW: 1.5 });
      txt(s, title, { x: x + 0.3, y: 2.1, w: w - 0.6, h: 0.45, fontSize: 19, bold: true });
      txt(s, sub, {
        x: x + 0.3,
        y: 2.58,
        w: w - 0.6,
        h: 0.35,
        fontSize: 12,
        color: C.red,
        bold: true,
      });
      bullets(s, lines, { x: x + 0.3, y: 3.1, w: w - 0.6, h: 2.6, fontSize: 13 });
    };
    col(0.6, 3.5, "前端", "flights.roberthut.com", [
      "TanStack Start（React 19）",
      "Tailwind ＋ shadcn/ui",
      "Vercel 部署",
    ]);
    col(
      4.85,
      3.7,
      "後端 Supabase",
      "沒有自己的伺服器",
      [
        "Postgres（schema flight）＋ RLS",
        "Edge Functions（訂閱、回呼、查價、寄信）",
        "pg_cron 每 30 分鐘排程",
      ],
      C.red,
    );
    col(9.3, 3.4, "外部服務", "", ["綠界 ECPay：付款", "Resend：寄信", "Travelpayouts：票價來源"]);
    arrow(s, 4.15, 3.85, 0.65);
    arrow(s, 4.15, 3.85, 0.65, true);
    arrow(s, 8.6, 3.85, 0.65);
    arrow(s, 8.6, 3.85, 0.65, true);
    txt(s, "瀏覽器讀資料用使用者自己的登入身分；寫入一律經過 Edge Functions", {
      x: 0.6,
      y: 6.1,
      w: 12.1,
      h: 0.4,
      fontSize: 13,
      color: C.muted,
      align: "center",
    });
  }

  // 23 — Data flow
  {
    const s = base();
    header(s, "PART 5 ・ 系統運作", "降價通知的資料流程");
    const steps = [
      ["排程觸發", "pg_cron 每 30 分鐘"],
      ["處理到期", "取消過期、逾寬限期、免費到期，並寄信"],
      ["查票價", "每條航線的來回最低價，更新「最後查詢」"],
      ["比對目標價", "只比對有效訂閱"],
      ["去重寄信", "24 小時內同價不重寄，Resend 寄出"],
      ["寫查價紀錄", "給管理員看狀態與異常"],
    ];
    const gap = 2.08;
    s.addShape(pres.shapes.LINE, {
      x: 1.3,
      y: 2.55,
      w: gap * 5,
      h: 0,
      line: { color: C.cardLine, width: 2 },
    });
    steps.forEach(([head, body], i) => {
      const cx = 1.3 + i * gap;
      dot(s, String(i + 1), cx - 0.4, 2.15, 0.8, { size: 22 });
      txt(s, head, {
        x: cx - 1.0,
        y: 3.2,
        w: 2.0,
        h: 0.42,
        fontSize: 16,
        bold: true,
        align: "center",
      });
      txt(s, body, {
        x: cx - 0.95,
        y: 3.65,
        w: 1.9,
        h: 1.2,
        fontSize: 12,
        color: C.muted,
        align: "center",
      });
    });
    card(s, 0.6, 5.3, 12.1, 1.4, { line: C.red, lineW: 1.5, noShadow: true });
    txt(
      s,
      "有效訂閱＝付費已訂閱、付費已取消但還在已付款期間內，或免費有效期內。\n實測：付款完成後約 2 分鐘，下一輪排程就寄出了達標通知。",
      { x: 0.9, y: 5.45, w: 11.5, h: 1.15, fontSize: 14, lineSpacingMultiple: 1.2 },
    );
  }

  // 24 — Payment & data safety
  {
    const s = base();
    header(s, "PART 5 ・ 系統運作", "付款與資料安全");
    const items = [
      [
        "只認驗證過的付款",
        "只有通過檢核碼驗證的綠界回呼，才能把訂閱改成「有效」；測試模擬付款不會啟用。",
      ],
      [
        "瀏覽器不能寫訂閱",
        "使用者沒有寫入訂閱的權限，無法自己改成已付費；所有寫入都經過伺服器函式。",
      ],
      ["先停扣款再取消", "取消時先通知綠界停止扣款，成功才改本地狀態，避免取消了卻還在扣錢。"],
      ["共用帳號系統", "登入頁只接受已註冊本服務的帳號；資料一律以使用者本人為範圍（RLS）。"],
    ];
    items.forEach(([head, body], i) => {
      const x = 0.6 + (i % 2) * 6.17;
      const y = 1.8 + Math.floor(i / 2) * 2.45;
      card(s, x, y, 5.97, 2.2);
      txt(s, head, {
        x: x + 0.3,
        y: y + 0.25,
        w: 5.4,
        h: 0.45,
        fontSize: 18,
        bold: true,
        color: C.red,
      });
      txt(s, body, {
        x: x + 0.3,
        y: y + 0.8,
        w: 5.4,
        h: 1.25,
        fontSize: 14,
        lineSpacingMultiple: 1.15,
      });
    });
  }

  // 25 — Test results
  {
    const s = base();
    header(s, "PART 6 ・ 品質與收尾", "測試結果");
    const stats = [
      ["114", "測試用例"],
      ["111", "通過"],
      ["3", "部分驗證"],
      ["0", "失敗"],
    ];
    stats.forEach(([big, small], i) => {
      const x = 0.6 + i * 3.08;
      card(s, x, 1.8, 2.85, 1.9);
      txt(s, big, {
        x: x + 0.3,
        y: 2.0,
        w: 2.3,
        h: 1.0,
        fontSize: 48,
        bold: true,
        color: i === 3 ? C.text : C.red,
      });
      txt(s, small, { x: x + 0.3, y: 3.05, w: 2.3, h: 0.4, fontSize: 16 });
    });
    bullets(
      s,
      [
        "核心功能 92 項（前端與登入、抓價比對、寄信去重、綠界付費牆、資料庫與安全）：91 通過，含綠界排程真實續扣",
        "免費模式開關 10 項全數通過；管理員後台 12 項：10 通過、2 部分驗證",
        "測試中發現並修正 9 個缺陷，例如 email 含「+」付款後無法啟用、非管理員直接開網址會看到後台畫面（資料未外洩）",
      ],
      { x: 0.6, y: 4.2, w: 12.1, h: 2.2, fontSize: 15, paraSpaceAfter: 10 },
    );
    s.addNotes(
      "數字取自 docs/test-report.md（2026-09-26 更新，全部章節）。" +
        "部分驗證的 3 項：H3（USD 取價失敗仍寄 TWD 通知，僅程式碼審查）、" +
        "AD-04（查價健康橫幅的兩種錯誤狀態）、AD-06（新增航線預覽的 422／409）。",
    );
  }

  // 26 — Future, Q&A, contact
  {
    const s = base();
    header(s, "PART 6 ・ 品質與收尾", "未來規劃與 Q&A");
    bullets(
      s,
      [
        "改用正式綠界特店，決定何時從免費模式切回付費",
        "更多出發地與航線（歡迎來信提需求）",
        "更嚴謹的跨服務存取控制",
      ],
      { x: 0.6, y: 1.75, w: 7.2, h: 1.8, fontSize: 16, paraSpaceAfter: 10 },
    );
    txt(s, "謝謝！", { x: 0.6, y: 3.75, w: 7, h: 0.9, fontSize: 44, bold: true });
    txt(s, "立即試用：https://flights.roberthut.com/", {
      x: 0.6,
      y: 4.8,
      w: 7.2,
      h: 0.45,
      fontSize: 18,
      bold: true,
    });
    txt(s, "Robert ｜ robertkao5656@gmail.com", {
      x: 0.6,
      y: 5.35,
      w: 7.2,
      h: 0.45,
      fontSize: 16,
      color: C.muted,
    });
    card(s, 8.6, 1.6, 3.9, 4.5, { fill: "FFFFFF", line: "FFFFFF" });
    s.addImage({
      path: local("qr.png"),
      x: 8.95,
      y: 1.9,
      w: 3.2,
      h: 3.2,
      altText: altOf("qr.png"),
    });
    txt(s, "手機掃描開啟", {
      x: 8.6,
      y: 5.35,
      w: 3.9,
      h: 0.4,
      fontSize: 15,
      bold: true,
      align: "center",
      color: C.bg,
    });
    s.addNotes(
      "Q&A 備用：要錢嗎（目前免費）、多久查一次（約 30 分鐘）、價格準嗎（以訂購頁為準）、" +
        "會一直寄嗎（約 24 小時一封，大幅再降才提早）、可以追多條嗎（可以）。",
    );
  }

  await pres.writeFile({ fileName: OUT });
  console.log("wrote", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
