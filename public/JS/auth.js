/**
 * Global authentication guard for Hyper-Tech ERP pages.
 *
 * @format
 */

// دالة تعقيم موحّدة — بتتحط هنا لأن auth.js بيتحمّل أول حاجة في كل صفحة،
// فبتبقى متاحة لأي ملف تاني (settings.js, bom.js, production.js, enhancements.js...)
// من غير ما يتكرر تعريفها. استخدمها حوالين أي قيمة نصية جايه من السيرفر قبل
// ما تحطها جوه innerHTML.
function escHtml(str) {
  const div = document.createElement("div");
  div.textContent = str === null || str === undefined ? "" : String(str);
  return div.innerHTML;
}

(function () {
  "use strict";
  const SESSION_KEY = "hyper_erp_session";
  const loginPage = "/login.html";
  const session = () => {
    try {
      return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
    } catch {
      return null;
    }
  };

  const request = async (path, options = {}) => {
    const active = session();
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };
    if (active?.token) headers.Authorization = `Bearer ${active.token}`;

    // ✅ إصلاح: fetch نفسها ممكن ترفض (انقطاع نت، DNS، CORS...) — دي حالة
    // مختلفة تمامًا عن رد سيرفر بخطأ HTTP، ولازم تتفرّق عشان أي كود مستهلك
    // (زي api-client.js) يقدر يميّز "السيرفر واقع" عن "مفيش نت أصلاً"
    let response;
    try {
      response = await fetch(`/api/v1${path}`, { ...options, headers });
    } catch (networkError) {
      const err = new Error("تعذر الاتصال بالخادم — تحقق من الإنترنت");
      err.isNetworkError = true;
      throw err;
    }

    // ✅ إصلاح: لو السيرفر رجّع صفحة HTML بدل JSON (مثلاً 502 من الـ proxy
    // أو صفحة خطأ عامة)، response.json() كانت بترمي SyntaxError غامض بدل
    // رسالة مفهومة للمستخدم
    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (!response.ok) {
      const message =
        data.error?.message ||
        (response.status >= 500 ?
          "خطأ في الخادم، حاول لاحقًا"
        : "تعذر إتمام الطلب");
      const err = new Error(message);
      err.status = response.status;
      err.code = data.error?.code || "HTTP_ERROR";
      err.details = data.error?.details;

      // ✅ إصلاح race condition قديم: لو التوكن انتهى أثناء الاستخدام (401)
      // في أي طلب غير طلبات المصادقة نفسها، كان كل طلب بعد كده بيفشل بصمت
      // مع toast غير مفهوم والمستخدم يفضل يعتقد إنه لسه داخل. دلوقتي بيتم
      // تسجيل خروج تلقائي فورًا بمجرد اكتشاف انتهاء الجلسة.
      if (response.status === 401 && !path.startsWith("/auth/")) {
        window.HyperTechAuth.logout();
      }
      throw err;
    }
    // The API is gradually moving to { data, meta, message }. Keep the
    // existing pages source-compatible while making the transport contract
    // explicit and available to new screens.
    if (data && Object.prototype.hasOwnProperty.call(data, "data")) {
      return data.data;
    }
    return data;
  };

  // ✅ إصلاح مشكلة توقيت (race condition): window.HyperTechAuth.user كان بيتحدد
  // بشكل غير متزامن (بعد رد /auth/me)، لكن أي ملف تاني بيتحمّل بعد auth.js في
  // نفس الصفحة (زي factory-supervisor.js) كان بيقرأ .user فورًا من غير أي انتظار —
  // فكان أحيانًا لسه undefined وقت القراءة (حسب سرعة الشبكة)، فتفشل مقارنات زي
  // "o.supervisorId === me?.id" بصمت وتختفي الأوامر من عند المشرف/مراقب الجودة.
  // الحل: أي ملف محتاج .user لازم ينتظر window.HyperTechAuth.ready الأول.
  let resolveReady;
  let loggingOut = false;
  window.HyperTechAuth = {
    session,
    request,
    ready: new Promise((resolve) => {
      resolveReady = resolve;
    }),
    async logout() {
      // إلغاء الجلسة في قاعدة البيانات أولًا، مع ضمان تنظيف المتصفح حتى لو
      // كان التوكن منتهيًا أو الخادم غير متاح. loggingOut يمنع تكرار الطلب
      // عندما تفشل عدة طلبات متزامنة بسبب انتهاء نفس الجلسة.
      if (loggingOut) return;
      loggingOut = true;
      try {
        await request("/auth/logout", { method: "POST" });
      } catch {
        // مسح الجلسة محليًا يظل واجبًا حتى عند فشل إلغاء الجلسة عن بعد.
      } finally {
        sessionStorage.removeItem(SESSION_KEY);
        location.href = loginPage;
      }
    },
  };
  async function login(event) {
    event.preventDefault();
    const button = document.getElementById("submit");
    const message = document.getElementById("message");
    button.disabled = true;
    message.textContent = "";
    try {
      const result = await request("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username: document.getElementById("username").value.trim(),
          password: document.getElementById("password").value,
        }),
      });
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(result));
      location.href = "/index.html";
    } catch (error) {
      message.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  if (location.pathname.endsWith("/login.html")) {
    if (session()?.token) location.href = "/index.html";
    document.getElementById("login-form")?.addEventListener("submit", login);
    return;
  }

  if (!session()?.token) {
    location.replace(loginPage);
    return;
  }
  request("/auth/me")
    .then((profile) => {
      window.HyperTechAuth.user = profile;
      document.documentElement.dataset.role = profile.role;
      resolveReady(profile);
    })
    .catch(() => window.HyperTechAuth.logout());
})();
