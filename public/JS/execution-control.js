(function () {
  const { request, list, escape, formatDate, submit } = window.FactoryScreen;
  const render = async () => {
    try {
      const ncrs = await request("/production-execution/ncrs");
      document.getElementById("ncr-count").textContent = ncrs.length;
      list("ncr-list", ncrs, (ncr) => `<article class="record-row"><div><strong>${escape(ncr.ncrNumber || `NCR #${ncr.id}`)}</strong><span>أمر #${escape(ncr.workflowOrderId)} · عيب ${escape(ncr.defectCode)} · كمية ${escape(ncr.affectedQty)}</span></div><span class="status-badge warning">${escape(ncr.disposition || "hold")} · ${formatDate(ncr.createdAt)}</span></article>`, "لا توجد حالات عدم مطابقة");
    } catch (error) {
      document.getElementById("ncr-list").innerHTML = `<div class="error-state">${escape(error.message)}</div>`;
    }
  };
  document.getElementById("ncr-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const ok = await submit(event.currentTarget, "/production-execution/ncrs", (v) => ({
      workflowOrderId: Number(v.workflowOrderId), batchId: v.batchId ? Number(v.batchId) : null,
      defectCode: v.defectCode, affectedQty: v.affectedQty, disposition: v.disposition, evidence: [],
    }));
    if (ok) render();
  });
  document.getElementById("trace-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const lot = new FormData(event.currentTarget).get("lotNumber");
    try {
      const rows = await request(`/production-execution/traceability/${encodeURIComponent(lot)}`);
      list("trace-list", rows, (row) => `<article class="record-row"><div><strong>${escape(row.lotNumber)}</strong><span>${escape(row.traceType)} · ${escape(row.itemCode)} · كمية ${escape(row.quantity)}</span></div><span class="status-badge">${formatDate(row.createdAt)}</span></article>`, "لا يوجد سجل لهذا الـLot");
    } catch (error) { document.getElementById("trace-list").innerHTML = `<div class="error-state">${escape(error.message)}</div>`; }
  });
  document.querySelector("[data-refresh]").addEventListener("click", render);
  window.HyperTechAuth.ready.then(render);
})();