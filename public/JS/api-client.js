/**
 * Shared data bridge for the existing UI.
 *
 * The screens intentionally keep their synchronous localStorage API so the
 * legacy pages do not have to be rewritten. Every ERP key is mirrored to the
 * server after a successful login, which makes all pages and all browser
 * sessions use the same durable data source.
 *
 * ✅ إصلاح جوهري: كان في الأصل طبقة fetch كاملة مكررة هنا (نفس منطق
 * auth.js بالظبط: نفس الـ headers، نفس معالجة الأخطاء، لكن نسخة تانية
 * منفصلة). أي إصلاح مستقبلي (زي تسجيل الخروج التلقائي عند 401، أو حماية
 * ردود غير JSON) كان لازم يتكرر يدويًا في مكانين، وسهل جدًا ينسى أحدهما.
 * دلوقتي الملف ده بيفوّض كل الاتصال الفعلي لـ window.HyperTechAuth.request
 * (مصدر واحد للحقيقة)، ودوره الوحيد بقى: مزامنة localStorage مع السيرفر.
 *
 * @format
 */

(function () {
  "use strict";
  const PREFIX = "hyper_erp_";
  const SYNCED = "hyper_erp_server_hydrated";
  const SESSION_KEY = "hyper_erp_session";
  const isSyncKey = (key) =>
    key.startsWith(PREFIX) && key !== SESSION_KEY && key !== SYNCED;
  const stateKey = (key) => `/state/${encodeURIComponent(key)}`;

  // ✅ الآن مجرد اسم بديل مختصر لنفس دالة المصادقة الموحّدة — بدل نسخة مستقلة
  const api = (path, options = {}) =>
    window.HyperTechAuth.request(path, options);

  window.HyperTechAPI = {
    health: () => api("/health"),
    dashboard: () => api("/dashboard"),
    inventory: () => api("/inventory"),
    stockMove: (data) =>
      api("/stock-movements", { method: "POST", body: JSON.stringify(data) }),
  };

  const originalSet = Storage.prototype.setItem;
  const originalRemove = Storage.prototype.removeItem;
  let ready = false;
  Storage.prototype.setItem = function (key, value) {
    originalSet.call(this, key, value);
    if (this === localStorage && ready && isSyncKey(key)) {
      let parsed;
      try {
        parsed = JSON.parse(value);
      } catch {
        parsed = value;
      }
      api(stateKey(key), {
        method: "PUT",
        body: JSON.stringify({ value: parsed }),
      }).catch((error) => {
        console.warn("تعذر مزامنة البيانات مع الخادم:", error.message);
      });
    }
  };
  Storage.prototype.removeItem = function (key) {
    originalRemove.call(this, key);
    if (this === localStorage && ready && isSyncKey(key)) {
      api(stateKey(key), { method: "DELETE" }).catch((error) => {
        console.warn("تعذر حذف البيانات من الخادم:", error.message);
      });
    }
  };

  async function hydrate() {
    try {
      const remote = await api("/state");
      const keys = Object.keys(remote.state || {});
      if (keys.length && !sessionStorage.getItem(SYNCED)) {
        keys.forEach((key) =>
          originalSet.call(
            localStorage,
            key,
            JSON.stringify(remote.state[key]),
          ),
        );
        sessionStorage.setItem(SYNCED, "1");
        location.reload();
        return;
      }
      ready = true;
      if (!keys.length) {
        Object.keys(localStorage)
          .filter((key) => key.startsWith(PREFIX))
          .forEach((key) => {
            let value;
            try {
              value = JSON.parse(localStorage.getItem(key));
            } catch {
              value = localStorage.getItem(key);
            }
            api(stateKey(key), {
              method: "PUT",
              body: JSON.stringify({ value }),
            }).catch((error) => {
              console.warn(
                "تعذر رفع البيانات المحلية إلى الخادم:",
                error.message,
              );
            });
          });
      }
      document.documentElement.dataset.backend = "connected";
    } catch (error) {
      // ✅ إصلاح: كانت أي حالة فشل (حتى 401 "لسه مسجلتش دخول") بتتسجل كـ
      // "offline" بالظبط زي لو السيرفر فعليًا واقع — أي كود مستهلك لـ
      // data-backend مايقدرش يفرّق بين المشكلتين. دلوقتي بنميّز:
      //   isNetworkError → السيرفر فعلاً مش قادر يوصله المتصفح (offline)
      //   status === 401 → الجلسة غير صالحة (unauthorized) — auth.js بيتكفل
      //     بتسجيل الخروج التلقائي فعليًا في هذه الحالة، هنا بس بنسجل السبب
      //   غير كده → unavailable (خطأ سيرفر عام)
      if (error.isNetworkError) {
        document.documentElement.dataset.backend = "offline";
      } else if (error.status === 401) {
        document.documentElement.dataset.backend = "unauthorized";
      } else {
        document.documentElement.dataset.backend = "unavailable";
      }
      console.warn("تعذرت مزامنة البيانات مع الخادم:", error.message);
    }
  }
  hydrate();
})();
