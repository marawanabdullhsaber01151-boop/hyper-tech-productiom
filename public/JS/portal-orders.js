/** @format */
/**
 * ورشة عمل المبيعات — Phase 7 (Governance & Portal project)
 * تبويبين في نفس الشاشة: طلبات معلّقة (Phase 3 القديمة) + طلبات أسعار
 * (Phase 6). فلترة العميل بتشتغل على البيانات المحمّلة بالفعل في المتصفح —
 * مفيش أي طلب شبكة إضافي وقت الكتابة في خانة البحث (أداء).
 */
const orderApi = (path, options = {}) => window.HyperTechAuth.request(path, options);
const esc = (value) => { const d = document.createElement("div"); d.textContent = value ?? ""; return d.innerHTML; };
const ordersListEl = document.getElementById("portal-orders-list");
const inquiriesListEl = document.getElementById("price-inquiries-list");
let currentPage = 1;
let hasMore = false;
let activeTab = "orders";
let rawOrders = []; // آخر نتيجة محمّلة من السيرفر، قبل أي فلترة بالاسم
let rawInquiries = [];
let customerFilterText = "";

function deliveryMethodLabel(value) {
  return value === "customer" ? "توصيل للعميل" : value === "warehouse" ? "استلام من المخزن" : "—";
}

function assignedSalesLabel(assignedSales) {
  return assignedSales?.name
    ? `<span class="assigned-badge"><i class="fa-solid fa-user-tie"></i> ${esc(assignedSales.name)}</span>`
    : `<span class="assigned-badge unassigned">مفيش مسؤول محدد</span>`;
}

/* ============================================================
   Phase 7: نافذة تأكيد عامة بديلة عن prompt()/confirm() الافتراضية
============================================================ */
function openConfirmDialog({ title, message, mode = "plain", danger = true }) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("confirm-overlay");
    const reasonWrap = document.getElementById("confirm-reason-wrap");
    const priceWrap = document.getElementById("confirm-price-wrap");
    const reasonInput = document.getElementById("confirm-reason");
    const priceInput = document.getElementById("confirm-price");
    const okBtn = document.getElementById("confirm-ok");

    document.getElementById("confirm-title").textContent = title;
    document.getElementById("confirm-message").textContent = message;
    reasonWrap.style.display = mode === "reason" ? "block" : "none";
    priceWrap.style.display = mode === "price" ? "block" : "none";
    reasonInput.value = "";
    priceInput.value = "";
    okBtn.className = danger ? "btn-danger" : "btn-primary";
    overlay.classList.add("open");

    const cleanup = (result) => {
      overlay.classList.remove("open");
      okBtn.onclick = null;
      document.getElementById("confirm-cancel").onclick = null;
      resolve(result);
    };
    okBtn.onclick = () => {
      if (mode === "reason") {
        const reason = reasonInput.value.trim();
        if (!reason) { reasonInput.focus(); return; }
        cleanup({ reason });
      } else if (mode === "price") {
        cleanup({ price: priceInput.value.trim() || null });
      } else {
        cleanup(true);
      }
    };
    document.getElementById("confirm-cancel").onclick = () => cleanup(null);
  });
}

/* ============================================================
   تبويبات + فلتر الاسم
============================================================ */
function switchTab(tab) {
  activeTab = tab;
  document.getElementById("tab-orders").classList.toggle("active", tab === "orders");
  document.getElementById("tab-inquiries").classList.toggle("active", tab === "inquiries");
  ordersListEl.style.display = tab === "orders" ? "block" : "none";
  inquiriesListEl.style.display = tab === "inquiries" ? "block" : "none";
}

function updateNeedsResponseCount() {
  const total = rawOrders.length + rawInquiries.filter((i) => i.status === "pending").length;
  const badge = document.getElementById("needs-response-count");
  if (total > 0) {
    badge.textContent = total;
    badge.style.display = "inline-flex";
  } else {
    badge.style.display = "none";
  }
  document.getElementById("orders-count").textContent = rawOrders.length ? `(${rawOrders.length})` : "";
  const pendingInquiries = rawInquiries.filter((i) => i.status === "pending").length;
  document.getElementById("inquiries-count").textContent = pendingInquiries ? `(${pendingInquiries})` : "";
}

