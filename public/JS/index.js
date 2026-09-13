/** @format */

// ============================================
//  DASHBOARD — Hyper-Tech ERP
//  لوحة التحكم — ملخص من بيانات حقيقية
//  (/api/v1/production-workflow + /api/v1/inventory + /api/v1/dashboard)
//  لا يوجد إنشاء/تعديل/حذف هنا — عرض فقط
// ============================================

async function apiCall(path, options = {}) {
  return window.HyperTechAuth.request(path, options);
}

// ✅ إصلاح: كانت الحالتان delivery_pending_customer و delivery_pending_warehouse
// (مستخدمتان فعليًا في enhancements.js ضمن MyActionsSystem) غير موجودتين هنا
// خالص، فكانت أي أوامر بهاتين الحالتين تظهر بشارة "جديد" (fallback) بشكل مضلل
// تمامًا، رغم إنها في الواقع في آخر خطوة قبل التسليم الفعلي مباشرة.
const statusMap = {
  new: { label: "جديد", cls: "blue" },
  pending_supervisor: { label: "بانتظار مشرف", cls: "amber" },
  materials_requested: { label: "بانتظار المخازن", cls: "amber" },
  materials_approved: { label: "المواد معتمدة", cls: "blue" },
  materials_partial: { label: "اعتماد جزئي", cls: "amber" },
  materials_rejected: { label: "مرفوض", cls: "red" },
  in_production: { label: "قيد التنفيذ", cls: "green" },
  quality_check: { label: "فحص الجودة", cls: "purple" },
  delivery_pending_customer: { label: "بانتظار تسليم العميل", cls: "amber" },
  delivery_pending_warehouse: { label: "بانتظار تسليم المخزن", cls: "amber" },
  completed: { label: "مكتمل", cls: "purple" },
  delivered_customer: { label: "تم التسليم", cls: "green" },
  delivered_warehouse: { label: "تم التسليم للمخزن", cls: "green" },
  cancelled: { label: "ملغي", cls: "red" },
};
const DELIVERED = ["delivered_customer", "delivered_warehouse"];
const alertIcons = {
  danger: "fa-triangle-exclamation",
  warn: "fa-clock",
  info: "fa-truck",
  ok: "fa-circle-check",
};
const catShort = { raw_material: "raw", wip: "wip", finished_good: "finished" };

let productionOrders = [];
let inventoryItems = [];
let financeQualityData = null;

/* ── Load ──
   ✅ إصلاح: Promise.all كان بيرفض الاتنين مع بعض لو واحد بس فشل (مثلاً
   المخزون واقع بس الإنتاج شغال) فتضيع بيانات كان ممكن تتعرض بنجاح.
   Promise.allSettled بيخلي كل مصدر يفشل أو ينجح لوحده، والداشبورد تعرض
   أقصى قدر ممكن من البيانات الحقيقية حتى لو مصدر واحد واقع. */
async function loadDashboard() {
  const [poResult, invResult, dashResult] = await Promise.allSettled([
    apiCall("/production-workflow"),
    apiCall("/inventory"),
    apiCall("/dashboard"),
  ]);

  const poOk = poResult.status === "fulfilled";
  const invOk = invResult.status === "fulfilled";
  const dashOk = dashResult.status === "fulfilled";

  productionOrders = poOk ? poResult.value.data || [] : [];
  inventoryItems = invOk ? invResult.value || [] : [];
  financeQualityData = dashOk ? dashResult.value : null;

  if (!poOk || !invOk) {
    const failedParts = [!poOk && "أوامر الإنتاج", !invOk && "المخزون"]
      .filter(Boolean)
      .join(" و");
    showToast(`تعذّر تحميل بيانات: ${failedParts}`, "warn");
  }
  setLiveStatus(poOk && invOk);

  renderOrders();
  renderAlerts();
  updateKPIs();
  updateChart();
  updateDonut();
  renderFinanceQuality();
}

