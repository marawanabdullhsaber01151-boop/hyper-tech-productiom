/** @format */

// ✅ إصلاح باگ كارثي: كانت controlApi بتمرر options.body زي ما هو لـ
// window.HyperTechAuth.request، واللي بدورها بتمرره مباشرة لـ fetch()
// من غير أي stringify. لما body تبقى كائن JS خام (زي ما كل الفورمات في
// الصفحة دي كانت بتبعته: `body: data` بدل `body: JSON.stringify(data)`)،
// fetch بيحوّلها لنص "[object Object]" حرفيًا بدل JSON حقيقي — والسيرفر
// كان بيرفض الطلب. ده كان معناه إن الـ12 فورم في الصفحة دي (إنشاء منتج،
// اعتماد BOM، خطة MRP، فتح NCR...) معطّلين بالكامل. الإصلاح هنا من نقطة
// مركزية واحدة (controlApi نفسها) بدل تعديل كل استدعاء لوحده.
const controlApi = (path, options = {}) => {
  if (options.body && typeof options.body !== "string") {
    options = { ...options, body: JSON.stringify(options.body) };
  }
  return window.HyperTechAuth.request(path, options);
};
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
const formObject = (form) => Object.fromEntries(new FormData(form).entries());

function toast(message, error = false) {
  const element = document.getElementById("control-toast");
  element.textContent = message;
  element.className = `toast show ${error ? "error" : ""}`;
  setTimeout(() => element.classList.remove("show"), 3200);
}

function parseJsonField(value, fallback) {
  if (!value.trim()) return fallback;
  return JSON.parse(value);
}

function fillSelect(select, items, valueKey, labelFn, placeholder) {
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">${esc(placeholder)}</option>` +
    items.map((item) => `<option value="${esc(item[valueKey])}">${esc(labelFn(item))}</option>`).join("");
  if (items.some((item) => String(item[valueKey]) === current)) select.value = current;
}

function disableSelect(select, message) {
  if (!select) return;
  select.innerHTML = `<option value="">${esc(message)}</option>`;
  select.disabled = true;
}

// ✨ نظام موحّد لتغذية قوائم الاختيار (select) بدل كتابة المعرّفات يدويًا:
// - كل select عليه data-lookup="productId|versionId|materialRequirementId|itemCode"
//   بيتملى من الكتالوج المناسب.
// - كل select عليه data-role="order-picker" بيتملى بأوامر الإنتاج، ولما
//   يتغيّر بيجيب دفعات الأمر ده ويملى بيها الـselect المشار إليه في
//   data-batch-target.
async function loadOrderPickerLookups() {
  let orders = [];
  try {
    orders = await controlApi("/operations-control/lookups/production-orders");
    if (!Array.isArray(orders)) orders = [];
  } catch (error) {
    document.querySelectorAll('[data-role="order-picker"]').forEach((select) => disableSelect(select, "غير متاح لدورك الحالي"));
    document.querySelectorAll('select[data-batch-target]').forEach((select) => disableSelect(select, "—"));
    return;
  }
  document.querySelectorAll('[data-role="order-picker"]').forEach((picker) => {
    fillSelect(picker, orders, "id", (o) => `${o.orderNumber || o.id} — ${o.productName || ""}`.trim(), "اختر أمر الإنتاج...");
    const targetId = picker.dataset.batchTarget;
    const target = targetId ? document.getElementById(targetId) : null;
    if (!target) return;
    picker.addEventListener("change", async () => {
      if (!picker.value) { disableSelectPlaceholder(target, "اختر أمر الإنتاج أولًا"); return; }
      target.disabled = true;
      target.innerHTML = `<option value="">جارٍ التحميل...</option>`;
      try {
        const batches = await controlApi(`/operations/orders/${picker.value}/batches`);
        const list = Array.isArray(batches) ? batches : [];
        fillSelect(target, list, "id", (b) => `${b.batchNumber || b.id} — ${b.stage || ""} (${b.status || ""})`.trim(), target.id === "ncr-batch" ? "بدون دفعة محددة (اختياري)" : "اختر الدفعة...");
        target.disabled = false;
      } catch (error) {
        disableSelect(target, "تعذّر تحميل دفعات هذا الأمر");
      }
    });
  });
}

