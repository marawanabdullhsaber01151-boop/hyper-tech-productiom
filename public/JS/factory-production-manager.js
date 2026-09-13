/** @format */
(async function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  function toast(msg) {
    $("toast-msg").textContent = msg;
    const t = $("toast");
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 2500);
  }
  async function api(path, options = {}) {
    return window.HyperTechAuth.request(path, options);
  }

  let currentOrders = [];
  let receivingOrderId = null;
  let deliveringOrderId = null;

  function priorityBadge(p) {
    return (
      {
        urgent: "⚡ عاجل جداً",
        high: "🔴 مرتفع",
        normal: "🟡 عادي",
        low: "🟢 منخفض",
      }[p] || p
    );
  }

  const DELIVERED_STATUSES = window.HyperTechProduction.deliveredStatuses;

  async function loadAll() {
    try {
      const data = await api("/production-workflow");
      currentOrders = data;
      renderColumn(
        "col-new",
        data.filter((o) => o.workflowStatus === "new"),
        renderNewCard,
      );
      renderColumn(
        "col-dispatch",
        data.filter((o) =>
          ["materials_approved", "materials_partial"].includes(
            o.workflowStatus,
          ),
        ),
        renderDispatchCard,
      );
      renderColumn(
        "col-deliver",
        data.filter((o) => o.workflowStatus === "completed"),
        renderDeliverCard,
      );
      renderHistory();
    } catch (e) {
      toast("تعذر تحميل الطلبات: " + e.message);
    }
  }

  function renderColumn(containerId, orders, cardFn) {
    const el = $(containerId);
    if (!orders.length) {
      el.innerHTML = '<p class="empty-hint">لا يوجد حاليًا</p>';
      return;
    }
    el.innerHTML = orders.map(cardFn).join("");
  }

  function renderNewCard(o) {
    return `<div class="pm-card">
      <div class="num">${escHtml(o.orderNumber)}</div>
      <div class="meta">${escHtml(o.productName)} — ${escHtml(o.qty)} ${escHtml(o.unit)}</div>
      <div class="meta">الأولوية: ${priorityBadge(o.priority)} | التسليم: ${escHtml(o.neededBy || "—")}</div>
      <button class="btn-primary" onclick="window.__openReceive(${Number(o.id)})">تم الاستلام</button>
    </div>`;
  }
  function renderDispatchCard(o) {
    return `<div class="pm-card">
      <div class="num">${escHtml(o.orderNumber)}</div>
      <div class="meta">${escHtml(o.productName)} — ${escHtml(o.qty)} ${escHtml(o.unit)}</div>
      <div class="meta">المشرف: ${escHtml(o.supervisorName || "—")} | الجودة: ${escHtml(o.qualityControllerName || "—")}</div>
      <button class="btn-primary" onclick="window.__dispatch(${Number(o.id)})">إرسال أمر الإنتاج للفريق</button>
    </div>`;
  }
  function renderDeliverCard(o) {
    return `<div class="pm-card">
      <div class="num">${escHtml(o.orderNumber)}</div>
      <div class="meta">${escHtml(o.productName)} — ${escHtml(o.qty)} ${escHtml(o.unit)}</div>
      <div class="meta">تاريخ التسليم المطلوب: ${escHtml(o.neededBy || "—")}</div>
      <button class="btn-primary" onclick="window.__openDeliver(${Number(o.id)})">اتخاذ قرار التسليم</button>
    </div>`;
  }

  let teamOptions = { supervisors: [], qualityControllers: [] };
  async function loadTeamOptions() {
    try {
      teamOptions = await api("/production-workflow/team-options");
    } catch (e) {
      teamOptions = { supervisors: [], qualityControllers: [] };
    }
    fillSelect(
      "r-supervisor-select",
      "r-supervisor-empty",
      teamOptions.supervisors,
    );
    fillSelect("r-qc-select", "r-qc-empty", teamOptions.qualityControllers);
  }
  function fillSelect(selectId, emptyId, options) {
    const select = $(selectId);
    if (!options.length) {
      select.innerHTML = "";
      select.disabled = true;
      $(emptyId).style.display = "block";
      return;
    }
    $(emptyId).style.display = "none";
    select.disabled = false;
    select.innerHTML =
      '<option value="">اختر...</option>' +
      options
        .map(
          (o) =>
            `<option value="${o.id}">${escHtml(o.fullName)} ${o.activeCount ? `(${o.activeCount} أوامر جارية)` : ""}</option>`,
        )
        .join("");
  }

  window.__openReceive = function (id) {
    receivingOrderId = id;
    ["r-line", "r-start-date", "r-reason"].forEach((f) => ($(f).value = ""));
    $("r-supervisor-select").value = "";
    $("r-qc-select").value = "";
    $("r-status").value = "running";
    $("r-reason-row").style.display = "none";
    $("receive-modal").classList.add("open");
    loadTeamOptions();
  };
  $("r-status").addEventListener("change", () => {
    $("r-reason-row").style.display =
      $("r-status").value === "pending" ? "block" : "none";
  });

  $("btn-receive-confirm").addEventListener("click", async () => {
    const supervisorId = Number($("r-supervisor-select").value) || null;
    const supervisorName =
      $("r-supervisor-select").selectedOptions[0]?.textContent.trim() || "";
    const qualityControllerUserId = Number($("r-qc-select").value) || null;
    const qualityControllerName =
      $("r-qc-select").selectedOptions[0]?.textContent.trim() || "";
    const productionLine = $("r-line").value.trim();
    const startDate = $("r-start-date").value;
    const operationalStatus = $("r-status").value;
    const pendingReason = $("r-reason").value.trim();
    if (
      !supervisorId ||
      !qualityControllerUserId ||
      !productionLine ||
      !startDate
    ) {
      toast(
        "يرجى ملء كل الحقول المطلوبة (اختيار المشرف ومراقب الجودة من القائمة)",
      );
      return;
    }
    if (operationalStatus === "pending" && !pendingReason) {
      toast("سبب التعليق مطلوب");
      return;
    }
    try {
      const result = await api(
        `/production-workflow/${receivingOrderId}/receive`,
        {
          method: "PATCH",
          body: JSON.stringify({
            supervisorId,
            supervisorName,
            qualityControllerUserId,
            qualityControllerName,
            productionLine,
            startDate,
            operationalStatus,
            pendingReason: pendingReason || null,
          }),
        },
      );
      toast(result.message || "تم الاستلام");
      $("receive-modal").classList.remove("open");
      loadAll();
    } catch (e) {
      toast("تعذر الاستلام: " + e.message);
    }
  });

  window.__dispatch = async function (id) {
    try {
      const result = await api(`/production-workflow/${id}/dispatch`, {
        method: "PATCH",
        body: "{}",
      });
      toast(result.message || "تم الإرسال");
      loadAll();
    } catch (e) {
      toast("تعذر الإرسال: " + e.message);
    }
  };

  let inventoryLoaded = false;
  async function ensureInventoryOptions() {
    if (inventoryLoaded) return;
    try {
      const items = await api("/inventory");
      const select = $("d-inventory-item");
      items.forEach((i) => {
        const opt = document.createElement("option");
        opt.value = i.id;
        opt.textContent = i.name;
        select.appendChild(opt);
      });
      inventoryLoaded = true;
    } catch {
      /* تجاهل — الحقل اختياري */
    }
  }

  window.__openDeliver = async function (id) {
    deliveringOrderId = id;
    $("d-type").value = "customer";
    $("d-inv-row").style.display = "none";
    $("d-notes").value = "";
    await ensureInventoryOptions();
    $("deliver-modal").classList.add("open");
  };
  $("d-type").addEventListener("change", () => {
    $("d-inv-row").style.display =
      $("d-type").value === "warehouse" ? "block" : "none";
  });

  $("btn-deliver-confirm").addEventListener("click", async () => {
    const deliveryType = $("d-type").value;
    const inventoryItemId = Number($("d-inventory-item").value) || null;
    const deliveryNotes = $("d-notes").value.trim() || null;
    try {
      const result = await api(
        `/production-workflow/${deliveringOrderId}/deliver`,
        {
          method: "PATCH",
          body: JSON.stringify({
            deliveryType,
            deliveryNotes,
            addToInventory: deliveryType === "warehouse" && !!inventoryItemId,
            inventoryItemId,
          }),
        },
      );
      toast(result.message || "تم التسليم");
      $("deliver-modal").classList.remove("open");
      loadAll();
    } catch (e) {
      toast("تعذر التسليم: " + e.message);
    }
  });

  /* ── ✨ سجل الأوامر المنتهية — تتبع كامل من غير أي طلب API إضافي،
     لأن كل بيانات المراحل أصلًا موجودة في نفس الأوردر (production_workflow_orders) ── */
  let historySearchQuery = "";

  function fmtDateTime(d) {
    if (!d) return "—";
    try {
      return new Date(d).toLocaleString("ar-EG", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return d;
    }
  }

  function renderHistory() {
    const list = $("pm-history-list");
    if (!list) return;
    let delivered = currentOrders.filter((o) =>
      DELIVERED_STATUSES.includes(o.workflowStatus),
    );
    delivered.sort(
      (a, b) =>
        new Date(b.deliveredAt || b.updatedAt) -
        new Date(a.deliveredAt || a.updatedAt),
    );

    if (historySearchQuery) {
      const q = historySearchQuery.toLowerCase();
      delivered = delivered.filter(
        (o) =>
          o.orderNumber.toLowerCase().includes(q) ||
          o.productName.toLowerCase().includes(q),
      );
    }

    if (!delivered.length) {
      list.innerHTML = `<p class="empty-hint">${historySearchQuery ? "لا توجد نتائج مطابقة" : "لا توجد أوامر منتهية بعد"}</p>`;
      return;
    }

    list.innerHTML = delivered
      .map((o) => {
        const isCustomer = o.workflowStatus === "delivered_customer";
        return `
      <div class="pm-history-row" onclick="window.__openHistoryDetail(${o.id})">
        <div class="pm-history-icon ${isCustomer ? "customer" : "warehouse"}">
          <i class="fa-solid ${isCustomer ? "fa-handshake" : "fa-warehouse"}"></i>
        </div>
        <div class="pm-history-main">
          <div class="num">${escHtml(o.orderNumber)} — ${escHtml(o.productName)}</div>
          <div class="sub">${o.qty} ${escHtml(o.unit || "")} · ${isCustomer ? "تم التسليم للعميل" : "تم التسليم للمخزن"}</div>
        </div>
        <div class="pm-history-date">${fmtDateTime(o.deliveredAt)}</div>
      </div>`;
      })
      .join("");
  }

  $("pm-history-search")?.addEventListener("input", (e) => {
    historySearchQuery = e.target.value.trim();
    renderHistory();
  });

  // خطوة واحدة في الخط الزمني: بترجع null لو المرحلة دي ماحصلتش أصلاً
  function tlStep(icon, title, whenValue, bodyHtml) {
    if (!whenValue && !bodyHtml) return null;
    return {
      icon,
      title,
      when: whenValue ? fmtDateTime(whenValue) : null,
      body: bodyHtml,
    };
  }

  window.__openHistoryDetail = function (id) {
    const o = currentOrders.find((x) => x.id === id);
    if (!o) return;
    $("hd-title").textContent = `تتبع الأمر: ${o.orderNumber}`;

    const steps = [
      tlStep(
        "plus",
        "إنشاء الأمر",
        o.createdAt,
        `بواسطة: ${escHtml(o.createdByName)}${o.customerName ? ` — العميل: ${escHtml(o.customerName)}` : ""}`,
      ),
      tlStep(
        "user-check",
        "استلام المشرف",
        o.receivedAt,
        `${escHtml(o.receivedByName || "—")} — خط الإنتاج: ${escHtml(o.productionLine || "—")}`,
      ),
      tlStep(
        "boxes-stacked",
        "طلب المواد الخام",
        o.materialsRequestedAt,
        o.requestedMaterials?.length ?
          `${o.requestedMaterials.length} صنف مطلوب`
        : null,
      ),
      tlStep(
        "warehouse",
        "قرار المخازن",
        o.warehouseDecidedAt,
        `${escHtml(o.warehouseManagerName || "—")} — ${
          o.warehouseDecision === "approve" ? "موافقة كاملة"
          : o.warehouseDecision === "partial" ? "موافقة جزئية"
          : o.warehouseDecision === "reject" ? "رفض"
          : "—"
        }${o.warehouseComment ? ` (${escHtml(o.warehouseComment)})` : ""}`,
      ),
      tlStep(
        "people-arrows",
        "تعيين الفريق",
        o.teamAssignedAt,
        `المشرف: ${escHtml(o.supervisorName || "—")} — مراقب الجودة: ${escHtml(o.qualityControllerName || "—")}`,
      ),
      tlStep(
        "magnifying-glass-chart",
        "فحص الجودة",
        o.qualityDoneAt,
        `${escHtml(o.qualityReportedByName || "—")} — النتيجة: ${
          o.qualityStatus === "passed" ? "✅ ناجح"
          : o.qualityStatus === "failed" ? "❌ راسب"
          : "—"
        }${o.qualityNotes ? ` — ${escHtml(o.qualityNotes)}` : ""}`,
      ),
      tlStep(
        "truck",
        "التسليم النهائي",
        o.deliveredAt,
        `${escHtml(o.deliveredByName || "—")} — ${o.deliveryType === "customer" ? "تسليم للعميل" : "تسليم للمخزن"}${o.deliveryNotes ? ` — ${escHtml(o.deliveryNotes)}` : ""}`,
      ),
    ].filter(Boolean);

    $("hd-body").innerHTML = `
      <div class="pm-timeline">
        ${steps
          .map(
            (s, i) => `
          <div class="pm-tl-step">
            <div class="pm-tl-dot-wrap">
              <div class="pm-tl-dot"></div>
              ${i < steps.length - 1 ? '<div class="pm-tl-line"></div>' : ""}
            </div>
            <div class="pm-tl-body">
              <h5><i class="fa-solid fa-${s.icon}"></i> ${s.title}</h5>
              ${s.body ? `<p>${s.body}</p>` : ""}
              ${s.when ? `<div class="when">${s.when}</div>` : ""}
            </div>
          </div>`,
          )
          .join("")}
      </div>
    `;
    $("history-detail-modal").classList.add("open");
  };

  await loadAll();
})();
