/** @format */
// ============================================================
//  PORTAL CATALOG — بوابة عملاء الجملة
//  تصفّح المنتجات (متاح من غير تسجيل دخول) + سلة طلب + إرسال —
//  عند الإرسال، السلة بتتحوّل لأوامر إنتاج حقيقية عن طريق /portal/orders
// ============================================================

const PORTAL_SESSION_KEY = "hyper_erp_portal_session";
const CART_KEY = "hyper_erp_portal_cart";

function reportPortalError(context, error) {
  console.error("[portal]", {
    context,
    message: error instanceof Error ? error.message : String(error),
    status: error?.status,
    sessionExpired: Boolean(error?.sessionExpired),
  });
}

function updateOfflineBanner() {
  const banner = document.getElementById("portal-offline-banner");
  if (!banner) return;
  banner.classList.toggle("open", !navigator.onLine);
}

function markPortalSynced(id) {
  const element = document.getElementById(id);
  if (element) element.textContent = `آخر تحديث: ${new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}`;
}

function setPortalButtonBusy(button, busy, busyLabel = "جاري التنفيذ...") {
  if (!button) return;
  if (busy) {
    button.dataset.portalOriginalLabel = button.innerHTML;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${busyLabel}`;
  } else {
    button.innerHTML = button.dataset.portalOriginalLabel || button.innerHTML;
    delete button.dataset.portalOriginalLabel;
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}

function getSession() {
  for (const storage of [localStorage, sessionStorage]) {
    const persisted = storage.getItem(PORTAL_SESSION_KEY);
    if (!persisted) continue;
    try {
      return JSON.parse(persisted);
    } catch {
      storage.removeItem(PORTAL_SESSION_KEY);
    }
  }
  return null;
}
function saveSession(session) {
  const target = session?.rememberMe === true ? localStorage : sessionStorage;
  const other = target === localStorage ? sessionStorage : localStorage;
  target.setItem(PORTAL_SESSION_KEY, JSON.stringify(session));
  other.removeItem(PORTAL_SESSION_KEY);
}
function clearSession() {
  localStorage.removeItem(PORTAL_SESSION_KEY);
  sessionStorage.removeItem(PORTAL_SESSION_KEY);
}
let expiredSessionHandled = false;
function handleExpiredPortalSession() {
  clearSession();
  if (expiredSessionHandled) return;
  expiredSessionHandled = true;
  updateAccountLink();
  document.getElementById("btn-my-orders")?.style.setProperty("display", "none");
  document.getElementById("btn-wishlist")?.style.setProperty("display", "none");
  const toast = document.getElementById("toast-msg");
  if (toast) {
    toast.textContent = "انتهت جلسة الدخول. سيتم تحويلك لتسجيل الدخول.";
    document.getElementById("toast")?.classList.add("show", "warn");
  }
  window.setTimeout(() => {
    if (!location.pathname.endsWith("portal-login.html")) {
      location.href = "portal-login.html";
    }
  }, 700);
}
function isLoggedIn() {
  return !!getSession()?.token;
}

async function portalApiCall(path, options = {}) {
  const session = getSession();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (session?.token) headers["Authorization"] = `Bearer ${session.token}`;

  let res;
  try {
    res = await fetch(`/api/v1${path}`, { ...options, headers });
  } catch (error) {
    reportPortalError(path, error);
    throw new Error(
      "تعذّر الاتصال بالخادم. تأكد من اتصال الإنترنت وحاول مرة أخرى.",
    );
  }
  if (!res.ok) {
    let msg = `خطأ (${res.status})`;
    try {
      const data = await res.json();
      msg = data?.error?.message || msg;
    } catch {}
    const error = new Error(msg);
    error.status = res.status;
    reportPortalError(path, error);
    if (res.status === 401 && session?.token) {
      handleExpiredPortalSession();
      error.sessionExpired = true;
      error.message = "انتهت جلسة الدخول. اضغط «تسجيل الدخول» للدخول بحساب آخر.";
    }
    throw error;
  }
  if (res.status === 204) return null;
  let body;
  try {
    body = await res.json();
  } catch (error) {
    reportPortalError(`${path}:parse-response`, error);
    throw new Error("استلمنا ردًا غير مفهوم من الخادم. حاول مرة أخرى.");
  }
  // The API envelope is { data: payload }. Unwrap it here so catalog and
  // order screens receive the arrays/objects they expect.
  return body && Object.prototype.hasOwnProperty.call(body, "data")
    ? body.data
    : body;
}

/* ── State ── */
let products = [];
let searchQuery = "";
let popularOnly = false;
let activeProduct = null; // المنتج المفتوح في المودال حاليًا
let cart = JSON.parse(sessionStorage.getItem(CART_KEY) || "[]");
let wishlistIds = new Set();
let wishlistItems = [];
let minimumOrderQuantity = 1;
let portalNotificationPollTimer = null;
let portalNotificationCount = 0;
let portalNotificationsPage = 1;
let portalNotificationsHasMore = false;
let portalOrdersPage = 1;
let portalOrdersHasMore = false;
/* ── Icons: توليد أيقونة مميّزة لكل منتج بناءً على اسمه (بديل احترافي بسيط عن صورة حقيقية) ── */
const PRODUCT_ICONS = [
  "fa-gear",
  "fa-bolt",
  "fa-cube",
  "fa-industry",
  "fa-microchip",
  "fa-cog",
  "fa-layer-group",
  "fa-shapes",
];
function iconFor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++)
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return PRODUCT_ICONS[Math.abs(hash) % PRODUCT_ICONS.length];
}

/* ── Init ── */
(async function init() {
  updateAccountLink();
  updateCartBadge();
  bindEvents();
  updateOfflineBanner();
  // ✅ إصلاح باگ: الدالة دي كانت معرَّفة بس مش متنادى خالص من أي مكان،
  // فإعداد "الحد الأدنى للطلب" المضبوط من الإدارة كان بيتجاهل تمامًا،
  // ويفضل ثابت على القيمة الافتراضية (1) لكل عميل مهما كان الإعداد الحقيقي.
  await Promise.all([loadPortalConfig(), loadProducts()]);
  await Promise.all([loadAuthenticatedCart(), loadWishlist()]);
  startPortalNotificationPolling();
})();

/* ── Portal notifications: polling فقط، متسق مع بنية المشروع الحالية ── */
function updatePortalNotificationBadge(count) {
  const badge = document.getElementById("portal-notifications-badge");
  const label = document.getElementById("portal-notifications-count");
  portalNotificationCount = Number(count) || 0;
  if (badge) {
    badge.textContent = portalNotificationCount > 99 ? "99+" : portalNotificationCount;
    badge.style.display = portalNotificationCount > 0 ? "flex" : "none";
  }
  if (label) {
    label.textContent = portalNotificationCount
      ? `${portalNotificationCount} غير مقروء`
      : "كلها مقروءة";
  }
}

window.addEventListener("online", updateOfflineBanner);
window.addEventListener("offline", updateOfflineBanner);
window.addEventListener("storage", (event) => {
  if (event.key === PORTAL_SESSION_KEY && !event.newValue && event.oldValue) {
    handleExpiredPortalSession();
  }
});

async function loadPortalNotificationCount() {
  if (!isLoggedIn()) {
    updatePortalNotificationBadge(0);
    return;
  }
  try {
    const result = await portalApiCall("/portal/notifications/unread-count");
    updatePortalNotificationBadge(result.count);
  } catch (error) {
    if (!error.sessionExpired) console.warn("تعذّر تحديث عدّاد الإشعارات", error);
  }
}

function renderPortalNotifications(notifications) {
  const list = document.getElementById("portal-notifications-list");
  if (!list) return;
  if (!notifications.length) {
    list.innerHTML =
      '<div class="p-notifications-empty"><i class="fa-regular fa-bell-slash"></i><br>لا توجد إشعارات جديدة</div>';
    return;
  }
  list.innerHTML = notifications
    .map(
      (notification) => `
        <button
          type="button"
          class="p-notification-item ${notification.isRead ? "" : "unread"}"
          data-portal-notification-id="${notification.id}"
        >
          <span class="p-notification-title">
            ${notification.isRead ? "" : '<span class="p-notification-dot"></span>'}
            ${escHtml(notification.title)}
          </span>
          <span class="p-notification-body">${escHtml(notification.body)}</span>
          <time class="p-notification-date">${formatDateTime(notification.createdAt)}</time>
        </button>`,
    )
    .join("");
  list.querySelectorAll("[data-portal-notification-id]").forEach((item) => {
    item.addEventListener("click", () =>
      markPortalNotificationRead(Number(item.dataset.portalNotificationId)),
    );
  });
}

function renderPortalNotificationsPagination(list) {
  if (!list) return;
  const controls = document.createElement("div");
  controls.className = "p-pagination";
  controls.innerHTML = `
    <button type="button" ${portalNotificationsPage <= 1 ? "disabled" : ""}>السابق</button>
    <span>صفحة ${portalNotificationsPage}</span>
    <button type="button" ${portalNotificationsHasMore ? "" : "disabled"}>التالي</button>`;
  const [previous, next] = controls.querySelectorAll("button");
  previous.addEventListener("click", () => loadPortalNotifications(portalNotificationsPage - 1));
  next.addEventListener("click", () => loadPortalNotifications(portalNotificationsPage + 1));
  list.appendChild(controls);
}

async function loadPortalNotifications(page = 1) {
  const list = document.getElementById("portal-notifications-list");
  if (!list) return;
  list.innerHTML =
    '<div class="p-notifications-empty"><i class="fa-solid fa-spinner fa-spin"></i><br>جاري تحميل الإشعارات...</div>';
  try {
    const limit = 10;
    const notifications = await portalApiCall(
      `/portal/notifications?limit=${limit}&page=${Math.max(1, page)}`,
    );
    portalNotificationsPage = Math.max(1, page);
    portalNotificationsHasMore =
      Array.isArray(notifications) && notifications.length === limit;
    renderPortalNotifications(Array.isArray(notifications) ? notifications : []);
    renderPortalNotificationsPagination(list);
    markPortalSynced("portal-notifications-synced");
    await loadPortalNotificationCount();
  } catch (error) {
    list.innerHTML = `<div class="p-notifications-empty">تعذّر تحميل الإشعارات: ${escHtml(error.message)}</div>`;
  }
}

async function openPortalNotifications() {
  const panel = document.getElementById("portal-notifications-panel");
  const button = document.getElementById("btn-notifications");
  if (!panel || !button) return;
  const willOpen = !panel.classList.contains("open");
  panel.classList.toggle("open", willOpen);
  button.setAttribute("aria-expanded", String(willOpen));
  if (!willOpen) return;
  const list = document.getElementById("portal-notifications-list");
  if (!isLoggedIn()) {
    list.innerHTML =
      '<div class="p-notifications-empty">سجّل الدخول لعرض إشعارات طلباتك</div>';
    return;
  }
  await loadPortalNotifications(1);
}

async function markPortalNotificationRead(id) {
  if (!id) return;
  try {
    await portalApiCall(`/portal/notifications/${id}/read`, { method: "PATCH" });
    await loadPortalNotificationCount();
    const item = document.querySelector(
      `[data-portal-notification-id="${id}"]`,
    );
    item?.classList.remove("unread");
    item?.querySelector(".p-notification-dot")?.remove();
  } catch (error) {
    showToast(`تعذّر تحديث الإشعار: ${error.message}`, true);
  }
}

function startPortalNotificationPolling() {
  if (portalNotificationPollTimer) clearInterval(portalNotificationPollTimer);
  loadPortalNotificationCount();
  portalNotificationPollTimer = setInterval(loadPortalNotificationCount, 25000);
}

/* ── Account Panel & My Orders ── */

// حالة الأمر بمصطلحات مفهومة للعميل (مش نفس المصطلحات الداخلية للموظفين)
const CUSTOMER_STATUS_MAP = {
  new: { label: "قيد المراجعة", cls: "pending" },
  pending_supervisor: { label: "قيد المراجعة", cls: "pending" },
  materials_requested: { label: "قيد التجهيز", cls: "pending" },
  materials_approved: { label: "قيد التجهيز", cls: "pending" },
  materials_partial: { label: "قيد التجهيز", cls: "pending" },
  materials_rejected: { label: "قيد المراجعة من فريقنا", cls: "pending" },
  in_production: { label: "قيد التصنيع", cls: "progress" },
  quality_check: { label: "فحص الجودة النهائي", cls: "progress" },
  completed: { label: "جاهز للتسليم", cls: "progress" },
  delivery_pending_customer: { label: "جارٍ تجهيز التسليم", cls: "progress" },
  delivery_pending_warehouse: { label: "جارٍ تجهيز التسليم", cls: "progress" },
  delivered_customer: { label: "تم التسليم ✓", cls: "done" },
  delivered_warehouse: { label: "تم التسليم ✓", cls: "done" },
  cancelled: { label: "ملغي", cls: "cancelled" },
};

// ✅ إصلاح حرج: الضغط على اسم العميل كان بيعمل تسجيل خروج فوري من غير ما
// يعرض أي بيانات — نفس النمط اللي كان موجود في لوحة تحكم الموظفين وتصلّح
// هناك. دلوقتي الضغط على الاسم بيفتح لوحة فيها بياناته المسجلة الحقيقية
// (من /portal/me) + تسجيل الخروج بقى فعل واعي داخل اللوحة، مش ضغطة عرضية.
function updateAccountLink() {
  const link = document.getElementById("account-link");
  const myOrdersBtn = document.getElementById("btn-my-orders");
  const wishlistBtn = document.getElementById("btn-wishlist");
  const session = getSession();
  if (session?.customer) {
    link.innerHTML = `<i class="fa-solid fa-circle-user"></i> ${escHtml(session.customer.fullName)}`;
    link.href = "#";
    link.onclick = (e) => {
      e.preventDefault();
      openAccountPanel();
    };
    if (myOrdersBtn) {
      myOrdersBtn.style.display = "flex";
      myOrdersBtn.onclick = openMyOrders;
    }
    if (wishlistBtn) wishlistBtn.style.display = "flex";
  } else {
    link.innerHTML = `<i class="fa-regular fa-user"></i> تسجيل الدخول بحساب آخر`;
    link.href = "portal-login.html";
    link.onclick = null;
    if (myOrdersBtn) myOrdersBtn.style.display = "none";
    if (wishlistBtn) wishlistBtn.style.display = "none";
  }
}

async function openAccountPanel() {
  const overlay = document.getElementById("account-overlay");
  const body = document.getElementById("account-body");
  overlay.classList.add("open");
  body.innerHTML = `<div class="p-empty" style="padding:30px 0"><i class="fa-solid fa-spinner fa-spin"></i></div>`;
  try {
    const me = await portalApiCall("/portal/me");
    let sessions = [];
    let sessionsError = null;
    try {
      sessions = await portalApiCall("/portal/sessions");
    } catch (error) {
      sessionsError = error;
    }
    body.innerHTML = `
      <div class="p-account-field"><span>الاسم الكامل</span><strong>${escHtml(me.fullName)}</strong></div>
      <div class="p-account-field"><span>رقم الهاتف</span><strong>${escHtml(me.phone)}</strong></div>
      <div class="p-account-field"><span>البريد الإلكتروني</span><strong>${me.email ? escHtml(me.email) : "—"}</strong></div>
       <div class="p-account-field"><span>اسم الشركة</span><strong>${escHtml(me.companyName)}</strong></div>
       <div class="p-account-field"><span>المحافظة</span><strong>${me.city ? escHtml(me.city) : "—"}</strong></div>
       <div class="p-account-field"><span>العنوان التفصيلي</span><strong>${me.address ? escHtml(me.address) : "—"}</strong></div>
         ${renderPortalSessions(sessions, sessionsError)}
       <button class="p-add-btn" id="btn-account-edit" style="margin-top: 16px">
         <i class="fa-solid fa-pen"></i> تعديل البيانات
       </button>
      <button class="p-add-btn" id="btn-account-my-orders" style="margin-top: 16px">
        <i class="fa-solid fa-receipt"></i> عرض طلباتي
      </button>
      <button class="p-account-logout-btn" id="btn-account-logout">
        <i class="fa-solid fa-arrow-right-from-bracket"></i> تسجيل الخروج
      </button>
    `;
    document
      .getElementById("btn-account-edit")
      .addEventListener("click", () => renderAccountEdit(body, me));
    document
      .getElementById("btn-account-my-orders")
      .addEventListener("click", () => {
        overlay.classList.remove("open");
        openMyOrders();
      });
    document.querySelectorAll("[data-session-revoke]").forEach((button) => {
      button.addEventListener("click", () =>
        revokePortalSession(Number(button.dataset.sessionRevoke)),
      );
    });
    document
      .getElementById("btn-revoke-other-sessions")
      ?.addEventListener("click", revokeOtherPortalSessions);
    document
      .getElementById("btn-account-logout")
        .addEventListener("click", async () => {
        if (confirm("هل تريد تسجيل الخروج؟")) {
            const btn = document.getElementById("btn-account-logout");
            btn.disabled = true;
            try {
              await portalApiCall("/portal/logout", { method: "POST" });
            } catch {
              // Clearing the local session still protects this browser if
              // the network is unavailable; the server session remains
              // short-lived and can be revoked from session management later.
            } finally {
              clearSession();
              location.reload();
            }
        }
      });
  } catch (e) {
    body.innerHTML = `
      <div class="p-empty">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <p>${escHtml(e.message)}</p>
        ${
          e.sessionExpired
            ? `<a class="p-add-btn" href="portal-login.html" style="display:flex;text-decoration:none;margin-top:14px">تسجيل الدخول بحساب آخر</a>`
            : ""
        }
      </div>`;
  }
}

function formatMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? `${amount.toLocaleString("ar-EG", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })} ج.م`
    : "—";
}

function formatSessionDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("ar-EG", {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

function renderPortalSessions(sessions, error) {
  if (error) {
    return `<div class="p-sessions-card"><div class="p-sessions-title"><i class="fa-solid fa-shield-halved"></i> جلسات الدخول</div><div class="p-sessions-empty">تعذّر تحميل جلسات الدخول حاليًا.</div></div>`;
  }

  const otherSessions = sessions.filter((session) => !session.current);
  const rows = sessions
    .map(
      (session) => `
      <tr>
        <td>
          <strong>${escHtml(session.deviceLabel || "متصفح غير معروف")}</strong>
          ${session.current ? `<span class="p-session-current">الجلسة الحالية</span>` : ""}
        </td>
        <td>${escHtml(session.ipAddress || "غير متاح")}</td>
        <td>${formatSessionDate(session.lastActiveAt)}</td>
        <td>${session.rememberMe ? "مستمرة" : "عادية"}</td>
        <td>
          ${
            session.current
              ? `<span class="p-session-current">نشطة</span>`
              : `<button class="p-session-revoke-btn" data-session-revoke="${session.id}">إلغاء</button>`
          }
        </td>
      </tr>`,
    )
    .join("");

  return `
    <div class="p-sessions-card">
      <div class="p-sessions-head">
        <div class="p-sessions-title"><i class="fa-solid fa-shield-halved"></i> جلسات الدخول</div>
        <span class="p-sessions-count">${sessions.length} نشطة</span>
      </div>
      ${
        rows
          ? `<div class="p-sessions-table-wrap"><table class="p-sessions-table">
              <thead><tr><th>الجهاز</th><th>الشبكة</th><th>آخر نشاط</th><th>نوع التذكر</th><th></th></tr></thead>
              <tbody>${rows}</tbody>
            </table></div>`
          : `<div class="p-sessions-empty">لا توجد جلسات دخول نشطة.</div>`
      }
      <button class="p-sessions-revoke-all" id="btn-revoke-other-sessions" ${
        otherSessions.length ? "" : "disabled"
      }>
        <i class="fa-solid fa-power-off"></i> تسجيل خروج من كل الأجهزة الأخرى
      </button>
    </div>`;
}

async function revokePortalSession(sessionId) {
  if (!sessionId || !confirm("هل تريد إلغاء جلسة الدخول دي فورًا؟")) return;
  try {
    await portalApiCall(`/portal/sessions/${sessionId}`, { method: "DELETE" });
    showToast("تم إلغاء جلسة الدخول فورًا");
    await openAccountPanel();
  } catch (error) {
    showToast(`تعذّر إلغاء الجلسة: ${error.message}`, true);
  }
}

async function revokeOtherPortalSessions() {
  if (!confirm("سيتم تسجيل الخروج من كل الأجهزة الأخرى. هل تريد المتابعة؟")) return;
  const button = document.getElementById("btn-revoke-other-sessions");
  if (button) button.disabled = true;
  try {
    const result = await portalApiCall("/portal/sessions/revoke-others", {
      method: "POST",
    });
    showToast(result.message || "تم تسجيل الخروج من الأجهزة الأخرى");
    await openAccountPanel();
  } catch (error) {
    showToast(`تعذّر إلغاء الجلسات: ${error.message}`, true);
    if (button) button.disabled = false;
  }
}

function renderAccountEdit(body, me) {
  const governorates = Array.isArray(window.EGYPT_GOVERNORATES)
    ? window.EGYPT_GOVERNORATES
    : [];
  const governorateOptions = [
    '<option value="">اختر المحافظة...</option>',
    ...governorates.map(
      (governorate) =>
        `<option value="${escHtml(governorate)}" ${me.city === governorate ? "selected" : ""}>${escHtml(governorate)}</option>`,
    ),
  ].join("");
  body.innerHTML = `
    <h4 style="margin:0 0 14px">تعديل بيانات الحساب</h4>
    <div class="field"><label>الاسم الكامل *</label><input id="profile-name" value="${escHtml(me.fullName)}"></div>
    <div class="field"><label>رقم الهاتف *</label><input id="profile-phone" type="tel" value="${escHtml(me.phone)}"></div>
    <div class="field"><label>البريد الإلكتروني (اختياري)</label><input id="profile-email" type="email" value="${escHtml(me.email || "")}"></div>
    <div class="field"><label>اسم الشركة *</label><input id="profile-company" value="${escHtml(me.companyName || "")}"></div>
    <div class="field"><label for="profile-city">المحافظة (اختياري)</label><select id="profile-city">${governorateOptions}</select></div>
    <div class="field"><label>العنوان التفصيلي (اختياري)</label><textarea id="profile-address" rows="3">${escHtml(me.address || "")}</textarea></div>
    <div class="field"><label>اكتب كلمة المرور الحالية للتأكيد *</label><input id="profile-password" type="password"></div>
    <button class="p-add-btn" id="btn-account-save"><i class="fa-solid fa-floppy-disk"></i> حفظ التعديلات</button>
    <button class="p-account-logout-btn" id="btn-account-cancel">إلغاء</button>
  `;
  document
    .getElementById("btn-account-cancel")
    .addEventListener("click", () => openAccountPanel());
  document
    .getElementById("btn-account-save")
    .addEventListener("click", async () => {
      const btn = document.getElementById("btn-account-save");
      btn.disabled = true;
      try {
        const updated = await portalApiCall("/portal/me", {
          method: "PATCH",
          body: JSON.stringify({
            fullName: document.getElementById("profile-name").value.trim(),
            phone: document.getElementById("profile-phone").value.trim(),
            email:
              document.getElementById("profile-email").value.trim() || null,
            companyName: document
              .getElementById("profile-company")
              .value.trim(),
            city: document.getElementById("profile-city").value || null,
            address:
              document.getElementById("profile-address").value.trim() || null,
            currentPassword: document.getElementById("profile-password").value,
          }),
        });
        const session = getSession();
        session.customer = { ...session.customer, ...updated };
        saveSession(session);
        updateAccountLink();
        showToast("تم تحديث بياناتك بنجاح");
        openAccountPanel();
      } catch (e) {
        showToast(e.message, true);
        btn.disabled = false;
      }
    });
}

function portalRollupStatusLabel(status) {
  return (
    {
      all_cancelled: "كل الأصناف اتلغت",
      needs_attention: "محتاج انتباه — فيه صنف اتأجل أو اتلغى",
      all_completed: "اكتمل الطلب بالكامل",
      in_progress: "جاري التنفيذ",
      pending_review: "في انتظار مراجعة المبيعات",
    }[status] || status
  );
}

function portalDeliveryMethodLabel(value) {
  return value === "customer" ? "توصيل للعميل"
    : value === "warehouse" ? "استلام من المخزن"
    : null;
}

async function cancelPortalOrderItem(id, button) {
  if (!confirm("متأكد إنك عايز تلغي الصنف ده؟")) return;
  const reason = prompt("سبب الإلغاء (اختياري)") || null;
  if (button) button.disabled = true;
  try {
    await portalApiCall(`/portal/orders/${id}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
    showToast("تم إلغاء الصنف");
    await openMyOrders();
  } catch (error) {
    showToast(`تعذّر إلغاء الصنف: ${error.message}`, true);
    if (button) button.disabled = false;
  }
}