function disableSelectPlaceholder(select, message) {
  select.innerHTML = `<option value="">${esc(message)}</option>`;
  select.disabled = true;
}

async function loadEngineeringLookups() {
  let products = [];
  try {
    const response = await controlApi("/engineering/products");
    products = response || [];
  } catch (error) {
    document.querySelectorAll('[data-lookup="productId"]').forEach((select) => disableSelect(select, "غير متاح لدورك الحالي"));
    document.querySelectorAll('[data-lookup="versionId"]').forEach((select) => disableSelect(select, "غير متاح لدورك الحالي"));
    return;
  }
  document.querySelectorAll('[data-lookup="productId"]').forEach((select) => {
    fillSelect(select, products, "id", (p) => `${p.code} — ${p.name}`, "اختر المنتج...");
  });
  // اجمع كل الإصدارات من كل المنتجات في قائمة واحدة مسطّحة
  const versionSelects = document.querySelectorAll('[data-lookup="versionId"]');
  if (versionSelects.length && products.length) {
    try {
      const details = await Promise.all(products.map((p) => controlApi(`/engineering/products/${p.id}`).catch(() => null)));
      const versions = [];
      details.forEach((detail, index) => {
        if (!detail || !detail.versions) return;
        const product = products[index];
        (detail.versions || []).forEach((version) => {
          versions.push({ id: version.id, label: `${product.code} — v${version.version} (${version.status})` });
        });
      });
      versionSelects.forEach((select) => fillSelect(select, versions, "id", (v) => v.label, select.dataset.emptyLabel || "اختر الإصدار..."));
    } catch (error) {
      versionSelects.forEach((select) => disableSelect(select, "غير متاح لدورك الحالي"));
    }
  }
}

async function loadPlanningLookups() {
  const select = document.querySelector('[data-lookup="materialRequirementId"]');
  if (!select) return;
  try {
    const [plansResponse, items] = await Promise.all([
      controlApi("/planning/mrp"),
      controlApi("/operations-control/lookups/inventory-items").catch(() => []),
    ]);
    const itemNames = Object.fromEntries((items || []).map((i) => [i.id, i.name]));
    const shortages = [];
    (plansResponse || []).forEach((plan) => {
      (plan.requirements || []).filter((r) => r.status === "shortage").forEach((r) => {
        shortages.push({ id: r.id, label: `${plan.planNumber} — ${itemNames[r.inventoryItemId] || "صنف #" + r.inventoryItemId} (عجز: ${r.netQty})` });
      });
    });
    fillSelect(select, shortages, "id", (s) => s.label, "اختر الاحتياج الذي به عجز...");
  } catch (error) {
    disableSelect(select, "غير متاح لدورك الحالي");
  }
}

async function loadItemCodeLookup() {
  const select = document.querySelector('[data-lookup="itemCode"]');
  if (!select) return;
  try {
    const items = await controlApi("/operations-control/lookups/inventory-items");
    const list = Array.isArray(items) ? items : [];
    // القيمة هنا كود الصنف (نص) مش المعرّف الرقمي، عشان itemCode في الـAPI نص حر
    select.innerHTML = `<option value="">بدون صنف محدد (اختياري)</option>` +
      list.filter((i) => i.code).map((i) => `<option value="${esc(i.code)}">${esc(i.code)} — ${esc(i.name)}</option>`).join("");
  } catch (error) {
    disableSelect(select, "غير متاح لدورك الحالي");
  }
}

async function postForm(form, path, transform = (data) => data) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = formObject(form);
      await controlApi(path(data), { method: "POST", body: transform(data) });
      form.reset();
      toast("تم الحفظ بنجاح");
      await Promise.all([loadOverview(), loadProducts(), loadPlans(), loadNcrs()]);
    } catch (error) { toast(error.message, true); }
  });
}

