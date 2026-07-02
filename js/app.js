// ============================================
// 主程式：畫面切換與各頁邏輯
// 四個頁籤：開單 / 庫存 / 客戶 / 紀錄
// ============================================
import { sb, signIn, signOut, currentUser } from "./auth.js";
import * as api from "./api.js";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ---------- 購物車狀態 ----------
let cart = []; // [{ product_id, name, vintage, qty, unit_price, stock }]
let selectedCustomer = null;

// ---------- 初始化 ----------
init();
async function init() {
  const user = await currentUser();
  if (user) {
    showApp(user);
  } else {
    $("#login-view").hidden = false;
  }

  $("#login-form-btn").addEventListener("click", handleLogin);
  $("#logout-btn").addEventListener("click", signOut);
  $$(".tab").forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.tab)));

  // 開單頁
  $("#pos-search").addEventListener("input", debounce(renderPosProducts, 300));
  $("#checkout-btn").addEventListener("click", handleCheckout);
  $("#customer-search").addEventListener("input", debounce(renderCustomerPicker, 300));

  // 庫存頁
  $("#stock-search").addEventListener("input", debounce(renderStock, 300));
  $("#add-product-btn").addEventListener("click", handleAddProduct);

  // 客戶頁
  $("#cust-search").addEventListener("input", debounce(renderCustomers, 300));
  $("#add-customer-btn").addEventListener("click", handleAddCustomer);
}

async function handleLogin() {
  const email = $("#login-email").value.trim();
  const password = $("#login-password").value;
  const msg = $("#login-msg");
  msg.textContent = "";
  try {
    await signIn(email, password);
    const user = await currentUser();
    showApp(user);
  } catch (e) {
    msg.textContent = "登入失敗：" + e.message;
  }
}

function showApp(user) {
  $("#login-view").hidden = true;
  $("#app-view").hidden = false;
  $("#user-name").textContent = user.display_name;
  switchTab("pos");
}

function switchTab(tab) {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  $$(".page").forEach((p) => (p.hidden = p.id !== `page-${tab}`));
  if (tab === "pos") renderPosProducts();
  if (tab === "stock") renderStock();
  if (tab === "customers") renderCustomers();
  if (tab === "log") renderLog();
}

// ============================================
// 開單頁
// ============================================
async function renderPosProducts() {
  const kw = $("#pos-search").value.trim();
  const rows = await api.getStock(kw);
  $("#pos-products").innerHTML = rows
    .map(
      (r) => `
    <div class="product-card ${r.stock_qty <= 0 ? "oos" : ""}" data-id="${r.product_id}">
      <div class="p-name">${esc(r.name)}</div>
      <div class="p-meta">${r.vintage ?? "NV"} · ${r.volume_ml}ml</div>
      <div class="p-row">
        <span class="p-price">$${fmt(r.list_price)}</span>
        <span class="p-stock">庫存 ${r.stock_qty}</span>
      </div>
    </div>`
    )
    .join("");

  $$("#pos-products .product-card:not(.oos)").forEach((card) =>
    card.addEventListener("click", () => {
      const r = rows.find((x) => x.product_id == card.dataset.id);
      addToCart(r);
    })
  );
}

function addToCart(r) {
  const existing = cart.find((c) => c.product_id === r.product_id);
  if (existing) {
    if (existing.qty >= r.stock_qty) return alert("已達庫存上限");
    existing.qty++;
  } else {
    cart.push({
      product_id: r.product_id,
      name: r.name,
      vintage: r.vintage,
      qty: 1,
      unit_price: Number(r.list_price),
      stock: r.stock_qty,
    });
  }
  renderCart();
}

function renderCart() {
  $("#cart-items").innerHTML = cart
    .map(
      (c, i) => `
    <div class="cart-row">
      <div class="c-info">
        <div>${esc(c.name)} <span class="c-vintage">${c.vintage ?? "NV"}</span></div>
        <input type="number" class="c-price" data-i="${i}" value="${c.unit_price}" min="0" step="1">
      </div>
      <div class="c-qty">
        <button data-i="${i}" data-d="-1">−</button>
        <span>${c.qty}</span>
        <button data-i="${i}" data-d="1">＋</button>
      </div>
    </div>`
    )
    .join("");

  $$("#cart-items .c-qty button").forEach((b) =>
    b.addEventListener("click", () => {
      const c = cart[b.dataset.i];
      c.qty += Number(b.dataset.d);
      if (c.qty <= 0) cart.splice(b.dataset.i, 1);
      if (c.qty > c.stock) c.qty = c.stock;
      renderCart();
    })
  );
  $$("#cart-items .c-price").forEach((inp) =>
    inp.addEventListener("change", () => {
      cart[inp.dataset.i].unit_price = Number(inp.value) || 0;
      renderCart();
    })
  );

  const subtotal = cart.reduce((s, c) => s + c.qty * c.unit_price, 0);
  const discount = Number($("#order-discount").value) || 0;
  $("#cart-subtotal").textContent = fmt(subtotal);
  $("#cart-total").textContent = fmt(subtotal - discount);
  $("#checkout-btn").disabled = cart.length === 0;
}

async function renderCustomerPicker() {
  const kw = $("#customer-search").value.trim();
  if (!kw) return ($("#customer-results").innerHTML = "");
  const rows = await api.getCustomers(kw);
  $("#customer-results").innerHTML = rows
    .slice(0, 5)
    .map((c) => `<div class="cust-pick" data-id="${c.id}">${esc(c.name)} ${esc(c.phone ?? "")}</div>`)
    .join("");
  $$(".cust-pick").forEach((el) =>
    el.addEventListener("click", () => {
      selectedCustomer = rows.find((c) => c.id == el.dataset.id);
      $("#customer-search").value = selectedCustomer.name;
      $("#customer-results").innerHTML = "";
    })
  );
}

