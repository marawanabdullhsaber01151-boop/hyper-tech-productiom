/** @format */
// ============================================================
//  SETTINGS — Hyper-Tech ERP
//  الإعدادات — شركة + مستخدمون + إشعارات + نظام + backup + عن النظام
// ============================================================

const SETTINGS_KEY = "hyper_erp_settings";
const USERS_KEY = "hyper_erp_users";

// ---- اتصال حقيقي بالباك إند (يستخدم HyperTechAuth الجاهز في auth.js) ----
async function apiCall(path, options = {}) {
  return window.HyperTechAuth.request(path, options);
}
function currentUser() {
  return window.HyperTechAuth.user || null;
}

const DEFAULT_SETTINGS = {
  company: {
    name: "Hyper-Tech ERP للمشتركات الكهربائية",
    nameEn: "Hyper-Tech ERP",
    logo: "",
    phone: "02-12345678",
    mobile: "01012345678",
    email: "info@hypertech-erp.eg",
    address: "المنطقة الصناعية، القاهرة الجديدة",
    city: "القاهرة",
    country: "مصر",
    taxId: "123-456-789-EG",
    currency: "EGP",
    currencySymbol: "ج.م",
    language: "ar",
    timezone: "Africa/Cairo",
    dateFormat: "DD/MM/YYYY",
    fiscal_year_start: "01",
  },
  notifications: {
    lowInventory: true,
    lowInventoryThreshold: 20,
    orderDue: true,
    orderDueDays: 7,
    paymentOverdue: true,
    emailNotifications: false,
    smsNotifications: false,
    sound: true,
  },
  system: {
    darkMode: true,
    autoSave: true,
    autoSaveInterval: 5,
    defaultPageSize: 15,
    showAnimations: true,
    compactMode: false,
    backupReminder: true,
    backupReminderDays: 7,
  },
};

const DEFAULT_USERS = [
  {
    id: "USR-001",
    name: "محمد صابر",
    username: "admin",
    role: "chairman",
    dept: "management",
    phone: "01012345678",
    email: "admin@hypertech.eg",
    status: "active",
    lastLogin: "2026-07-22",
    createdAt: "2026-01-01",
  },
  {
    id: "USR-002",
    name: "أحمد حسن",
    username: "a.hassan",
    role: "supervisor",
    dept: "production",
    phone: "01023456789",
    email: "a.hassan@hypertech.eg",
    status: "active",
    lastLogin: "2026-07-20",
    createdAt: "2026-03-15",
  },
  {
    id: "USR-003",
    name: "سامية عبدالله",
    username: "s.abdulla",
    role: "sales_manager",
    dept: "quality",
    phone: "01034567890",
    email: "s.abdulla@hypertech.eg",
    status: "active",
    lastLogin: "2026-07-19",
    createdAt: "2026-06-01",
  },
  {
    id: "USR-004",
    name: "ريم محمود",
    username: "r.mahmoud",
    role: "hr",
    dept: "finance",
    phone: "01056789012",
    email: "r.mahmoud@hypertech.eg",
    status: "active",
    lastLogin: "2026-07-21",
    createdAt: "2026-06-15",
  },
  {
    id: "USR-005",
    name: "فاطمة سالم",
    username: "f.salem",
    role: "hr",
    dept: "hr",
    phone: "01078901234",
    email: "f.salem@hypertech.eg",
    status: "inactive",
    lastLogin: "2026-06-30",
    createdAt: "2026-07-01",
  },
];

function populateEgyptGovernorates() {
  const select = document.getElementById("c-city");
  const governorates = Array.isArray(window.EGYPT_GOVERNORATES)
    ? window.EGYPT_GOVERNORATES
    : [];
  if (!select || !governorates.length) return;
  select.replaceChildren(new Option("اختر المحافظة...", ""));
  governorates.forEach((governorate) =>
    select.appendChild(new Option(governorate, governorate)),
  );
}

