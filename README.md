# Fare Finder Pro

Build a SaaS landing page + authenticated app shell for Flight Price Notifier
(機票降價通知), a product that watches popular flight routes from Taipei and
emails the user when the cheapest fare drops to or below their target price —
targeted at budget-driven travelers who don't care exactly when they fly,
they just want a ticket under their budget.

The site must include:

A public landing page (/) with:

Hero section: product name "Flight Price Notifier" prominently displayed,
value prop 「設定航線與目標價，機票降價就通知你」(English subtitle: "Set a
route and a target price — we email you when the fare drops."), and a
primary CTA button labeled "Sign in / 登入" in the top-right header.

Three feature cards below the hero, each with an icon, a Chinese title, an
English subtitle, and a one-line Chinese description:

Card 1: ✈️ icon — "盯緊熱門航線" / "Always-on route watching" —
"持續監控台北出發的熱門航線（東京、首爾），自動抓最低票價。"

Card 2: 🔔 icon — "達標自動通知" / "Target-price email alerts" —
"低於你設定的目標價，就寄 email 提醒你，附上立即訂購連結。"

Card 3: 🚫 icon — "隨時取消" / "Cancel anytime" —
"月訂閱制，不想用隨時停，沒有綁約。"

A simple footer with "© 2026 Flight Price Notifier".

An authenticated area with a /auth page (Supabase email/password auth):

Heading "Welcome back．登入", subtitle "Sign in to manage your fare alerts.",
Email field (placeholder "you@example.com") and Password field, a primary
button "Sign in / 登入", and a toggle link "No account yet? Create one" to
switch to sign-up mode.

After signing in, redirect to a placeholder dashboard page.

Style requirements:

Modern, professional dark theme (purple/violet accent on a near-black
background)

Use Inter or a similar sans-serif font

Mobile responsive

Tasteful subtle animations (fade-in on scroll is fine; don't overdo it)

Out of scope for this v1: route-subscription form, target-price input, fare
display, payment, custom database tables (do NOT create a subscriptions or
profiles table — only use Supabase's default auth.users). Those come in
later milestones. Stick to landing page + auth + placeholder dashboard.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/af862599-b4ef-40b5-8a32-d691b3297b52).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## 環境變數設定（Supabase）

本機（`.env`）跟 Vercel（Project Settings → Environment Variables）**要設定完全一樣的變數**，沒有差別——本機開發跟正式部署走的是同一套讀取邏輯，缺一個都會壞。

### `.env` 是怎麼被讀取的

專案本身**沒有任何一行程式碼**決定要讀 `.env`——這是兩個底層工具各自內建的預設慣例，這個 repo 只是照著預設值走，沒有客製化過：

- **前端 `VITE_*` 變數（`import.meta.env`）**：`vite.config.ts` 透過 `@lovable.dev/vite-tanstack-config` 這個 wrapper 呼叫 Vite 官方的 `loadEnv(mode, process.cwd(), "VITE_")`。Vite 內建的 `loadEnv()` 寫死了要找 `.env` / `.env.local` / `.env.[mode]` / `.env.[mode].local` 這幾個檔名（專案根目錄下）——只要是 Vite 專案就是這個慣例。
- **伺服器端不帶前綴的變數（`process.env`，SSR / middleware 用，見 `src/integrations/supabase/client.server.ts`、`auth-middleware.ts`）**：由 TanStack Start 的伺服器建置目標 **Nitro** 負責，dev 模式下預設也是讀 `.env` / `.env.local`，用 `dotenv` 套件寫進真正的 `process.env`。

兩邊剛好都預設抓 `.env`，所以本機開發只需要維護一份 `.env` 檔案即可同時餵給前端跟伺服器端程式碼。

### 需要哪些變數

| 變數名稱 | 誰會讀 | 用來做什麼 | 值哪裡拿 |
|---|---|---|---|
| `VITE_SUPABASE_URL` | 瀏覽器（前端） | 連線 Supabase | Supabase Dashboard → Project Settings → API |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | 瀏覽器（前端） | 公開金鑰，登入/查資料用 | 同上（`anon` / `publishable` key） |
| `SUPABASE_URL` | 伺服器（SSR / middleware） | 連線 Supabase | 跟 `VITE_SUPABASE_URL` **同一個值** |
| `SUPABASE_PUBLISHABLE_KEY` | 伺服器（SSR / middleware） | 公開金鑰 | 跟 `VITE_SUPABASE_PUBLISHABLE_KEY` **同一個值** |
| `SUPABASE_SERVICE_ROLE_KEY` | 伺服器（`client.server.ts` 的 admin client） | 繞過 RLS 的管理員操作 | Supabase Dashboard → API → `service_role` key（機密！） |

前 4 個一定要設；第 5 個只有用到 `supabaseAdmin`（管理員權限操作）的功能才需要，沒用到也建議先設好備用。

### 為什麼同一組值要存兩份（`VITE_` 前綴 vs 沒有）

不是本機才需要、Vercel 不需要——**兩邊都需要這兩組**。原因是這個 app 的程式碼同時跑在瀏覽器端和伺服器端：

- **`src/integrations/supabase/client.ts`（瀏覽器端）** 只能讀到 `import.meta.env['VITE_SUPABASE_URL']` 這種 `VITE_` 開頭的變數——Vite 建置時只會把 `VITE_` 前綴的值打包進瀏覽器看得到的 JS 檔案。
- **`src/integrations/supabase/auth-middleware.ts`、`client.server.ts`（伺服器端）** 讀的是沒有前綴的 `process.env['SUPABASE_URL']`，Vite 不會處理這些變數，只有 Node.js 伺服器能讀到。

這是 Vite 的安全邊界設計：**如果變數加了 `VITE_` 前綴，就等於公開給任何打開瀏覽器 devtools 的人看**。所以命名上刻意分兩組，逼你想清楚「這個值能不能給瀏覽器看」——公開金鑰（`PUBLISHABLE_KEY`）兩邊用同一個值沒差，但 `SUPABASE_SERVICE_ROLE_KEY` **絕對不能**加 `VITE_` 前綴，一旦加了就會外洩到前端，任何人都能拿這把 key 繞過權限直接讀寫你整個資料庫。

理論上你也可以只設一組、兩邊共用同一個變數名稱，但這份程式碼選擇分開命名是為了用命名規則強制區分「前端可見」跟「僅伺服器可見」。

### 兩組值必須指向同一個 Supabase 專案

如果 `VITE_` 那組和沒前綴那組指到不同專案（例如 `SUPABASE_PROJECT_ID` 兜不起來），瀏覽器端登入用的專案會跟伺服器端驗證的專案不一致，導致帳號明明存在卻登入失敗——症狀看起來像「密碼錯誤」，實際上是專案設定對不上。

### 在 Vercel 設定

Vercel Dashboard → 專案 → **Settings** → **Environment Variables**，把上面表格的 5 個變數逐一加入（或用 CLI：`vercel env add VITE_SUPABASE_URL`）。改完環境變數要**重新部署**（`vercel --prod` 或在 Dashboard 點 Redeploy）才會生效，跟本機改 `.env` 要重啟 dev server 是同一個道理。

修改本機 `.env` 之後也需要重啟 dev server（`npm run dev`）——Vite 只在啟動時讀取 env 檔案，不支援 HMR 熱更新。

### Redirect URLs（驗證信連結導向白名單）

**Authentication → URL Configuration** 這頁的 **Site URL** 跟 **Redirect URLs**，決定使用者點了驗證信/密碼重設信裡的連結之後，最終會被導去哪個網址。這跟用哪家 SMTP、哪個寄信方案（內建 / Resend SMTP / Send Email Hook）都無關，是所有寄信方式共用的同一層機制，設錯的話驗證信連結永遠導不回正確的地方。

**運作機制：**

`src/routes/auth/index.tsx` 裡呼叫 `signUp()` 時：
```ts
options: { emailRedirectTo: window.location.origin }
```
`window.location.origin` 是「使用者按下註冊那一刻，瀏覽器網址列的 origin」——不是寫死的，是動態抓的。這個值會直接塞進 Supabase 產生的驗證信連結（`redirect_to` 參數）裡。

Supabase 收到這個值後只做一件事：**比對白名單**：

- 這個網址等於 **Site URL**，或有被 **Redirect URLs** 清單裡的某一條規則匹配到 → 照這個網址做成信件連結，使用者點了就導去那裡。
- 兩者都沒匹配到 → **沒收、丟棄**這個網址，強制改用 **Site URL** 當導向目的地（不會報錯，是靜默降級）。

也就是說：同一支 app、不同網址觸發註冊（本機 / 正式站 / Vercel preview），會產生內容不同的驗證信連結，是前端動態抓網址造成的，不是 Supabase 自己判斷的；Supabase 只負責擋掉不在白名單裡的目的地。

**目前正式配置：**

```
Site URL: https://fare-finder-pro.vercel.app

Redirect URLs:
https://fare-finder-pro.vercel.app/**
https://fare-finder-pro-*-roberts-projects-2b1cd09b.vercel.app/**
http://localhost:8080/**
```

| 設定 | 涵蓋場景 | 為什麼需要 |
|---|---|---|
| `Site URL: https://fare-finder-pro.vercel.app` | 正式站主網域 + 保底目的地 | 唯一的「預設/保底」網址；沒有明確匹配到任何 Redirect URLs 時，一律退回這裡 |
| `https://fare-finder-pro.vercel.app/**` | 正式站上任何路徑觸發的驗證 | 只設 Site URL 本身不涵蓋「帶路徑或參數」的情況（例如 `/dashboard`、`?ref=xxx`），`/**` 萬用字元讓同網域下任何路徑都算合法目的地 |
| `https://fare-finder-pro-*-roberts-projects-2b1cd09b.vercel.app/**` | Vercel 每次 PR / 分支自動產生的 preview 網址（如 `fare-finder-2r1ppz0jz-roberts-projects-2b1cd09b.vercel.app`） | 這些網址每次部署都不同、帶隨機 hash，不可能一條一條加；用 `*` 卡住中間隨機那段，讓任何 preview 部署上測註冊流程都能正常導回同一個 preview |
| `http://localhost:8080/**` | 本機開發測試（`npm run dev` 實際跑的 port） | 讓本機開發也能完整測完整個註冊/驗證流程，不用每次都部署到 Vercel 才能測；是 **8080**，不是 Lovable 預覽環境殘留的 **3000**（那個 port 跟這個專案的 vite dev server 無關） |

**常見症狀**：Site URL/Redirect URLs 沒設對時，驗證信連結點下去會出現 `#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`，或是明明驗證成功卻被導回一個打不開的網址（例如導回 `localhost:3000`，但使用者電腦上根本沒在跑那個 port）。

### 共用 Supabase 專案的跨 app 登入隔離慣例

這個 Supabase 專案的 `auth.users` **被多個不相關的 app 共用**（同一個 project URL / anon key，其他 app 也在用）。如果之後要再開一個新 app 用同一個 Supabase 專案，且同樣需要「使用者要嘛完全獨立、要嘛能跨 app 共用同一組密碼但要各自明確加入」這種需求，直接沿用這裡已經建好的機制即可，不要重新發明一套。

**機制本身記錄在資料庫裡，這才是權威來源**：`supabase/migrations/20260904120000_flight_app_scoped_auth.sql` 建立了一個 Postgres trigger `flight.tag_app_metadata_on_signup()`，這個函式上有 `comment on function ... is '...'`，任何人（或任何一個新專案的 Claude Code session）在動手設計新 app 的登入邏輯之前，只要先查一下 `auth.users` 上有哪些現有 trigger：

```sql
SELECT tgname, proname, pg_get_functiondef(tgfoid)
FROM pg_trigger
JOIN pg_proc ON pg_proc.oid = pg_trigger.tgfoid
WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal;
```

就會直接看到這段說明，裡面寫明了怎麼沿用。這份 README 只是把同一件事寫成比較完整的敘述版本。

**運作原理**：

1. 前端呼叫 `supabase.auth.signUp()` 或 `supabase.auth.updateUser()` 時，帶上 `options: { data: { app: '<你的 app 名稱>' } }`。
2. 這個 trigger 會把 `raw_user_meta_data.app` 這個（使用者可自行修改的）暫存值，promote 進 `raw_app_meta_data.apps`（一個去重的 JSON 陣列，`app_metadata` 使用者端無法竄改）。
3. 每個 app 自己的登入邏輯，檢查 `user.app_metadata.apps` 裡有沒有包含**自己的 app 名稱**（字串必須跟自己傳的完全一致，且不能跟其他 app 撞名）。這個 repo 的參考實作在 `src/routes/auth/index.tsx`（`APP_NAME` 常數定義在 `src/integrations/supabase/app-scope.ts`）跟 `src/routes/_authenticated/route.tsx`。

**這個 trigger 完全通用、不用改就能給新 app 用**——它不檢查 app 名稱是什麼字串，純粹「有傳就記錄」。新 app 只要：

- 自己的程式碼傳自己專屬的 `app` 名稱（不要跟 `"fare-finder-pro"` 撞名）
- 自己的登入頁自己判斷 `apps` 陣列裡有沒有那個名稱
- **不需要**再建立任何新的 migration / trigger

**所有共用這個 Supabase 專案的 app，一律採用「嚴格隔離」設計**（登入頁只認已經標記過的帳號，密碼對但沒標記一律拒絕；要加入某個 app,只能透過那個 app 自己的註冊流程,見上面「Redirect URLs」章節前後的討論）。不要實作「密碼對就自動加入」（在登入頁 `apps` 沒命中時自動呼叫 `updateUser({ data: { app } })` 補標記）——這會讓任何知道某帳號密碼的人，都能讓那個帳號自動取得你的 app 的存取權。新 app 一律沿用同一種規則，不要各自發明變體。

「透過 app 自己的註冊流程加入」實際上有兩種合法路徑，差別在誰觸發：使用者自己走 signup（email 已被別的 app 註冊時導去密碼重設流程，驗證信箱身份後才補標記——本 repo `src/routes/auth/index.tsx`、`src/routes/auth/reset.tsx` 走這條），或是管理員在自己 app 後台建帳號時撞到既有 email（`auth.admin.createUser()` 對已存在的 email 一定失敗，這時改成「掛靠既有身份」：不建新帳號、不改密碼，把自己的 app 名稱**合併**進 `app_metadata.apps`，用 spread 保留其他 app 既有的標記，不要整個覆寫掉；參考實作見 `web_project_management` repo 的 `app/(protected)/users/new/actions.ts` 的 `linkExistingAccountToThisApp()`）。兩種都合法，因為都是使用者本人或管理員明確採取了一個動作才加入，跟「密碼對就自動加入」性質不同。

**不要修改別人的**：`public.handle_new_user()` / `public.profiles`（`on_auth_user_created` trigger）是另一個既有 app（`project-management`）的員工資料表，新 app 不應該去編輯它的程式碼。但它**不是**跟這個機制無關——`auth.users` 上任何一個 trigger 都會對所有共用這個 project 的 app 的 signup 觸發，不只是建立它的那個 app。這不是假設性風險：`project-management` 的 `handle_new_user()` 原本沒做 app 過濾，對每一筆從 flight 註冊的帳號都無條件建立一筆 `public.profiles`、白佔一個員編，導致 flight 帳號雖被登入頁擋下，卻污染了 project-management 的使用者清單；後來用 `supabase/migrations/20260906000001_scope_handle_new_user_to_app.sql` 修掉，經過記在 `web_project_management` repo 的 `docs/migrations_overview.md` Phase 7。**如果你自己的 app 也要在 `auth.users` 掛 provisioning trigger**，動手前一定要先判斷 `new.raw_app_meta_data -> 'apps'` 有沒有含自己的 app 名稱，沒有就直接 `return new` 跳過副作用——不要假設別的 app 建的帳號不會經過你的 trigger。

#### 幫「既有、已經有真實使用者」的舊 app 套用這套規則

上面講的都是假設新 app 是從零開始、還沒有任何使用者。如果是要幫**已經上線、已經有真實使用者在用**的舊 app（例如 `public.profiles` 那個員工系統）補上這套隔離機制，多一個關鍵風險：**那個系統現有的每一個帳號，`app_metadata.apps` 目前都還是空的**（這個機制是這次才發明的，舊帳號從來沒被標記過）。如果直接照抄「登入頁只認 `apps` 裡已標記的帳號」這條規則上線，會讓那個系統**現有所有使用者瞬間全部登入失敗**。

套用順序必須是：

1. **先批次補標記**：對那個系統目前所有現有帳號，一次性把它們的 `app_metadata.apps` 補上該 app 自己的名稱（例如 `"project-management"`），示意 SQL：
   ```sql
   update auth.users
   set raw_app_meta_data =
     coalesce(raw_app_meta_data, '{}'::jsonb)
     || jsonb_build_object(
       'apps',
       coalesce(raw_app_meta_data -> 'apps', '[]'::jsonb) || to_jsonb('project-management'::text)
     )
   where id in (select id from public.profiles);
   ```
   （示意用法，實際要不要用 `public.profiles` 的 id 清單去對應 `auth.users`，依那個系統實際的關聯方式調整。）
2. **確認補標記正確無誤後，才**在那個 app 的登入邏輯加上跟本專案一樣的 `apps.includes('project-management')` 檢查。
3. **順序不能顛倒**——先加檢查、後補標記，會讓所有使用者在中間那段空窗期完全登不進去。上線前務必先在一、兩個測試帳號上驗證「補標記 → 能正常登入」，確認無誤再對全部帳號執行。

### 驗證信 / SMTP

這個 app 使用 Supabase 內建的 email/password 驗證（`src/routes/auth/index.tsx` 裡的 `signUp` / `signInWithPassword`），會寄出帳號驗證信跟密碼重設信。這些信實際從哪裡寄出，取決於這個 Supabase 專案是怎麼建立的：

- **透過 Lovable Cloud 建立的專案**：寄信會走 Lovable 自己的預設寄件通道,而不是 Supabase 內建的 SMTP。要用自訂寄件網域（例如 `noreply@yourdomain.com`）,需要在 Lovable 那邊設定（Email Domain 設定）,不是在 Supabase 裡設。
- **獨立的 Supabase 專案**（直接在 supabase.com 開的,沒有連結 Lovable）：Lovable 完全看不到、也管不到這個專案。寄信行為會回到 Supabase 原生預設——如果沒設自訂 SMTP,就是用 Supabase 內建的寄件服務,這個內建服務有嚴格的流量限制,只適合測試,不適合正式環境使用。

如果專案不是由 Lovable 管理，要在 Supabase Dashboard → Authentication → SMTP Settings 自己設定 Custom SMTP。以下是服務商比較：

| 服務商 | 免費額度 | 設定難度 | 備註 |
|---|---|---|---|
| **Resend**（推薦） | 3,000 封/月、100 封/天 | 最簡單——Supabase 官方推薦的整合方式,API key 當 SMTP 密碼即可,只需加幾筆 DNS 記錄驗證自訂網域 | 開發者體驗最好：Dashboard 簡潔,有寄送紀錄可查退信原因。對這種低流量的驗證信/密碼重設信用途綽綽有餘。 |
| SendGrid | 100 封/天 | 設定介面較複雜 | 功能更完整（分析、範本）——流量更大或需要行銷信功能時比較划算,單純寄驗證信用它有點大材小用。 |
| Amazon SES | 幾乎免費 | 預設是 sandbox 模式,要先申請 AWS「production access」才能寄給任意收件人 | 大流量時最便宜,但 sandbox 審核這道門檻對非 AWS 使用者來說較麻煩,除非你本來就在用 AWS 生態圈。 |

SMTP 欄位設定範例（以 Resend 為例）：

```
Host:     smtp.resend.com
Port:     587
Username: resend
Password: <你的 Resend API key>
Sender:   noreply@yourdomain.com  (必須是在 Resend 驗證過的網域)
```

### 設定 Resend（完整步驟）

適用於獨立的 Supabase 專案（不經過 Lovable 管理）。

1. **註冊 Resend 帳號**
   前往 [resend.com](https://resend.com) 註冊（可用 GitHub/Google 快速登入）。

2. **驗證寄件網域**
   - Resend Dashboard → **Domains** → **Add Domain**
   - 輸入要用來寄信的網域（例如 `yourdomain.com`）
   - Resend 會給幾筆 DNS 記錄（通常是 SPF、DKIM，有時還有 DMARC，格式是 TXT/CNAME）
   - 到網域的 DNS 服務商（Cloudflare、GoDaddy、Namecheap…）把記錄加進去
   - 回 Resend 按 **Verify**——DNS 生效通常幾分鐘到最多 24 小時
   - 沒有自己網域的話可先用 Resend 提供的測試網域做開發測試，但正式上線前必須驗證自己的網域

3. **取得 API Key**
   - Resend Dashboard → **API Keys** → **Create API Key**
   - 命名（例如 `supabase-smtp`），權限選 **Sending access** 即可
   - 建立後立即複製這串 key（只會顯示一次）

4. **在 Supabase Dashboard 設定 SMTP**
   - 登入 [supabase.com](https://supabase.com/dashboard) → 選對應專案
   - **Authentication** → **Emails** → **SMTP Settings**
   - 打開 **Enable Custom SMTP**，填入：

   | 欄位 | 值 |
   |---|---|
   | Sender email | `noreply@yourdomain.com`（須為已驗證網域） |
   | Sender name | 例如 `Flight Price Notifier` |
   | Host | `smtp.resend.com` |
   | Port | `587` |
   | Username | `resend`（固定字串，不是帳號） |
   | Password | 剛複製的 Resend API Key |

   - 存檔

5. **測試**
   - 在 app（例如 `http://localhost:8080/auth`）用新 email 註冊
   - 檢查是否收到驗證信，寄件人應顯示為設定的 `noreply@yourdomain.com`
   - 可到 Resend Dashboard → **Logs** 查看寄送狀態（成功/退信/延遲）

6. **順便確認 Redirect URL**
   - **Authentication** → **URL Configuration**
   - 詳見下方「[Redirect URLs（驗證信連結導向白名單）](#redirect-urls驗證信連結導向白名單)」章節

> **注意：** 上面第 4 步的傳統 SMTP 表單（填 host/port/user/password）目前只開放給
> **Pro 方案**。免費方案（Free tier）在 Supabase Dashboard 的 SMTP 設定頁只會看到
> 兩個選項：**Upgrade to Pro** 或 **Configure Send Email Hook**。不想付費升級的話，
> 走下面的 Send Email Hook 方案。

### `config.toml` 的作用

`supabase/config.toml` 是 Supabase CLI 的本機設定檔，主要功能：

- 記錄這個 repo 目錄跟哪個 Supabase 遠端專案「連結」（`project_id`），讓你在本機
  執行 `supabase` CLI 指令時（例如 `supabase functions deploy`、`supabase db push`、
  `supabase secrets set`）知道要操作哪個雲端專案。
- 它**不會**被你的 app 在 runtime 讀取——app 實際連線 Supabase 用的是 `.env` 裡的
  `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY`（跟 `VITE_` 版本），這兩者是完全獨立
  的機制。
- 換句話說：`.env` 決定「app 程式碼」連去哪個 Supabase 專案；`config.toml` 決定
  「CLI 工具」部署 Edge Function/跑 migration 時操作哪個 Supabase 專案。兩邊理論上
  該指向同一個專案（我們剛才就是把它從 Lovable 的 `laskkifcrlvvbddhlhym` 改成你現在
  用的 `luugfvsrawnuzwpjvddt`，讓兩邊一致）。

### 免費方案替代做法：Send Email Hook

不升級 Pro、免費方案也能用 Resend 寄信的做法：寫一個 Supabase Edge Function 攔截
Auth 的寄信動作，改成呼叫 Resend 的 API（不是走 SMTP 協定）寄出。

程式碼已放在 `supabase/functions/send-email/index.ts`。

1. **安裝 Supabase CLI**（如果還沒裝）
   ```sh
   npm install -g supabase
   ```

2. **登入並 link 專案**
   ```sh
   supabase login
   supabase link --project-ref luugfvsrawnuzwpjvddt
   ```
   （`supabase/config.toml` 裡的 `project_id` 已經指向這個專案）

3. **設定 Edge Function 用到的環境變數**
   ```sh
   supabase secrets set RESEND_API_KEY=<你的 Resend API key>
   ```
   `SEND_EMAIL_HOOK_SECRET` 留到第 5 步，從 Dashboard 建立 hook 後才會拿到。

4. **部署 Edge Function**
   ```sh
   supabase functions deploy send-email --no-verify-jwt
   ```
   `--no-verify-jwt` 是必要的——這個 endpoint 是給 Supabase Auth 服務呼叫的 webhook，
   不是給一般使用者帶 JWT 呼叫的 API。

5. **在 Dashboard 註冊 Send Email Hook**
   - **Authentication** → **Hooks** → 找到 **Send Email**
   - Hook type 選 **HTTPS**，URL 填剛部署好的 Edge Function URL
     （格式：`https://<project-ref>.supabase.co/functions/v1/send-email`）
   - 建立後 Supabase 會顯示一組 Signing Secret（格式 `v1,whsec_...`）
   - 把這組值設回 CLI：
     ```sh
     supabase secrets set SEND_EMAIL_HOOK_SECRET=<剛顯示的 secret>
     ```

6. **記得改寄件人網域**
   `supabase/functions/send-email/index.ts` 裡的 `SENDER` 常數目前是佔位符
   （`noreply@yourdomain.com`），要換成第 2 步在 Resend 驗證過的實際網域。

7. **測試**
   - 在 app 用新 email 註冊，確認收到信、Resend Dashboard 的 Logs 有出現這筆寄送紀錄
   - 若失敗，先看 Supabase Dashboard → **Edge Functions** → `send-email` 的 log，
     常見錯誤是 hook secret 沒對上，或 Resend 網域還沒驗證完成
