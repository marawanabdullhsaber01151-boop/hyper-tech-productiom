/**
 * Single source of truth for colours.
 *
 *  - build-tokens.ts turns this into generated.css
 *  - check-contrast.ts reads the SAME data and fails the build when a text /
 *    background pair is below WCAG AA.
 *
 * Lightness (L) of every step is fixed. Only hue / chroma are variable (brand
 * colour from the portal settings), which keeps contrast stable when the
 * company changes its brand colour.
 */

export type ScaleName = "neutral" | "brand" | "success" | "warn" | "danger" | "info";

export const ACCENT_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
export const NEUTRAL_STEPS = [0, 50, 100, 200, 300, 350, 400, 450, 500, 600, 700, 800, 900, 950] as const;

const NEUTRAL_L: Record<number, number> = {
  0: 1,
  50: 0.982,
  100: 0.962,
  200: 0.925,
  300: 0.875,
  350: 0.8,
  400: 0.74,
  450: 0.66,
  500: 0.59,
  600: 0.5,
  700: 0.41,
  800: 0.315,
  900: 0.235,
  950: 0.175,
};

const ACCENT_L: Record<number, number> = {
  50: 0.975,
  100: 0.948,
  200: 0.902,
  300: 0.84,
  400: 0.75,
  500: 0.66,
  600: 0.55,
  700: 0.47,
  800: 0.4,
  900: 0.33,
  950: 0.25,
};

/** How much of the family's full chroma each step gets (pale and very dark steps are calmer). */
const ACCENT_CHROMA_FACTOR: Record<number, number> = {
  50: 0.1,
  100: 0.2,
  200: 0.36,
  300: 0.55,
  400: 0.78,
  500: 0.95,
  600: 1,
  700: 0.97,
  800: 0.84,
  900: 0.66,
  950: 0.48,
};

export interface FamilyDef {
  /** Hue in degrees, or "var" when it comes from a CSS variable at runtime. */
  hue: number | "var";
  chroma: number | "var";
  hueVar?: string;
  chromaVar?: string;
}

export const FAMILIES: Record<ScaleName, FamilyDef> = {
  neutral: { hue: "var", chroma: "var", hueVar: "--n-h", chromaVar: "--n-c" },
  brand: { hue: "var", chroma: "var", hueVar: "--brand-h", chromaVar: "--brand-c" },
  success: { hue: 152, chroma: 0.15 },
  warn: { hue: 78, chroma: 0.15 },
  danger: { hue: 25, chroma: 0.2 },
  info: { hue: 215, chroma: 0.12 },
};

/** Defaults used by the checker and as :root fallbacks. */
export const DEFAULTS = {
  brandHue: 262,
  brandChroma: 0.2,
  warm: { h: 80, c: 0.009 },
  cool: { h: 255, c: 0.012 },
} as const;

export function stepsOf(name: ScaleName): readonly number[] {
  return name === "neutral" ? NEUTRAL_STEPS : ACCENT_STEPS;
}

export function lightnessOf(name: ScaleName, step: number): number {
  const v = (name === "neutral" ? NEUTRAL_L : ACCENT_L)[step];
  if (v === undefined) throw new Error(`unknown step ${name}.${step}`);
  return v;
}

export function chromaFactor(name: ScaleName, step: number): number {
  return name === "neutral" ? 1 : (ACCENT_CHROMA_FACTOR[step] ?? 1);
}

/** "brand.600" */
export type Ref = `${ScaleName}.${number}`;

export interface Role {
  light: Ref;
  dark: Ref;
}

const r = (light: Ref, dark: Ref): Role => ({ light, dark });

