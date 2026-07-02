// ============================================
// 資料存取層：封裝所有 Supabase 查詢
// 頁面邏輯只呼叫這裡的函式，方便日後維護
// ============================================
import { sb } from "./auth.js";

// ---------- 庫存 ----------
export async function getStock(keyword = "") {
  let q = sb.from("v_stock").select("*").order("name");
  if (keyword) q = q.ilike("name", `%${keyword}%`);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

// ---------- 品項 ----------
export async function getProducts(keyword = "") {
  let q = sb.from("products").select("*").eq("is_active", true).order("name");
  if (keyword) q = q.ilike("name", `%${keyword}%`);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

export async function addProduct(product) {
  const { data, error } = await sb.from("products").insert(product).select().single();
  if (error) throw error;
  return data;
}

// ---------- 進貨 ----------
export async function addPurchase(batch) {
  // batch: { product_id, supplier, unit_cost, qty_in, note }
  const { data: { user } } = await sb.auth.getUser();
  const { data, error } = await sb
    .from("purchase_batches")
    .insert({ ...batch, qty_left: batch.qty_in, created_by: user.id })
    .select()
    .single();
  if (error) throw error;

  // 寫入庫存流水帳
  await sb.from("stock_movements").insert({
    product_id: batch.product_id,
    batch_id: data.id,
    movement: "purchase",
    qty_change: batch.qty_in,
    created_by: user.id,
  });
  return data;
}

// ---------- 客戶 ----------
export async function getCustomers(keyword = "") {
  let q = sb.from("customers").select("*").eq("is_active", true).order("name");
  if (keyword) q = q.or(`name.ilike.%${keyword}%,phone.ilike.%${keyword}%`);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

export async function addCustomer(customer) {
  const { data, error } = await sb.from("customers").insert(customer).select().single();
  if (error) throw error;
  return data;
}

// ---------- 開單（呼叫資料庫函式，FIFO 扣庫存防超賣） ----------
export async function createOrder({ customerId, discount, payment, note, items }) {
  // items: [{ product_id, qty, unit_price }]
  const { data, error } = await sb.rpc("create_order", {
    p_customer_id: customerId,
    p_discount: discount || 0,
    p_payment: payment || "cash",
    p_note: note || null,
    p_items: items,
  });
  if (error) throw error;
  return data; // order_id
}

// ---------- 訂單查詢 ----------
export async function getOrders(limit = 50) {
  const { data, error } = await sb
    .from("orders")
    .select("*, customers(name), order_items(*, products(name, vintage, volume_ml))")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

// ---------- 操作紀錄 ----------
export async function getAuditLog(limit = 100) {
  const { data, error } = await sb
    .from("audit_log")
    .select("*")
    .order("changed_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}
