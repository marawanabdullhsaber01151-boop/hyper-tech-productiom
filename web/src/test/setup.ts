import { afterEach } from "vitest";
import { cleanup } from "@testing-library/preact";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.cssText = "";
  document.documentElement.dir = "rtl";
  localStorage.clear();
  sessionStorage.clear();
});

document.documentElement.dir = "rtl";
document.documentElement.lang = "ar";

import "@testing-library/jest-dom/vitest";

// الاختبارات بتستدعي t() من غير ما تمر على الصفحات: نسجّل كل نصوص الصفحات هنا.
// (الفحص الحقيقي إن كل ملف عامل import لنصوصه هو check-copy.ts في البناء.)
import "../copy/lazy-dicts";
