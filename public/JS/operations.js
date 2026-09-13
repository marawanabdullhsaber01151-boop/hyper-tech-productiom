(() => {
  const $ = (id) => document.getElementById(id);
  let currentPlan = null;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  const api = (path, options) => window.HyperTechAuth.request(path, options);
  const show = (message, error = false) => { $("status").textContent = message; $("status").className = `status ${error ? "error" : "success"}`; };
  const button = (label, attrs = "") => `<button class="button" ${attrs}>${esc(label)}</button>`;
  function fillSelect(select, items, valueKey, labelKey, placeholder) {
    if (!select) return;
    select.innerHTML = `<option value="">${esc(placeholder)}</option>` +
      items.map((i) => `<option value="${esc(typeof valueKey === "function" ? valueKey(i) : i[valueKey])}">${esc(typeof labelKey === "function" ? labelKey(i) : i[labelKey])}</option>`).join("");
  }
  function disableSelect(select, message) {
    if (!select) return;
    select.innerHTML = `<option value="">${esc(message)}</option>`;
  }
  async function populateLookups() {
    try {
      const orders = await api("/operations-control/lookups/production-orders");
      const list = Array.isArray(orders) ? orders : [];
      document.querySelectorAll('select[name="workflowOrderId"]').forEach((select) => {
        fillSelect(select, list, "id", (o) => `${o.orderNumber || o.id} — ${o.productName || ""}`.trim(), "اختر أمر الإنتاج...");
      });
      fillSelect(document.querySelector('#eventsForm select[name="orderId"]'), list, "id", (o) => `${o.orderNumber || o.id} — ${o.productName || ""}`.trim(), "اختر أمر الإنتاج...");
    } catch (e) {
      document.querySelectorAll('select[name="workflowOrderId"]').forEach((s) => disableSelect(s, "غير متاح لدورك الحالي"));
      disableSelect(document.querySelector('#eventsForm select[name="orderId"]'), "غير متاح لدورك الحالي");
    }
    try {
      const salesOrders = await api("/operations-control/lookups/sales-orders");
      const list = Array.isArray(salesOrders) ? salesOrders : [];
      fillSelect(document.querySelector('#planForm select[name="orderId"]'), list, "id", (o) => `${o.orderNumber || o.id}`, "اختر أمر البيع...");
    } catch (e) {
      disableSelect(document.querySelector('#planForm select[name="orderId"]'), "غير متاح لدورك الحالي");
    }
    try {
      const items = await api("/operations-control/lookups/inventory-items");
      const list = Array.isArray(items) ? items : [];
      fillSelect(document.querySelector('select[name="inventoryItemId"]'), list, "id", (i) => `${i.code ? i.code + " — " : ""}${i.name}`, "الصنف (اختياري)...");
    } catch (e) {
      disableSelect(document.querySelector('select[name="inventoryItemId"]'), "غير متاح لدورك الحالي");
    }
  }
  async function load() {
    try {
      const rows = await api("/operations-control/purchase-requisitions");
      $("requisitionRows").innerHTML = (Array.isArray(rows) ? rows : []).map((r) => `<tr><td>${esc(r.id)}</td><td>${esc(r.materialName || r.inventoryItemId)}</td><td>${esc(r.shortageQty ?? r.requiredQty)}</td><td>${esc(r.status)}</td><td>${r.status === "pending_operations" ? button("تأكيد", `data-confirm="${esc(r.id)}"`) : "—"}</td></tr>`).join("") || '<tr><td colspan="5" class="muted">لا توجد طلبات.</td></tr>';
      const exceptions = await api("/operations/exceptions");
      $("exceptionRows").innerHTML = (Array.isArray(exceptions) ? exceptions : []).map((r) => `<tr><td>${esc(r.id)}</td><td>${esc(r.type || r.exceptionType)}</td><td>${esc(r.description || r.message)}</td><td>${esc(r.status)}</td><td>${r.status !== "resolved" ? button("حل", `data-resolve="${esc(r.id)}"`) : "—"}</td></tr>`).join("") || '<tr><td colspan="5" class="muted">لا توجد استثناءات.</td></tr>';
      show("تم تحديث بيانات العمليات.");
    } catch (e) { show(e.message, true); }
  }
  $("planForm").onsubmit = async (event) => {
    event.preventDefault(); const id = new FormData(event.currentTarget).get("orderId");
      try {
        currentPlan = await api(`/operations-control/sales-orders/${id}/plan`);
        $("planResult").textContent = JSON.stringify(currentPlan, null, 2);
        $("saveDraftPlan").hidden = false;
        show("تم تحميل التحليل للعرض فقط. لم يتم تعديل المخزون أو إنشاء مستندات تنفيذية.");
      } catch (e) { show(e.message, true); }
  };
  $("saveDraftPlan").onclick = async () => {
    if (!currentPlan) return;
    const id = new FormData($("planForm")).get("orderId");
    try {
      const result = await api(`/operations-control/sales-orders/${id}/draft-plan`, { method:"POST" });
      $("planResult").textContent = JSON.stringify(result, null, 2);
      $("saveDraftPlan").hidden = true;
      show("تم تجهيز خطة مسودة للعرض فقط. لم يتم تعديل المخزون أو إنشاء مستندات تنفيذية.");
    } catch (e) { show(e.message, true); }
  };
  $("requisitionRows").onclick = async (event) => { const b = event.target.closest("[data-confirm]"); if (!b) return; try { await api(`/operations-control/purchase-requisitions/${b.dataset.confirm}/confirm`, { method:"PATCH" }); show("تم تأكيد طلب الشراء."); await load(); } catch (e) { show(e.message, true); } };
  $("exceptionRows").onclick = async (event) => { const b = event.target.closest("[data-resolve]"); if (!b) return; try { await api(`/operations/exceptions/${b.dataset.resolve}/resolve`, { method:"PATCH", body: JSON.stringify({ resolution: "تمت المعالجة من شاشة العمليات" }) }); show("تم حل الاستثناء."); await load(); } catch (e) { show(e.message, true); } };
  $("eventsForm").onsubmit = async (event) => { event.preventDefault(); const id = new FormData(event.currentTarget).get("orderId"); try { const rows = await api(`/operations-control/orders/${id}/events`); $("eventRows").innerHTML = (Array.isArray(rows) ? rows : []).map((r) => `<tr><td>${esc(r.createdAt)}</td><td>${esc(r.type || r.eventType)}</td><td>${esc(r.description || r.notes)}</td></tr>`).join("") || '<tr><td colspan="3">لا توجد أحداث.</td></tr>'; } catch (e) { show(e.message, true); } };
  $("batchForm").onsubmit = async (event) => { event.preventDefault(); const body = Object.fromEntries(new FormData(event.currentTarget)); body.workflowOrderId = Number(body.workflowOrderId); try { await api("/operations/batches", { method:"POST", body:JSON.stringify(body) }); event.currentTarget.reset(); show("تم إنشاء دفعة الإنتاج."); } catch (e) { show(e.message, true); } };
  $("costForm").onsubmit = async (event) => { event.preventDefault(); const body = Object.fromEntries(new FormData(event.currentTarget)); body.workflowOrderId = Number(body.workflowOrderId); try { const result = await api("/operations/cost-entries", { method:"POST", body:JSON.stringify(body) }); event.currentTarget.reset(); show(result.pendingApproval ? "تم تسجيل التكلفة وهي في انتظار الاعتماد." : "تم تسجيل التكلفة."); } catch (e) { show(e.message, true); } };
  $("transferForm").onsubmit = async (event) => { event.preventDefault(); const body = Object.fromEntries(new FormData(event.currentTarget)); body.workflowOrderId = Number(body.workflowOrderId); body.inventoryItemId = body.inventoryItemId ? Number(body.inventoryItemId) : null; try { await api("/operations-control/transfers", { method:"POST", body:JSON.stringify(body) }); event.currentTarget.reset(); show("تم إنشاء التحويل بمفتاحه الفريد."); } catch (e) { show(e.message, true); } };
  $("refresh").onclick = load; load(); populateLookups();
})();