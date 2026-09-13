/** @format */

// ===================================================
//  INVENTORY — Hyper-Tech ERP
//  المخزن — متصل بالباك إند الحقيقي (/api/v1/inventory) بدل localStorage
// ===================================================

async function apiCall(path, options = {}) {
  return window.HyperTechAuth.request(path, options);
}

// خرائط تحويل بين قيم الفلاتر المختصرة في الواجهة والقيم الحقيقية في قاعدة البيانات
const CAT_TO_DB = {
  raw: "raw_material",
  wip: "wip",
  finished: "finished_good",
};
const CAT_FROM_DB = {
  raw_material: "raw",
  wip: "wip",
  finished_good: "finished",
};

let items = [];
let lastMoveMap = {}; // itemId → أحدث تاريخ حركة، مبني من /api/v1/stock-movements

let activeFilter = "all";
let activeStatus = "all";
let sortBy = "name";
let searchQuery = "";
let currentPage = 1;
let editingId = null;
let isMovementMode = false;
let selectedMoveType = "in";
const PAGE_SIZE = 10;

const moveTypes = { in: "وارد", out: "منصرف", adjust: "تسوية" };

function getStatus(item) {
  const qty = Number(item.qty);
  const min = Number(item.minQty);
  if (qty === 0) return "out";
  if (min > 0 && qty < min * 0.4) return "low";
  return "ok";
}
function statusLabel(s) {
  return (
    s === "ok" ? "كمية كافية"
    : s === "low" ? "قارب على النفاد"
    : "نفد"
  );
}
function catLabel(c) {
  return (
    c === "raw" ? "خامة"
    : c === "wip" ? "تحت التشغيل"
    : "منتج تام"
  );
}

async function loadInitialData() {
  try {
    const [invRes, movesRes] = await Promise.all([
      apiCall("/inventory"),
      apiCall("/stock-movements").catch(() => []),
    ]);
    items = invRes || [];
    lastMoveMap = {};
    (movesRes || []).forEach((m) => {
      const cur = lastMoveMap[m.inventoryItemId];
      if (!cur || new Date(m.createdAt) > new Date(cur))
        lastMoveMap[m.inventoryItemId] = m.createdAt;
    });
    updateKPI();
    renderTable();
    updatePagination(filteredItems().length);
  } catch (e) {
    showToast("فشل تحميل المخزون: " + e.message, "warn");
  }
}

function filteredItems() {
  let data = [...items];
  if (activeFilter !== "all")
    data = data.filter((i) => CAT_FROM_DB[i.category] === activeFilter);
  if (activeStatus !== "all")
    data = data.filter((i) => getStatus(i) === activeStatus);
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    data = data.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        (i.code || "").toLowerCase().includes(q),
    );
  }
  data.sort((a, b) => {
    if (sortBy === "name") return a.name.localeCompare(b.name, "ar");
    if (sortBy === "qty-asc") return Number(a.qty) - Number(b.qty);
    if (sortBy === "qty-desc") return Number(b.qty) - Number(a.qty);
    return 0;
  });
  return data;
}

function fmtLastMove(itemId) {
  const d = lastMoveMap[itemId];
  if (!d) return "—";
  return new Date(d).toLocaleDateString("ar-EG", {
    day: "numeric",
    month: "short",
  });
}

