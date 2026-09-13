/** @format */
// ============================================================
//  PORTAL AUTH — بوابة عملاء الجملة
//  نظام تسجيل دخول منفصل تمامًا عن نظام الموظفين (auth.js) —
//  توكن مختلف، مفتاح تخزين مختلف، مفيش أي تداخل بينهم خالص.
// ============================================================

const PORTAL_SESSION_KEY = "hyper_erp_portal_session";

function reportPortalError(context, error) {
  console.error("[portal]", {
    context,
    message: error instanceof Error ? error.message : String(error),
    status: error?.status,
  });
}

function setAuthButtonBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.dataset.originalLabel = button.innerHTML;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${label}`;
  } else {
    button.innerHTML = button.dataset.originalLabel || button.innerHTML;
    delete button.dataset.originalLabel;
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}

function populateGovernorates() {
  const select = document.getElementById("app-city");
  const governorates = Array.isArray(window.EGYPT_GOVERNORATES)
    ? window.EGYPT_GOVERNORATES
    : [];
  if (!select || !governorates.length) return;
  governorates.forEach((governorate) =>
    select.appendChild(new Option(governorate, governorate)),
  );
}

function getSessionStorageFor(session) {
  return session?.rememberMe === true ? localStorage : sessionStorage;
}

function readPortalSession() {
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

function savePortalSession(session) {
  const target = getSessionStorageFor(session);
  const other = target === localStorage ? sessionStorage : localStorage;
  target.setItem(PORTAL_SESSION_KEY, JSON.stringify(session));
  other.removeItem(PORTAL_SESSION_KEY);
}

function clearPortalSession() {
  localStorage.removeItem(PORTAL_SESSION_KEY);
  sessionStorage.removeItem(PORTAL_SESSION_KEY);
}

async function portalApiCall(path, options = {}) {
  const session = readPortalSession();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (session?.token) headers["Authorization"] = `Bearer ${session.token}`;

  let res;
  try {
    res = await fetch(`/api/v1${path}`, { ...options, headers });
  } catch (error) {
    reportPortalError(`auth:${path}`, error);
    throw new Error("تعذّر الاتصال بالخادم. تأكد من اتصال الإنترنت وحاول مرة أخرى.");
  }
  if (!res.ok) {
    let msg = `خطأ (${res.status})`;
    try {
      const data = await res.json();
      msg = data?.error?.message || msg;
    } catch {}
    const error = new Error(msg);
    error.status = res.status;
    reportPortalError(`auth:${path}`, error);
    throw error;
  }
  if (res.status === 204) return null;
  const body = await res.json();
  // API responses are wrapped by the shared backend envelope. Keep this
  // client tolerant of older unwrapped responses during rollout.
  return body && Object.prototype.hasOwnProperty.call(body, "data")
    ? body.data
    : body;
}

async function mergeGuestCartIntoAccount() {
  const rawCart = sessionStorage.getItem("hyper_erp_portal_cart");
  if (!rawCart) return;
  let guestCart;
  try {
    guestCart = JSON.parse(rawCart);
  } catch {
    return;
  }
  if (!Array.isArray(guestCart) || !guestCart.length) return;

  let accountCart = [];
  try {
    accountCart = await portalApiCall("/portal/cart");
  } catch {
    // Keep the guest cart intact when the account cart cannot be read.
    return;
  }
  const byRecipe = new Map(
    accountCart.map((item) => [Number(item.recipeId), Number(item.qty) || 0]),
  );
  const unavailable = [];
  let failed = false;
  for (const item of guestCart) {
    const recipeId = Number(item.recipeId);
    const localQty = Number(item.qty);
    if (!Number.isInteger(recipeId) || !Number.isFinite(localQty)) continue;
    const targetQty = (byRecipe.get(recipeId) || 0) + localQty;
    try {
      await portalApiCall("/portal/cart", {
        method: "POST",
        body: JSON.stringify({
          bomRecipeId: recipeId,
          qty: targetQty,
          mode: "set",
        }),
      });
      byRecipe.set(recipeId, targetQty);
    } catch (err) {
      if (err.message.includes("غير موجود")) unavailable.push(item.productName);
      else failed = true;
    }
  }
  if (!failed) {
    sessionStorage.removeItem("hyper_erp_portal_cart");
    if (unavailable.length) {
      alert(
        `تم دمج السلة، لكن المنتج${unavailable.length > 1 ? "ات" : ""} التالي${unavailable.length > 1 ? "ة" : ""} لم يعد متاحًا:\n${unavailable.join("\n")}`,
      );
    }
  }
}

function showAuthError(msg) {
  const box = document.getElementById("auth-error");
  document.getElementById("auth-error-msg").textContent = msg;
  box.classList.add("show");
}
function hideAuthError() {
  document.getElementById("auth-error").classList.remove("show");
}

function switchTab(tab) {
  hideAuthError();
  hideForgotPassword();
  const isLogin = tab === "login";
  const isNewCustomer = tab === "new-customer";
  document.getElementById("tab-login").classList.toggle("active", isLogin);
  document
    .getElementById("tab-new-customer")
    .classList.toggle("active", isNewCustomer);
  document
    .getElementById("tab-old-customer")
    .classList.toggle("active", !isLogin && !isNewCustomer);
  document.getElementById("form-login").classList.toggle("hidden", !isLogin);
  document
    .getElementById("form-new-customer")
    .classList.toggle("hidden", !isNewCustomer);
  document
    .getElementById("form-old-customer")
    .classList.toggle("hidden", isLogin || isNewCustomer);
  document
    .getElementById("application-success")
    .classList.add("hidden");
  document.getElementById("activation-success").classList.add("hidden");
}

function showForgotPassword() {
  hideAuthError();
  document.getElementById("form-login").classList.add("hidden");
  document.getElementById("forgot-password-box").classList.remove("hidden");
  document.getElementById("otp-verify-fields").classList.add("hidden");
  document.getElementById("forgot-submit").classList.remove("hidden");
}
function hideForgotPassword() {
  document.getElementById("forgot-password-box").classList.add("hidden");
  document.getElementById("otp-verify-fields").classList.add("hidden");
  document.getElementById("forgot-submit").classList.remove("hidden");
}

document
  .getElementById("tab-login")
  .addEventListener("click", () => switchTab("login"));
document
  .getElementById("tab-new-customer")
  .addEventListener("click", () => switchTab("new-customer"));
document
  .getElementById("tab-old-customer")
  .addEventListener("click", () => switchTab("old-customer"));

document.getElementById("track-toggle").addEventListener("click", (e) => {
  e.preventDefault();
  hideAuthError();
  document.getElementById("track-box").classList.toggle("hidden");
});

document
  .getElementById("forgot-password-link")
  .addEventListener("click", (e) => {
    e.preventDefault();
    showForgotPassword();
  });
document.getElementById("back-to-login-link").addEventListener("click", (e) => {
  e.preventDefault();
  hideForgotPassword();
  document.getElementById("form-login").classList.remove("hidden");
});

document.getElementById("form-track").addEventListener("submit", async (e) => {
  e.preventDefault();
  hideAuthError();
  const phone = document.getElementById("track-phone").value.trim();
  const referenceCode = document
    .getElementById("track-reference")
    .value.trim()
    .toUpperCase();
  const btn = document.getElementById("track-submit");
  const resultBox = document.getElementById("track-result");
  setAuthButtonBusy(btn, true, "جاري تسجيل الدخول...");
  resultBox.classList.add("hidden");
  try {
    const result = await portalApiCall(
      `/portal/applications/track?referenceCode=${encodeURIComponent(referenceCode)}&phone=${encodeURIComponent(phone)}`,
    );
    const statusLabels = {
      pending: "طلبك قيد المراجعة",
      needs_info: "الفريق محتاج معلومات إضافية",
      approved: "تمت الموافقة على طلبك",
      rejected: "لم تتم الموافقة على الطلب",
    };
    let rejectedHelp = "";
    if (result.status === "rejected") {
      let supportPhone = "";
      try {
        const config = await portalApiCall("/portal/config");
        supportPhone = config.supportPhone || "";
      } catch {
        // The tracking result remains useful if public config is unavailable.
      }
      rejectedHelp = `
        <div style="margin-top:10px">
          <strong>لديك خياران للمساعدة:</strong>
          <div>1) تواصل مباشرة مع خدمة العملاء${supportPhone ? ` على ${escapeHtml(supportPhone)}` : ""}.</div>
          <div>2) <a href="portal-login.html#new-customer" style="color:var(--accent);font-weight:700">قدّم كعميل جديد من هنا</a>.</div>
        </div>`;
    }
    resultBox.innerHTML = `
      <strong><i class="fa-solid fa-circle-info"></i> ${
        statusLabels[result.status] || "حالة الطلب غير معروفة"
      }</strong>
      ${
        result.reviewerNote
          ? `<div style="margin-top:6px">${escapeHtml(result.reviewerNote)}</div>`
          : ""
      }${rejectedHelp}`;
    resultBox.classList.remove("hidden");
  } catch (err) {
    showAuthError(err.message);
  } finally {
    setAuthButtonBusy(btn, false);
  }
});

document.getElementById("forgot-submit").addEventListener("click", async () => {
  hideAuthError();
  const identifier = document.getElementById("forgot-identifier").value.trim();
  if (!identifier) return;
  const btn = document.getElementById("forgot-submit");
  btn.disabled = true;
  try {
    await portalApiCall("/portal/otp/request", {
      method: "POST",
      body: JSON.stringify({ identifier }),
    });
    document.getElementById("otp-verify-fields").classList.remove("hidden");
    btn.classList.add("hidden");
    document.getElementById("otp-code").focus();
    alert("لو الحساب موجود، هيوصلك كود استرجاع من 6 أرقام خلال دقائق.");
  } catch (err) {
    showAuthError(err.message);
  } finally {
    btn.disabled = false;
  }
});

document
  .getElementById("otp-verify-submit")
  .addEventListener("click", async () => {
    hideAuthError();
    const identifier = document.getElementById("forgot-identifier").value.trim();
    const code = document.getElementById("otp-code").value.trim();
    const newPassword = document.getElementById("otp-new-password").value;
    const confirmPassword = document.getElementById("otp-confirm-password").value;
    if (!identifier || !/^\d{6}$/.test(code)) {
      showAuthError("اكتب كود التحقق المكوّن من 6 أرقام");
      return;
    }
    if (newPassword.length < 6 || newPassword !== confirmPassword) {
      showAuthError("تأكد أن كلمة المرور 6 أحرف على الأقل ومتطابقة");
      return;
    }
    const btn = document.getElementById("otp-verify-submit");
    setAuthButtonBusy(btn, true, "جاري إرسال الطلب...");
    try {
      const result = await portalApiCall("/portal/otp/verify", {
        method: "POST",
        body: JSON.stringify({ identifier, code, newPassword }),
      });
      alert(result.message);
      document.getElementById("login-identifier").value = identifier;
      hideForgotPassword();
      document.getElementById("form-login").classList.remove("hidden");
      document.getElementById("login-password").focus();
    } catch (err) {
      showAuthError(err.message);
    } finally {
      setAuthButtonBusy(btn, false);
    }
  });

document
  .getElementById("forgot-manual-link")
  .addEventListener("click", async (e) => {
    e.preventDefault();
    hideAuthError();
    const identifier = document.getElementById("forgot-identifier").value.trim();
    if (!identifier) {
      showAuthError("اكتب رقم هاتفك أو إيميلك أولًا");
      return;
    }
    const btn = document.getElementById("forgot-manual-link");
    btn.style.pointerEvents = "none";
    try {
      const result = await portalApiCall("/portal/forgot-password", {
        method: "POST",
        body: JSON.stringify({ identifier }),
      });
      alert(result.message);
      hideForgotPassword();
      document.getElementById("form-login").classList.remove("hidden");
    } catch (err) {
      showAuthError(err.message);
    } finally {
      btn.style.pointerEvents = "";
    }
  });

document.getElementById("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  hideAuthError();
  const identifier = document.getElementById("login-identifier").value.trim();
  const password = document.getElementById("login-password").value;
  const rememberMe = document.getElementById("login-remember").checked;
  const btn = document.getElementById("login-submit");
  btn.disabled = true;
  try {
    const result = await portalApiCall("/portal/login", {
      method: "POST",
      body: JSON.stringify({ identifier, password, rememberMe }),
    });
    savePortalSession(result);
    await mergeGuestCartIntoAccount();
    location.href = "portal.html";
  } catch (err) {
    showAuthError(err.message);
  } finally {
    btn.disabled = false;
  }
});

document
  .getElementById("form-new-customer")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    hideAuthError();
    const payload = {
      fullName: document.getElementById("app-name").value.trim(),
      phone: document.getElementById("app-phone").value.trim(),
      email: document.getElementById("app-email").value.trim() || null,
      address: document.getElementById("app-address").value.trim() || null,
      city: document.getElementById("app-city").value || null,
      companyName: document.getElementById("app-company").value.trim(),
      commercialRegisterNo:
        document.getElementById("app-commercial-register").value.trim() || null,
      taxId: document.getElementById("app-tax-id").value.trim() || null,
      expectedMonthlyVolume:
        document.getElementById("app-volume").value.trim() || null,
      notes: document.getElementById("app-notes").value.trim() || null,
    };
    const btn = document.getElementById("application-submit");
    btn.disabled = true;
    try {
      const result = await portalApiCall("/portal/applications", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      document.getElementById("form-new-customer").classList.add("hidden");
      document.getElementById("application-reference").textContent =
        result.referenceCode;
      document
        .getElementById("application-success")
        .classList.remove("hidden");
    } catch (err) {
      showAuthError(err.message);
    } finally {
      btn.disabled = false;
    }
  });

document
  .getElementById("copy-reference")
  .addEventListener("click", async () => {
    const referenceCode = document.getElementById("application-reference").textContent;
    try {
      await navigator.clipboard.writeText(referenceCode);
      document.getElementById("copy-reference").innerHTML =
        '<i class="fa-solid fa-check"></i> تم النسخ';
    } catch {
      showAuthError("لم نتمكن من نسخ الرقم — حدده وانسخه يدويًا");
    }
  });

document
  .getElementById("form-old-customer")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    hideAuthError();
    const btn = document.getElementById("activation-submit");
    btn.disabled = true;
    try {
      const result = await portalApiCall("/portal/activation-requests", {
        method: "POST",
        body: JSON.stringify({
          companyName: document.getElementById("old-company").value.trim(),
          phone: document.getElementById("old-phone").value.trim(),
        }),
      });
      document.getElementById("form-old-customer").classList.add("hidden");
      document.getElementById("activation-success").classList.remove("hidden");
      document.getElementById("activation-success").querySelector("div").textContent =
        result.message;
    } catch (err) {
      showAuthError(err.message);
    } finally {
      btn.disabled = false;
    }
  });

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// لو أصلاً مسجّل دخول، مفيش داعي يشوف صفحة اللوجين تاني
(function redirectIfLoggedIn() {
  const session = readPortalSession();
  if (session?.token) location.href = "portal.html";
})();

const initialHashTab = {
  "#login": "login",
  "#new-customer": "new-customer",
  "#old-customer": "old-customer",
}[location.hash];
if (initialHashTab) switchTab(initialHashTab);
populateGovernorates();
