/**
 * Hyper-Tech ERP — Responsive Sidebar Toggle
 * يدير فتح/إغلاق القائمة الجانبية على الأجهزة الصغيرة (< 1024px)
 * @format
 */
(function () {
  "use strict";

  function init() {
    var sidebar = document.querySelector(".sidebar");
    var topbar = document.querySelector(".topbar");

    // الصفحة ليس فيها sidebar أو topbar (مثل login.html) → لا شيء
    if (!sidebar || !topbar) return;

    /* ── إنشاء زر الهامبرغر ── */
    var menuToggle = document.createElement("button");
    menuToggle.className = "menu-toggle";
    menuToggle.setAttribute("type", "button");
    menuToggle.setAttribute("aria-label", "فتح القائمة");
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.innerHTML = '<i class="fa-solid fa-bars"></i>';

    /* ── إنشاء طبقة التعتيم ── */
    var overlay = document.createElement("div");
    overlay.className = "sidebar-overlay";

    /* ── إضافة الزر كأول عنصر في topbar (يظهر على اليمين في RTL) ── */
    topbar.insertBefore(menuToggle, topbar.firstChild);
    document.body.appendChild(overlay);

    /* ────────────────── فتح الشريط الجانبي ────────────────── */
    function openSidebar() {
      sidebar.classList.add("open");
      overlay.classList.add("active");
      document.body.style.overflow = "hidden";
      menuToggle.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      menuToggle.setAttribute("aria-label", "إغلاق القائمة");
      menuToggle.setAttribute("aria-expanded", "true");
    }

    /* ────────────────── إغلاق الشريط الجانبي ────────────────── */
    function closeSidebar() {
      sidebar.classList.remove("open");
      overlay.classList.remove("active");
      document.body.style.overflow = "";
      menuToggle.innerHTML = '<i class="fa-solid fa-bars"></i>';
      menuToggle.setAttribute("aria-label", "فتح القائمة");
      menuToggle.setAttribute("aria-expanded", "false");
    }

    /* ── مبدّل الحالة عند الضغط على الزر ── */
    menuToggle.addEventListener("click", function () {
      if (sidebar.classList.contains("open")) {
        closeSidebar();
      } else {
        openSidebar();
      }
    });

    /* ── إغلاق عند النقر على طبقة التعتيم ── */
    overlay.addEventListener("click", closeSidebar);

    /* ── إغلاق بمفتاح Escape ── */
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && sidebar.classList.contains("open")) {
        closeSidebar();
      }
    });

    /* ── إغلاق تلقائي عند الضغط على رابط في القائمة (موبايل) ──
       ✅ إصلاح: كان الربط بيتم على عناصر .nav-item الموجودة وقت
       التحميل بس، لكن nav-loader.js بيحقن روابط الأقسام بشكل غير
       متزامن (async) بعد كده — فأي رابط قسم ديناميكي كان مش بيقفل
       القائمة تلقائيًا على الموبايل. استخدام event delegation هنا
       بيخلي الإغلاق يشتغل صح بغض النظر عن امتى الرابط اتضاف. */
    sidebar.addEventListener("click", function (e) {
      if (e.target.closest(".nav-item") && window.innerWidth < 1024) {
        closeSidebar();
      }
    });

    /* ── إعادة تعيين عند تكبير النافذة ── */
    window.addEventListener("resize", function () {
      if (window.innerWidth >= 1024) {
        sidebar.classList.remove("open");
        overlay.classList.remove("active");
        document.body.style.overflow = "";
        menuToggle.innerHTML = '<i class="fa-solid fa-bars"></i>';
      }
    });
  }

  /* تشغيل بعد اكتمال تحميل الصفحة */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