function renderTable() {
  const data = filteredItems();
  const total = data.length;
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageData = data.slice(start, start + PAGE_SIZE);
  const tbody = document.getElementById("inv-tbody");

  if (!pageData.length) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><i class="fa-solid fa-box-open"></i><h4>لا توجد أصناف مطابقة</h4><p>جرّب تغيير الفلتر أو البحث</p></div></td></tr>`;
    document.getElementById("pag-info").textContent = "لا توجد نتائج";
    return;
  }

  tbody.innerHTML = pageData
    .map((item, idx) => {
      const st = getStatus(item);
      const catShort = CAT_FROM_DB[item.category] || "raw";
      const qty = Number(item.qty);
      const min = Number(item.minQty);
      const pct = min > 0 ? Math.min(100, Math.round((qty / min) * 100)) : 100;
      return `
      <tr style="animation-delay:${idx * 0.04}s">
        <td class="cell-code">${escHtml(item.code) || "—"}</td>
        <td><div class="cell-name">${escHtml(item.name)}</div></td>
        <td><span class="cell-cat ${catShort}">${catLabel(catShort)}</span></td>
        <td style="color:var(--text-muted);font-size:12px">${escHtml(item.unit) || "—"}</td>
        <td>
          <span class="cell-qty">${qty.toLocaleString("ar-EG")}</span>
          <span class="cell-unit">${escHtml(item.unit) || ""}</span>
          <div class="qty-bar-wrap"><div class="qty-bar-bg"><div class="qty-bar-fill ${st}" style="width:${pct}%"></div></div></div>
        </td>
        <td style="color:var(--text-muted);font-size:12px">${min.toLocaleString("ar-EG")} ${escHtml(item.unit) || ""}</td>
        <td><span class="status-badge ${st}"><span class="status-dot-sm"></span>${statusLabel(st)}</span></td>
        <td class="cell-date">${fmtLastMove(item.id)}</td>
        <td>
          <div class="row-actions">
            <button class="row-action edit-btn" data-id="${item.id}" title="تعديل"><i class="fa-solid fa-pen"></i></button>
            <button class="row-action move-btn" data-id="${item.id}" title="حركة"><i class="fa-solid fa-plus"></i></button>
            <button class="row-action delete-btn" data-id="${item.id}" title="حذف"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>`;
    })
    .join("");

  const end = Math.min(start + PAGE_SIZE, total);
  document.getElementById("pag-info").textContent =
    `عرض ${total ? start + 1 : 0}–${end} من ${total} صنف`;
}

function updateKPI() {
  document.getElementById("kpi-total").textContent = items.length;
  document.getElementById("kpi-ok").textContent = items.filter(
    (i) => getStatus(i) === "ok",
  ).length;
  document.getElementById("kpi-low").textContent = items.filter(
    (i) => getStatus(i) === "low",
  ).length;
  document.getElementById("kpi-out").textContent = items.filter(
    (i) => getStatus(i) === "out",
  ).length;
  document.querySelectorAll(".filter-tab").forEach((tab) => {
    const f = tab.dataset.filter;
    const count =
      f === "all" ?
        items.length
      : items.filter((i) => CAT_FROM_DB[i.category] === f).length;
    const badge = tab.querySelector(".tab-count");
    if (badge) badge.textContent = count;
  });
}

function updatePagination(total) {
  const pages = Math.ceil(total / PAGE_SIZE) || 1;
  const pagBtns = document.querySelector(".pag-btns");
  if (!pagBtns) return;
  pagBtns.innerHTML = `
    <button class="pag-btn" id="pag-prev" ${currentPage === 1 ? "disabled" : ""}><i class="fa-solid fa-chevron-right"></i></button>
    ${Array.from({ length: pages }, (_, i) => `<button class="pag-btn ${i + 1 === currentPage ? "active" : ""}" data-page="${i + 1}">${i + 1}</button>`).join("")}
    <button class="pag-btn" id="pag-next" ${currentPage === pages ? "disabled" : ""}><i class="fa-solid fa-chevron-left"></i></button>
  `;
  pagBtns.querySelector("#pag-prev")?.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--;
      renderTable();
      updatePagination(filteredItems().length);
    }
  });
  pagBtns.querySelector("#pag-next")?.addEventListener("click", () => {
    if (currentPage < pages) {
      currentPage++;
      renderTable();
      updatePagination(filteredItems().length);
    }
  });
  pagBtns.querySelectorAll("[data-page]").forEach((btn) =>
    btn.addEventListener("click", () => {
      currentPage = +btn.dataset.page;
      renderTable();
      updatePagination(filteredItems().length);
    }),
  );
}

// ===== MODAL =====
const overlay = document.getElementById("modal-overlay");
const modalTitle = overlay.querySelector(".modal-head h3");
const f = (name) => overlay.querySelector(`[data-field="${name}"]`);
const itemSection = document.getElementById("modal-item-fields");
const moveSection = document.getElementById("modal-move-fields");

function setModalMode(mode) {
  isMovementMode = mode === "movement";
  if (itemSection) itemSection.style.display = isMovementMode ? "none" : "flex";
  if (moveSection) moveSection.style.display = isMovementMode ? "flex" : "none";
}

function openCreateModal() {
  editingId = null;
  setModalMode("item");
  modalTitle.textContent = "صنف جديد";
  document.getElementById("modal-save").innerHTML =
    '<i class="fa-solid fa-check"></i> إنشاء الصنف';
  f("name").value = f("code").value = f("unit").value = f("notes").value = "";
  f("cat").selectedIndex = 0;
  f("qty").value = "";
  f("min").value = "";
  f("unitPrice").value = "";
  overlay.classList.add("open");
  document.body.style.overflow = "hidden";
}

function openEditModal(id) {
  const item = items.find((i) => i.id === id);
  if (!item) return;
  editingId = id;
  setModalMode("item");
  modalTitle.textContent = "تعديل صنف";
  document.getElementById("modal-save").innerHTML =
    '<i class="fa-solid fa-check"></i> حفظ التعديلات';
  f("name").value = item.name;
  f("code").value = item.code || "";
  f("cat").value = CAT_FROM_DB[item.category] || "raw";
  f("unit").value = item.unit || "";
  f("qty").value = item.qty;
  f("min").value = item.minQty;
  f("unitPrice").value = item.unitPrice;
  f("notes").value = "";
  overlay.classList.add("open");
  document.body.style.overflow = "hidden";
}

function openMovementModal(id) {
  const item = items.find((i) => i.id === id);
  if (!item) return;
  editingId = id;
  setModalMode("movement");
  modalTitle.textContent = "تسجيل حركة مخزون";
  document.getElementById("modal-save").innerHTML =
    '<i class="fa-solid fa-check"></i> حفظ الحركة';
  f("move-item").value = item.name;
  f("move-qty").value = "";
  f("move-notes").value = "";
  // ✅ إرجاع نوع الحركة والليبل لوضعهم الافتراضي (وارد) عند كل فتح جديد
  selectedMoveType = "in";
  document
    .querySelectorAll(".move-type")
    .forEach((b) => b.classList.toggle("active", b.dataset.type === "in"));
  const label = document.getElementById("move-qty-label");
  if (label) label.textContent = "الكمية الواردة";
  overlay.classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeModal() {
  overlay.classList.remove("open");
  document.body.style.overflow = "";
}

async function saveItem() {
  const saveBtn = document.getElementById("modal-save");
  if (isMovementMode) {
    const item = items.find((i) => i.id === editingId);
    if (!item) return;
    const qty = parseFloat(f("move-qty").value) || 0;
    const notes = f("move-notes").value.trim();
    if (qty <= 0) {
      showToast("أدخل كمية أكبر من صفر", "warn");
      return;
    }
    saveBtn.disabled = true;
    try {
      if (selectedMoveType === "adjust") {
        // التسوية = فرق مباشر في الكمية عن طريق تعديل الصنف نفسه، مش حركة in/out
        await apiCall(`/inventory/${item.id}`, {
          method: "PATCH",
          body: JSON.stringify({ qty: String(qty) }),
        });
      } else {
        await apiCall("/stock-movements", {
          method: "POST",
          body: JSON.stringify({
            inventoryItemId: item.id,
            movementType: selectedMoveType,
            qty: String(qty),
            referenceType: "adjustment",
            unitPrice: item.unitPrice,
            notes: notes || null,
          }),
        });
      }
      await loadInitialData();
      closeModal();
      showToast(
        `تم تسجيل ${moveTypes[selectedMoveType]} ${qty} ${item.unit || ""}`,
      );
    } catch (e) {
      showToast("فشل تسجيل الحركة: " + e.message, "warn");
    } finally {
      saveBtn.disabled = false;
    }
    return;
  }

  const name = f("name").value.trim();
  const code = f("code").value.trim() || null;
  const cat = CAT_TO_DB[f("cat").value] || "raw_material";
  const unit = f("unit").value.trim() || null;
  const qty = parseFloat(f("qty").value) || 0;
  const min = parseFloat(f("min").value) || 0;
  const unitPrice = parseFloat(f("unitPrice").value) || 0;
  if (!name) {
    showToast("من فضلك أدخل اسم الصنف", "warn");
    return;
  }

  const data = {
    name,
    code,
    category: cat,
    unit,
    qty: String(qty),
    minQty: String(min),
    unitPrice: String(unitPrice),
  };
  saveBtn.disabled = true;
  try {
    if (editingId) {
      await apiCall(`/inventory/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
      showToast("تم حفظ التعديلات بنجاح");
    } else {
      await apiCall("/inventory", {
        method: "POST",
        body: JSON.stringify(data),
      });
      showToast("تم إنشاء الصنف بنجاح");
    }
    await loadInitialData();
    closeModal();
  } catch (e) {
    showToast("فشل الحفظ: " + e.message, "warn");
  } finally {
    saveBtn.disabled = false;
  }
}

