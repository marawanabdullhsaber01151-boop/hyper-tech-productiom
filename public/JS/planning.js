(function () {
  const { request, list, escape, formatDate, submit } = window.FactoryScreen;
  const statusLabel = { draft: "مسودة", approved: "معتمدة", released: "تم التسليم" };
  const render = async () => {
    try {
      const [plans, runs] = await Promise.all([request("/planning/mrp"), request("/planning/runs?limit=20")]);
      document.getElementById("plan-count").textContent = plans.length;
      const requirements = plans.flatMap((plan) => (plan.requirements || []).map((item) => ({ ...item, planNumber: plan.planNumber })));
      list("mrp-plans", plans, (plan) => `<article class="record-row"><div><strong>${escape(plan.planNumber)}</strong><span>${escape(plan.demandSource)} · ${formatDate(plan.dueDate)} · ${(plan.requirements || []).length} احتياج</span></div><span class="status-badge">${escape(plan.status)}</span></article>`, "لم يتم تشغيل أي خطة بعد");
      list("planning-runs", runs, (run) => {
        const summary = run.summary || {};
        const action = run.status === "draft"
          ? `<button class="btn-secondary planning-action" data-action="approve" data-id="${run.id}">اعتماد</button>`
          : run.status === "approved"
            ? `<button class="btn-secondary planning-action" data-action="release" data-id="${run.id}">تسليم الخطة</button>`
            : "";
        return `<article class="record-row"><div><strong>${escape(run.scenarioCode)} · ${escape(run.runKey)}</strong><span>${formatDate(run.horizonStart)} — ${formatDate(run.horizonEnd)} · ${summary.demandCount || 0} طلب · عجز ${summary.shortageCount || 0} · اختناق ${summary.overloadedCount || 0}</span></div><div><span class="status-badge ${summary.shortageCount || summary.overloadedCount ? "warning" : "success"}">${escape(statusLabel[run.status] || run.status)}</span>${action}</div></article>`;
      }, "لا توجد سيناريوهات تخطيط");
      document.querySelectorAll(".planning-action").forEach((button) => button.addEventListener("click", async () => {
        const action = button.dataset.action;
        try {
          if (action === "release") {
            const impact = await request(`/planning/runs/${button.dataset.id}/release/preview`, { method: "POST", body: "{}" });
            const warning = impact.shortageCount || impact.overloadedCount
              ? `يوجد ${impact.shortageCount} عجز و${impact.overloadedCount} اختناق.`
              : "لا توجد استثناءات.";
            if (!window.confirm(`${warning} سيتم تغيير حالة السيناريو فقط دون تعديل الحجوزات أو أوامر الإنتاج. متابعة التسليم؟`)) return;
          }
          await request(`/planning/runs/${button.dataset.id}/${action}`, { method: "POST", body: "{}" });
          window.FactoryScreen.toast(action === "approve" ? "تم اعتماد السيناريو" : "تم تسليم السيناريو");
          render();
        } catch (error) { window.FactoryScreen.toast(error.message, true); }
      }));
      list("requisitions", requirements.filter((item) => Number(item.netQty) > 0), (item) => `<article class="record-row"><div><strong>احتياج #${escape(item.id)}</strong><span>${escape(item.planNumber)} · عجز ${escape(item.netQty)} · صنف #${escape(item.inventoryItemId)}</span></div><button class="btn-secondary create-requisition" data-id="${item.id}">إنشاء طلب شراء</button></article>`, "لا توجد عجز خامات مفتوح");
      document.querySelectorAll(".create-requisition").forEach((button) => button.addEventListener("click", async () => {
        try { await request("/planning/requisitions", { method: "POST", body: JSON.stringify({ materialRequirementId: Number(button.dataset.id) }) }); window.FactoryScreen.toast("تم إنشاء طلب الشراء"); render(); }
        catch (error) { window.FactoryScreen.toast(error.message, true); }
      }));
    } catch (error) {
      document.querySelectorAll(".record-list").forEach((node) => { node.innerHTML = `<div class="error-state">${escape(error.message)}</div>`; });
    }
  };
  document.getElementById("mrp-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const ok = await submit(event.currentTarget, "/planning/runs", (v) => ({
      scenarioCode: v.demandSource,
      horizonStart: v.horizonStart,
      horizonEnd: v.dueDate,
      assumptions: { workflowOrderId: v.workflowOrderId ? Number(v.workflowOrderId) : null },
      demands: [{
        sourceType: v.demandSource,
        sourceId: v.workflowOrderId ? Number(v.workflowOrderId) : null,
        inventoryItemId: Number(v.inventoryItemId),
        grossQty: v.grossQty,
        requiredBy: v.dueDate,
        openSupplyQty: "0",
        leadDays: 0,
        snapshot: {},
      }],
      capacityLoads: [],
    }));
    if (ok) render();
  });
  document.querySelector("[data-refresh]").addEventListener("click", render);
  window.HyperTechAuth.ready.then(render);
})();