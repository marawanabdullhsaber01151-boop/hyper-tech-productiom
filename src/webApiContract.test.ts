import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * حارس العقود بين الواجهة والسيرفر (خطوة 32).
 *
 * فحص «المستهلكين» (scripts/api-consumers.mjs) بيطابق بالمسار بس وبيتجاهل الفعل (GET/POST/PATCH)؛
 * عشان كده نموذج «تأكيد العملية» القديم كان بيبعت POST على مسار PATCH-only وفضل مكسور بدون ما حد يحس.
 * الحارس ده بيطابق الفعل + المسار: أي استدعاء api.<verb>("/path") في web/src لازم يقابله router.<verb> فعلي.
 *
 * حدّه: الاستدعاءات اللي مسارها بيتبني بالكامل من متغيّر (مش حرف ثابت) مش بتتفحص.
 */
const walk = (d: string, out: string[] = []): string[] => {
  for (const n of readdirSync(d)) {
    const p = path.join(d, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

interface Route { method: string; path: string }
const ROUTE = /\b(?:router|[a-zA-Z]+Router)\.(get|post|put|patch|delete)\(\s*(["'`])([^"'`]+)\2/g;
const ROUTE_BASE = /\b(?:router|[a-zA-Z]+Router)\.(get|post|put|patch|delete)\(\s*BASE\b/g;

function serverRoutes(): Route[] {
  const routes: Route[] = [];
  for (const f of walk("src/routes").filter((x) => x.endsWith(".ts") && !x.endsWith(".test.ts"))) {
    const s = readFileSync(f, "utf8");
    const base = /const BASE\s*=\s*["'`]([^"'`]+)["'`]/.exec(s)?.[1];
    if (base) for (const k of s.matchAll(ROUTE_BASE)) routes.push({ method: k[1]!.toUpperCase(), path: base });
    for (const m of s.matchAll(ROUTE)) routes.push({ method: m[1]!.toUpperCase(), path: base ? m[3]!.replace("${BASE}", base) : m[3]! });
  }
  return routes;
}

const segs = (p: string) => p.split("/").filter(Boolean);
export function pathMatches(call: string, route: string): boolean {
  const a = segs(call);
  const b = segs(route);
  if (a.length !== b.length) return false;
  return a.every((s, i) => b[i]!.startsWith(":") || b[i]!.includes("${") || s.includes("${") || s === b[i]);
}

const CALL = /\bapi\.(get|post|put|patch|delete)\s*(?:<[^()]*?>)?\s*\(\s*(["'`])((?:\\.|(?!\2)[^\\])*)\2/g;

describe("عقود الواجهة مع السيرفر (الفعل + المسار)", () => {
  const routes = serverRoutes();

  it("مطابقة المسارات بتتعامل مع :param و${}", () => {
    expect(pathMatches("/a/1/confirm", "/a/:id/confirm")).toBe(true);
    expect(pathMatches("/a/${id}/confirm", "/a/:id/confirm")).toBe(true);
    expect(pathMatches("/a/1", "/a/:id/confirm")).toBe(false);
  });

  it("الحارس نفسه شغّال: لقى مسارات واستدعاءات كفاية", () => {
    expect(routes.length).toBeGreaterThan(300);
    expect(routes.some((r) => r.method === "PATCH" && r.path === "/production-execution/batches/:id/confirm")).toBe(true);
  });

  it("كل استدعاء من الواجهة ليه مسار بنفس الفعل على السيرفر", () => {
    const bad: string[] = [];
    let total = 0;
    for (const f of walk("web/src").filter((x) => /\.tsx?$/.test(x) && !/\.test\.tsx?$/.test(x))) {
      const s = readFileSync(f, "utf8");
      for (const m of s.matchAll(CALL)) {
        const p = m[3]!.split("?")[0]!;
        if (!p.startsWith("/")) continue;
        total++;
        const method = m[1]!.toUpperCase();
        if (routes.some((r) => r.method === method && pathMatches(p, r.path))) continue;
        const other = [...new Set(routes.filter((r) => r.method !== method && pathMatches(p, r.path)).map((r) => r.method))];
        bad.push(`${method} ${p} (${f}) ${other.length ? `← موجود بفعل: ${other.join("/")}` : "← مفيش مسار بالاسم ده"}`);
      }
    }
    expect(total).toBeGreaterThan(150);
    expect(bad).toEqual([]);
  });
});
