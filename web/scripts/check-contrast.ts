/**
 * Fails (exit 1) when a text/background pair is below its WCAG minimum.
 * Also sweeps the brand hue so a company changing its brand colour from the
 * settings can be told which hues are unsafe.
 *   tsx web/scripts/check-contrast.ts [--verbose] [--sweep]
 */
import { DEFAULTS } from "../src/design/tokens/palette";
import { DEFAULT_CTX, checkAll } from "../src/design/tokens/contrast";

const verbose = process.argv.includes("--verbose");
const sweep = process.argv.includes("--sweep");

function report(title: string, ctx = DEFAULT_CTX): number {
  const { failures, all } = checkAll(ctx);
  console.log(`${title}: ${all.length - failures.length}/${all.length} ثنائية سليمة`);
  if (verbose) {
    for (const f of all) {
      console.log(
        `  ${f.ratio >= f.min ? "✓" : "✗"} [${f.theme}] ${f.fg} على ${f.bg}: ${f.ratio.toFixed(2)} (المطلوب ${f.min})`,
      );
    }
  }
  for (const f of failures) {
    console.log(`  ✗ [${f.theme}] ${f.fg} على ${f.bg}: ${f.ratio.toFixed(2)} < ${f.min} — ${f.why}`);
  }
  return failures.length;
}

let bad = report("الألوان الافتراضية (دافئ)");
bad += report("نبرة الإدارة (باردة)", {
  ...DEFAULT_CTX,
  neutralHue: DEFAULTS.cool.h,
  neutralChroma: DEFAULTS.cool.c,
});

if (sweep) {
  console.log("\nمسح درجات لون العلامة (التشبع الافتراضي):");
  for (let h = 0; h < 360; h += 15) {
    const { failures } = checkAll({ ...DEFAULT_CTX, brandHue: h });
    const brandOnly = failures.filter((f) => /brand/.test(`${f.fg}${f.bg}`));
    console.log(`  hue ${String(h).padStart(3)}: ${brandOnly.length === 0 ? "آمن" : "مخالفات: " + brandOnly.map((f) => `${f.fg}/${f.bg}@${f.theme}=${f.ratio.toFixed(2)}`).join(", ")}`);
  }
}

if (bad > 0) {
  console.error(`\nفشل فحص التباين (${bad} مخالفة).`);
  process.exit(1);
}
console.log("فحص التباين: تمام ✓");
