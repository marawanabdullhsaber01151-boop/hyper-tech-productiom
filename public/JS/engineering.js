(function () {
  const { request, list, escape, formatDate, submit } = window.FactoryScreen;
  const render = async () => {
    try {
      const [products, changes] = await Promise.all([
        request("/engineering/products"),
        request("/engineering/change-requests"),
      ]);
      document.getElementById("product-count").textContent = products.length;
      list("engineering-products", products, (product) => `
        <article class="record-row"><div><strong>${escape(product.name)}</strong><span>${escape(product.code)} · ${escape(product.productType)} · ${escape(product.baseUnit)}</span></div><span class="status-badge ${product.status === "active" ? "success" : ""}">${escape(product.status)}</span></article>`);
      list("change-requests", changes, (change) => `
        <article class="record-row"><div><strong>${escape(change.title)}</strong><span>منتج #${escape(change.productId)} · ${escape(change.reason)}</span></div><span class="status-badge">${escape(change.status)} · ${formatDate(change.createdAt)}</span></article>`);
    } catch (error) {
      document.querySelectorAll(".record-list").forEach((node) => { node.innerHTML = `<div class="error-state">${escape(error.message)}</div>`; });
    }
  };
  document.getElementById("product-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (await submit(event.currentTarget, "/engineering/products", (v) => ({ ...v, description: v.description || null }))) render();
  });
  document.getElementById("version-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const ok = await submit(event.currentTarget, `/engineering/products/${new FormData(event.currentTarget).get("productId")}/versions`, (v) => ({
      version: v.version, effectiveFrom: v.effectiveFrom || null, changeReason: v.changeReason || null,
      bomSnapshot: [], routingSnapshot: [], specifications: {},
    }));
    if (ok) render();
  });
  document.getElementById("change-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const ok = await submit(event.currentTarget, "/engineering/change-requests", (v) => ({
      productId: Number(v.productId), productVersionId: v.productVersionId ? Number(v.productVersionId) : null,
      title: v.title, reason: v.reason, impactSummary: v.impactSummary || null,
    }));
    if (ok) render();
  });
  document.querySelector("[data-refresh]").addEventListener("click", render);
  window.HyperTechAuth.ready.then(render);
})();