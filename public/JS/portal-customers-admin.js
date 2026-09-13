(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
  const api = (path, options) => window.HyperTechAuth.request(path, options);
  const state = { page: 1, pageSize: 25, query: "", total: 0, cityCustomerId: null };
  const status = (text, error = false) => {
    $("status").textContent = text;
    $("status").className = `status ${error ? "error" : ""}`;
  };
  const date = (value) => value ? new Date(value).toLocaleString("ar-EG", {
    dateStyle: "medium", timeStyle: "short",
  }) : "—";

  function populateCities() {
    const select = $("customerCity");
    const governorates = Array.isArray(window.EGYPT_GOVERNORATES)
      ? window.EGYPT_GOVERNORATES
      : [];
    governorates.forEach((city) => select.appendChild(new Option(city, city)));
  }

  function healthBadge(health) {
    const item = health || { level: "new", label: "لا توجد بيانات" };
    return `<span class="health-badge health-${esc(item.level)}">${esc(item.label)}</span>`;
  }

  function segmentSelect(customer) {
    const options = (window.HYPER_CONTACT_SEGMENTS || [])
      .map((segment) => `<option value="${esc(segment.value)}" ${customer.segment === segment.value ? "selected" : ""}>${esc(segment.label)}</option>`)
      .join("");
    return `<select class="input" data-customer-segment="${esc(customer.id)}"><option value="">بدون تصنيف</option>${options}</select>`;
  }

  function renderCustomers(payload) {
    const customers = Array.isArray(payload) ? payload : payload.items || [];
    state.total = Number(payload.total || customers.length);
    $("customerRows").innerHTML = customers.map((r) => `
      <tr>
        <td>${esc(r.fullName)}</td>
        <td>${esc(r.companyName)}</td>
        <td dir="ltr">${esc(r.phone)}</td>
        <td>${esc(r.email)}</td>
        <td>${esc(r.city) || "—"} <button class="button" data-city="${esc(r.id)}" data-city-value="${esc(r.city)}" data-city-name="${esc(r.fullName)}">تعديل</button></td>
        <td>${r.contactId ? segmentSelect(r) : "—"}</td>
        <td><span class="badge ${r.isActive ? "badge-approved" : "badge-rejected"}">${r.isActive ? "نشط" : "متوقف"}</span></td>
        <td>${healthBadge(r.health)}</td>
        <td>${esc(r.minimumOrderQuantity)}</td>
        <td>${date(r.createdAt)}</td>
        <td><div class="action-stack">
          <button class="button" data-edit-minimum="${esc(r.id)}" data-current-minimum="${esc(r.minimumOrderQuantity)}">تعديل الحد الأدنى</button>
          <button class="button" data-reset="${esc(r.id)}">تعيين كلمة مرور</button>
          <button class="button ${r.isActive ? "danger" : "success"}" data-status="${esc(r.id)}" data-active="${r.isActive ? "true" : "false"}">${r.isActive ? "إيقاف الحساب" : "تفعيل الحساب"}</button>
          <button class="button danger" data-delete-customer="${esc(r.id)}" data-customer-name="${esc(r.fullName)}">حذف نهائي</button>
        </div></td>
      </tr>`).join("") || '<tr><td colspan="11" class="muted">لا توجد حسابات مطابقة.</td></tr>';

    const pages = Math.max(1, Math.ceil(state.total / state.pageSize));
    $("pageInfo").textContent = `صفحة ${state.page} من ${pages} — ${state.total} عميل`;
    $("previousPage").disabled = state.page <= 1;
    $("nextPage").disabled = state.page >= pages;
  }

  async function load() {
    try {
      const params = new URLSearchParams({
        q: state.query,
        page: String(state.page),
        pageSize: String(state.pageSize),
      });
      const [customers, resets] = await Promise.all([
        api(`/portal-customers?${params}`),
        api("/portal-customers/password-reset-requests"),
      ]);
      renderCustomers(customers);
      $("resetRows").innerHTML = (Array.isArray(resets) ? resets : []).map((r) =>
        `<tr><td>${esc(r.customerName)}</td><td>${esc(r.customerPhone)}</td><td>${date(r.createdAt)}</td><td><button class="button" data-reset="${esc(r.portalCustomerId)}">تعيين كلمة مرور</button></td></tr>`,
      ).join("") || '<tr><td colspan="4" class="muted">لا توجد طلبات معلقة.</td></tr>';
      status("تم تحديث بيانات العملاء.");
    } catch (e) {
      status(e.message, true);
    }
  }

  async function updateMinimum(id, current) {
    const value = window.prompt("اكتب الحد الأدنى الجديد للطلب (رقم صحيح أكبر من أو يساوي 1):", current);
    if (value === null) return;
    const minimumOrderQuantity = Number(value.trim());
    if (!Number.isInteger(minimumOrderQuantity) || minimumOrderQuantity < 1) {
      status("الحد الأدنى يجب أن يكون رقمًا صحيحًا يبدأ من 1.", true);
      return;
    }
    try {
      await api(`/portal-customers/${id}/minimum-order`, {
        method: "PATCH", body: JSON.stringify({ minimumOrderQuantity }),
      });
      status("تم تحديث الحد الأدنى للطلب وتسجيل التعديل.");
      await load();
    } catch (e) { status(e.message, true); }
  }

  async function reset(id) {
    const password = window.prompt("اترك الحقل فارغًا ليولد النظام كلمة مؤقتة، أو اكتب كلمة جديدة:");
    if (password === null) return;
    try {
      const result = await api(`/portal-customers/${id}/reset-password`, {
        method: "PATCH", body: JSON.stringify(password ? { newPassword: password } : {}),
      });
      window.alert(`كلمة المرور الجديدة: ${result.newPassword}`);
      status("تم تغيير كلمة المرور وتسجيل الإجراء. سلّمها للعميل عبر قناة آمنة فقط.");
      await load();
    } catch (e) { status(e.message, true); }
  }

  async function toggleStatus(id, isActive) {
    const action = isActive ? "إيقاف" : "تفعيل";
    if (!window.confirm(`هل أنت متأكد من ${action} حساب العميل؟`)) return;
    try {
      await api(`/portal-customers/${id}/status`, {
        method: "PATCH", body: JSON.stringify({ isActive: !isActive }),
      });
      status(`تم ${action} حساب العميل${isActive ? " وإلغاء جلساته الحالية" : ""}.`);
      await load();
    } catch (e) { status(e.message, true); }
  }

  async function deleteCustomer(id, name) {
    if (!window.confirm(`حذف نهائي لحساب "${name}"؟ لا يمكن التراجع عن هذا الإجراء.`)) return;
    try {
      await api(`/portal-customers/${id}`, { method: "DELETE" });
      status("تم حذف حساب العميل نهائيًا.");
      await load();
    } catch (e) { status(e.message, true); }
  }

  async function updateSegment(id, segment) {
    try {
      await api(`/portal-customers/${id}/segment`, {
        method: "PATCH",
        body: JSON.stringify({ segment: segment || null }),
      });
      status("تم تحديث تصنيف العميل وتسجيل التعديل.");
    } catch (e) {
      status(e.message, true);
      await load();
    }
  }

  function openCity(id, city, name) {
    state.cityCustomerId = id;
    $("cityCustomerName").textContent = name;
    $("customerCity").value = city || "";
    $("cityDialog").showModal();
  }

  $("cityForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api(`/portal-customers/${state.cityCustomerId}/city`, {
        method: "PATCH", body: JSON.stringify({ city: $("customerCity").value || null }),
      });
      $("cityDialog").close();
      status("تم تحديث محافظة العميل وتسجيل التعديل.");
      await load();
    } catch (e) { status(e.message, true); }
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    const minimumButton = target.closest("[data-edit-minimum]");
    if (minimumButton) return void updateMinimum(minimumButton.dataset.editMinimum, minimumButton.dataset.currentMinimum);
    const resetButton = target.closest("[data-reset]");
    if (resetButton) return void reset(resetButton.dataset.reset);
    const statusButton = target.closest("[data-status]");
    if (statusButton) return void toggleStatus(statusButton.dataset.status, statusButton.dataset.active === "true");
    const deleteButton = target.closest("[data-delete-customer]");
    if (deleteButton) return void deleteCustomer(deleteButton.dataset.deleteCustomer, deleteButton.dataset.customerName);
    const cityButton = target.closest("[data-city]");
    if (cityButton) return void openCity(cityButton.dataset.city, cityButton.dataset.cityValue, cityButton.dataset.cityName);
    if (target.closest("[data-close-city]")) $("cityDialog").close();
  });

  document.addEventListener("change", (event) => {
    const segment = event.target.closest("[data-customer-segment]");
    if (segment) updateSegment(segment.dataset.customerSegment, segment.value);
  });

  $("customerSearch").addEventListener("input", (event) => {
    state.query = event.target.value.trim();
    state.page = 1;
    clearTimeout(window.__customerSearchTimer);
    window.__customerSearchTimer = setTimeout(load, 250);
  });
  $("previousPage").addEventListener("click", () => { state.page -= 1; load(); });
  $("nextPage").addEventListener("click", () => { state.page += 1; load(); });
  $("exportCustomers").addEventListener("click", async () => {
    try {
      const session = window.HyperTechAuth.session();
      const response = await fetch(`/api/v1/portal-customers/export.csv?q=${encodeURIComponent(state.query)}`, {
        headers: { Authorization: `Bearer ${session?.token || ""}` },
      });
      if (!response.ok) throw new Error("تعذر تصدير قائمة العملاء");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "portal-customers.csv";
      link.click();
      URL.revokeObjectURL(url);
      status("تم تجهيز ملف CSV.");
    } catch (error) {
      status(error.message, true);
    }
  });
  $("refresh").onclick = load;
  populateCities();
  load();
})();