/** @format */

// ===================================================
//  RAW MATERIALS — Hyper-Tech ERP
//  المواد الخام — واجهة متخصصة فوق نظام المخزون الحقيقي
//  (/api/v1/inventory مفلترة على raw_material) + ربط حقيقي
//  بالموردين (/api/v1/contacts) ووصفات التصنيع (/api/v1/bom)
//  بدل localStorage منفصل بالكامل عن باقي النظام
// ===================================================

async function apiCall(path, options = {}) {
  return window.HyperTechAuth.request(path, options);
}

/* ──────────────────────────────────────────
   STATE
────────────────────────────────────────── */
let materials = []; // أصناف المخزون الحقيقية المفلترة على "مواد خام" بس
let suppliers = []; // جهات اتصال حقيقية نوعها "مورد"
let bomItems = []; // كل مكوّنات كل الوصفات (لعرض "مستخدمة في إيه")
let productionOrders = []; // أوامر الإنتاج الحقيقية (لعرض "مستخدمة في أمر إنتاج إيه")
let movementsCache = {}; // itemId → آخر الحركات (بتتحمل عند فتح تفاصيل المادة بس)

let activeStatus = "all";
let sortBy = "name";
let searchQuery = "";
let selectedId = null;
let editingId = null;
let moveTargetId = null;
let selectedMoveType = "in";
let pendingDeleteId = null;

/* ──────────────────────────────────────────
   INIT
────────────────────────────────────────── */
(async function init() {
  bindEvents();
  await loadInitialData();
})();

async function loadInitialData() {
  try {
    const [invRes, contactsRes, bomItemsRes, workflowRes] = await Promise.all([
      apiCall("/inventory"),
      apiCall("/contacts").catch(() => []),
      apiCall("/bom/items/all").catch(() => []),
      apiCall("/production-workflow").catch(() => ({ data: [] })),
    ]);
    materials = (invRes || []).filter((i) => i.category === "raw_material");
    suppliers = (contactsRes || []).filter(
      (c) => c.type === "supplier" || c.type === "both",
    );
    bomItems = bomItemsRes || [];
    productionOrders = workflowRes.data || [];
    renderAll();
  } catch (e) {
    showToast("فشل تحميل المواد الخام: " + e.message, "warn");
  }
}

/* ──────────────────────────────────────────
   HELPERS
────────────────────────────────────────── */
function getStatus(m) {
  const qty = Number(m.qty);
  const min = Number(m.minQty);
  if (qty <= 0) return "out";
  if (min > 0 && qty < min * 0.4) return "low";
  return "ok";
}
function statusLabel(s) {
  return (
    s === "ok" ? "كمية كافية"
    : s === "low" ? "قارب على النفاد"
    : "نفد"
  );
}
function fmt(n, decimals = 2) {
  return parseFloat((+n || 0).toFixed(decimals)).toLocaleString("ar-EG");
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
function formatDateAr(dateStr) {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("ar-EG", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}
function supplierName(id) {
  const s = suppliers.find((s) => s.id === id);
  return s ? s.name : null;
}

/* ──────────────────────────────────────────
   FILTER + SORT
────────────────────────────────────────── */
function filteredMaterials() {
  let data = [...materials];
  if (activeStatus !== "all")
    data = data.filter((m) => getStatus(m) === activeStatus);
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    data = data.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.code || "").toLowerCase().includes(q) ||
        (supplierName(m.supplierId) || "").toLowerCase().includes(q),
    );
  }
  data.sort((a, b) => {
    switch (sortBy) {
      case "code":
        return (a.code || "").localeCompare(b.code || "");
      case "qty-asc":
        return Number(a.qty) - Number(b.qty);
      case "qty-desc":
        return Number(b.qty) - Number(a.qty);
      case "status":
        return getStatus(a).localeCompare(getStatus(b));
      default:
        return a.name.localeCompare(b.name, "ar");
    }
  });
  return data;
}