// ===== CONFIRM DELETE =====
const confirmOverlay = document.getElementById("confirm-overlay");
function confirmDelete(id, name) {
  document.getElementById("confirm-name").textContent = name;
  document.getElementById("confirm-yes").onclick = async () => {
    try {
      await apiCall(`/inventory/${id}`, { method: "DELETE" });
      await loadInitialData();
      showToast("تم حذف الصنف بنجاح");
    } catch (e) {
      showToast("فشل الحذف: " + e.message, "warn");
    } finally {
      closeConfirm();
    }
  };
  confirmOverlay?.classList.add("open");
  document.body.style.overflow = "hidden";
}
function closeConfirm() {
  confirmOverlay?.classList.remove("open");
  document.body.style.overflow = "";
}

// ===== EVENTS =====
document
  .getElementById("btn-add-item")
  ?.addEventListener("click", openCreateModal);
document.getElementById("modal-close")?.addEventListener("click", closeModal);
document.getElementById("modal-cancel")?.addEventListener("click", closeModal);
document.getElementById("modal-save")?.addEventListener("click", saveItem);
overlay?.addEventListener("click", (e) => {
  if (e.target === overlay) closeModal();
});

document.getElementById("confirm-no")?.addEventListener("click", closeConfirm);
confirmOverlay?.addEventListener("click", (e) => {
  if (e.target === confirmOverlay) closeConfirm();
});