function matchesCustomerFilter(name) {
  if (!customerFilterText) return true;
  return (name || "").toLowerCase().includes(customerFilterText.toLowerCase());
}

/* ============================================================
   طلبات معلّقة (Phase 3 — منطقها زي ما هو، ومضاف عليه اسم المسؤول
   وفلترة الاسم بس)
============================================================ */
async function loadPortalOrders(page = 1) {
  ordersListEl.innerHTML = '<div class="empty-state">جاري تحميل الطلبات...</div>';
  try {
    const limit = 20;
    const response = await orderApi(`/portal-orders/pending?limit=${limit}&page=${page}`);
    const batches = Array.isArray(response) ? response : response.data || [];
    currentPage = page;
    hasMore = batches.length === limit;
    rawOrders = batches;
    updateNeedsResponseCount();
    renderOrders();
  } catch (error) { ordersListEl.innerHTML = `<div class="empty-state">${esc(error.message)}</div>`; }
}

function renderOrders() {
  const batches = rawOrders.filter((b) => matchesCustomerFilter(b.customerName));
  if (!batches.length) {
    ordersListEl.innerHTML = `<div class="empty-state">${customerFilterText ? "مفيش طلبات لعميل بالاسم ده." : (currentPage > 1 ? "لا توجد طلبات أخرى للمراجعة." : "لا توجد طلبات جديدة للمراجعة.")}</div>`;
    renderPagination();
    return;
  }
  ordersListEl.innerHTML = batches.map((batch) => `
    <article class="sales-card" data-batch="${esc(batch.batchRef)}" style="margin-bottom:16px;padding:20px">
      <div class="sales-card-header"><div><h3>${esc(batch.customerName)}</h3><p>${esc(batch.customerPhone)} · ${esc(batch.batchRef)}</p>${assignedSalesLabel(batch.assignedSales)}</div><strong>${esc(batch.priority)}</strong></div>
      <p>${esc(batch.notes || "بدون ملاحظات")}</p>
      <div class="sales-table-wrap"><table class="sales-table"><thead><tr>
        <th>المنتج</th><th>الكمية</th><th>السعر للوحدة</th>
        <th>الميعاد المقترح</th><th>ميعاد جديد (اختياري)</th>
        <th>طريقة التسليم المقترحة</th><th>تعديلها (اختياري)</th>
        <th></th>
      </tr></thead>
      <tbody>${batch.items.map((item) => `<tr data-item-row="${item.id}">
        <td>${esc(item.productName)}</td>
        <td>${esc(item.qty)} ${esc(item.unit)}</td>
        <td><input class="portal-price" data-id="${item.id}" type="number" min="0" step="0.01" placeholder="${item.referenceUnitPrice ? "مرجعي: " + esc(item.referenceUnitPrice) : "ج.م"}" /></td>
        <td>${esc(item.suggestedDueDate || item.neededBy || "—")}</td>
        <td><input class="portal-duedate-override" data-id="${item.id}" type="date" /></td>
        <td>${deliveryMethodLabel(item.suggestedDeliveryMethod)}</td>
        <td>
          <select class="portal-delivery-override" data-id="${item.id}">
            <option value="">بدون تعديل</option>
            <option value="customer">توصيل للعميل</option>
            <option value="warehouse">استلام من المخزن</option>
          </select>
        </td>
        <td><button type="button" class="btn-danger portal-cancel-item" data-id="${item.id}" title="إلغاء هذا الصنف فقط">إلغاء الصنف</button></td>
      </tr>`).join("")}</tbody></table></div>
      <div class="form-row" style="margin-top:14px;display:flex;gap:12px;flex-wrap:wrap">
        <label>الموعد المتوقع للإرسالية كلها <input class="portal-delivery" type="date" /></label>
        <label style="flex:1;min-width:200px">سبب أي تعديل تاريخ/طريقة تسليم <input class="portal-override-reason" type="text" placeholder="اختياري — يُسجَّل في سجل المراجعة" /></label>
        <label style="flex:1;min-width:240px">رسالة للعميل <input class="portal-reply" type="text" placeholder="سيظهر الرد في طلباتي" /></label>
      </div>
      <div style="display:flex;gap:10px;margin-top:16px"><button class="btn-primary portal-confirm">تأكيد وإرسال للمسار الداخلي</button><button class="btn-danger portal-reject">رفض الطلب</button></div>
    </article>`).join("");
  document.querySelectorAll(".portal-confirm").forEach((button) => button.addEventListener("click", () => review(button.closest("[data-batch]"), false)));
  document.querySelectorAll(".portal-reject").forEach((button) => button.addEventListener("click", () => review(button.closest("[data-batch]"), true)));
  document.querySelectorAll(".portal-cancel-item").forEach((button) => button.addEventListener("click", () => cancelItem(button)));
  renderPagination();
}

