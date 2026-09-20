/** @format */

// ===================================================
//  BILL OF MATERIALS — Hyper-Tech ERP
//  وصفات التصنيع — متصلة بالباك إند الحقيقي بالكامل
// ===================================================

async function api(path, options = {}) {
  return window.HyperTechAuth.request(path, options);
}

let recipes = []; // من GET /bom
let allBomItems = []; // من GET /bom/items/all — كل مكوّنات كل الوصفات مرة واحدة
let inventoryItems = []; // من GET /inventory — لقوايم "اختيار من المخزون"
let sortMode = "name";
let searchQuery = "";
let editingId = null; // recipeId الحالي وقت التعديل، null = وصفة جديدة
let currentItems = []; // مكوّنات الوصفة المفتوحة في نافذة الإنشاء/التعديل

// ===================================================
//  Helpers
// ===================================================
function fmtNum(n) {
  const num = parseFloat(n);
  if (!isFinite(num)) return "0";
  return num.toLocaleString("ar-EG", { maximumFractionDigits: 2 });
}
function recipeCost(recipe) {
  if (!recipe.items) return Number(recipe.unitCost) || 0;
  return recipe.items.reduce(
    (s, i) => s + Number(i.qty) * Number(i.unitCost || 0),
    0,
  );
}

// ===================================================
//  تحميل البيانات الحقيقية
// ===================================================
async function loadRecipes() {
  try {
    recipes = await api("/bom");
    // ✅ إصلاح: GET /bom (القائمة) بيرجّع الوصفات من غير مكوّناتها خالص —
    // ده كان بيخلي "إجمالي المكونات" و"تكلفة الوحدة" في الكروت والإحصائيات
    // تفضل صفر دايمًا حتى لو فعليًا فيه مكوّنات مسجّلة، لأن recipe.items
    // كانت undefined على طول في القائمة (بتظهر بس عند فتح تفاصيل وصفة واحدة).
    // بنجيب كل المكوّنات مرة واحدة ونربطها يدوي بكل وصفة.
    allBomItems = await api("/bom/items/all").catch(() => []);
    const itemsByRecipe = {};
    allBomItems.forEach((it) => {
      if (!itemsByRecipe[it.recipeId]) itemsByRecipe[it.recipeId] = [];
      itemsByRecipe[it.recipeId].push(it);
    });
    recipes.forEach((r) => (r.items = itemsByRecipe[r.id] || []));
  } catch (e) {
    showToast("تعذر تحميل وصفات التصنيع: " + e.message, true);
    recipes = [];
  }
  updateKPIs();
  renderGrid();
}
async function loadInventoryOptions() {
  try {
    inventoryItems = await api("/inventory");
  } catch {
    inventoryItems = [];
  }
}
function showToast(msg, isError) {
  const el = document.getElementById("toast");
  document.getElementById("toast-msg").textContent = msg;
  el.style.background = isError ? "var(--red)" : "";
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 3000);
}

// ===================================================
//  KPIs
// ===================================================
function updateKPIs() {
  const costs = recipes.map(recipeCost);
  document.getElementById("kpi-products").textContent = recipes.length;
  document.getElementById("kpi-components").textContent = recipes.reduce(
    (s, r) => s + (r.items ? r.items.length : 0),
    0,
  );
  document.getElementById("kpi-cheapest").textContent =
    costs.length ? fmtNum(Math.min(...costs)) : "—";
  document.getElementById("kpi-expensive").textContent =
    costs.length ? fmtNum(Math.max(...costs)) : "—";
}