async function loadOverview() {
  const [dashboard, ncrs] = await Promise.all([
    controlApi("/production-cycle/dashboard"),
    controlApi("/production-execution/ncrs"),
  ]);
  const data = dashboard;
  document.getElementById("metric-active").textContent = data.totals.activeOrders;
  document.getElementById("metric-completed").textContent = data.totals.completedOrders;
  document.getElementById("metric-blocked").textContent = data.totals.blockedOrders;
  document.getElementById("metric-ncr").textContent = (ncrs || []).filter((item) => item.status === "open").length;
  document.getElementById("stage-grid").innerHTML = data.stages.map((stage) => `
    <div class="stage-card ${stage.orderCount ? "has-orders" : ""}">
      <span class="stage-number">${stage.number}</span><strong>${esc(stage.name)}</strong>
      <small>${stage.orderCount} أمر</small><em>${esc(stage.description)}</em>
    </div>`).join("");
}

async function loadProducts() {
  const response = await controlApi("/engineering/products");
  document.getElementById("products-list").innerHTML = (response || []).map((product) => `
    <div class="data-row"><div><strong>${esc(product.code)} — ${esc(product.name)}</strong><small>${esc(product.productType)} · ${esc(product.status)}</small></div>
    <button class="btn-small" data-product="${product.id}">فتح الإصدارات</button></div>`).join("") || '<div class="empty">لا توجد منتجات هندسية</div>';
  document.querySelectorAll("[data-product]").forEach((button) => button.addEventListener("click", async () => {
    const response = await controlApi(`/engineering/products/${button.dataset.product}`);
    button.closest(".data-row").insertAdjacentHTML("afterend", `<div class="versions">${(response.versions || []).map((version) => `<span>v${esc(version.version)} — ${esc(version.status)}</span>`).join("") || "لا توجد إصدارات"}</div>`);
  }));
}

async function loadPlans() {
  const response = await controlApi("/planning/mrp");
  document.getElementById("plans-list").innerHTML = (response || []).map((plan) => `
    <div class="data-row"><div><strong>${esc(plan.planNumber)}</strong><small>${esc(plan.status)} · ${esc(plan.demandSource)}</small></div>
    <span class="pill">${(plan.requirements || []).filter((item) => item.status === "shortage").length} عجز</span></div>`).join("") || '<div class="empty">لا توجد خطط</div>';
}

async function loadNcrs() {
  const response = await controlApi("/production-execution/ncrs");
  document.getElementById("ncr-list").innerHTML = (response || []).slice(0, 10).map((ncr) => `<div class="data-row"><div><strong>${esc(ncr.ncrNumber)} — ${esc(ncr.defectCode)}</strong><small>الكمية: ${esc(ncr.affectedQty)}</small></div><span class="pill danger">${esc(ncr.status)}</span></div>`).join("") || '<div class="empty">لا توجد NCR</div>';
}

