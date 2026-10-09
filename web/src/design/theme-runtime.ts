/**
 * يطبّق إعدادات الثيم (لون العلامة، الاستدارة، الكثافة، حجم الخط، فاتح/غامق)
 * على <html> من غير وميض. نفس مفتاح الصفحات القديمة: hypertech-theme-mode.
 */
import { fitBrandChroma } from "./tokens/contrast";
import { t, type CopyKey } from "../copy";
import { hexToHueChroma } from "./tokens/oklch";

export type ThemeMode = "light" | "dark" | "system";
export type Density = "cozy" | "compact";
export type Radius = "sharp" | "soft" | "round";

export interface ThemeSettings {
  accent: string; // preset name or #hex
  mode: ThemeMode;
  radius: Radius;
  density: Density;
  fontScale: number;
  tone: "warm" | "cool";
}

export const BRAND_PRESETS: Record<string, { h: number; c: number }> = {
  blue: { h: 262, c: 0.2 },
  teal: { h: 195, c: 0.12 },
  green: { h: 152, c: 0.14 },
  orange: { h: 50, c: 0.17 },
  rose: { h: 0, c: 0.2 },
  violet: { h: 295, c: 0.2 },
  slate: { h: 255, c: 0.04 },
};

export const DEFAULT_THEME: ThemeSettings = {
  accent: "blue",
  mode: "system",
  radius: "soft",
  density: "cozy",
  fontScale: 1,
  tone: "warm",
};

const RADIUS_SCALE: Record<Radius, number> = { sharp: 0.4, soft: 1, round: 1.5 };
const MODE_KEY = "hypertech-theme-mode";
const CACHE_KEY = "hypertech-theme-v2";

/** اسم اللون بالعربي من copy/ar.ts */
export const accentLabel = (k: string) => t(`accent.${k}` as CopyKey);

export function resolveAccent(accent: string): { h: number; c: number } {
  const preset = BRAND_PRESETS[accent];
  if (preset) return { h: preset.h, c: preset.c };
  const fromHex = hexToHueChroma(accent);
  if (fromHex) return fromHex;
  const d = BRAND_PRESETS.blue!;
  return { h: d.h, c: d.c };
}

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* خاص/ممنوع — عادي */
  }
}

export function applyTheme(partial: Partial<ThemeSettings> = {}, root: HTMLElement = document.documentElement): ThemeSettings {
  const t: ThemeSettings = { ...DEFAULT_THEME, ...readCachedTheme(), ...partial };
  const { h, c } = resolveAccent(t.accent);
  // الكروما بتتقلّل تلقائي لو لون الشركة مش بيحقق تباين كفاية
  const fitted = fitBrandChroma(h, c);
  root.style.setProperty("--brand-h", String(Math.round(h * 10) / 10));
  root.style.setProperty("--brand-c", String(Math.round(fitted * 1000) / 1000));
  root.style.setProperty("--radius-scale", String(RADIUS_SCALE[t.radius] ?? 1));
  root.style.setProperty("--font-scale", String(Math.min(1.25, Math.max(0.9, t.fontScale))));
  root.dataset.density = t.density;
  if (t.tone === "cool") root.dataset.tone = "cool";
  else delete root.dataset.tone;
  if (t.mode === "system") delete root.dataset.theme;
  else root.dataset.theme = t.mode;
  safeSet(CACHE_KEY, JSON.stringify(t));
  if (t.mode !== "system") safeSet(MODE_KEY, t.mode);
  return t;
}

export function readCachedTheme(): Partial<ThemeSettings> {
  const raw = safeGet(CACHE_KEY);
  let cached: Partial<ThemeSettings> = {};
  if (raw) {
    try {
      cached = JSON.parse(raw) as Partial<ThemeSettings>;
    } catch {
      cached = {};
    }
  }
  const legacy = safeGet(MODE_KEY);
  if (!cached.mode && (legacy === "light" || legacy === "dark")) cached.mode = legacy;
  return cached;
}

/** يتنادى أول حاجة في main.tsx (والـ gallery) قبل أول رسم. */
export function bootTheme() {
  applyTheme({});
}

/** يجيب ثيم الشركة من السيرفر ويطبّقه. الفشل مش بيكسر الصفحة. */
export async function syncThemeFromServer(fetcher: () => Promise<Partial<ThemeSettings>>) {
  try {
    applyTheme(await fetcher());
  } catch {
    /* نكمّل بالمخزّن */
  }
}
