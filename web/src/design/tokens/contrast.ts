import {
  CONTRAST_PAIRS,
  DEFAULTS,
  FAMILIES,
  ROLES,
  chromaFactor,
  lightnessOf,
  type Ref,
  type RoleName,
  type ScaleName,
} from "./palette";
import { contrastRatio, oklchToSrgb, type Rgb } from "./oklch";

export interface Ctx {
  brandHue: number;
  brandChroma: number;
  neutralHue: number;
  neutralChroma: number;
}

export const DEFAULT_CTX: Ctx = {
  brandHue: DEFAULTS.brandHue,
  brandChroma: DEFAULTS.brandChroma,
  neutralHue: DEFAULTS.warm.h,
  neutralChroma: DEFAULTS.warm.c,
};

export function colorOf(ref: Ref, ctx: Ctx): Rgb {
  const [name, stepStr] = ref.split(".") as [ScaleName, string];
  const step = Number(stepStr);
  const f = FAMILIES[name];
  const l = lightnessOf(name, step);
  const factor = chromaFactor(name, step);
  let h: number;
  let c: number;
  if (name === "neutral") {
    h = ctx.neutralHue;
    c = ctx.neutralChroma * (step === 0 ? 0.4 : 1);
  } else if (name === "brand") {
    h = ctx.brandHue;
    c = ctx.brandChroma * factor;
  } else {
    h = f.hue as number;
    c = (f.chroma as number) * factor;
  }
  return oklchToSrgb(l, c, h);
}

export interface Finding {
  theme: "light" | "dark";
  fg: RoleName;
  bg: RoleName;
  ratio: number;
  min: number;
  why: string;
}

export function checkAll(ctx: Ctx = DEFAULT_CTX, themes: Array<"light" | "dark"> = ["light", "dark"]) {
  const failures: Finding[] = [];
  const all: Finding[] = [];
  for (const theme of themes) {
    for (const p of CONTRAST_PAIRS) {
      const fg = colorOf(ROLES[p.fg][theme], ctx);
      const bg = colorOf(ROLES[p.bg][theme], ctx);
      const ratio = contrastRatio(fg, bg);
      const f: Finding = { theme, fg: p.fg, bg: p.bg, ratio, min: p.min, why: p.why };
      all.push(f);
      if (ratio < p.min) failures.push(f);
    }
  }
  return { failures, all };
}

/**
 * Takes the company's brand hue/chroma and lowers chroma until every contrast
 * pair passes. Some hues (green/cyan band) are too light at the fixed lightness
 * steps to carry white text at full chroma.
 */
export function fitBrandChroma(hue: number, chroma: number, base: Ctx = DEFAULT_CTX): number {
  let c = Math.max(0.02, Math.min(chroma, 0.27));
  for (let i = 0; i < 40; i++) {
    if (checkAll({ ...base, brandHue: hue, brandChroma: c }).failures.length === 0) return c;
    c -= 0.01;
    if (c < 0.02) break;
  }
  return 0.02;
}
