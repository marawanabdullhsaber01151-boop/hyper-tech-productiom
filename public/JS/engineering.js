(function () {
  const { request, list, escape, formatDate, submit, toast } = window.FactoryScreen;
  // Phase 04 (delivery 1): governed lifecycle status labels for engineering
  // product versions.
  const VERSION_STATUS_LABELS = {
    draft: "مسودة", in_review: "قيد المراجعة", approved: "معتمد",
    released: "مُصدر (نشط)", superseded: "مستبدل", retired: "متقاعد",
  };
  const render = async () => {
    try {
      const [products, changes] = await Promise.all([
        request("/engineering/products"),
        request("/engineering/change-requests"),
      ]);
      document.getElementById("product-count").textContent = products.length;
      list("engineering-products", products, (product) => `
        <article class="record-row"><div><strong>${escape(product.name)}</strong><span>${escape(product.code)} · ${escape(product.productType)} · ${escape(product.baseUnit)}</span></div><span class="status-badge ${product.status === "active" ? "success" : ""}">${escape(product.status)}</span></article>
        <div class="record-row" style="padding-inline-start:1rem"><button class="btn-ghost" data-show-versions="${escape(product.id)}" type="button">عرض الإصدارات الهندسية</button></div>
        <div id="versions-${escape(product.id)}" class="record-list" hidden></div>`);
      list("change-requests", changes, (change) => `
        <article class="record-row"><div><strong>${escape(change.title)}</strong><span>منتج #${escape(change.productId)} · ${escape(change.reason)}</span></div><span class="status-badge">${escape(change.status)} · ${formatDate(change.createdAt)}</span></article>`);
    } catch (error) {
      document.querySelectorAll(".record-list").forEach((node) => { node.innerHTML = `<div class="error-state">${escape(error.message)}</div>`; });
    }
  };
  // Phase 04 (delivery 1): the engineering module was previously read-mostly
  // in this screen — no way to see a product's versions, validate a BOM,
  // or move a version through draft -> in_review -> approved -> released.
  async function showVersions(productId) {
    const container = document.getElementById(`versions-${productId}`);
    if (!container) return;
    if (!container.hidden) { container.hidden = true; return; }
    container.hidden = false;
    container.innerHTML = `<div class="loading-state">جاري التحميل...</div>`;
    try {
      const product = await request(`/engineering/products/${productId}`);
      const versions = product.versions || [];
      container.innerHTML = versions.length ? versions.map((v) => `
        <article class="record-row" data-version-id="${escape(v.id)}">
          <div><strong>${escape(v.version)}</strong><span>${escape(VERSION_STATUS_LABELS[v.status] || v.status)}${v.validationStatus ? ` · فحص القابلية: ${escape(v.validationStatus)}` : ""}</span></div>
          <div>
            <button class="btn-ghost" data-validate="${escape(v.id)}" type="button">فحص القابلية للتصنيع</button>
            ${v.status === "draft" ? `<button class="btn-ghost" data-submit-review="${escape(v.id)}" type="button">إرسال للمراجعة</button>` : ""}
            ${v.status === "in_review" ? `<button class="btn-primary" data-approve="${escape(v.id)}" type="button">اعتماد</button>` : ""}
            ${v.status === "approved" ? `<button class="btn-primary" data-release="${escape(v.id)}" type="button">إصدار (تجميد نهائي)</button>` : ""}
          </div>
        </article>`).join("") : `<div class="empty-state">لا توجد إصدارات لهذا المنتج بعد</div>`;
    } catch (error) {
      container.innerHTML = `<div class="error-state">${escape(error.message)}</div>`;
    }
  }
  async function validateVersion(id) {
    try {
      const result = await request(`/engineering/product-versions/${id}/validate`, { method: "POST" });
      const lines = (result.issues || []).map((i) => `- [${i.severity === "error" ? "خطأ" : "تنبيه"}] ${i.message}`);
      alert(result.passed
        ? `اجتاز الفحص ✅ (تحذيرات: ${result.warningCount})`
        : `لم يجتز الفحص ❌ — ${result.errorCount} خطأ:\n\n${lines.join("\n")}`);
      toast(result.passed ? "الفحص ناجح" : "الفحص أظهر أخطاء يجب تصحيحها");
    } catch (error) { toast(error.message, true); }
  }
  async function submitReview(id) {
    try {
      await request(`/engineering/product-versions/${id}/submit-review`, { method: "POST" });
      toast("تم إرسال الإصدار للمراجعة");
      document.querySelectorAll("[data-show-versions]").forEach((b) => showVersions(b.dataset.showVersions));
    } catch (error) { toast(error.message, true); }
  }
  async function approveVersion(id) {
    if (!confirm("اعتماد هذا الإصدار؟")) return;
    try {
      await request(`/engineering/bom-versions/${id}/approve`, { method: "POST" });
      toast("تم اعتماد الإصدار");
      document.querySelectorAll("[data-show-versions]").forEach((b) => showVersions(b.dataset.showVersions));
    } catch (error) { toast(error.message, true); }
  }
  async function releaseVersion(id) {
    if (!confirm("إصدار هذا الإصدار نهائيًا؟ سيتم تجميد قائمة المواد ومسار التشغيل ولن يمكن تعديلهما بعد ذلك.")) return;
    try {
      await request(`/engineering/product-versions/${id}/release`, { method: "POST" });
      toast("تم إصدار الإصدار — أصبح مجمّدًا نهائيًا");
      document.querySelectorAll("[data-show-versions]").forEach((b) => showVersions(b.dataset.showVersions));
    } catch (error) { toast(error.message, true); }
  }
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
  document.getElementById("engineering-products").addEventListener("click", (event) => {
    const showBtn = event.target.closest("[data-show-versions]"); if (showBtn) { showVersions(showBtn.dataset.showVersions); return; }
    const validateBtn = event.target.closest("[data-validate]"); if (validateBtn) { validateVersion(validateBtn.dataset.validate); return; }
    const submitReviewBtn = event.target.closest("[data-submit-review]"); if (submitReviewBtn) { submitReview(submitReviewBtn.dataset.submitReview); return; }
    const approveBtn = event.target.closest("[data-approve]"); if (approveBtn) { approveVersion(approveBtn.dataset.approve); return; }
    const releaseBtn = event.target.closest("[data-release]"); if (releaseBtn) { releaseVersion(releaseBtn.dataset.release); return; }
  });
  document.querySelector("[data-refresh]").addEventListener("click", render);
  window.HyperTechAuth.ready.then(render);
})();