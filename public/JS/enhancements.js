/** @format */
// ============================================================
//  ENHANCEMENTS — Hyper-Tech ERP
//  قائمة المستخدم + الإشعارات الحقيقية + "مطلوب مني" + البحث الحقيقي
//
//  ✅ إصلاحات جوهرية في هذه النسخة (كانت كل الميزات دي معطوبة بصمت):
//  1. الإشعارات كانت بتتنادى بـ fetch() عادي من غير أي توكن مصادقة —
//     السيرفر كان بيرفضها 401 دايمًا. الرد الحقيقي كمان شكله {data:[...]}
//     مش array مباشرة، والكود القديم كان بيتعامل معاه غلط.
//  2. enhancements.css (تنسيق اللوحات دي كلها) كان موجود بالفعل بس مش
//     متربط في ولا صفحة واحدة من الـ 22 صفحة — فحتى لو الكود صح، اللوحة
//     كانت هتفتح من غير أي شكل أو مكان صحيح.
//  3. تسجيل الخروج كان بيمسح مفاتيح localStorage مش موجودة أصلاً (الجلسة
//     الحقيقية في sessionStorage باسم مختلف) — يعني زرار خروج مالوش تأثير حقيقي.
//  4. تغيير كلمة المرور كان بيستخدم prompt() بدائي، بشرط "6 أحرف" بينما
//     الباك إند بيطلب شرط أقوى فعليًا — يعني كان بيفشل بغموض كل مرة.
//  5. البحث كان بيقرا من localStorage فاضي تمامًا (مصفوفات وهمية قديمة).
// ============================================================

// ✅ استخدام اسم مختلف (enhApiCall) عمدًا — كل صفحة أصلاً بتعرّف دالة apiCall
// محلية بنفس المنطق بالظبط، فلو استخدمنا نفس الاسم هنا كان هيحصل تعريف
// مكرر لدالة عالمية في نفس الصفحة (مش خطأ فعلي بما إن الاتنين بينفذوا
// نفس الحاجة، لكنه مش ممارسة نضيفة نتجنبها بسهولة).
async function enhApiCall(path, options = {}) {
  return window.HyperTechAuth.request(path, options);
}

// الصفحة الأقرب لكل دور — تُستخدم للتنقل من إشعار أو "مطلوب مني"
const ROLE_HOME_PAGE = {
  hr: "factory-intake.html",
  hr_manager: "factory-intake.html",
  sales_manager: "sales.html",
  online_seller: "sales.html",
  offline_seller: "sales.html",
  executive_manager: "production.html",
  operations_manager: "factory-production-manager.html",
  // Phase 2: purchases.html removed along with the full purchasing module.
  // Pointing these two roles at the dashboard until Phase 5 introduces a
  // minimal purchase-request page.
  purchasing_manager: "index.html",
  buyer: "index.html",
  production_manager: "factory-production-manager.html",
  production_controller: "factory-production-manager.html",
  warehouse_manager: "factory-warehouse-manager.html",
  storekeeper: "factory-warehouse-manager.html",
  supervisor: "factory-supervisor.html",
  quality_controller: "factory-quality-controller.html",
  production_quality_controller: "factory-quality-controller.html",
  raw_material_quality_controller: "factory-quality-controller.html",
  quality_engineer: "factory-quality-controller.html",
  admin: "production.html",
  manager: "production.html",
  chairman: "production.html",
};

function escHtmlLocal(str) {
  const div = document.createElement("div");
  div.textContent = str === null || str === undefined ? "" : String(str);
  return div.innerHTML;
}

function timeAgo(dateStr) {
  const diff = Math.max(0, Date.now() - new Date(dateStr).getTime());
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "الآن";
  if (mins < 60) return `منذ ${mins} د`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `منذ ${hrs} س`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `منذ ${days} يوم`;
  return new Date(dateStr).toLocaleDateString("ar-EG", {
    day: "numeric",
    month: "short",
  });
}

