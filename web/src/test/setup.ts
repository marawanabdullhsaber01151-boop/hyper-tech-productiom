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