// ✨ إضافة: شارة "مباشر" بتتحول فعليًا لحالة "غير متصل" لو فشل تحميل
// البيانات الأساسية، بدل ما تفضل خضراء نابضة بشكل مضلل حتى لو فيه عطل
function setLiveStatus(isOnline) {
  const badge = document.getElementById("live-badge");
  const text = document.getElementById("live-badge-text");
  if (!badge) return;
  badge.classList.toggle("offline", !isOnline);
  if (text) text.textContent = isOnline ? "مباشر" : "غير متصل";
}

// ملاحظة معيارية مهمة: هذا التصنيف "low/out/ok" مستقل عن حساب lowStockCount
// في الباك إند (dashboard.ts يحسبها كـ qty <= minQty مباشرة). هنا بنستخدم
// درجة تحذير مبكر أدق (أقل من 40% من الحد الأدنى = "قارب على النفاد" بلون
// تحذير، صفر أو أقل = "نفد" بلون خطر) عشان تنبيهات لوحة التحكم تكون متدرجة
// وليست ثنائية فقط. الاختلاف مقصود ومفهوم، مش خطأ.
function getInvStatus(item) {
  const qty = Number(item.qty);
  const min = Number(item.minQty);
  if (qty <= 0) return "out";
  if (min > 0 && qty < min * 0.4) return "low";
  return "ok";
}

function deriveAlerts() {
  const alerts = [];

  inventoryItems.forEach((item) => {
    const st = getInvStatus(item);
    if (st === "out") {
      alerts.push({
        type: "danger",
        title: `نفد من المخزن: ${item.name}`,
        body: `الكمية: 0 ${item.unit || ""} — الحد الأدنى ${fmt(item.minQty)} ${item.unit || ""}`,
        time: "الآن",
      });
    } else if (st === "low") {
      alerts.push({
        type: "warn",
        title: `قارب على النفاد: ${item.name}`,
        body: `الكمية: ${fmt(item.qty)} ${item.unit || ""} — الحد الأدنى ${fmt(item.minQty)} ${item.unit || ""}`,
        time: "الآن",
      });
    }
  });

  const today = new Date().toISOString().slice(0, 10);
  productionOrders.forEach((o) => {
    if (o.workflowStatus === "materials_rejected") {
      alerts.push({
        type: "danger",
        title: `مواد مرفوضة: ${o.orderNumber}`,
        body: `${o.productName} — بانتظار مراجعة المخازن`,
        time: "اليوم",
      });
    } else if (
      !DELIVERED.includes(o.workflowStatus) &&
      o.workflowStatus !== "cancelled" &&
      o.neededBy &&
      o.neededBy < today
    ) {
      alerts.push({
        type: "danger",
        title: `أمر متأخر عن موعده: ${o.orderNumber}`,
        body: `${o.productName} — كان مطلوب تسليمه ${fmtDate(o.neededBy)}`,
        time: "اليوم",
      });
    } else if (o.workflowStatus === "materials_requested") {
      alerts.push({
        type: "warn",
        title: `بانتظار قرار المخازن: ${o.orderNumber}`,
        body: `${o.productName} — في انتظار اعتماد المواد`,
        time: "اليوم",
      });
    }
  });

  // ✨ إضافة: تنبيه "info" لأي صنف قرّب من حد إعادة الطلب حتى لو لسه ما
  // وصلش لحد التحذير المحلي — نفس القائمة الذكية approachingLowStock
  // المحسوبة أصلًا في dashboard.ts (نسبة الاقتراب) ومالهاش عرض قبل كده.
  if (financeQualityData?.inventory?.approachingLowStock?.length) {
    financeQualityData.inventory.approachingLowStock.forEach((item) => {
      const alreadyCovered = inventoryItems.some(
        (i) => i.id === item.id && getInvStatus(i) !== "ok",
      );
      if (!alreadyCovered) {
        alerts.push({
          type: "info",
          title: `اقترب من حد إعادة الطلب: ${item.name}`,
          body: `نسبة الاقتراب: ${item.proximityRatio ?? "—"}`,
          time: "الآن",
        });
      }
    });
  }

  return alerts;
}

