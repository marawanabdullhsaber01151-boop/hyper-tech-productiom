/** @format */
/* نبض المصنع: طبقة عرض تشغيلية فوق بيانات دورة الإنتاج الحالية. */
(function initFactoryControlTower() {
  const byId = (id) => document.getElementById(id);
  const setText = (id, value) => {
    const element = byId(id);
    if (element) element.textContent = value;
  };

  function setMeter(id, value) {
    const element = byId(id);
    if (element) element.style.width = `${Math.max(0, Math.min(100, Number(value) || 0))}%`;
  }

  function unwrap(response) {
    return response?.data || response || {};
  }

  async function refreshTower() {
    const refreshButton = byId("tower-refresh");
    refreshButton?.classList.add("is-loading");
    try {
      const [dashboardResponse, cycleResponse] = await Promise.all([
        window.HyperTechAuth.request("/dashboard"),
        window.HyperTechAuth.request("/production-cycle/dashboard"),
      ]);
      const dashboard = unwrap(dashboardResponse);
      const cycle = unwrap(cycleResponse);
      const production = dashboard.production || {};
      const quality = dashboard.quality || {};
      const inventory = dashboard.inventory || {};
      const activeOrders = Number(cycle.totals?.activeOrders || production.inProgressCount || 0);
      const blockedOrders = Number(cycle.totals?.blockedOrders || 0);
      const runningOrders = Number(production.inProgressCount || 0);
      const passRate = Number(quality.passRate ?? quality.fpy ?? 0);
      const totalItems = Number(inventory.totalItems || 0);
      const lowStock = Number(inventory.lowStockCount || 0);
      const materialReadiness = totalItems ? Math.round(((totalItems - lowStock) / totalItems) * 100) : 0;
      const oee = Math.max(0, Math.min(100, Math.round(100 - blockedOrders * 4 - lowStock * 2)));

      setText("tower-oee", `${oee}%`);
      setMeter("tower-oee-bar", oee);
      setText("tower-oee-note", `${activeOrders} أمر نشط · مستوى الضغط التشغيلي`);
      setText("tower-materials", `${materialReadiness}%`);
      setMeter("tower-materials-bar", materialReadiness);
      setText("tower-materials-note", `${Math.max(0, totalItems - lowStock)} صنف جاهز من ${totalItems || "—"}`);
      setText("tower-fpy", passRate ? `${passRate}%` : "—");
      setText("tower-alerts", blockedOrders + lowStock);
      setText("tower-material-count", lowStock);
      setText("tower-quality-count", blockedOrders);
      setText("tower-running-count", runningOrders);

      const alerts = [];
      if (lowStock) alerts.push(`<span class="tower-alert warning"><i class="fa-solid fa-box"></i> ${lowStock} صنف قريب من حد الطلب</span>`);
      if (blockedOrders) alerts.push(`<span class="tower-alert critical"><i class="fa-solid fa-triangle-exclamation"></i> ${blockedOrders} أمر يحتاج تدخلاً</span>`);
      byId("tower-alert-list").innerHTML = alerts.join("") || `<span class="tower-alert success"><i class="fa-solid fa-check"></i> لا توجد قرارات حرجة</span>`;
    } catch (error) {
      byId("tower-alert-list").innerHTML = `<span class="tower-alert critical"><i class="fa-solid fa-circle-exclamation"></i> تعذر تحديث النبض التشغيلي</span>`;
    } finally {
      refreshButton?.classList.remove("is-loading");
    }
  }

  document.querySelectorAll("[data-tower-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelector(`.filter-tab[data-filter="${button.dataset.towerFilter}"]`)?.click();
      document.getElementById("orders-grid")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  byId("tower-refresh")?.addEventListener("click", refreshTower);
  refreshTower();
  setInterval(refreshTower, 60000);
})();