const ROLE_LABELS = {
  chairman: "رئيس مجلس الإدارة",
  executive_manager: "المدير التنفيذي",
  sales_manager: "مدير المبيعات",
  online_seller: "بائع أونلاين",
  offline_seller: "بائع أوفلاين",
  operations_manager: "مدير التشغيل",
  purchasing_manager: "مدير المشتريات",
  buyer: "المشتري",
  hr: "الاتش آر",
  hr_manager: "مدير الموارد البشرية",
  production_manager: "مدير الإنتاج",
  production_controller: "مراقب الإنتاج",
  warehouse_manager: "مدير المخازن",
  storekeeper: "أمين المخزن",
  supervisor: "مشرف",
  production_quality_controller: "مراقب جودة دورة الإنتاج",
  raw_material_quality_controller: "مراقب جودة الخامات",
  quality_engineer: "مهندس الجودة",
};
const ROLE_CLASS = {
  chairman: "purple",
  executive_manager: "purple",
  sales_manager: "blue",
  online_seller: "blue",
  offline_seller: "blue",
  operations_manager: "amber",
  purchasing_manager: "blue",
  buyer: "blue",
  hr: "amber",
  hr_manager: "amber",
  production_manager: "blue",
  production_controller: "blue",
  warehouse_manager: "blue",
  storekeeper: "blue",
  supervisor: "amber",
  production_quality_controller: "green",
  raw_material_quality_controller: "green",
  quality_engineer: "green",
};
const DEPT_LABELS = {
  production: "الإنتاج",
  quality: "الجودة",
  warehouse: "المستودع",
  management: "الإدارة",
  finance: "المالية",
  hr: "الموارد البشرية",
};

let settings = {};
let remoteSettings = {}; // ✅ الإعدادات الحقيقية القادمة من الباك إند (مفاتيح snake_case)
let users = [];
let activeSection = "company";
let editingUserId = null;
let deletingUserId = null;

// ---- Storage (تفضيلات الإشعارات الشخصية بس — مفيش دعم ليها في الباك إند حاليًا) ----
function loadSettings() {
  try {
    const s = localStorage.getItem(SETTINGS_KEY);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}
function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// ---- Init ----
const avatarColors = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ef4444",
  "#06b6d4",
];

(async function init() {
  populateEgyptGovernorates();
  updateTime();
  setInterval(updateTime, 1000);
  try {
    remoteSettings = await apiCall("/settings");
  } catch (e) {
    showToast("تعذر تحميل الإعدادات من الخادم: " + e.message, "warn");
    remoteSettings = {};
  }
  settings = loadSettings() || JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  populateCompanyForm();
  populateNotifForm();
  populateSystemForm();
  await refreshUsers();
  renderSystemInfo();
  bindEvents();
})();

// ---- Company ----
function populateCompanyForm() {
  const r = remoteSettings;
  setValue("c-name", r.company_name);
  setValue("c-phone", r.company_phone);
  setValue("c-email", r.company_email);
  setValue("c-address", r.company_address);
  setValue("c-currency", r.currency || "EGP");
  setValue("c-fy", r.fiscal_year_start || "01-01");
}

async function saveCompanySettings() {
  try {
    remoteSettings = await apiCall("/settings", {
      method: "PUT",
      body: JSON.stringify({
        company_name: getValue("c-name"),
        company_phone: getValue("c-phone"),
        company_email: getValue("c-email"),
        company_address: getValue("c-address"),
        currency: getValue("c-currency") || "EGP",
        fiscal_year_start: getValue("c-fy") || "01-01",
      }),
    });
    showToast("تم حفظ بيانات الشركة بنجاح");
  } catch (e) {
    showToast("تعذر حفظ بيانات الشركة: " + e.message, "warn");
  }
}