// ===================================================
//  Build Card
// ===================================================
function buildCard(recipe) {
  const cost = recipeCost(recipe);
  const items = recipe.items || [];
  const topItems = items.slice(0, 3);
  const extra = items.length - 3;

  const card = document.createElement("div");
  card.className = "bom-card";
  card.dataset.id = recipe.id;

  card.innerHTML = `
    <div class="bom-card-head">
      <div class="bom-card-icon strip"><i class="fa-solid fa-diagram-project"></i></div>
      <div class="bom-card-title">${escHtml(recipe.productName)}</div>
      ${recipe.productCode ? `<span class="bom-card-version">${escHtml(recipe.productCode)}</span>` : ""}
      <span class="bom-card-status ${recipe.isActive === false ? "inactive" : ""}">
        ${recipe.isActive === false ? "متوقف" : "نشط"}
      </span>
      <span class="bom-card-foundation-link ${recipe.foundationItemId ? "linked" : "unlinked"}" title="${recipe.foundationItemId ? "متوصّل بصفحة البيانات الأساسية" : "لسه مش متوصّل بصفحة البيانات الأساسية"}">
        <i class="fa-solid ${recipe.foundationItemId ? "fa-link" : "fa-link-slash"}"></i>
        ${recipe.foundationItemId ? "متوصّل" : "غير متوصّل"}
      </span>
    </div>
    <div class="bom-card-stats">
      <div class="bom-stat">
        <span class="bom-stat-val">${items.length}</span>
        <span class="bom-stat-label">مكوّن</span>
      </div>
      <div class="bom-stat">
        <span class="bom-stat-val" style="color:var(--green)">${fmtNum(cost)}</span>
        <span class="bom-stat-label">تكلفة الوحدة (جنيه)</span>
      </div>
    </div>
    <div class="bom-card-components">
      <div class="bom-comp-title">أبرز المكونات</div>
      <div class="bom-comp-pills">
        ${topItems.map((c) => `<span class="bom-pill">${escHtml(c.materialName)}</span>`).join("")}
        ${extra > 0 ? `<span class="bom-pill more">+${extra} أخرى</span>` : ""}
      </div>
    </div>
    <div class="card-actions">
      <button class="card-action-btn details-btn" data-id="${recipe.id}">
        <i class="fa-solid fa-eye"></i> التفاصيل
      </button>
      <button class="card-action-btn edit-btn" data-id="${recipe.id}">
        <i class="fa-solid fa-pen"></i> تعديل
      </button>
      <button class="card-action-btn toggle-active-btn" data-id="${recipe.id}" data-active="${recipe.isActive !== false}">
        <i class="fa-solid ${recipe.isActive === false ? "fa-play" : "fa-pause"}"></i>
        ${recipe.isActive === false ? "تفعيل" : "إيقاف"}
      </button>
    </div>`;
  return card;
}

function renderGrid() {
  const grid = document.getElementById("bom-grid");
  if (!grid) return;

  let list = recipes.filter(
    (r) =>
      !searchQuery ||
      r.productName.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  if (sortMode === "name")
    list = [...list].sort((a, b) =>
      a.productName.localeCompare(b.productName, "ar"),
    );
  else if (sortMode === "cost-asc")
    list = [...list].sort((a, b) => recipeCost(a) - recipeCost(b));
  else if (sortMode === "cost-desc")
    list = [...list].sort((a, b) => recipeCost(b) - recipeCost(a));
  else if (sortMode === "components")
    list = [...list].sort(
      (a, b) => (b.items?.length || 0) - (a.items?.length || 0),
    );

  grid.innerHTML = "";
  if (!list.length) {
    grid.innerHTML = `<div class="bom-empty"><i class="fa-solid fa-diagram-project"></i><p>لا توجد وصفات تصنيع بعد — دوس "وصفة جديدة" عشان تضيف أول وصفة.</p></div>`;
    return;
  }
  list.forEach((r) => grid.appendChild(buildCard(r)));

  grid
    .querySelectorAll(".details-btn")
    .forEach((btn) =>
      btn.addEventListener("click", () => openDetail(Number(btn.dataset.id))),
    );
  grid
    .querySelectorAll(".edit-btn")
    .forEach((btn) =>
      btn.addEventListener("click", () =>
        openEditModal(Number(btn.dataset.id)),
      ),
    );
  grid.querySelectorAll(".toggle-active-btn").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const recipe = recipes.find((item) => item.id === Number(btn.dataset.id));
      if (!recipe) return;
      btn.disabled = true;
      try {
        await api(`/bom/${recipe.id}`, {
          method: "PATCH",
          body: JSON.stringify({ isActive: recipe.isActive === false }),
        });
        showToast(recipe.isActive === false ? "تم تفعيل المنتج" : "تم إيقاف المنتج");
        await loadRecipes();
      } catch (error) {
        showToast("تعذر تغيير حالة المنتج: " + error.message, true);
        btn.disabled = false;
      }
    }),
  );
}