// ✅ يحسب موقع اللوحة عن طريق getBoundingClientRect بدل الاعتماد على ترتيب
// الـ DOM في كل صفحة (السبب الأصلي في ظهورها في مكان غلط أو مش ظاهرة خالص)
function positionPanel(panel, anchorEl) {
  const rect = anchorEl.getBoundingClientRect();
  panel.style.position = "fixed";
  panel.style.top = `${rect.bottom + 8}px`;
  const rightEdge = window.innerWidth - rect.right;
  panel.style.left = "";
  panel.style.right = `${Math.max(8, rightEdge - 140)}px`;
  if (window.innerWidth < 480) {
    panel.style.right = "8px";
    panel.style.left = "8px";
    panel.style.width = "auto";
  }
}

// ===== USER MENU =====
class UserMenu {
  constructor() {
    this.userCard = document.querySelector(".user-card");
    this.menuButton = this.userCard?.querySelector(".fa-ellipsis-vertical");
    this.init();
  }
  init() {
    if (!this.userCard || !this.menuButton) return;
    this.userCard.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggle();
    });
    document.addEventListener("click", () => this.close());
    this.createMenu();
  }
  createMenu() {
    const menu = document.createElement("div");
    menu.className = "user-menu";
    menu.id = "user-menu";
    menu.innerHTML = `
      <a href="settings.html" class="user-menu-item"><i class="fa-solid fa-user"></i> الملف الشخصي</a>
      <a href="settings.html" class="user-menu-item"><i class="fa-solid fa-sliders"></i> الإعدادات</a>
      <a href="#" id="menu-change-password" class="user-menu-item"><i class="fa-solid fa-key"></i> تغيير كلمة المرور</a>
      <a href="#" id="menu-logout" class="user-menu-item danger"><i class="fa-solid fa-sign-out-alt"></i> تسجيل الخروج</a>
    `;
    document.body.appendChild(menu);
    menu
      .querySelector("#menu-change-password")
      .addEventListener("click", (e) => {
        e.preventDefault();
        this.close();
        openChangePasswordModal();
      });
    menu.querySelector("#menu-logout").addEventListener("click", (e) => {
      e.preventDefault();
      if (confirm("هل أنت متأكد من رغبتك في تسجيل الخروج؟")) {
        window.HyperTechAuth.logout(); // ✅ بيمسح الجلسة الحقيقية فعليًا
      }
    });
  }
  toggle() {
    const menu = document.getElementById("user-menu");
    if (!menu) return;
    const willOpen = !menu.classList.contains("active");
    document
      .querySelectorAll(".enh-panel.active, .user-menu.active")
      .forEach((p) => p.classList.remove("active"));
    if (willOpen) {
      positionPanel(menu, this.userCard);
      menu.classList.add("active");
    }
    this.menuButton.classList.toggle("active", willOpen);
  }
  close() {
    document.getElementById("user-menu")?.classList.remove("active");
    this.menuButton?.classList.remove("active");
  }
}

