// ============================================
// CSV 匯入腳本：品項 / 客戶
// 用法:
//   npm install @supabase/supabase-js csv-parse
//   node scripts/import_csv.mjs products data/products.csv
//   node scripts/import_csv.mjs customers data/customers.csv
//
// ⚠️ 這裡用 service_role key（有完整權限），只能在本機執行，
//    絕對不要 commit 到 GitHub！請用環境變數：
//    set SUPABASE_URL=https://xxx.supabase.co        (Windows)
//    set SUPABASE_SERVICE_KEY=xxxxx
// ============================================
import { createClient } from "@supabase/supabase-js";
import { parse } from "csv-parse/sync";
import { readFileSync } from "node:fs";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error("請先設定環境變數 SUPABASE_URL 與 SUPABASE_SERVICE_KEY");
  process.exit(1);
}
const sb = createClient(url, key);

const [, , type, file] = process.argv;
if (!type || !file) {
  console.error("用法: node import_csv.mjs <products|customers> <檔案.csv>");
  process.exit(1);
}

const rows = parse(readFileSync(file, "utf-8"), {
  columns: true,          // 第一列當欄位名
  skip_empty_lines: true,
  trim: true,
});
console.log(`讀取 ${rows.length} 筆資料...`);

// ---------- 欄位對應：改這裡以符合你的 CSV 欄位名稱 ----------
function mapProduct(r) {
  return {
    name: r["酒款名稱"] ?? r.name,
    producer: r["酒莊"] ?? r.producer ?? null,
    country: r["國家"] ?? r.country ?? null,
    region: r["產區"] ?? r.region ?? null,
    appellation: r["法定產區"] ?? r.appellation ?? null,
    wine_type: r["類型"] ?? r.wine_type ?? "red",
    vintage: toInt(r["年份"] ?? r.vintage),
    volume_ml: toInt(r["容量"] ?? r.volume_ml) ?? 750,
    list_price: toNum(r["定價"] ?? r.list_price) ?? 0,
  };
}

function mapCustomer(r) {
  return {
    name: r["姓名"] ?? r.name,
    phone: r["電話"] ?? r.phone ?? null,
    email: r["Email"] ?? r.email ?? null,
    address: r["地址"] ?? r.address ?? null,
    note: r["備註"] ?? r.note ?? null,
  };
}

function toInt(v) { const n = parseInt(v); return isNaN(n) ? null : n; }
function toNum(v) { const n = parseFloat(String(v ?? "").replace(/[,$]/g, "")); return isNaN(n) ? null : n; }

// ---------- 分批寫入 ----------
const mapper = type === "products" ? mapProduct : mapCustomer;
const table = type === "products" ? "products" : "customers";
const data = rows.map(mapper).filter((r) => r.name);

const BATCH = 100;
let ok = 0;
for (let i = 0; i < data.length; i += BATCH) {
  const chunk = data.slice(i, i + BATCH);
  const { error } = await sb.from(table).insert(chunk);
  if (error) {
    console.error(`第 ${i + 1}~${i + chunk.length} 筆失敗:`, error.message);
  } else {
    ok += chunk.length;
    console.log(`已匯入 ${ok}/${data.length}`);
  }
}
console.log(`完成，成功 ${ok} 筆。`);
