import { render } from "preact";
import { App } from "./app/App";
import { bootTheme } from "./design/theme-runtime";
import "./design/components";
import { portalBoot } from "./portal/routes";

/** بعد أي نشر جديد، ملفات النسخة القديمة بتتمسح. لو الصفحة المفتوحة طلبت ملف اتمسح، نعمل تحديث تلقائي مرة واحدة بدل ما المستخدم يعمل Hard refresh. */
window.addEventListener("vite:preloadError", (e) => {
  try {
    const last = Number(sessionStorage.getItem("ht_reloaded_at") || 0);
    if (Date.now() - last < 30_000) return;
    sessionStorage.setItem("ht_reloaded_at", String(Date.now()));
  } catch {
    /* التخزين مش متاح: نكمّل ونحدّث مرة */
  }
  e.preventDefault();
  location.reload();
});

bootTheme();
portalBoot();
render(<App />, document.getElementById("app")!);