// ===== NOTIFICATIONS SYSTEM =====
class NotificationsSystem {
  constructor() {
    this.bell = document.querySelectorAll(".icon-btn")[0] || null;
    this.notifications = [];
    this.init();
  }
  init() {
    if (!this.bell) return;
    this.createPanel();
    this.bell.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggle();
    });
    document.addEventListener("click", () => this.close());
    this.load();
    setInterval(() => this.load(), 60000); // تحديث كل دقيقة
  }
  createPanel() {
    const panel = document.createElement("div");
    panel.className = "enh-panel notifications-panel";
    panel.id = "notif-panel";
    panel.innerHTML = `
      <div class="notif-header">
        <h4>الإشعارات</h4>
        <button class="notif-clear-btn" id="notif-mark-all">تعليم الكل كمقروء</button>
      </div>
      <div id="notif-list"></div>
    `;
    document.body.appendChild(panel);
    panel.addEventListener("click", (e) => e.stopPropagation());
    panel
      .querySelector("#notif-mark-all")
      .addEventListener("click", () => this.markAllRead());
  }
  async load() {
    try {
      // القائمة مطلوبة عند فتح الجرس، أما العدد فيأتي من SQL COUNT حتى لا
      // نضطر لتحميل كل الإشعارات لمجرد إظهار النقطة على الجرس.
      const [listResult, countResult] = await Promise.allSettled([
        enhApiCall("/notifications"),
        enhApiCall("/notifications/unread-count"),
      ]);
      if (listResult.status === "fulfilled") {
        this.notifications = listResult.value?.data || [];
        this.render();
      }
      if (countResult.status === "fulfilled") {
        this.updateBadge(Number(countResult.value?.count) || 0);
      } else if (listResult.status === "fulfilled") {
        this.updateBadge(this.notifications.filter((n) => !n.isRead).length);
      }
    } catch {
      // فشل التحميل بصمت — الجرس هيفضل شغال، بس من غير محتوى جديد
    }
  }
  render() {
    const list = document.getElementById("notif-list");
    if (!list) return;
    if (!this.notifications.length) {
      list.innerHTML =
        '<div class="notif-empty"><i class="fa-solid fa-bell-slash"></i><p>لا توجد إشعارات</p></div>';
    } else {
      list.innerHTML = this.notifications
        .slice(0, 25)
        .map(
          (n) => `
        <div class="notif-item ${n.isRead ? "" : "unread"}" data-id="${n.id}" data-ref-type="${n.referenceType || ""}">
          <div class="notif-item-title">${!n.isRead ? '<span class="notif-unread-dot"></span>' : ""}${escHtmlLocal(n.title)}</div>
          <div class="notif-item-text">${escHtmlLocal(n.body)}</div>
          <div class="notif-item-time">${timeAgo(n.createdAt)}</div>
        </div>`,
        )
        .join("");
      list
        .querySelectorAll(".notif-item")
        .forEach((el) =>
          el.addEventListener("click", () =>
            this.handleClick(Number(el.dataset.id), el.dataset.refType),
          ),
        );
    }
    const unreadCount = this.notifications.filter((n) => !n.isRead).length;
    this.updateBadge(unreadCount);
  }
  updateBadge(count) {
    const dot = this.bell.querySelector(".notif-dot");
    if (dot) dot.style.display = count > 0 ? "block" : "none";
  }
  async handleClick(id, refType) {
    try {
      await enhApiCall(`/notifications/${id}/read`, { method: "PATCH" });
      const n = this.notifications.find((x) => x.id === id);
      if (n) n.isRead = true;
      this.render();
    } catch {}
    this.close();
    if (refType === "production_workflow") navigateToMyHome();
  }
  async markAllRead() {
    try {
      await enhApiCall("/notifications/read-all", { method: "PATCH" });
      this.notifications.forEach((n) => (n.isRead = true));
      this.render();
    } catch (e) {
      showEnhToast("تعذّر تعليم الإشعارات: " + e.message, true);
    }
  }
  toggle() {
    const panel = document.getElementById("notif-panel");
    if (!panel) return;
    const willOpen = !panel.classList.contains("active");
    document
      .querySelectorAll(".enh-panel.active, .user-menu.active")
      .forEach((p) => p.classList.remove("active"));
    if (willOpen) {
      positionPanel(panel, this.bell);
      panel.classList.add("active");
    }
  }
  close() {
    document.getElementById("notif-panel")?.classList.remove("active");
  }
}