/* ──────────────────────────────────────────
   BOM & PRODUCTION USAGE — مطابقة حقيقية بالـ ID، مش تخمين بالاسم
────────────────────────────────────────── */
function getBomUsage(itemId) {
  return bomItems.filter((b) => b.inventoryItemId === itemId);
}
function getProductionUsage(itemId) {
  // أوامر الإنتاج المرتبطة بوصفات بتستخدم المادة دي، ولسه في مرحلة نشطة
  const recipeIds = new Set(getBomUsage(itemId).map((b) => b.recipeId));
  if (!recipeIds.size) return [];
  const ACTIVE = [
    "new",
    "materials_requested",
    "materials_approved",
    "materials_partial",
    "in_production",
    "quality_check",
  ];
  return productionOrders.filter(
    (o) => recipeIds.has(o.bomRecipeId) && ACTIVE.includes(o.workflowStatus),
  );
}

const WORKFLOW_STATUS_LABELS = {
  new: "جديد",
  materials_requested: "بانتظار المخازن",
  materials_approved: "المواد معتمدة",
  materials_partial: "موافقة جزئية",
  in_production: "قيد التنفيذ",
  quality_check: "فحص الجودة",
};

/* ──────────────────────────────────────────
   RENDER
────────────────────────────────────────── */
function renderAll() {
  renderKPIs();
  renderTabs();
  renderTable();
  renderSupplierFilterOptions();
}

function renderKPIs() {
  const total = materials.length;
  const ok = materials.filter((m) => getStatus(m) === "ok").length;
  const low = materials.filter((m) => getStatus(m) === "low").length;
  const out = materials.filter((m) => getStatus(m) === "out").length;
  const val = materials.reduce(
    (s, m) => s + Number(m.qty) * Number(m.unitPrice || 0),
    0,
  );

  setEl("kpi-total", total);
  setEl("kpi-ok", ok);
  setEl("kpi-low", low);
  setEl("kpi-out", out);
  setEl("kpi-val", fmt(val, 0) + " ج.م");

  const dot = document.getElementById("notif-dot");
  if (dot) dot.style.display = low + out > 0 ? "block" : "none";
}

function renderTabs() {
  document.querySelectorAll("#rm-tabs .rm-tab").forEach((tab) => {
    const st = tab.dataset.status;
    const count =
      st === "all" ?
        materials.length
      : materials.filter((m) => getStatus(m) === st).length;
    const badge = tab.querySelector(".tab-count");
    if (badge) badge.textContent = count;
  });
}

function renderSupplierFilterOptions() {
  const sel = document.getElementById("f-supplier");
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML =
    '<option value="">— بدون مورد محدد —</option>' +
    suppliers
      .map((s) => `<option value="${s.id}">${escHtml(s.name)}</option>`)
      .join("");
  if (current) sel.value = current;
}

function renderTable() {
  const tbody = document.getElementById("rm-tbody");
  if (!tbody) return;

  const data = filteredMaterials();
  if (!data.length) {
    tbody.innerHTML = `
      <tr><td colspan="8">
        <div class="empty-state">
          <i class="fa-solid fa-boxes-stacked"></i>
          <h4>لا توجد مواد مطابقة</h4>
          <p>جرّب تغيير الفلتر أو البحث، أو أضف مادة جديدة</p>
        </div>
      </td></tr>`;
    return;
  }

  tbody.innerHTML = data
    .map((m, idx) => {
      const st = getStatus(m);
      const min = Number(m.minQty);
      const pct =
        min > 0 ? Math.min(100, Math.round((Number(m.qty) / min) * 100)) : 100;
      const isSelected = m.id === selectedId;
      const supName = supplierName(m.supplierId);

      return `
    <tr class="${isSelected ? "row-selected" : ""}" style="animation-delay:${idx * 0.04}s" data-id="${m.id}">
      <td class="cell-code">${escHtml(m.code) || "—"}</td>
      <td><div class="cell-name">${escHtml(m.name)}</div></td>
      <td class="cell-unit-col">${escHtml(m.unit) || "—"}</td>
      <td>
        <span class="cell-qty">${fmt(m.qty, 0)}</span>
        <span class="cell-unit">${escHtml(m.unit) || ""}</span>
        <div class="qty-bar-wrap"><div class="qty-bar-bg"><div class="qty-bar-fill ${st}" style="width:${pct}%"></div></div></div>
      </td>
      <td><span class="status-badge ${st}"><span class="status-dot-sm"></span>${statusLabel(st)}</span></td>
      <td class="cell-supplier">${escHtml(supName) || "—"}</td>
      <td>
        <div class="cell-cost-wrap">
          <span class="cell-cost">${fmt(m.unitPrice)} ج.م</span>
          <span class="cell-lead">${m.leadDays ? m.leadDays + " يوم" : "—"}</span>
        </div>
      </td>
      <td>
        <div class="row-actions">
          <button class="row-action detail-btn" data-id="${m.id}" title="التفاصيل"><i class="fa-solid fa-eye"></i></button>
          <button class="row-action move-btn" data-id="${m.id}" title="حركة مخزون"><i class="fa-solid fa-right-left"></i></button>
          <button class="row-action edit-btn" data-id="${m.id}" title="تعديل"><i class="fa-solid fa-pen"></i></button>
          <button class="row-action delete-btn" data-id="${m.id}" title="حذف"><i class="fa-solid fa-trash"></i></button>
        </div>
      </td>
    </tr>`;
    })
    .join("");
}

