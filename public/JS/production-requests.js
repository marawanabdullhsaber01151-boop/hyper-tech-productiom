(async () => {
  const $ = (id) => document.getElementById(id), esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  const api = (path, options) => window.HyperTechAuth.request(path, options);
  const status = (text, error = false) => { $("status").textContent = text; $("status").className = `status ${error ? "error" : ""}`; };
  const role = () => window.HyperTechAuth.user?.role || "";
  const STATUS_LABELS = {
    pending_warehouse: "بانتظار قرار المخزن",
    pending_director: "بانتظار قرار الإدارة",
    approved: "معتمد — بدأت دورة الإنتاج",
    partial_approved: "معتمد جزئيًا — بدأت دورة الإنتاج",
    rejected: "مرفوض",
    cancelled: "ملغي",
  };
  const PRIORITY_LABELS = { urgent: "عاجل جدًا", high: "مرتفع", normal: "عادي", low: "منخفض" };
  const UNIT_LABELS = { kg: "كيلوجرام", g: "جرام", ton: "طن", l: "لتر", ml: "مليلتر", piece: "قطعة", m: "متر", cm: "سنتيمتر", box: "كرتونة", pack: "علبة أو باكيت", roll: "لفة", set: "طقم" };
  let recipes = [];

  async function loadRecipes() {
    const select = $("recipeSelect");
    if (!select) return;
    // ✅ إصلاح: كان بيكلم /production-requests/recipes وده endpoint مش موجود
    // خالص في الباك إند (404) — نفس الوصفات بتتقرأ من /bom زي factory-intake.js.
    try {
      recipes = await api("/bom");
      select.innerHTML = '<option value="">اختر وصفة التصنيع...</option>' +
        recipes.map((r) => `<option value="${esc(r.id)}">${esc(r.productName)}${r.productCode ? ` — ${esc(r.productCode)}` : ""}</option>`).join("");
    } catch (e) {
      // ✅ إصلاح: فشل تحميل الوصفات (شبكة/صلاحية) كان بيوقف تحميل باقي
      // الصفحة كلها لأن الاستدعاء ده ما كانش جوه try/catch — دلوقتي بيفشل
      // بأمان ويسيب الجدول الأساسي يتحمّل عادي.
      select.innerHTML = '<option value="">تعذر تحميل الوصفات</option>';
    }
  }

  async function load() {
    try {
      const response = await api("/production-requests");
      const rows = Array.isArray(response) ? response : (response?.data || []);
      $("rows").innerHTML = rows.map((r) => `<tr>
        <td>${esc(r.requestNumber)}</td>
        <td>${esc(r.productName)}</td>
        <td>${esc(r.requestedQty)} ${esc(UNIT_LABELS[r.unit] || r.unit)}</td>
        <td>${esc(PRIORITY_LABELS[r.priority] || r.priority)}</td>
        <td><span class="status-badge">${esc(STATUS_LABELS[r.status] || r.status)}</span>${r.workflowOrderNumber ? `<small class="muted"> أمر الدورة: ${esc(r.workflowOrderNumber)}</small>` : ""}</td>
        <td>${esc(new Date(r.createdAt).toLocaleDateString("ar-EG"))}</td>
        <td>${actions(r)}</td>
      </tr>`).join("") || '<tr><td colspan="7">لا توجد طلبات.</td></tr>';
      populateDirectorSelect(rows);
      status("تم تحديث الطلبات.");
    } catch (e) { status(e.message, true); }
  }
  function populateDirectorSelect(rows) {
    const select = document.querySelector('#directorForm select[name="id"]');
    if (!select) return;
    const eligible = rows.filter((r) => r.status === "pending_director");
    select.innerHTML = '<option value="">اختر الطلب...</option>' +
      eligible.map((r) => `<option value="${esc(r.id)}">${esc(r.requestNumber)} — ${esc(r.productName)} (${esc(r.requestedQty)} ${esc(r.unit)})</option>`).join("");
  }
  function actions(r) {
    const out = [];
    if (r.status === "pending_warehouse" && ["chairman", "warehouse_manager", "storekeeper"].includes(role())) {
      out.push(`<button class="button" data-action="warehouse" data-decision="approve" data-id="${esc(r.id)}">اعتماد المخزن</button>`);
      out.push(`<button class="button" data-action="warehouse" data-decision="partial" data-id="${esc(r.id)}">اعتماد جزئي</button>`);
      out.push(`<button class="button danger" data-action="warehouse" data-decision="reject" data-id="${esc(r.id)}">رفض المخزن</button>`);
    }
    if (["pending_director", "pending_warehouse"].includes(r.status) &&
        ["chairman", "production_manager", "supervisor"].includes(role())) {
      out.push(`<button class="button danger" data-action="cancel" data-id="${esc(r.id)}">إلغاء</button>`);
    }
    return out.join(" ") || "—";
  }
  $("recipeSelect")?.addEventListener("change", (event) => {
    const recipe = recipes.find((item) => String(item.id) === event.target.value);
    $("productName").value = recipe?.productName || "";
  });
  $("requestForm").onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    if (!body.neededBy) delete body.neededBy;
    body.bomRecipeId = Number(body.bomRecipeId);
    try { await api("/production-requests", { method:"POST", body:JSON.stringify(body) }); form.reset(); $("productName").value = ""; status("تم إرسال الطلب."); await load(); } catch (e) { status(e.message, true); }
  };
  $("rows").onclick = async (event) => {
    const b = event.target.closest("[data-action]"); if (!b) return;
    if (b.dataset.action === "warehouse") {
      const decision = b.dataset.decision;
      let body = { action: decision };
      if (decision === "partial") {
        const qty = window.prompt("الكمية المعتمدة جزئيًا؟");
        if (qty === null) return;
        body.approvedQty = qty;
      }
      if (decision === "reject") {
        const comment = window.prompt("سبب الرفض (مطلوب):");
        if (comment === null) return;
        body.comment = comment;
      }
       const confirmLabel = decision === "approve" ? "اعتماد المخزن" : decision === "partial" ? "الموافقة الجزئية" : "رفض المخزن";
      if (!window.confirm(`سيتم تنفيذ "${confirmLabel}". هل تريد المتابعة؟`)) return;
      try { await api(`/production-requests/${b.dataset.id}/warehouse-action`, { method:"PATCH", body:JSON.stringify(body) }); status("تم تنفيذ الإجراء."); await load(); } catch (e) { status(e.message, true); }
      return;
    }
    let path = `/production-requests/${b.dataset.id}/cancel`;
    try { await api(path, { method:"PATCH", body:JSON.stringify({}) }); status("تم تنفيذ الإجراء."); await load(); } catch (e) { status(e.message, true); }
  };
  $("directorForm").onsubmit = async (event) => { event.preventDefault(); const form = event.currentTarget; const body = Object.fromEntries(new FormData(form)); const id = body.id; delete body.id; if (!body.overrideQty) delete body.overrideQty; try { await api(`/production-requests/${id}/director-action`, { method:"PATCH", body:JSON.stringify(body) }); form.reset(); status("تم تسجيل القرار وبدء دورة الإنتاج عند الاعتماد."); await load(); } catch (e) { status(e.message, true); } };
  $("refresh").onclick = load;
  await window.HyperTechAuth.ready;
  // ✅ إصلاح: كانت الفورم بتتعرض لـ chairman و production_manager كمان
  // رغم إن الباك إند (`requireRole("supervisor")`) مايقبلش غير supervisor
  // بس — كانوا هياخدوا 403 بعد ما يملّوا الفورم كامل. اتظبطت تطابق الباك إند.
  if (role() !== "supervisor") $("requestForm").closest(".panel").style.display = "none";
  if (!["chairman", "production_manager"].includes(role())) $("directorForm").closest(".panel").style.display = "none";
  await loadRecipes();
  await load();
})();