// ===== MY ACTIONS (✨ الميزة الجديدة — بدل أيقونة الإيميل الميتة) =====
// بيحسب "مطلوب مني دلوقتي" بشكل مخصص لكل دور، من نفس بيانات دورة الإنتاج
// الحقيقية المستخدمة في كل صفحات الفاكتوري — عشان محدش يحتاج يفتح كل
// صفحة على حدة بس عشان يعرف هل فيه حاجة مستنياه.
class MyActionsSystem {
  constructor() {
    this.icon = this.ensureIcon();
    this.items = [];
    this.init();
  }
  // ✅ أغلب الصفحات فيها أيقونة الجرس بس من غير أيقونة تانية جنبها — بدل ما
  // أعتمد على وجود عنصر ثاني جاهز في كل صفحة (مش موجود في أغلبها)، بنبنيه
  // بنفسنا ونحطه جنب الجرس مباشرة، فالميزة تشتغل بلا استثناء في كل الصفحات.
  ensureIcon() {
    const icons = document.querySelectorAll(".icon-btn");
    if (icons.length >= 2) return icons[1];
    const bell = icons[0];
    if (!bell) return null;
    const newIcon = document.createElement("div");
    newIcon.className = "icon-btn";
    bell.insertAdjacentElement("afterend", newIcon);
    return newIcon;
  }
  async init() {
    if (!this.icon) return;
    this.icon.innerHTML =
      '<i class="fa-solid fa-list-check"></i><div class="notif-dot" id="actions-dot" style="display:none"></div>';
    this.createPanel();
    this.icon.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggle();
    });
    document.addEventListener("click", () => this.close());
    await window.HyperTechAuth.ready;
    this.load();
    setInterval(() => this.load(), 60000);
  }
  createPanel() {
    const panel = document.createElement("div");
    panel.className = "enh-panel notifications-panel";
    panel.id = "actions-panel";
    panel.innerHTML = `
      <div class="notif-header"><h4><i class="fa-solid fa-list-check"></i> مطلوب مني الآن</h4></div>
      <div id="actions-list"></div>
    `;
    document.body.appendChild(panel);
    panel.addEventListener("click", (e) => e.stopPropagation());
  }
  async load() {
    const me = window.HyperTechAuth.user;
    if (!me) return;
    try {
      const res = await enhApiCall("/production-workflow");
      const orders = res?.data || [];
      this.items = this.computeForRole(orders, me);
      this.render();
    } catch {
      // بعض الأدوار مالهاش صلاحية أصلاً — نتجاهل بهدوء، مش كل صفحة محتاجة اللوحة دي
    }
  }
  computeForRole(orders, me) {
    switch (me.role) {
      case "hr":
        return orders
          .filter((o) => o.workflowStatus === "delivery_pending_customer")
          .map((o) => ({ ...o, actionLabel: "بانتظار تأكيدك للتسليم للعميل" }));
      case "production_manager":
        return orders
          .filter((o) => o.workflowStatus === "new")
          .map((o) => ({ ...o, actionLabel: "بانتظار استلامك وتوزيعه" }));
      case "warehouse_manager":
        return orders
          .filter((o) =>
            ["materials_requested", "delivery_pending_warehouse"].includes(
              o.workflowStatus,
            ),
          )
          .map((o) => ({
            ...o,
            actionLabel:
              o.workflowStatus === "materials_requested" ?
                "بانتظار قرارك في المواد"
              : "بانتظار تأكيد استلامك",
          }));
      case "supervisor":
        return orders
          .filter(
            (o) =>
              o.workflowStatus === "in_production" && o.supervisorId === me.id,
          )
          .map((o) => ({ ...o, actionLabel: "بانتظار تقدّم المرحلة" }));
      case "production_quality_controller":
        return orders
          .filter(
            (o) =>
              o.workflowStatus === "quality_check" &&
              o.qualityControllerUserId === me.id,
          )
          .map((o) => ({ ...o, actionLabel: "بانتظار فحص الجودة" }));
      case "chairman":
      case "executive_manager":
        return orders
          .filter((o) =>
            [
              "new",
              "materials_requested",
              "delivery_pending_customer",
              "delivery_pending_warehouse",
            ].includes(o.workflowStatus),
          )
          .map((o) => ({
            ...o,
            actionLabel: "عالق بانتظار خطوة من أحد الأدوار",
          }));
      default:
        return [];
    }
  }
  render() {
    const list = document.getElementById("actions-list");
    if (!list) return;
    if (!this.items.length) {
      list.innerHTML =
        '<div class="notif-empty"><i class="fa-solid fa-champagne-glasses"></i><p>مفيش أي حاجة مستنياك دلوقتي 👏</p></div>';
    } else {
      list.innerHTML = this.items
        .slice(0, 20)
        .map(
          (o) => `
        <div class="notif-item" onclick="navigateToMyHome()">
          <div class="notif-item-title"><span class="notif-unread-dot"></span>${escHtmlLocal(o.orderNumber)} — ${escHtmlLocal(o.productName)}</div>
          <div class="notif-item-text">${escHtmlLocal(o.actionLabel)}</div>
          <div class="notif-item-time">${o.qty} ${escHtmlLocal(o.unit || "")}</div>
        </div>`,
        )
        .join("");
    }
    const dot = document.getElementById("actions-dot");
    if (dot) dot.style.display = this.items.length > 0 ? "block" : "none";
  }
  toggle() {
    const panel = document.getElementById("actions-panel");
    if (!panel) return;
    const willOpen = !panel.classList.contains("active");
    document
      .querySelectorAll(".enh-panel.active, .user-menu.active")
      .forEach((p) => p.classList.remove("active"));
    if (willOpen) {
      positionPanel(panel, this.icon);
      panel.classList.add("active");
    }
  }
  close() {
    document.getElementById("actions-panel")?.classList.remove("active");
  }
}