// ===================================================
//  تفاصيل الوصفة
// ===================================================
async function openDetail(id) {
  let recipe;
  try {
    recipe = await api(`/bom/${id}`);
  } catch (e) {
    showToast("تعذر تحميل تفاصيل الوصفة: " + e.message, true);
    return;
  }
  const cost = recipeCost(recipe);

  document.getElementById("dp-title").textContent = recipe.productName;
  document.getElementById("dp-sub").textContent =
    recipe.productCode ? `كود: ${recipe.productCode}` : `وصفة رقم ${recipe.id}`;

  const tableRows = (recipe.items || [])
    .map((c) => {
      const lineTotal = Number(c.qty) * Number(c.unitCost || 0);
      const sourceBadge =
        c.linked ?
          '<span class="ok-tag" style="color:var(--green);font-size:11px">مرتبط بالمخزون</span>'
        : c.available ?
          '<span style="color:var(--text-muted);font-size:11px">يدوي — متوفر بالمخزون</span>'
        : '<span style="color:#ef4444;font-size:11px">غير متوفر حاليًا</span>';
      return `<tr>
      <td class="td-name">${escHtml(c.materialName)}<br/>${sourceBadge}</td>
      <td class="td-unit">${escHtml(c.unit)}</td>
      <td class="td-qty">${escHtml(c.qty)}</td>
      <td class="td-cost">${fmtNum(c.unitCost)}</td>
      <td class="td-cost">${fmtNum(lineTotal)}</td>
    </tr>`;
    })
    .join("");

  document.getElementById("detail-body").innerHTML = `
    <div class="detail-section">
      <div class="detail-section-title">معلومات الوصفة</div>
      <div class="detail-row"><span class="detail-row-label">الكود</span><span class="detail-row-val">${escHtml(recipe.productCode) || "—"}</span></div>
      <div class="detail-row"><span class="detail-row-label">الكمية الناتجة لكل دفعة</span><span class="detail-row-val">${escHtml(recipe.outputQty)}</span></div>
      <div class="detail-row"><span class="detail-row-label">عدد المكونات</span><span class="detail-row-val">${(recipe.items || []).length} مكوّن</span></div>
    </div>
    <div class="detail-section">
      <div class="detail-section-title">تكلفة الوحدة</div>
      <div style="display:flex;align-items:center;justify-content:center;padding:12px 0">
        <span class="cost-badge"><i class="fa-solid fa-tag"></i> ${fmtNum(cost)} جنيه / وحدة</span>
      </div>
    </div>
    <div class="detail-section">
      <div class="detail-section-title">قائمة المكونات (BOM)</div>
      <div class="bom-table-wrap">
        <table class="bom-table">
          <thead><tr>
            <th>المكوّن</th>
            <th style="text-align:center">الوحدة</th>
            <th style="text-align:center">الكمية</th>
            <th style="text-align:center">سعر الوحدة</th>
            <th style="text-align:center">الإجمالي</th>
          </tr></thead>
          <tbody>${tableRows}</tbody>
          <tfoot><tr>
            <td colspan="4">إجمالي تكلفة الوحدة</td>
            <td class="bom-total-cost" style="text-align:center">${fmtNum(cost)} جنيه</td>
          </tr></tfoot>
        </table>
      </div>
    </div>
    <div class="detail-actions">
      <button class="btn-primary" id="dp-edit-btn"><i class="fa-solid fa-pen"></i> تعديل الوصفة</button>
      <button class="btn-danger" id="dp-delete-btn"><i class="fa-solid fa-trash"></i> حذف</button>
    </div>`;

  document.getElementById("dp-edit-btn").addEventListener("click", () => {
    closeDetail();
    openEditModal(id);
  });
  document
    .getElementById("dp-delete-btn")
    .addEventListener("click", () => confirmDelete(id, recipe.productName));

  document.getElementById("detail-overlay").classList.add("open");
  document.body.style.overflow = "hidden";
}
function closeDetail() {
  document.getElementById("detail-overlay").classList.remove("open");
  document.body.style.overflow = "";
}

// ===================================================
//  حذف
// ===================================================
let deletingId = null;
function confirmDelete(id, name) {
  deletingId = id;
  const overlay = document.getElementById("confirm-overlay");
  document.getElementById("confirm-name").textContent = name;
  overlay.classList.add("open");
}
async function doDelete() {
  if (!deletingId) return;
  try {
    await api(`/bom/${deletingId}`, { method: "DELETE" });
    showToast("تم نقل الوصفة لسلة المهملات");
    closeDetail();
    document.getElementById("confirm-overlay")?.classList.remove("open");
    await loadRecipes();
  } catch (e) {
    showToast("تعذر الحذف: " + e.message, true);
  }
  deletingId = null;
}

// ===================================================
//  نافذة الإنشاء/التعديل — مكوّنات مرتبطة بالمخزون أو يدوية
// ===================================================
const modalOverlay = document.getElementById("modal-overlay");
const fName = document.getElementById("modal-name");
const fCode = document.getElementById("modal-code");
const fFoundationItem = document.getElementById("modal-foundation-item");
const fFoundationLegacyNote = document.getElementById("modal-foundation-legacy-note");
const fOutputQty = document.getElementById("modal-output-qty");
const fReferencePrice = document.getElementById("modal-reference-price");
const fExpectedDays = document.getElementById("modal-expected-days");
const fNotes = document.getElementById("modal-notes");
const componentsRows = document.getElementById("components-rows");
const componentsEmpty = document.getElementById("components-empty");
const componentsTable = document.getElementById("components-table");