async function openMyOrders() {
  const overlay = document.getElementById("my-orders-overlay");
  const list = document.getElementById("my-orders-list");
  overlay.classList.add("open");
  list.innerHTML = `<div class="p-empty" style="padding:30px 0"><i class="fa-solid fa-spinner fa-spin"></i></div>`;
   try {
        const limit = 10;
        const response = await portalApiCall(`/portal/my-orders?limit=${limit}&page=${portalOrdersPage}`);
       const data = Array.isArray(response) ? response : response.data || [];
        portalOrdersHasMore = data.length === limit;
       markPortalSynced("my-orders-synced");
    if (!data.length) {
     list.innerHTML = `<div class="p-empty"><i class="fa-solid fa-receipt"></i><p>${portalOrdersPage > 1 ? "لا توجد طلبات أخرى" : "لسه مبعتش أي طلب"}</p></div>`;
     renderPortalOrdersPagination(list);
      return;
    }
       list.innerHTML = data
      .map((batch) => {
        const itemsHtml = batch.items
          .map((it) => {
             const timelineHtml = (it.timeline || [])
               .map(
                 (step) => `
                   <div class="p-timeline-step ${step.state}">
                     <span class="p-timeline-dot"><i class="fa-solid ${step.state === "reached" ? "fa-check" : step.state === "current" ? "fa-hourglass-half" : "fa-circle"}"></i></span>
                     <span class="p-timeline-label">${escHtml(step.label)}</span>
                     ${step.at ? `<time>${formatDateTime(step.at)}</time>` : ""}
                   </div>`,
               )
               .join("");
             const rejectionHtml = it.rejection
               ? `<div class="p-order-rejection">
                   <i class="fa-solid fa-circle-xmark"></i>
                   <div><strong>${it.rejection.type === "cancelled" ? "الطلب ملغي" : "تعذّر استكمال الطلب"}</strong>
                   ${it.rejection.reason ? `<span>${escHtml(it.rejection.reason)}</span>` : ""}</div>
                 </div>`
               : "";
            const metaBits = [];
            if (it.neededBy) metaBits.push(`<span><i class="fa-regular fa-calendar"></i> الميعاد المتوقع: ${escHtml(it.neededBy)}</span>`);
            if (it.referenceLineTotal) metaBits.push(`<span><i class="fa-solid fa-tag"></i> السعر التقديري: ${escHtml(it.referenceLineTotal)} ج.م</span>`);
            const deliveryLabel = portalDeliveryMethodLabel(it.suggestedDeliveryMethod);
            if (deliveryLabel) metaBits.push(`<span><i class="fa-solid fa-truck"></i> ${deliveryLabel}</span>`);
            const metaHtml = metaBits.length
              ? `<div class="p-order-item-meta" style="font-size:12px;color:var(--text-dim);display:flex;gap:14px;flex-wrap:wrap;margin:4px 0 8px">${metaBits.join("")}</div>`
              : "";
            const cancelBtnHtml = it.canCancel
              ? `<button type="button" class="p-order-item-cancel" style="font-size:12px;color:var(--danger,#e5484d);background:none;border:none;cursor:pointer;padding:0;margin-top:4px" onclick="cancelPortalOrderItem(${it.id}, this)"><i class="fa-solid fa-xmark"></i> إلغاء هذا الصنف</button>`
              : "";
            return `<div class="p-order-item">
               <div class="p-order-item-head">
                 <strong>${escHtml(it.productName)}</strong>
                 <em>(${escHtml(it.qty)} ${escHtml(it.unit || "")})</em>
               </div>
               ${metaHtml}
               ${
                 it.rejection
                   ? rejectionHtml
                   : `<div class="p-timeline">${timelineHtml}</div>`
               }
               ${cancelBtnHtml}
            </div>`;
          })
          .join("");
        const reviewHtml =
          batch.review ?
            `<div class="p-order-reply ${batch.review.status === "rejected" ? "rejected" : ""}">
              <i class="fa-solid ${batch.review.status === "rejected" ? "fa-circle-xmark" : "fa-comment-dots"}"></i>
               ${batch.review.expectedDelivery ? `<br><strong>الموعد المتوقع: ${escHtml(batch.review.expectedDelivery)}</strong>` : ""}
               ${escHtml(batch.review.replyMessage || (batch.review.status === "rejected" ? batch.review.rejectReason : ""))}
            </div>`
          : "";
        return `<div class="p-order-batch">
          <div class="p-order-batch-head">
            <span>${escHtml(batch.batchRef)}</span>
            <span class="p-order-date">${new Date(batch.createdAt).toLocaleDateString("ar-EG", { day: "numeric", month: "short", year: "numeric" })}</span>
          </div>
          <div class="p-order-batch-status ${escHtml(batch.overallStatus || "")}" style="font-size:12px;font-weight:600;margin:2px 0 10px;color:var(--text-dim)">
            ${escHtml(portalRollupStatusLabel(batch.overallStatus))}
          </div>
          ${itemsHtml}
            <button class="p-reorder-btn" type="button" onclick="reorderBatch(${JSON.stringify(batch.batchRef)})">
             <i class="fa-solid fa-rotate-left"></i> إعادة الطلب
           </button>
          ${reviewHtml}
        </div>`;
      })
      .join("");
      renderPortalOrdersPagination(list);
  } catch (e) {
    list.innerHTML = `<div class="p-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>تعذّر تحميل طلباتك: ${escHtml(e.message)}</p></div>`;
  }
}

