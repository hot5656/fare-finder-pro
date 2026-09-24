# 共用 Supabase 專案的跨 app 登入慣例

給任何要接進**同一個 Supabase 專案**的新 app（或新 app 的 Claude Code session）看的精簡版。完整背景與設計討論見 [`fare-finder-pro` repo 的 README](https://github.com/hot5656/fare-finder-pro/blob/main/README.md#共用-supabase-專案的跨-app-登入隔離慣例)（trigger 的權威定義：`supabase/migrations/20260904120000_flight_app_scoped_auth.sql`）。

## 背景

這個 Supabase 專案的 `auth.users` 被多個不相關的 app 共用（同一個 project URL / anon key）。新 app 如果同樣需要「使用者要嘛完全獨立、要嘛能跨 app 共用同一組密碼但要各自明確加入」這種需求，**直接沿用這裡已經建好的機制即可，不要重新發明一套**，也**不需要**建立任何新的 migration / trigger。

## 權威來源：先查資料庫，不要只信文件

機制本身記錄在資料庫裡，這才是權威來源。動手設計新 app 的登入邏輯之前，先查一下 `auth.users` 上有哪些現有 trigger：

```sql
SELECT tgname, proname, pg_get_functiondef(tgfoid)
FROM pg_trigger
JOIN pg_proc ON pg_proc.oid = pg_trigger.tgfoid
WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal;
```

會看到 `flight.tag_app_metadata_on_signup()` 這個 trigger function，上面的 `comment on function ...` 就寫明了用法。這份文件只是把同一件事寫成完整敘述版。trigger 的原始定義（權威版本）維護在 `fare-finder-pro` repo 的 `supabase/migrations/20260904120000_flight_app_scoped_auth.sql`，**不需要**、也**不應該**在新 app 的 repo 裡重新建立或複製這支 migration。

## 運作原理

1. 前端呼叫 `supabase.auth.signUp()` 或 `supabase.auth.updateUser()` 時，帶上 `options: { data: { app: '<你的 app 名稱>' } }`。
2. 既有的 trigger 會把 `raw_user_meta_data.app`（使用者可自行修改的暫存值）promote 進 `raw_app_meta_data.apps`（一個去重的 JSON 陣列）。用戶端不能直接寫 `app_metadata`，但這個值是從使用者可自行修改的 `raw_user_meta_data.app` 複製過來的，所以 **`apps` 本質上是使用者自己宣告的標籤，不是權限**，見下方「標籤是什麼、不是什麼」。
3. 你的 app 自己的登入邏輯，檢查 `user.app_metadata.apps` 裡有沒有包含**自己的 app 名稱**（字串必須跟自己傳的完全一致，且不能跟其他 app 撞名）。

這個 trigger 完全通用、不用改就能給新 app 用——它不檢查 app 名稱是什麼字串，純粹「有傳就記錄」。新 app 只要：

- 自己的程式碼傳自己專屬的 `app` 名稱（不要跟現有 app，例如 `"fare-finder-pro"`，撞名）
- 自己的登入頁自己判斷 `apps` 陣列裡有沒有那個名稱
- **不需要**再建立任何新的 migration / trigger

參考實作（`fare-finder-pro` repo）：`src/integrations/supabase/app-scope.ts`（`APP_NAME` 常數）、`src/routes/auth/index.tsx`、`src/routes/_authenticated/route.tsx`。

### 標籤是什麼、不是什麼

- **是**：前端路由守衛用的「這個帳號說自己用這個 app」標記，用來決定登入頁要不要放行。
- **不是**：資料存取權限。任何已登入的使用者都可以呼叫 `updateUser({ data: { app: '<任何 app 名稱>' } })` 幫自己加上標籤（已在資料庫層驗證：trigger 會照單全收）。
- **所以**：RLS policy、SQL function、Edge Function 都**不可以**依賴 `apps` 來授權。資料權限要用 `auth.uid()`（如 flight 的 RLS policy），或另建伺服器端白名單。真正的存取控制是 `docs/m1-session-handoff.md` 的 backlog **B-1**，尚未實作。

### Claude Code 要怎麼看到 `fare-finder-pro` 這個 repo？

新 app 的 Claude Code session 預設只看得到自己的工作目錄，不會自動知道 `fare-finder-pro` repo 在哪、也不會主動去讀別的專案。三種取得方式：

1. **同機器直接用絕對路徑讀**（最簡單，前提是兩個 repo 剛好都 checkout 在同一台機器上）：Read 工具可以讀機器上任何路徑，不限於目前工作目錄。例如：
   ```
   /Users/gaoyiping/work/claude/fare-finder-pro
   ```
   換一台機器就不適用。
2. **GitHub（`hot5656/fare-finder-pro`）**：如果是 private repo 且該機器 `gh` CLI 已登入並有存取權，可以 `git clone` 下來或用 `gh api` 讀；若之後改成 public，也可以直接用 WebFetch 抓 GitHub raw 內容。
3. **不依賴跨 repo 讀取**（最穩，優先採用）：上面「運作原理」已經把核心邏輯完整寫出來，新 app 照著寫即可實作，不需要真的讀到 `fare-finder-pro` 的原始碼。`src/routes/auth/index.tsx` 等只是「參考實作在哪」的附註。唯一真正必須查的權威來源是**資料庫本身**（上面「權威來源」那條 `pg_trigger` SQL）——不管在哪台機器、哪個 repo，只要連的是同一個 Supabase 專案就查得到。

## 隔離規則：登入頁只認已標記的帳號，登入本身不補標記

> 2026-09-21 更新：本節原本寫成「email 已存在一律走密碼重設」，與 `fare-finder-pro` 的實際程式碼不一致。依 FE-08、FE-09 的實測結果（見 `docs/test-report.md`）改成描述實際行為。

所有共用這個 Supabase 專案的 app，**登入頁**一律只認已經標記過的帳號：密碼正確但 `apps` 沒有自己的名稱，就登出並顯示一般的登入失敗訊息。**登入這個動作本身不會補標記。**

要加入某個 app，必須是使用者在**那個 app 的註冊流程**中明確採取的動作（或管理員在後台操作），不能靠「登入」順便加入。不要實作在登入頁 `apps` 沒命中時自動呼叫 `updateUser({ data: { app } })` 補標記——這會讓「登入」變成隱含的加入動作，使用者無從分辨，每個 app 的登入頁也會悄悄擴大自己的存取範圍。

### 註冊時 email 已被別的 app 使用：`fare-finder-pro` 的實際行為

`fare-finder-pro` 在註冊頁遇到已存在的 email（Supabase 可能回明確錯誤，也可能回一個 `identities` 為空的假成功，兩種都要處理）時，分兩種情況：

1. **密碼相符**：直接以該密碼登入，補上標記，導向 dashboard。**不需要驗證信箱。**
2. **密碼不符**：不登入，改寄密碼重設信並顯示說明；使用者點信件連結、在 `/auth/reset` 設定新密碼之後才補標記。

參考實作：`src/routes/auth/index.tsx`（註冊流程）、`src/routes/auth/reset.tsx`（重設後補標記）。

**為什麼密碼相符可以直接加入**：走到這條路徑必須已經知道該帳號的密碼；而知道密碼的人本來就能登入其他 app，再用 `updateUser` 自己加上標籤（見上面「標籤是什麼、不是什麼」）。所以這條路徑沒有給出額外的存取能力，只是省去多餘的信箱驗證。它跟「登入頁自動補標記」的差別在於**意圖**：前者是使用者在註冊頁明確要求加入，後者是登入時的隱含副作用，不是安全強度的差別。

新 app 可以沿用這個行為；若想更嚴格（例如密碼相符也一律要求先驗證信箱），也可以，但請在該 app 自己的文件寫清楚，並確保不要在登入頁補標記。

### 加入某個 app 的合法路徑

「使用者或管理員明確採取一個動作才加入」實際上有三種：

1. **使用者走 signup，且密碼相符**：見上，直接補標記。
2. **使用者走 signup，但密碼不符**：導去密碼重設流程，使用者驗證過信箱身份、設定新密碼後才補標記。
3. **管理員在自己 app 後台建帳號時撞到既有帳號**：`auth.admin.createUser()` 對已存在的 email 一定會失敗（`auth.users` 的 email 在整個 project 是唯一的），這時改成「掛靠既有身份」——不建立新帳號、不改密碼，只幫既有帳號補上這個 app 需要的資料，並把自己的 app 名稱**合併**進 `app_metadata.apps`（用 spread 保留其他 app 既有的標記，不要整個覆寫掉）。參考實作：`web_project_management` repo 的 `app/(protected)/users/new/actions.ts` 的 `linkExistingAccountToThisApp()`。

三種都合法，因為都是「透過某個 app 自己的流程、且由使用者本人或管理員明確採取了一個動作才加入」，跟登入頁的隱含自動補標記（上面明文禁止的作法）性質不同。

## 驗證信的寄件識別：每個 app 在 redirect_to 帶 `?app=`

Supabase Auth 的 Send Email hook 整個 project 只能設一個，所有 app 的驗證信/重設信都經過同一支 `send-email`（本 repo 的 `supabase/functions/send-email/index.ts`）。它依下列順序決定寄件人、標題前綴與信中產品名稱：

1. `redirect_to` 網址上的 `app` 查詢參數（例：``emailRedirectTo: `${origin}/?app=${APP_NAME}` ``、``resetPasswordForEmail(..., { redirectTo: `${origin}/auth/reset?app=${APP_NAME}` }) ``）。
2. `user.user_metadata.app`（最後一次宣告的 app；共用帳號時可能不是這次觸發的 app）。
3. 都對不到 → 通用的 "System Notification"。

不看網域，所以換網域、Vercel preview、本機 localhost 都不影響。`redirect_to` 是使用者端可控的值，hook 只接受 `APPS` 白名單內的名稱。

**新 app 要做兩件事**：前端所有會寄信的呼叫都帶 `?app=<APP_NAME>`；並在 `send-email` 的 `APPS` 加一筆。**只保留一份 `send-email` 程式碼**——兩個 repo 各自部署同一個 slug，後部署的會蓋掉前一個。

## 不要動的東西

`public.handle_new_user()` / `public.profiles`（`on_auth_user_created` trigger）是另一個既有 app（`project-management`）的員工資料表，**不要去編輯它的程式碼**。

### 但它不是「跟這個機制無關」——同一張表上的 trigger 彼此看不到對方

`auth.users` 上任何一個 trigger，不管是哪個 app 建的，都會對**所有共用這個 project 的 app** 的 signup 觸發，不是只有建立它的那個 app。這不是假設性風險——`project-management` app 就真的中過這一槍：它的 `handle_new_user()` 原本沒有做 app 過濾，對每一筆從 flight（`fare-finder-pro`）註冊的帳號都無條件建立一筆 `public.profiles`、白佔一個員編，導致 flight 的帳號雖然被 `hasAppAccess()` 正確擋在登入頁外，卻還是污染了 project-management 的使用者管理清單、看起來像個正常員工。後來用 `supabase/migrations/20260906000001_scope_handle_new_user_to_app.sql` 修掉（在 `raw_app_meta_data.apps` 沒有含自己 app 名稱時，直接 `return new` 跳過 insert）；完整經過記在 `web_project_management` repo 的 `docs/migrations_overview.md` Phase 7。

**如果你自己的 app 也要在 `auth.users` 上掛 provisioning trigger**（建 profile、發通知、消耗序號/員編等任何有副作用的動作）：動手前一定要先判斷 `new.raw_app_meta_data -> 'apps'` 有沒有含自己的 app 名稱，沒有就直接 `return new`、完全跳過副作用。不要假設「別的 app 建的帳號不會經過我的 trigger」——只要共用同一個 `auth.users`，就一定會經過。

## 幫「已有真實使用者」的舊 app 套用這套規則

如果是幫**已經上線、已經有真實使用者**的舊 app 補上這套隔離機制，關鍵風險是：那個系統現有的每一個帳號，`app_metadata.apps` 目前都還是空的。如果直接照抄「登入頁只認 `apps` 裡已標記的帳號」上線，會讓那個系統**現有所有使用者瞬間全部登入失敗**。

套用順序必須是：

1. **先批次補標記**：對現有帳號一次性補上該 app 自己的名稱，示意 SQL：
   ```sql
   update auth.users
   set raw_app_meta_data =
     coalesce(raw_app_meta_data, '{}'::jsonb)
     || jsonb_build_object(
       'apps',
       coalesce(raw_app_meta_data -> 'apps', '[]'::jsonb) || to_jsonb('<你的-app-名稱>'::text)
     )
   where id in (/* 這個系統現有帳號的 id 清單 */);
   ```
2. **確認補標記正確無誤後，才**在登入邏輯加上 `apps.includes('<你的-app-名稱>')` 檢查。
3. **順序不能顛倒**——先加檢查、後補標記，會讓使用者在中間空窗期完全登不進去。上線前先在一、兩個測試帳號驗證「補標記 → 能正常登入」，確認無誤再對全部帳號執行。

## 這個新 app 要不要自己維護一份這支 migration？

不用。這支 migration 綁在 `auth.users`（project 層級共用的表），只要在共用的 Supabase project 上跑過一次就對全 project 生效，跟哪個 repo 跑的無關。新 app：

- 如果**不**自己管理這個 project 的 Supabase CLI migrations：什麼都不用做，直接照上面「運作原理」串接即可。
- 如果**也**用 Supabase CLI（`supabase link` 到同一個 project）管理自己的 migrations：正常 `supabase db push` 不會受影響，只是 `supabase migration list` 會顯示這支 migration 是 remote-only（本地沒有這個檔案），純資訊性提示。如果想讓歷史乾淨無警告，可以把 `20260904120000_flight_app_scoped_auth.sql` 原封不動複製進自己的 `supabase/migrations/`，並註明「vendored，實際維護在 fare-finder-pro repo，此處僅供 CLI 歷史對齊」。