// ===================================================
//  صفحة البيانات الأساسية — قايمة "المنتجات التامة" لاختيار المنتج بتاع الوصفة
// ===================================================
let foundationFinishedGoods = []; // من GET /foundation/items، مفلترة على النوع + النشط
let foundationItemsLoaded = false;

async function loadFoundationFinishedGoods() {
  if (foundationItemsLoaded) return;
  try {
    const all = await api("/foundation/items");
    foundationFinishedGoods = (all || []).filter(
      (it) => it.itemType === "finished_good" && it.active,
    );
    foundationItemsLoaded = true;
  } catch (e) {
    // ✅ لو المستخدم مالوش صلاحية يشوف صفحة البيانات الأساسية أصلاً، منسيبش
    // الفورم يقفل — بس القايمة هتفضل فاضية وهيبان له رابط صفحة البيانات الأساسية
    foundationFinishedGoods = [];
  }
  renderFoundationItemOptions();
}

function renderFoundationItemOptions(selectedId) {
  fFoundationItem.innerHTML =
    '<option value="">-- اختار المنتج --</option>' +
    foundationFinishedGoods
      .map(
        (it) =>
          `<option value="${it.id}">${escHtml(it.name)} (${escHtml(it.code)})</option>`,
      )
      .join("");
  if (selectedId) fFoundationItem.value = String(selectedId);
}

function applySelectedFoundationItem() {
  const id = fFoundationItem.value;
  const item = foundationFinishedGoods.find((it) => String(it.id) === id);
  if (item) {
    fName.value = item.name;
    fCode.value = item.code;
    fFoundationLegacyNote.style.display = "none";
  } else {
    fName.value = "";
    fCode.value = "";
  }
}
fFoundationItem?.addEventListener("change", applySelectedFoundationItem);

// ===================================================
//  صور المنتج (رئيسية + فرعية) — Phase 2
//  الصور بتتحفظ كـ base64 data URL في قاعدة البيانات (شوف
//  src/db/schema/product-images.ts لسبب الاختيار ده).
// ===================================================
const MAX_IMAGE_BYTES_CLIENT = 2 * 1024 * 1024; // نفس الحد الموجود في الباك اند
const imagesSection = document.getElementById("images-section");
const imagesLockedNote = document.getElementById("images-locked-note");
const imagePrimaryPreview = document.getElementById("image-primary-preview");
const imageSecondaryGallery = document.getElementById("image-secondary-gallery");
const inputPrimaryImage = document.getElementById("input-primary-image");
const inputSecondaryImage = document.getElementById("input-secondary-image");
const btnRemovePrimaryImage = document.getElementById("btn-remove-primary-image");

let currentImages = []; // [{ id, role, imageData, sortOrder }]

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("تعذّر قراءة الصورة"));
    reader.readAsDataURL(file);
  });
}

function validateImageFile(file) {
  const okTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
  if (!okTypes.includes(file.type)) {
    showToast("لازم تكون صورة بصيغة png أو jpg أو webp", true);
    return false;
  }
  if (file.size > MAX_IMAGE_BYTES_CLIENT) {
    showToast("حجم الصورة كبير أوي — الحد الأقصى 2 ميجا", true);
    return false;
  }
  return true;
}

function renderImagesSection() {
  // الصور محتاجة وصفة محفوظة الأول عشان يكون لها id تتربط بيه
  const unlocked = Boolean(editingId);
  imagesSection.style.display = unlocked ? "block" : "none";
  imagesLockedNote.style.display = unlocked ? "none" : "block";
  if (!unlocked) return;

  const primary = currentImages.find((img) => img.role === "primary");
  if (primary) {
    imagePrimaryPreview.innerHTML = `<img src="${primary.imageData}" alt="الصورة الرئيسية للمنتج" />`;
    btnRemovePrimaryImage.style.display = "inline-flex";
    btnRemovePrimaryImage.dataset.imageId = String(primary.id);
  } else {
    imagePrimaryPreview.innerHTML = `<i class="fa-solid fa-image"></i><span>لسه مفيش صورة رئيسية</span>`;
    btnRemovePrimaryImage.style.display = "none";
    delete btnRemovePrimaryImage.dataset.imageId;
  }

  const secondaries = currentImages
    .filter((img) => img.role === "secondary")
    .sort((a, b) => a.sortOrder - b.sortOrder);
  if (!secondaries.length) {
    imageSecondaryGallery.innerHTML = `<div class="image-gallery-empty">مفيش صور فرعية لسه</div>`;
    return;
  }
  imageSecondaryGallery.innerHTML = secondaries
    .map(
      (img, i) => `
      <div class="image-thumb">
        <img src="${img.imageData}" alt="صورة فرعية للمنتج" />
        <div class="image-thumb-actions">
          <button type="button" title="تحريك لليمين" ${i === 0 ? "disabled" : ""} onclick="moveSecondaryImage(${img.id}, -1)">
            <i class="fa-solid fa-arrow-right"></i>
          </button>
          <button type="button" title="تحريك لليسار" ${i === secondaries.length - 1 ? "disabled" : ""} onclick="moveSecondaryImage(${img.id}, 1)">
            <i class="fa-solid fa-arrow-left"></i>
          </button>
          <button type="button" class="danger" title="حذف الصورة" onclick="deleteProductImage(${img.id})">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>`,
    )
    .join("");
}

