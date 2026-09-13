/** @format */
// =====================================================
//  STOCK MOVEMENTS — Hyper-Tech ERP
//  حركات المخزون — متصلة بالباك إند الحقيقي
//  (/api/v1/inventory + /api/v1/stock-movements) بدل localStorage
// =====================================================

async function apiCall(path, options = {}) {
  return window.HyperTechAuth.request(path, options);
}

/* ── DOM helpers ── */
const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

const refTypeLabel = {
  purchase: "أمر شراء",
  sale: "فاتورة بيع",
  production: "أمر إنتاج",
  adjustment: "تسوية يدوية",
};

function fmt(n, dec = 0) {
  const num = parseFloat((+n).toFixed(dec));
  return isNaN(num) ? "0" : num.toLocaleString("ar-EG");
}
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function formatDateAr(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("ar-EG", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return d;
  }
}
function getMatStatus(mat) {
  const qty = Number(mat.qty);
  const min = Number(mat.minQty);
  if (!qty || qty <= 0) return "out";
  if (min > 0 && qty < min * 0.4) return "low";
  return "ok";
}

/* ── STATE ── */
let items = []; // من /api/v1/inventory
let allMovements = []; // مبنية من دمج items + /api/v1/stock-movements
let filtered = [];
let activeType = "all";
let filterMaterial = "all";
let filterDateFrom = "";
let filterDateTo = "";
let sortMode = "date-desc";
let searchQuery = "";
let currentPage = 1;
const PAGE_SIZE = 20;

let moveType = "in";
let movingItemId = null;
let pendingDelete = null; // id حقيقي لحركة المخزون

/* ── تجميع الحركات الحقيقية من السيرفر + حساب الرصيد المتحرك لكل صنف
   (نفس فكرة buildMovements القديمة، بس المصدر بقى API حقيقي) ── */
function buildMovements(itemsList, rawMoves) {
  const all = [];
  itemsList.forEach((item) => {
    const itemMoves = rawMoves
      .filter((m) => m.inventoryItemId === item.id)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    if (!itemMoves.length) return;

    // احسب الرصيد قبل أول حركة بالرجوع من الكمية الحالية الفعلية
    let runQty = Number(item.qty);
    for (let i = itemMoves.length - 1; i >= 0; i--) {
      const mv = itemMoves[i];
      const q = Number(mv.qty);
      if (mv.movementType === "in") runQty -= q;
      else runQty += q;
    }
    let balance = runQty;

    itemMoves.forEach((mv) => {
      const before = balance;
      const q = Number(mv.qty);
      if (mv.movementType === "in") balance += q;
      else balance -= q;

      all.push({
        id: mv.id, // id حقيقي في قاعدة البيانات
        matId: item.id,
        matCode: item.code || "",
        matName: item.name,
        matUnit: item.unit || "",
        matCost: Number(mv.unitPrice ?? item.unitPrice ?? 0),
        matQty: Number(item.qty),
        matMin: Number(item.minQty),
        type: mv.movementType,
        qty: q,
        date: (mv.createdAt || "").slice(0, 10),
        notes: mv.notes || "",
        refType:
          mv.referenceType ?
            refTypeLabel[mv.referenceType] || mv.referenceType
          : "",
        ts: new Date(mv.createdAt).getTime(),
        balanceBefore: Math.round(before * 100) / 100,
        balanceAfter: Math.round(balance * 100) / 100,
      });
    });
  });
  return all;
}

/* ── INIT ── */
document.addEventListener("DOMContentLoaded", async () => {
  initEvents();
  await loadInitialData();
});

async function loadInitialData() {
  try {
    const [invRes, movesRes] = await Promise.all([
      apiCall("/inventory"),
      apiCall("/stock-movements"),
    ]);
    items = invRes || [];
    allMovements = buildMovements(items, movesRes || []);
    renderKPIs();
    renderChart();
    renderStats();
    renderMaterialFilter();
    renderTable();
  } catch (e) {
    showToast("فشل تحميل حركات المخزون: " + e.message, "error");
  }
}

