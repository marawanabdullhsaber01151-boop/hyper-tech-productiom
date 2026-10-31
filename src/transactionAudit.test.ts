import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * حارس «لا عملية تنتهي بنصف حفظ» (خطوة 31).
 *
 * أي مسار (POST/PATCH/PUT/DELETE) فيه كتابتين أو أكتر على القاعدة لازم يكون جوّه db.transaction،
 * أو يتسجّل في docs/transaction-allowlist.json بسبب مكتوب. التحقق ساكن (بيقرا الكود)؛ والجانب
 * الديناميكي (قطع حقيقي في نص العملية على قاعدة بيانات) في e2e/power-cut.e2e.test.ts.
 *
 * حدّه المعروف: الكتابات اللي بتتم جوّه دوال مساعدة في src/lib ما بتتعدّش هنا؛ دي بيغطيها
 * نوع المعامل (Tx) في الدوال الحساسة (applyStockMovement, moveToTrash) واختبار القطع.
 */
const WRITE = /(?<!\bAnyRouter|\brouter|\w[rR]outer)\.(?:insert|update|delete)\(|INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM/gi;
const HANDLER = /^\s*(?:\w+Router|router)\.(post|patch|put|delete)\(\s*([`"'][^`"']+[`"'])/gm;

interface Found { file: string; method: string; path: string; writes: number }

function scan(): Found[] {
  const dir = "src/routes";
  const out: Found[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
    const text = readFileSync(`${dir}/${file}`, "utf8");
    const marks = [...text.matchAll(HANDLER)];
    marks.forEach((m, k) => {
      const body = text.slice(m.index!, k + 1 < marks.length ? marks[k + 1]!.index! : text.length);
      const writes = (body.match(WRITE) ?? []).length;
      if (writes >= 2 && !/\.transaction\(|\bBEGIN\b/.test(body)) {
        out.push({ file, method: m[1]!.toUpperCase(), path: m[2]!.slice(1, -1), writes });
      }
    });
  }
  return out;
}

const allow = JSON.parse(readFileSync("docs/transaction-allowlist.json", "utf8")) as {
  entries: { file: string; method: string; path: string; reason: string }[];
};
const key = (e: { file: string; method: string; path: string }) => `${e.file} ${e.method} ${e.path}`;

describe("حارس المعاملات: لا نصف حفظ", () => {
  it("كل مسار بكتابتين أو أكتر جوّه معاملة، أو مسجّل بسبب", () => {
    const allowed = new Set(allow.entries.map(key));
    const offenders = scan().filter((f) => !allowed.has(key(f))).map((f) => `${key(f)} (كتابات=${f.writes})`);
    expect(offenders).toEqual([]);
  });

  it("قايمة الاستثناءات نضيفة: كل استثناء لسه مطابق لمسار فعلي وليه سبب", () => {
    const found = new Set(scan().map(key));
    const stale = allow.entries.filter((e) => !found.has(key(e))).map(key);
    expect(stale).toEqual([]);
    for (const e of allow.entries) expect(e.reason.trim().length).toBeGreaterThan(10);
  });

  it("النقل للسلة (moveToTrash) ما بيتناداش بـ db العادي أبدًا، لازم tx", () => {
    const bad: string[] = [];
    const walk = (dir: string) => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${ent.name}`;
        if (ent.isDirectory()) walk(full);
        else if (full.endsWith(".ts") && !full.endsWith(".test.ts")) {
          if (/moveToTrash\(\s*db\b/.test(readFileSync(full, "utf8"))) bad.push(full);
        }
      }
    };
    walk("src");
    expect(bad).toEqual([]);
  });
});
