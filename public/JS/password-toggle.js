/** @format */
// ============================================================
//  PASSWORD TOGGLE — إظهار/إخفاء كلمة المرور
//  ملف واحد مستقل تمامًا: بيدوّر لوحده على أي حقل type="password"
//  في الصفحة ويضيفله زرار عرض/إخفاء أوتوماتيك — من غير ما يحتاج
//  أي تعديل يدوي في الـ HTML، ومن غير ما يعتمد على Font Awesome
//  أو أي مكتبة خارجية (SVG مرسوم يدوي) — يشتغل في أي صفحة يتحط فيها.
// ============================================================
(function () {
  const EYE_SVG =
    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF_SVG =
    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><path d="M6.1 6.1C3.51 7.86 2 12 2 12s4 8 11 8a9.1 9.1 0 0 0 5.9-2.1"/><path d="M1 1l22 22"/></svg>';

  function injectStyles() {
    if (document.getElementById("pw-toggle-styles")) return;
    const style = document.createElement("style");
    style.id = "pw-toggle-styles";
    style.textContent = `
      .pw-toggle-wrap { position: relative; }
      .pw-toggle-wrap input[type="password"], .pw-toggle-wrap input[type="text"] { padding-left: 40px !important; }
      .pw-toggle-btn { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); background: none;
        border: none; cursor: pointer; padding: 4px; display: flex; color: #7c8a9a; opacity: .8; transition: .2s; line-height: 0; }
      .pw-toggle-btn:hover { color: #f59e0b; opacity: 1; }
      .pw-toggle-btn:focus-visible { outline: 2px solid #f59e0b; outline-offset: 2px; border-radius: 4px; }
    `;
    document.head.appendChild(style);
  }

  function wrapField(input) {
    if (input.dataset.pwToggled) return; // ✅ منع التكرار لو الملف اتحمّل أكتر من مرة بالغلط
    input.dataset.pwToggled = "1";

    const wrap = document.createElement("div");
    wrap.className = "pw-toggle-wrap";
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pw-toggle-btn";
    btn.innerHTML = EYE_SVG;
    btn.setAttribute("aria-label", "إظهار كلمة المرور");
    btn.tabIndex = -1; // ✅ Tab يفضل يتنقل بين حقول الفورم الحقيقية بس، مش يقف على زرار العرض

    btn.addEventListener("click", () => {
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      btn.innerHTML = showing ? EYE_SVG : EYE_OFF_SVG;
      btn.setAttribute(
        "aria-label",
        showing ? "إظهار كلمة المرور" : "إخفاء كلمة المرور",
      );
    });

    wrap.appendChild(btn);
  }

  function init() {
    injectStyles();
    document.querySelectorAll('input[type="password"]').forEach(wrapField);
  }

  // ✅ إصلاح: أي كود تاني بيضيف حقل باسورد جديد للصفحة بعد التحميل الأول
  // (زي مودال بيتفتح ديناميكيًا) يقدر ينده window.refreshPasswordToggles()
  // مباشرة عشان يلحق الحقول الجديدة بس. الطريقة القديمة اللي كانت بتحاول
  // تعمل window.dispatchEvent(new Event("DOMContentLoaded")) ما كانتش
  // بتوصل خالص — الحدث ده بيتسمع عليه في document مش window، وأصلاً init()
  // بتتنفذ فورًا عند التحميل العادي من غير ما تستني الحدث ده أبدًا.
  window.refreshPasswordToggles = init;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
