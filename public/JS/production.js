/** @format */
// ===================================================
//  PRODUCTION — Hyper-Tech ERP
//  لوحة متابعة إدارية كاملة على نظام دورة الإنتاج الحقيقي
//  (/api/v1/production-workflow) — نفس البيانات اللي المشرفين
//  ومدير المخازن ومراقب الجودة شغالين عليها فعليًا في صفحات الفاكتوري
// ===================================================

async function apiCall(path, options = {}) {
  return window.HyperTechAuth.request(path, options);
}

/* ── حالات الـ workflow ── */
const statusMap = {
  new: { label: "جديد", cls: "blue", icon: "fa-star" },
  awaiting_operations_claim: {
    label: "في انتظار استلام التشغيل",
    cls: "amber",
    icon: "fa-hand",
  },
  claimed: { label: "تم استلامه من التشغيل", cls: "blue", icon: "fa-handshake" },
  pending_supervisor: {
    label: "بانتظار مشرف",
    cls: "amber",
    icon: "fa-hourglass-half",
  },
  materials_requested: {
    label: "بانتظار المخازن",
    cls: "amber",
    icon: "fa-warehouse",
  },
  materials_approved: { label: "المواد معتمدة", cls: "blue", icon: "fa-check" },
  materials_partial: {
    label: "اعتماد جزئي للمواد",
    cls: "amber",
    icon: "fa-triangle-exclamation",
  },
  materials_rejected: {
    label: "المواد مرفوضة",
    cls: "red",
    icon: "fa-circle-xmark",
  },
  in_production: { label: "قيد التنفيذ", cls: "green", icon: "fa-gears" },
  quality_check: {
    label: "فحص الجودة",
    cls: "purple",
    icon: "fa-magnifying-glass",
  },
  completed: {
    label: "مكتمل — بانتظار التسليم",
    cls: "purple",
    icon: "fa-circle-check",
  },
  delivery_pending_customer: {
    label: "بانتظار تأكيد الاتش آر",
    cls: "amber",
    icon: "fa-user-clock",
  },
  delivery_pending_warehouse: {
    label: "بانتظار استلام المخزن",
    cls: "amber",
    icon: "fa-warehouse",
  },
  delivered_customer: {
    label: "تم التسليم للعميل",
    cls: "green",
    icon: "fa-handshake",
  },
  delivered_warehouse: {
    label: "تم التسليم للمخزن",
    cls: "green",
    icon: "fa-boxes-stacked",
  },
  cancelled: { label: "ملغي", cls: "red", icon: "fa-ban" },
  held: { label: "معلّق", cls: "amber", icon: "fa-pause" },
  rework: { label: "إعادة تشغيل", cls: "purple", icon: "fa-rotate" },
  partially_completed: { label: "مكتمل جزئياً", cls: "purple", icon: "fa-circle-half-stroke" },
  corrected: { label: "يحتاج تصحيحاً", cls: "red", icon: "fa-wand-magic-sparkles" },
  closed: { label: "مغلق", cls: "green", icon: "fa-lock" },
};
const priorityColor = {
  low: "var(--text-muted)",
  normal: "var(--accent2)",
  high: "var(--red)",
  urgent: "#dc2626",
};
const priorityLabel = {
  low: "منخفضة",
  normal: "عادية",
  high: "مرتفعة",
  urgent: "عاجلة جداً",
};
const STAGE_LABELS = {
  line_setup: "تجهيز الخط",
  manufacturing: "تصنيع فعلي",
  assembly_packing: "تجميع/تغليف",
  ready_for_quality: "جاهز لفحص الجودة",
};
const PRODUCTION_STAGES = [
  "line_setup",
  "manufacturing",
  "assembly_packing",
  "ready_for_quality",
];

/* ── State ── */
let orders = [];
let bomRecipes = [];
let teamOptions = { supervisors: [], qualityControllers: [] };
let inventoryItems = [];
let activeFilter = "all";
let searchQuery = "";
let currentOrder = null;

/* ── Init ── */
(async function init() {
  updateTime();
  setInterval(updateTime, 1000);
  bindEvents();
  loadProductionCycle();
  await loadInitialData();
})();

async function loadInitialData() {
  try {
    const [ordersRes, bomRes] = await Promise.all([
      apiCall("/production-workflow"),
      apiCall("/bom").catch(() => []),
    ]);
    orders = ordersRes || [];
    bomRecipes = bomRes || [];
    updateKPIs();
    renderOrders();
  } catch (e) {
    showToast("فشل تحميل أوامر الإنتاج: " + e.message, "warn");
  }
}

async function loadProductionCycle() {
  const track = document.getElementById("production-cycle-track");
  if (!track) return;
  try {
    const response = await apiCall("/production-cycle/dashboard");
    const cycle = response;
    const delivered = Number(cycle.totals.completedOrders || 0);
    document.getElementById("cycle-summary").textContent =
      `${cycle.totals.activeOrders} أمر نشط · ${delivered} تم تسليمه · ${cycle.totals.blockedOrders} يحتاج متابعة`;
    track.innerHTML = cycle.stages
      .map(
        (stage) => `
        <div class="cycle-stage ${stage.orderCount ? "has-orders" : ""}">
          <div class="cycle-stage-index">${stage.number}</div>
          <div class="cycle-stage-body">
            <strong>${escHtml(stage.shortName)}</strong>
            <span>${stage.orderCount} أمر</span>
          </div>
        </div>`,
      )
      .join("");
  } catch (error) {
    track.innerHTML = `<div class="cycle-error">تعذر تحميل مراحل الدورة: ${escHtml(error.message)}</div>`;
  }
}

