(function () {
  "use strict";
  const api = window.HyperTechAuth.request;
  const $ = (id) => document.getElementById(id);
  const esc = (value) => window.escHtml(value ?? "");
  const ROLE_LABELS = {
    chairman: "رئيس مجلس الإدارة", executive_manager: "المدير التنفيذي",
    sales_manager: "مدير المبيعات", online_seller: "بائع أونلاين", offline_seller: "بائع أوفلاين",
    operations_manager: "مدير التشغيل", purchasing_manager: "مدير المشتريات", buyer: "المشتري",
    hr: "الاتش آر", hr_manager: "مدير الموارد البشرية", production_manager: "مدير الإنتاج",
    production_controller: "مراقب الإنتاج", warehouse_manager: "مدير المخازن", storekeeper: "أمين المخزن",
    supervisor: "مشرف", production_quality_controller: "مراقب جودة دورة الإنتاج",
    raw_material_quality_controller: "مراقب جودة الخامات", quality_engineer: "مهندس الجودة",
  };
  const STATUS_LABELS = {
    pending: "معلّق",
    approved: "معتمد",
    rejected: "مرفوض",
    active: "نشط",
    revoked: "ملغي",
  };
  const DECISION_LABELS = {
    approved: "تم الاعتماد",
    rejected: "تم الرفض",
    rejected_sod: "رُفض بسبب فصل الصلاحيات",
    revoked: "تم الإلغاء",
    pending: "معلّق",
  };
  const RESOURCE_LABELS = {
    sales_order: "أمر بيع",
    purchase_order: "أمر شراء",
    production_cost_entry: "قيد تكلفة إنتاج",
    production_request: "طلب إنتاج",
    production_workflow_order: "أمر إنتاج",
    delegation: "تفويض",
    approval_policy: "سياسة اعتماد",
  };
  const ACTION_LABELS = {
    "governance.manageDelegations": "إدارة التفويضات",
    "governance.managePolicies": "إدارة سياسات الاعتماد",
    "production_request.convert": "تحويل طلب الإنتاج إلى أمر",
  };
  const GROUP_LABELS = { "Operations Control": "مركز التحكم التشغيلي" };
  const labelForAction = (key, fallback = "عملية") => ACTION_LABELS[key] || fallback || key;
  const labelForRole = (role) => ROLE_LABELS[role] || "دور غير معروف";
  function fillSelect(select, items, { valueKey, labelKey, keepFirst = true } = {}) {
    if (!select) return;
    const firstOption = keepFirst && select.firstElementChild ? select.firstElementChild.outerHTML : "";
    select.innerHTML = firstOption + items.map((item) => {
      const value = typeof valueKey === "function" ? valueKey(item) : item[valueKey];
      const label = typeof labelKey === "function" ? labelKey(item) : item[labelKey];
      return `<option value="${esc(value)}">${esc(label)}</option>`;
    }).join("");
  }
  function populateStaticLookups() {
    const roleItems = Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }));
    document.querySelectorAll('select[name="approverRoles"]').forEach((select) => {
      select.innerHTML = roleItems.map((r) => `<option value="${esc(r.value)}">${esc(r.label)}</option>`).join("");
    });
    fillSelect($("simulateRole"), roleItems, { valueKey: "value", labelKey: "label" });
  }
  function populateUserLookups(users) {
    const items = users.map((u) => ({ id: u.id, label: `${u.fullName} — ${ROLE_LABELS[u.role] || u.role}` }));
    document.querySelectorAll('select[name="grantorUserId"], select[name="delegateUserId"], select[name="userId"]').forEach((select) => {
      fillSelect(select, items, { valueKey: (i) => i.id, labelKey: (i) => i.label });
    });
    fillSelect($("simulateUserId"), items, { valueKey: (i) => i.id, labelKey: (i) => i.label });
  }
  function populateActionLookups(actions) {
     const items = actions.map((a) => ({ key: a.key, label: a.label }));
    document.querySelectorAll('select[name="actionKey"]').forEach((select) => {
      fillSelect(select, items, { valueKey: (i) => i.key, labelKey: (i) => i.label });
    });
  }
  const setStatus = (text, className = "") => {
    $("pageStatus").textContent = text;
    $("pageStatus").className = `status ${className}`;
  };
  const setResult = (text, className = "") => {
    $("simulateResult").textContent = text;
    $("simulateResult").className = `status ${className}`;
  };
  const rows = (items, empty, render, colspan) =>
    items.length ? items.map(render).join("") : `<tr><td colspan="${colspan}">${empty}</td></tr>`;

  async function load() {
    try {
      setStatus("جارٍ تحميل بيانات الحوكمة…");
      populateStaticLookups();
      const [requests, audit, delegations, policies, overrides, sessions, actions, users] = await Promise.all([
        api("/governance/approval-requests"), api("/governance/audit"),
        api("/governance/delegations"), api("/governance/approval-policies"),
        api("/my-permission-overrides"), api("/auth/sessions"), api("/action-registry"),
        api("/governance/users"),
      ]);
      populateActionLookups(actions);
      populateUserLookups(users);
      $("pending").textContent = requests.filter((r) => r.status === "pending").length;
      $("delegations").textContent = delegations.length;
      $("auditCount").textContent = audit.length;
      $("approvalRows").innerHTML = rows(requests, "لا توجد طلبات اعتماد.", (r) =>
         `<tr><td>${esc(labelForAction(r.actionKey, r.actionKey))}</td><td>${esc(RESOURCE_LABELS[r.resourceType] || "مورد")} رقم ${esc(r.resourceId)}</td><td>${esc(r.currentStep)}</td><td>${esc(STATUS_LABELS[r.status] || "غير محدد")}</td><td>${r.status === "pending" ? `<button class="button" data-id="${esc(r.id)}" data-decision="approve">اعتماد</button> <button class="button" data-id="${esc(r.id)}" data-decision="reject">رفض</button>` : "—"}</td></tr>`, 5);
      $("delegationRows").innerHTML = rows(delegations, "لا توجد تفويضات.", (entry) => {
        const d = entry.delegation || entry;
         return `<tr><td>${esc(labelForAction(d.actionKey, d.actionKey))}</td><td>${esc(entry.grantorName || d.grantorUserId)}</td><td>${esc(d.delegateUserId)}</td><td>${esc(d.startsAt)}</td><td>${esc(d.endsAt)}</td><td>${esc(STATUS_LABELS[d.status] || "غير محدد")}</td><td>${d.status === "active" ? `<button class="button" data-revoke="${esc(d.id)}">إلغاء</button>` : "—"}</td></tr>`;
      }, 7);
      $("policyRows").innerHTML = rows(policies, "لا توجد سياسات اعتماد.", (p) =>
         `<tr><td>${esc(labelForAction(p.actionKey, p.actionKey))}</td><td>${esc(p.minAmount)}</td><td>${esc((p.approverRoles || []).map(labelForRole).join("، "))}</td><td>${esc(p.sequence)}</td><td>${p.active ? "نشطة" : "متوقفة"}</td></tr>`, 5);
      $("overrideRows").innerHTML = rows(overrides, "لا توجد استثناءات نشطة للحساب.", (o) =>
         `<tr><td>${esc(o.userId || "الحساب الحالي")}</td><td>${esc(o.label || labelForAction(o.actionKey, o.actionKey))}</td><td>${o.allowed ? "مسموح" : "ممنوع"}</td><td>${esc(o.reason)}</td><td>${esc(o.expiresAt || "دائم")}</td><td>${o.id ? `<button class="button" data-override="${esc(o.id)}">إلغاء</button>` : "—"}</td></tr>`, 6);
      $("sessionRows").innerHTML = rows(sessions, "لا توجد جلسات.", (s) =>
         `<tr><td>${esc(s.lastActiveAt)}</td><td>${esc(s.ipAddress)}</td><td>${esc(s.userAgent || "غير معروف")}</td><td>${s.revokedAt ? "مغلقة" : "نشطة"}</td><td>${!s.revokedAt ? `<button class="button" data-session="${esc(s.id)}">إغلاق</button>` : "—"}</td></tr>`, 5);
      $("actionRows").innerHTML = rows(actions, "لا يوجد سجل إجراءات.", (a) =>
         `<tr><td>${esc(GROUP_LABELS[a.group] || a.group || "عام")}</td><td>${esc(a.label)}</td><td>${esc((a.defaultRoles || []).map(labelForRole).join("، "))}</td></tr>`, 3);
      $("auditRows").innerHTML = rows(audit.slice(0, 50), "لا توجد أحداث.", (a) =>
         `<tr><td>${esc(labelForAction(a.actionKey, a.actionKey))}</td><td>${esc(a.actorName)}</td><td>${esc(DECISION_LABELS[a.decision] || a.decision || "—")}</td><td>${esc(a.createdAt)}</td></tr>`, 4);
      setStatus("تم تحديث بيانات الحوكمة", "success");
    } catch (error) { setStatus(error.message, "error"); }
  }
  async function mutate(path, options = {}) { await api(path, options); await load(); }
  async function decide(id, decision) { try { await mutate(`/governance/approval-requests/${id}/decide`, { method: "PATCH", body: JSON.stringify({ decision }) }); } catch (e) { setStatus(e.message, "error"); } }
  async function revokeDelegation(id) { if (confirm("إلغاء هذا التفويض؟")) try { await mutate(`/governance/delegations/${id}/revoke`, { method: "PATCH" }); } catch (e) { setStatus(e.message, "error"); } }
  async function revokeOverride(id) { if (confirm("إلغاء استثناء الصلاحية؟")) try { await mutate(`/permission-overrides/${id}`, { method: "DELETE" }); } catch (e) { setStatus(e.message, "error"); } }
  async function closeSession(id) { if (confirm("إغلاق هذه الجلسة؟")) try { await mutate(`/auth/sessions/${id}`, { method: "DELETE" }); } catch (e) { setStatus(e.message, "error"); } }
  async function submitForm(event, path, transform) {
    event.preventDefault();
    try { await mutate(path, { method: "POST", body: JSON.stringify(transform(Object.fromEntries(new FormData(event.currentTarget)))) }); event.currentTarget.reset(); }
    catch (e) { setStatus(e.message, "error"); }
  }
  async function simulate() {
    try {
      const query = new URLSearchParams();
      if ($("simulateUserId").value.trim()) query.set("userId", $("simulateUserId").value.trim());
      if ($("simulateRole").value) query.set("role", $("simulateRole").value);
      const result = await api(`/governance/simulate?${query}`);
      setResult(`تمت المحاكاة: ${result.filter((r) => r.allowed).length} صلاحية مسموحة من ${result.length}.`, "success");
    } catch (e) { setResult(e.message, "error"); }
  }
  async function verify() {
    try { const result = await api("/governance/audit-events/verify"); setResult(result.valid ? `سلسلة التدقيق سليمة (${result.count} حدث).` : `السلسلة غير سليمة عند الحدث ${result.firstInvalidId}.`, result.valid ? "success" : "error"); }
    catch (e) { setResult(e.message, "error"); }
  }
  document.addEventListener("DOMContentLoaded", () => {
    $("refresh").onclick = load;
    $("approvalRows").onclick = (e) => { const b = e.target.closest("[data-id]"); if (b) decide(b.dataset.id, b.dataset.decision); };
    $("delegationRows").onclick = (e) => { const b = e.target.closest("[data-revoke]"); if (b) revokeDelegation(b.dataset.revoke); };
    $("overrideRows").onclick = (e) => { const b = e.target.closest("[data-override]"); if (b) revokeOverride(b.dataset.override); };
    $("sessionRows").onclick = (e) => { const b = e.target.closest("[data-session]"); if (b) closeSession(b.dataset.session); };
    $("delegationForm").onsubmit = (e) => submitForm(e, "/governance/delegations", (b) => ({ ...b, grantorUserId: Number(b.grantorUserId), delegateUserId: Number(b.delegateUserId), startsAt: new Date(b.startsAt).toISOString(), endsAt: new Date(b.endsAt).toISOString() }));
    $("policyForm").onsubmit = (e) => submitForm(e, "/governance/approval-policies", (b) => ({ ...b, minAmount: String(b.minAmount), sequence: Number(b.sequence), approverRoles: Array.from(e.target.elements.approverRoles.selectedOptions).map((o) => o.value) }));
    $("overrideForm").onsubmit = (e) => submitForm(e, "/permission-overrides", (b) => ({ ...b, userId: Number(b.userId), allowed: b.allowed === "true", expiresAt: b.expiresAt ? new Date(b.expiresAt).toISOString() : undefined }));
    $("simulateBtn").onclick = simulate; $("verifyBtn").onclick = verify; load();
  });
})();