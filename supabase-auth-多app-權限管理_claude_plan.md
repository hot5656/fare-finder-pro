這份計畫的整體架構非常嚴謹，主要解決一個常見的架構痛點：**「多個獨立前端應用共用同一個 Supabase 專案（同一個 auth.users），如何在不打架的前提下，讓使用者用同一套帳號密碼登入新應用，且新應用只允許已開通授權的帳號進入？」**  
以下為你拆解這份計畫的**核心邏輯**、**技術實現細節**與**關鍵權衡（Trade-offs）**：

### **一、 核心設計概念**

> 1. **使用者身分驗證（Authentication）vs. 應用存取授權（Authorization）分開**：  
   * Supabase 原生只管帳號密碼對不對（Auth）。  
   * 本計畫透過 app\_metadata.apps（陣列，如 \["fare-finder-pro"\]）來決定該帳號是否有權存取此應用（Authz）。  
> 2. **所有權驗證原則（Proof of Ownership）**：  
   * 只要使用者能**輸入正確密碼**（無論是在「登入」還是「註冊」流程），就視為該帳號的合法擁有者，系統直接將本應用標籤（fare-finder-pro）綁定進該帳號。  
   * 如果密碼錯誤，唯一的帳號連結途徑是**發送信件重設密碼**（確認郵件所有權）。  
> 3. **安全邊界（Security Boundary）**：  
   * 客戶端不能直接篡改 app\_metadata。  
   * 做法是客戶端送出 user\_metadata.app \= "fare-finder-pro"，透過 PostgreSQL Trigger 自動提升（promote）並去重寫入 app\_metadata.apps。

### **二、 逐步技術流程**

**Step 0：前置相容性檢查（Pre-flight Check）**

* **背景**：共用專案中已存在其他應用的 Trigger（如舊應用的員工資料表記錄 public.handle\_new\_user()）。  
* **風險**：若 public.profiles 的 department 或 title 欄位設有 NOT NULL 且無預設值，新應用註冊時沒帶這些欄位，會導致 Trigger 噴錯並 Rollback，註冊直接爆炸。  
* **動作**：先去 SQL Editor 確認這兩個欄位允許 NULL 或有 Default。

**Step 1：資料庫 Trigger（flight\_app\_scoped\_auth.sql）**

* 建立在專屬的 flight schema 中，維持乾淨隔離。  
* 監聽 auth.users 的 BEFORE INSERT 與 BEFORE UPDATE OF raw\_user\_meta\_data。  
* 取出 raw\_user\_meta\_data \-\>\> 'app'，檢查防禦型型別（避免 JSON null 破壞陣列），安全地 append 到 raw\_app\_meta\_data.apps。  
* 授權 supabase\_auth\_admin 執行（GoTrue 服務專用角色）。

**Step 2：登入 / 註冊流程處理（src/routes/auth.tsx）**

* **登入（Sign-in）**：  
  * 帳密正確後，檢查 JWT/使用者資料中的 app\_metadata.apps。  
  * 若無 fare-finder-pro，呼叫 updateUser({ data: { app: "fare-finder-pro" } }) 自動綁定，並**立即呼叫 refreshSession()** 更新 token claim，順利登入。  
* **註冊（Sign-up）**：  
  * 送出註冊帶有 app: "fare-finder-pro"。  
  * **處理已存在帳號**（相容列舉防護開啟/關閉的兩種回傳型態）：  
    * 嘗試用剛才輸入的密碼進行登入。  
    * **密碼吻合**：直接綁定並進入 Dashboard（對使用者來說是無縫體驗）。  
    * **密碼不吻合**：觸發 resetPasswordForEmail，寄送重設信，並提示「重設密碼將會同步影響所有共用此系統的服務」。

**Step 3：密碼重設頁面（src/routes/auth/reset.tsx）**

* 監聽 PASSWORD\_RECOVERY 事件。  
* 使用者輸入新密碼時，同步執行密碼更新與應用標籤綁定：updateUser({ password, data: { app: "fare-finder-pro" } })。

**Step 4：全域守門路由（src/routes/\_authenticated/route.tsx）**

* 進入任何受保護路由前，透過 supabase.auth.getUser() 驗證。  
* 若 app\_metadata.apps 沒有 fare-finder-pro，直接 signOut() 並強制跳轉 /auth，防止其他應用產生的有效 Session 混進來。

### **三、 為什麼這個解法優秀？**

| 考量維度 | 本解法的處理方式 | 優勢 |
| :---- | :---- | :---- |
| **架構衝擊** | 完全不改動原有共用專案的 Trigger 或資料表，邏輯全收斂在 flight schema。 | 零破壞現有其他應用的既有資料與邏輯。 |
| **維運成本** | 陣列儲存 apps（如 \["app1", "app2"\]），未來若有第 3、4 個應用加入，完全不需要改 DB Trigger。 | 高擴展性，天然支援多應用共享。 |
| **資安防護** | app\_metadata 僅限伺服器端/Trigger 寫入；密碼變更嚴格要求「舊密碼吻合」或「郵件驗證連結」。 | 無法透過前端竄改任意取得權限。 |
| **Token 即時性** | 每次 updateUser 後都有補 refreshSession()，避免 JWT 內部的 Claims 出現時間差。 | 杜絕 RLS policy 因 Token 未更新而誤判拒絕。 |

### **四、 執行前需留意的關鍵細節**

> 1. **非排他性（Non-exclusive）的業務定義**：  
   * 目前的設計是 **「任何知道帳密的人，在登入此 App 時都會自動開通本 App 存取權」**。  
   * 如果你的業務需求是「即使帳密對，也必須經由管理員審批才能開通此 App」，就不能採用此處的「自動補簽（auto-bind）」設計。但以一般跨 App 帳號共享體系來說，目前的自動綁定是最流暢的 UX。  
> 2. **密碼全域連動通知**：  
   * 由於帳號密碼在底層是共用的，使用者若在 Flight App 重設了密碼，其他系統的密碼也會同時改變。方案中在 UI Copy 上特別加上警告提示，這點非常必要。  
> 3. **手動部署 SQL**：  
   * 計畫中有提到目前的 CLI 權限可能不足（403），因此直接將 Migration SQL 貼到 **Supabase Dashboard → SQL Editor** 執行是最穩當的做法。