// Builds the v1.1 user-facing deck (free subscription only) from the
// screenshots in docs/ppt-screenshots. Usage: see README.md in this folder.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const pptxgen = require("pptxgenjs");
const QRCode = require("qrcode");

const SHOTS = path.join(__dirname, "..", "ppt-screenshots");
const BUILD = path.join(__dirname, ".build"); // generated crops + QR code
const OUT = path.resolve(
  process.argv[2] || path.join(__dirname, "..", "flight-price-notifier_v1.1_user_2026_0926.pptx"),
);
const SITE_URL = "https://flights.roberthut.com/";

// The Tokyo card cut out of each Dashboard screenshot (pixel crop w:h:x:y on
// the 2560x1600 captures), so it is readable at slide size. Re-check these if
// a screenshot is retaken with a different layout.
const CROPS = {
  "card-26.png": ["26-dashboard-free-target-entered.png", "845:397:422:454"],
  "card-27.png": ["27-dashboard-free-subscribed.png", "845:508:422:454"],
  "card-30.png": ["30-dashboard-free-cancel-confirm.png", "845:568:422:454"],
  "card-31.png": ["31-dashboard-free-ended.png", "845:443:422:454"],
};

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
  cardLine: "22626A",
  text: "F6F1E7",
  muted: "A9C6C4",
  red: "E5352F",
  white: "FFFFFF",
};
const FONT = "PingFang TC";

const shot = (f) => path.join(SHOTS, f);
const local = (f) => path.join(BUILD, f);

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.333 x 7.5
pres.title = "Flight Price Notifier 機票降價通知 — 使用者介紹 v1.1";
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
// path into the deck (and screen readers read it out).
const ALT = {
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
  "32-email-free-cancel.png": "訂閱取消信",
  "card-26.png": "東京航線卡片：已輸入目標價 10000，尚未訂閱",
  "card-27.png": "東京航線卡片：免費 · 有效至 2026/10/25",
  "card-30.png": "東京航線卡片：取消訂閱確認",
  "card-31.png": "東京航線卡片：已結束，可免費重新訂閱",
  "qr.png": `網站 QR code：${SITE_URL}`,
};
const altOf = (file) => ALT[path.basename(file)] || "";

