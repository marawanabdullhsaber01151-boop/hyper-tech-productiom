/**
 * Small, dependency-free OKLCH helpers.
 * Used by the token generator, the contrast checker and the runtime theme
 * (brand colour hex → hue/chroma). Formulas: Björn Ottosson's OKLab.
 */

export type Rgb = readonly [number, number, number]; // 0..1, sRGB, gamma-encoded

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function srgbEncode(v: number): number {
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}
function srgbDecode(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** OKLCH → linear sRGB (may be out of gamut). */
export function oklchToLinear(l: number, c: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const L = l_ ** 3;
  const M = m_ ** 3;
  const S = s_ ** 3;
  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
}

/** OKLCH → sRGB (clipped, the way a browser would roughly show it). */
export function oklchToSrgb(l: number, c: number, h: number): Rgb {
  const [r, g, b] = oklchToLinear(l, c, h);
  return [srgbEncode(clamp01(r)), srgbEncode(clamp01(g)), srgbEncode(clamp01(b))];
}

export function srgbToOklch(rgb: Rgb): { l: number; c: number; h: number } {
  const [r, g, b] = rgb.map(srgbDecode) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.hypot(A, B);
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h: c < 1e-4 ? 0 : h };
}

export function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let v = m[1]!;
  if (v.length === 3) v = v.split("").map((x) => x + x).join("");
  return [
    parseInt(v.slice(0, 2), 16) / 255,
    parseInt(v.slice(2, 4), 16) / 255,
    parseInt(v.slice(4, 6), 16) / 255,
  ];
}

/** Brand colour from a hex string: only hue and chroma are kept (lightness comes from the scale). */
export function hexToHueChroma(hex: string): { h: number; c: number } | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const { h, c } = srgbToOklch(rgb);
  return { h: Math.round(h * 10) / 10, c: Math.round(c * 1000) / 1000 };
}

export function relativeLuminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map(srgbDecode) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function toHex(rgb: Rgb): string {
  return (
    "#" +
    rgb
      .map((v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, "0"))
      .join("")
  );
}