/* ──────────────────────────────────────────
   DETAIL PANEL
────────────────────────────────────────── */
async function renderDetailPanel(id) {
  selectedId = id;
  renderTable();

  const panel = document.getElementById("detail-panel");
  if (!panel) return;

  const m = materials.find((x) => x.id === id);
  if (!m) {
    panel.innerHTML = `<div class="detail-empty"><i class="fa-regular fa-hand-pointer"></i><p>اختر مادة من الجدول<br/>لعرض تفاصيلها</p></div>`;
    return;
  }

  panel.innerHTML = `<div class="detail-empty"><i class="fa-solid fa-spinner fa-spin"></i><p>جاري تحميل التفاصيل...</p></div>`;

  let movs = movementsCache[id];
  if (!movs) {
    try {
      const all = await apiCall("/stock-movements");
      movs = (all || []).filter((mv) => mv.inventoryItemId === id);
      movementsCache[id] = movs;
    } catch {
      movs = [];
    }
  }

  const st = getStatus(m);
  const min = Number(m.minQty);
  const qty = Number(m.qty);
  const pct = min > 0 ? Math.min(100, Math.round((qty / min) * 100)) : 100;
  const totalVal = qty * Number(m.unitPrice || 0);
  const reorder = Math.max(0, Math.ceil(min * 1.5 - qty));
  const supName = supplierName(m.supplierId);

  const bomUsage = getBomUsage(m.id);
  const bomHTML =
    bomUsage.length ?
      bomUsage
        .map(
          (b) =>
            `<div class="dp-bom-row"><span class="dp-bom-name"><i class="fa-solid fa-diagram-project"></i> ${escHtml(b.productName)}</span><span class="dp-bom-qty">${fmt(b.qty, 2)} ${escHtml(b.unit)}</span></div>`,
        )
        .join("")
    : '<p class="dp-empty-note">لا توجد وصفات تستخدم هذه المادة حاليًا</p>';

  const prodUsage = getProductionUsage(m.id);
  const prodHTML =
    prodUsage.length ?
      prodUsage
        .map(
          (p) => `<div class="dp-prod-row">
        <div><span class="dp-prod-id">${escHtml(p.orderNumber)}</span><span class="dp-prod-name">${escHtml(p.productName)}</span></div>
        <div style="display:flex;align-items:center;gap:6px">
          <span class="dp-prod-qty">${fmt(p.qty, 0)}</span>
          <span class="status-badge ok" style="font-size:10px;padding:2px 8px">${WORKFLOW_STATUS_LABELS[p.workflowStatus] || p.workflowStatus}</span>
        </div>
      </div>`,
        )
        .join("")
    : '<p class="dp-empty-note">لا توجد أوامر إنتاج نشطة تستخدم هذه المادة</p>';

  const recentMovs = [...movs]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 8);
  const movsHTML =
    recentMovs.length ?
      recentMovs
        .map(
          (mv) => `<div class="dp-mov-row">
        <span class="dp-mov-type ${mv.movementType}"><i class="fa-solid fa-arrow-${mv.movementType === "in" ? "down" : "up"}"></i> ${mv.movementType === "in" ? "وارد" : "منصرف"}</span>
        <span class="dp-mov-qty">${fmt(mv.qty, 0)} ${escHtml(m.unit)}</span>
        <span class="dp-mov-date">${formatDateAr(mv.createdAt)}</span>
      </div>
      ${mv.notes ? `<div class="dp-mov-reason">${escHtml(mv.notes)}</div>` : ""}`,
        )
        .join("")
    : '<p class="dp-empty-note">لا توجد حركات مسجّلة</p>';

  panel.innerHTML = `
    <div class="dp-header">
      <div class="dp-title-row">
        <div><h3 class="dp-title">${escHtml(m.name)}</h3><p class="dp-sub">${escHtml(m.code) || "—"} · ${escHtml(m.unit) || "—"}</p></div>
        <span class="status-badge ${st}"><span class="status-dot-sm"></span>${statusLabel(st)}</span>
      </div>
      <div class="dp-actions-row">
        <button class="dp-btn-primary" onclick="openMoveModal(${m.id})"><i class="fa-solid fa-right-left"></i> حركة مخزون</button>
        <button class="dp-btn-ghost" onclick="openEditModal(${m.id})"><i class="fa-solid fa-pen"></i> تعديل</button>
        <button class="dp-btn-ghost" onclick="printMaterial(${m.id})"><i class="fa-solid fa-print"></i></button>
      </div>
    </div>

    <div class="dp-section">
      <div class="dp-section-title">مستوى المخزون</div>
      <div class="dp-stock-display">
        <div class="dp-stock-nums">
          <span class="dp-stock-val">${fmt(m.qty, 0)}</span>
          <span class="dp-stock-unit">${escHtml(m.unit) || ""}</span>
          <span class="dp-stock-of">من ${fmt(m.minQty, 0)} (الحد الأدنى)</span>
        </div>
        <div class="dp-bar-bg"><div class="dp-bar-fill ${st}" style="width:${pct}%"></div></div>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-dim);margin-top:4px">
          <span>0</span><span>${pct}%</span><span>${fmt(m.minQty, 0)}</span>
        </div>
      </div>
      ${reorder > 0 ? `<div class="dp-reorder-alert"><i class="fa-solid fa-circle-exclamation"></i> يُنصح بطلب <strong>${fmt(reorder, 0)} ${escHtml(m.unit) || ""}</strong> ${supName ? "من " + escHtml(supName) : "من المورد"} ${m.leadDays ? `(وقت التوريد: ${m.leadDays} يوم)` : ""}</div>` : ""}
    </div>

    <div class="dp-section">
      <div class="dp-section-title">بيانات المورد والتكلفة</div>
      <div class="dp-info-grid">
        <div class="dp-info-item"><span class="dp-info-label">المورد</span><span class="dp-info-val">${escHtml(supName) || "—"}</span></div>
        <div class="dp-info-item"><span class="dp-info-label">سعر الوحدة</span><span class="dp-info-val" style="color:var(--green)">${fmt(m.unitPrice)} ج.م / ${escHtml(m.unit) || ""}</span></div>
        <div class="dp-info-item"><span class="dp-info-label">وقت التوريد</span><span class="dp-info-val">${m.leadDays ? m.leadDays + " يوم" : "—"}</span></div>
        <div class="dp-info-item"><span class="dp-info-label">قيمة المخزون</span><span class="dp-info-val" style="color:var(--accent)">${fmt(totalVal)} ج.م</span></div>
      </div>
    </div>

    <div class="dp-section">
      <div class="dp-section-title"><i class="fa-solid fa-diagram-project"></i> استخدام في وصفات التصنيع <span class="dp-section-count">${bomUsage.length}</span></div>
      ${bomHTML}
    </div>

    <div class="dp-section">
      <div class="dp-section-title"><i class="fa-solid fa-industry"></i> أوامر الإنتاج النشطة المرتبطة <span class="dp-section-count">${prodUsage.length}</span></div>
      ${prodHTML}
    </div>

    <div class="dp-section">
      <div class="dp-section-title"><i class="fa-solid fa-clock-rotate-left"></i> آخر الحركات <span class="dp-section-count">${movs.length}</span></div>
      ${movsHTML}
    </div>
  `;
}