// Screenshot on a floating rounded card: the deck's visual motif.
function framed(s, file, x, y, w, ratio) {
  const h = w / ratio;
  const pad = 0.07;
  card(s, x - pad, y - pad, w + pad * 2, h + pad * 2, { fill: "0A3F44" });
  s.addImage({ path: file, x, y, w, h, altText: altOf(file) });
  return h + pad;
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
    txt(s, "機票降價通知", {
      x: 0.6,
      y: 1.55,
      w: 5.8,
      h: 0.4,
      fontSize: 16,
      bold: true,
      color: C.red,
      charSpacing: 3,
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
    txt(s, "Set a route and a target price — we email you when the fare drops.", {
      x: 0.6,
      y: 4.45,
      w: 5.6,
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
    s.addNotes("封面。網址 flights.roberthut.com，結尾頁有 QR code。");
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

  // 3 — One-liner
  {
    const s = base();
    header(s, "PART 1 ・ 開場", "一句話介紹");
    s.addText(
      [
        { text: "幫你盯著熱門航線，", options: { breakLine: true } },
        { text: "來回最低價", options: {} },
        { text: "低於你的目標價", options: { color: C.red } },
        { text: "，就寄 email 通知你。", options: {} },
      ],
      {
        x: 0.6,
        y: 1.75,
        w: 12.1,
        h: 1.3,
        fontFace: FONT,
        fontSize: 28,
        bold: true,
        color: C.text,
        margin: 0,
        isTextBox: true,
      },
    );
    txt(s, "適合：預算導向、出發日期有彈性的旅客", {
      x: 0.6,
      y: 3.25,
      w: 12,
      h: 0.4,
      fontSize: 16,
      color: C.muted,
    });
    const stats = [
      ["NT$0", "目前免費使用"],
      ["1 個月", "每次訂閱的服務期間"],
      ["無限次", "到期可再免費重新訂閱"],
    ];
    stats.forEach(([big, small], i) => {
      const x = 0.6 + i * 4.1;
      card(s, x, 3.95, 3.85, 2.3);
      txt(s, big, { x: x + 0.35, y: 4.3, w: 3.2, h: 1.0, fontSize: 48, bold: true, color: C.red });
      txt(s, small, { x: x + 0.35, y: 5.4, w: 3.2, h: 0.45, fontSize: 16 });
    });
    s.addNotes("目前免費：一次訂閱一個月，到期可以再免費重新訂閱，次數不限。");
  }

  // 4 — Features
  {
    const s = base();
    header(s, "PART 2 ・ 功能介紹", "三大功能");
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
    s.addNotes(
      "首頁第三張卡片寫的是「月訂閱制…沒有綁約」，目前是免費模式，口頭說明「目前免費」即可。" +
        "第一張卡片寫「台北出發」，口頭補充目前也有東京 ✈ 紐約。",
    );
  }

  // 5 — Routes
  {
    const s = base();
    header(s, "PART 2 ・ 功能介紹", "目前先開放 4 條航線");
    const routes = ["台北 ✈ 東京", "台北 ✈ 首爾", "台北 ✈ 倫敦", "東京 ✈ 紐約"];
    routes.forEach((r, i) => {
      const x = 0.6 + (i % 2) * 3.05;
      const y = 1.8 + Math.floor(i / 2) * 1.2;
      card(s, x, y, 2.85, 1.0);
      txt(s, r, {
        x,
        y,
        w: 2.85,
        h: 1.0,
        fontSize: 20,
        bold: true,
        align: "center",
        valign: "middle",
      });
    });
    txt(s, "每條航線各自設定目標價、各自訂閱\n來回・新台幣計價（附美金參考）・約每 30 分鐘更新", {
      x: 0.6,
      y: 4.3,
      w: 5.9,
      h: 0.75,
      fontSize: 14,
      color: C.muted,
      lineSpacingMultiple: 1.2,
    });
    card(s, 0.6, 5.3, 5.9, 1.45, { line: C.red, lineW: 1.5 });
    txt(s, "想追蹤其他航線？", {
      x: 0.9,
      y: 5.48,
      w: 5.4,
      h: 0.4,
      fontSize: 17,
      bold: true,
      color: C.red,
    });
    txt(s, "來信告訴我，我會依大家的需求調整航線。\nRobert ｜ robertkao5656@gmail.com", {
      x: 0.9,
      y: 5.9,
      w: 5.4,
      h: 0.75,
      fontSize: 14,
      lineSpacingMultiple: 1.2,
    });
    framed(s, shot("24-dashboard-free-desktop.png"), 6.95, 1.8, 5.8, 1.6);
    s.addNotes("強調可以同時追蹤多條航線；想要新的航線請來信，會依需求調整。");
  }

  // 6 — Alert email
  {
    const s = base();
    header(s, "PART 2 ・ 功能介紹", "降價通知信長什麼樣");
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
      "信件內容：NT$ 票價、約當 US$、你的目標價；航班詳情（航空公司、航班、去回程時間、飛行時間）；" +
        "黃色提醒：票價只適用這組日期；「立即訂購」直接帶到訂票搜尋頁。" +
        "信中票價是訂票網站近期的查詢結果，實際價格以訂購頁為準。",
    );
  }

  // 7 — Free subscription flow
  {
    const s = base();
    header(s, "PART 2 ・ 功能介紹", "免費訂閱怎麼運作");
    const nodes = [
      ["尚未訂閱", 0.6, C.cardLine],
      ["免費 · 有效中", 5.5, C.red],
      ["已結束", 10.4, C.cardLine],
    ];
    nodes.forEach(([label, x, line]) => {
      card(s, x, 1.8, 2.33, 0.85, { line, lineW: 2, noShadow: true });
      txt(s, label, {
        x,
        y: 1.8,
        w: 2.33,
        h: 0.85,
        fontSize: 17,
        bold: true,
        align: "center",
        valign: "middle",
      });
    });
    arrow(s, 3.05, 2.23, 2.33);
    txt(s, "開始免費追蹤（一個月）", {
      x: 2.95,
      y: 1.72,
      w: 2.55,
      h: 0.35,
      fontSize: 11.5,
      align: "center",
      color: C.muted,
    });
    arrow(s, 7.95, 2.08, 2.33);
    txt(s, "到期 或 取消", {
      x: 7.95,
      y: 1.62,
      w: 2.33,
      h: 0.35,
      fontSize: 11.5,
      align: "center",
      color: C.muted,
    });
    arrow(s, 7.95, 2.4, 2.33, true);
    txt(s, "免費重新訂閱", {
      x: 7.95,
      y: 2.5,
      w: 2.33,
      h: 0.35,
      fontSize: 11.5,
      align: "center",
      color: C.muted,
    });

    framed(s, local("card-27.png"), 0.65, 3.35, 3.55, 845 / 508);
    txt(s, "訂閱後：「免費 · 有效至 2026/10/25」", {
      x: 0.6,
      y: 5.6,
      w: 3.7,
      h: 0.35,
      fontSize: 12,
      color: C.muted,
    });
    framed(s, local("card-31.png"), 4.6, 3.35, 3.55, 845 / 443);
    txt(s, "結束後：「已結束」＋「免費重新訂閱」", {
      x: 4.55,
      y: 5.35,
      w: 3.7,
      h: 0.35,
      fontSize: 12,
      color: C.muted,
    });

    const pts = [
      "按下就生效，不用付款、不用填信用卡",
      "服務一個月，期間內達標就通知",
      "到期自動結束並寄信告知",
      "取消會立即停止通知（不保留到到期日）",
      "已結束後可無限次免費重新訂閱",
    ];
    s.addText(
      pts.map((p, i) => ({ text: p, options: { bullet: true, breakLine: i < pts.length - 1 } })),
      {
        x: 8.7,
        y: 3.35,
        w: 4.05,
        h: 3.0,
        fontFace: FONT,
        fontSize: 14,
        color: C.text,
        margin: 0,
        paraSpaceAfter: 8,
        isTextBox: true,
        valign: "top",
      },
    );
    s.addNotes(
      "免費訂閱：按下立即生效；一個月到期自動結束；取消立即停止；已結束後可無限次免費重新訂閱。",
    );
  }

  // 8 — Emails you get
  {
    const s = base();
    header(s, "PART 2 ・ 功能介紹", "你會收到哪些信");
    const hdr = (t) => ({
      text: t,
      options: { bold: true, color: C.white, fill: { color: C.red } },
    });
    const rows = [
      [hdr("時機"), hdr("信件主旨")],
      ["訂閱成功", "✈️ 免費訂閱成功！台北 → 東京 降價通知已開始"],
      ["價格達標", "✈️ 台北 → 東京 降價通知！NT$x,xxx 已達標"],
      ["主動取消", "已取消 台北 → 東京 的降價通知訂閱"],
      ["一個月到期", "免費訂閱期已結束，附重新訂閱連結"],
    ].map((r, i) =>
      i === 0
        ? r
        : r.map((t, j) => ({
            text: t,
            options: { bold: j === 0, fill: { color: i % 2 ? C.card : "0A4247" } },
          })),
    );
    s.addTable(rows, {
      x: 0.6,
      y: 1.8,
      w: 6.2,
      colW: [1.5, 4.7],
      rowH: 0.62,
      fontFace: FONT,
      fontSize: 13,
      color: C.text,
      valign: "middle",
      border: { type: "solid", pt: 0.75, color: C.cardLine },
      margin: 0.1,
    });
    framed(s, shot("28-email-free-welcome.png"), 7.3, 1.8, 5.4, 2372 / 732);
    txt(s, "訂閱成功信", { x: 7.25, y: 3.58, w: 5.5, h: 0.3, fontSize: 12, color: C.muted });
    framed(s, shot("32-email-free-cancel.png"), 7.3, 4.2, 5.4, 2356 / 640);
    txt(s, "取消信", { x: 7.25, y: 5.75, w: 5.5, h: 0.3, fontSize: 12, color: C.muted });
    s.addNotes("一個月到期的信需等到期才會收到，這裡以文字說明。");
  }

  // 9 — Flow overview
  {
    const s = base();
    header(s, "PART 3 ・ 操作教學", "操作流程總覽");
    const steps = [
      ["註冊", "只要 email，從信中連結設定密碼"],
      ["登入", "進入 Dashboard"],
      ["開始追蹤", "選航線、輸入目標價，按「開始免費追蹤」"],
      ["收通知", "價格達標就寄 email 給你"],
      ["管理", "調整目標價、取消，或到期後重新訂閱"],
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

  // 10 — Step 1: sign up
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
        { text: "提醒：", options: { bold: true, color: C.red } },
        {
          text: "若這個 email 曾在同一帳號系統的其他服務註冊過，設定的新密碼也會成為那些服務的密碼（頁面上有提示）。",
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

  // 11 — Step 2: sign in / forgot
  {
    const s = base();
    header(s, "STEP 2", "登入與忘記密碼");
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
      {
        x: 6.85,
        y: 5.6,
        w: 5.9,
        h: 0.7,
        fontSize: 14,
      },
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

  // 12 — Step 3: start tracking
  {
    const s = base();
    header(s, "STEP 3", "開始免費追蹤");
    const steps = [
      ["輸入目標價", "在「來回目標價 TWD」輸入你的預算，例如 10000"],
      ["按「開始免費追蹤（一個月）」", "立即生效，並收到訂閱成功信"],
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
    framed(s, local("card-26.png"), 5.55, 1.85, 4.2, 845 / 397);
    txt(s, "▼", {
      x: 5.55,
      y: 3.98,
      w: 4.2,
      h: 0.35,
      fontSize: 14,
      align: "center",
      color: C.muted,
    });
    framed(s, local("card-27.png"), 5.55, 4.4, 4.2, 845 / 508);
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

  // 13 — Step 4: manage
  {
    const s = base();
    header(s, "STEP 4", "管理訂閱");
    const items = [
      [
        "調整目標價",
        "改數字後按「更新目標價」，立即生效。\n達標後不想每天收到提醒？把目標價調低到低於目前最低價，等真的再降才通知。",
      ],
      [
        "取消訂閱",
        "點「取消訂閱」→「確定要取消訂閱？取消後立即停止通知。」→「確定取消」或「保留」。",
      ],
      ["重新訂閱", "到期或取消後，卡片顯示「已結束」，按「免費重新訂閱」再開始一個月。"],
    ];
    const hs = [1.6, 1.45, 1.3];
    let y = 1.8;
    items.forEach(([head, body], i) => {
      card(s, 0.6, y, 7.2, hs[i]);
      txt(s, head, { x: 0.9, y: y + 0.18, w: 6.6, h: 0.4, fontSize: 17, bold: true, color: C.red });
      txt(s, body, {
        x: 0.9,
        y: y + 0.62,
        w: 6.6,
        h: hs[i] - 0.75,
        fontSize: 13.5,
        lineSpacingMultiple: 1.1,
      });
      y += hs[i] + 0.25;
    });
    framed(s, local("card-30.png"), 8.45, 1.8, 4.25, 845 / 568);
    framed(s, local("card-31.png"), 8.45, 4.85, 4.25, 845 / 443);
  }

  // 14 — Demo & FAQ
  {
    const s = base();
    header(s, "PART 4 ・ 收尾", "Demo 與常見問題");
    txt(s, "現場示範：註冊 → 設定密碼 → 登入 → 開始免費追蹤 → 收到訂閱成功信 → 取消", {
      x: 0.6,
      y: 1.5,
      w: 12.1,
      h: 0.4,
      fontSize: 14,
      color: C.muted,
    });
    const faq = [
      ["要錢嗎？", "目前免費，一次一個月，到期可無限次免費重新訂閱。"],
      ["多久查一次價？", "約每 30 分鐘。"],
      ["價格準嗎？", "來自訂票網站近期查詢，實際以訂購頁為準。"],
      ["一直降價會一直寄嗎？", "不會，最多約 24 小時一封；大幅再降才會提早通知。"],
      ["達標後每天都收到信？", "把目標價調低到真正想買的價格，或直接取消。"],
      ["信上的日期不適合？", "可在訂票頁調整日期比價，有機會仍在預算內。"],
      ["可以追蹤多條航線嗎？", "可以，每條航線各自訂閱。"],
      ["想要的航線沒有？", "目前先開 4 條，來信告訴我，我會依需求調整。"],
    ];
    faq.forEach(([q, a], i) => {
      const x = 0.6 + (i % 2) * 6.17;
      const y = 2.1 + Math.floor(i / 2) * 1.2;
      card(s, x, y, 5.97, 1.05, { noShadow: true });
      txt(s, q, {
        x: x + 0.25,
        y: y + 0.13,
        w: 5.5,
        h: 0.38,
        fontSize: 15,
        bold: true,
        color: C.red,
      });
      txt(s, a, { x: x + 0.25, y: y + 0.53, w: 5.5, h: 0.42, fontSize: 13 });
    });
    s.addNotes(
      "Demo 清單：事先確認網站處於免費模式（按鈕文字是「開始免費追蹤（一個月）」）；" +
        "事先準備一個已設定好密碼的帳號，避免現場等註冊信；" +
        "通知信無法保證現場觸發，準備事先收到的通知信截圖當備案；Demo 完記得取消 Demo 帳號的訂閱。",
    );
  }

  // 15 — Thanks
  {
    const s = base();
    txt(s, "謝謝！", { x: 0.6, y: 1.5, w: 7, h: 1.2, fontSize: 54, bold: true });
    txt(s, "立即試用", {
      x: 0.6,
      y: 3.0,
      w: 7,
      h: 0.4,
      fontSize: 16,
      bold: true,
      color: C.red,
      charSpacing: 2,
    });
    txt(s, "https://flights.roberthut.com/", {
      x: 0.6,
      y: 3.45,
      w: 7,
      h: 0.6,
      fontSize: 26,
      bold: true,
    });
    txt(s, "航線需求、問題與建議，都歡迎來信", {
      x: 0.6,
      y: 4.6,
      w: 7,
      h: 0.4,
      fontSize: 16,
      color: C.muted,
    });
    txt(s, "Robert ｜ robertkao5656@gmail.com", {
      x: 0.6,
      y: 5.05,
      w: 7,
      h: 0.5,
      fontSize: 20,
      bold: true,
    });
    card(s, 8.6, 1.45, 3.9, 4.5, { fill: "FFFFFF", line: "FFFFFF" });
    s.addImage({
      path: local("qr.png"),
      x: 8.95,
      y: 1.75,
      w: 3.2,
      h: 3.2,
      altText: altOf("qr.png"),
    });
    txt(s, "手機掃描開啟", {
      x: 8.6,
      y: 5.2,
      w: 3.9,
      h: 0.4,
      fontSize: 15,
      bold: true,
      align: "center",
      color: C.bg,
    });
  }

  await pres.writeFile({ fileName: OUT });
  console.log("wrote", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