async function submitForm(id, path, transform = (data) => data) {
  const form = document.getElementById(id);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await controlApi(path(formObject(form)), { method: "POST", body: transform(formObject(form)) });
      form.reset();
      toast("تم الحفظ بنجاح");
      await Promise.all([loadOverview(), loadPlans(), loadNcrs()]);
    } catch (error) { toast(error.message, true); }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  document.querySelectorAll(".control-tab").forEach((tab) => tab.addEventListener("click", () => {
    document.querySelectorAll(".control-tab,.control-panel").forEach((item) => item.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");
  }));
  document.getElementById("refresh-control").addEventListener("click", () => loadOverview().catch((e) => toast(e.message, true)));
  document.getElementById("refresh-products").addEventListener("click", () => loadProducts().catch((e) => toast(e.message, true)));
  document.getElementById("refresh-plans").addEventListener("click", () => loadPlans().catch((e) => toast(e.message, true)));
  document.getElementById("refresh-ncr").addEventListener("click", () => loadNcrs().catch((e) => toast(e.message, true)));
  document.getElementById("product-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try { await controlApi("/engineering/products", { method: "POST", body: formObject(event.target) }); event.target.reset(); toast("تم إنشاء المنتج"); await loadProducts(); } catch (e) { toast(e.message, true); }
  });
  await postForm(document.getElementById("version-form"), (data) => `/engineering/products/${data.productId}/versions`, (data) => ({
    version: data.version, effectiveFrom: data.effectiveFrom || null,
    bomSnapshot: parseJsonField(data.bomSnapshot, []),
    routingSnapshot: parseJsonField(data.routingSnapshot, []),
    specifications: {},
  }));
  await postForm(document.getElementById("approve-version-form"), (data) => `/engineering/bom-versions/${data.versionId}/approve`);
  await postForm(document.getElementById("routing-form"), (data) => `/engineering/routings/${data.versionId}/operations`, (data) => ({
    operationNo: Number(data.operationNo), name: data.name,
    setupMinutes: Number(data.setupMinutes || 0), runMinutesPerUnit: data.runMinutesPerUnit || "0",
  }));
  await postForm(document.getElementById("change-request-form"), () => "/engineering/change-requests", (data) => ({
    productId: Number(data.productId),
    productVersionId: data.productVersionId ? Number(data.productVersionId) : null,
    title: data.title, reason: data.reason, impactSummary: null,
  }));
  document.getElementById("mrp-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = formObject(event.target);
      const requirements = JSON.parse(data.requirements);
      await controlApi("/planning/mrp", { method: "POST", body: { dueDate: data.dueDate || null, workflowOrderId: data.workflowOrderId ? Number(data.workflowOrderId) : null, requirements } });
      event.target.reset(); toast("تم حساب خطة MRP"); await loadPlans(); await loadOverview();
    } catch (e) { toast(e.message, true); }
  });
  await postForm(document.getElementById("requisition-form"), () => "/planning/requisitions", (data) => ({
    materialRequirementId: Number(data.materialRequirementId),
  }));
  document.getElementById("downtime-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try { const data = formObject(event.target); const id = data.batchId; delete data.batchId; data.minutes = Number(data.minutes); await controlApi(`/production-execution/batches/${id}/downtimes`, { method: "POST", body: data }); event.target.reset(); toast("تم تسجيل التوقف"); } catch (e) { toast(e.message, true); }
  });
  await postForm(document.getElementById("confirmation-form"), (data) => `/production-execution/batches/${data.batchId}/confirm`, (data) => ({
    operationNo: Number(data.operationNo), goodQty: data.goodQty,
    scrapQty: data.scrapQty || "0", reworkQty: data.reworkQty || "0",
  }));
  await postForm(document.getElementById("close-batch-form"), (data) => `/production-execution/batches/${data.batchId}/close`);
  document.getElementById("ncr-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try { const data = formObject(event.target); data.workflowOrderId = Number(data.workflowOrderId); data.batchId = data.batchId ? Number(data.batchId) : null; data.evidence = []; await controlApi("/production-execution/ncrs", { method: "POST", body: data }); event.target.reset(); toast("تم فتح NCR"); await loadNcrs(); await loadOverview(); } catch (e) { toast(e.message, true); }
  });
  document.getElementById("trace-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try { const data = formObject(event.target); const response = await controlApi(`/production-execution/traceability/${encodeURIComponent(data.lotNumber)}`); document.getElementById("trace-list").innerHTML = (response || []).map((item) => `<div class="data-row"><div><strong>${esc(item.lotNumber)} — ${esc(item.traceType)}</strong><small>${esc(item.itemCode)} · ${esc(item.quantity)}</small></div><span>${esc(item.referenceType || "—")}</span></div>`).join("") || '<div class="empty">لا توجد سجلات لهذا Lot</div>'; } catch (e) { toast(e.message, true); }
  });
  await postForm(document.getElementById("trace-create-form"), () => "/production-execution/traceability", (data) => ({
    batchId: Number(data.batchId), workflowOrderId: Number(data.workflowOrderId),
    traceType: data.traceType, lotNumber: data.lotNumber,
    itemCode: data.itemCode || null, quantity: data.quantity || null, metadata: {},
  }));
  try { await Promise.all([loadOverview(), loadProducts(), loadPlans(), loadNcrs()]); } catch (e) { toast(e.message, true); }
  try { await loadOrderPickerLookups(); } catch (e) { toast(e.message, true); }
  try { await loadEngineeringLookups(); } catch (e) { /* silent: role may not have access */ }
  try { await loadPlanningLookups(); } catch (e) { /* silent: role may not have access */ }
  try { await loadItemCodeLookup(); } catch (e) { /* silent: role may not have access */ }
});
