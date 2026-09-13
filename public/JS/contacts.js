/** @format */
// ============================================================
//  CONTACTS — Hyper-Tech ERP
//  الموردون والعملاء — متصلة بالباك إند الحقيقي (/api/v1/contacts) بدل localStorage
// ============================================================

async function apiCall(path, options = {}) {
  return window.HyperTechAuth.request(path, options);
}

// ---- State ----
let contacts = [];
let salesOrders = []; // لعرض عدد فواتير كل عميل — بيانات حقيقية من /api/v1/sales
let purchaseOrders = []; // لعرض عدد أوامر شراء كل مورد — بيانات حقيقية من /api/v1/purchases
let activeType = "all";
let searchQ = "";
let sortMode = "name";
let editingId = null;
let deletingId = null;
let adjustingId = null;
let duplicateMatches = [];
let duplicateTimer = null;

const typeLabel = { supplier: "مورد", customer: "عميل", both: "مورد وعميل" };
const typeClass = {
  supplier: "supplier",
  customer: "customer",
  both: "supplier",
};

// ---- Init ----
(async function init() {
  updateTime();
  setInterval(updateTime, 1000);
  populateGovernorates();
  populateSegments();
  bindEvents();
  await loadInitialData();
})();

async function loadInitialData() {
  try {
    const [contactsRes, salesRes, poRes] = await Promise.all([
      apiCall("/contacts"),
      apiCall("/sales").catch(() => []),
      apiCall("/purchases").catch(() => []),
    ]);
    contacts = contactsRes || [];
    salesOrders = salesRes || [];
    purchaseOrders = poRes || [];
    renderAll();
  } catch (e) {
    showToast("فشل تحميل جهات الاتصال: " + e.message, "warn");
  }
}