function navigateToMyHome() {
  const role = window.HyperTechAuth?.user?.role;
  location.href = ROLE_HOME_PAGE[role] || "index.html";
}

// ===== SEARCH — الآن بيدوّر في بيانات حقيقية عن طريق الـ API =====
class SearchSystem {
  constructor() {
    this.searchBox = document.querySelector(".search-box input");
    this.init();
  }
  init() {
    if (!this.searchBox) return;
    this.searchBox.addEventListener("input", (e) => {
      clearTimeout(this.searchTimeout);
      const q = e.target.value.trim();
      if (!q) return this.closeResults();
      this.searchTimeout = setTimeout(() => this.search(q), 350);
    });
    document.addEventListener("click", (e) => {
      if (
        !e.target.closest(".search-box") &&
        !e.target.closest("#search-results")
      )
        this.closeResults();
    });
    this.createPanel();
  }
  createPanel() {
    const panel = document.createElement("div");
    panel.className = "enh-panel search-results-panel";
    panel.id = "search-results";
    document.body.appendChild(panel);
    panel.addEventListener("click", (e) => e.stopPropagation());
  }
  async search(query) {
    const panel = document.getElementById("search-results");
    positionPanel(panel, this.searchBox.closest(".search-box"));
    panel.classList.add("active");
    panel.innerHTML =
      '<div class="search-empty"><i class="fa-solid fa-spinner fa-spin"></i> جاري البحث...</div>';
    try {
      const [sales, inventory, contacts] = await Promise.all([
        enhApiCall("/sales").catch(() => []),
        enhApiCall("/inventory").catch(() => []),
        enhApiCall("/contacts").catch(() => []),
      ]);
      const q = query.toLowerCase();
      const results = [
        ...sales
          .filter((s) => s.orderNumber.toLowerCase().includes(q))
          .map((s) => ({
            title: `فاتورة: ${s.orderNumber}`,
            type: "مبيعات",
            link: "sales.html",
          })),
        ...inventory
          .filter(
            (i) =>
              i.name.toLowerCase().includes(q) ||
              (i.code || "").toLowerCase().includes(q),
          )
          .map((i) => ({
            title: i.name,
            type: "صنف مخزون",
            link: "inventory.html",
          })),
        ...contacts
          .filter((c) => c.name.toLowerCase().includes(q))
          .map((c) => ({
            title: c.name,
            type: c.type === "supplier" ? "مورد" : "عميل",
            link: "contacts.html",
          })),
      ].slice(0, 8);
      this.render(results);
    } catch {
      panel.innerHTML = '<div class="search-empty">تعذّر البحث حاليًا</div>';
    }
  }
  render(results) {
    const panel = document.getElementById("search-results");
    if (!results.length) {
      panel.innerHTML = '<div class="search-empty">لا توجد نتائج</div>';
      return;
    }
    panel.innerHTML = results
      .map(
        (r) =>
          `<div class="search-result-item" onclick="location.href='${r.link}'"><div class="search-result-title">${escHtmlLocal(r.title)}</div><div class="search-result-type">${escHtmlLocal(r.type)}</div></div>`,
      )
      .join("");
  }
  closeResults() {
    document.getElementById("search-results")?.classList.remove("active");
  }
}

