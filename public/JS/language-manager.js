/** @format */
// ============================================================
//  LANGUAGE MANAGER — Hyper-Tech ERP
//  إدارة اللغة والاتجاه (RTL/LTR) عبر جميع الصفحات
// ============================================================

class LanguageManager {
  constructor() {
    this.currentLang = this.getSavedLanguage();
    this.init();
  }

  /**
   * قراءة اللغة المحفوظة من localStorage
   * افتراضي: عربي (ar)
   */
  getSavedLanguage() {
    try {
      const settings = JSON.parse(
        localStorage.getItem("hyper_erp_settings") || "{}",
      );
      return settings.company?.language || "ar";
    } catch (e) {
      return "ar";
    }
  }

  /**
   * تطبيق اللغة على الصفحة
   */
  init() {
    this.applyLanguage(this.currentLang);
    this.setupLanguageSwitcher();
  }

  /**
   * تطبيق الاتجاه واللغة على عنصر <html>
   */
  applyLanguage(lang) {
    const htmlEl = document.documentElement;

    if (lang === "ar") {
      htmlEl.setAttribute("lang", "ar");
      htmlEl.setAttribute("dir", "rtl");
      document.body.style.direction = "rtl";
    } else {
      htmlEl.setAttribute("lang", "en");
      htmlEl.setAttribute("dir", "ltr");
      document.body.style.direction = "ltr";
    }

    this.currentLang = lang;
    localStorage.setItem("app_current_lang", lang);
  }

  /**
   * مراقبة تغيير اللغة من صفحة الإعدادات
   */
  setupLanguageSwitcher() {
    // استمع لتغييرات localStorage من صفحات أخرى
    window.addEventListener("storage", (e) => {
      if (e.key === "hyper_erp_settings") {
        const newLang = this.getSavedLanguage();
        if (newLang !== this.currentLang) {
          this.applyLanguage(newLang);
          // إعادة تحميل الصفحة لتطبيق التغييرات كاملة
          location.reload();
        }
      }
    });

    // استمع لتغيير اللغة من نفس الصفحة
    const languageSelector = document.getElementById("c-language");
    if (languageSelector) {
      languageSelector.addEventListener("change", (e) => {
        this.applyLanguage(e.target.value);
      });
    }
  }

  /**
   * تبديل اللغة يدويّاً
   */
  toggleLanguage() {
    const newLang = this.currentLang === "ar" ? "en" : "ar";
    this.applyLanguage(newLang);
    this.saveLanguageToSettings(newLang);
  }

  /**
   * حفظ اللغة في الإعدادات
   */
  saveLanguageToSettings(lang) {
    try {
      const settings = JSON.parse(
        localStorage.getItem("hyper_erp_settings") || "{}",
      );
      if (!settings.company) settings.company = {};
      settings.company.language = lang;
      localStorage.setItem("hyper_erp_settings", JSON.stringify(settings));
    } catch (e) {
      console.error("خطأ في حفظ اللغة:", e);
    }
  }
}

// تهيئة مدير اللغة عند تحميل DOM
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    window.languageManager = new LanguageManager();
  });
} else {
  // إذا تم تحميل الملف بعد DOMContentLoaded
  window.languageManager = new LanguageManager();
}

// تطبيق فوري قبل DOMContentLoaded (لتجنب الوميض)
(() => {
  const lang =
    (() => {
      try {
        const settings = JSON.parse(
          localStorage.getItem("hyper_erp_settings") || "{}",
        );
        return settings.company?.language || "ar";
      } catch {
        return "ar";
      }
    })() || "ar";

  const htmlEl = document.documentElement;
  if (lang === "ar") {
    htmlEl.setAttribute("lang", "ar");
    htmlEl.setAttribute("dir", "rtl");
    document.documentElement.style.direction = "rtl";
  } else {
    htmlEl.setAttribute("lang", "en");
    htmlEl.setAttribute("dir", "ltr");
    document.documentElement.style.direction = "ltr";
  }
})();
