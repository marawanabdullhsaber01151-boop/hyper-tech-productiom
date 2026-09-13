(function () {
  const { request, list, escape, formatDate, submit } = window.FactoryScreen;
  const render = async () => {
    try {
      const plans = await request("/planning/mrp");
      document.getElementById("plan-count").textContent = plans.length;
      const requirements = plans.flatMap((plan) => (plan.requirements || []).map((item) => ({ ...item, planNumber: plan.planNumber })));
      list("mrp-plans", plans, (plan) => `<article class="record-row"><div><strong>${escape(plan.planNumber)}</strong><span>${escape(plan.demandSource)} · ${formatDate(plan.dueDate)} · ${(plan.requirements || []).length} احتياج</span></div><span class="status-badge">${escape(plan.status)}</span></article>`, "لم يتم تشغيل أي خطة بعد");
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
    const ok = await submit(event.currentTarget, "/planning/mrp", (v) => ({
      dueDate: v.dueDate || null, demandSource: v.demandSource,
      workflowOrderId: v.workflowOrderId ? Number(v.workflowOrderId) : null,
      requirements: [{ inventoryItemId: Number(v.inventoryItemId), grossQty: v.grossQty, requiredBy: v.dueDate || null }],
    }));
    if (ok) render();
  });
  document.querySelector("[data-refresh]").addEventListener("click", render);
  window.HyperTechAuth.ready.then(render);
})();