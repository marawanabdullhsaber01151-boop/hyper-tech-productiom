/** @format */
// ============================================================
//  SALES — Hyper-Tech ERP
//  المبيعات — متصلة بالباك إند الحقيقي (/api/v1/sales) بدل localStorage
// ============================================================

async function apiCall(path, options = {}) {
  return window.HyperTechAuth.request(path, options);
}

// ---- State ----
let sales = []; // رؤوس الفواتير من السيرفر (من غير items — بتتحمل عند الفتح/التعديل بس)
let contacts = []; // عملاء حقيقيين من /api/v1/contacts
let inventoryItems = []; // أصناف حقيقية من /api/v1/inventory
let activeStatus = "all";
let searchQ = "";
let dateFilter = "all";
let customerFilter = "all";
let currentPage = 1;
const PAGE_SIZE = 15;
let editingId = null; // رقم أمر البيع (id) الحقيقي في الداتابيز، مش رقم الفاتورة النصي
let deletingId = null;
let itemRows = [];
let salesTotal = 0;
let totalPages = 0;
let statusCounts = {};
let salesSummary = { total: 0, revenue: "0", pending: 0, customers: 0 };
let salesRequestVersion = 0;

const statusMap = {
  draft: { label: "مسودة", cls: "amber", icon: "fa-file-pen" },
  confirmed: { label: "مؤكد", cls: "blue", icon: "fa-circle-check" },
  shipped: { label: "تم الشحن", cls: "blue", icon: "fa-truck" },
  paid: { label: "مدفوع", cls: "green", icon: "fa-circle-check" },
  cancelled: { label: "ملغي", cls: "red", icon: "fa-circle-xmark" },
};

// ---- Init ----
(async function init() {
  updateTime();
  setInterval(updateTime, 1000);
  bindEvents();
  await loadInitialData();
})();

async function loadInitialData() {
  try {
    const [contactsRes, invRes] = await Promise.all([
      apiCall("/contacts"),
      apiCall("/inventory"),
    ]);
    contacts = (contactsRes || []).filter(
      (c) => c.type === "customer" || c.type === "both",
    );
    inventoryItems = invRes || [];
    buildCustomerFilter();
    await loadSalesPage();
  } catch (e) {
    showToast("فشل تحميل بيانات المبيعات: " + e.message, "warn");
  }
}

async function loadSalesPage() {
  const requestVersion = ++salesRequestVersion;
  const params = new URLSearchParams({
    page: String(currentPage),
    page_size: String(PAGE_SIZE),
  });
  if (activeStatus !== "all") params.set("status", activeStatus);
  if (customerFilter !== "all") params.set("contact_id", customerFilter);
  if (searchQ) params.set("search", searchQ);
  const bounds = dateFilterBounds();
  if (bounds.from) params.set("date_from", bounds.from);
  if (bounds.to) params.set("date_to", bounds.to);

  const response = await apiCall(`/sales?${params.toString()}`);
  if (requestVersion !== salesRequestVersion) return;
  sales = response.items || [];
  salesTotal = Number(response.pagination?.total || 0);
  totalPages = Number(response.pagination?.totalPages || 0);
  statusCounts = response.statusCounts || {};
  salesSummary = response.summary || {
    total: 0,
    revenue: "0",
    pending: 0,
    customers: 0,
  };
  renderAll();
}

// ---- Filter & Render ----
function filteredSales() {
  return sales;
}

function customerNameOf(contactId) {
  const c = contacts.find((c) => c.id === contactId);
  return c ? c.name : "—";
}

function renderAll() {
  updateKPIs();
  updateTabCounts();
  renderTable();
  updatePagination();
}

function updateKPIs() {
  setText("kpi-total", salesSummary.total);
  setText("kpi-revenue", fmt(salesSummary.revenue) + " ج.م");
  setText("kpi-pending", salesSummary.pending);
  setText("kpi-customers", salesSummary.customers);
}

function updateTabCounts() {
  setText("tab-all", salesSummary.total);
  setText("tab-draft", statusCounts.draft || 0);
  setText("tab-confirmed", statusCounts.confirmed || 0);
  setText("tab-shipped", statusCounts.shipped || 0);
  setText("tab-paid", statusCounts.paid || 0);
  setText("tab-cancelled", statusCounts.cancelled || 0);
}