function closeDetailPanel() {
  selectedId = null;
  const panel = document.getElementById("detail-panel");
  if (!panel) return;
  panel.innerHTML = `<div class="detail-empty"><i class="fa-regular fa-hand-pointer"></i><p>اختر مادة من الجدول<br/>لعرض تفاصيلها</p></div>`;
  renderTable();
}

/* ──────────────────────────────────────────
   ADD / EDIT MODAL
────────────────────────────────────────── */
function openAddModal() {
  editingId = null;
  setEl("mat-modal-title", "إضافة مادة خام جديدة");
  const saveBtn = document.getElementById("mat-save");
  if (saveBtn)
    saveBtn.innerHTML = '<i class="fa-solid fa-check"></i> إضافة المادة';

  setVal("f-code", "");
  setVal("f-name", "");
  setVal("f-qty", "");
  setVal("f-min", "");
  setVal("f-supplier", "");
  setVal("f-cost", "");
  setVal("f-lead", "");
  const unitEl = document.getElementById("f-unit");
  if (unitEl) unitEl.selectedIndex = 0;

  renderSupplierFilterOptions();
  openOverlay("mat-modal");
}

function openEditModal(id) {
  const m = materials.find((x) => x.id === id);
  if (!m) return;
  editingId = id;
  setEl("mat-modal-title", "تعديل بيانات المادة");
  const saveBtn = document.getElementById("mat-save");
  if (saveBtn)
    saveBtn.innerHTML = '<i class="fa-solid fa-check"></i> حفظ التعديلات';

  setVal("f-code", m.code || "");
  setVal("f-name", m.name);
  setVal("f-qty", m.qty);
  setVal("f-min", m.minQty);
  setVal("f-cost", m.unitPrice || "");
  setVal("f-lead", m.leadDays || "");
  const unitEl = document.getElementById("f-unit");
  if (unitEl) unitEl.value = m.unit || "";

  renderSupplierFilterOptions();
  setVal("f-supplier", m.supplierId || "");

  openOverlay("mat-modal");
}

