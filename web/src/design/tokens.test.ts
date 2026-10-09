import { describe, expect, it } from "vitest";
import { checkAll, DEFAULT_CTX, fitBrandChroma } from "./tokens/contrast";
import { contrastRatio, hexToHueChroma, oklchToSrgb, parseHex, toHex } from "./tokens/oklch";
import { applyTheme, resolveAccent, DEFAULT_THEME } from "./theme-runtime";

describe("oklch", () => {
  it("أبيض/أسود", () => {
    expect(toHex(oklchToSrgb(1, 0, 0))).toBe("#ffffff");
    expect(contrastRatio(parseHex("#000000")!, parseHex("#ffffff")!)).toBeCloseTo(21, 0);
  });
  it("hex → hue/chroma", () => {
    const hc = hexToHueChroma("#2563eb")!;
    expect(hc.h).toBeGreaterThan(250);
    expect(hc.h).toBeLessThan(270);
    expect(hexToHueChroma("zzz")).toBeNull();
  });
});

describe("contrast", () => {
  it("كل الأزواج سليمة بالألوان الافتراضية (فاتح وغامق)", () => {
    expect(checkAll().failures).toEqual([]);
  });
  it("fitBrandChroma بيصلّح أي لون علامة", () => {
    for (let h = 0; h < 360; h += 15) {
      const c = fitBrandChroma(h, 0.27);
      expect(checkAll({ ...DEFAULT_CTX, brandHue: h, brandChroma: c }).failures).toEqual([]);
    }
  });
});

describe("theme-runtime", () => {
  it("بيطبّق اللون والكثافة والوضع", () => {
    const root = document.createElement("div");
    applyTheme({ accent: "teal", density: "compact", mode: "dark", radius: "sharp", fontScale: 1.1 }, root);
    expect(root.style.getPropertyValue("--brand-h")).toBe("195");
    expect(root.dataset.density).toBe("compact");
    expect(root.dataset.theme).toBe("dark");
    expect(root.style.getPropertyValue("--radius-scale")).toBe("0.4");
    expect(root.style.getPropertyValue("--font-scale")).toBe("1.1");
    expect(localStorage.getItem("hypertech-theme-mode")).toBe("dark");
  });
  it("system = من غير data-theme", () => {
    const root = document.createElement("div");
    root.dataset.theme = "dark";
    applyTheme({ mode: "system" }, root);
    expect(root.dataset.theme).toBeUndefined();
  });
  it("لون غريب بيرجع للأزرق، وhex بيتقبل", () => {
    expect(resolveAccent("nope")).toEqual({ h: 262, c: 0.2 });
    expect(resolveAccent("#16a34a").h).toBeGreaterThan(130);
  });
  it("حجم الخط بيتحدّد بين 0.9 و1.25", () => {
    const root = document.createElement("div");
    applyTheme({ fontScale: 3 }, root);
    expect(root.style.getPropertyValue("--font-scale")).toBe("1.25");
    expect(DEFAULT_THEME.mode).toBe("system");
  });
});