// ---- Filter ----
function filteredContacts() {
  return contacts
    .filter((c) => {
      if (
        activeType !== "all" &&
        c.type !== activeType &&
        !(activeType === "supplier" && c.type === "both") &&
        !(activeType === "customer" && c.type === "both")
      )
        return false;
      if (searchQ) {
        const q = searchQ.toLowerCase();
        if (
          !c.name.toLowerCase().includes(q) &&
          !(c.phone || "").includes(q) &&
          !(c.company || "").toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (sortMode === "name") return a.name.localeCompare(b.name, "ar");
      if (sortMode === "balance")
        return Math.abs(Number(b.balance)) - Math.abs(Number(a.balance));
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
}

function renderAll() {
  updateKPIs();
  renderGrid();
}

function updateKPIs() {
  setText("kpi-total", contacts.length);
  setText(
    "kpi-suppliers",
    contacts.filter((c) => c.type === "supplier" || c.type === "both").length,
  );
  setText(
    "kpi-customers",
    contacts.filter((c) => c.type === "customer" || c.type === "both").length,
  );
  const totalBalance = contacts.reduce(
    (s, c) => s + Math.abs(Number(c.balance) || 0),
    0,
  );
  setText("kpi-balance", fmt(totalBalance) + " ج.م");
}

function renderGrid() {
  const grid = document.getElementById("con-grid");
  const empty = document.getElementById("empty-state");
  const list = filteredContacts();

  if (!list.length) {
    grid.innerHTML = "";
    empty.style.display = "flex";
    return;
  }
  empty.style.display = "none";
  grid.innerHTML = list
    .map((c, i) => {
      const color = avatarColors(c.name);
      const ini = initials(c.name);
      const salesCount = salesOrders.filter((s) => s.contactId === c.id).length;
      const poCount = purchaseOrders.filter((p) => p.contactId === c.id).length;
      const balance = Number(c.balance) || 0;
      return `
    <div class="con-card" style="animation-delay:${i * 0.04}s">
      <div class="con-card-head">
        <div class="con-avatar ${typeClass[c.type] || "supplier"}" style="background:${color}22;color:${color}">${escHtml(ini)}</div>
        <div style="flex:1;min-width:0">
          <div class="con-name">${escHtml(c.name)}</div>
          <span class="con-type-badge ${typeClass[c.type] || "supplier"}">${typeLabel[c.type] || escHtml(c.type)}</span>
        </div>
      </div>
      <div class="con-card-body">
        <div class="con-info-row"><i class="fa-solid fa-phone"></i><span>${escHtml(c.phone) || "—"}</span></div>
        <div class="con-info-row"><i class="fa-solid fa-envelope"></i><span>${escHtml(c.email) || "—"}</span></div>
        <div class="con-info-row"><i class="fa-solid fa-building"></i><span>${escHtml(c.company) || "—"}</span></div>
        ${c.segment ? `<div class="con-info-row"><i class="fa-solid fa-layer-group"></i><span>${segmentLabel(c.segment)}</span></div>` : ""}
        ${(c.type === "customer" || c.type === "both") && salesCount ? `<div class="con-info-row"><i class="fa-solid fa-file-invoice"></i><span style="color:var(--text-main)">${salesCount} فاتورة مبيعات</span></div>` : ""}
        ${(c.type === "supplier" || c.type === "both") && poCount ? `<div class="con-info-row"><i class="fa-solid fa-truck"></i><span style="color:var(--text-main)">${poCount} أمر شراء</span></div>` : ""}
      </div>
      <div class="con-card-footer">
        <div class="con-balance">الرصيد: <strong style="color:${
          balance > 0 ? "var(--green)"
          : balance < 0 ? "var(--red)"
          : "var(--text-muted)"
        }">${fmt(Math.abs(balance))} ج.م</strong></div>
        <div class="con-card-actions">
          <button style="width:30px;height:30px;border-radius:7px;border:1px solid var(--border);background:rgba(255,255,255,0.04);color:var(--text-muted);cursor:pointer;font-size:12px;transition:all 0.25s;display:flex;align-items:center;justify-content:center" onmouseover="this.style.background='var(--accent-soft)';this.style.color='var(--accent)'" onmouseout="this.style.background='rgba(255,255,255,0.04)';this.style.color='var(--text-muted)'" onclick="openEdit(${c.id})"><i class="fa-solid fa-pen"></i></button>
           <button title="تسوية الرصيد" style="width:30px;height:30px;border-radius:7px;border:1px solid var(--border);background:rgba(255,255,255,0.04);color:var(--text-muted);cursor:pointer;font-size:12px;transition:all 0.25s;display:flex;align-items:center;justify-content:center" onmouseover="this.style.background='var(--purple-soft)';this.style.color='var(--purple)'" onmouseout="this.style.background='rgba(255,255,255,0.04)';this.style.color='var(--text-muted)'" onclick="openBalanceAdjustment(${c.id})"><i class="fa-solid fa-scale-balanced"></i></button>
          <button style="width:30px;height:30px;border-radius:7px;border:1px solid var(--border);background:rgba(255,255,255,0.04);color:var(--text-muted);cursor:pointer;font-size:12px;transition:all 0.25s;display:flex;align-items:center;justify-content:center" onmouseover="this.style.background='var(--red-soft)';this.style.color='var(--red)'" onmouseout="this.style.background='rgba(255,255,255,0.04)';this.style.color='var(--text-muted)'" onclick="openDelete(${c.id})"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
    </div>`;
    })
    .join("");
}

// ---- Modal ----
function openNew() {
  editingId = null;
  document.getElementById("modal-title").textContent = "جهة اتصال جديدة";
  clearForm();
  document.getElementById("opening-balance-note-row").style.display = "";
  document.getElementById("modal-overlay").classList.add("open");
}
function openEdit(id) {
  const c = contacts.find((c) => c.id === id);
  if (!c) return;
  editingId = id;
  document.getElementById("modal-title").textContent = "تعديل جهة الاتصال";
  document.getElementById("f-type").value = c.type;
  document.getElementById("f-name").value = c.name;
  document.getElementById("f-company").value = c.company || "";
  document.getElementById("f-phone").value = c.phone || "";
  document.getElementById("f-email").value = c.email || "";
  document.getElementById("f-city").value = c.city || "";
  document.getElementById("f-segment").value = c.segment || "";
  document.getElementById("f-address").value = c.address || "";
  document.getElementById("f-notes").value = c.notes || "";
  document.getElementById("f-opening-balance").value = "";
  document.getElementById("f-opening-balance-note").value = "";
  document.getElementById("opening-balance-note-row").style.display = "none";
  document.getElementById("modal-overlay").classList.add("open");
}
function clearForm() {
  [
    "f-type",
    "f-name",
    "f-company",
    "f-phone",
    "f-email",
    "f-opening-balance",
    "f-opening-balance-note",
    "f-city",
    "f-segment",
    "f-address",
    "f-notes",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = id === "f-type" ? "supplier" : "";
  });
  duplicateMatches = [];
  renderDuplicateWarning();
}
function closeModal() {
  document.getElementById("modal-overlay").classList.remove("open");
}

async function saveContact() {
  const type = document.getElementById("f-type").value;
  const name = document.getElementById("f-name").value.trim();
  if (!name) {
    showToast("يرجى إدخال الاسم", "warn");
    return;
  }
  const openingBalance = document.getElementById("f-opening-balance").value.trim();
  const openingBalanceNote = document.getElementById("f-opening-balance-note").value.trim();
  if (!editingId && Number(openingBalance || 0) !== 0 && openingBalanceNote.length < 5) {
    showToast("اكتب ملاحظة واضحة للرصيد الافتتاحي لأنها ستظهر للعميل", "warn");
    return;
  }
  if (!editingId && duplicateMatches.length && !window.confirm("يوجد احتمال تكرار لجهة اتصال موجودة. هل تريد المتابعة؟")) {
    return;
  }
  const data = {
    type,
    name,
    company: document.getElementById("f-company").value.trim() || null,
    phone: document.getElementById("f-phone").value.trim() || null,
    email: document.getElementById("f-email").value.trim() || null,
    address: document.getElementById("f-address").value.trim() || null,
    city: document.getElementById("f-city").value || null,
    segment: document.getElementById("f-segment").value || null,
    notes: document.getElementById("f-notes").value.trim() || null,
  };
  if (!editingId) {
    data.openingBalance = openingBalance || "0";
    data.openingBalanceNote = openingBalanceNote || null;
  }

  const saveBtn = document.getElementById("modal-save");
  saveBtn.disabled = true;
  try {
    if (editingId) {
      await apiCall(`/contacts/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
    } else {
      await apiCall("/contacts", {
        method: "POST",
        body: JSON.stringify(data),
      });
    }
    await loadInitialData();
    closeModal();
    showToast(editingId ? "تم تحديث جهة الاتصال" : "تمت الإضافة بنجاح");
  } catch (e) {
    showToast("فشل الحفظ: " + e.message, "warn");
  } finally {
    saveBtn.disabled = false;
  }
}

function openBalanceAdjustment(id) {
  const contact = contacts.find((item) => item.id === id);
  if (!contact) return;
  adjustingId = id;
  document.getElementById("balance-contact-name").textContent =
    `${contact.name} — الرصيد الحالي ${fmt(contact.balance)} ج.م`;
  document.getElementById("adjustment-amount").value = "";
  document.getElementById("adjustment-note").value = "";
  document.getElementById("balance-modal-overlay").classList.add("open");
}

function closeBalanceAdjustment() {
  document.getElementById("balance-modal-overlay").classList.remove("open");
  adjustingId = null;
}

async function saveBalanceAdjustment() {
  if (!adjustingId) return;
  const amount = document.getElementById("adjustment-amount").value.trim();
  const note = document.getElementById("adjustment-note").value.trim();
  if (!amount || Number(amount) === 0 || note.length < 5) {
    showToast("أدخل قيمة غير صفرية وملاحظة واضحة للعميل", "warn");
    return;
  }
  const saveButton = document.getElementById("balance-modal-save");
  saveButton.disabled = true;
  try {
    await apiCall(`/contacts/${adjustingId}/balance-adjustment`, {
      method: "POST",
      body: JSON.stringify({ amount, note }),
    });
    closeBalanceAdjustment();
    await loadInitialData();
    showToast("تم تسجيل التسوية في كشف الحساب");
  } catch (error) {
    showToast("فشل تسجيل التسوية: " + error.message, "warn");
  } finally {
    saveButton.disabled = false;
  }
}

function openDelete(id) {
  deletingId = id;
  const c = contacts.find((c) => c.id === id);
  document.getElementById("confirm-msg").textContent =
    `هل أنت متأكد من حذف "${c?.name || ""}"؟`;
  document.getElementById("confirm-overlay").classList.add("open");
}
function closeConfirm() {
  document.getElementById("confirm-overlay").classList.remove("open");
  deletingId = null;
}
async function doDelete() {
  if (!deletingId) return;
  try {
    await apiCall(`/contacts/${deletingId}`, { method: "DELETE" });
    await loadInitialData();
    showToast("تم الحذف");
  } catch (e) {
    showToast("فشل الحذف: " + e.message, "warn");
  } finally {
    closeConfirm();
  }
}

// ---- Helpers ----
function avatarColors(name) {
  const colors = [
    "#6366f1",
    "#06b6d4",
    "#22c55e",
    "#f59e0b",
    "#ef4444",
    "#a855f7",
    "#ec4899",
  ];
  let hash = 0;
  for (let i = 0; i < (name || "").length; i++)
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}
function initials(name) {
  const parts = (name || "").trim().split(/\s+/);
  return parts.length > 1 ?
      parts[0][0] + parts[1][0]
    : (name || "").slice(0, 2);
}
function fmt(n) {
  return Number(n || 0).toLocaleString("ar-EG");
}
function setText(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  t.style.background = type === "warn" ? "var(--red)" : "var(--green)";
  document.getElementById("toast-msg").textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3000);
}

function populateGovernorates() {
  const select = document.getElementById("f-city");
  const governorates = Array.isArray(window.EGYPT_GOVERNORATES)
    ? window.EGYPT_GOVERNORATES
    : [];
  if (!select) return;
  select.replaceChildren(new Option("اختر المحافظة...", ""));
  governorates.forEach((governorate) => select.appendChild(new Option(governorate, governorate)));
}

function populateSegments() {
  const select = document.getElementById("f-segment");
  if (!select) return;
  const segments = Array.isArray(window.HYPER_CONTACT_SEGMENTS)
    ? window.HYPER_CONTACT_SEGMENTS
    : [];
  segments.forEach((segment) => select.appendChild(new Option(segment.label, segment.value)));
}

function segmentLabel(value) {
  const segment = (window.HYPER_CONTACT_SEGMENTS || []).find((item) => item.value === value);
  return escHtml(segment?.label || value);
}

function renderDuplicateWarning() {
  const warning = document.getElementById("duplicate-warning");
  if (!warning) return;
  if (!duplicateMatches.length) {
    warning.style.display = "none";
    warning.textContent = "";
    return;
  }
  warning.style.display = "block";
  warning.textContent = `تنبيه: قد تكون هناك جهة اتصال مكررة: ${duplicateMatches
    .map((item) => item.name || item.company || item.phone)
    .join("، ")}`;
}

async function checkDuplicates() {
  const phone = document.getElementById("f-phone").value.trim();
  const company = document.getElementById("f-company").value.trim();
  if (!phone && !company) {
    duplicateMatches = [];
    renderDuplicateWarning();
    return;
  }
  try {
    const params = new URLSearchParams({ phone, company });
    if (editingId) params.set("excludeId", String(editingId));
    const result = await apiCall(`/contacts/duplicate-check?${params}`);
    duplicateMatches = Array.isArray(result.matches) ? result.matches : [];
    renderDuplicateWarning();
  } catch {
    // فشل التحذير لا يمنع حفظ جهة الاتصال.
  }
}
function updateTime() {
  const el = document.getElementById("last-update");
  if (el)
    el.textContent = new Date().toLocaleTimeString("ar-EG", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
}

function bindEvents() {
  document.getElementById("btn-new-contact").addEventListener("click", openNew);
  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("modal-cancel").addEventListener("click", closeModal);
  document.getElementById("modal-save").addEventListener("click", saveContact);
  document.getElementById("balance-modal-close").addEventListener("click", closeBalanceAdjustment);
  document.getElementById("balance-modal-cancel").addEventListener("click", closeBalanceAdjustment);
  document.getElementById("balance-modal-save").addEventListener("click", saveBalanceAdjustment);
  document.getElementById("confirm-no").addEventListener("click", closeConfirm);
  document.getElementById("confirm-yes").addEventListener("click", doDelete);
  document.getElementById("modal-overlay").addEventListener("click", (e) => {
    if (e.target === document.getElementById("modal-overlay")) closeModal();
  });
  document.getElementById("balance-modal-overlay").addEventListener("click", (e) => {
    if (e.target === document.getElementById("balance-modal-overlay")) closeBalanceAdjustment();
  });
  document.getElementById("confirm-overlay").addEventListener("click", (e) => {
    if (e.target === document.getElementById("confirm-overlay")) closeConfirm();
  });
  document.querySelectorAll(".type-tab").forEach((btn) =>
    btn.addEventListener("click", function () {
      document
        .querySelectorAll(".type-tab")
        .forEach((b) => b.classList.remove("active"));
      this.classList.add("active");
      activeType = this.dataset.type;
      renderAll();
    }),
  );
  document
    .getElementById("search-input")
    .addEventListener("input", function () {
      searchQ = this.value.trim();
      renderAll();
    });
  document
    .getElementById("sort-select")
    .addEventListener("change", function () {
      sortMode = this.value;
      renderAll();
    });
  ["f-phone", "f-company"].forEach((id) => {
    document.getElementById(id).addEventListener("input", () => {
      clearTimeout(duplicateTimer);
      duplicateTimer = setTimeout(checkDuplicates, 350);
    });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal();
      closeConfirm();
      closeBalanceAdjustment();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "n") {
      e.preventDefault();
      openNew();
    }
  });
}