// ---- Notifications ----
function populateNotifForm() {
  const n = settings.notifications || {};
  setCheck("notif-stock", n.lowInventory);
  setCheck("notif-late", n.orderDue);
  setCheck("notif-invoices", n.paymentOverdue);
  setCheck("notif-po", n.purchaseReceived);
  setCheck("notif-daily", n.dailyReport);
  setCheck("notif-weekly", n.weeklyReport !== false);
}

function saveNotifSettings() {
  settings.notifications = {
    ...settings.notifications,
    lowInventory: getCheck("notif-stock"),
    orderDue: getCheck("notif-late"),
    paymentOverdue: getCheck("notif-invoices"),
    purchaseReceived: getCheck("notif-po"),
    dailyReport: getCheck("notif-daily"),
    weeklyReport: getCheck("notif-weekly"),
  };
  saveSettings();
  showToast("تم حفظ إعدادات الإشعارات");
}

// ---- System ----
function populateSystemForm() {
  const r = remoteSettings;
  setValue("sys-lang", r.language || "ar");
  setValue("sys-currency", r.currency || "EGP");
  setCheck("sys-confirm-del", true);
  setCheck("sys-autonumber", true);
  setCheck("sys-autorefresh", true);
}

async function saveSystemSettings() {
  try {
    remoteSettings = await apiCall("/settings", {
      method: "PUT",
      body: JSON.stringify({
        language: getValue("sys-lang") || "ar",
        currency: getValue("sys-currency") || "EGP",
      }),
    });
    showToast("تم حفظ إعدادات النظام");
  } catch (e) {
    showToast("تعذر حفظ إعدادات النظام: " + e.message, "warn");
  }
}

// ---- Profile (كلمة المرور الشخصية) ----
async function changeMyPassword() {
  const currentPassword = getValue("p-current-pass");
  const newPassword = getValue("p-new-pass");
  const confirmPassword = getValue("p-confirm-pass");
  if (!currentPassword || !newPassword) {
    showToast("يرجى إدخال كلمة المرور الحالية والجديدة", "warn");
    return;
  }
  if (newPassword !== confirmPassword) {
    showToast("كلمة المرور الجديدة وتأكيدها غير متطابقين", "warn");
    return;
  }
  try {
    await apiCall("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    setValue("p-current-pass", "");
    setValue("p-new-pass", "");
    setValue("p-confirm-pass", "");
    showToast("تم تغيير كلمة المرور بنجاح");
  } catch (e) {
    showToast("تعذر تغيير كلمة المرور: " + e.message, "warn");
  }
}

// ---- Users ----
async function refreshUsers() {
  try {
    users = await apiCall("/users");
    renderUsers();
  } catch (e) {
    // 403 متوقع لو المستخدم مش مدير كامل — قسم المستخدمين مقصور على المدير فقط أصلًا
    users = [];
    const tbody = document.getElementById("users-tbody");
    if (tbody)
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">إدارة المستخدمين متاحة للمدير الكامل فقط</td></tr>`;
  }
}
function getColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h += name.charCodeAt(i);
  return avatarColors[h % avatarColors.length];
}
function initials(name) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
}

function renderUsers() {
  const tbody = document.getElementById("users-tbody");
  if (!tbody) return;
  const statusBadge = {
    active: { l: "نشط", c: "green" },
    inactive: { l: "غير نشط", c: "gray" },
  };
  const me = currentUser();
  tbody.innerHTML = users
    .map((u) => {
      const color = getColor(u.fullName);
      const sb = statusBadge[u.status] || statusBadge.active;
      return `<tr>
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:34px;height:34px;border-radius:50%;background:${color}22;color:${color};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700">${escHtml(initials(u.fullName))}</div>
          <div><strong>${escHtml(u.fullName)}</strong><br/><span style="font-size:11px;color:var(--text-muted)">${escHtml(u.username)}</span></div>
        </div>
      </td>
      <td><span class="badge ${ROLE_CLASS[u.role] || "blue"}">${ROLE_LABELS[u.role] || u.role}</span></td>
      <td style="font-size:11px;color:var(--text-muted)">${fmtDate(u.createdAt)}</td>
      <td><span class="badge ${sb.c}">${sb.l}</span></td>
      <td>
        <div class="row-actions">
          <button class="row-action edit-btn" onclick="openEditUser(${u.id})"><i class="fa-solid fa-pen"></i></button>
          ${u.id !== me?.id ? `<button class="row-action" onclick="openPermissionsModal(${u.id}, '${escHtml(u.fullName)}')" title="صلاحيات مخصّصة"><i class="fa-solid fa-key"></i></button>` : ""}
          ${u.id !== me?.id ? `<button class="row-action delete-btn" onclick="openDeleteUser(${u.id})"><i class="fa-solid fa-trash"></i></button>` : '<span style="color:var(--text-dim);font-size:11px">أنت</span>'}
        </div>
      </td>
    </tr>`;
    })
    .join("");
  setText("users-count", users.length);
}

