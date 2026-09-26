# 簡報產生器

兩份簡報，各自一支產生器，互不影響：

| 指令 | 產生器 | 產出 | 大綱 |
|---|---|---|---|
| `npm run build` | `build.js` | `docs/flight-price-notifier_v1.1_user_2026_0926.pptx`（使用者版，只含免費訂閱，15 張；截圖 `16`–`32`） | `docs/ppt-outline_1.1_user.md` |
| `npm run build:system` | `build-system.js` | `docs/flight-price-notifier_v1.1_system_2026_0926.pptx`（系統全功能版：免費與付費、管理員後台、系統運作，26 張；截圖 `08`、`10`、`11`、`13`、`14` 與 `16`–`42`） | `docs/ppt-outline_1.1_system.md` |

這是獨立的小專案，不屬於 app：依賴只裝在這個資料夾，不要加進根目錄的 `package.json`。

## 需要

- Node.js
- `ffmpeg`（裁切 Dashboard 截圖裡的東京卡片；`brew install ffmpeg`）

## 產生

```sh
cd docs/deck
npm install
npm run build                      # 寫入 docs/flight-price-notifier_v1.1_user_2026_0926.pptx
npm run build:system               # 寫入 docs/flight-price-notifier_v1.1_system_2026_0926.pptx
node build.js /path/to/other.pptx  # 或輸出到別的檔名
```

`.build/`、`.build-system/` 是產生時的暫存（裁切後的卡片圖、QR code），可以隨時刪掉。

## 常見修改

- **換截圖**：用同樣檔名覆蓋 `docs/ppt-screenshots/` 裡的圖，重跑即可。Dashboard 版面若有變，要重新確認 `build.js`／`build-system.js` 裡 `CROPS` 的裁切座標（系統版的 Admin 截圖也是裁切後使用）。
- **改文字**：每張投影片是 `build.js` 裡一個 `// N — 標題` 區塊；講者備註在各區塊的 `addNotes`。
- **改網址**：`SITE_URL`（QR code 也會跟著換）。
- **出新版**：改輸出檔名與封面日期，其餘沿用。

## 檢查

用 Keynote 開啟產出的 `.pptx` 逐張看過（文字有沒有超出框、截圖有沒有擋到字）。字型用 PingFang TC，在 Windows 的 PowerPoint 會被替換，換行位置可能略有不同。