// ===== CHANGE PASSWORD — مودال حقيقي بدل prompt() =====
function openChangePasswordModal() {
  if (document.getElementById("enh-pw-overlay")) return;
  const overlay = document.createElement("div");
  overlay.id = "enh-pw-overlay";
  overlay.className = "modal-overlay open";
  overlay.innerHTML = `
    <div class="modal" style="max-width:380px">
      <div class="modal-head"><h3><i class="fa-solid fa-key"></i> تغيير كلمة المرور</h3>
        <button class="modal-close" id="enh-pw-close"><i class="fa-solid fa-xmark"></i></button></div>
      <div class="modal-body">
        <div class="form-group"><label>كلمة المرور الحالية</label><input type="password" id="enh-pw-current"/></div>
        <div class="form-group"><label>كلمة المرور الجديدة</label><input type="password" id="enh-pw-new"/>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px">8 أحرف على الأقل، حرف كبير وصغير ورقم</div></div>
        <div class="form-group"><label>تأكيد كلمة المرور الجديدة</label><input type="password" id="enh-pw-confirm"/></div>
      </div>
      <div class="modal-foot">
        <button class="btn-primary" id="enh-pw-save"><i class="fa-solid fa-check"></i> حفظ</button>
        <button class="btn-ghost" id="enh-pw-cancel">إلغاء</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  // ✅ إصلاح: الاستدعاء القديم window.dispatchEvent(new Event("DOMContentLoaded"))
  // ما كانش بيوصل خالص (الحدث بيتسمع عليه في document مش window، وinit()
  // أصلاً بتتنفذ فورًا عند التحميل من غير أي مستمع). دلوقتي بننده الدالة
  // الحقيقية مباشرة عشان تلحق حقول الباسورد التلاتة اللي اتولدت للتو.
  window.refreshPasswordToggles?.();

  const close = () => overlay.remove();
  overlay.querySelector("#enh-pw-close").addEventListener("click", close);
  overlay.querySelector("#enh-pw-cancel").addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector("#enh-pw-save").addEventListener("click", async () => {
    const currentPassword = document.getElementById("enh-pw-current").value;
    const newPassword = document.getElementById("enh-pw-new").value;
    const confirm2 = document.getElementById("enh-pw-confirm").value;
    if (!currentPassword || !newPassword)
      return showEnhToast("املأ كل الحقول", true);
    if (newPassword !== confirm2)
      return showEnhToast("كلمة المرور الجديدة غير متطابقة", true);
    try {
      const res = await enhApiCall("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      showEnhToast(res.message || "تم تغيير كلمة المرور بنجاح");
      close();
    } catch (e) {
      showEnhToast(e.message, true);
    }
  });
}

function showEnhToast(msg, warn = false) {
  let toast = document.getElementById("toast");
  if (!toast) {
    // بعض الصفحات مفيهاش عنصر toast جاهز — نعمل واحد بسيط سريع
    alert(msg);
    return;
  }
  const msgEl =
    document.getElementById("toast-msg") || toast.querySelector("span");
  if (msgEl) msgEl.textContent = msg;
  toast.style.background = warn ? "var(--red)" : "var(--green)";
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
}

// ===== ✨ DELEGATION BADGE — شارة الشفافية =====
// أي مستخدم عنده استثناء صلاحيات نشط (تفويض أو تقييد) بيشوف شارة صغيرة
// على كارت اسمه، مع تفاصيل الاستثناء في tooltip — من غير ما يدوّر أو يسأل.
class DelegationBadge {
  constructor() {
    this.userCard = document.querySelector(".user-card");
    this.init();
  }
  async init() {
    if (!this.userCard) return;
    let overrides;
    try {
      overrides = await enhApiCall("/my-permission-overrides");
    } catch {
      return; // فشل هادئ — الشارة كماليّة، مش لازم توقف باقي الصفحة
    }
    if (!overrides || !overrides.length) return;

    const hasGrant = overrides.some((o) => o.allowed);
    const hasRestriction = overrides.some((o) => !o.allowed);
    const badge = document.createElement("div");
    badge.className =
      "delegation-badge" + (hasRestriction && !hasGrant ? " restricted" : "");
    badge.innerHTML = `<i class="fa-solid fa-bolt"></i>`;

    const lines = overrides.map((o) => {
      const until =
        o.expiresAt ?
          `حتى ${new Date(o.expiresAt).toLocaleDateString("ar-EG")}`
        : "دائم";
      return `${o.allowed ? "✓" : "✕"} ${escHtmlLocal(o.label)} — ${until}`;
    });
    badge.title =
      (hasGrant ? "لديك صلاحيات إضافية مؤقتة:\n" : "لديك قيود حالية:\n") +
      lines.join("\n");

    this.userCard.appendChild(badge);
  }
}

// ===== INIT =====
document.addEventListener("DOMContentLoaded", () => {
  new UserMenu();
  new NotificationsSystem();
  new MyActionsSystem();
  new SearchSystem();
  new DelegationBadge();
});
