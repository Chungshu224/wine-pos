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
let posProducts = []; // current POS product list (per-location rows)
let selectedCustomer = null;
let ordersPage = 0;
const ORDERS_PER_PAGE = 30;

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
  $("#cust-edit-back").addEventListener("click", closeCustomerEdit);
  $("#cust-edit-cancel").addEventListener("click", closeCustomerEdit);
  $("#cust-delete-btn").addEventListener("click", handleDeleteCustomerFromEdit);
  $("#cust-form").addEventListener("submit", submitCustomerEdit);

  // 訂單頁
  setDefaultOrderDateRange();
  $("#order-search").addEventListener("input", debounce(() => { ordersPage = 0; renderOrders(); }, 300));
  $("#order-status-filter").addEventListener("change", () => { ordersPage = 0; renderOrders(); });
  $("#order-date-from").addEventListener("change", () => { ordersPage = 0; renderOrders(); });
  $("#order-date-to").addEventListener("change", () => { ordersPage = 0; renderOrders(); });
  $("#pay-modal-backdrop").addEventListener("click", closePayModal);
  $("#pay-modal-cancel").addEventListener("click", closePayModal);
  $("#pay-form").addEventListener("submit", submitPayModal);
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
  checkPaymentReminders();
}

function switchTab(tab) {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  $$(".page").forEach((p) => (p.hidden = p.id !== `page-${tab}`));
  if (tab === "pos") renderPosProducts();
  if (tab === "stock") renderStock();
  if (tab === "customers") renderCustomers();
  if (tab === "orders") { renderOrders(); checkPaymentReminders(); }
  if (tab === "log") renderLog();
}

// ============================================
// 開單頁
// ============================================
async function renderPosProducts() {
  const kw = $("#pos-search").value.trim();
  posProducts = await api.getStockLocations(kw);
  const display = posProducts.filter((r) => r.stock_qty > 0);
  $("#pos-products").innerHTML = display
    .map(
      (r, i) => `
    <div class="product-card" data-idx="${i}">
      <div class="p-name">${esc(r.name)}${r.location ? `<span class="p-loc">${esc(r.location)}</span>` : ""}</div>
      <div class="p-meta">${r.vintage ?? "NV"} · ${r.volume_ml}ml</div>
      <div class="p-row">
        <span class="p-price">$${fmt(r.list_price)}</span>
        <span class="p-stock">庫存 ${r.stock_qty}</span>
      </div>
    </div>`
    )
    .join("");

  $$("#pos-products .product-card").forEach((card) =>
    card.addEventListener("click", () => {
      const r = display[Number(card.dataset.idx)];
      if (r) addToCart(r);
    })
  );
}

const DISCOUNT_RATE_OPTIONS = [
  { value: 1,    label: "無折扣" },
  { value: 0.8,  label: "八折" },
  { value: 0.7,  label: "七折" },
  { value: 0.65, label: "六五折" },
  { value: 0.6,  label: "六折" },
  { value: 0,    label: "免費" },
];

function addToCart(r) {
  const totalStock = posProducts
    .filter((x) => x.product_id === r.product_id)
    .reduce((s, x) => s + x.stock_qty, 0);
  const existing = cart.find((c) => c.product_id === r.product_id);
  if (existing) {
    if (existing.qty >= totalStock) return alert("已達庫存上限");
    existing.qty++;
    existing.stock = totalStock;
  } else {
    cart.push({
      product_id: r.product_id,
      name: r.name,
      vintage: r.vintage,
      qty: 1,
      list_price: Number(r.list_price), // 牌價，不可更動
      rate: 1,                          // 該品項套用的折扣
      stock: totalStock,
    });
  }
  renderCart();
}

function finalPrice(c) {
  return Math.round(c.list_price * c.rate);
}