document.querySelectorAll(".move-type").forEach((btn) => {
  btn.addEventListener("click", () => {
    document
      .querySelectorAll(".move-type")
      .forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    selectedMoveType = btn.dataset.type;
    // ✅ توضيح للمستخدم: الكمية هنا "فرق" بيتضاف/يتخصم من الرصيد
    // الحالي (in/out)، أو "الرصيد الصحيح الجديد" في حالة التسوية —
    // مش نفس المعنى، فلازم الليبل يوضح ده بدل ما يفضل عام غامض.
    const label = document.getElementById("move-qty-label");
    if (label) {
      label.textContent =
        selectedMoveType === "in" ? "الكمية الواردة"
        : selectedMoveType === "out" ? "الكمية المنصرفة"
        : "الرصيد الصحيح الجديد";
    }
  });
});

document.getElementById("filter-tabs")?.addEventListener("click", (e) => {
  const tab = e.target.closest(".filter-tab");
  if (!tab) return;
  document
    .querySelectorAll(".filter-tab")
    .forEach((t) => t.classList.remove("active"));
  tab.classList.add("active");
  activeFilter = tab.dataset.filter;
  currentPage = 1;
  renderTable();
  updatePagination(filteredItems().length);
});

document.getElementById("status-filter")?.addEventListener("change", (e) => {
  activeStatus = e.target.value;
  currentPage = 1;
  renderTable();
  updatePagination(filteredItems().length);
});
document.getElementById("sort-select")?.addEventListener("change", (e) => {
  sortBy = e.target.value;
  renderTable();
});
document.getElementById("search-input")?.addEventListener("input", (e) => {
  searchQuery = e.target.value.trim();
  currentPage = 1;
  renderTable();
  updatePagination(filteredItems().length);
});

document.getElementById("inv-tbody")?.addEventListener("click", (e) => {
  const btn = e.target.closest(".row-action");
  if (!btn) return;
  const id = Number(btn.dataset.id);
  const item = items.find((i) => i.id === id);
  if (!item) return;
  if (btn.classList.contains("edit-btn")) openEditModal(id);
  else if (btn.classList.contains("move-btn")) openMovementModal(id);
  else if (btn.classList.contains("delete-btn")) confirmDelete(id, item.name);
});

document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", function (e) {
    if (this.getAttribute("href") === "#") e.preventDefault();
    document
      .querySelectorAll(".nav-item")
      .forEach((i) => i.classList.remove("active"));
    this.classList.add("active");
  });
});

// ===== TOAST =====
function showToast(msg, type = "success") {
  const toast = document.getElementById("toast");
  document.getElementById("toast-msg").textContent = msg;
  toast.style.background = type === "warn" ? "var(--red)" : "var(--green)";
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
}

// ===== CLOCK =====
function updateTime() {
  document.getElementById("last-update").textContent =
    new Date().toLocaleTimeString("ar-EG", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
}
updateTime();
setInterval(updateTime, 1000);

// ===== INIT =====
loadInitialData();