function renderPagination() {
  const controls = document.createElement("div");
  controls.className = "portal-pagination";
  controls.innerHTML = `<button type="button" ${currentPage <= 1 ? "disabled" : ""}>السابق</button><span>صفحة ${currentPage}</span><button type="button" ${hasMore ? "" : "disabled"}>التالي</button>`;
  const [previous, next] = controls.querySelectorAll("button");
  previous.addEventListener("click", () => loadPortalOrders(Math.max(1, currentPage - 1)));
  next.addEventListener("click", () => loadPortalOrders(currentPage + 1));
  ordersListEl.appendChild(controls);
}

// Phase 3: إلغاء صنف واحد بس من غير ما يأثر على باقي أصناف نفس الإرسالية.
async function cancelItem(button) {
  const id = button.dataset.id;
  const result = await openConfirmDialog({ title: "إلغاء الصنف", message: "اكتب سبب إلغاء هذا الصنف؟", mode: "reason" });
  if (!result) return;
  button.disabled = true;
  try {
    await orderApi(`/portal-orders/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason: result.reason }) });
    await loadPortalOrders(currentPage);
  } catch (error) {
    console.error("[portal-orders]", error);
    alert(error.message);
    button.disabled = false;
  }
}

async function review(card, rejected) {
  const batchRef = card.dataset.batch;
  const delivery = card.querySelector(".portal-delivery").value || null;
  const replyMessage = card.querySelector(".portal-reply").value.trim() || null;
  const overrideReason = card.querySelector(".portal-override-reason").value.trim() || null;
  const buttons = [...card.querySelectorAll("button")];

  if (rejected) {
    const result = await openConfirmDialog({ title: "رفض الطلب", message: "اكتب سبب رفض الطلب — هيتبعت للعميل", mode: "reason" });
    if (!result) return;
    buttons.forEach((b) => { b.disabled = true; b.setAttribute("aria-busy", "true"); });
    try {
      await orderApi(`/portal-orders/${encodeURIComponent(batchRef)}/reject`, { method: "POST", body: JSON.stringify({ reason: result.reason, replyMessage, expectedDelivery: delivery }) });
      await loadPortalOrders(currentPage);
    } catch (error) {
      console.error("[portal-orders]", error);
      alert(error.message);
    } finally {
      buttons.forEach((b) => { b.disabled = false; b.removeAttribute("aria-busy"); });
    }
    return;
  }

  buttons.forEach((b) => { b.disabled = true; b.setAttribute("aria-busy", "true"); });
  try {
    const items = [...card.querySelectorAll(".portal-price")].map((input) => {
      const id = Number(input.dataset.id);
      const dueDateOverride = card.querySelector(`.portal-duedate-override[data-id="${id}"]`).value || null;
      const deliveryMethodOverride = card.querySelector(`.portal-delivery-override[data-id="${id}"]`).value || null;
      return {
        workflowOrderId: id,
        unitPrice: input.value,
        dueDateOverride,
        deliveryMethodOverride,
        overrideReason: (dueDateOverride || deliveryMethodOverride) ? overrideReason : null,
      };
    });
    if (items.some((item) => !item.unitPrice)) { alert("حدد سعر كل صنف أولاً"); return; }
    await orderApi(`/portal-orders/${encodeURIComponent(batchRef)}/confirm`, { method: "POST", body: JSON.stringify({ items, replyMessage, expectedDelivery: delivery }) });
    await loadPortalOrders(currentPage);
  } catch (error) {
    console.error("[portal-orders]", error);
    alert(error.message);
  } finally {
    buttons.forEach((b) => { b.disabled = false; b.removeAttribute("aria-busy"); });
  }
}

/* ============================================================
   Phase 6 + 7: طلبات الأسعار المعلّقة، في نفس الورشة
============================================================ */
async function loadPriceInquiries() {
  inquiriesListEl.innerHTML = '<div class="empty-state">جاري تحميل طلبات الأسعار...</div>';
  try {
    rawInquiries = await orderApi("/price-inquiries/pending");
    updateNeedsResponseCount();
    renderInquiries();
  } catch (error) { inquiriesListEl.innerHTML = `<div class="empty-state">${esc(error.message)}</div>`; }
}

function renderInquiries() {
  const inquiries = rawInquiries.filter((i) => matchesCustomerFilter(i.customerName));
  if (!inquiries.length) {
    inquiriesListEl.innerHTML = `<div class="empty-state">${customerFilterText ? "مفيش طلبات سعر لعميل بالاسم ده." : "لا توجد طلبات أسعار جديدة."}</div>`;
    return;
  }
  inquiriesListEl.innerHTML = inquiries.map((inq) => `
    <article class="sales-card" data-inquiry="${inq.id}" style="margin-bottom:16px;padding:20px">
      <div class="sales-card-header">
        <div><h3>${esc(inq.customerName)}</h3><p>${esc(inq.customerPhone)}</p>${assignedSalesLabel(inq.assignedSales)}</div>
      </div>
      <p><strong>سأل عن:</strong> ${esc(inq.productName)} — كمية ${esc(inq.requestedQty)} قطعة</p>
      <p><strong>السعر المقترح من النظام:</strong> ${inq.suggestedPrice ? esc(inq.suggestedPrice) + " جنيه" : "مفيش سعر مقترح مسجّل للمنتج ده"}</p>
      <div style="display:flex;gap:10px;margin-top:12px">
        <button class="btn-primary btn-answer-inquiry" data-id="${inq.id}">الردّ بالسعر</button>
      </div>
    </article>`).join("");
  document.querySelectorAll(".btn-answer-inquiry").forEach((btn) =>
    btn.addEventListener("click", () => answerInquiry(btn)),
  );
}

async function answerInquiry(button) {
  const id = button.dataset.id;
  const result = await openConfirmDialog({
    title: "الردّ على طلب السعر",
    message: "اتركه فاضي عشان تبعت السعر المقترح كما هو، أو اكتب سعر جديد.",
    mode: "price",
    danger: false,
  });
  if (result === null) return;
  button.disabled = true;
  try {
    await orderApi(`/price-inquiries/${id}/answer`, {
      method: "POST",
      body: JSON.stringify({ finalPrice: result.price || undefined }),
    });
    await loadPriceInquiries();
  } catch (error) {
    console.error("[price-inquiries]", error);
    alert(error.message);
    button.disabled = false;
  }
}

/* ============================================================
   ربط الأحداث
============================================================ */
document.getElementById("refresh-orders").addEventListener("click", () => {
  loadPortalOrders(activeTab === "orders" ? currentPage : 1);
  loadPriceInquiries();
});
document.getElementById("tab-orders").addEventListener("click", () => switchTab("orders"));
document.getElementById("tab-inquiries").addEventListener("click", () => switchTab("inquiries"));
document.getElementById("customer-filter").addEventListener("input", (e) => {
  customerFilterText = e.target.value.trim();
  renderOrders();
  renderInquiries();
});

loadPortalOrders(1);
loadPriceInquiries();
