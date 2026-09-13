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
  const statusLabel = (value) => ({
    pending: "معلق", needs_info: "ناقصه معلومات", approved: "معتمد", rejected: "مرفوض",
  }[value] || value || "—");
  const governorates = Array.isArray(window.EGYPT_GOVERNORATES)
    ? window.EGYPT_GOVERNORATES
    : [];
  const citySelect = (item) => `
    <label class="subline" for="application-city-${esc(item.id)}">المحافظة</label>
      <select class="input" id="application-city-${esc(item.id)}" data-application-city="${esc(item.id)}" ${["pending", "needs_info"].includes(item.status) ? "" : "disabled"}>
      <option value="">اختر المحافظة...</option>
      ${governorates.map((city) => `<option value="${esc(city)}" ${item.city === city ? "selected" : ""}>${esc(city)}</option>`).join("")}
    </select>`;

  let noteAction = null;

  function render(applications) {
    const rows = Array.isArray(applications) ? applications : [];
    $("resultCount").textContent = `${rows.length} طلب`;
    $("applicationRows").innerHTML = rows.map((item) => {
      const canReview = ["pending", "needs_info"].includes(item.status);
      const details = [
        item.email && `البريد: ${esc(item.email)}`,
        item.address && `العنوان: ${esc(item.address)}`,
        citySelect(item),
        item.expectedMonthlyVolume && `الحجم المتوقع: ${esc(item.expectedMonthlyVolume)}`,
        item.notes && `ملاحظات: ${esc(item.notes)}`,
        item.duplicateContactId && `<span class="no-match">تنبيه: قد يتكرر هذا الطلب مع عميل مسجل بالفعل</span>`,
      ].filter(Boolean).join("<br>");
      const actions = canReview ? `
        <div class="action-stack">
          <button class="button success" data-approve="${esc(item.id)}">قبول</button>
          <button class="button" data-note-action="needs-info" data-id="${esc(item.id)}">طلب معلومات</button>
          <button class="button danger" data-note-action="reject" data-id="${esc(item.id)}">رفض</button>
        </div>` : '<span class="muted">تمت المراجعة</span>';
      return `<tr>
        <td><strong>${esc(item.fullName)}</strong><small class="subline">طلب #${esc(item.referenceCode)}</small></td>
        <td>${esc(item.companyName)}</td>
        <td dir="ltr">${esc(item.phone)}</td>
        <td>${date(item.createdAt)}</td>
        <td><span class="badge badge-${esc(item.status)}">${esc(statusLabel(item.status))}</span></td>
        <td>${details || "—"}</td>
        <td>${actions}</td>
      </tr>`;
    }).join("") || '<tr><td colspan="7" class="muted empty-cell">لا توجد طلبات بهذا الفلتر.</td></tr>';
  }

  async function updateCity(id, city) {
    try {
      await api(`/portal-applications/${id}/city`, {
        method: "PATCH",
        body: JSON.stringify({ city: city || null }),
      });
      status("تم تحديث محافظة الطلب وتسجيل التعديل.");
    } catch (error) {
      status(error.message, true);
      await load();
    }
  }

  async function load() {
    try {
      const filter = $("statusFilter").value;
      const applications = await api(`/portal-applications?status=${encodeURIComponent(filter)}`);
      render(applications);
      status("تم تحديث طلبات الانضمام.");
    } catch (error) {
      status(error.message, true);
    }
  }

  async function approve(id) {
    if (!window.confirm("سيتم إنشاء جهة اتصال وحساب بوابة وتجهيز وسيلة التفعيل. متابعة؟")) return;
    try {
      await api(`/portal-applications/${id}/approve`, { method: "PATCH", body: JSON.stringify({}) });
      status("تم اعتماد الطلب وإنشاء الحساب وتجهيز وسيلة التفعيل.");
      await load();
    } catch (error) {
      status(error.message, true);
    }
  }

  function openNote(id, kind) {
    noteAction = { id, kind };
    const isReject = kind === "reject";
    $("noteTitle").textContent = isReject ? "رفض طلب الانضمام" : "طلب معلومات إضافية";
    $("noteHint").textContent = isReject
      ? "اكتب سببًا مهذبًا وواضحًا سيظهر للعميل عند متابعة الطلب."
      : "اكتب البيانات أو التوضيح المطلوب من العميل.";
    $("noteInput").value = "";
    $("noteSubmit").textContent = isReject ? "تسجيل الرفض" : "إرسال طلب المعلومات";
    $("noteDialog").showModal();
    $("noteInput").focus();
  }

  $("noteForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!noteAction) return;
    const reason = $("noteInput").value.trim();
    if (reason.length < 2) {
      status("اكتب رسالة من حرفين على الأقل.", true);
      return;
    }
    const { id, kind } = noteAction;
    $("noteDialog").close();
    try {
      await api(`/portal-applications/${id}/${kind === "reject" ? "reject" : "needs-info"}`, {
        method: "PATCH", body: JSON.stringify({ reason }),
      });
      status(kind === "reject" ? "تم تسجيل رفض الطلب." : "تم إرسال طلب المعلومات.");
      await load();
    } catch (error) {
      status(error.message, true);
    } finally {
      noteAction = null;
    }
  });

  document.addEventListener("click", (event) => {
    const approveButton = event.target.closest("[data-approve]");
    if (approveButton) return void approve(approveButton.dataset.approve);
    const noteButton = event.target.closest("[data-note-action]");
    if (noteButton) openNote(noteButton.dataset.id, noteButton.dataset.noteAction);
    if (event.target.closest("[data-close-dialog]")) $("noteDialog").close();
  });
  document.addEventListener("change", (event) => {
    const city = event.target.closest("[data-application-city]");
    if (city) updateCity(city.dataset.applicationCity, city.value);
  });
  $("refresh").addEventListener("click", load);
  $("statusFilter").addEventListener("change", load);
  load();
})();