/* ── KPI ── */
function renderKPIs() {
  const movs = allMovements;
  const inMovs = movs.filter((m) => m.type === "in");
  const outMovs = movs.filter((m) => m.type === "out");
  const totalIn = inMovs.reduce((s, m) => s + m.qty, 0);
  const totalOut = outMovs.reduce((s, m) => s + m.qty, 0);
  const net = totalIn - totalOut;
  const valIn = inMovs.reduce((s, m) => s + m.qty * m.matCost, 0);
  const activeMats = new Set(movs.map((m) => m.matId)).size;

  setText("kpi-total", movs.length);
  setText("kpi-in-count", inMovs.length);
  setText("kpi-out-count", outMovs.length);
  const netEl = $("kpi-net");
  if (netEl) {
    netEl.textContent = (net >= 0 ? "+" : "") + fmt(net);
    netEl.style.color = net >= 0 ? "var(--green)" : "var(--red)";
  }
  setText("kpi-val", fmt(valIn) + " ج.م");
  setText("kpi-mats", activeMats);
}

/* ── CHART: 14 يوم ── */
function renderChart() {
  const chartBody = $("mv-chart-body");
  const chartLabels = $("mv-chart-labels");
  if (!chartBody) return;

  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push({
      key: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString("ar-EG", { month: "short", day: "numeric" }),
      inQty: 0,
      outQty: 0,
    });
  }
  allMovements.forEach((mv) => {
    const bucket = days.find((d) => d.key === mv.date);
    if (!bucket) return;
    if (mv.type === "in") bucket.inQty += mv.qty;
    else bucket.outQty += mv.qty;
  });
  const maxVal = Math.max(...days.map((d) => Math.max(d.inQty, d.outQty)), 1);

  chartBody.innerHTML = "";
  days.forEach((d) => {
    const col = el("div", "mv-chart-col");
    const pair = el("div", "mv-bar-pair");
    const bIn = el("div", "mv-bar in");
    bIn.style.height = Math.round((d.inQty / maxVal) * 100) + "%";
    bIn.dataset.tip = `وارد ${fmt(d.inQty)} — ${d.label}`;
    const bOut = el("div", "mv-bar out");
    bOut.style.height = Math.round((d.outQty / maxVal) * 100) + "%";
    bOut.dataset.tip = `منصرف ${fmt(d.outQty)} — ${d.label}`;
    pair.appendChild(bIn);
    pair.appendChild(bOut);
    col.appendChild(pair);
    chartBody.appendChild(col);
  });
  if (chartLabels)
    chartLabels.innerHTML = days.map((d) => `<span>${d.label}</span>`).join("");
}

/* ── QUICK STATS ── */
function renderStats() {
  const movs = allMovements;
  if (!movs.length) return;

  const byMat = {};
  movs.forEach((m) => (byMat[m.matId] = (byMat[m.matId] || 0) + 1));
  const topMat = Object.entries(byMat).sort((a, b) => b[1] - a[1])[0];
  setText(
    "stat-most-active",
    topMat ? items.find((i) => i.id === Number(topMat[0]))?.name || "—" : "—",
  );

  const latest = [...movs].sort((a, b) => b.ts - a.ts)[0];
  setText(
    "stat-last-move",
    latest ? `${formatDateAr(latest.date)} — ${latest.matName}` : "—",
  );

  const maxIn = movs
    .filter((m) => m.type === "in")
    .sort((a, b) => b.qty - a.qty)[0];
  setText(
    "stat-max-in",
    maxIn ? `${fmt(maxIn.qty)} ${maxIn.matUnit} (${maxIn.matName})` : "—",
  );

  const maxOut = movs
    .filter((m) => m.type === "out")
    .sort((a, b) => b.qty - a.qty)[0];
  setText(
    "stat-max-out",
    maxOut ? `${fmt(maxOut.qty)} ${maxOut.matUnit} (${maxOut.matName})` : "—",
  );

  const refMap = {};
  movs
    .filter((m) => m.refType)
    .forEach((m) => (refMap[m.refType] = (refMap[m.refType] || 0) + 1));
  const topRef = Object.entries(refMap).sort((a, b) => b[1] - a[1])[0];
  setText("stat-top-supplier", topRef ? topRef[0] : "تسجيل يدوي");

  const danger = items.filter((i) => getMatStatus(i) !== "ok").length;
  const dangerEl = $("stat-danger");
  if (dangerEl) {
    dangerEl.textContent = danger + " مادة";
    dangerEl.classList.toggle("danger", danger > 0);
  }
}

