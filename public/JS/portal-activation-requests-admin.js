(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));
  const api = (path, options) => window.HyperTechAuth.request(path, options);
  const status = (text, error = false) => {
    $("status").textContent = text;
    $("status").className = `status ${error ? "error" : ""}`;
  };
  const date = (value) => value ? new Date(value).toLocaleString("ar-EG", {
    dateStyle: "medium", timeStyle: "short",
  }) : "—";
  let manualRequestId = null;
  let rejectRequestId = null;

  function contactCard(contact) {
    return `<strong>${esc(contact.name)}</strong>
      <span>${esc(contact.company || "بدون شركة")} · ${esc(contact.phone || "بدون تليفون")}</span>
      ${contact.email ? `<span>${esc(contact.email)}</span>` : ""}`;
  }

  function render(requests) {
    const rows = Array.isArray(requests) ? requests : [];
    $("resultCount").textContent = `${rows.length} طلب`;
    $("requestRows").innerHTML = rows.map((item) => {
      const suggested = item.matchedContact?.id ? `
        <div class="contact-card">${contactCard(item.matchedContact)}
          <small>ترشيح تلقائي — يحتاج تأكيد الموظف</small>
        </div>` : '<span class="no-match">لا يوجد ترشيح تلقائي</span>';
      const searchButton = `<button class="button" data-manual-search="${esc(item.id)}"
        data-query="${esc(item.companyNameEntered)}">بحث يدوي</button>`;
      const confirmButton = item.matchedContact?.id
        ? `<button class="button success" data-confirm="${esc(item.id)}" data-contact-id="${esc(item.matchedContact.id)}">تأكيد هذا العميل</button>`
        : "";
      return `<tr>
        <td><strong>${esc(item.companyNameEntered)}</strong><span class="subline" dir="ltr">${esc(item.phoneEntered)}</span></td>
        <td>${suggested}</td>
        <td>${date(item.createdAt)}</td>
        <td><div class="action-stack">${confirmButton}${searchButton}
          <button class="button danger" data-reject="${esc(item.id)}">رفض</button>
        </div></td>
      </tr>`;
    }).join("") || '<tr><td colspan="4" class="muted empty-cell">لا توجد طلبات تفعيل معلقة.</td></tr>';
  }

  async function load() {
    try {
      const requests = await api("/portal-activation-requests");
      render(requests);
      status("تم تحديث طلبات التفعيل.");
    } catch (error) {
      status(error.message, true);
    }
  }

  async function confirmRequest(requestId, contactId, contactName) {
    if (!window.confirm(`سيتم إنشاء حساب بوابة وربطه بالعميل «${contactName || "المحدد"}». متابعة؟`)) return;
    try {
      await api(`/portal-activation-requests/${requestId}/confirm`, {
        method: "PATCH", body: JSON.stringify({ contactId: Number(contactId) }),
      });
      $("contactDialog").close();
      status("تم تأكيد الطلب وإنشاء الحساب وتجهيز وسيلة التفعيل.");
      await load();
    } catch (error) {
      status(error.message, true);
    }
  }

  async function searchContacts(event) {
    event.preventDefault();
    const query = $("contactQuery").value.trim();
    if (query.length < 2) return;
    $("contactResults").innerHTML = '<p class="muted">جاري البحث...</p>';
    try {
      const contacts = await api(`/contacts/search?q=${encodeURIComponent(query)}`);
      $("contactResults").innerHTML = (Array.isArray(contacts) ? contacts : []).map((contact) =>
        `<button type="button" class="contact-result" data-select-contact="${esc(contact.id)}" data-contact-name="${esc(contact.name)}">
          ${contactCard(contact)}
        </button>`).join("") || '<p class="muted">لا توجد نتائج مطابقة.</p>';
    } catch (error) {
      $("contactResults").innerHTML = `<p class="status error">${esc(error.message)}</p>`;
    }
  }

  $("contactSearchForm").addEventListener("submit", searchContacts);
  $("noteForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const reason = $("noteInput").value.trim();
    if (reason.length < 2 || !rejectRequestId) return;
    $("noteDialog").close();
    try {
      await api(`/portal-activation-requests/${rejectRequestId}/reject`, {
        method: "PATCH", body: JSON.stringify({ reason }),
      });
      status("تم رفض الطلب وحفظ السبب في الأرشيف.");
      await load();
    } catch (error) {
      status(error.message, true);
    } finally {
      rejectRequestId = null;
    }
  });

  document.addEventListener("click", (event) => {
    const confirmButton = event.target.closest("[data-confirm]");
    if (confirmButton) return void confirmRequest(
      confirmButton.dataset.confirm, confirmButton.dataset.contactId, "الترشيح المقترح",
    );
    const searchButton = event.target.closest("[data-manual-search]");
    if (searchButton) {
      manualRequestId = searchButton.dataset.manualSearch;
      $("contactQuery").value = searchButton.dataset.query || "";
      $("contactResults").innerHTML = '<p class="muted">عدّل البحث أو اضغط بحث لعرض العملاء.</p>';
      $("contactDialog").showModal();
      $("contactQuery").focus();
      return;
    }
    const selected = event.target.closest("[data-select-contact]");
    if (selected) return void confirmRequest(
      manualRequestId, selected.dataset.selectContact, selected.dataset.contactName,
    );
    const rejectButton = event.target.closest("[data-reject]");
    if (rejectButton) {
      rejectRequestId = rejectButton.dataset.reject;
      $("noteInput").value = "";
      $("noteDialog").showModal();
      $("noteInput").focus();
      return;
    }
    if (event.target.closest("[data-close-contact]")) $("contactDialog").close();
    if (event.target.closest("[data-close-note]")) $("noteDialog").close();
  });
  $("refresh").addEventListener("click", load);
  load();
})();