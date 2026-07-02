# 酒窖 POS — 葡萄酒進銷存系統

前端純 HTML/JS（可部署 GitHub Pages），後端使用 Supabase（PostgreSQL + Auth）。

## 專案結構

```
wine-pos/
├── index.html          # 主頁面（登入 + 開單/庫存/客戶/紀錄）
├── css/style.css       # 樣式
├── js/
│   ├── config.js       # ⚠️ Supabase 連線設定（要填入你的專案資訊）
│   ├── auth.js         # 登入登出
│   ├── api.js          # 資料存取層
│   └── app.js          # 主程式
├── db/schema.sql       # 完整資料庫 schema（貼到 Supabase SQL Editor 執行）
└── scripts/
    └── import_csv.mjs  # CSV 匯入腳本（品項/客戶）
```

## 快速開始

### 1. 建立 Supabase 專案
1. 到 <https://supabase.com> 建立免費專案
2. 進入 **SQL Editor**，貼上 `db/schema.sql` 全部內容並執行
3. 到 **Authentication → Users** 手動新增 2-5 位使用者（Email + 密碼）
4. 到 **Settings → API** 複製 `Project URL` 和 `anon public` key

### 2. 設定前端
編輯 `js/config.js`，填入上一步的 URL 和 anon key。

> anon key 是設計上可公開的金鑰，安全性由資料庫 RLS 控制，
> 放在前端和 GitHub 上是正常做法。**但 service_role key 絕不能外洩。**

### 3. 本機測試
```bash
# 任一靜態伺服器即可，例如：
npx serve .
# 或 VS Code 裝 Live Server 擴充功能，右鍵 index.html → Open with Live Server
```

### 4. 匯入既有資料（品項 / 客戶清單）
```bash
npm install @supabase/supabase-js csv-parse

# Windows (cmd)
set SUPABASE_URL=https://你的專案.supabase.co
set SUPABASE_SERVICE_KEY=你的service_role金鑰

node scripts/import_csv.mjs products data/products.csv
node scripts/import_csv.mjs customers data/customers.csv
```
CSV 欄位對應在 `import_csv.mjs` 的 `mapProduct` / `mapCustomer`，
支援中文欄位名（酒款名稱、酒莊、產區、年份、容量、定價…），可自行調整。

### 5. 部署到 GitHub Pages
```bash
git init
git add .
git commit -m "init wine pos"
git branch -M main
git remote add origin https://github.com/你的帳號/wine-pos.git
git push -u origin main
```
然後到 GitHub repo → **Settings → Pages** → Source 選 `main` branch → 儲存。
幾分鐘後即可用 `https://你的帳號.github.io/wine-pos/` 開啟。

> Supabase 免費方案注意：專案 7 天無活動會自動暫停，
> 有實際使用就不會。到 Dashboard 按 Restore 即可恢復。

## 已完成功能

- ✅ Email 登入 / 登出（Supabase Auth）
- ✅ 開單：搜尋酒款 → 加入購物車 → 改價/改量 → 選客戶 → 結帳
- ✅ FIFO 批次扣庫存（資料庫函式 `create_order`，交易鎖防超賣）
- ✅ 庫存總覽（含加權平均成本、低庫存標紅）
- ✅ 客戶清單 / 新增客戶
- ✅ 操作紀錄（audit_log trigger 自動記錄所有異動）

## 待開發（建議順序）

1. **進貨頁面** — `api.js` 已有 `addPurchase()`，補 UI 即可
2. **訂單查詢/作廢** — `getOrders()` 已就緒；作廢需寫 `void_order` 資料庫函式回補批次
3. **品項管理頁** — 新增/編輯酒款（`addProduct()` 已就緒）
4. **報表** — 銷售排行、毛利（`order_items.unit_cost` 已存成本快照）
5. **盤點調整** — 寫入 `stock_movements` 的 `adjust` 類型

## 資料庫重點

- 品項唯一鍵 = 酒款 + 酒莊 + 年份 + 容量（同酒不同容量是不同 SKU）
- `purchase_batches` 記錄每批進價，`v_stock` VIEW 即時算庫存
- `create_order()` 用 `FOR UPDATE` 鎖列，多人同時開單不會超賣
- `audit_log` 記錄誰在何時改了什麼（含變更前後 JSON）
