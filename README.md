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

### 驗證信 / SMTP

這個 app 使用 Supabase 內建的 email/password 驗證（`src/routes/auth.tsx` 裡的 `signUp` / `signInWithPassword`），會寄出帳號驗證信跟密碼重設信。這些信實際從哪裡寄出，取決於這個 Supabase 專案是怎麼建立的：

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
   - Site URL 設成 `http://localhost:8080`（開發環境），正式上線後加正式網域
   - Redirect URLs 也要加上，確保 `emailRedirectTo` 能正確跳轉

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