function renderTable() {
  const tbody = document.getElementById("sales-tbody");
  const list = filteredSales();
  const info = document.getElementById("footer-info");
  const start = salesTotal ? (currentPage - 1) * PAGE_SIZE + 1 : 0;
  info.textContent = `عرض ${start}–${Math.min(
    start + list.length - 1,
    salesTotal,
  )} من ${salesTotal} فاتورة`;

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">
      <div class="empty-state"><i class="fa-solid fa-file-invoice"></i><h4>لا توجد فواتير</h4><p>أضف فاتورة جديدة للبدء</p></div>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = list
    .map((inv) => {
      const s = statusMap[inv.status] || statusMap.draft;
      return `<tr>
      <td class="td-inv-code">${escHtml(inv.orderNumber)}</td>
      <td><strong style="font-size:13px">${escHtml(customerNameOf(inv.contactId))}</strong></td>
      <td style="color:var(--text-muted);font-size:12px">${fmtDate(inv.date)}</td>
      <td style="font-size:12px;color:var(--text-muted)">—</td>
      <td class="td-amount">${fmt(inv.total)} ج.م</td>
      <td><span class="badge ${s.cls}"><i class="fa-solid ${s.icon}"></i> ${s.label}</span></td>
      <td>
        <div class="row-actions">
          <button class="row-action edit-btn" title="تعديل" onclick="openEdit(${inv.id})"><i class="fa-solid fa-pen"></i></button>
          <button class="row-action print-btn" title="طباعة" onclick="printInvoice(${inv.id})"><i class="fa-solid fa-print"></i></button>
          <button class="row-action delete-btn" title="حذف" onclick="openDelete(${inv.id})"><i class="fa-solid fa-trash"></i></button>
        </div>
      </td>
    </tr>`;
    })
    .join("");
}

function updatePagination() {
  const btns = document.getElementById("pag-btns");
  if (totalPages <= 1) {
    btns.innerHTML = "";
    return;
  }
  let html = "";
  for (let i = 1; i <= totalPages; i++)
    html += `<button class="pag-btn${i === currentPage ? " active" : ""}" onclick="goPage(${i})">${i}</button>`;
  btns.innerHTML = html;
}

async function goPage(p) {
  currentPage = p;
  try {
    await loadSalesPage();
  } catch (e) {
    showToast("فشل تحميل الصفحة: " + e.message, "warn");
  }
}

// ---- Customer Filter (header dropdown) ----
function buildCustomerFilter() {
  const sel = document.getElementById("customer-filter");
  sel.innerHTML = '<option value="all">كل العملاء</option>';
  contacts.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = String(c.id);
    opt.textContent = c.name;
    sel.appendChild(opt);
  });
}

function buildCustomerSelect(selectedId = null) {
  const sel = document.getElementById("f-customer");
  sel.innerHTML = '<option value="">— اختر عميل —</option>';
  contacts.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = String(c.id);
    opt.textContent = c.name;
    if (selectedId != null && c.id === selectedId) opt.selected = true;
    sel.appendChild(opt);
  });
}

// ---- Modal ----
function openNew() {
  editingId = null;
  itemRows = [
    { id: Date.now(), inventoryItemId: "", description: "", qty: 1, price: 0 },
  ];
  document.getElementById("modal-title").textContent = "فاتورة بيع جديدة";
  document.getElementById("f-code").value = genCode();
  document.getElementById("f-date").value = today();
  document.getElementById("f-due").value = "";
  buildCustomerSelect();
  document.getElementById("f-status").value = "draft";
  document.getElementById("f-notes").value = "";
  renderItemRows();
  document.getElementById("modal-overlay").classList.add("open");
}