async function reloadCurrentImages() {
  if (!editingId) return;
  try {
    const recipe = await api(`/bom/${editingId}`);
    currentImages = recipe.images || [];
  } catch (e) {
    currentImages = [];
  }
  renderImagesSection();
}

inputPrimaryImage?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = ""; // نفضّي الحقل عشان يقدر يرفع نفس الصورة تاني لو حب
  if (!file || !validateImageFile(file)) return;
  if (!editingId) return;
  try {
    const imageData = await readFileAsDataUrl(file);
    await api(`/bom/${editingId}/images/primary`, {
      method: "POST",
      body: JSON.stringify({ imageData }),
    });
    showToast("تم حفظ الصورة الرئيسية");
    await reloadCurrentImages();
  } catch (err) {
    showToast("تعذّر رفع الصورة: " + err.message, true);
  }
});

inputSecondaryImage?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file || !validateImageFile(file)) return;
  if (!editingId) return;
  try {
    const imageData = await readFileAsDataUrl(file);
    await api(`/bom/${editingId}/images/secondary`, {
      method: "POST",
      body: JSON.stringify({ imageData }),
    });
    showToast("تمت إضافة الصورة");
    await reloadCurrentImages();
  } catch (err) {
    showToast("تعذّر رفع الصورة: " + err.message, true);
  }
});

btnRemovePrimaryImage?.addEventListener("click", () => {
  const imageId = btnRemovePrimaryImage.dataset.imageId;
  if (imageId) deleteProductImage(Number(imageId));
});

async function deleteProductImage(imageId) {
  if (!editingId) return;
  try {
    await api(`/bom/${editingId}/images/${imageId}`, { method: "DELETE" });
    showToast("تم حذف الصورة");
    await reloadCurrentImages();
  } catch (err) {
    showToast("تعذّر حذف الصورة: " + err.message, true);
  }
}
window.deleteProductImage = deleteProductImage;

async function moveSecondaryImage(imageId, direction) {
  const secondaries = currentImages
    .filter((img) => img.role === "secondary")
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const index = secondaries.findIndex((img) => img.id === imageId);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= secondaries.length) return;
  // نبدّل مكان الصورتين ونبعت الترتيب الجديد كامل
  [secondaries[index], secondaries[target]] = [
    secondaries[target],
    secondaries[index],
  ];
  try {
    await api(`/bom/${editingId}/images/reorder`, {
      method: "PATCH",
      body: JSON.stringify({ order: secondaries.map((img) => img.id) }),
    });
    await reloadCurrentImages();
  } catch (err) {
    showToast("تعذّر تغيير الترتيب: " + err.message, true);
  }
}
window.moveSecondaryImage = moveSecondaryImage;

function updateComponentsEmptyState() {
  const hasRows = currentItems.length > 0;
  componentsEmpty.style.display = hasRows ? "none" : "flex";
  componentsTable.style.display = hasRows ? "block" : "none";
}

function inventoryOptionsHtml(selectedId) {
  return (
    '<option value="">اختر من المخزون...</option>' +
    inventoryItems
      .map(
        (i) =>
          `<option value="${i.id}" ${Number(selectedId) === i.id ? "selected" : ""}>${escHtml(i.name)}</option>`,
      )
      .join("")
  );
}

