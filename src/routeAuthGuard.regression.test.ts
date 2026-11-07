import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dir = resolve(process.cwd(), "src/routes");
const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

/** أي مسار بيستخدم requirePermission/requireRole لازم تسبقه requireAuth (inline أو router.use)، وإلا req.user فاضي والرد 401. */
describe("حماية المسارات بتسجيل الدخول", () => {
  it("مفيش مسار بصلاحية من غير requireAuth", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(resolve(dir, f), "utf8");
      if (/router\.use\([^)]*requireAuth/.test(src) || /router\.use\(requireAuth/.test(src)) continue;
      const re = /router\.(get|post|put|patch|delete)\(\s*("[^"]*"|`[^`]*`|'[^']*')([\s\S]*?)(?:async\s*\(|\(req|\(_req)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const head = m[3]!;
        if (/requirePermission|requireRole|requireSettings/.test(head) && !/requireAuth/.test(head)) offenders.push(`${f} ${m[1]} ${m[2]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
  it("مركز الإعدادات محمي بـrequireAuth", () => {
    const s = readFileSync(resolve(dir, "settings-center.ts"), "utf8");
    expect(s).toContain('router.use("/settings/center", requireAuth)');
  });
});