function renderPortalOrdersPagination(list) {
  if (!list) return;
  const controls = document.createElement("div");
  controls.className = "p-pagination";
  controls.innerHTML = `
    <button type="button" ${portalOrdersPage <= 1 ? "disabled" : ""}>السابق</button>
    <span>صفحة ${portalOrdersPage}</span>
    <button type="button" ${portalOrdersHasMore ? "" : "disabled"}>التالي</button>`;
  const [previous, next] = controls.querySelectorAll("button");
  previous.addEventListener("click", () => {
    portalOrdersPage = Math.max(1, portalOrdersPage - 1);
    openMyOrders();
  });
  next.addEventListener("click", () => {
    portalOrdersPage += 1;
    openMyOrders();
  });
  list.appendChild(controls);
}

function formatDateTime(value) {
  return new Date(value).toLocaleString("ar-EG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function reorderBatch(batchRef) {
  try {
       const response = await portalApiCall("/portal/my-orders?limit=50&page=1");
       const orders = Array.isArray(response) ? response : response.data || [];
    const batch = orders.find((item) => item.batchRef === batchRef);
    if (!batch) {
      showToast("لم نتمكن من العثور على الطلب السابق", true);
      return;
    }

    const availableById = new Map(
      products.map((product) => [Number(product.id), product]),
    );
    const availableByCode = new Map();
    const availableByName = new Map();
    for (const product of products) {
      const code = product.productCode
        ? String(product.productCode).trim().toLowerCase()
        : "";
      const name = String(product.productName).trim().toLowerCase();
      if (code) {
        availableByCode.set(code, [
          ...(availableByCode.get(code) || []),
          product,
        ]);
      }
      availableByName.set(name, [
        ...(availableByName.get(name) || []),
        product,
      ]);
    }
    const findUniqueProduct = (map, value) => {
      if (!value) return null;
      const matches = map.get(String(value).trim().toLowerCase()) || [];
      return matches.length === 1 ? matches[0] : null;
    };
    const unavailable = [];
    let added = 0;

    for (const item of batch.items || []) {
      // bomRecipeId هو الرابط الأساسي. الـ code/name مجرد fallback للطلبات
      // القديمة التي أُنشئت قبل حفظ bomRecipeId داخل أمر الإنتاج.
      const product =
        availableById.get(Number(item.bomRecipeId)) ||
        findUniqueProduct(availableByCode, item.productCode) ||
        findUniqueProduct(availableByName, item.productName);
      if (!product) {
        unavailable.push(item.productName || "منتج غير معروف");
        continue;
      }
      try {
        await addProductToCart(
          product,
          Math.max(
            minimumOrderQuantity,
            Number(item.qty) || minimumOrderQuantity,
          ),
        );
        added += 1;
      } catch {
        unavailable.push(item.productName || product.productName);
      }
    }

    if (!added) {
      showToast("لم يعد أي منتج من الطلب السابق متاحًا في الكتالوج", true);
    } else if (unavailable.length) {
      showToast(
        `تمت إضافة ${added} صنف، والمنتج${unavailable.length > 1 ? "ات" : ""} غير المتاح${unavailable.length > 1 ? "ة" : ""}: ${unavailable.join("، ")}`,
        true,
      );
    } else {
      showToast("تمت إضافة الطلب السابق للسلة");
    }
    closeMyOrders();
    await openCart();
  } catch (error) {
    showToast(
      `تعذّرت إعادة الطلب: ${error?.message || "حاول مرة أخرى"}`,
      true,
    );
  }
}

function closeMyOrders() {
  document.getElementById("my-orders-overlay").classList.remove("open");
}

async function loadProducts() {
  const grid = document.getElementById("products-grid");
  try {
    products = await portalApiCall("/portal/products");
    renderGrid();
  } catch (e) {
    grid.innerHTML = `<div class="p-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>تعذّر تحميل المنتجات: ${escHtml(e.message)}</p></div>`;
  }
}
async function loadAuthenticatedCart() {
  if (!isLoggedIn()) {
    updateCartBadge();
    return;
  }
  try {
    const savedCart = await portalApiCall("/portal/cart");
    cart = Array.isArray(savedCart)
      ? savedCart.map((item) => ({
          recipeId: Number(item.recipeId),
          productName: item.productName,
          productCode: item.productCode,
          qty: Number(item.qty),
          available: item.available !== false,
        }))
      : [];
    sessionStorage.removeItem(CART_KEY);
    updateCartBadge();
  } catch (err) {
    showToast("تعذّر تحميل السلة المحفوظة: " + err.message, true);
  }
}
async function loadWishlist() {
  if (!isLoggedIn()) return;
  try {
    wishlistItems = await portalApiCall("/portal/wishlist");
    wishlistIds = new Set(
      (wishlistItems || []).map((item) => Number(item.recipeId)),
    );
    renderGrid();
  } catch (err) {
    showToast(
      err.sessionExpired
        ? "انتهت جلسة الدخول — اضغط «تسجيل الدخول بحساب آخر»"
        : "تعذّر تحميل المفضلة: " + err.message,
      true,
    );
  }
}
async function loadPortalConfig() {
  try {
    const config = await portalApiCall("/portal/config");
    minimumOrderQuantity = Number(config.minimumOrderQuantity) || 1;
  } catch {
    minimumOrderQuantity = 1;
  }
}
function filteredProducts() {
  const q = searchQuery.toLowerCase();
  return products
    .filter(
      (p) =>
        (!q ||
          p.productName.toLowerCase().includes(q) ||
          (p.productCode || "").toLowerCase().includes(q) ||
          (p.description || "").toLowerCase().includes(q)),
    )
    .sort((a, b) =>
      popularOnly ?
        Number(b.orderCount || 0) - Number(a.orderCount || 0)
      : 0,
    );
}

function renderGrid() {
  const grid = document.getElementById("products-grid");
  const list = filteredProducts();
  if (!list.length) {
    grid.innerHTML = `<div class="p-empty"><i class="fa-solid fa-box-open"></i><p>لا توجد منتجات مطابقة حاليًا</p></div>`;
    return;
  }
  grid.innerHTML = list
    .map(
      (p, i) => `
    <div class="p-card" style="animation-delay:${i * 0.03}s" onclick="openProduct(${p.id})">
      <button class="p-wishlist-btn ${wishlistIds.has(Number(p.id)) ? "active" : ""}" onclick="toggleWishlist(${p.id}, event)" aria-label="${wishlistIds.has(Number(p.id)) ? "إزالة من المفضلة" : "إضافة للمفضلة"}">
        <i class="fa-${wishlistIds.has(Number(p.id)) ? "solid" : "regular"} fa-heart"></i>
      </button>
      <div class="p-card-icon"><i class="fa-solid ${iconFor(p.productName)}"></i></div>
      <div class="p-card-name">${escHtml(p.productName)}</div>
      <div class="p-card-code">${escHtml(p.productCode) || "—"}</div>
      <div class="p-card-footer">
        <div class="p-card-badge"><i class="fa-solid fa-briefcase"></i> تسعير بالجملة</div>
        ${Number(p.orderCount) > 0 ? `<span class="p-popular"><i class="fa-solid fa-fire"></i> ${p.orderCount}</span>` : ""}
      </div>
    </div>`,
    )
    .join("");
}

/* ── Product Modal ── */
async function openProduct(id) {
  let detail;
  try {
    detail = await portalApiCall(`/portal/products/${id}`);
  } catch (e) {
    showToast("تعذّر تحميل تفاصيل المنتج: " + e.message, true);
    return;
  }
  activeProduct = detail;
  document.getElementById("modal-icon").className =
    `fa-solid ${iconFor(detail.productName)}`;
  document.getElementById("modal-title").textContent = detail.productName;
  document.getElementById("modal-code").textContent = detail.productCode || "—";
  document.getElementById("modal-desc").textContent =
    detail.description ||
    (detail.componentsCount > 0 ?
      `منتج مصنّع من ${detail.componentsCount} ${detail.componentsCount === 1 ? "مكوّن" : "مكوّنات"} بأعلى معايير الجودة. متاح للطلب بكميات الجملة.`
    : `منتج متاح للطلب بكميات الجملة.`);
  const wishlistButton = document.getElementById("modal-wishlist");
  wishlistButton.classList.toggle("active", wishlistIds.has(Number(detail.id)));
  wishlistButton.innerHTML = `<i class="fa-${wishlistIds.has(Number(detail.id)) ? "solid" : "regular"} fa-heart"></i> ${wishlistIds.has(Number(detail.id)) ? "في المفضلة" : "إضافة للمفضلة"}`;
  wishlistButton.onclick = () => toggleWishlist(detail.id);
  document.getElementById("modal-qty").value = minimumOrderQuantity;
  document.getElementById("modal-qty").min = minimumOrderQuantity;
  document.getElementById("product-overlay").classList.add("open");
}
function closeProductModal() {
  document.getElementById("product-overlay").classList.remove("open");
  activeProduct = null;
}

async function toggleWishlist(id, event) {
  event?.stopPropagation();
  if (!isLoggedIn()) {
    showToast("سجّل الدخول عشان تستخدم المفضلة", true);
    setTimeout(() => (location.href = "portal-login.html"), 800);
    return;
  }
  const recipeId = Number(id);
  const wasActive = wishlistIds.has(recipeId);
  const button = event?.currentTarget || document.getElementById("modal-wishlist");
  setPortalButtonBusy(button, true, "جاري التحديث...");
  try {
    if (wasActive) {
      await portalApiCall(`/portal/wishlist/${recipeId}`, { method: "DELETE" });
      wishlistIds.delete(recipeId);
      wishlistItems = wishlistItems.filter(
        (item) => Number(item.recipeId) !== recipeId,
      );
      showToast("تمت إزالة المنتج من المفضلة");
    } else {
      await portalApiCall("/portal/wishlist", {
        method: "POST",
        body: JSON.stringify({ bomRecipeId: recipeId }),
      });
      wishlistIds.add(recipeId);
      showToast("تمت إضافة المنتج للمفضلة");
    }
    renderGrid();
    if (document.getElementById("wishlist-overlay").classList.contains("open")) {
      openWishlist();
    }
    if (activeProduct && Number(activeProduct.id) === recipeId) {
      const button = document.getElementById("modal-wishlist");
      button.classList.toggle("active", wishlistIds.has(recipeId));
      button.innerHTML = `<i class="fa-${wishlistIds.has(recipeId) ? "solid" : "regular"} fa-heart"></i> ${wishlistIds.has(recipeId) ? "في المفضلة" : "إضافة للمفضلة"}`;
    }
  } catch (err) {
    showToast("تعذّر تحديث المفضلة: " + err.message, true);
  } finally {
    setPortalButtonBusy(button, false);
  }
}

async function openWishlist() {
  if (!isLoggedIn()) {
    showToast("سجّل الدخول عشان تشوف المفضلة", true);
    return;
  }
  const overlay = document.getElementById("wishlist-overlay");
  const list = document.getElementById("wishlist-list");
  overlay.classList.add("open");
  list.innerHTML = `<div class="p-empty" style="padding:30px 0"><i class="fa-solid fa-spinner fa-spin"></i></div>`;
  try {
    wishlistItems = await portalApiCall("/portal/wishlist");
    wishlistIds = new Set(wishlistItems.map((item) => Number(item.recipeId)));
    if (!wishlistItems.length) {
      list.innerHTML = `<div class="p-empty"><i class="fa-regular fa-heart"></i><p>المفضلة فاضية — ضيف المنتجات اللي بترجع لها كتير</p></div>`;
      return;
    }
    list.innerHTML = wishlistItems
      .map(
        (item) => `
        <div class="p-wishlist-item">
          <div class="p-cart-item-icon"><i class="fa-solid ${iconFor(item.productName)}"></i></div>
          <div class="p-cart-item-info">
            <strong class="p-wishlist-name">${escHtml(item.productName)}</strong>
            <span class="p-cart-item-qty">${escHtml(item.productCode || "—")}</span>
            ${
              item.available === false
                ? '<span style="display:block;color:#b45309;font-size:12px;margin-top:4px">المنتج غير متاح حاليًا</span>'
                : ""
            }
          </div>
          <button type="button" aria-label="إضافة إلى السلة" class="p-wishlist-add" ${
            item.available === false ? "disabled" : ""
          } onclick="addWishlistItemToCart(${item.recipeId})"><i class="fa-solid fa-cart-plus"></i></button>
          <button type="button" aria-label="إزالة من المفضلة" class="p-cart-item-remove" onclick="toggleWishlist(${item.recipeId}, event)"><i class="fa-solid fa-trash"></i></button>
        </div>`,
      )
      .join("");
  } catch (err) {
    list.innerHTML = `<div class="p-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>تعذّر تحميل المفضلة: ${escHtml(err.message)}</p></div>`;
  }
}

function closeWishlist() {
  document.getElementById("wishlist-overlay").classList.remove("open");
}

async function addWishlistItemToCart(recipeId) {
  const product = products.find((item) => Number(item.id) === Number(recipeId));
  if (!product) {
    showToast("المنتج غير متاح حاليًا في الكتالوج", true);
    return;
  }
  try {
    await addProductToCart(product, minimumOrderQuantity);
    showToast(`تمت إضافة "${product.productName}" للسلة`);
    await openCart();
  } catch (err) {
    showToast("تعذّرت إضافة المنتج: " + err.message, true);
  }
}

async function addProductToCart(product, qty) {
  const amount = Math.max(minimumOrderQuantity, Number(qty) || minimumOrderQuantity);
  if (isLoggedIn()) {
    const saved = await portalApiCall("/portal/cart", {
      method: "POST",
      body: JSON.stringify({
        bomRecipeId: Number(product.id),
        qty: amount,
        mode: "add",
      }),
    });
    const existing = cart.find((item) => item.recipeId === Number(product.id));
    if (existing) existing.qty = Number(saved.qty);
    else
      cart.push({
        recipeId: Number(product.id),
        productName: product.productName,
        productCode: product.productCode,
        qty: Number(saved.qty),
      });
    sessionStorage.removeItem(CART_KEY);
    updateCartBadge();
    return saved;
  }
  const existing = cart.find((item) => item.recipeId === Number(product.id));
  if (existing) existing.qty += amount;
  else
    cart.push({
      recipeId: Number(product.id),
      productName: product.productName,
      productCode: product.productCode,
      qty: amount,
    });
  saveCart();
  return cart.find((item) => item.recipeId === Number(product.id));
}

async function addActiveToCart() {
  if (!activeProduct) {
    showToast("اختَر منتجًا أولًا قبل الإضافة للطلب", true);
    return;
  }
  const productName = activeProduct.productName;
  const qty = Math.max(
    minimumOrderQuantity,
    parseInt(document.getElementById("modal-qty").value) ||
      minimumOrderQuantity,
  );
  const button = document.getElementById("btn-add-cart");
  setPortalButtonBusy(button, true, "جاري إضافة المنتج...");
  try {
    await addProductToCart(activeProduct, qty);
    closeProductModal();
    showToast(`تمت إضافة ${qty} من "${productName}" للطلب`);
  } catch (err) {
    showToast("تعذّرت إضافة المنتج: " + err.message, true);
  } finally {
    setPortalButtonBusy(button, false);
  }
}

/* ── Cart ── */
function saveCart() {
  if (!isLoggedIn()) sessionStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartBadge();
}
function updateCartBadge() {
  const badge = document.getElementById("cart-count");
  const total = cart.reduce((s, c) => s + (Number(c.qty) || 0), 0);
  if (total > 0) {
    badge.textContent = total;
    badge.style.display = "flex";
  } else {
    badge.style.display = "none";
  }
}

async function openCart() {
  if (isLoggedIn()) await loadAuthenticatedCart();
  renderCart();
  document.getElementById("cart-overlay").classList.add("open");
}
function closeCart() {
  document.getElementById("cart-overlay").classList.remove("open");
}

function renderCart() {
  const itemsEl = document.getElementById("cart-items");
  const footEl = document.getElementById("cart-foot");

  if (!cart.length) {
    itemsEl.innerHTML = `<div class="p-cart-empty"><i class="fa-solid fa-cart-shopping"></i><p>السلة فاضية — رجّع لصفحة المنتجات وضيف اللي محتاجه</p></div>`;
    footEl.style.display = "none";
    return;
  }

  itemsEl.innerHTML = cart
    .map(
      (c, i) => `
    <div class="p-cart-item ${c.available === false ? "p-cart-item-unavailable" : ""}">
      <div class="p-cart-item-icon"><i class="fa-solid ${iconFor(c.productName)}"></i></div>
      <div class="p-cart-item-info">
        <div class="p-cart-item-name">${escHtml(c.productName)}</div>
         ${
           c.available === false
             ? '<div style="color:#b45309;font-size:12px;margin-top:5px">المنتج ده مش متاح حاليًا — احذفه من السلة قبل إرسال الطلب</div>'
             : `<div class="p-cart-item-qty">الكمية: ${c.qty}</div>
                <div class="p-cart-qty-controls">
                  <button type="button" onclick="changeCartQty(${i}, -1)" aria-label="تقليل الكمية">−</button>
                  <button type="button" onclick="changeCartQty(${i}, 1)" aria-label="زيادة الكمية">+</button>
                </div>`
         }
      </div>
      <button type="button" aria-label="حذف المنتج من السلة" class="p-cart-item-remove" onclick="removeFromCart(${i})"><i class="fa-solid fa-trash"></i></button>
    </div>`,
    )
    .join("");
  footEl.style.display = "block";
}

async function changeCartQty(idx, delta) {
  const item = cart[idx];
  if (!item) return;
  if (item.available === false) {
    showToast("المنتج متوقف حاليًا — احذفه من السلة أو انتظر تفعيله", true);
    return;
  }
  const nextQty = Number(item.qty) + delta;
  if (nextQty < minimumOrderQuantity) {
    showToast(`الحد الأدنى للكمية هو ${minimumOrderQuantity} قطعة`, true);
    return;
  }
  try {
    if (isLoggedIn()) {
      const saved = await portalApiCall("/portal/cart", {
        method: "POST",
        body: JSON.stringify({
          bomRecipeId: item.recipeId,
          qty: nextQty,
          mode: "set",
        }),
      });
      item.qty = Number(saved.qty);
      updateCartBadge();
    } else {
      item.qty = nextQty;
      saveCart();
    }
    renderCart();
  } catch (err) {
    showToast("تعذّر تعديل الكمية: " + err.message, true);
  }
}

async function removeFromCart(idx) {
  const item = cart[idx];
  if (!item) return;
  try {
    if (isLoggedIn()) {
      await portalApiCall(`/portal/cart/${item.recipeId}`, { method: "DELETE" });
      cart.splice(idx, 1);
      sessionStorage.removeItem(CART_KEY);
      updateCartBadge();
    } else {
      cart.splice(idx, 1);
      saveCart();
    }
    renderCart();
  } catch (err) {
    showToast("تعذّر حذف المنتج: " + err.message, true);
  }
}

/* ── Submit Order ── */
async function submitOrder() {
  if (!cart.length) return;

  const unavailableItems = cart.filter((item) => item.available === false);
  if (unavailableItems.length) {
    showToast(
      `لا يمكن إرسال الطلب قبل حذف ${unavailableItems.length} منتج غير متاح من السلة`,
      true,
    );
    renderCart();
    return;
  }

  if (!isLoggedIn()) {
    // ✅ حفظ نية الإرسال — بعد ما يسجّل دخول أو يعمل حساب، هيرجع هنا والسلة موجودة
    sessionStorage.setItem("hyper_erp_portal_pending_checkout", "1");
    showToast("سجّل دخولك الأول عشان تقدر تبعت الطلب", true);
    setTimeout(() => (location.href = "portal-login.html"), 900);
    return;
  }

  const btn = document.getElementById("btn-submit-order");
  setPortalButtonBusy(btn, true, "جاري إرسال الطلب...");
  try {
    const payload = {
      items: cart.map((c) => ({
        bomRecipeId: c.recipeId,
        qty: String(c.qty),
        unit: "قطعة",
      })),
      priority: document.getElementById("cart-priority").value,
      notes: document.getElementById("cart-notes").value.trim() || null,
      idempotencyKey: `portal-${Date.now()}-${crypto.randomUUID()}`,
    };
    const submittedItems = [...cart];
    const result = await portalApiCall("/portal/orders", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (isLoggedIn()) {
      await Promise.allSettled(
        submittedItems.map((item) =>
          portalApiCall(`/portal/cart/${item.recipeId}`, { method: "DELETE" }),
        ),
      );
      sessionStorage.removeItem(CART_KEY);
    }
    cart = [];
    saveCart();
    closeCart();
    showToast(result.message || "تم إرسال طلبك بنجاح ✓");
    document.getElementById("cart-notes").value = "";
  } catch (e) {
    showToast("فشل إرسال الطلب: " + e.message, true);
  } finally {
    setPortalButtonBusy(btn, false);
  }
}

/* ── Helpers ── */
function escHtml(str) {
  const div = document.createElement("div");
  div.textContent = str === null || str === undefined ? "" : String(str);
  return div.innerHTML;
}
let toastTimer;
function showToast(msg, warn = false) {
  const t = document.getElementById("toast");
  document.getElementById("toast-msg").textContent = msg;
  t.className = "p-toast show" + (warn ? " warn" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = "p-toast"), 3200);
}

/* ── Events ── */
function bindEvents() {
  document.getElementById("search-input").addEventListener("input", (e) => {
    searchQuery = e.target.value.trim();
    renderGrid();
  });
  document.getElementById("popular-filter")?.addEventListener("change", (e) => {
    popularOnly = e.target.value === "popular";
    renderGrid();
  });
  document
    .getElementById("modal-close")
    .addEventListener("click", closeProductModal);
  document.getElementById("product-overlay").addEventListener("click", (e) => {
    if (e.target.id === "product-overlay") closeProductModal();
  });
  document.getElementById("qty-minus").addEventListener("click", () => {
    const el = document.getElementById("modal-qty");
    el.value = Math.max(
      minimumOrderQuantity,
      (parseInt(el.value) || minimumOrderQuantity) - 1,
    );
  });
  document.getElementById("qty-plus").addEventListener("click", () => {
    const el = document.getElementById("modal-qty");
    el.value = (parseInt(el.value) || minimumOrderQuantity) + 1;
  });
  document
    .getElementById("btn-add-cart")
    .addEventListener("click", addActiveToCart);

  document.getElementById("btn-cart").addEventListener("click", openCart);
  document.getElementById("cart-close").addEventListener("click", closeCart);
  document.getElementById("cart-overlay").addEventListener("click", (e) => {
    if (e.target.id === "cart-overlay") closeCart();
  });
  document
    .getElementById("btn-submit-order")
    .addEventListener("click", submitOrder);

  // ✅ إصلاح: زرار إغلاق مودال "طلباتي" كان موجود في الـ HTML بس مالوش
  // أي event listener خالص — نفس نمط الميزة المبنية جزئيًا وغير المفعّلة
  document.getElementById("my-orders-close")?.addEventListener("click", () => {
    closeMyOrders();
  });
  document
    .getElementById("my-orders-overlay")
    ?.addEventListener("click", (e) => {
      if (e.target.id === "my-orders-overlay")
        e.target.classList.remove("open");
    });
  document.getElementById("account-close")?.addEventListener("click", () => {
    document.getElementById("account-overlay").classList.remove("open");
  });
  document.getElementById("account-overlay")?.addEventListener("click", (e) => {
    if (e.target.id === "account-overlay") e.target.classList.remove("open");
  });
  document.getElementById("btn-wishlist")?.addEventListener("click", openWishlist);
  document.getElementById("wishlist-close")?.addEventListener("click", closeWishlist);
  document.getElementById("wishlist-overlay")?.addEventListener("click", (e) => {
    if (e.target.id === "wishlist-overlay") closeWishlist();
  });
  document
    .getElementById("btn-notifications")
    ?.addEventListener("click", openPortalNotifications);
  document.addEventListener("click", (e) => {
    const target = e.target;
    if (
      target instanceof Node &&
      !target.closest(".p-notification-wrap")
    ) {
      document
        .getElementById("portal-notifications-panel")
        ?.classList.remove("open");
      document
        .getElementById("btn-notifications")
        ?.setAttribute("aria-expanded", "false");
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeProductModal();
      closeCart();
      closeMyOrders();
      closeWishlist();
      document
        .getElementById("portal-notifications-panel")
        ?.classList.remove("open");
    }
  });

  // ✅ لو راجع من صفحة تسجيل الدخول بنية إرسال طلب معلّقة، افتحله السلة على طول
  if (
    sessionStorage.getItem("hyper_erp_portal_pending_checkout") === "1" &&
    isLoggedIn()
  ) {
    sessionStorage.removeItem("hyper_erp_portal_pending_checkout");
    setTimeout(openCart, 400);
  }
}