/* ── فلتر الأصناف (Dropdown) ── */
function renderMaterialFilter() {
  const sel = $("filter-material");
  if (sel) {
    while (sel.options.length > 1) sel.remove(1);
    items.forEach((it) => {
      const opt = document.createElement("option");
      opt.value = String(it.id);
      opt.textContent = `${it.name} (${it.code || "—"})`;
      sel.appendChild(opt);
    });
  }
  const movSel = $("move-mat-select");
  if (movSel) {
    while (movSel.options.length > 1) movSel.remove(1);
    items.forEach((it) => {
      const opt = document.createElement("option");
      opt.value = String(it.id);
      opt.textContent = `${it.name} — ${it.code || "—"} (مخزون: ${fmt(it.qty)} ${it.unit || ""})`;
      movSel.appendChild(opt);
    });
  }
}

/* ── فلترة وفرز ── */
function applyFilters() {
  let data = [...allMovements];
  if (activeType !== "all") data = data.filter((m) => m.type === activeType);
  if (filterMaterial !== "all")
    data = data.filter((m) => String(m.matId) === filterMaterial);
  if (filterDateFrom) data = data.filter((m) => m.date >= filterDateFrom);
  if (filterDateTo) data = data.filter((m) => m.date <= filterDateTo);
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    data = data.filter(
      (m) =>
        m.matName.toLowerCase().includes(q) ||
        m.matCode.toLowerCase().includes(q) ||
        (m.notes && m.notes.toLowerCase().includes(q)),
    );
  }
  switch (sortMode) {
    case "date-asc":
      data.sort((a, b) => a.ts - b.ts);
      break;
    case "qty-desc":
      data.sort((a, b) => b.qty - a.qty);
      break;
    case "qty-asc":
      data.sort((a, b) => a.qty - b.qty);
      break;
    case "mat-name":
      data.sort((a, b) => a.matName.localeCompare(b.matName, "ar"));
      break;
    default:
      data.sort((a, b) => b.ts - a.ts);
  }
  filtered = data;
  return data;
}