function closeMatModal() {
  closeOverlay("mat-modal");
}

async function saveMatModal() {
  const code = (getVal("f-code") || "").trim().toUpperCase() || null;
  const name = (getVal("f-name") || "").trim();
  const unit = getVal("f-unit") || "قطعة";
  const qty = parseFloat(getVal("f-qty")) || 0;
  const min = parseFloat(getVal("f-min")) || 0;
  const supplierId = getVal("f-supplier") ? Number(getVal("f-supplier")) : null;
  const cost = parseFloat(getVal("f-cost")) || 0;
  const lead = parseInt(getVal("f-lead")) || null;

  if (!name) {
    showToast("من فضلك أدخل اسم المادة", "warn");
    return;
  }
  if (qty < 0) {
    showToast("الكمية لا يمكن أن تكون سالبة", "warn");
    return;
  }

  const data = {
    code,
    name,
    category: "raw_material",
    unit,
    qty: String(qty),
    minQty: String(min),
    unitPrice: String(cost),
    supplierId,
    leadDays: lead,
  };

  const saveBtn = document.getElementById("mat-save");
  saveBtn.disabled = true;
  try {
    if (editingId) {
      await apiCall(`/inventory/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
      showToast("تم حفظ التعديلات بنجاح ✓");
    } else {
      await apiCall("/inventory", {
        method: "POST",
        body: JSON.stringify(data),
      });
      showToast("تم إضافة المادة بنجاح ✓");
    }
    closeMatModal();
    await loadInitialData();
  } catch (e) {
    showToast("فشل الحفظ: " + e.message, "warn");
  } finally {
    saveBtn.disabled = false;
  }
}

/* ──────────────────────────────────────────
   MOVEMENT MODAL
────────────────────────────────────────── */
function openMoveModal(id) {
  const m = materials.find((x) => x.id === id);
  if (!m) return;
  moveTargetId = id;
  selectedMoveType = "in";

  document
    .querySelectorAll(".move-type-btn")
    .forEach((b) => b.classList.toggle("active", b.dataset.type === "in"));
  const saveBtn = document.getElementById("move-save-btn");
  if (saveBtn)
    saveBtn.innerHTML = '<i class="fa-solid fa-arrow-down"></i> تسجيل الاستلام';

  setEl("move-item-name", m.name);
  setEl("move-current-qty", `المخزون الحالي: ${fmt(m.qty, 0)} ${m.unit || ""}`);
  setVal("move-qty", "");
  setVal("move-date", today());
  setVal("move-reason", "");

  openOverlay("move-modal");
}

function closeMoveModal() {
  closeOverlay("move-modal");
  moveTargetId = null;
}

async function saveMoveModal() {
  const m = materials.find((x) => x.id === moveTargetId);
  if (!m) return;
  const qty = parseFloat(getVal("move-qty"));
  const date = getVal("move-date");
  const reason = (getVal("move-reason") || "").trim() || null;

  if (!qty || qty <= 0) {
    showToast("أدخل كمية صحيحة أكبر من صفر", "warn");
    return;
  }
  if (selectedMoveType === "out" && qty > Number(m.qty)) {
    showToast(
      `الكمية المطلوبة (${fmt(qty, 0)}) أكبر من المتاح (${fmt(m.qty, 0)})`,
      "warn",
    );
    return;
  }

  const btn = document.getElementById("move-save-btn");
  btn.disabled = true;
  try {
    await apiCall("/stock-movements", {
      method: "POST",
      body: JSON.stringify({
        inventoryItemId: m.id,
        movementType: selectedMoveType,
        qty: String(qty),
        referenceType: "adjustment",
        unitPrice: m.unitPrice,
        notes: reason,
      }),
    });
    delete movementsCache[m.id]; // إجبار إعادة تحميل الحركات عشان تفضل محدثة
    closeMoveModal();
    showToast(
      selectedMoveType === "in" ?
        `تم تسجيل استلام ${fmt(qty, 0)} ${m.unit || ""}`
      : `تم تسجيل صرف ${fmt(qty, 0)} ${m.unit || ""}`,
    );
    await loadInitialData();
    if (selectedId === m.id) renderDetailPanel(m.id);
  } catch (e) {
    showToast("فشل تسجيل الحركة: " + e.message, "warn");
  } finally {
    btn.disabled = false;
  }
}

/* ──────────────────────────────────────────
   DELETE
────────────────────────────────────────── */
function askDelete(id) {
  const m = materials.find((x) => x.id === id);
  if (!m) return;
  pendingDeleteId = id;
  setEl("confirm-name", m.name);
  openOverlay("confirm-overlay");
}

async function doDelete() {
  if (!pendingDeleteId) return;
  try {
    await apiCall(`/inventory/${pendingDeleteId}`, { method: "DELETE" });
    showToast("تم حذف المادة بنجاح");
    if (selectedId === pendingDeleteId) closeDetailPanel();
    await loadInitialData();
  } catch (e) {
    showToast("فشل الحذف: " + e.message, "warn");
  } finally {
    closeOverlay("confirm-overlay");
    pendingDeleteId = null;
  }
}

/* ──────────────────────────────────────────
   PRINT
────────────────────────────────────────── */
function printMaterial(id) {
  const m = materials.find((x) => x.id === id);
  if (!m) return;
  const st = getStatus(m);
  const totalVal = Number(m.qty) * Number(m.unitPrice || 0);
  const supName = supplierName(m.supplierId);
  const bomUsage = getBomUsage(m.id);
  const movs = (movementsCache[m.id] || [])
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 15);

  const win = window.open("", "_blank");
  win.document.write(`
  <!doctype html><html dir="rtl" lang="ar">
  <head><meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;600;700;800&display=swap" rel="stylesheet">
  <title>تقرير مادة خام — ${escHtml(m.name)}</title>
  <style>
    body{font-family:'Tajawal',sans-serif;background:#fff;color:#1e293b;padding:40px;direction:rtl}
    h1{font-size:22px;font-weight:800;margin-bottom:4px}
    .sub{color:#64748b;font-size:13px;margin-bottom:28px}
    table{width:100%;border-collapse:collapse;margin-bottom:24px}
    th{background:#f1f5f9;font-size:12px;font-weight:700;padding:8px 12px;text-align:right;border:1px solid #e2e8f0}
    td{padding:8px 12px;border:1px solid #e2e8f0;font-size:13px}
    .section-title{font-size:14px;font-weight:700;margin:20px 0 10px;border-bottom:2px solid #f59e0b;padding-bottom:4px}
    .badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700}
    .ok{background:#d1fae5;color:#065f46}.low{background:#fef3c7;color:#92400e}.out{background:#fee2e2;color:#991b1b}
    .in{color:#10b981}.out-mov{color:#ef4444}
    @media print{body{padding:20px}}
  </style>
  </head><body>
  <h1>تقرير مادة خام</h1>
  <p class="sub">تم إنشاؤه بواسطة Hyper-Tech ERP — ${new Date().toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" })}</p>

  <div class="section-title">بيانات المادة</div>
  <table>
    <tr><th>الكود</th><td>${escHtml(m.code) || "—"}</td><th>الاسم</th><td>${escHtml(m.name)}</td></tr>
    <tr><th>الوحدة</th><td>${escHtml(m.unit) || "—"}</td><th>الحالة</th><td><span class="badge ${st}">${statusLabel(st)}</span></td></tr>
    <tr><th>الكمية الحالية</th><td>${fmt(m.qty, 0)} ${escHtml(m.unit) || ""}</td><th>الحد الأدنى</th><td>${fmt(m.minQty, 0)} ${escHtml(m.unit) || ""}</td></tr>
    <tr><th>المورد</th><td>${escHtml(supName) || "—"}</td><th>وقت التوريد</th><td>${m.leadDays || "—"} يوم</td></tr>
    <tr><th>سعر الوحدة</th><td>${fmt(m.unitPrice)} ج.م</td><th>قيمة المخزون</th><td>${fmt(totalVal)} ج.م</td></tr>
  </table>

  ${
    bomUsage.length ?
      `
  <div class="section-title">استخدام في وصفات التصنيع (${bomUsage.length})</div>
  <table>
    <thead><tr><th>الوصفة</th><th>الكمية المطلوبة</th><th>الوحدة</th></tr></thead>
    <tbody>${bomUsage.map((b) => `<tr><td>${escHtml(b.productName)}</td><td>${fmt(b.qty, 2)}</td><td>${escHtml(b.unit)}</td></tr>`).join("")}</tbody>
  </table>`
    : ""
  }

  ${
    movs.length ?
      `
  <div class="section-title">آخر الحركات</div>
  <table>
    <thead><tr><th>النوع</th><th>الكمية</th><th>التاريخ</th><th>السبب</th></tr></thead>
    <tbody>${movs
      .map(
        (mv) => `
      <tr>
        <td class="${mv.movementType === "in" ? "in" : "out-mov"}">${mv.movementType === "in" ? "وارد" : "منصرف"}</td>
        <td>${fmt(mv.qty, 0)} ${escHtml(m.unit) || ""}</td>
        <td>${formatDateAr(mv.createdAt)}</td>
        <td>${escHtml(mv.notes) || "—"}</td>
      </tr>`,
      )
      .join("")}
    </tbody>
  </table>`
    : ""
  }

  <script>window.onload=()=>window.print()<\/script>
  </body></html>`);
  win.document.close();
}

/* ──────────────────────────────────────────
   OVERLAY / DOM HELPERS
────────────────────────────────────────── */
function openOverlay(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.add("open");
    document.body.style.overflow = "hidden";
  }
}
function closeOverlay(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.remove("open");
    document.body.style.overflow = "";
  }
}
function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
function setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}
function getVal(id) {
  const el = document.getElementById(id);
  return el ? el.value : "";
}
function showToast(msg, type = "success") {
  const toast = document.getElementById("toast");
  const msgEl = document.getElementById("toast-msg");
  if (!toast || !msgEl) return;
  msgEl.textContent = msg;
  const iconEl = toast.querySelector("i");
  if (iconEl)
    iconEl.className =
      type === "warn" ?
        "fa-solid fa-triangle-exclamation"
      : "fa-solid fa-circle-check";
  toast.className = `toast ${type === "warn" ? "toast-warn" : ""}`;
  toast.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove("show"), 3200);
}

/* ──────────────────────────────────────────
   EVENT LISTENERS
────────────────────────────────────────── */
function bindEvents() {
  document.getElementById("btn-add")?.addEventListener("click", openAddModal);

  document
    .getElementById("mat-close")
    ?.addEventListener("click", closeMatModal);
  document
    .getElementById("mat-cancel")
    ?.addEventListener("click", closeMatModal);
  document.getElementById("mat-save")?.addEventListener("click", saveMatModal);
  document.getElementById("mat-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "mat-modal") closeMatModal();
  });

  document
    .getElementById("move-close")
    ?.addEventListener("click", closeMoveModal);
  document
    .getElementById("move-cancel")
    ?.addEventListener("click", closeMoveModal);
  document.getElementById("move-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "move-modal") closeMoveModal();
  });
  document
    .getElementById("move-save-btn")
    ?.addEventListener("click", saveMoveModal);

  document.querySelectorAll(".move-type-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document
        .querySelectorAll(".move-type-btn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedMoveType = btn.dataset.type;
      const saveBtn = document.getElementById("move-save-btn");
      if (saveBtn)
        saveBtn.innerHTML =
          selectedMoveType === "in" ?
            '<i class="fa-solid fa-arrow-down"></i> تسجيل الاستلام'
          : '<i class="fa-solid fa-arrow-up"></i> تسجيل الصرف';
    });
  });

  document.getElementById("confirm-no")?.addEventListener("click", () => {
    closeOverlay("confirm-overlay");
    pendingDeleteId = null;
  });
  document.getElementById("confirm-yes")?.addEventListener("click", doDelete);
  document.getElementById("confirm-overlay")?.addEventListener("click", (e) => {
    if (e.target.id === "confirm-overlay") {
      closeOverlay("confirm-overlay");
      pendingDeleteId = null;
    }
  });

  document.getElementById("rm-tabs")?.addEventListener("click", (e) => {
    const tab = e.target.closest(".rm-tab");
    if (!tab) return;
    document
      .querySelectorAll("#rm-tabs .rm-tab")
      .forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    activeStatus = tab.dataset.status;
    renderTable();
  });

  document.getElementById("sort-select")?.addEventListener("change", (e) => {
    sortBy = e.target.value;
    renderTable();
  });

  document.getElementById("search-input")?.addEventListener("input", (e) => {
    searchQuery = e.target.value.trim();
    renderTable();
  });

  document.getElementById("rm-tbody")?.addEventListener("click", (e) => {
    const row = e.target.closest("tr[data-id]");
    const btn = e.target.closest(".row-action");

    if (btn) {
      e.stopPropagation();
      const id = Number(btn.dataset.id);
      if (btn.classList.contains("detail-btn")) renderDetailPanel(id);
      else if (btn.classList.contains("move-btn")) openMoveModal(id);
      else if (btn.classList.contains("edit-btn")) openEditModal(id);
      else if (btn.classList.contains("delete-btn")) askDelete(id);
      return;
    }
    if (row) {
      const id = Number(row.dataset.id);
      if (selectedId === id) closeDetailPanel();
      else renderDetailPanel(id);
    }
  });

  document.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", function (e) {
      if (this.getAttribute("href") === "#") e.preventDefault();
    });
  });

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "n") {
      e.preventDefault();
      openAddModal();
    }
    if (e.key === "Escape") {
      closeMatModal();
      closeMoveModal();
      closeOverlay("confirm-overlay");
    }
  });
}