function renderCart() {
  $("#cart-items").innerHTML = cart
    .map(
      (c, i) => `
    <div class="cart-row">
      <div class="c-info">
        <div>${esc(c.name)} <span class="c-vintage">${c.vintage ?? "NV"}</span></div>
        <div class="c-price-row">
          <span class="c-list-price ${c.rate < 1 ? "discounted" : ""}">$${fmt(c.list_price)}</span>
          <select class="c-rate" data-i="${i}">
            ${DISCOUNT_RATE_OPTIONS.map(
              (o) => `<option value="${o.value}" ${c.rate === o.value ? "selected" : ""}>${o.label}</option>`
            ).join("")}
          </select>
          ${c.rate < 1 ? `<span class="c-final-price">$${fmt(finalPrice(c))}</span>` : ""}
        </div>
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
  $$("#cart-items .c-rate").forEach((sel) =>
    sel.addEventListener("change", () => {
      cart[sel.dataset.i].rate = Number(sel.value);
      renderCart();
    })
  );

  const subtotal = cart.reduce((s, c) => s + c.qty * c.list_price, 0);
  const total = cart.reduce((s, c) => s + c.qty * finalPrice(c), 0);
  const discount = subtotal - total;
  $("#cart-subtotal").textContent = fmt(subtotal);
  const discLine = $("#cart-discount-line");
  if (discount > 0) {
    $("#cart-discount-amt").textContent = fmt(discount);
    discLine.style.display = "";
  } else {
    discLine.style.display = "none";
  }
  $("#cart-total").textContent = fmt(total);
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
  if ($("#payment-method").value === "monthly" && !selectedCustomer) {
    alert("月結付款需先選擇客戶");
    return;
  }
  const btn = $("#checkout-btn");
  btn.disabled = true;
  try {
    const orderId = await api.createOrder({
      customerId: selectedCustomer?.id ?? null,
      payment: $("#payment-method").value,
      note: $("#order-note").value.trim() || null,
      items: cart.map((c) => ({
        product_id: c.product_id,
        qty: c.qty,
        unit_price: finalPrice(c),
        list_price: c.list_price,
      })),
    });
    alert(`出單完成，訂單 #${orderId}\n（尚未收款，請至「訂單」頁確認收款）`);
    cart = [];
    selectedCustomer = null;
    $("#customer-search").value = "";
    $("#order-note").value = "";
    renderCart();
    renderPosProducts();
  } catch (e) {
    alert("出單失敗：" + e.message);
  } finally {
    btn.disabled = false;
  }
}