function openNewUser() {
  editingUserId = null;
  setText("modal-title", "مستخدم جديد");
  setValue("u-name", "");
  setValue("u-username", "");
  setValue("u-role", "sales_manager");
  setValue("u-status", "active");
  setValue("u-pass", "");
  document.getElementById("modal-overlay")?.classList.add("open");
}

function openEditUser(id) {
  const u = users.find((u) => u.id === id);
  if (!u) return;
  editingUserId = id;
  setText("modal-title", "تعديل المستخدم");
  setValue("u-name", u.fullName);
  setValue("u-username", u.username);
  setValue("u-role", u.role);
  setValue("u-status", u.status || "active");
  setValue("u-pass", "");
  document.getElementById("modal-overlay")?.classList.add("open");
}

function closeUserModal() {
  document.getElementById("modal-overlay")?.classList.remove("open");
}

async function saveUser() {
  const fullName = getValue("u-name");
  const username = getValue("u-username");
  const password = getValue("u-pass");
  if (!fullName || !username) {
    showToast("يرجى إدخال الاسم واسم المستخدم", "warn");
    return;
  }
  try {
    if (editingUserId) {
      const data = {
        username,
        fullName,
        role: getValue("u-role") || "sales_manager",
        status: getValue("u-status") || "active",
      };
      if (password) data.password = password;
      await apiCall(`/users/${editingUserId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
    } else {
      if (!password) {
        showToast("كلمة المرور مطلوبة للمستخدم الجديد", "warn");
        return;
      }
      await apiCall("/users", {
        method: "POST",
        body: JSON.stringify({
          fullName,
          username,
          role: getValue("u-role") || "sales_manager",
          status: getValue("u-status") || "active",
          password,
        }),
      });
    }
    closeUserModal();
    await refreshUsers();
    showToast(editingUserId ? "تم تحديث المستخدم" : "تمت إضافة المستخدم");
  } catch (e) {
    showToast("فشل الحفظ: " + e.message, "warn");
  }
}

function openDeleteUser(id) {
  deletingUserId = id;
  const u = users.find((u) => u.id === id);
  document.getElementById("confirm-msg").textContent =
    `هل أنت متأكد من حذف المستخدم "${u?.fullName}"؟ (سينتقل لسلة المهملات وليس حذفًا نهائيًا)`;
  document.getElementById("confirm-overlay").classList.add("open");
}
function closeConfirm() {
  document.getElementById("confirm-overlay").classList.remove("open");
  deletingUserId = null;
}
async function doDeleteUser() {
  try {
    await apiCall(`/users/${deletingUserId}`, { method: "DELETE" });
    await refreshUsers();
    showToast("تم نقل المستخدم لسلة المهملات");
  } catch (e) {
    showToast("تعذر الحذف: " + e.message, "warn");
  } finally {
    closeConfirm();
  }
}

// ---- Backup ----
// Phase 2: export/import backup buttons and the full-wipe button were removed
// from settings.html along with admin-vault.ts and secure-vault.html (both
// explicitly removed in this phase — see CHANGE-MANIFEST-PHASE-2.md). Only
// the client-side cache clear below remains; it never depended on that route.

function clearCache() {
  const keys = Object.keys(localStorage).filter((k) =>
    k.startsWith("hyper_erp_cache_"),
  );
  keys.forEach((k) => localStorage.removeItem(k));
  showToast("تم مسح الكاش (" + keys.length + " مفتاح)");
}

// ---- System Info ----
// ✅ إصلاح جذري: كانت الدالة دي بتقرا من localStorage الفاضي — العناصر
// اللي كانت بتستهدفها (info-storage, size-sales...) مش موجودة في الـHTML
// من زمان أصلاً (كود ميت تمامًا). دلوقتي بتجيب نبضة حقيقية من قاعدة
// البيانات: عدد سجلات كل قسم، حجم القاعدة الفعلي، ومدة تشغيل السيرفر.
async function renderSystemInfo() {
  const grid = document.getElementById("system-pulse-grid");
  try {
    const info = await apiCall("/system-info");
    setText("about-stack", info.stack);
    setText("about-storage", info.storage);
    setText("about-db-size", info.databaseSize);
    setText("about-uptime", formatUptime(info.uptimeSeconds));

    const items = [
      {
        label: "المبيعات",
        value: info.modules.sales,
        icon: "fa-cart-shopping",
      },
      { label: "المشتريات", value: info.modules.purchases, icon: "fa-truck" },
      {
        label: "المخزون",
        value: info.modules.inventory,
        icon: "fa-boxes-stacked",
      },
      {
        label: "جهات الاتصال",
        value: info.modules.contacts,
        icon: "fa-address-book",
      },
      { label: "الموظفون", value: info.modules.employees, icon: "fa-users" },
      {
        label: "القيود المحاسبية",
        value: info.modules.accounting,
        icon: "fa-file-invoice-dollar",
      },
      {
        label: "المستخدمون",
        value: info.modules.users,
        icon: "fa-user-shield",
      },
      {
        label: "نشاط اليوم",
        value: info.todayActivity,
        icon: "fa-bolt",
        highlight: true,
      },
    ];
    grid.innerHTML = items
      .map(
        (it) => `
      <div class="about-item"${it.highlight ? ' style="border:1px solid var(--accent)"' : ""}>
        <label><i class="fa-solid ${it.icon}"></i> ${it.label}</label>
        <span>${it.value.toLocaleString("ar-EG")}</span>
      </div>`,
      )
      .join("");
  } catch (e) {
    grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;color:var(--red);padding:12px">تعذّر تحميل نبضة النظام: ${escHtml ? escHtml(e.message) : e.message}</p>`;
  }
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d} يوم و${h} ساعة`;
  if (h > 0) return `${h} ساعة و${m} دقيقة`;
  return `${m} دقيقة`;
}

// ---- Section Navigation ----
function switchSection(section) {
  activeSection = section;
  document
    .querySelectorAll(".settings-nav-item, .set-menu-item")
    .forEach((btn) =>
      btn.classList.toggle("active", btn.dataset.section === section),
    );
  document
    .querySelectorAll(".settings-section, .set-section")
    .forEach(
      (sec) =>
        (sec.style.display = sec.id === "sec-" + section ? "block" : "none"),
    );
  if (section === "users") renderUsers();
  if (section === "about") renderSystemInfo();
  if (section === "delivery-rules") loadDeliveryRules();
}

// ---- Delivery Method Rules (Phase 3) ----
function deliveryRuleRangeLabel(rule) {
  const parts = [];
  if (rule.minQty || rule.maxQty)
    parts.push(`كمية: ${rule.minQty ?? "؟"} — ${rule.maxQty ?? "∞"}`);
  if (rule.minValue || rule.maxValue)
    parts.push(`قيمة: ${rule.minValue ?? "؟"} — ${rule.maxValue ?? "∞"} ج.م`);
  if (!parts.length) parts.push("بدون حدود (قاعدة عامة)");
  const timingLabel = { any: "أي وقت", on_time: "في الميعاد", late: "متأخر" }[rule.timing] || rule.timing;
  parts.push(`التوقيت: ${timingLabel}`);
  return parts.join(" · ");
}

async function loadDeliveryRules() {
  const list = document.getElementById("delivery-rules-list");
  if (!list) return;
  list.innerHTML = '<div class="empty-state">جاري التحميل...</div>';
  try {
    const rules = await apiCall("/settings/delivery-rules");
    if (!rules.length) {
      list.innerHTML = '<div class="empty-state">لا توجد قواعد بعد — أضف قاعدة تحت.</div>';
      return;
    }
    list.innerHTML = rules
      .map(
        (r) => `
      <div class="backup-card" data-rule-id="${r.id}" style="display:flex;justify-content:space-between;align-items:center;gap:12px">
        <div>
          <h4>${escSettings(r.label)} ${r.isActive ? "" : "(معطّلة)"}</h4>
          <p>${escSettings(deliveryRuleRangeLabel(r))} · أولوية ${r.priority} · النتيجة: ${r.deliveryMethod === "customer" ? "توصيل للعميل" : "استلام من المخزن"}</p>
        </div>
        <button class="btn-danger" data-delete-rule="${r.id}">حذف</button>
      </div>`,
      )
      .join("");
    list.querySelectorAll("[data-delete-rule]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (!confirm("حذف القاعدة دي؟")) return;
        try {
          await apiCall(`/settings/delivery-rules/${btn.dataset.deleteRule}`, { method: "DELETE" });
          await loadDeliveryRules();
        } catch (e) {
          showToast(e.message, "warn");
        }
      }),
    );
  } catch (e) {
    list.innerHTML = `<div class="empty-state">${escSettings(e.message)}</div>`;
  }
}

function escSettings(value) {
  const d = document.createElement("div");
  d.textContent = value ?? "";
  return d.innerHTML;
}

// ---- Helpers ----
function setCheck(id, val) {
  const el = document.getElementById(id);
  if (el) el.checked = !!val;
}
function getCheck(id) {
  const el = document.getElementById(id);
  return el ? el.checked : false;
}
function setText(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function setValue(id, v) {
  const el = document.getElementById(id);
  if (el) el.value = v ?? "";
}
function getValue(id) {
  return document.getElementById(id)?.value?.trim() || "";
}
function fmtDate(d) {
  try {
    return new Date(d).toLocaleDateString("ar-EG", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return d || "—";
  }
}
function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.style.background = type === "warn" ? "var(--red)" : "var(--green)";
  setText("toast-msg", msg);
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3500);
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
  // Section nav
  document
    .querySelectorAll(".settings-nav-item, .set-menu-item")
    .forEach((btn) =>
      btn.addEventListener("click", function () {
        switchSection(this.dataset.section);
      }),
    );
  // Delivery method rules (Phase 3)
  document
    .getElementById("delivery-rule-form")
    ?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = {
        label: getValue("dr-label"),
        minQty: getValue("dr-min-qty") || null,
        maxQty: getValue("dr-max-qty") || null,
        minValue: getValue("dr-min-value") || null,
        maxValue: getValue("dr-max-value") || null,
        timing: getValue("dr-timing") || "any",
        deliveryMethod: getValue("dr-method") || "warehouse",
        priority: Number(getValue("dr-priority") || 100),
      };
      try {
        await apiCall("/settings/delivery-rules", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        e.target.reset();
        await loadDeliveryRules();
        showToast("تمت إضافة القاعدة");
      } catch (err) {
        showToast(err.message, "warn");
      }
    });
  // Company
  document
    .getElementById("btn-save-company")
    ?.addEventListener("click", saveCompanySettings);
  document
    .getElementById("btn-change-my-password")
    ?.addEventListener("click", changeMyPassword);
  // Notifications
  document
    .getElementById("btn-save-notif")
    ?.addEventListener("click", saveNotifSettings);
  // System
  document
    .getElementById("btn-save-system")
    ?.addEventListener("click", saveSystemSettings);
  // Users
  document
    .getElementById("btn-new-user")
    ?.addEventListener("click", openNewUser);
  document
    .getElementById("modal-close")
    ?.addEventListener("click", closeUserModal);
  document
    .getElementById("modal-cancel")
    ?.addEventListener("click", closeUserModal);
  document.getElementById("modal-save")?.addEventListener("click", saveUser);
  document.getElementById("modal-overlay")?.addEventListener("click", (e) => {
    if (e.target === document.getElementById("modal-overlay")) closeUserModal();
  });
  // Confirm
  document
    .getElementById("confirm-no")
    ?.addEventListener("click", closeConfirm);
  document
    .getElementById("confirm-yes")
    ?.addEventListener("click", doDeleteUser);
  document.getElementById("confirm-overlay")?.addEventListener("click", (e) => {
    if (e.target === document.getElementById("confirm-overlay")) closeConfirm();
  });
  document
    .getElementById("btn-clear-cache")
    ?.addEventListener("click", clearCache);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeUserModal();
      closeConfirm();
    }
  });
}

/* ============================================================
   ✨ CUSTOM PERMISSIONS — صلاحيات مخصّصة لكل مستخدم (استثناءات
   دقيقة على مستوى الإجراء الواحد، دائمة أو مؤقتة بتاريخ انتهاء)
   ============================================================ */
let actionRegistryCache = null;
let permsModalUserId = null;
let permsModalUserName = "";
let grantModalActionKey = null;
let grantModalExistingOverride = null; // الاستثناء النشط الحالي على المفتاح ده لو موجود

async function openPermissionsModal(userId, userName) {
  permsModalUserId = userId;
  permsModalUserName = userName;
  document.getElementById("perms-modal-username").textContent = userName;
  document.getElementById("perms-modal-overlay").classList.add("open");
  await renderPermissionsGroups();
}
function closePermissionsModal() {
  document.getElementById("perms-modal-overlay").classList.remove("open");
  permsModalUserId = null;
}

async function renderPermissionsGroups() {
  const container = document.getElementById("perms-groups");
  container.innerHTML = `<p style="text-align:center;color:var(--text-dim);padding:20px"><i class="fa-solid fa-spinner fa-spin"></i> جاري التحميل...</p>`;
  try {
    if (!actionRegistryCache)
      actionRegistryCache = await apiCall("/action-registry");
    const overrides = await apiCall(
      `/users/${permsModalUserId}/permission-overrides`,
    );
    const now = new Date();
    const activeByKey = {};
    overrides.forEach((o) => {
      if (o.revokedAt) return;
      if (o.expiresAt && new Date(o.expiresAt) <= now) return;
      activeByKey[o.actionKey] = o;
    });

    const targetUser = users.find((u) => u.id === permsModalUserId);
    const groups = {};
    actionRegistryCache.forEach((a) => {
      (groups[a.group] ||= []).push(a);
    });

    container.innerHTML = Object.entries(groups)
      .map(
        ([groupName, actions]) => `
        <div style="margin-bottom:18px">
          <h4 style="font-size:12px;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">${escHtml(groupName)}</h4>
          <div style="display:flex;flex-direction:column;gap:6px">
            ${actions
              .map((a) => {
                const override = activeByKey[a.key];
                const roleDefault =
                  targetUser && a.defaultRoles.includes(targetUser.role);
                let statusHtml, actionBtn;
                if (override) {
                  const until =
                    override.expiresAt ?
                      `حتى ${fmtDate(override.expiresAt)}`
                    : "دائم";
                  statusHtml =
                    override.allowed ?
                      `<span class="badge green"><i class="fa-solid fa-bolt"></i> ممنوحة استثنائيًا — ${until}</span>`
                    : `<span class="badge red"><i class="fa-solid fa-ban"></i> موقوفة استثنائيًا — ${until}</span>`;
                  actionBtn = `<button class="row-action delete-btn" onclick="revokeOverride(${override.id})" title="إلغاء الاستثناء"><i class="fa-solid fa-rotate-left"></i></button>`;
                } else {
                  statusHtml =
                    roleDefault ?
                      `<span class="badge gray">مسموح افتراضيًا (دوره)</span>`
                    : `<span class="badge gray">غير مسموح افتراضيًا (دوره)</span>`;
                  actionBtn = `<button class="row-action" onclick="openGrantModal('${a.key}', ${!roleDefault})" title="إضافة استثناء"><i class="fa-solid fa-plus"></i></button>`;
                }
                return `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(255,255,255,.03);border-radius:8px">
                  <span style="font-size:13px">${escHtml(a.label)}</span>
                  <div style="display:flex;align-items:center;gap:8px">${statusHtml}${actionBtn}</div>
                </div>`;
              })
              .join("")}
          </div>
        </div>`,
      )
      .join("");
  } catch (e) {
    container.innerHTML = `<p style="text-align:center;color:var(--red);padding:20px">تعذّر التحميل: ${escHtml(e.message)}</p>`;
  }
}

function openGrantModal(actionKey, suggestAllow) {
  grantModalActionKey = actionKey;
  const action = actionRegistryCache.find((a) => a.key === actionKey);
  document.getElementById("grant-modal-title").textContent =
    `استثناء: ${action?.label || actionKey}`;
  document.getElementById("grant-allowed").value = String(suggestAllow);
  document.getElementById("grant-expires").value = "";
  document.getElementById("grant-reason").value = "";
  document.getElementById("grant-modal-overlay").classList.add("open");
}
function closeGrantModal() {
  document.getElementById("grant-modal-overlay").classList.remove("open");
  grantModalActionKey = null;
}

async function saveGrant() {
  const allowed = document.getElementById("grant-allowed").value === "true";
  const expiresRaw = document.getElementById("grant-expires").value;
  const reason = document.getElementById("grant-reason").value.trim();
  try {
    await apiCall("/permission-overrides", {
      method: "POST",
      body: JSON.stringify({
        userId: permsModalUserId,
        actionKey: grantModalActionKey,
        allowed,
        reason: reason || null,
        // ✅ نهاية اليوم المختار بالكامل (23:59) — لا نقطع الصلاحية من نص اليوم
        expiresAt:
          expiresRaw ? new Date(expiresRaw + "T23:59:59").toISOString() : null,
      }),
    });
    closeGrantModal();
    showToast("تم حفظ الاستثناء");
    await renderPermissionsGroups();
  } catch (e) {
    showToast("فشل الحفظ: " + e.message, "warn");
  }
}

async function revokeOverride(overrideId) {
  if (!confirm("إلغاء هذا الاستثناء والرجوع لصلاحيات الدور الافتراضية؟"))
    return;
  try {
    await apiCall(`/permission-overrides/${overrideId}`, { method: "DELETE" });
    showToast("تم إلغاء الاستثناء");
    await renderPermissionsGroups();
  } catch (e) {
    showToast("فشل الإلغاء: " + e.message, "warn");
  }
}

document
  .getElementById("perms-modal-close")
  ?.addEventListener("click", closePermissionsModal);
document
  .getElementById("perms-modal-overlay")
  ?.addEventListener("click", (e) => {
    if (e.target.id === "perms-modal-overlay") closePermissionsModal();
  });
document
  .getElementById("grant-modal-close")
  ?.addEventListener("click", closeGrantModal);
document
  .getElementById("grant-modal-cancel")
  ?.addEventListener("click", closeGrantModal);
document
  .getElementById("grant-modal-overlay")
  ?.addEventListener("click", (e) => {
    if (e.target.id === "grant-modal-overlay") closeGrantModal();
  });
document
  .getElementById("grant-modal-save")
  ?.addEventListener("click", saveGrant);