function renderComponentRows() {
  componentsRows.innerHTML = "";
  currentItems.forEach((item, idx) => {
    const row = document.createElement("div");
    row.className = "components-row";
    const isLinked = !!item.inventoryItemId;
    const sourceIsInventory = isLinked || !!item._pendingInventoryPick;
    const availabilityBadge =
      item.id && !isLinked ?
        item.available ?
          '<span style="color:var(--green);font-size:10px">متوفر</span>'
        : '<span style="color:#ef4444;font-size:10px">غير متوفر حاليًا</span>'
      : "";

    row.innerHTML = `
      <div>
        ${
          isLinked ?
            `<div style="font-size:12px;color:var(--text-muted)">من المخزون</div><div>${escHtml(item.materialName)}</div>`
          : `<input type="text" class="form-input comp-name" placeholder="اسم المكوّن" value="${escHtml(item.materialName)}" />${availabilityBadge}`
        }
      </div>
      <select class="form-input comp-source">
        <option value="manual" ${!sourceIsInventory ? "selected" : ""}>يدوي</option>
        <option value="inventory" ${sourceIsInventory ? "selected" : ""}>من المخزون</option>
      </select>
      <input type="text" class="form-input comp-unit" placeholder="الوحدة" value="${escHtml(item.unit)}" ${isLinked ? "readonly" : ""} />
      <input type="number" class="form-input comp-qty" placeholder="0" min="0" step="0.001" value="${escHtml(item.qty)}" />
      <input type="number" class="form-input comp-cost" placeholder="0" min="0" step="0.01" value="${escHtml(item.unitCost)}" />
      <button type="button" class="btn-remove-component" title="حذف المكوّن"><i class="fa-solid fa-trash"></i></button>
    `;

    // Phase 3: صف إضافي تحت كل مكوّن — "يظهر للعميل؟" + صورة اختيارية.
    // بيتحط في صف منفصل عشان مايزحمش أعمدة الجدول الأساسية.
    const featuredRow = document.createElement("div");
    featuredRow.className = "component-featured-row";
    featuredRow.innerHTML = `
      <label class="component-featured-toggle">
        <input type="checkbox" class="comp-featured" ${item.isFeatured ? "checked" : ""} />
        يظهر للعميل في "أهم مكونات هذا المنتج"
      </label>
      <div class="component-featured-image" ${item.isFeatured ? "" : 'style="display:none"'}>
        ${
          item.featuredImageData
            ? `<img src="${item.featuredImageData}" alt="صورة المكوّن" class="comp-featured-thumb" />
               <button type="button" class="btn-remove-comp-image" title="حذف صورة المكوّن"><i class="fa-solid fa-trash"></i></button>`
            : `<label class="btn-upload-image btn-upload-image-sm">
                 <i class="fa-solid fa-image"></i> صورة للمكوّن (اختياري)
                 <input type="file" accept="image/png,image/jpeg,image/webp" class="comp-featured-file" hidden />
               </label>`
        }
      </div>
    `;

    // ✅ لو اختار "من المخزون"، تتحول الخانة الأولى لقايمة اختيار حقيقية
    const sourceSelect = row.querySelector(".comp-source");
    sourceSelect.addEventListener("change", () => {
      currentItems[idx].inventoryItemId = null;
      currentItems[idx].materialName = "";
      if (sourceSelect.value === "inventory")
        currentItems[idx]._pendingInventoryPick = true;
      else currentItems[idx]._pendingInventoryPick = false;
      renderComponentRows();
    });

    if (item._pendingInventoryPick) {
      const nameCell = row.children[0];
      nameCell.innerHTML = `<select class="form-input comp-inv-select">${inventoryOptionsHtml(item.inventoryItemId)}</select>`;
      nameCell
        .querySelector(".comp-inv-select")
        .addEventListener("change", (e) => {
          const inv = inventoryItems.find(
            (i) => i.id === Number(e.target.value),
          );
          if (inv) {
            currentItems[idx].inventoryItemId = inv.id;
            currentItems[idx].materialName = inv.name;
            currentItems[idx].unit = inv.unit || "";
            currentItems[idx]._pendingInventoryPick = false;
            renderComponentRows();
          }
        });
    } else if (!isLinked) {
      row
        .querySelector(".comp-name")
        ?.addEventListener(
          "input",
          (e) => (currentItems[idx].materialName = e.target.value),
        );
    }

    row
      .querySelector(".comp-unit")
      .addEventListener(
        "input",
        (e) => (currentItems[idx].unit = e.target.value),
      );
    row
      .querySelector(".comp-qty")
      .addEventListener(
        "input",
        (e) => (currentItems[idx].qty = e.target.value),
      );
    row
      .querySelector(".comp-cost")
      .addEventListener(
        "input",
        (e) => (currentItems[idx].unitCost = e.target.value),
      );
    row.querySelector(".btn-remove-component").addEventListener("click", () => {
      currentItems.splice(idx, 1);
      renderComponentRows();
    });

    // Phase 3: تشغيل/إيقاف ظهور المكوّن للعميل + إدارة صورته
    featuredRow
      .querySelector(".comp-featured")
      .addEventListener("change", (e) => {
        currentItems[idx].isFeatured = e.target.checked;
        // لو وقّف الظهور، بنشيل الصورة كمان عشان مانسيبش صورة متعلقة بمكوّن
        // مش ظاهر أصلاً
        if (!e.target.checked) currentItems[idx].featuredImageData = null;
        renderComponentRows();
      });

    featuredRow
      .querySelector(".comp-featured-file")
      ?.addEventListener("change", async (e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file || !validateImageFile(file)) return;
        try {
          currentItems[idx].featuredImageData = await readFileAsDataUrl(file);
          renderComponentRows();
        } catch (err) {
          showToast("تعذّر قراءة الصورة: " + err.message, true);
        }
      });

    featuredRow
      .querySelector(".btn-remove-comp-image")
      ?.addEventListener("click", () => {
        currentItems[idx].featuredImageData = null;
        renderComponentRows();
      });

    componentsRows.appendChild(row);
    componentsRows.appendChild(featuredRow);
  });
  updateComponentsEmptyState();
}

