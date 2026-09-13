/**
 * ✅ محمّل التنقل الديناميكي — يستبدل الـ sidebar الثابت القديم (اللي كان
 * بيعرض كل الصفحات لكل الناس) بشجرة مبنية فعليًا من GET /api/v1/nav حسب
 * دور المستخدم الحالي بس.
 *
 * السلوك (متفق عليه):
 *  - عنده قسم واحد بس (مثلًا sales_manager) → يتحول تلقائيًا للوحة قسمه
 *    مباشرة (homeHref)، من غير ما يشوف صفحة اختيار الأقسام خالص.
 *  - عنده أكتر من قسم (مثلًا chairman) → يفضل في الصفحة الحالية، والـ
 *    sidebar بيتبني بس بالأقسام/المحاور/الصفحات المسموح له بيها، وبطاقات
 *    الأقسام (لو موجودة في الصفحة عبر #department-cards) بتتملى.
 *
 * الاستخدام: يتضاف زي أي سكريبت تاني بعد auth.js وapi-client.js في أي
 * صفحة عندها <aside id="dynamic-sidebar">. الصفحات اللي لسه بتستخدم
 * الـ sidebar الثابت القديم مش متأثرة خالص لحد ما تتحول هي كمان.
 *
 * @format
 */

(function () {
  "use strict";

  const ICONS = {
    "top-management": "fa-landmark",
    "foundation-data": "fa-database",
    sales: "fa-cart-shopping",
    purchasing: "fa-truck-ramp-box",
    production: "fa-industry",
    warehouse: "fa-warehouse",
    quality: "fa-shield-halved",
    "hr-accounting": "fa-users-gear",
    operations: "fa-gears",
    "customer-portal": "fa-globe",
    reports: "fa-chart-pie",
  };

  function buildSidebarHTML(nav, currentHref) {
    let html = "";
    for (const dept of nav.departments) {
      const icon = ICONS[dept.id] || "fa-folder";
      html += `<div class="sidebar-section">`;
      html += `<p class="sidebar-section-title"><i class="fa-solid ${icon}"></i> ${dept.label}</p>`;
      for (const sf of dept.subFunctions) {
        for (const page of sf.pages) {
          const active = page.href === currentHref ? " active" : "";
          const badge =
            Number(page.badgeCount) > 0
              ? `<span class="nav-badge" aria-label="${page.badgeCount} حالات تحتاج مراجعة">${page.badgeCount}</span>`
              : "";
          html += `<a href="${page.href}" class="nav-item${active}" title="${sf.label}">
            <i class="fa-solid fa-angles-left"></i> <span class="nav-label">${page.label}</span>${badge}
          </a>`;
        }
      }
      html += `</div>`;
    }
    return html;
  }

  function buildDepartmentCardsHTML(nav) {
    if (nav.departments.length <= 1) return "";
    let html = "";
    for (const dept of nav.departments) {
      const icon = ICONS[dept.id] || "fa-folder";
      const pageCount = dept.subFunctions.reduce(
        (sum, sf) => sum + sf.pages.length,
        0,
      );
      const firstHref =
        dept.subFunctions[0] && dept.subFunctions[0].pages[0]
          ? dept.subFunctions[0].pages[0].href
          : "#";
      html += `
        <a href="${firstHref}" class="dept-card" data-dept-id="${dept.id}">
          <div class="dept-card-icon"><i class="fa-solid ${icon}"></i></div>
          <div class="dept-card-body">
            <h4>${dept.label}</h4>
            <span>${pageCount} صفحة متاحة</span>
          </div>
          <i class="fa-solid fa-chevron-left dept-card-arrow"></i>
        </a>`;
    }
    return html;
  }

  async function init() {
    if (window.HyperTechAuth && window.HyperTechAuth.ready) {
      await window.HyperTechAuth.ready;
    }
    const role =
      window.HyperTechAuth &&
      window.HyperTechAuth.user &&
      window.HyperTechAuth.user.role;
    if (!role) return; // auth.js هيتولى تسجيل الخروج لو فشل جلب البيانات

    let nav;
    try {
      nav = await window.HyperTechAuth.request("/nav");
    } catch (err) {
      console.error("تعذّر تحميل شجرة التنقل الديناميكية:", err);
      return; // نسيب الـ sidebar الثابت القديم (لو موجود) بدل ما نكسر الصفحة
    }

    const currentPage = location.pathname.split("/").pop() || "index.html";

    // ✅ توجيه فوري لأصحاب القسم الواحد — بس من صفحة index.html نفسها،
    // عشان محدش يتحول وهو أصلًا فاتح صفحة تانية من صلاحياته.
    if (
      nav.singleDepartment &&
      nav.homeHref &&
      currentPage === "index.html" &&
      nav.homeHref !== "index.html"
    ) {
      location.replace(nav.homeHref);
      return;
    }

    const sidebarContainer = document.getElementById("dynamic-sidebar");
    if (sidebarContainer) {
      sidebarContainer.innerHTML = buildSidebarHTML(nav, currentPage);
    }

    const cardsContainer = document.getElementById("department-cards");
    const cardsWrap = document.getElementById("department-cards-wrap");
    if (cardsContainer) {
      const cardsHTML = buildDepartmentCardsHTML(nav);
      if (cardsHTML) {
        cardsContainer.innerHTML = cardsHTML;
        cardsContainer.style.display = "";
        if (cardsWrap) cardsWrap.style.display = "";
      } else {
        cardsContainer.style.display = "none";
        if (cardsWrap) cardsWrap.style.display = "none";
      }
    }
  }

  init();
})();
