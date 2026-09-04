# Supabase 多 App 共用 auth.users 的權限管理方案

## 問題

有沒有辦法「分開」auth.users 對不同 app 的有效性？例如：某一個 app 註冊後，是否能讓所有 app 都能使用？

## 核心觀念：Supabase 的預設行為

只要多個 App 共用同一個 Supabase 專案，**在 App A 註冊的使用者，本來就可以用同一組帳密透過 `auth.signInWithPassword` 登入 App B**。

原因是 `auth.users` 是全域唯一的帳號庫，這天生就是一套 **SSO（單一登入）機制**。

如果目標是「更精準地控制某個帳號對各個 App 是否有權限」（例如：能否進入、角色是什麼、是否被停權），標準做法有以下兩種。

---

## 做法一：獨立的 Profiles / App 授權表（最推薦、最靈活）

讓 `auth.users` 純粹負責「身分認證（你是誰）」，各 App 的資料表負責「授權控制（你能不能用這個 App）」。

### 資料庫設計

以 App 1、App 2 為例：

- **App 1**：`public.profiles` 記錄允許使用 App 1 的使用者
- **App 2**：`web_app2.profiles` 記錄允許使用 App 2 的使用者

### 前端 / Middleware 驗證流程

```
使用者在 App 2 輸入帳密登入
       ↓
Supabase Auth 驗證成功（取得 session）
       ↓
前端/Middleware 查詢 web_app2.profiles：
  ├─ 查得到資料且 is_active = true → 放行進入 App 2
  └─ 查無資料 → 阻擋，提示「您尚未開通 App 2 存取權限」
```

### 若要「註冊任一 App，所有 App 皆可通行」

透過 Trigger（觸發器），在使用者註冊時一次性在所有 App 的 `profiles` 表建立對應資料：

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user_sync_all_apps()
RETURNS TRIGGER AS $$
BEGIN
  -- 寫入 App 1 的 profiles
  INSERT INTO public.profiles (id, email, role, is_active)
  VALUES (new.id, new.email, 'user', true);

  -- 寫入 App 2 的 profiles
  INSERT INTO web_app2.profiles (id, email, role, is_active)
  VALUES (new.id, new.email, 'designer', true);

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## 做法二：app_metadata 內記錄 App 授權清單（效能最高、免多查一次 DB）

`auth.users` 有一個原生欄位 `raw_app_meta_data`（JSONB），這個欄位會被直接包進使用者的 **JWT Token** 裡。

### 1. 在帳號建立或開通權限時，寫入允許的 App 清單

```json
{
  "allowed_apps": ["fare-finder", "project-manager"]
}
```

### 2. 各 App 的前端或 Middleware 直接解碼 JWT 判斷

以 App 2（專案管理系統）的 Middleware 為例：

```typescript
const { data: { user } } = await supabase.auth.getUser();
const allowedApps = user?.app_metadata?.allowed_apps || [];

if (!allowedApps.includes('project-manager')) {
  // 沒有專案管理權限，重導向至無權限頁面或 App 1
  return NextResponse.redirect(new URL('/unauthorized', req.url));
}
```

### 3. RLS 政策也可直接防護

在 `web_app2` 的資料表上，可以直接從 JWT 取出這項資訊：

```sql
CREATE POLICY "Allow access to authorized app users"
ON web_app2.projects
FOR SELECT
USING (
  (auth.jwt() -> 'app_metadata' -> 'allowed_apps') ? 'project-manager'
);
```

---

## 兩種做法比較

| 評估維度 | 做法一：Profiles / 授權表 | 做法二：app_metadata（JWT） |
|---|---|---|
| 即時停權生效速度 | 極快。後台將資料表改為 `is_active = false`，下一次 request 馬上失效 | 需等待 Token 過期（通常約 1 小時）或強制重新整理 Session |
| 查詢效能 | 登入後需額外查詢一次 DB 表 | 極高，資訊直接隨 JWT 攜帶，不用查 DB 即可在 Middleware 判定 |
| 適用情境 | 兩個 App 的角色、權限、部門等業務欄位完全不同時（如室內設計專案管理） | 單純只要開關「能不能進這個 App」的通行證機制 |

---

## 建議

如果這兩個 App 是同一體系的內部系統，通常建議採用**做法一**：讓 `auth.users` 負責共用帳號密碼，各 App 維護自己的 `profiles` 表來管理各自的詳細角色與權限。
