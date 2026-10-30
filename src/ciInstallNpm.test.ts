import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// السبب الجذري لفشل `npm ci` على GitHub/Vercel: package-lock.json بيتكتب بـnpm 11 (جهاز المطوّر)،
// و npm 10 (الافتراضي مع Node 22 على السيرفرات) بيعتبره ناقص ("Missing: esbuild@0.28.2 from lock file")
// بسبب peer اختياري لـvite 8 جوّه vitest. الحل: كل مكان بيثبّت الحزم يستخدم npm 11، وده الحارس.

const root = process.cwd();
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

function ymlFiles(dir: string): string[] {
  const abs = resolve(root, dir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...ymlFiles(rel));
    else if (/\.ya?ml$/.test(entry.name)) out.push(rel);
  }
  return out;
}

describe("كل مكان بيشغّل npm ci بيستخدم npm 11", () => {
  const files = [...ymlFiles(".github/workflows"), ...ymlFiles(".github/actions")];

  it("لقينا ملفات الـCI (الحارس مش فاضي)", () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  for (const file of files) {
    const text = read(file);
    const ci = text.search(/(^|\s)npm ci\b/m);
    if (ci < 0) continue;
    it(`${file}: تثبيت npm 11 قبل npm ci`, () => {
      const upgrade = text.indexOf("npm i -g npm@11");
      expect(upgrade, "لازم خطوة `npm i -g npm@11` قبل npm ci").toBeGreaterThanOrEqual(0);
      expect(upgrade).toBeLessThan(ci);
    });
  }

  it("vercel.json: أمر التثبيت بـnpm 11", () => {
    const cfg = JSON.parse(read("vercel.json")) as { installCommand?: string };
    expect(cfg.installCommand).toMatch(/npm@11 ci\b/);
  });
});
