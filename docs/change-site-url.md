# 更換網站網址（改用公司網域）檢查清單

把前端從 `https://fare-finder-pro.vercel.app` 換成公司網域（下文以 `https://flights.yourco.com` 代稱）時，**不會自動跟著改**的地方都列在這裡。信件裡的網址、付款後導回的網址都不是從瀏覽器當下的網址抓的，而是來自 Edge Function secret 或程式碼裡的清單。

最後整理：2026-09-25。

> **2026-09-25 實際換成 `https://flights.roberthut.com`**：Vercel 網域與 DNS 已生效（CNAME 到 Vercel）；第 4 項已把新網域加進 `ALLOWED_ORIGINS`（舊的 Vercel 網址保留並存）；本專案所有 Edge Function 都是 flight 的，`send-email` 也不讀 `SITE_URL`，改 secret 不影響其他 app。同日已完成：`SITE_URL` 改為新網域、重新部署 `flight-subscribe` 與 `flight-ecpay-result`、Supabase Auth Redirect URLs 加上 `https://flights.roberthut.com/**`（Site URL 未動）。curl 檢查 `flight-ecpay-result`：沒帶 origin 或帶不在清單上的 origin 都導向 `https://flights.roberthut.com/dashboard`，帶 Vercel 網址則導回 Vercel。實際在新網域註冊與付款的驗證尚未做。

## 必改

### 1. Edge Function secret `SITE_URL`

```sh
supabase secrets set SITE_URL=https://flights.yourco.com
```

- 設定後立即生效，不需要重新部署 function。
- 影響範圍：
  - `flight-status-notification`：狀態通知信裡「重新訂閱」的連結 `${SITE_URL}/dashboard`，涵蓋到期信（expired）等（`supabase/functions/flight-status-notification/index.ts` 的 `SITE_URL`）。未設定時信裡就不放連結。
  - `flight-ecpay-result`：ECPay 付款完成後把使用者導回 `<origin>/dashboard?purchase=…`，拿不到可用的 origin 時就退回用 `SITE_URL`（`supabase/functions/_shared/ecpay.ts`）。未設定時預設是 `http://localhost:8080`。
- ⚠️ Supabase 專案是多個 app 共用的（見 `docs/shared-supabase-auth.md`），secret 是整個專案共用。改之前先確認其他 app（`project-management`、`udemy-coupon`）的 Edge Functions 沒有讀 `SITE_URL`，否則會一起被改掉。
- 另外，Supabase Dashboard 上 Auth 的「Site URL」是另一個設定，跟這個 secret 無關（見下一項）。

### 2. Supabase Auth 的 URL 設定

Supabase Dashboard → Authentication → URL Configuration：

- **Redirect URLs** 加上 `https://flights.yourco.com/**`。註冊驗證信、密碼重設信的 `redirect_to` 是依使用者當下瀏覽器的 origin 產生的（`src/routes/auth/index.tsx` 的 `emailRedirectTo: ${origin}/?app=…`）；這個 origin 不在清單上，Supabase 就會拒絕導回，改用 Site URL。
- **Site URL**：這是多 app 共用的設定，別隨意改成 flight 專用網域，除非確定其他 app 不依賴它。

### 3. Vercel 網域

- 在 Vercel 專案的 Settings → Domains 加上公司網域，公司 DNS 依 Vercel 指示設定 CNAME 或 A record。
- Vercel 的環境變數（`VITE_SUPABASE_URL`、`SUPABASE_URL` 等）指向的是 Supabase，**不用改**。

## 建議改（兩個網域並存時必改）

### 4. 付款導回的 origin 允許清單

`supabase/functions/_shared/ecpay.ts` 的 `ALLOWED_ORIGINS`（目前寫死了 `http://localhost:8080` 和 `https://fare-finder-pro.vercel.app`）：

- `SITE_URL` 本身一律在清單裡，所以如果只剩公司網域一個站，做完第 1 項就夠了。
- 如果新舊網域要並存一段時間，或另外有 `www.` 等變體，就要把它們加進清單，然後重新部署有 import 這支檔案、而且會用到清單的 function：

  ```sh
  supabase functions deploy flight-subscribe --use-api
  supabase functions deploy flight-ecpay-result --use-api --no-verify-jwt
  ```

- 這個 endpoint 沒有 JWT，**不在清單上的 origin 絕對不能導過去**；不要改成允許任意 origin。

## 不用改

- **降價通知信**（`flight-notification`）：信裡沒有連回網站的連結。
- **Auth 信件 hook**（`send-email`）：依 `redirect_to` 的 `?app=` 判斷是哪個 app，跟網域無關（程式碼註解寫明 domain-independent）。
- **ECPay 的回呼網址**（ReturnURL、PeriodReturnURL、OrderResultURL）：指向的是 Supabase Edge Function 的網址，不是前端網域。
- **前端程式碼**：用 `window.location.origin` 動態取網址，沒有寫死網域。

## 選擇性：寄件人網域

三支寄信的 function 都寫死寄件人 `noreply@roberthut.com`：

- `supabase/functions/flight-notification/index.ts`
- `supabase/functions/flight-status-notification/index.ts`
- `supabase/functions/send-email/index.ts`：`APPS` 裡 flight 那一筆。同一個檔案裡也有其他 app 的寄件人，不要動到。

如果要改成公司網域寄信，必須先在 Resend 驗證公司網域（SPF／DKIM），再改上面三個檔案並重新部署。這跟換網站網址可以分開做。

## 換完後的驗證

1. 在新網域註冊一個測試帳號，確認驗證信的連結會導回新網域。
2. 在新網域走一次 ECPay stage 付款，確認付款後回到 `https://flights.yourco.com/dashboard?purchase=success`。
3. 觸發一封狀態信（例如用免費模式訂閱後再取消，或等一筆訂閱到期），確認信裡的「重新訂閱」連結是新網域。
4. 用 `supabase secrets list --output json` 確認 `SITE_URL` 有在清單裡。只看名稱就好，不要把值貼出來。