/* ── جدول الحركات ── */
function renderTable() {
  applyFilters();
  setText("tab-all-count", filtered.length);
  setText(
    "tab-in-count",
    activeType === "in" ?
      filtered.length
    : allMovements.filter((m) => m.type === "in").length,
  );
  setText(
    "tab-out-count",
    activeType === "out" ?
      filtered.length
    : allMovements.filter((m) => m.type === "out").length,
  );

  const resLabel = $("results-label");
  if (resLabel)
    resLabel.textContent =
      `${filtered.length} حركة` +
      (filtered.length !== allMovements.length ?
        ` من إجمالي ${allMovements.length}`
      : "");

  const resPeriod = $("results-period");
  if (resPeriod && filtered.length) {
    const dates = filtered
      .map((m) => m.date)
      .filter(Boolean)
      .sort();
    resPeriod.textContent =
      dates.length ?
        dates[0] === dates[dates.length - 1] ?
          formatDateAr(dates[0])
        : `${formatDateAr(dates[0])} — ${formatDateAr(dates[dates.length - 1])}`
      : "";
  } else if (resPeriod) resPeriod.textContent = "";

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE) || 1;
  if (currentPage > totalPages) currentPage = 1;
  const start = (currentPage - 1) * PAGE_SIZE;
  const page = filtered.slice(start, start + PAGE_SIZE);
  const tbody = $("mv-tbody");
  if (!tbody) return;

  if (!page.length) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><i class="fa-solid fa-arrow-right-arrow-left"></i><h4>لا توجد حركات مطابقة</h4><p>جرّب تغيير الفلتر أو البحث أو إعادة الضبط</p></div></td></tr>`;
    renderPagination(0, 1);
    return;
  }

  tbody.innerHTML = page
    .map((mv, i) => {
      const globalIdx = start + i + 1;
      const value = mv.qty * mv.matCost;
      const sign = mv.type === "in" ? "+" : "-";
      return `
    <tr class="row-${mv.type}" data-id="${mv.id}" style="animation-delay:${i * 0.03}s">
      <td class="td-num">${globalIdx}</td>
      <td class="td-date"><div class="td-date-main">${formatDateAr(mv.date)}</div></td>
      <td><div class="td-mat-name">${escHtml(mv.matName)}</div></td>
      <td><span class="td-mat-code">${escHtml(mv.matCode)}</span></td>
      <td><span class="move-badge ${mv.type}"><i class="fa-solid fa-arrow-${mv.type === "in" ? "down" : "up"}"></i> ${mv.type === "in" ? "وارد" : "منصرف"}</span></td>
      <td><span class="td-qty-main ${mv.type}">${sign}${fmt(mv.qty)}</span> <span class="td-qty-unit">${escHtml(mv.matUnit)}</span></td>
      <td><span class="td-balance">${fmt(mv.balanceAfter)}</span> <span class="td-balance-unit">${escHtml(mv.matUnit)}</span></td>
      <td><div class="td-supplier">${escHtml(mv.refType) || "—"}</div><div class="td-reason">${escHtml(mv.notes)}</div></td>
      <td><span class="td-value ${mv.type === "out" ? "out" : ""}">${value > 0 ? fmt(value) + " ج.م" : "—"}</span></td>
      <td>
        <div class="mv-row-actions">
          <button class="row-action detail-btn" data-id="${mv.id}" title="التفاصيل"><i class="fa-solid fa-eye"></i></button>
          <button class="row-action delete-btn" data-id="${mv.id}" title="حذف الحركة"><i class="fa-solid fa-trash"></i></button>
        </div>
      </td>
    </tr>`;
    })
    .join("");

  renderPagination(filtered.length, totalPages);
}

/* ── الترقيم ── */
function renderPagination(total, totalPages) {
  const pg = $("mv-pagination");
  if (!pg) return;
  if (totalPages <= 1) {
    pg.innerHTML = "";
    return;
  }
  const start = (currentPage - 1) * PAGE_SIZE + 1;
  const end = Math.min(currentPage * PAGE_SIZE, total);
  let btnHTML = `<span class="mv-pagination-info">عرض ${start}–${end} من إجمالي ${total} حركة</span>
    <div class="mv-pagination-btns">
      <button class="pg-btn" id="pg-prev" ${currentPage === 1 ? "disabled" : ""}><i class="fa-solid fa-chevron-right"></i></button>`;
  paginationRange(currentPage, totalPages).forEach((p) => {
    btnHTML +=
      p === "…" ?
        `<button class="pg-btn" disabled>…</button>`
      : `<button class="pg-btn${p === currentPage ? " active" : ""}" data-page="${p}">${p}</button>`;
  });
  btnHTML += `<button class="pg-btn" id="pg-next" ${currentPage === totalPages ? "disabled" : ""}><i class="fa-solid fa-chevron-left"></i></button></div>`;
  pg.innerHTML = btnHTML;

  $("pg-prev").addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--;
      renderTable();
    }
  });
  $("pg-next").addEventListener("click", () => {
    if (currentPage < totalPages) {
      currentPage++;
      renderTable();
    }
  });
  pg.querySelectorAll("[data-page]").forEach((btn) =>
    btn.addEventListener("click", () => {
      currentPage = +btn.dataset.page;
      renderTable();
    }),
  );
}
function paginationRange(cur, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (cur <= 4) return [1, 2, 3, 4, 5, "…", total];
  if (cur >= total - 3)
    return [1, "…", total - 4, total - 3, total - 2, total - 1, total];
  return [1, "…", cur - 1, cur, cur + 1, "…", total];
}

/* ── تفاصيل الحركة (Drawer) ── */
function openDrawer(mvId) {
  const mv = allMovements.find((m) => m.id === mvId);
  if (!mv) return;
  const body = $("mv-drawer-body");
  if (!body) return;
  const value = mv.qty * mv.matCost;
  const sign = mv.type === "in" ? "+" : "-";

  body.innerHTML = `
    <div class="dw-section">
      <div class="dw-type-badge ${mv.type}"><i class="fa-solid fa-arrow-${mv.type === "in" ? "down" : "up"}"></i> ${mv.type === "in" ? "استلام وارد" : "صرف منصرف"}</div>
      <div class="dw-qty-display"><span class="dw-qty-num ${mv.type}">${sign}${fmt(mv.qty)}</span><span class="dw-qty-unit">${escHtml(mv.matUnit)}</span></div>
      <div class="dw-info-grid">
        <div class="dw-info-item"><span class="dw-info-label">التاريخ</span><span class="dw-info-val">${formatDateAr(mv.date)}</span></div>
        <div class="dw-info-item"><span class="dw-info-label">القيمة</span><span class="dw-info-val" style="color:var(--${mv.type === "in" ? "green" : "red"})">${value > 0 ? fmt(value, 2) + " ج.م" : "—"}</span></div>
        <div class="dw-info-item"><span class="dw-info-label">المصدر</span><span class="dw-info-val">${escHtml(mv.refType) || "تسجيل يدوي"}</span></div>
        <div class="dw-info-item"><span class="dw-info-label">ملاحظات</span><span class="dw-info-val">${escHtml(mv.notes) || "—"}</span></div>
      </div>
    </div>
    <div class="dw-section">
      <div class="dw-section-title"><i class="fa-solid fa-boxes-stacked"></i> الصنف</div>
      <div class="dw-mat-row"><div class="dw-mat-icon"><i class="fa-solid fa-boxes-stacked"></i></div><div><div class="dw-mat-name">${escHtml(mv.matName)}</div><div class="dw-mat-code">${escHtml(mv.matCode)}</div></div></div>
    </div>
    <div class="dw-section">
      <div class="dw-section-title"><i class="fa-solid fa-scale-balanced"></i> أثر الحركة على الرصيد</div>
      <div class="dw-balance-block">
        <div class="dw-balance-row"><span class="lbl">الرصيد قبل الحركة</span><span class="val">${fmt(mv.balanceBefore)} ${escHtml(mv.matUnit)}</span></div>
        <div class="dw-balance-row"><span class="lbl">${mv.type === "in" ? "كمية مضافة" : "كمية مخصومة"}</span><span class="val" style="color:var(--${mv.type === "in" ? "green" : "red"})">${sign}${fmt(mv.qty)} ${escHtml(mv.matUnit)}</span></div>
        <div class="dw-balance-divider"></div>
        <div class="dw-balance-row"><span class="lbl">الرصيد بعد الحركة</span><span class="val" style="font-size:15px">${fmt(mv.balanceAfter)} ${escHtml(mv.matUnit)}</span></div>
        <div class="dw-balance-row" style="margin-top:8px"><span class="lbl">الرصيد الحالي الفعلي</span><span class="val" style="color:var(--accent)">${fmt(mv.matQty)} ${escHtml(mv.matUnit)}</span></div>
      </div>
    </div>
    <button class="dw-delete-btn" data-id="${mv.id}"><i class="fa-solid fa-trash"></i> حذف هذه الحركة وتعديل الرصيد</button>
  `;
  body.querySelector(".dw-delete-btn").addEventListener("click", () => {
    closeDrawer();
    openConfirm(mv.id);
  });
  $("mv-drawer-overlay").classList.add("open");
  $("mv-drawer").classList.add("open");
}
function closeDrawer() {
  $("mv-drawer-overlay").classList.remove("open");
  $("mv-drawer").classList.remove("open");
}

/* ── مودال إضافة حركة ── */
function openMoveModal(preId) {
  moveType = "in";
  movingItemId = preId || null;
  updateMoveTypeBtns();
  setVal("move-qty", "");
  setVal("move-date", todayStr());
  setVal("move-reason", "");
  setVal("move-cost", "");
  setHint("move-qty-hint", "");
  const matSel = $("move-mat-select");
  if (matSel) matSel.value = preId ? String(preId) : "";
  updateMatBadge();
  $("move-modal").classList.add("open");
  setTimeout(() => {
    if (matSel && !preId) matSel.focus();
  }, 200);
}
function closeMoveModal() {
  $("move-modal").classList.remove("open");
  movingItemId = null;
}
function updateMoveTypeBtns() {
  document
    .querySelectorAll(".move-type-btn")
    .forEach((b) => b.classList.toggle("active", b.dataset.type === moveType));
  const saveBtn = $("move-save-btn");
  if (saveBtn)
    saveBtn.innerHTML =
      moveType === "in" ?
        '<i class="fa-solid fa-arrow-down"></i> تسجيل الاستلام'
      : '<i class="fa-solid fa-arrow-up"></i> تسجيل الصرف';
}
function updateMatBadge() {
  const sel = $("move-mat-select");
  const badge = $("move-mat-badge");
  if (!sel || !badge) return;
  const mat = items.find((i) => String(i.id) === sel.value);
  if (mat) {
    movingItemId = mat.id;
    setText("move-badge-name", mat.name);
    setText("move-badge-code", (mat.code || "—") + " · " + (mat.unit || ""));
    setText("move-badge-qty", fmt(mat.qty) + " " + (mat.unit || ""));
    badge.style.display = "flex";
  } else {
    movingItemId = null;
    badge.style.display = "none";
  }
}

async function saveMovement() {
  const mat = items.find((i) => i.id === movingItemId);
  if (!mat) {
    showToast("اختر صنفاً أولاً", "error");
    return;
  }
  const qty = parseFloat($("move-qty")?.value);
  const date = $("move-date")?.value;
  if (!qty || qty <= 0) {
    showToast("أدخل كمية صحيحة أكبر من صفر", "error");
    return;
  }
  if (!date) {
    showToast("اختر التاريخ", "error");
    return;
  }
  if (moveType === "out" && qty > Number(mat.qty)) {
    showToast(
      `الكمية المطلوبة (${fmt(qty)}) أكبر من المتاح (${fmt(mat.qty)})`,
      "warn",
    );
    return;
  }
  const notes = $("move-reason")?.value.trim() || null;
  const costInp = parseFloat($("move-cost")?.value);

  const btn = $("move-save-btn");
  btn.disabled = true;
  try {
    await apiCall("/stock-movements", {
      method: "POST",
      body: JSON.stringify({
        inventoryItemId: mat.id,
        movementType: moveType,
        qty: String(qty),
        referenceType: "adjustment",
        unitPrice: costInp > 0 ? String(costInp) : mat.unitPrice,
        notes,
      }),
    });
    await loadInitialData();
    closeMoveModal();
    showToast(
      moveType === "in" ?
        `تم تسجيل استلام ${fmt(qty)} ${mat.unit || ""} من ${mat.name}`
      : `تم تسجيل صرف ${fmt(qty)} ${mat.unit || ""} من ${mat.name}`,
      "success",
    );
  } catch (e) {
    showToast("فشل تسجيل الحركة: " + e.message, "error");
  } finally {
    btn.disabled = false;
  }
}

/* ── تأكيد الحذف ── */
function openConfirm(mvId) {
  const mv = allMovements.find((m) => m.id === mvId);
  if (!mv) return;
  pendingDelete = mvId;
  const descEl = $("confirm-desc");
  if (descEl)
    descEl.innerHTML = `${mv.type === "in" ? "وارد" : "منصرف"} — ${fmt(mv.qty)} ${escHtml(mv.matUnit)} — ${escHtml(mv.matName)} — ${formatDateAr(mv.date)}`;
  $("confirm-overlay").classList.add("open");
}
function closeConfirm() {
  $("confirm-overlay").classList.remove("open");
  pendingDelete = null;
}
async function doDeleteMovement() {
  if (!pendingDelete) return;
  const id = pendingDelete;
  try {
    await apiCall(`/stock-movements/${id}`, { method: "DELETE" });
    await loadInitialData();
    showToast("تم حذف الحركة وتعديل الرصيد تلقائيًا", "success");
  } catch (e) {
    showToast("فشل حذف الحركة: " + e.message, "error");
  } finally {
    closeConfirm();
  }
}

/* ── طباعة / تصدير ── */
function printMovements() {
  const rows = applyFilters();
  const now = new Date().toLocaleDateString("ar-EG", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const valTotal = rows
    .filter((m) => m.type === "in")
    .reduce((s, m) => s + m.qty * m.matCost, 0);

  const tableRows = rows
    .map(
      (mv, i) => `
    <tr>
      <td>${i + 1}</td><td>${formatDateAr(mv.date)}</td><td>${escHtml(mv.matName)}</td><td>${escHtml(mv.matCode)}</td>
      <td style="color:${mv.type === "in" ? "#10b981" : "#ef4444"}">${mv.type === "in" ? "وارد" : "منصرف"}</td>
      <td>${fmt(mv.qty)} ${escHtml(mv.matUnit)}</td><td>${fmt(mv.balanceAfter)} ${escHtml(mv.matUnit)}</td>
      <td>${escHtml(mv.notes) || "—"}</td><td>${mv.qty * mv.matCost > 0 ? fmt(mv.qty * mv.matCost, 2) + " ج.م" : "—"}</td>
    </tr>`,
    )
    .join("");

  const win = window.open("", "_blank");
  win.document
    .write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">
  <title>تقرير حركات المخزون — Hyper-Tech ERP</title>
  <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Tajawal',sans-serif;background:#fff;color:#111;direction:rtl;padding:32px}
  .logo{display:flex;align-items:center;gap:12px;margin-bottom:24px}.logo-box{width:42px;height:42px;background:linear-gradient(135deg,#f59e0b,#d97706);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px}
  .logo h1{font-size:18px;font-weight:800}.logo p{font-size:12px;color:#666}h2{font-size:20px;font-weight:800;margin-bottom:4px}.meta{font-size:12px;color:#666;margin-bottom:20px}
  .kpi-row{display:flex;gap:16px;margin-bottom:20px}.kpi{flex:1;background:#f8f9fa;border:1px solid #e5e7eb;border-radius:10px;padding:12px 16px}.kpi-val{font-size:22px;font-weight:800}.kpi-lbl{font-size:11px;color:#666;margin-top:2px}
  table{width:100%;border-collapse:collapse;font-size:12px}thead th{background:#111827;color:#fff;padding:10px 12px;text-align:right;font-weight:700;font-size:11px}
  tbody tr:nth-child(even){background:#f8f9fa}tbody td{padding:9px 12px;border-bottom:1px solid #e5e7eb}
  .footer{margin-top:20px;font-size:11px;color:#999;text-align:center;border-top:1px solid #e5e7eb;padding-top:12px}@media print{body{padding:16px}}</style>
  </head><body>
  <div class="logo"><div class="logo-box">⚡</div><div><h1>Hyper-Tech ERP</h1><p>تقرير حركات المخزون</p></div></div>
  <h2>سجل حركات المخزون</h2><p class="meta">تاريخ الطباعة: ${now} — إجمالي الحركات: ${rows.length}</p>
  <div class="kpi-row">
    <div class="kpi"><div class="kpi-val">${rows.length}</div><div class="kpi-lbl">إجمالي الحركات</div></div>
    <div class="kpi"><div class="kpi-val" style="color:#10b981">${rows.filter((m) => m.type === "in").length}</div><div class="kpi-lbl">حركات وارد</div></div>
    <div class="kpi"><div class="kpi-val" style="color:#ef4444">${rows.filter((m) => m.type === "out").length}</div><div class="kpi-lbl">حركات منصرف</div></div>
    <div class="kpi"><div class="kpi-val" style="color:#10b981">${fmt(valTotal, 2)} ج.م</div><div class="kpi-lbl">قيمة الوارد</div></div>
  </div>
  <table><thead><tr><th>#</th><th>التاريخ</th><th>المادة</th><th>الكود</th><th>النوع</th><th>الكمية</th><th>الرصيد بعد</th><th>ملاحظات</th><th>القيمة</th></tr></thead>
  <tbody>${tableRows}</tbody></table>
  <div class="footer">Hyper-Tech ERP — نظام إدارة الموارد — تقرير حركات المخزون</div>
  <script>window.onload = () => window.print();<\/script></body></html>`);
  win.document.close();
}