/* ── Orders table ── */
function renderOrders() {
  // ✅ إصلاح: الاعتماد على .bottom-row table tbody (بنية التخطيط) كان هشًا —
  // أي تغيير مستقبلي في ترتيب العناصر يكسره بصمت. استخدام الـ id المباشر أضمن.
  const tbody = document.getElementById("orders-tbody");
  if (!tbody) return;
  const active = productionOrders
    .filter(
      (o) =>
        !DELIVERED.includes(o.workflowStatus) &&
        o.workflowStatus !== "cancelled",
    )
    .slice(0, 8);

  if (!active.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-cell"><div class="empty-state"><i class="fa-solid fa-clipboard-list"></i><h4>لا توجد أوامر نشطة</h4><p>أضف أوامر إنتاج من صفحة الإنتاج</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = active
    .map((o) => {
      const s = statusMap[o.workflowStatus] || statusMap.new;
      // ✅ حماية: لو qty غير رقمية (بيانات ناقصة/تالفة قادمة من السيرفر)
      // نعرض "—" بدل NaN بلا معنى
      const qtyNum = Number(o.qty);
      const qtyDisplay =
        Number.isFinite(qtyNum) ? qtyNum.toLocaleString("ar-EG") : "—";
      return `
      <tr data-id="${o.id}">
        <td class="td-code">${escHtml(o.orderNumber)}</td>
        <td class="td-product">${escHtml(o.productName)}</td>
        <td class="td-qty">${qtyDisplay}</td>
        <td><span class="badge ${s.cls}">${s.label}</span></td>
        <td style="color: var(--text-muted); font-size: 12px">${fmtDate(o.neededBy)}</td>
      </tr>`;
    })
    .join("");
}

/* ── Alerts ── */
function renderAlerts() {
  const list = document.getElementById("alerts-list");
  if (!list) return;
  const alerts = deriveAlerts();

  if (!alerts.length) {
    list.innerHTML = `<div class="empty-state"><i class="fa-solid fa-circle-check"></i><h4>لا توجد تنبيهات</h4><p>كل شيء يسير بشكل طبيعي</p></div>`;
  } else {
    list.innerHTML = alerts
      .map(
        (a) => `
      <div class="alert-item">
        <div class="alert-icon ${a.type}"><i class="fa-solid ${alertIcons[a.type]}"></i></div>
        <div class="alert-body"><h5>${escHtml(a.title)}</h5><p>${escHtml(a.body)}</p></div>
        <div class="alert-actions"><span class="alert-time">${a.time}</span></div>
      </div>`,
      )
      .join("");
  }

  const badge = document.getElementById("alert-badge");
  if (badge) badge.textContent = `${alerts.length} تنبيه`;
}

/* ── KPIs ── */
function updateKPIs() {
  const thisMonth = new Date().toISOString().slice(0, 7);
  const completedThisMonth = productionOrders.filter(
    (o) =>
      DELIVERED.includes(o.workflowStatus) &&
      (o.updatedAt || o.createdAt || "").slice(0, 7) === thisMonth,
  ).length;

  let fillPercent = 0;
  if (inventoryItems.length) {
    const ratios = inventoryItems.map((item) => {
      const min = Number(item.minQty);
      if (!min) return 100;
      return Math.min(100, Math.round((Number(item.qty) / min) * 100));
    });
    fillPercent = Math.round(ratios.reduce((a, b) => a + b, 0) / ratios.length);
  }

  const activeOrders = productionOrders.filter(
    (o) =>
      !DELIVERED.includes(o.workflowStatus) && o.workflowStatus !== "cancelled",
  ).length;
  const lowStock = inventoryItems.filter(
    (i) => getInvStatus(i) !== "ok",
  ).length;

  // ✅ إصلاح: استخدام data-kpi بدل الاعتماد على ترتيب العناصر في الصفحة
  setKpi("completed", completedThisMonth.toLocaleString("ar-EG"));
  setKpi(
    "fillPercent",
    `${fillPercent}<span style="font-size:16px;color:var(--text-muted)">%</span>`,
    true,
  );
  setKpi("active", activeOrders.toLocaleString("ar-EG"));
  setKpi("lowStock", lowStock.toLocaleString("ar-EG"));
}

function setKpi(key, value, isHtml = false) {
  const el = document.querySelector(`.kpi-val[data-kpi="${key}"]`);
  if (!el) return;
  if (isHtml) el.innerHTML = value;
  else el.textContent = value;
}

/* ── Bar chart: توزيع حالات أوامر الإنتاج ── */
function updateChart() {
  const chart = document.querySelector(".bar-chart");
  if (!chart) return;

  if (!productionOrders.length) {
    chart.innerHTML = `<div class="empty-state"><i class="fa-solid fa-chart-simple"></i><h4>لا توجد بيانات إنتاج</h4><p>ستظهر بمجرد إضافة أوامر إنتاج</p></div>`;
    return;
  }

  const groups = [
    { key: "materials_requested", label: "بانتظار المخازن" },
    { key: "in_production", label: "قيد التنفيذ" },
    { key: "quality_check", label: "فحص الجودة" },
    { key: "completed", label: "مكتمل" },
    { key: "materials_rejected", label: "مرفوض" },
  ];
  const counts = groups.map(
    (g) => productionOrders.filter((o) => o.workflowStatus === g.key).length,
  );
  const max = Math.max(...counts, 1);

  chart.innerHTML = groups
    .map((g, i) => {
      const height = Math.round((counts[i] / max) * 100);
      return `<div class="bar-group"><div class="bar-pair"><div class="chart-bar primary" style="height: ${height}%" title="${counts[i]}"></div></div><div class="bar-label">${g.label}</div></div>`;
    })
    .join("");
}

/* ── Donut: توزيع المخزون حسب الفئة ── */
function updateDonut() {
  const area = document.querySelector(".donut-area");
  if (!area) return;

  if (!inventoryItems.length) {
    area.innerHTML = `<div class="empty-state"><i class="fa-solid fa-warehouse"></i><h4>لا توجد أصناف في المخزن</h4><p>أضف أصناف من صفحة المخزن</p></div>`;
    return;
  }

  const cats = { raw: 0, wip: 0, finished: 0 };
  inventoryItems.forEach((item) => {
    const c = catShort[item.category];
    if (c) cats[c]++;
  });
  const total = inventoryItems.length || 1;
  const rawPct = Math.round((cats.raw / total) * 100);
  const wipPct = Math.round((cats.wip / total) * 100);
  const finishedPct = Math.round((cats.finished / total) * 100);

  const svg = area.querySelector("svg");
  if (svg) {
    const c1 = rawPct * 1.44;
    const c2 = wipPct * 1.44;
    const c3 = finishedPct * 1.44;
    const circles = svg.querySelectorAll("circle:not(:first-child)");
    if (circles[0]) {
      circles[0].setAttribute("stroke-dasharray", `${c1} ${144 - c1}`);
      circles[0].setAttribute("stroke-dashoffset", "0");
    }
    if (circles[1]) {
      circles[1].setAttribute("stroke-dasharray", `${c2} ${144 - c2}`);
      circles[1].setAttribute("stroke-dashoffset", `-${c1}`);
    }
    if (circles[2]) {
      circles[2].setAttribute("stroke-dasharray", `${c3} ${144 - c3}`);
      circles[2].setAttribute("stroke-dashoffset", `-${c1 + c2}`);
    }
  }

  const center = area.querySelector(".donut-center h3");
  if (center) center.textContent = `${total}`;
  const centerLabel = area.querySelector(".donut-center p");
  if (centerLabel) centerLabel.textContent = "صنف";

  const legendVals = area.querySelectorAll(".donut-leg-val");
  if (legendVals[0]) legendVals[0].textContent = `${rawPct}%`;
  if (legendVals[1]) legendVals[1].textContent = `${wipPct}%`;
  if (legendVals[2]) legendVals[2].textContent = `${finishedPct}%`;
}

/* ── ✨ Finance & Quality Snapshot — إضافة جديدة ──
   تستهلك GET /api/v1/dashboard اللي كان بيُحسب بالكامل في الباك إند
   (صافي الربح، نسبة الجودة واتجاهها، أصناف قربت من حد الطلب) من غير أي
   مكان في الواجهة يعرضه من الأساس. */
function renderFinanceQuality() {
  const grid = document.getElementById("fq-grid");
  if (!grid) return;

  if (!financeQualityData) {
    grid.innerHTML = `<div class="empty-state" style="grid-column: span 3">
      <i class="fa-solid fa-triangle-exclamation"></i>
      <h4>تعذّر تحميل النظرة المالية</h4>
      <p>سيُعاد المحاولة تلقائيًا</p>
    </div>`;
    return;
  }

  const d = financeQualityData;
  const passRate = d.quality?.passRate ?? 0;
  const trendDir = d.quality?.trend?.direction || "stable";
  const trendIcon =
    trendDir === "up" ? "fa-arrow-trend-up"
    : trendDir === "down" ? "fa-arrow-trend-down"
    : "fa-minus";
  const trendLabel =
    trendDir === "up" ? "تحسّن عن الأسبوع الماضي"
    : trendDir === "down" ? "تراجع عن الأسبوع الماضي"
    : "مستقر";

  const watchlist = d.inventory?.approachingLowStock || [];
  const watchlistHtml =
    watchlist.length ?
      watchlist
        .map(
          (item) => `
      <div class="fq-watch-row">
        <span class="fq-watch-name">${escHtml(item.name)}</span>
        <span class="fq-watch-ratio">${item.proximityRatio != null ? `${(item.proximityRatio * 100).toFixed(0)}%` : "—"} من الحد الأدنى</span>
      </div>`,
        )
        .join("")
    : `<div class="notif-empty" style="padding:10px 0"><p>لا توجد أصناف قريبة من حد إعادة الطلب</p></div>`;

  grid.innerHTML = `
    <div class="fq-item">
      <div class="fq-item-label"><i class="fa-solid fa-magnifying-glass-chart"></i> نسبة اجتياز الجودة</div>
      <div class="fq-item-val">${passRate}%
        <span class="fq-trend ${trendDir}"><i class="fa-solid ${trendIcon}"></i></span>
      </div>
      <div style="font-size:11px;color:var(--text-dim);margin-top:4px">${trendLabel}</div>
    </div>
    <div class="fq-item">
      <div class="fq-item-label"><i class="fa-solid fa-cart-shopping"></i> مبيعات آخر 7 أيام</div>
      <div class="fq-item-val">${fmt(d.sales?.trend?.last7DaysOrders)} <span style="font-size:12px;color:var(--text-dim)">أمر</span></div>
    </div>
    <div class="fq-watchlist">
      <div class="fq-item-label"><i class="fa-solid fa-triangle-exclamation"></i> أصناف قربت من حد إعادة الطلب</div>
      ${watchlistHtml}
    </div>
  `;
}

/* ── Helpers ── */
function fmt(n) {
  return Number(n || 0).toLocaleString("ar-EG");
}
function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("ar-EG", {
      day: "numeric",
      month: "short",
    });
  } catch {
    return d;
  }
}
function updateTime() {
  const el = document.getElementById("last-update");
  if (el)
    el.textContent = new Date().toLocaleTimeString("ar-EG", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
}
function showToast(msg, type = "success") {
  const toast = document.getElementById("toast");
  if (!toast) return;
  document.getElementById("toast-msg").textContent = msg;
  toast.style.background = type === "warn" ? "var(--red)" : "var(--green)";
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
}

/* ── NAV ── */
document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", function (e) {
    if (this.getAttribute("href") === "#") e.preventDefault();
    document
      .querySelectorAll(".nav-item")
      .forEach((i) => i.classList.remove("active"));
    this.classList.add("active");
  });
});

/* ── INIT ── */
updateTime();
setInterval(updateTime, 1000);
const dateEl = document.getElementById("dashboard-date");
if (dateEl)
  dateEl.textContent = new Date().toLocaleDateString("ar-EG", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
loadDashboard();
setInterval(loadDashboard, 60000); // تحديث تلقائي كل دقيقة