async function ensureTeamOptions() {
  try {
    teamOptions = await apiCall("/production-workflow/team-options");
  } catch {
    teamOptions = { supervisors: [], qualityControllers: [] };
  }
}
async function ensureInventory() {
  if (!inventoryItems.length) {
    try {
      inventoryItems = (await apiCall("/inventory")) || [];
    } catch {
      inventoryItems = [];
    }
  }
}

/* ── Filtering ── */
// ✅ مجموعات حالات (Status Buckets): "مكتمل" هنا مش حالة واحدة بس — هي مجموعة
// (مكتمل + بانتظار تأكيد الاتش آر + بانتظار استلام المخزن) بتتجمع مع بعضها بصريًا
// في نفس التبويب، عشان الأمر يفضل ظاهر وتحت متابعة مدير الإنتاج طول فترة انتظار
// التسليم — ومايختفيش إلا لما يتأكد التسليم فعليًا (delivered_customer/warehouse).
// كل كارت بيوري حالته الحقيقية بالظبط في الشارة، الجروب ده بس منطق تصفية/عرض.
const STATUS_GROUPS = {
  completed: [
    "completed",
    "delivery_pending_customer",
    "delivery_pending_warehouse",
  ],
};
function matchesFilter(status, filter) {
  if (filter === "all") return true;
  const group = STATUS_GROUPS[filter];
  return group ? group.includes(status) : status === filter;
}

function filteredOrders() {
  return orders.filter((o) => {
    if (!matchesFilter(o.workflowStatus, activeFilter)) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (
        !o.orderNumber.toLowerCase().includes(q) &&
        !(o.productName || "").toLowerCase().includes(q) &&
        !(o.customerName || "").toLowerCase().includes(q)
      )
        return false;
    }
    return true;
  });
}

function updateKPIs() {
  setText("kpi-total", orders.length);
  setText(
    "kpi-running",
    orders.filter((o) => o.workflowStatus === "in_production").length,
  );
  setText(
    "kpi-pending",
    orders.filter((o) => o.workflowStatus === "materials_requested").length,
  );
  setText(
    "kpi-late",
    orders.filter((o) => o.workflowStatus === "materials_rejected").length,
  );
  setText(
    "kpi-done",
    orders.filter((o) => STATUS_GROUPS.completed.includes(o.workflowStatus))
      .length,
  );
}