function addComponentRow() {
  currentItems.push({
    id: null,
    inventoryItemId: null,
    materialName: "",
    unit: "",
    qty: "",
    unitCost: "0",
    isFeatured: false,
    featuredImageData: null,
    // القاعدة الجديدة: أي مكوّن جديد يبدأ بقائمة اختيار حقيقية من المخزون
    // بدل خانة اسم حرة — "يدوي" لسه متاح كخيار احتياطي من قائمة "المصدر"
    // لو الصنف مش موجود في المخزون فعلًا، لكن مش الافتراضي.
    _pendingInventoryPick: true,
  });
  renderComponentRows();
}

function openCreateModal() {
  editingId = null;
  currentItems = [];
  modalOverlay.querySelector(".modal-head h3").innerHTML =
    '<i class="fa-solid fa-diagram-project"></i> وصفة تصنيع جديدة';
  document.getElementById("modal-save").innerHTML =
    '<i class="fa-solid fa-check"></i> حفظ الوصفة';
  fName.value = "";
  fCode.value = "";
  fFoundationLegacyNote.style.display = "none";
  renderFoundationItemOptions();
  loadFoundationFinishedGoods();
  fOutputQty.value = "1";
  fReferencePrice.value = "";
  fExpectedDays.value = "";
  fNotes.value = "";
  currentImages = [];
  renderImagesSection();
  renderComponentRows();
  modalOverlay.classList.add("open");
  document.body.style.overflow = "hidden";
}