async function handleCheckout() {
  if (cart.length === 0) return;
  const btn = $("#checkout-btn");
  btn.disabled = true;
  try {
    const orderId = await api.createOrder({
      customerId: selectedCustomer?.id ?? null,
      discount: Number($("#order-discount").value) || 0,
      payment: $("#payment-method").value,
      note: null,
      items: cart.map((c) => ({ product_id: c.product_id, qty: c.qty, unit_price: c.unit_price })),
    });
    alert(`結帳完成，訂單 #${orderId}`);
    cart = [];
    selectedCustomer = null;
    $("#customer-search").value = "";
    $("#order-discount").value = "";
    renderCart();
    renderPosProducts();
  } catch (e) {
    alert("結帳失敗：" + e.message);
  } finally {
    btn.disabled = false;
  }
}

// ============================================
// 庫存頁
// ============================================
async function renderStock() {
  const kw = $("#stock-search").value.trim();
  const rows = await api.getStock(kw);
  $("#stock-table").innerHTML = `
    <tr><th>酒款</th><th>年份</th><th>容量</th><th>庫位</th><th>庫存</th><th>均價成本</th><th>定價</th><th></th></tr>
    ${rows
      .map(
        (r) => `
      <tr class="${r.stock_qty <= 2 ? "low-stock" : ""}">
        <td>${esc(r.name)}</td>
        <td>${r.vintage ?? "NV"}</td>
        <td>${r.volume_ml}ml</td>
        <td>${esc(r.locations ?? "—")}</td>
        <td>${r.stock_qty}</td>
        <td>${r.avg_cost ? "$" + fmt(r.avg_cost) : "—"}</td>
        <td>$${fmt(r.list_price)}</td>
        <td><button class="btn-link-danger" data-id="${r.product_id}" data-name="${esc(r.name)}">刪除</button></td>
      </tr>`
      )
      .join("")}`;

  $$("#stock-table .btn-link-danger").forEach((btn) =>
    btn.addEventListener("click", () => handleDeleteProduct(btn.dataset.id, btn.dataset.name))
  );
}

async function handleAddProduct() {
  const name = prompt("酒款名稱：");
  if (!name) return;
  const producer = prompt("酒莊（可空）：") || null;
  const wine_type =
    prompt("類型 red/white/rose/sparkling/sweet/fortified/spirits/other（預設 red）：") || "red";
  const vintageInput = prompt("年份（NV 酒可留空）：");
  const vintage = vintageInput ? parseInt(vintageInput) || null : null;
  const volumeInput = prompt("容量 ml（預設 750）：");
  const volume_ml = volumeInput ? parseInt(volumeInput) || 750 : 750;
  const priceInput = prompt("定價：");
  const list_price = priceInput ? parseFloat(priceInput) || 0 : 0;

  try {
    await api.addProduct({ name, producer, wine_type, vintage, volume_ml, list_price });
    renderStock();
  } catch (e) {
    alert("新增失敗：" + e.message);
  }
}

async function handleDeleteProduct(id, name) {
  if (!confirm(`確定要刪除「${name}」嗎？\n（不會刪除歷史進貨/訂單紀錄，只會從開單、庫存頁下架）`)) return;
  try {
    await api.deactivateProduct(id);
    renderStock();
  } catch (e) {
    alert("刪除失敗：" + e.message);
  }
}

// ============================================
// 客戶頁
// ============================================
async function renderCustomers() {
  const kw = $("#cust-search").value.trim();
  const rows = await api.getCustomers(kw);
  $("#cust-table").innerHTML = `
    <tr><th>姓名</th><th>電話</th><th>Email</th><th>備註</th></tr>
    ${rows
      .map(
        (c) => `
      <tr>
        <td>${esc(c.name)}</td>
        <td>${esc(c.phone ?? "")}</td>
        <td>${esc(c.email ?? "")}</td>
        <td>${esc(c.note ?? "")}</td>
      </tr>`
      )
      .join("")}`;
}

async function handleAddCustomer() {
  const name = prompt("客戶姓名：");
  if (!name) return;
  const phone = prompt("電話（可空）：") || null;
  await api.addCustomer({ name, phone });
  renderCustomers();
}

// ============================================
// 操作紀錄頁
// ============================================
const ACTION_LABEL = { INSERT: "新增", UPDATE: "修改", DELETE: "刪除" };
async function renderLog() {
  const rows = await api.getAuditLog();
  $("#log-table").innerHTML = `
    <tr><th>時間</th><th>表格</th><th>動作</th><th>內容</th></tr>
    ${rows
      .map(
        (r) => `
      <tr>
        <td>${new Date(r.changed_at).toLocaleString("zh-TW")}</td>
        <td>${esc(r.table_name)}</td>
        <td>${ACTION_LABEL[r.action] ?? r.action}</td>
        <td class="log-detail">${esc(summarize(r))}</td>
      </tr>`
      )
      .join("")}`;
}

function summarize(r) {
  const d = r.new_data ?? r.old_data ?? {};
  return d.name ?? d.order_no ?? `#${r.record_id}`;
}

// ---------- 工具 ----------
function esc(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}
function fmt(n) {
  return Number(n).toLocaleString("zh-TW");
}
function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

// 折扣欄變動即時更新總計
$("#order-discount").addEventListener("input", renderCart);
