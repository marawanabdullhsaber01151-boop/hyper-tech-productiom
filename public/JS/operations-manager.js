(() => {
  const $ = (id) => document.getElementById(id);
  const api = (path, options) => window.HyperTechAuth.request(path, options);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));
  const state = { page: 1, pageSize: 20, currentCase: null };

  const labels = {
    status: {
      received: "مستلمة",
      under_validation: "قيد التحقق",
      needs_sales_clarification: "تحتاج توضيح من المبيعات",
      analysis_ready: "جاهزة للتحليل",
      cancelled: "ملغاة",
      completed: "مكتملة",
      closed: "مغلقة",
    },
    priority: { urgent: "عاجلة", high: "مرتفعة", normal: "عادية", low: "منخفضة" },
    risk: { high: "مرتفع", medium: "متوسط", low: "منخفض" },
    lineStatus: {
      received: "مستلمة",
      under_validation: "قيد التحقق",
      validated: "تم التحقق",
      needs_sales_clarification: "تحتاج توضيحًا من المبيعات",
    },
  };

  const formatTimestamp = (value) => value
    ? new Intl.DateTimeFormat("ar-EG", {
      dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Cairo",
    }).format(new Date(value))
    : "—";
  const formatDate = (value) => value
    ? new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeZone: "Africa/Cairo" }).format(new Date(`${value}T00:00:00Z`))
    : "—";
  const setStatus = (message, error = false) => {
    $("status").textContent = message || "";
    $("status").className = `status ${error ? "error" : "success"}`;
  };

  function actionError(error, fallback) {
    if (error?.isNetworkError) {
      return "تعذر الاتصال بالخادم — تحقق من اتصال الشبكة ثم حاول مرة أخرى.";
    }
    if (error?.status === 401) {
      return "انتهت جلسة الدخول — سجّل الدخول مرة أخرى.";
    }
    if (error?.status === 403) {
      return "ليس لديك صلاحية لتنفيذ هذا الإجراء.";
    }
    if (error?.status === 409) {
      return `تعارض: ${error.message || "ربما انتقلت الحالة بواسطة مستخدم آخر. حدّث البيانات قبل إعادة المحاولة."}`;
    }
    if (error?.status === 400 || error?.status === 422) {
      return `بيانات غير صالحة: ${error.message || "راجع القيم المدخلة ثم حاول مرة أخرى."}`;
    }
    if (error?.status >= 500) {
      return "حدث خطأ في الخادم — حاول مرة أخرى لاحقًا.";
    }
    return error?.message || fallback;
  }

  function setPending(button, pending) {
    if (!button) return;
    button.disabled = pending;
    button.setAttribute("aria-busy", String(pending));
  }

  function setProductionLinesState(name) {
    $("productionLinesLoading").hidden = name !== "loading";
    $("productionLinesEmpty").hidden = name !== "empty";
    $("productionLinesError").hidden = name !== "error";
    $("productionClaimRows").closest(".table-wrap").hidden = name !== "ready";
  }

  function renderProductionLines(rows) {
    $("productionClaimRows").innerHTML = rows.map((line) => {
      const awaiting = line.workflowStatus === "awaiting_operations_claim";
      return `
        <tr>
          <td>${esc(line.orderNumber)}</td>
          <td>${esc(line.productName)}</td>
          <td>${esc(line.customerName || "—")}</td>
          <td>${esc(line.qty)} ${esc(line.unit)}</td>
          <td>${esc(awaiting ? "في انتظار الاستلام" : "تم الاستلام")}</td>
          <td>${esc(line.claimedByName || "—")}</td>
          <td>
            ${awaiting
              ? `<button class="button success claim-production-line" data-id="${esc(line.id)}">استلام السطر</button>`
              : '<span class="muted">تم الاستلام</span>'}
          </td>
        </tr>
      `;
    }).join("");
    $("productionClaimRows").querySelectorAll(".claim-production-line").forEach((button) => {
      button.addEventListener("click", () => claimProductionLine(Number(button.dataset.id), button));
    });
  }

  async function loadProductionLines() {
    setProductionLinesState("loading");
    try {
      const result = await api("/operations-manager/production-orders");
      const rows = Array.isArray(result.data) ? result.data : [];
      if (!rows.length) {
        setProductionLinesState("empty");
        return;
      }
      renderProductionLines(rows);
      setProductionLinesState("ready");
    } catch (error) {
      setProductionLinesState("error");
      setStatus(actionError(error, "تعذر تحميل سطور الإنتاج."), true);
    }
  }

  async function claimProductionLine(id, button) {
    setPending(button, true);
    try {
      await api(`/operations-manager/production-orders/${id}/claim`, { method: "POST" });
      setStatus("تم استلام سطر الإنتاج. أصبح جاهزًا لمدير الإنتاج.");
      await loadProductionLines();
    } catch (error) {
      setStatus(actionError(error, "تعذر استلام سطر الإنتاج."), true);
      await loadProductionLines();
    } finally {
      setPending(button, false);
    }
  }

  function setViewState(name) {
    $("casesLoading").hidden = name !== "loading";
    $("casesEmpty").hidden = name !== "empty";
    $("casesError").hidden = name !== "error";
    $("caseInbox").hidden = name !== "ready";
  }

  function filterParams(page = state.page) {
    const form = new FormData($("filtersForm"));
    const params = new URLSearchParams({ page: String(page), pageSize: String(state.pageSize) });
    for (const [key, value] of form.entries()) {
      if (key === "overdue") {
        params.set(key, "true");
        continue;
      }
      if (value) params.set(key, String(value));
    }
    if (!$("filtersForm").elements.overdue.checked) {
      params.delete("overdue");
    }
    return params;
  }

  async function loadStaff() {
    const select = $("assignedTo");
    if (!select) return;
    select.disabled = true;
    try {
      const staff = await api("/operations-manager/staff");
      const options = Array.isArray(staff)
        ? staff.map((member) =>
          `<option value="${esc(member.id)}">${esc(member.name || "مستخدم بلا اسم")}</option>`,
        ).join("")
        : "";
      select.innerHTML = `<option value="">كل المسؤولين</option>${options}`;
    } catch (error) {
      select.innerHTML = '<option value="">تعذر تحميل المسؤولين</option>';
      setStatus(actionError(error, "تعذر تحميل قائمة مسؤولي التشغيل."), true);
    } finally {
      select.disabled = false;
    }
  }

  async function receiveSalesOrder(event) {
    event.preventDefault();
    const form = new FormData($("receiveOrderForm"));
    const orderNumber = String(form.get("orderNumber") || "").trim();
    const priority = String(form.get("priority") || "normal");
    const button = $("receiveOrderButton");
    if (!orderNumber) {
      setStatus("اكتب رقم أمر البيع أولًا.", true);
      return;
    }

    setPending(button, true);
    try {
      const result = await api("/operations-manager/cases/from-sales-order-number", {
        method: "POST",
        body: JSON.stringify({ orderNumber, priority }),
      });
      setStatus(
        result.idempotentReplay
          ? "أمر البيع موجود بالفعل في مدير التشغيل."
          : "تم استقبال أمر البيع وإنشاء حالة تشغيل.",
      );
      $("receiveOrderForm").reset();
      $("filtersForm").reset();
      await loadCases(1);
    } catch (error) {
      setStatus(actionError(error, "تعذر استقبال أمر البيع للتشغيل."), true);
    } finally {
      setPending(button, false);
    }
  }

  function renderCases(items) {
    $("caseInbox").innerHTML = items.map((item) => `
      <article class="case-card risk-${esc(item.riskLevel)}" tabindex="0" data-case-id="${esc(item.id)}">
        <div class="case-card-top">
          <strong>${esc(item.caseNumber)}</strong>
          <span class="risk-badge risk-${esc(item.riskLevel)}">${esc(labels.risk[item.riskLevel] || item.riskLevel)}</span>
        </div>
        <h3>${esc(item.customerDisplayName || "عميل غير محدد")}</h3>
        <dl>
          <div><dt>أمر البيع</dt><dd>${esc(item.salesOrderNumber || item.salesOrderId)}</dd></div>
          <div><dt>الموعد</dt><dd>${esc(formatDate(item.dueDate))}</dd></div>
          <div><dt>الأولوية</dt><dd>${esc(labels.priority[item.priority] || item.priority)}</dd></div>
          <div><dt>الحالة</dt><dd>${esc(labels.status[item.status] || item.status)}</dd></div>
          <div><dt>السطور / الكمية</dt><dd>${esc(item.lineCount)} / ${esc(item.orderedQtyTotal)}</dd></div>
        </dl>
        <footer>آخر تحديث: ${esc(formatTimestamp(item.updatedAt))}</footer>
      </article>
    `).join("");
    $("caseInbox").querySelectorAll("[data-case-id]").forEach((card) => {
      card.addEventListener("click", () => openCase(Number(card.dataset.caseId)));
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") openCase(Number(card.dataset.caseId));
      });
    });
  }

  function renderPagination(pagination) {
    const { page, totalPages, total } = pagination;
    if (!totalPages) {
      $("pagination").innerHTML = "";
      return;
    }
    $("pagination").innerHTML = `
      <button class="button" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>السابق</button>
      <span>صفحة ${esc(page)} من ${esc(totalPages)} — ${esc(total)} حالة</span>
      <button class="button" data-page="${page + 1}" ${page >= totalPages ? "disabled" : ""}>التالي</button>
    `;
    $("pagination").querySelectorAll("[data-page]").forEach((button) => {
      button.addEventListener("click", () => loadCases(Number(button.dataset.page)));
    });
  }

  async function loadCases(page = 1) {
    state.page = page;
    setViewState("loading");
    try {
      const result = await api(`/operations-manager/cases?${filterParams(page)}`);
      const items = Array.isArray(result.items) ? result.items : [];
      if (!items.length) {
        $("caseInbox").innerHTML = "";
        renderPagination(result.pagination || { page, totalPages: 0, total: 0 });
        setViewState("empty");
        setStatus("لا توجد حالات مطابقة.");
        return;
      }
      renderCases(items);
      renderPagination(result.pagination);
      setViewState("ready");
      setStatus(`تم تحميل ${items.length} حالة من الصفحة الحالية.`);
    } catch (error) {
      $("caseInbox").innerHTML = "";
      $("pagination").innerHTML = "";
      setViewState("error");
      setStatus(actionError(error, "تعذر تحميل الحالات."), true);
    }
  }

  function renderDetail(result) {
    const record = result.case;
    state.currentCase = record;
    $("detailTitle").textContent = `الحالة ${record.caseNumber}`;
    $("detailSubtitle").textContent = `آخر تحديث: ${formatTimestamp(record.updatedAt)}`;
    $("detailSummary").innerHTML = `
      <div><span>العميل</span><strong>${esc(record.customerDisplayName || "غير محدد")}</strong></div>
      <div><span>أمر البيع</span><strong>${esc(record.salesOrderId)}</strong></div>
      <div><span>الموعد</span><strong>${esc(formatDate(record.dueDate))}</strong></div>
      <div><span>الأولوية</span><strong>${esc(labels.priority[record.priority] || record.priority)}</strong></div>
      <div><span>الحالة</span><strong>${esc(labels.status[record.status] || record.status)}</strong></div>
      <div><span>الإصدار</span><strong>${esc(record.currentRevision)}</strong></div>
      <div><span>عدد السطور</span><strong>${esc(linesCount(result.lines))}</strong></div>
    `;
    const lines = Array.isArray(result.lines) ? result.lines : [];
    $("detailLines").innerHTML = lines.map((line) => `
      <tr><td>${esc(line.productNameSnapshot)}</td><td>${esc(line.orderedQty)}</td><td>${esc(line.baseUnit)}</td><td>${esc(labels.lineStatus[line.lineStatus] || line.lineStatus || "غير محددة")}</td></tr>
    `).join("") || '<tr><td colspan="4">لا توجد سطور.</td></tr>';
    $("startValidation").hidden = record.status !== "received";
    $("completeValidation").hidden = record.status !== "under_validation";
    $("requestClarification").hidden = !["received", "under_validation"].includes(record.status);
    $("caseDetail").hidden = false;
    $("caseDetail").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function linesCount(lines) {
    return Array.isArray(lines) ? lines.length : 0;
  }

  async function openCase(id) {
    $("caseDetail").hidden = false;
    $("detailSummary").textContent = "جارٍ تحميل تفاصيل الحالة...";
    try {
      renderDetail(await api(`/operations-manager/cases/${id}`));
    } catch (error) {
      setStatus(actionError(error, "تعذر تحميل تفاصيل الحالة."), true);
    }
  }

  async function mutateCase(button, path, body, successMessage) {
    setPending(button, true);
    try {
      const result = await api(path, {
        method: "POST",
        body: body ? JSON.stringify(body) : undefined,
      });
      setStatus(successMessage);
      await openCase(result.case.id);
      await loadCases(state.page);
    } catch (error) {
      setStatus(actionError(error, "تعذر تنفيذ الإجراء."), true);
    } finally {
      setPending(button, false);
    }
  }

  $("filtersForm").addEventListener("submit", (event) => {
    event.preventDefault();
    loadCases(1);
  });
  $("receiveOrderForm")?.addEventListener("submit", receiveSalesOrder);
  $("clearFilters").addEventListener("click", () => {
    $("filtersForm").reset();
    loadCases(1);
  });
  $("refreshCases").addEventListener("click", async () => {
    const button = $("refreshCases");
    setPending(button, true);
    try {
      await loadCases(state.page);
    } finally {
      setPending(button, false);
    }
  });
  $("refreshProductionLines").addEventListener("click", loadProductionLines);
  $("closeDetail").addEventListener("click", () => { $("caseDetail").hidden = true; });
  $("startValidation").addEventListener("click", () => {
    if (state.currentCase) {
      mutateCase(
        $("startValidation"),
        `/operations-manager/cases/${state.currentCase.id}/start-validation`,
        null,
        "تم بدء التحقق.",
      );
    }
  });
  $("completeValidation").addEventListener("click", () => {
    if (state.currentCase) {
      mutateCase(
        $("completeValidation"),
        `/operations-manager/cases/${state.currentCase.id}/complete-validation`,
        null,
        "تم اعتماد التحقق وأصبحت الحالة جاهزة للتحليل.",
      );
    }
  });
  $("requestClarification").addEventListener("click", () => {
    if (!state.currentCase) return;
    const reason = window.prompt("اكتب سبب طلب التوضيح من المبيعات:");
    if (reason?.trim()) {
      mutateCase(
        $("requestClarification"),
        `/operations-manager/cases/${state.currentCase.id}/request-sales-clarification`,
        { reason },
        "تم إرسال طلب التوضيح إلى المبيعات.",
      );
    }
  });

  loadStaff().then(() => Promise.all([loadCases(), loadProductionLines()]));
})();