// ============================================
// 庫存頁
// ============================================
async function renderStock() {
  const kw = $("#stock-search").value.trim();
  const rows = await api.getStockLocations(kw);
  $("#stock-table").innerHTML = `
    <tr><th>庫位</th><th>酒款</th><th>年份</th><th>容量</th><th>庫存</th><th>均價成本</th><th>定價</th><th></th></tr>
    ${rows
      .map(
        (r, i) => `
      <tr class="${r.stock_qty <= 2 ? "low-stock" : ""}">
        <td>${esc(r.location ?? "—")}</td>
        <td>${esc(r.name)}</td>
        <td>${r.vintage ?? "NV"}</td>
        <td>${r.volume_ml}ml</td>
        <td>${r.stock_qty}</td>
        <td>${r.avg_cost ? "$" + fmt(r.avg_cost) : "—"}</td>
        <td>$${fmt(r.list_price)}</td>
        <td class="row-actions">
          <button class="btn-link-purchase" data-idx="${i}">進貨</button>
          <button class="btn-link-edit" data-id="${r.product_id}">編輯</button>
          <button class="btn-link-danger" data-id="${r.product_id}" data-name="${esc(r.name)}">刪除</button>
        </td>
      </tr>`
      )
      .join("")}`;

  $$("#stock-table .btn-link-purchase").forEach((btn) =>
    btn.addEventListener("click", () => handleAddPurchase(rows[Number(btn.dataset.idx)]))
  );
  $$("#stock-table .btn-link-edit").forEach((btn) =>
    btn.addEventListener("click", () => {
      const r = rows.find((x) => x.product_id == btn.dataset.id);
      handleEditProduct(r);
    })
  );
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

async function handleEditProduct(r) {
  const name = prompt("酒款名稱：", r.name);
  if (name === null) return;
  const vintageInput = prompt("年份（NV 酒可留空）：", r.vintage ?? "");
  const vintage = vintageInput ? parseInt(vintageInput) || null : null;
  const volumeInput = prompt("容量 ml：", r.volume_ml);
  const volume_ml = parseInt(volumeInput) || 750;
  const priceInput = prompt("定價：", r.list_price);
  const list_price = parseFloat(priceInput) || 0;
  try {
    await api.updateProduct(r.product_id, { name, vintage, volume_ml, list_price });
    renderStock();
  } catch (e) {
    alert("編輯失敗：" + e.message);
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

async function handleAddPurchase(r) {
  const location = prompt("庫位：", r.location ?? "");
  if (location === null) return;
  const supplier = prompt("供應商（可空）：") || null;
  const costInput = prompt("進貨單價：");
  if (!costInput) return;
  const unit_cost = parseFloat(costInput);
  if (isNaN(unit_cost) || unit_cost < 0) return alert("請輸入有效單價");
  const qtyInput = prompt("進貨數量：");
  if (!qtyInput) return;
  const qty_in = parseInt(qtyInput);
  if (isNaN(qty_in) || qty_in <= 0) return alert("請輸入有效數量");
  const note = prompt("備註（可空）：") || null;
  try {
    await api.addPurchase({
      product_id: r.product_id,
      supplier,
      unit_cost,
      qty_in,
      location: location || null,
      note,
    });
    renderStock();
  } catch (e) {
    alert("進貨失敗：" + e.message);
  }
}

// ============================================
// 客戶頁
// ============================================
async function renderCustomers() {
  const kw = $("#cust-search").value.trim();
  const rows = await api.getCustomers(kw);
  $("#cust-table").innerHTML = `
    <tr><th>姓名／名稱</th><th>統一編號</th><th>抬頭</th><th>電話</th><th>地址</th><th></th></tr>
    ${rows
      .map(
        (c, i) => `
      <tr>
        <td>${esc(c.name)}</td>
        <td>${esc(c.tax_id ?? "")}</td>
        <td>${esc(c.tax_title ?? "")}</td>
        <td>${esc(c.phone ?? "")}</td>
        <td>${esc(c.address ?? "")}</td>
        <td class="row-actions">
          <button class="btn-link-edit" data-idx="${i}">編輯</button>
          <button class="btn-link-danger" data-id="${c.id}" data-name="${esc(c.name)}">刪除</button>
        </td>
      </tr>`
      )
      .join("")}`;
  $$("#cust-table .btn-link-edit").forEach((btn) =>
    btn.addEventListener("click", () => openCustomerEdit(rows[Number(btn.dataset.idx)]))
  );
  $$("#cust-table .btn-link-danger").forEach((btn) =>
    btn.addEventListener("click", () => handleDeleteCustomer(btn.dataset.id, btn.dataset.name))
  );
}

function handleAddCustomer() {
  openCustomerEdit(null);
}

// ---------- 客戶編輯頁 ----------
let _custEditId = null;
let _custEditName = null;

function openCustomerEdit(c) {
  _custEditId = c?.id ?? null;
  _custEditName = c?.name ?? null;
  $("#cust-edit-title").textContent = c ? "編輯客戶" : "新增客戶";
  $("#cust-delete-btn").style.visibility = c ? "visible" : "hidden";
  $("#cf-name").value      = c?.name      ?? "";
  $("#cf-tax-id").value    = c?.tax_id    ?? "";
  $("#cf-tax-title").value = c?.tax_title ?? "";
  $("#cf-phone").value     = c?.phone     ?? "";
  $("#cf-email").value     = c?.email     ?? "";
  $("#cf-address").value   = c?.address   ?? "";
  $("#cf-note").value      = c?.note      ?? "";
  $$(".page").forEach((p) => (p.hidden = p.id !== "page-customer-edit"));
  $("#cf-name").focus();
}

function closeCustomerEdit() {
  $$(".page").forEach((p) => (p.hidden = p.id !== "page-customers"));
  renderCustomers();
}

async function submitCustomerEdit(e) {
  e.preventDefault();
  const fields = {
    name:      $("#cf-name").value.trim(),
    tax_id:    $("#cf-tax-id").value.trim()    || null,
    tax_title: $("#cf-tax-title").value.trim() || null,
    phone:     $("#cf-phone").value.trim()     || null,
    email:     $("#cf-email").value.trim()     || null,
    address:   $("#cf-address").value.trim()   || null,
    note:      $("#cf-note").value.trim()      || null,
  };
  if (!fields.name) return;
  try {
    if (_custEditId) {
      await api.updateCustomer(_custEditId, fields);
    } else {
      await api.addCustomer(fields);
    }
    closeCustomerEdit();
  } catch (e) {
    alert("儲存失敗：" + e.message);
  }
}

async function handleDeleteCustomer(id, name) {
  if (!confirm(`確定要刪除「${name}」嗎？\n（不會刪除歷史訂單紀錄，只會從客戶、開單頁下架）`)) return;
  try {
    await api.deactivateCustomer(id);
    renderCustomers();
  } catch (e) {
    alert("刪除失敗：" + e.message);
  }
}

async function handleDeleteCustomerFromEdit() {
  if (!_custEditId) return;
  if (!confirm(`確定要刪除「${_custEditName}」嗎？\n（不會刪除歷史訂單紀錄，只會從客戶、開單頁下架）`)) return;
  try {
    await api.deactivateCustomer(_custEditId);
    closeCustomerEdit();
  } catch (e) {
    alert("刪除失敗：" + e.message);
  }
}

// ============================================
// 訂單頁
// ============================================
const PAYMENT_LABEL = { cash: "現金", card: "刷卡", transfer: "轉帳", monthly: "月結", other: "其他" };
const PAID_METHOD_LABEL = { cash: "現金", transfer: "轉帳" };

// ---------- 月結日期計算 ----------
function monthlyDueDate(createdAt) {
  const d = new Date(createdAt);
  return new Date(d.getFullYear(), d.getMonth() + 2, 0); // 下個月最後一天
}
function monthlyReminderDate(createdAt) {
  const due = monthlyDueDate(createdAt);
  return new Date(due.getFullYear(), due.getMonth() + 1, 5); // 到期月的再下一個月5日
}
function paymentStatusCell(r) {
  if (r.payment_method === "card") return `<span class="pay-tag pay-ok">刷卡✓</span>`;
  if (r.paid_at) {
    const d = new Date(r.paid_at).toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    const method = PAID_METHOD_LABEL[r.paid_method];
    const who = r.paid_by_profile?.display_name;
    return `<span class="pay-tag pay-ok">已收 ${d}${method ? "・" + method : ""}${who ? "・" + esc(who) : ""}</span>`;
  }
  if (r.payment_method === "monthly") {
    const due = monthlyDueDate(r.created_at);
    const isOverdue = new Date() > due;
    const dueStr = due.toLocaleDateString("zh-TW", { month: "2-digit", day: "2-digit" });
    return `<span class="pay-tag ${isOverdue ? "pay-overdue" : "pay-monthly"}">月結 ${dueStr}${isOverdue ? " ⚠" : ""}</span><br>
      <button class="btn-confirm-pay" data-id="${r.id}">確認收款</button>`;
  }
  return `<span class="pay-tag pay-pending">未收款</span><br>
    <button class="btn-confirm-pay" data-id="${r.id}">確認收款</button>`;
}

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function setDefaultOrderDateRange() {
  const now = new Date();
  $("#order-date-from").value = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
  $("#order-date-to").value = ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0));
}

async function renderOrders() {
  const kw = $("#order-search").value.trim();
  const status = $("#order-status-filter").value;
  const dateFrom = $("#order-date-from").value;
  const dateTo = $("#order-date-to").value;

  const { data: rows, count } = await api.getOrders({
    keyword: kw, status, dateFrom, dateTo,
    limit: ORDERS_PER_PAGE, offset: ordersPage * ORDERS_PER_PAGE,
  });

  $("#orders-table").innerHTML = `
    <tr><th>時間</th><th>單號</th><th>狀態</th><th>付款</th><th>金額</th><th>顧客</th><th>品項數</th><th>收款</th><th></th></tr>
    ${rows.map((r) => `
      <tr>
        <td>${new Date(r.created_at).toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
        <td><span class="order-no">${esc(r.order_no)}</span></td>
        <td><span class="status-chip ${r.status}">${r.status === "completed" ? "已完成" : "已作廢"}</span></td>
        <td>${PAYMENT_LABEL[r.payment_method] ?? r.payment_method}</td>
        <td class="order-total">$${fmt(r.total)}</td>
        <td>${esc(r.customers?.name ?? "散客")}</td>
        <td>${r.order_items?.length ?? 0} 件</td>
        <td>${paymentStatusCell(r)}</td>
        <td><button class="btn-link-print" data-id="${r.id}">列印</button></td>
      </tr>`).join("")}`;

  $$("#orders-table .btn-confirm-pay").forEach((btn) =>
    btn.addEventListener("click", () => openPayModal(Number(btn.dataset.id)))
  );
  $$("#orders-table .btn-link-print").forEach((btn) =>
    btn.addEventListener("click", () => printOrder(Number(btn.dataset.id)))
  );
  const totalPages = Math.ceil(count / ORDERS_PER_PAGE);
  const pg = $("#orders-pagination");
  if (totalPages <= 1) {
    pg.innerHTML = "";
    return;
  }
  pg.innerHTML = `
    <button id="orders-prev" ${ordersPage === 0 ? "disabled" : ""}>上一頁</button>
    <span>${ordersPage + 1} / ${totalPages}</span>
    <button id="orders-next" ${ordersPage >= totalPages - 1 ? "disabled" : ""}>下一頁</button>`;
  $("#orders-prev").addEventListener("click", () => { ordersPage--; renderOrders(); });
  $("#orders-next").addEventListener("click", () => { ordersPage++; renderOrders(); });
}

// ---------- 收款確認 Dialog ----------
let _payOrderId = null;

function toLocalDatetimeInputValue(date) {
  const tzOffsetMs = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - tzOffsetMs).toISOString().slice(0, 16);
}

function openPayModal(orderId) {
  _payOrderId = orderId;
  $("#pf-method").value = "cash";
  $("#pf-time").value = toLocalDatetimeInputValue(new Date());
  $("#pf-confirmer").value = $("#user-name").textContent;
  $("#pay-modal").hidden = false;
}

function closePayModal() {
  $("#pay-modal").hidden = true;
  _payOrderId = null;
}

async function submitPayModal(e) {
  e.preventDefault();
  if (!_payOrderId) return;
  const paidMethod = $("#pf-method").value;
  const timeVal = $("#pf-time").value;
  if (!timeVal) return;
  try {
    await api.confirmPayment(_payOrderId, {
      paidAt: new Date(timeVal).toISOString(),
      paidMethod,
    });
    closePayModal();
    await renderOrders();
    checkPaymentReminders();
  } catch (e) {
    alert("確認失敗：" + e.message);
  }
}

async function checkPaymentReminders() {
  let rows;
  try { rows = await api.getUnpaidOrders(); }
  catch { return; }

  const today = new Date();
  const reminderDue = rows.filter(
    (r) => r.payment_method === "monthly" && today >= monthlyReminderDate(r.created_at)
  );

  const badge = $("#payment-badge");
  if (rows.length > 0) { badge.textContent = rows.length; badge.hidden = false; }
  else { badge.hidden = true; }

  const bar = $("#notif-bar");
  if (reminderDue.length > 0) {
    bar.textContent = `⚠ 有 ${reminderDue.length} 筆月結訂單已到提醒日（每月5日），請至「訂單」頁確認是否收款`;
    bar.hidden = false;
  } else {
    bar.hidden = true;
  }
}

async function printOrder(orderId) {
  let order;
  try { order = await api.getOrderById(orderId); }
  catch (e) { alert("載入失敗：" + e.message); return; }

  const cust = order.customers;
  const custBlock = cust
    ? `<p><strong>客戶：${esc(cust.name)}</strong></p>
       ${cust.phone   ? `<p>電話：${esc(cust.phone)}</p>` : ""}
       ${cust.email   ? `<p>Email：${esc(cust.email)}</p>` : ""}
       ${cust.address ? `<p>地址：${esc(cust.address)}</p>` : ""}`
    : `<p>散客</p>`;

  const itemRows = (order.order_items ?? []).map((it, i) => {
    const p = it.products;
    return `<tr>
      <td>${i + 1}</td>
      <td>${esc(p.name)}</td>
      <td>${p.vintage ?? "NV"}</td>
      <td>${p.volume_ml}ml</td>
      <td style="text-align:right">$${fmt(it.unit_price)}</td>
      <td style="text-align:right">${it.qty}</td>
      <td style="text-align:right">$${fmt(it.line_total)}</td>
    </tr>`;
  }).join("");

  const discountRow = order.discount > 0
    ? `<div>折讓 &minus;$${fmt(order.discount)}</div>` : "";

  const html = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8">
  <title>法侍酒業訂單 ${esc(order.order_no)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:"Noto Sans TC",sans-serif;max-width:800px;margin:2rem auto;padding:0 1.5rem;color:#222;font-size:14px}
    h1{text-align:center;font-size:1.4rem;margin:1rem 0;padding-bottom:.6rem;border-bottom:2px solid #222}
    .section{margin:1rem 0;line-height:1.8}
    .order-meta{font-size:.88rem;color:#555;margin-bottom:1rem}
    table{width:100%;border-collapse:collapse;margin-top:.5rem}
    thead th{background:#f2f2f2;padding:.45rem .6rem;text-align:left;border-top:2px solid #333;border-bottom:2px solid #333;font-size:.88rem}
    tbody td{padding:.4rem .6rem;border-bottom:1px solid #ddd}
    .totals{text-align:right;margin-top:1rem;line-height:2}
    .totals .grand{font-size:1.25rem;font-weight:700}
    .footer{display:flex;gap:2rem;margin-top:2rem;padding-top:1rem;border-top:1px solid #ddd;font-size:.85rem;color:#555;line-height:1.7}
    .footer-right{margin-left:auto;text-align:right}
    .print-btn{display:block;margin:0 auto 1.5rem;padding:.5rem 1.8rem;background:#5e1224;color:#fff;border:none;border-radius:3px;cursor:pointer;font-size:.95rem}
    @media print{.print-btn{display:none}}
  </style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">列印 / 儲存 PDF</button>
  <h1>法侍酒業訂單</h1>
  <div class="section">${custBlock}</div>
  <p class="order-meta">
    訂單編號：${esc(order.order_no)}&emsp;
    日期：${new Date(order.created_at).toLocaleDateString("zh-TW")}&emsp;
    付款：${PAYMENT_LABEL[order.payment_method] ?? order.payment_method}
  </p>
  <table>
    <thead>
      <tr><th>#</th><th>項目</th><th>年份</th><th>容量</th><th style="text-align:right">單價</th><th style="text-align:right">數量</th><th style="text-align:right">小計</th></tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>
  <div class="totals">
    <div>小計 $${fmt(order.subtotal)}</div>
    ${discountRow}
    <div class="grand">收款金額 $${fmt(order.total)}</div>
  </div>
  <div class="footer">
    <div><strong>備註</strong><br>${esc(order.note ?? "")}</div>
    <div class="footer-right">法侍酒業</div>
  </div>
</body>
</html>`;

  const win = window.open("", "_blank");
  win.document.write(html);
  win.document.close();
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
