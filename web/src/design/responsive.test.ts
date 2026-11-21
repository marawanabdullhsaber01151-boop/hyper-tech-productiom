import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return cssFiles(p);
    return p.endsWith(".css") && !p.endsWith("generated.css") ? [p] : [];
  });
}
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = cssFiles(SRC);

describe("حراسة التجاوب (CSS)", () => {
  it("لقينا ملفات CSS أصلًا (الحراسة مش فاضية)", () => {
    expect(FILES.length).toBeGreaterThan(10);
  });

  it("أي عمود شبكة بعرض أدنى كبير (≥ 180px) لازم يتحدّد بـ min(…,100%) وإلا يفيض على موبايل 320px", () => {
    const bad: string[] = [];
    for (const f of FILES) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        for (const m of line.matchAll(/minmax\((\d+)px/g)) if (Number(m[1]) >= 180) bad.push(`${f}:${i + 1} ${m[0]}`);
      });
    }
    expect(bad).toEqual([]);
  });

  it("الصور والـSVG مش بتتخطى عرض الشاشة، والصفحة ما بتعملش تمرير أفقي", () => {
    const base = readFileSync(join(SRC, "design/tokens/base.css"), "utf8");
    expect(base).toMatch(/img,\s*svg\s*\{[^}]*max-inline-size:\s*100%/);
  });

  it("كل جدول خام (<table>) جوه حاوية بتمرّر أفقيًا", () => {
    const tsx = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? tsx(p) : /\.tsx$/.test(n) && !/test/.test(n) ? [p] : []; });
    const css = FILES.map((f) => readFileSync(f, "utf8")).join("\n");
    const bad: string[] = [];
    for (const f of tsx(SRC)) {
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((l, i) => {
        if (!/<table[\s>]/.test(l) || f.endsWith("Data.tsx")) return;
        const ctx = lines.slice(Math.max(0, i - 3), i).join(" ");
        const m = [...ctx.matchAll(/class=\{?["']([\w-]+)/g)].pop();
        const ok = m && new RegExp(`\\.${m[1]}[^{]*\\{[^}]*overflow-x:\\s*auto`).test(css);
        if (!ok) bad.push(`${f}:${i + 1}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
