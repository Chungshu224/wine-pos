// ============================================
// 資料存取層：封裝所有 Supabase 查詢
// 頁面邏輯只呼叫這裡的函式，方便日後維護
// ============================================
import { sb } from "./auth.js";

// ---------- 庫存（POS 預設清單，依銷量排序） ----------
export async function getPopularProducts() {
  const { data, error } = await sb
    .from("v_popular_products")
    .select("*")
    .gt("stock_qty", 0)
    .order("total_sold", { ascending: false })
    .order("name");
  if (error) return getStock(""); // fallback if view not yet created
  return data;
}

// ---------- 庫存（彙總，POS 搜尋用） ----------
export async function getStock(keyword = "") {
  let q = sb.from("v_stock").select("*").order("name");
  if (keyword) q = q.ilike("name", `%${keyword}%`);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

// ---------- 庫存（庫存管理頁：每庫位一列） ----------
export async function getStockLocations(keyword = "") {
  let q = sb
    .from("v_stock_locations")
    .select("*")
    .order("location", { nullsFirst: false })
    .order("name");
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

export async function updateProduct(id, fields) {
  const { error } = await sb.from("products").update(fields).eq("id", id);
  if (error) throw error;
}

// 軟刪除：下架該酒款（不動歷史進貨/訂單紀錄，只是不再顯示於開單/庫存）
export async function deactivateProduct(id) {
  const { error } = await sb.from("products").update({ is_active: false }).eq("id", id);
  if (error) throw error;
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

export async function updateCustomer(id, fields) {
  const { error } = await sb.from("customers").update(fields).eq("id", id);
  if (error) throw error;
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
export async function getOrders({ keyword = "", status = "", dateFrom = "", dateTo = "", limit = 30, offset = 0 } = {}) {
  let q = sb
    .from("orders")
    .select("*, customers(name), order_items(id)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) q = q.eq("status", status);
  if (keyword) q = q.ilike("order_no", `%${keyword}%`);
  if (dateFrom) q = q.gte("created_at", dateFrom);
  if (dateTo) q = q.lte("created_at", dateTo + "T23:59:59");

  const { data, error, count } = await q;
  if (error) throw error;
  return { data, count };
}

export async function getOrderById(id) {
  const { data, error } = await sb
    .from("orders")
    .select("*, customers(name, phone, email, address), order_items(qty, unit_price, line_total, products(name, vintage, volume_ml))")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

export async function confirmPayment(orderId) {
  const { error } = await sb
    .from("orders")
    .update({ paid_at: new Date().toISOString() })
    .eq("id", orderId);
  if (error) throw error;
}

export async function getUnpaidOrders() {
  const { data, error } = await sb
    .from("orders")
    .select("id, order_no, created_at, payment_method, total, customers(name)")
    .eq("status", "completed")
    .is("paid_at", null)
    .neq("payment_method", "card")
    .order("created_at");
  if (error) throw error;
  return data ?? [];
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