function renderOrders() {
  const grid = document.getElementById("orders-grid");
  const list = filteredOrders();
  if (!list.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><i class="fa-solid fa-industry"></i><h4>لا توجد أوامر إنتاج مطابقة</h4><p>جرّب تغيير الفلتر أو أنشئ أمرًا جديدًا</p></div>`;
    return;
  }
  grid.innerHTML = list
    .map((order) => {
      const s = statusMap[order.workflowStatus] || statusMap.new;
      const stageIdx = PRODUCTION_STAGES.indexOf(order.currentStage);
      const stageProgress =
        order.workflowStatus === "in_production" && stageIdx >= 0 ?
          Math.round(((stageIdx + 1) / PRODUCTION_STAGES.length) * 100)
        : (
          order.workflowStatus === "completed" ||
          order.workflowStatus.startsWith("delivered")
        ) ?
          100
        : 0;
      return `
    <div class="order-card" onclick="openDetail(${order.id})" style="cursor:pointer">
      <div class="order-card-head">
        <div>
          <div class="order-card-title">${escHtml(order.productName)}</div>
          <div class="order-card-code">${escHtml(order.orderNumber)}</div>
        </div>
        <span class="order-status-badge ${s.cls}"><i class="fa-solid ${s.icon}"></i> ${s.label}</span>
      </div>
      <div class="order-card-meta">
        <div class="order-meta-row"><i class="fa-solid fa-boxes-stacked"></i><span>الكمية:</span><span class="order-meta-val">${Number(order.qty).toLocaleString("ar-EG")} ${escHtml(order.unit || "")}</span></div>
        ${order.productionLine ? `<div class="order-meta-row"><i class="fa-solid fa-industry"></i><span>خط الإنتاج ${escHtml(order.productionLine)}</span><span style="margin-right:auto;color:${priorityColor[order.priority]};font-size:11px;font-weight:700">● ${priorityLabel[order.priority] || escHtml(order.priority)}</span></div>` : `<div class="order-meta-row"><span style="color:${priorityColor[order.priority]};font-size:11px;font-weight:700">● ${priorityLabel[order.priority] || escHtml(order.priority)}</span></div>`}
        ${order.supervisorName ? `<div class="order-meta-row"><i class="fa-solid fa-user-tie"></i><span>${escHtml(order.supervisorName)}</span></div>` : ""}
        <div class="order-meta-row"><i class="fa-solid fa-calendar-days"></i><span>مطلوب تسليمه:</span><span class="order-meta-val">${fmtDate(order.neededBy)}</span></div>
        ${order.workflowStatus === "in_production" ? `<div style="margin-top:4px"><div class="order-progress-track"><div class="order-progress-bar" style="width:${stageProgress}%"></div></div></div>` : ""}
      </div>
    </div>`;
    })
    .join("");
}

/* ── Detail Drawer ── */
async function openDetail(id) {
  let order;
  let lifecycle = null;
  try {
    const [res, lifecycleRes] = await Promise.all([
      apiCall(`/production-workflow/${id}`),
      apiCall(`/production-workflow/${id}/lifecycle`).catch(() => null),
    ]);
    order = res;
    lifecycle = lifecycleRes;
  } catch (e) {
    showToast("تعذّر تحميل الأمر: " + e.message, "warn");
    return;
  }
  currentOrder = order;
  const s = statusMap[order.workflowStatus] || statusMap.new;
  document.getElementById("dp-title").textContent = order.productName;
  document.getElementById("dp-code").textContent = order.orderNumber;

  let actionsHtml = "";
  try {
    actionsHtml = await buildActionSection(order);
  } catch (e) {
    actionsHtml = `<div class="detail-section"><p style="color:var(--red)">تعذّر تجهيز الإجراءات: ${escHtml(e.message)}</p></div>`;
  }

  document.getElementById("detail-body").innerHTML = `
    <div class="detail-section"><div class="detail-section-title">الحالة العامة</div>
      <div class="detail-row"><span class="detail-row-label">الحالة</span><span class="order-status-badge ${s.cls}" style="font-size:11px"><i class="fa-solid ${s.icon}"></i> ${s.label}</span></div>
      <div class="detail-row"><span class="detail-row-label">الأولوية</span><span class="detail-row-val" style="color:${priorityColor[order.priority]}">${priorityLabel[order.priority] || escHtml(order.priority)}</span></div>
      ${order.productionLine ? `<div class="detail-row"><span class="detail-row-label">خط الإنتاج</span><span class="detail-row-val">${escHtml(order.productionLine)}</span></div>` : ""}
      ${order.supervisorName ? `<div class="detail-row"><span class="detail-row-label">المشرف</span><span class="detail-row-val">${escHtml(order.supervisorName)}</span></div>` : ""}
      ${order.qualityControllerName ? `<div class="detail-row"><span class="detail-row-label">مراقب الجودة</span><span class="detail-row-val">${escHtml(order.qualityControllerName)}</span></div>` : ""}
    </div>
    <div class="detail-section"><div class="detail-section-title">العميل والطلب</div>
      <div class="detail-row"><span class="detail-row-label">العميل</span><span class="detail-row-val">${escHtml(order.customerName) || "—"}</span></div>
      ${order.customerPhone ? `<div class="detail-row"><span class="detail-row-label">الهاتف</span><span class="detail-row-val">${escHtml(order.customerPhone)}</span></div>` : ""}
      <div class="detail-row"><span class="detail-row-label">الكمية</span><span class="detail-row-val">${Number(order.qty).toLocaleString("ar-EG")} ${escHtml(order.unit || "")}</span></div>
      ${order.orderDetails ? `<div class="detail-row"><span class="detail-row-label">تفاصيل</span><span class="detail-row-val">${escHtml(order.orderDetails)}</span></div>` : ""}
    </div>
    <div class="detail-section"><div class="detail-section-title">التواريخ</div>
      <div class="detail-row"><span class="detail-row-label">موعد التسليم المطلوب</span><span class="detail-row-val">${fmtDate(order.neededBy)} <button class="btn-ghost" style="padding:2px 8px;font-size:11px;margin-right:6px" onclick="event.stopPropagation();openEditNeededBy()"><i class="fa-solid fa-pen"></i></button></span></div>
      ${order.startDate ? `<div class="detail-row"><span class="detail-row-label">بداية الإنتاج</span><span class="detail-row-val">${fmtDate(order.startDate)}</span></div>` : ""}
      ${order.endDate ? `<div class="detail-row"><span class="detail-row-label">نهاية الإنتاج</span><span class="detail-row-val">${fmtDate(order.endDate)}</span></div>` : ""}
    </div>
    ${renderLifecycleSection(order, lifecycle)}
    ${order.workflowStatus === "in_production" ? renderStagesSection(order) : ""}
    ${order.qualityNotes ? `<div class="detail-section"><div class="detail-section-title">ملاحظات الجودة</div><p style="font-size:13px;color:var(--text-muted);line-height:1.6">${escHtml(order.qualityNotes)}</p></div>` : ""}
    ${order.notes ? `<div class="detail-section"><div class="detail-section-title">ملاحظات</div><p style="font-size:13px;color:var(--text-muted);line-height:1.6">${escHtml(order.notes)}</p></div>` : ""}
    ${actionsHtml}
    ${!["delivered_customer", "delivered_warehouse", "cancelled"].includes(order.workflowStatus) ? `<div class="detail-section"><button class="btn-ghost" style="width:100%;color:var(--red);border-color:rgba(239,68,68,0.3)" onclick="if(confirm('متأكد من إلغاء أمر الإنتاج؟ الإجراء لا يمكن التراجع عنه.'))doCancel(${order.id})"><i class="fa-solid fa-ban"></i> إلغاء أمر الإنتاج</button></div>` : ""}
  `;
  document.getElementById("detail-overlay").classList.add("open");
  document.body.style.overflow = "hidden";
}

function renderLifecycleSection(order, lifecycle) {
  if (!lifecycle) return "";
  const gates = (lifecycle.blockedGates || []).map((gate) =>
    `<div class="lifecycle-gate ${gate.blocked ? "blocked" : "ok"}"><i class="fa-solid ${gate.blocked ? "fa-lock" : "fa-check"}"></i><span>${escHtml(gate.label)}</span><small>${escHtml(gate.detail)}</small></div>`,
  ).join("");
  const timeline = (lifecycle.timeline || []).slice().reverse().map((event) =>
    `<div class="lifecycle-event"><span class="lifecycle-dot"></span><div><strong>${escHtml(event.to?.label || event.toStatus)}</strong><small>${escHtml(event.actorName || "النظام")} · ${fmtDate(event.createdAt)}</small>${event.reason ? `<p>${escHtml(event.reason)}</p>` : ""}</div></div>`,
  ).join("");
  const health = lifecycle.conformance?.ok
    ? `<span class="lifecycle-health ok">متوافق</span>`
    : `<span class="lifecycle-health blocked">يحتاج مراجعة</span>`;
  const canAdjust = !["closed", "cancelled"].includes(order.workflowStatus);
  return `<div class="detail-section lifecycle-section">
    <div class="detail-section-title">الهوية ودورة الحياة ${health}</div>
    <div class="lifecycle-summary"><span><b>نوع السجل</b> أمر إنتاج canonical</span><span><b>المصدر</b> ${escHtml(lifecycle.sourceSnapshot?.sourceType || "غير محدد")} · ${escHtml(lifecycle.sourceSnapshot?.reference || "—")}</span><span><b>Revision</b> ${order.lifecycleRevision ?? 0}</span></div>
    <div class="lifecycle-gates">${gates || "<span class='muted'>لا توجد بوابات محجوبة</span>"}</div>
    ${canAdjust ? `<div class="lifecycle-actions">
      ${["in_production", "quality_check", "partially_completed"].includes(order.workflowStatus) ? `<button class="btn-ghost lifecycle-action" onclick="openLifecyclePrompt('held')"><i class="fa-solid fa-pause"></i> تعليق</button>` : ""}
      ${["quality_check", "held", "rework"].includes(order.workflowStatus) ? `<button class="btn-ghost lifecycle-action" onclick="openLifecyclePrompt('rework')"><i class="fa-solid fa-rotate"></i> إعادة تشغيل</button>` : ""}
      ${["in_production", "quality_check"].includes(order.workflowStatus) ? `<button class="btn-ghost lifecycle-action" onclick="openPartialCompletion()"><i class="fa-solid fa-circle-half-stroke"></i> إكمال جزئي</button>` : ""}
      ${["completed", "delivered_customer", "delivered_warehouse"].includes(order.workflowStatus) ? `<button class="btn-ghost lifecycle-action" onclick="openLifecyclePrompt('corrected')"><i class="fa-solid fa-wand-magic-sparkles"></i> تصحيح</button>` : ""}
    </div>` : ""}
    <div class="lifecycle-timeline">${timeline || "<span class='muted'>لا يوجد سجل انتقالات</span>"}</div>
  </div>`;
}

async function openLifecyclePrompt(targetStatus) {
  const reason = window.prompt(`اذكر سبب الانتقال إلى ${statusMap[targetStatus]?.label || targetStatus}`);
  if (!reason?.trim()) return;
  try {
    await apiCall(`/production-workflow/${currentOrder.id}/transition`, {
      method: "POST",
      body: JSON.stringify({ targetStatus, reason, expectedRevision: currentOrder.lifecycleRevision }),
    });
    showToast("تم تسجيل الانتقال مع السبب");
    await openDetail(currentOrder.id);
    await loadInitialData();
  } catch (error) {
    showToast(error.message, "warn");
  }
}

async function openPartialCompletion() {
  const quantity = window.prompt("الكمية التي اكتملت جزئياً");
  const reason = window.prompt("سبب الإكمال الجزئي");
  if (!quantity || !reason?.trim()) return;
  try {
    await apiCall(`/production-workflow/${currentOrder.id}/partial-completion`, {
      method: "POST",
      body: JSON.stringify({ quantity, reason, expectedRevision: currentOrder.lifecycleRevision }),
    });
    showToast("تم تسجيل الإكمال الجزئي");
    await openDetail(currentOrder.id);
    await loadInitialData();
  } catch (error) {
    showToast(error.message, "warn");
  }
}

function renderStagesSection(order) {
  const curIdx = PRODUCTION_STAGES.indexOf(order.currentStage || "line_setup");
  return `<div class="detail-section"><div class="detail-section-title">مراحل الإنتاج (${curIdx + 1}/${PRODUCTION_STAGES.length})</div>
    ${PRODUCTION_STAGES.map((st, idx) => `<div class="detail-row" style="gap:10px;justify-content:flex-start"><i class="fa-solid ${idx <= curIdx ? "fa-square-check" : "fa-square"}" style="color:${idx <= curIdx ? "var(--green)" : "var(--text-dim)"};font-size:16px"></i><span style="color:${idx <= curIdx ? "var(--text-main)" : "var(--text-muted)"};font-size:13px">${STAGE_LABELS[st]}</span></div>`).join("")}
  </div>`;
}

/* ── بناء قسم الإجراءات حسب حالة الأمر الحالية ── */
async function buildActionSection(order) {
  const st = order.workflowStatus;

  if (st === "new") {
    await ensureTeamOptions();
    const supOpts = teamOptions.supervisors
      .map(
        (s) =>
          `<option value="${s.id}">${escHtml(s.fullName)} (${s.activeCount} أمر جاري)</option>`,
      )
      .join("");
    const qcOpts = teamOptions.qualityControllers
      .map(
        (q) =>
          `<option value="${q.id}">${escHtml(q.fullName)} (${q.activeCount} أمر جاري)</option>`,
      )
      .join("");
    return `<div class="detail-section"><div class="detail-section-title">استلام الأمر وتعيين الفريق</div>
      <div class="form-group"><label>المشرف</label><select id="act-supervisor">${supOpts || "<option>لا يوجد مشرفون</option>"}</select></div>
      <div class="form-group"><label>مراقب الجودة</label><select id="act-qc">${qcOpts || "<option>لا يوجد مراقبو جودة</option>"}</select></div>
      <div class="form-group"><label>خط الإنتاج</label><input type="text" id="act-line" placeholder="مثال: 1"/></div>
      <div class="form-group"><label>تاريخ بداية الإنتاج</label><input type="date" id="act-start" value="${todayStr()}"/></div>
      <div class="form-group"><label>الحالة التشغيلية</label><select id="act-op-status"><option value="running">جاهز للتشغيل</option><option value="pending">معلّق</option></select></div>
      <div class="form-group" id="act-pending-reason-wrap" style="display:none"><label>سبب التعليق</label><input type="text" id="act-pending-reason"/></div>
      <button class="btn-primary" style="width:100%;margin-top:8px" onclick="doReceive(${order.id})"><i class="fa-solid fa-inbox"></i> استلام الأمر وإرساله للمخازن</button>
    </div>`;
  }

  if (st === "materials_requested") {
    let materials = [];
    try {
      const r = await apiCall(
        `/production-workflow/${order.id}/materials-check`,
      );
      materials = r.materials || [];
    } catch {}
    const matRows = materials
      .map(
        (m, i) => `<div class="detail-row" style="align-items:center">
        <span class="detail-row-label">${escHtml(m.materialName)}<br/><span style="font-size:11px;color:var(--text-muted)">مطلوب: ${fmt(m.requestedQty)} — متاح: ${fmt(m.availableQty)} ${escHtml(m.unit || "")}</span></span>
        <span style="display:flex;align-items:center;gap:6px">
          <span class="${m.sufficient ? "" : "detail-row-val"}" style="color:${m.sufficient ? "var(--green)" : "var(--red)"};font-size:11px">${m.sufficient ? "✓ متاح" : "✗ غير كافٍ"}</span>
          <input type="number" step="0.001" min="0" id="mat-qty-${order.id}-${i}" value="${Math.min(Number(m.requestedQty), Number(m.availableQty)).toFixed(3)}" style="width:80px;background:var(--bg-dark);border:1px solid var(--border);border-radius:6px;color:var(--text-main);font-size:12px;padding:4px 6px" title="الكمية المعتمدة (للموافقة الجزئية)"/>
        </span>
      </div>`,
      )
      .join("");
    return `<div class="detail-section"><div class="detail-section-title">فحص المواد المطلوبة</div>${matRows || "<p style='font-size:12px;color:var(--text-muted)'>لا توجد بيانات مواد</p>"}
      ${materials.length ? `<p style="font-size:11px;color:var(--text-muted);margin-top:6px">الحقول جنب كل مادة هي الكمية اللي هتتخصم عند "موافقة جزئية" فقط — بتتجاهل مع الموافقة الكاملة أو الرفض.</p>` : ""}
    </div>
    <div class="detail-section"><div class="detail-section-title">قرار المخازن</div>
      <div class="form-group"><label>ملاحظة (اختياري)</label><input type="text" id="act-comment"/></div>
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
        <button class="btn-primary" style="flex:1;min-width:120px" onclick="doWarehouseAction(${order.id},'approve')"><i class="fa-solid fa-check"></i> اعتماد كامل</button>
        <button class="btn-ghost" style="flex:1;min-width:120px" onclick="doWarehouseAction(${order.id},'partial', ${materials.length})"><i class="fa-solid fa-scale-balanced"></i> موافقة جزئية</button>
        <button class="btn-ghost" style="flex:1;min-width:120px;color:var(--red)" onclick="doWarehouseAction(${order.id},'reject')"><i class="fa-solid fa-xmark"></i> رفض</button>
      </div>
    </div>`;
  }

  if (st === "materials_approved" || st === "materials_partial") {
    return `<div class="detail-section"><div class="detail-section-title">إرسال للتنفيذ</div>
      <button class="btn-primary" style="width:100%" onclick="doDispatch(${order.id})"><i class="fa-solid fa-paper-plane"></i> إرسال للمشرف ومراقب الجودة</button>
    </div>`;
  }

  if (st === "in_production") {
    const curIdx = PRODUCTION_STAGES.indexOf(
      order.currentStage || "line_setup",
    );
    const canAdvance = curIdx < PRODUCTION_STAGES.length - 1;
    return `<div class="detail-section"><div class="detail-section-title">إدارة المرحلة</div>
      ${canAdvance ? `<button class="btn-primary" style="width:100%" onclick="doAdvanceStage(${order.id})"><i class="fa-solid fa-forward"></i> الانتقال للمرحلة التالية</button>` : `<p style="font-size:12px;color:var(--text-muted)">وصل لآخر مرحلة — بانتظار فحص الجودة</p>`}
    </div>`;
  }

  if (st === "quality_check") {
    return `<div class="detail-section"><div class="detail-section-title">نتيجة فحص الجودة</div>
      <div class="form-group"><label>ملاحظات الجودة</label><textarea id="act-qnotes" rows="2"></textarea></div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn-primary" style="flex:1;background:var(--green)" onclick="doQualityDone(${order.id},'passed')"><i class="fa-solid fa-check"></i> ناجح</button>
        <button class="btn-ghost" style="flex:1;color:var(--red)" onclick="doQualityDone(${order.id},'failed')"><i class="fa-solid fa-xmark"></i> فشل</button>
      </div>
    </div>`;
  }

  if (st === "completed") {
    await ensureInventory();
    const invOpts = inventoryItems
      .map((i) => `<option value="${i.id}">${escHtml(i.name)}</option>`)
      .join("");
    return `<div class="detail-section"><div class="detail-section-title">بدء إجراء التسليم</div>
      <p style="font-size:11px;color:var(--text-muted);margin-bottom:8px">ده بس بداية الإجراء — التسليم مش هيتقفل نهائيًا إلا بعد ما الاتش آر (لو للعميل) أو مدير المخازن (لو للمخزن) يأكّد الاستلام فعليًا.</p>
      <div class="form-group"><label>نوع التسليم</label><select id="act-delivery-type" onchange="document.getElementById('act-inv-wrap').style.display=this.value==='warehouse'?'block':'none'"><option value="customer">تسليم مباشر للعميل (يتأكد من الاتش آر)</option><option value="warehouse">تسليم للمخزن كمنتج تام (يتأكد من مدير المخازن)</option></select></div>
      <div class="form-group" id="act-inv-wrap" style="display:none"><label>إضافة إلى صنف مخزون</label><select id="act-inv-item"><option value="">— بدون —</option>${invOpts}</select></div>
      <div class="form-group"><label>ملاحظات التسليم</label><input type="text" id="act-delivery-notes"/></div>
      <button class="btn-primary" style="width:100%;margin-top:8px" onclick="doDeliver(${order.id})"><i class="fa-solid fa-paper-plane"></i> إرسال طلب التسليم للتأكيد</button>
    </div>`;
  }

  if (
    st === "delivery_pending_customer" ||
    st === "delivery_pending_warehouse"
  ) {
    const who =
      st === "delivery_pending_customer" ? "الاتش آر" : "مدير المخازن";
    return `<div class="detail-section"><div class="detail-section-title">بانتظار التأكيد من ${who}</div>
      <p style="font-size:12px;color:var(--text-muted)">تم إرسال طلب التسليم بالفعل، وبانتظار ${who} يأكّد الاستلام. بما إن عندك صلاحية كاملة، تقدر تأكّده بنفسك لو محتاج:</p>
      <button class="btn-primary" style="width:100%;margin-top:8px" onclick="doConfirmDelivery(${order.id})"><i class="fa-solid fa-check-double"></i> تأكيد التسليم نيابةً عن ${who}</button>
    </div>`;
  }

  return "";
}

document.addEventListener("change", (e) => {
  if (e.target && e.target.id === "act-op-status") {
    document.getElementById("act-pending-reason-wrap").style.display =
      e.target.value === "pending" ? "block" : "none";
  }
});

/* ── Actions ── */
async function doReceive(id) {
  const supervisorId = Number(document.getElementById("act-supervisor").value);
  const qualityControllerUserId = Number(
    document.getElementById("act-qc").value,
  );
  const supervisorName = document
    .getElementById("act-supervisor")
    .selectedOptions[0]?.textContent.split(" (")[0];
  const qualityControllerName = document
    .getElementById("act-qc")
    .selectedOptions[0]?.textContent.split(" (")[0];
  const productionLine = document.getElementById("act-line").value.trim();
  const startDate = document.getElementById("act-start").value;
  const operationalStatus = document.getElementById("act-op-status").value;
  const pendingReason =
    document.getElementById("act-pending-reason")?.value.trim() || null;
  if (
    !supervisorId ||
    !qualityControllerUserId ||
    !productionLine ||
    !startDate
  ) {
    showToast("املأ كل بيانات الاستلام", "warn");
    return;
  }
  try {
    await apiCall(`/production-workflow/${id}/receive`, {
      method: "PATCH",
      body: JSON.stringify({
        supervisorId,
        supervisorName,
        qualityControllerUserId,
        qualityControllerName,
        productionLine,
        startDate,
        operationalStatus,
        pendingReason,
      }),
    });
    showToast("تم استلام الأمر وإرساله للمخازن");
    await refreshAndReopen(id);
  } catch (e) {
    showToast("فشل: " + e.message, "warn");
  }
}

async function doWarehouseAction(id, action, materialsCount) {
  const comment = document.getElementById("act-comment")?.value.trim() || null;
  const payload = { action, comment };

  if (action === "partial") {
    if (!materialsCount) {
      showToast(
        "مفيش مواد مرتبطة بالمخزون في وصفة المنتج ده — استخدم اعتماد كامل أو رفض",
        "warn",
      );
      return;
    }
    let materials = [];
    try {
      const r = await apiCall(`/production-workflow/${id}/materials-check`);
      materials = r.materials || [];
    } catch (e) {
      showToast("تعذّر جلب بيانات المواد: " + e.message, "warn");
      return;
    }
    payload.materialDecisions = materials.map((m, i) => ({
      materialName: m.materialName,
      inventoryItemId: m.inventoryItemId,
      approvedQty: document.getElementById(`mat-qty-${id}-${i}`)?.value || "0",
      unit: m.unit,
    }));
  }

  try {
    await apiCall(`/production-workflow/${id}/warehouse-action`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    showToast(
      action === "approve" ? "تم اعتماد المواد وخصمها من المخزون"
      : action === "partial" ? "تم تسجيل الموافقة الجزئية وخصم الكميات المعتمدة"
      : "تم رفض طلب المواد",
    );
    await refreshAndReopen(id);
  } catch (e) {
    showToast("فشل: " + e.message, "warn");
  }
}

async function doDispatch(id) {
  try {
    await apiCall(`/production-workflow/${id}/dispatch`, { method: "PATCH" });
    showToast("تم إرسال الأمر للتنفيذ");
    await refreshAndReopen(id);
  } catch (e) {
    showToast("فشل: " + e.message, "warn");
  }
}

async function doAdvanceStage(id) {
  try {
    const r = await apiCall(`/production-workflow/${id}/advance-stage`, {
      method: "PATCH",
    });
    showToast(r.message || "تم تحديث المرحلة");
    await refreshAndReopen(id);
  } catch (e) {
    showToast("فشل: " + e.message, "warn");
  }
}

async function doQualityDone(id, qualityStatus) {
  const qualityNotes =
    document.getElementById("act-qnotes")?.value.trim() || null;
  try {
    const r = await apiCall(`/production-workflow/${id}/quality-done`, {
      method: "PATCH",
      body: JSON.stringify({ qualityStatus, qualityNotes }),
    });
    showToast(r.message || "تم تسجيل النتيجة");
    await refreshAndReopen(id);
  } catch (e) {
    showToast("فشل: " + e.message, "warn");
  }
}

async function doDeliver(id) {
  const deliveryType = document.getElementById("act-delivery-type").value;
  const deliveryNotes =
    document.getElementById("act-delivery-notes").value.trim() || null;
  const inventoryItemId =
    document.getElementById("act-inv-item")?.value || null;
  try {
    await apiCall(`/production-workflow/${id}/deliver`, {
      method: "PATCH",
      body: JSON.stringify({
        deliveryType,
        deliveryNotes,
        addToInventory: !!inventoryItemId,
        inventoryItemId: inventoryItemId ? Number(inventoryItemId) : null,
      }),
    });
    showToast(
      deliveryType === "customer" ?
        "تم إرسال طلب التسليم للاتش آر لتأكيده"
      : "تم إرسال طلب الاستلام لمدير المخازن لتأكيده",
    );
    await refreshAndReopen(id);
  } catch (e) {
    showToast("فشل: " + e.message, "warn");
  }
}

async function doConfirmDelivery(id) {
  try {
    const r = await apiCall(`/production-workflow/${id}/confirm-delivery`, {
      method: "PATCH",
    });
    showToast(r.message || "تم تأكيد التسليم — اكتملت دورة الإنتاج");
    await refreshAndReopen(id, true);
  } catch (e) {
    showToast("فشل: " + e.message, "warn");
  }
}

async function doCancel(id) {
  try {
    await apiCall(`/production-workflow/${id}/cancel`, { method: "PATCH" });
    showToast("تم إلغاء أمر الإنتاج");
    closeDetail();
    await loadInitialData();
  } catch (e) {
    showToast("فشل: " + e.message, "warn");
  }
}

function openEditNeededBy() {
  const newDate = prompt(
    "موعد التسليم الجديد (YYYY-MM-DD):",
    currentOrder.neededBy,
  );
  if (!newDate) return;
  const reason = prompt("سبب التعديل (اختياري):", "") || null;
  apiCall(`/production-workflow/${currentOrder.id}/needed-by`, {
    method: "PATCH",
    body: JSON.stringify({ neededBy: newDate, reason }),
  })
    .then(() => {
      showToast("تم تعديل موعد التسليم");
      return refreshAndReopen(currentOrder.id);
    })
    .catch((e) => showToast("فشل: " + e.message, "warn"));
}

async function refreshAndReopen(id, closeInstead = false) {
  await loadInitialData();
  if (closeInstead) closeDetail();
  else await openDetail(id);
}

function closeDetail() {
  document.getElementById("detail-overlay").classList.remove("open");
  document.body.style.overflow = "";
  currentOrder = null;
}

/* ── Create New Order ── */
async function openCreateModal() {
  document.getElementById("modal-recipe").innerHTML =
    '<option value="">— اختر وصفة —</option>' +
    bomRecipes
      .map((r) => `<option value="${r.id}">${escHtml(r.productName)}</option>`)
      .join("");
  [
    "modal-qty",
    "modal-customer-name",
    "modal-customer-phone",
    "modal-order-details",
    "modal-notes",
  ].forEach((id) => (document.getElementById(id).value = ""));
  document.getElementById("modal-unit").value = "قطعة";
  document.getElementById("modal-priority").value = "normal";
  document.getElementById("modal-needed-by").value = "";
  document.getElementById("modal-overlay").classList.add("open");
}
function closeModal() {
  document.getElementById("modal-overlay").classList.remove("open");
}

async function saveNewOrder() {
  const bomRecipeId =
    Number(document.getElementById("modal-recipe").value) || null;
  const qty = document.getElementById("modal-qty").value;
  const unit = document.getElementById("modal-unit").value.trim() || "قطعة";
  const customerName = document
    .getElementById("modal-customer-name")
    .value.trim();
  const customerPhone =
    document.getElementById("modal-customer-phone").value.trim() || null;
  const priority = document.getElementById("modal-priority").value;
  const neededBy = document.getElementById("modal-needed-by").value;
  const orderDetails =
    document.getElementById("modal-order-details").value.trim() || null;
  const notes = document.getElementById("modal-notes").value.trim() || null;

  if (!bomRecipeId || !qty || !customerName || !neededBy) {
    showToast(
      "املأ الحقول الأساسية: المنتج، الكمية، العميل، موعد التسليم",
      "warn",
    );
    return;
  }
  const recipe = bomRecipes.find((r) => r.id === bomRecipeId);
  const btn = document.getElementById("modal-save");
  btn.disabled = true;
  try {
    await apiCall("/production-workflow", {
      method: "POST",
      body: JSON.stringify({
        productName: recipe.productName,
        qty,
        unit,
        bomRecipeId,
        customerName,
        customerPhone,
        orderSource: "direct",
        orderDetails,
        priority,
        neededBy,
        notes,
      }),
    });
    showToast("تم إنشاء أمر الإنتاج بنجاح");
    closeModal();
    await loadInitialData();
  } catch (e) {
    showToast("فشل الإنشاء: " + e.message, "warn");
  } finally {
    btn.disabled = false;
  }
}

/* ── Helpers ── */
function todayStr() {
  return new Date().toISOString().split("T")[0];
}
function fmt(n) {
  return Number(n || 0).toLocaleString("ar-EG");
}
function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("ar-EG", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return d;
  }
}
function setText(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  document.getElementById("toast-msg").textContent = msg;
  t.style.background = type === "warn" ? "var(--red)" : "var(--green)";
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3500);
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

/* ── Events ── */
function bindEvents() {
  document
    .getElementById("btn-new-order")
    ?.addEventListener("click", openCreateModal);
  document.getElementById("modal-close")?.addEventListener("click", closeModal);
  document
    .getElementById("modal-cancel")
    ?.addEventListener("click", closeModal);
  document
    .getElementById("modal-save")
    ?.addEventListener("click", saveNewOrder);
  document.getElementById("modal-overlay")?.addEventListener("click", (e) => {
    if (e.target === document.getElementById("modal-overlay")) closeModal();
  });
  document
    .getElementById("detail-close")
    ?.addEventListener("click", closeDetail);
  document.getElementById("detail-overlay")?.addEventListener("click", (e) => {
    if (e.target === document.getElementById("detail-overlay")) closeDetail();
  });

  document.querySelectorAll(".filter-tab").forEach((btn) =>
    btn.addEventListener("click", () => {
      document
        .querySelectorAll(".filter-tab")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeFilter = btn.dataset.filter;
      renderOrders();
    }),
  );
  document.querySelectorAll(".pro-kpi-card").forEach((card) =>
    card.addEventListener("click", () => {
      activeFilter = card.dataset.filterStatus;
      document
        .querySelectorAll(".filter-tab")
        .forEach((b) =>
          b.classList.toggle("active", b.dataset.filter === activeFilter),
        );
      renderOrders();
    }),
  );
  document
    .getElementById("search-input")
    ?.addEventListener("input", function () {
      searchQuery = this.value.trim();
      renderOrders();
    });

  document.querySelectorAll(".nav-item").forEach((item) =>
    item.addEventListener("click", function (e) {
      if (this.getAttribute("href") === "#") e.preventDefault();
      document
        .querySelectorAll(".nav-item")
        .forEach((i) => i.classList.remove("active"));
      this.classList.add("active");
    }),
  );
}