async function openEdit(id) {
  let inv;
  try {
    inv = await apiCall(`/sales/${id}`);
  } catch (e) {
    showToast("تعذّر تحميل الفاتورة: " + e.message, "warn");
    return;
  }
  editingId = id;
  itemRows = (inv.items || []).map((i) => ({
    id: i.id,
    inventoryItemId: i.inventoryItemId || "",
    description: i.description,
    qty: Number(i.qty),
    price: Number(i.unitPrice),
  }));
  document.getElementById("modal-title").textContent = "تعديل الفاتورة";
  document.getElementById("f-code").value = inv.orderNumber;
  document.getElementById("f-date").value = inv.date;
  document.getElementById("f-due").value = inv.dueDate || "";
  buildCustomerSelect(inv.contactId);
  document.getElementById("f-status").value = inv.status;
  document.getElementById("f-notes").value = inv.notes || "";
  renderItemRows();
  document.getElementById("modal-overlay").classList.add("open");
}

function closeModal() {
  document.getElementById("modal-overlay").classList.remove("open");
}

async function saveInvoice() {
  const orderNumber = document.getElementById("f-code").value.trim();
  const date = document.getElementById("f-date").value;
  const customerSel = document.getElementById("f-customer");
  const contactId = customerSel.value ? Number(customerSel.value) : null;
  const status = document.getElementById("f-status").value;
  const dueDate = document.getElementById("f-due").value || null;
  const notes = document.getElementById("f-notes").value.trim() || null;

  if (!date || !contactId) {
    showToast("يرجى اختيار العميل والتاريخ", "warn");
    return;
  }
  const validRows = itemRows.filter((r) => r.description && r.qty > 0);
  if (!validRows.length) {
    showToast("أضف صنفاً واحداً على الأقل", "warn");
    return;
  }

  const items = validRows.map((r) => ({
    inventoryItemId: r.inventoryItemId ? Number(r.inventoryItemId) : null,
    description: r.description,
    qty: String(r.qty),
    unitPrice: String(r.price),
    total: "0",
  }));

  const payload = {
    orderNumber,
    contactId,
    date,
    dueDate,
    status,
    notes,
    items,
  };

  const saveBtn = document.getElementById("modal-save");
  saveBtn.disabled = true;
  try {
    if (editingId) {
      await apiCall(`/sales/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify({
          orderNumber,
          contactId,
          date,
          dueDate,
          status,
          notes,
          items,
        }),
      });
    } else {
      await apiCall("/sales", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    }
    await loadInitialData();
    closeModal();
    showToast(editingId ? "تم تحديث الفاتورة" : "تم إضافة الفاتورة بنجاح");
  } catch (e) {
    showToast("فشل الحفظ: " + e.message, "warn");
  } finally {
    saveBtn.disabled = false;
  }
}

// ---- Item Rows ----
function renderItemRows() {
  const tbody = document.getElementById("items-tbody");
  const invOptions = (selectedId) =>
    `<option value="">— صنف حر (وصف يدوي) —</option>` +
    inventoryItems
      .map(
        (it) =>
          `<option value="${it.id}" ${String(it.id) === String(selectedId) ? "selected" : ""}>${escHtml(it.name)} (متاح: ${fmt(it.qty)} ${escHtml(it.unit || "")})</option>`,
      )
      .join("");

  tbody.innerHTML = itemRows
    .map(
      (row) => `
    <tr data-row="${row.id}">
      <td>
        <select style="margin-bottom:4px;width:100%" onchange="pickInventoryItem(${row.id}, this.value)">${invOptions(row.inventoryItemId)}</select>
        <input type="text" value="${escHtml(row.description)}" placeholder="اسم الصنف/الوصف" onchange="updateRow(${row.id},'description',this.value)"/>
      </td>
      <td><input type="number" value="${row.qty}" min="0.001" step="0.001" style="width:70px" onchange="updateRow(${row.id},'qty',this.value)"/></td>
      <td><input type="number" value="${row.price}" min="0" step="0.01" style="width:90px" onchange="updateRow(${row.id},'price',this.value)"/></td>
      <td style="font-weight:700;color:var(--green)">${fmt(row.qty * row.price)} ج.م</td>
      <td><button class="btn-danger" style="padding:4px 8px;font-size:12px" onclick="removeRow(${row.id})"><i class="fa-solid fa-trash"></i></button></td>
    </tr>`,
    )
    .join("");
  calcInvoiceTotal();
}

function pickInventoryItem(rowId, invId) {
  const row = itemRows.find((r) => r.id === rowId);
  if (!row) return;
  if (!invId) {
    row.inventoryItemId = "";
    renderItemRows();
    return;
  }
  const item = inventoryItems.find((i) => String(i.id) === String(invId));
  if (item) {
    row.inventoryItemId = item.id;
    row.description = item.name;
    row.price = Number(item.unitPrice) || 0;
  }
  renderItemRows();
}

function updateRow(id, field, val) {
  const row = itemRows.find((r) => r.id === id);
  if (row) {
    row[field] = field === "description" ? val : Number(val) || 0;
    renderItemRows();
  }
}

function removeRow(id) {
  itemRows = itemRows.filter((r) => r.id !== id);
  renderItemRows();
}

function addItemRow() {
  itemRows.push({
    id: Date.now(),
    inventoryItemId: "",
    description: "",
    qty: 1,
    price: 0,
  });
  renderItemRows();
}

function calcInvoiceTotal() {
  const total = itemRows.reduce((s, r) => s + r.qty * r.price, 0);
  document.getElementById("invoice-total").textContent = fmt(total) + " ج.م";
}

// ---- Delete ----
function openDelete(id) {
  deletingId = id;
  const inv = sales.find((s) => s.id === id);
  document.getElementById("confirm-msg").textContent =
    `هل أنت متأكد من حذف الفاتورة ${inv?.orderNumber || ""}؟ لا يمكن التراجع.`;
  document.getElementById("confirm-overlay").classList.add("open");
}
function closeConfirm() {
  document.getElementById("confirm-overlay").classList.remove("open");
  deletingId = null;
}
async function doDelete() {
  if (!deletingId) return;
  try {
    await apiCall(`/sales/${deletingId}`, { method: "DELETE" });
    await loadInitialData();
    showToast("تم حذف الفاتورة");
  } catch (e) {
    showToast("فشل الحذف: " + e.message, "warn");
  } finally {
    closeConfirm();
  }
}

// ---- Print Invoice ----
async function printInvoice(id) {
  let inv;
  try {
    inv = await apiCall(`/sales/${id}`);
  } catch (e) {
    showToast("تعذّر تحميل الفاتورة: " + e.message, "warn");
    return;
  }
  const area = document.getElementById("print-area");
  area.innerHTML = `
    <div class="print-header">
      <div><div class="print-title">⚡ Hyper-Tech ERP</div><div class="print-subtitle">فاتورة بيع</div></div>
      <div class="print-info"><strong>${escHtml(inv.orderNumber)}</strong><br/>التاريخ: ${fmtDate(inv.date)}<br/>الاستحقاق: ${inv.dueDate ? fmtDate(inv.dueDate) : "—"}</div>
    </div>
    <p><strong>العميل:</strong> ${escHtml(customerNameOf(inv.contactId))}</p>
    <table class="print-table">
      <thead><tr><th>#</th><th>الصنف</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead>
      <tbody>${(inv.items || []).map((i, idx) => `<tr><td>${idx + 1}</td><td>${escHtml(i.description)}</td><td>${fmt(i.qty)}</td><td>${fmt(i.unitPrice)} ج.م</td><td>${fmt(i.total)} ج.م</td></tr>`).join("")}</tbody>
    </table>
    <div class="print-totals">
      <p>الإجمالي: <strong>${fmt(inv.total)} ج.م</strong></p>
    </div>
    ${inv.notes ? `<p><strong>ملاحظات:</strong> ${escHtml(inv.notes)}</p>` : ""}
    <div class="print-footer"><div>توقيع المحاسب: ___________</div><div>توقيع العميل: ___________</div><div>Hyper-Tech ERP © ${new Date().getFullYear()}</div></div>
  `;
  window.print();
}

// ---- Helpers ----
function genCode() {
  const max = sales.reduce((m, s) => {
    const n = parseInt((s.orderNumber || "").split("-")[2] || 0, 10);
    return n > m ? n : m;
  }, 0);
  const n = String(max + 1).padStart(3, "0");
  return `INV-${new Date().getFullYear()}-${n}`;
}
function today() {
  const now = new Date();
  return localDateString(now);
}
function localDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function dateFilterBounds() {
  if (dateFilter === "all") return { from: null, to: null };
  const now = new Date();
  const to = localDateString(now);
  if (dateFilter === "today") return { from: to, to };
  if (dateFilter === "month") {
    return {
      from: localDateString(new Date(now.getFullYear(), now.getMonth(), 1)),
      to,
    };
  }
  const start = new Date(now);
  const day = start.getDay();
  start.setDate(start.getDate() - day);
  return { from: localDateString(start), to };
}
function fmt(n) {
  return Number(n || 0).toLocaleString("ar-EG");
}
function fmtDate(d) {
  try {
    return new Date(d).toLocaleDateString("ar-EG", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return d;
  }
}
function setText(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  const m = document.getElementById("toast-msg");
  t.style.background = type === "warn" ? "var(--red)" : "var(--green)";
  m.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3000);
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

// ---- Events ----
function bindEvents() {
  document
    .getElementById("btn-new-invoice")
    ?.addEventListener("click", openNew);
  document.getElementById("modal-close")?.addEventListener("click", closeModal);
  document
    .getElementById("modal-cancel")
    ?.addEventListener("click", closeModal);
  document.getElementById("modal-save")?.addEventListener("click", saveInvoice);
  document
    .getElementById("btn-add-item-row")
    ?.addEventListener("click", addItemRow);
  document
    .getElementById("confirm-no")
    ?.addEventListener("click", closeConfirm);
  document.getElementById("confirm-yes")?.addEventListener("click", doDelete);
  document.getElementById("modal-overlay")?.addEventListener("click", (e) => {
    if (e.target === document.getElementById("modal-overlay")) closeModal();
  });
  document.getElementById("confirm-overlay")?.addEventListener("click", (e) => {
    if (e.target === document.getElementById("confirm-overlay")) closeConfirm();
  });

  document.querySelectorAll(".ftab").forEach((btn) =>
    btn.addEventListener("click", function () {
      document
        .querySelectorAll(".ftab")
        .forEach((b) => b.classList.remove("active"));
      this.classList.add("active");
      activeStatus = this.dataset.status;
      currentPage = 1;
      loadSalesPage().catch((e) =>
        showToast("فشل تحميل الفواتير: " + e.message, "warn"),
      );
    }),
  );

  document
    .getElementById("search-input")
    ?.addEventListener("input", function () {
      searchQ = this.value.trim();
      currentPage = 1;
      loadSalesPage().catch((e) =>
        showToast("فشل البحث: " + e.message, "warn"),
      );
    });
  document
    .getElementById("date-filter")
    ?.addEventListener("change", function () {
      dateFilter = this.value;
      currentPage = 1;
      loadSalesPage().catch((e) =>
        showToast("فشل تحميل الفواتير: " + e.message, "warn"),
      );
    });
  document
    .getElementById("customer-filter")
    ?.addEventListener("change", function () {
      customerFilter = this.value;
      currentPage = 1;
      loadSalesPage().catch((e) =>
        showToast("فشل تحميل الفواتير: " + e.message, "warn"),
      );
    });

  document.getElementById("btn-export")?.addEventListener("click", exportCSV);
  document
    .getElementById("btn-print-all")
    ?.addEventListener("click", () => window.print());

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal();
      closeConfirm();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "n") {
      e.preventDefault();
      openNew();
    }
  });
}

function exportCSV() {
  const list = filteredSales();
  const rows = [["رقم الفاتورة", "العميل", "التاريخ", "الإجمالي", "الحالة"]];
  list.forEach((inv) =>
    rows.push([
      inv.orderNumber,
      customerNameOf(inv.contactId),
      inv.date,
      inv.total,
      statusMap[inv.status]?.label || inv.status,
    ]),
  );
  const csvField = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = rows.map((r) => r.map(csvField).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "sales_report.csv";
  a.click();
  URL.revokeObjectURL(url);
  showToast("تم تصدير التقرير");
}