function exportCSV() {
  const rows = applyFilters();
  const header = [
    "#",
    "التاريخ",
    "المادة",
    "الكود",
    "النوع",
    "الكمية",
    "الوحدة",
    "الرصيد بعد",
    "ملاحظات",
    "القيمة (ج.م)",
  ];
  const csvRows = [
    header,
    ...rows.map((mv, i) => [
      i + 1,
      mv.date,
      mv.matName,
      mv.matCode,
      mv.type === "in" ? "وارد" : "منصرف",
      mv.qty,
      mv.matUnit,
      mv.balanceAfter,
      mv.notes || "",
      (mv.qty * mv.matCost).toFixed(2),
    ]),
  ];
  const csv =
    "\uFEFF" +
    csvRows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `حركات-المخزون-${todayStr()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("تم تصدير الملف بنجاح", "success");
}

/* ── Toast ── */
let toastTimer;
function showToast(msg, type = "success") {
  const t = $("toast");
  const m = $("toast-msg");
  const ico = $("toast-icon");
  if (!t) return;
  if (m) m.textContent = msg;
  if (ico)
    ico.className =
      type === "success" ? "fa-solid fa-circle-check"
      : type === "warn" ? "fa-solid fa-triangle-exclamation"
      : "fa-solid fa-circle-xmark";
  t.className =
    "toast show" +
    (type === "warn" ? " toast-warn"
    : type === "error" ? " toast-error"
    : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = "toast"), 3000);
}

/* ── Utilities ── */
function setText(id, val) {
  const e = $(id);
  if (e) e.textContent = val;
}
function setVal(id, val) {
  const e = $(id);
  if (e) e.value = val;
}
function setHint(id, msg, cls) {
  const e = $(id);
  if (!e) return;
  e.textContent = msg;
  e.className = "form-hint" + (cls ? " " + cls : "");
}

/* ── Events ── */
function initEvents() {
  $("btn-add-move")?.addEventListener("click", () => openMoveModal());
  $("btn-print")?.addEventListener("click", printMovements);
  $("btn-export")?.addEventListener("click", exportCSV);

  $("search-input")?.addEventListener("input", (e) => {
    searchQuery = e.target.value.trim();
    currentPage = 1;
    renderTable();
  });

  document.querySelectorAll(".mv-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document
        .querySelectorAll(".mv-tab")
        .forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      activeType = tab.dataset.type;
      currentPage = 1;
      renderTable();
    });
  });

  $("filter-material")?.addEventListener("change", (e) => {
    filterMaterial = e.target.value;
    currentPage = 1;
    renderTable();
  });
  $("filter-date-from")?.addEventListener("change", (e) => {
    filterDateFrom = e.target.value;
    currentPage = 1;
    renderTable();
  });
  $("filter-date-to")?.addEventListener("change", (e) => {
    filterDateTo = e.target.value;
    currentPage = 1;
    renderTable();
  });
  $("sort-select")?.addEventListener("change", (e) => {
    sortMode = e.target.value;
    currentPage = 1;
    renderTable();
  });

  $("btn-clear-filters")?.addEventListener("click", () => {
    searchQuery = "";
    activeType = "all";
    filterMaterial = "all";
    filterDateFrom = "";
    filterDateTo = "";
    sortMode = "date-desc";
    currentPage = 1;
    setVal("search-input", "");
    setVal("filter-material", "all");
    setVal("filter-date-from", "");
    setVal("filter-date-to", "");
    setVal("sort-select", "date-desc");
    document
      .querySelectorAll(".mv-tab")
      .forEach((t) => t.classList.remove("active"));
    document.querySelector('.mv-tab[data-type="all"]')?.classList.add("active");
    renderTable();
  });

  $("mv-tbody")?.addEventListener("click", (e) => {
    const detailBtn = e.target.closest(".detail-btn");
    const deleteBtn = e.target.closest(".delete-btn");
    const row = e.target.closest("tr[data-id]");
    if (detailBtn) return openDrawer(Number(detailBtn.dataset.id));
    if (deleteBtn) return openConfirm(Number(deleteBtn.dataset.id));
    if (row) openDrawer(Number(row.dataset.id));
  });

  $("mv-drawer-close")?.addEventListener("click", closeDrawer);
  $("mv-drawer-overlay")?.addEventListener("click", closeDrawer);

  $("confirm-yes")?.addEventListener("click", doDeleteMovement);
  $("confirm-no")?.addEventListener("click", closeConfirm);
  $("confirm-overlay")?.addEventListener("click", (e) => {
    if (e.target === $("confirm-overlay")) closeConfirm();
  });

  $("move-close")?.addEventListener("click", closeMoveModal);
  $("move-cancel")?.addEventListener("click", closeMoveModal);
  $("move-modal")?.addEventListener("click", (e) => {
    if (e.target === $("move-modal")) closeMoveModal();
  });

  document.querySelectorAll(".move-type-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      moveType = btn.dataset.type;
      updateMoveTypeBtns();
      setHint("move-qty-hint", "");
    });
  });

  $("move-mat-select")?.addEventListener("change", () => {
    updateMatBadge();
    setHint("move-qty-hint", "");
  });

  $("move-qty")?.addEventListener("input", (e) => {
    const mat = items.find((i) => i.id === movingItemId);
    const qty = parseFloat(e.target.value);
    if (!mat || !qty) {
      setHint("move-qty-hint", "");
      return;
    }
    if (moveType === "out") {
      if (qty > Number(mat.qty))
        setHint(
          "move-qty-hint",
          `⚠ المتاح فقط ${fmt(mat.qty)} ${mat.unit || ""}`,
          "error",
        );
      else
        setHint(
          "move-qty-hint",
          `الرصيد بعد الصرف: ${fmt(Number(mat.qty) - qty)} ${mat.unit || ""}`,
          "",
        );
    } else {
      setHint(
        "move-qty-hint",
        `الرصيد بعد الاستلام: ${fmt(Number(mat.qty) + qty)} ${mat.unit || ""}`,
        "",
      );
    }
  });

  $("move-save-btn")?.addEventListener("click", saveMovement);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeMoveModal();
      closeDrawer();
      closeConfirm();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "n") {
      e.preventDefault();
      openMoveModal();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "p") {
      e.preventDefault();
      printMovements();
    }
  });
}
