/**
 * ✅ محوّل الإضاءة والهوية اللونية — يطبّق تفضيل المستخدم المحفوظ
 * فورًا (قبل أي رسم للصفحة) عشان يمنع "وميض" الألوان القديمة قبل
 * التبديل، ويوفّر دالتين عامتين لأي صفحة تحب تبني عليهم زرار تبديل:
 *
 *   window.HyperTechTheme.setMode("light" | "dark")
 *   window.HyperTechTheme.setAccent("default" | "industrial-green" | "warning-amber" | "steel-gray")
 *   window.HyperTechTheme.getMode() / getAccent()
 *
 * الحفظ هنا بـ localStorage لأن هذا تطبيق ويب حقيقي شغال على متصفح
 * المستخدم مباشرة (مش Artifact داخل محادثة Claude)، فلا ينطبق عليه
 * قيد "ممنوع localStorage" الخاص بالـ Artifacts.
 *
 * الاستخدام: يُحمَّل هذا الملف في وسم <head> (قبل أي CSS لو أمكن)
 * حتى يُطبَّق التفضيل المحفوظ قبل ظهور أي محتوى، لا في نهاية <body>
 * مع باقي السكريبتات.
 *
 * @format
 */

(function () {
  "use strict";

  const MODE_KEY = "hypertech-theme-mode"; // "light" | "dark"
  const ACCENT_KEY = "hypertech-theme-accent"; // "default" | "industrial-green" | ...

  function applyStored() {
    const mode = localStorage.getItem(MODE_KEY);
    const accent = localStorage.getItem(ACCENT_KEY);
    const html = document.documentElement;

    if (mode === "light") {
      html.setAttribute("data-theme", "light");
    } else {
      html.removeAttribute("data-theme"); // الافتراضي Dark
    }

    if (accent && accent !== "default") {
      html.setAttribute("data-accent", accent);
    } else {
      html.removeAttribute("data-accent");
    }
  }

  // تطبيق فوري وقت ما يوصل السكريبت، من غير استنى أي حاجة تانية
  applyStored();

  window.HyperTechTheme = {
    setMode(mode) {
      if (mode === "light") {
        localStorage.setItem(MODE_KEY, "light");
      } else {
        localStorage.setItem(MODE_KEY, "dark");
      }
      applyStored();
    },
    setAccent(accent) {
      localStorage.setItem(ACCENT_KEY, accent || "default");
      applyStored();
    },
    getMode() {
      return localStorage.getItem(MODE_KEY) === "light" ? "light" : "dark";
    },
    getAccent() {
      return localStorage.getItem(ACCENT_KEY) || "default";
    },
  };

  // ✅ حقن زرار تبديل الإضاءة/الهوية اللونية تلقائيًا في أي صفحة عندها
  // .topbar-actions — بدل التعديل اليدوي في كل صفحة على حدة (33 صفحة
  // مختلفة المحتوى الداخلي، تعديلها يدويًا كان هيكون خطر أعلى بكتير).
  const ACCENT_LABELS = {
    default: "أزرق مؤسسي",
    "industrial-green": "أخضر صناعي",
    "warning-amber": "كهرماني تحذيري",
    "steel-gray": "رمادي فولاذي",
  };

  function buildWidget() {
    const wrap = document.createElement("div");
    wrap.className = "theme-widget";
    wrap.innerHTML = `
      <button type="button" class="theme-widget-btn" id="theme-mode-toggle" title="تبديل الإضاءة">
        <i class="fa-solid fa-circle-half-stroke"></i>
      </button>
      <div class="theme-widget-dropdown" id="theme-accent-dropdown" hidden>
        ${Object.entries(ACCENT_LABELS)
          .map(
            ([key, label]) =>
              `<button type="button" class="theme-accent-option" data-accent="${key}">
                 <span class="theme-accent-dot" data-dot="${key}"></span>${label}
               </button>`,
          )
          .join("")}
      </div>
      <button type="button" class="theme-widget-btn" id="theme-accent-toggle" title="تبديل الهوية اللونية">
        <i class="fa-solid fa-palette"></i>
      </button>
    `;
    return wrap;
  }

  function injectWidget() {
    if (document.querySelector(".theme-widget")) return; // منع التكرار
    const host = document.querySelector(".topbar-actions");
    const widget = buildWidget();

    if (host) {
      host.insertBefore(widget, host.firstChild);
    } else {
      // ✅ صفحات مستقلة التصميم (بلا topbar-actions) — نعرض الويدجت
      // كزر عائم ثابت في الشاشة بدل ما نسيب المستخدم بلا أي وسيلة تحكم.
      widget.classList.add("theme-widget-floating");
      document.body.appendChild(widget);
    }

    const modeBtn = widget.querySelector("#theme-mode-toggle");
    const accentBtn = widget.querySelector("#theme-accent-toggle");
    const dropdown = widget.querySelector("#theme-accent-dropdown");

    modeBtn.addEventListener("click", () => {
      const next = window.HyperTechTheme.getMode() === "light" ? "dark" : "light";
      window.HyperTechTheme.setMode(next);
    });

    accentBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.hidden = !dropdown.hidden;
    });

    dropdown.querySelectorAll(".theme-accent-option").forEach((btn) => {
      btn.addEventListener("click", () => {
        window.HyperTechTheme.setAccent(btn.dataset.accent);
        dropdown.hidden = true;
      });
    });

    document.addEventListener("click", () => {
      dropdown.hidden = true;
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectWidget);
  } else {
    injectWidget();
  }
})();
