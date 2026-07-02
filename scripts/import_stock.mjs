// ============================================
// 庫存（進貨批次）匯入腳本
// 用法:
//   node scripts/import_stock.mjs data/stock.csv
//
// CSV 欄位: 酒款名稱, 庫位, 數量
// 依「酒款名稱」比對 products.name 找出 product_id，
// 幫每一列建立一筆 purchase_batches（unit_cost 預設 0，之後請至資料庫補上真實進價）
//
// ⚠️ 用 service_role key，只能在本機執行：
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

const [, , file] = process.argv;
if (!file) {
  console.error("用法: node import_stock.mjs <檔案.csv>");
  process.exit(1);
}

const rows = parse(readFileSync(file, "utf-8"), {
  columns: true,
  skip_empty_lines: true,
  trim: true,
});
console.log(`讀取 ${rows.length} 筆庫存資料...`);

let ok = 0;
let failed = 0;
for (const r of rows) {
  const name = r["酒款名稱"];
  const qty = parseInt(r["數量"]) || 0;
  const location = r["庫位"] || null;
  if (!name || qty <= 0) {
    console.log(`略過（無名稱或數量為0）: ${name}`);
    continue;
  }

  const { data: product, error: findErr } = await sb
    .from("products")
    .select("id")
    .eq("name", name)
    .maybeSingle();

  if (findErr || !product) {
    console.error(`找不到品項「${name}」，略過`);
    failed++;
    continue;
  }

  const { error: insErr } = await sb.from("purchase_batches").insert({
    product_id: product.id,
    unit_cost: 0,
    qty_in: qty,
    qty_left: qty,
    location,
    note: "期初庫存匯入",
  });

  if (insErr) {
    console.error(`「${name}」建立批次失敗:`, insErr.message);
    failed++;
  } else {
    ok++;
    console.log(`已建立: ${name}（庫位 ${location}，數量 ${qty}）`);
  }
}
console.log(`完成，成功 ${ok} 筆，失敗 ${failed} 筆。`);