/** Semantic roles. These are the only colours components may use. */
export const ROLES = {
  "surface-0": r("neutral.50", "neutral.950"),
  "surface-1": r("neutral.0", "neutral.900"),
  "surface-2": r("neutral.100", "neutral.800"),
  "surface-3": r("neutral.200", "neutral.700"),
  "surface-inverse": r("neutral.900", "neutral.100"),
  "text-1": r("neutral.900", "neutral.50"),
  "text-2": r("neutral.700", "neutral.300"),
  "text-3": r("neutral.600", "neutral.400"),
  "text-inverse": r("neutral.50", "neutral.900"),
  "border-1": r("neutral.200", "neutral.800"),
  "border-2": r("neutral.300", "neutral.700"),
  "border-input": r("neutral.500", "neutral.500"),

  brand: r("brand.600", "brand.600"),
  "brand-hover": r("brand.700", "brand.700"),
  "brand-active": r("brand.800", "brand.800"),
  "brand-soft": r("brand.50", "brand.950"),
  "brand-soft-2": r("brand.100", "brand.900"),
  "brand-text": r("brand.700", "brand.300"),
  "on-brand": r("neutral.0", "neutral.0"),
  "focus-ring": r("brand.600", "brand.400"),

  success: r("success.700", "success.500"),
  "success-soft": r("success.50", "success.950"),
  "success-text": r("success.800", "success.300"),
  "on-success": r("neutral.0", "neutral.950"),

  warn: r("warn.400", "warn.400"),
  "warn-mark": r("warn.600", "warn.400"),
  "warn-soft": r("warn.50", "warn.950"),
  "warn-text": r("warn.800", "warn.300"),
  "on-warn": r("neutral.950", "neutral.950"),

  danger: r("danger.600", "danger.500"),
  "danger-hover": r("danger.700", "danger.400"),
  "danger-soft": r("danger.50", "danger.950"),
  "danger-text": r("danger.700", "danger.300"),
  "on-danger": r("neutral.0", "neutral.950"),

  info: r("info.700", "info.500"),
  "info-soft": r("info.50", "info.950"),
  "info-text": r("info.800", "info.300"),
  "on-info": r("neutral.0", "neutral.950"),
} as const satisfies Record<string, Role>;

export type RoleName = keyof typeof ROLES;

export interface ContrastPair {
  fg: RoleName;
  bg: RoleName;
  min: number;
  why: string;
}

const TEXT_BG: RoleName[] = ["surface-0", "surface-1", "surface-2"];

export const CONTRAST_PAIRS: ContrastPair[] = [
  ...(["text-1", "text-2", "text-3"] as RoleName[]).flatMap((fg) =>
    TEXT_BG.map((bg) => ({ fg, bg, min: 4.5, why: "نص عادي" })),
  ),
  { fg: "text-inverse", bg: "surface-inverse", min: 4.5, why: "نص على سطح معكوس (tooltip)" },
  ...TEXT_BG.map((bg) => ({ fg: "brand-text" as RoleName, bg, min: 4.5, why: "رابط/نص بلون العلامة" })),
  { fg: "brand-text", bg: "brand-soft", min: 4.5, why: "نص على خلفية العلامة الخفيفة" },
  { fg: "brand-text", bg: "brand-soft-2", min: 4.5, why: "نص على خلفية العلامة" },
  { fg: "on-brand", bg: "brand", min: 4.5, why: "نص الزر الأساسي" },
  { fg: "on-brand", bg: "brand-hover", min: 3, why: "نص الزر الأساسي أثناء المرور" },
  { fg: "brand", bg: "surface-1", min: 3, why: "حدود/أيقونات الزر على الكارت" },
  { fg: "brand", bg: "surface-0", min: 3, why: "حدود/أيقونات على الخلفية" },
  { fg: "focus-ring", bg: "surface-0", min: 3, why: "حلقة التركيز" },
  { fg: "focus-ring", bg: "surface-1", min: 3, why: "حلقة التركيز" },
  { fg: "border-input", bg: "surface-1", min: 3, why: "حدود حقل الإدخال (WCAG 1.4.11)" },
  { fg: "border-input", bg: "surface-0", min: 3, why: "حدود حقل الإدخال" },
  ...(["success", "warn", "danger", "info"] as const).flatMap((k) => [
    { fg: `${k}-text` as RoleName, bg: `${k}-soft` as RoleName, min: 4.5, why: `نص ${k} على خلفيته` },
    ...TEXT_BG.map((bg) => ({ fg: `${k}-text` as RoleName, bg, min: 4.5, why: `نص ${k} على السطح` })),
    { fg: `on-${k}` as RoleName, bg: k as RoleName, min: 4.5, why: `نص فوق ${k} المصمت` },
    {
      fg: (k === "warn" ? "warn-mark" : k) as RoleName,
      bg: "surface-1" as RoleName,
      min: 3,
      why: `أيقونة/مؤشر ${k}`,
    },
  ]),
];
