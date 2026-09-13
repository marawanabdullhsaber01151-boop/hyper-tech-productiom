/** @format */

// ============================================
//  THEME TOGGLE — Hyper-Tech ERP
//  يبدّل بين الوضع الداكن (الافتراضي) والفاتح،
//  ويحفظ الاختيار في localStorage عشان يفضل
//  ثابت بين الصفحات وبعد إعادة فتح المتصفح.
//
//  ملحوظة: منع "وميض" الوضع القديم قبل تحميل
//  هذا الملف بيتم عن طريق سكريبت صغير مباشر في
//  <head> كل صفحة (بيطبّق data-theme فورًا قبل
//  أي رسم للصفحة). هذا الملف مسؤول بس عن ربط
//  زرار التبديل وتحديث الحالة بعد أي ضغطة.
// ============================================

(function () {
  "use strict";

  const STORAGE_KEY = "hyper_erp_theme";

  function currentTheme() {
    return localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
  }

  function applyTheme(theme) {
    if (theme === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }

  function toggleTheme() {
    const next = currentTheme() === "light" ? "dark" : "light";
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
  }

  document.addEventListener("DOMContentLoaded", function () {
    // Re-apply in case this page's inline init script ran before the
    // attribute existed yet (defensive; harmless if already correct).
    applyTheme(currentTheme());

    document.querySelectorAll(".theme-toggle").forEach(function (btn) {
      btn.addEventListener("click", toggleTheme);
    });
  });
})();