async function openEditModal(id) {
  let recipe;
  try {
    recipe = await api(`/bom/${id}`);
  } catch (e) {
    showToast("تعذر تحميل الوصفة: " + e.message, true);
    return;
  }
  editingId = id;
  modalOverlay.querySelector(".modal-head h3").innerHTML =
    '<i class="fa-solid fa-pen"></i> تعديل الوصفة';
  document.getElementById("modal-save").innerHTML =
    '<i class="fa-solid fa-check"></i> حفظ التعديلات';

  await loadFoundationFinishedGoods();
  renderFoundationItemOptions(recipe.foundationItemId);
  fName.value = recipe.productName;
  fCode.value = recipe.productCode || "";
  fFoundationLegacyNote.style.display = recipe.foundationItemId
    ? "none"
    : "block";
  fOutputQty.value = recipe.outputQty || "1";
  fReferencePrice.value = recipe.referencePrice || "";
  fExpectedDays.value = recipe.expectedProductionDays || "";
  fNotes.value = recipe.description || "";
  currentItems = (recipe.items || []).map((i) => ({
    id: i.id,
    inventoryItemId: i.inventoryItemId,
    materialName: i.materialName,
    unit: i.unit,
    qty: i.qty,
    unitCost: i.unitCost,
    available: i.available,
    isFeatured: i.isFeatured === true,
    featuredImageData: i.featuredImageData || null,
  }));
  currentImages = recipe.images || [];
  renderImagesSection();
  renderComponentRows();
  modalOverlay.classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeModal() {
  modalOverlay.classList.remove("open");
  document.body.style.overflow = "";
}

async function saveBom() {
  const foundationItemId = fFoundationItem.value
    ? Number(fFoundationItem.value)
    : null;
  // ✅ لازم يختار منتج من صفحة البيانات الأساسية عند إنشاء وصفة جديدة —
  // الوصفات القديمة الغير متربطة (editingId موجود بس foundationItemId فاضي)
  // تفضل تتحفظ عادي من غير ما نجبرها تتربط دلوقتي.
  if (!editingId && !foundationItemId) {
    showToast("اختار المنتج من صفحة البيانات الأساسية الأول", true);
    return;
  }
  const productName = fName.value.trim();
  if (!productName) {
    showToast("اسم المنتج مطلوب", true);
    return;
  }
  const items = currentItems
    .filter((i) => i.materialName && i.materialName.trim())
    .map((i) => ({
      inventoryItemId: i.inventoryItemId || null,
      materialName: i.materialName.trim(),
      qty: String(i.qty || "0"),
      unit: i.unit || "pcs",
      unitCost: String(i.unitCost || "0"),
      isFeatured: i.isFeatured === true,
      featuredImageData: i.isFeatured ? i.featuredImageData || null : null,
    }));

  const payload = {
    productName,
    productCode: fCode.value.trim() || null,
    outputQty: String(fOutputQty.value || "1"),
    referencePrice: fReferencePrice.value.trim() ? String(fReferencePrice.value.trim()) : null,
    // expectedProductionDays مربوط بعمود integer في القاعدة — مينفعش
    // يتبعت كسر زي 0.1. الحقل نفسه فيه step="1" بس ده بيتحكم في زرار
    // الأسهم بس مش الكتابة اليدوية، فبنقرّب أي رقم مكتوب يدويًا لأقرب
    // عدد صحيح (بحد أدنى يوم واحد) بدل ما نسيب السيرفر يرفضه برسالة
    // تقنية للمستخدم.
    expectedProductionDays: fExpectedDays.value.trim()
      ? Math.max(1, Math.round(Number(fExpectedDays.value.trim())))
      : null,
    description: fNotes.value.trim() || null,
  };
  // ✅ منبعتش foundationItemId: null وإحنا بنعدّل وصفة — عشان لو الصنف
  // المربوط اتشال من القايمة (اتوقف مثلاً) والفورم ماقدرش يحدده، ميتمسحش
  // الربط بالغلط. بنبعته بس لو فيه قيمة، أو لو دي وصفة جديدة (foundationItemId مطلوب أصلاً).
  if (foundationItemId || !editingId) {
    payload.foundationItemId = foundationItemId;
  }

  try {
    if (editingId) {
      await api(`/bom/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      // ✅ مزامنة المكوّنات: نمسح القديم ونضيف الجديد (أبسط وأضمن من مقارنة الفروق)
      const existing = await api(`/bom/${editingId}`);
      for (const oldItem of existing.items || []) {
        await api(`/bom/${editingId}/items/${oldItem.id}`, {
          method: "DELETE",
        });
      }
      for (const item of items) {
        await api(`/bom/${editingId}/items`, {
          method: "POST",
          body: JSON.stringify(item),
        });
      }
      showToast("تم تحديث الوصفة بنجاح");
    } else {
      const created = await api("/bom", {
        method: "POST",
        body: JSON.stringify({ ...payload, items }),
      });
      showToast("تمت إضافة الوصفة بنجاح — تقدر تضيف صور المنتج دلوقتي");
      // ✅ الصور محتاجة وصفة محفوظة الأول، فبعد الحفظ بنفضل في نفس النافذة
      // ونحوّلها لوضع التعديل عشان يقدر يضيف الصور على طول من غير ما يقفل
      // ويفتح تاني.
      await loadRecipes();
      await openEditModal(created.id);
      return;
    }
    closeModal();
    await loadRecipes();
  } catch (e) {
    showToast("تعذر الحفظ: " + e.message, true);
  }
}

// ===================================================
//  Init
// ===================================================
document
  .getElementById("btn-new-bom")
  ?.addEventListener("click", openCreateModal);
document
  .getElementById("btn-add-component")
  ?.addEventListener("click", addComponentRow);
document.getElementById("modal-save")?.addEventListener("click", saveBom);
document.getElementById("modal-cancel")?.addEventListener("click", closeModal);
document.getElementById("modal-close")?.addEventListener("click", closeModal);
modalOverlay?.addEventListener("click", (e) => {
  if (e.target === modalOverlay) closeModal();
});

document.getElementById("detail-close")?.addEventListener("click", closeDetail);
document.getElementById("detail-overlay")?.addEventListener("click", (e) => {
  if (e.target === document.getElementById("detail-overlay")) closeDetail();
});

document.getElementById("confirm-yes")?.addEventListener("click", doDelete);
document.getElementById("confirm-no")?.addEventListener("click", () => {
  document.getElementById("confirm-overlay")?.classList.remove("open");
  deletingId = null;
});

document.getElementById("search-input")?.addEventListener("input", (e) => {
  searchQuery = e.target.value;
  renderGrid();
});
document.getElementById("sort-select")?.addEventListener("change", (e) => {
  sortMode = e.target.value;
  renderGrid();
});

(async function init() {
  await loadInventoryOptions();
  await loadRecipes();
})();
