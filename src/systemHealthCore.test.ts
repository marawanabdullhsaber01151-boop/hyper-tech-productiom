/** @format */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCESS } from "./lib/accessRegistry";
import { getNavForRole } from "./lib/departments";
import { normalizePath } from "./lib/errorPath";
import { USER_ROLES } from "./lib/roles";
import {
  GROUP_TITLES,
  buildReport,
  countWord,
  headline,
  rolesWithoutPages,
  runCheck,
  statusFromCount,
  summarize,
  usersWithUnknownRole,
  worst,
  type HealthCheck,
} from "./lib/systemHealthCore";

const mk = (id: string, status: HealthCheck["status"], group = "base"): HealthCheck => ({ id, group, title: id, status, message: id, ms: 1 });

describe("المحرّك: الحالات", () => {
  it("worst: المشكلة أسوأ من التنبيه، والتنبيه أسوأ من «ماتفحصش»، و«ماتفحصش» أسوأ من السليم", () => {
    expect(worst([])).toBe("ok");
    expect(worst(["ok", "unknown"])).toBe("unknown");
    expect(worst(["unknown", "warn"])).toBe("warn");
    expect(worst(["warn", "bad", "ok"])).toBe("bad");
  });

  it("statusFromCount", () => {
    expect(statusFromCount(0)).toBe("ok");
    expect(statusFromCount(1)).toBe("warn");
    expect(statusFromCount(9, { badAt: 10 })).toBe("warn");
    expect(statusFromCount(10, { badAt: 10 })).toBe("bad");
  });

  it("countWord بيدّي صيغة عربية مفهومة", () => {
    const f = { one: "فاتورة", two: "فاتورتين", few: "فواتير", many: "فاتورة" };
    expect(countWord(1, f)).toBe("فاتورة");
    expect(countWord(2, f)).toBe("فاتورتين");
    expect(countWord(5, f)).toBe("5 فواتير");
    expect(countWord(12, f)).toBe("12 فاتورة");
  });
});

describe("runCheck: فحص فاشل أو معلّق ما يوقفش الباقي ويظهر كمشكلة", () => {
  it("نتيجة سليمة بتعدّي زي ما هي ومعاها المدة", async () => {
    const r = await runCheck({ id: "a", group: "base", title: "أ", run: async () => ({ status: "ok", message: "تمام" }) });
    expect(r).toMatchObject({ id: "a", status: "ok", message: "تمام" });
    expect(typeof r.ms).toBe("number");
  });

  it("خطأ داخل الفحص ← «ماتفحصش» برسالة بسيطة (من غير نص الخطأ التقني)", async () => {
    const r = await runCheck({ id: "b", group: "base", title: "ب", run: async () => { throw new Error('relation "x" does not exist'); } });
    expect(r.status).toBe("unknown");
    expect(r.message).not.toMatch(/relation|does not exist/);
    expect(r.action).toBeTruthy();
  });

  it("فحص بيعلّق ← بعد المهلة بيتحوّل لـ«ماتفحصش»", async () => {
    const r = await runCheck({ id: "c", group: "base", title: "ج", run: () => new Promise(() => undefined) }, 20);
    expect(r.status).toBe("unknown");
    expect(r.message).toContain("اتأخر");
  });

  it("أمثلة أكتر من ٥ بتتقصّ", async () => {
    const r = await runCheck({ id: "d", group: "base", title: "د", run: async () => ({ status: "warn", message: "م", examples: ["1", "2", "3", "4", "5", "6", "7"] }) });
    expect(r.examples).toHaveLength(5);
  });
});

describe("buildReport", () => {
  it("بيرتّب المجموعات بترتيبها المعروف والأسوأ فوق جوّه المجموعة", () => {
    const rep = buildReport([mk("x", "ok", "sales"), mk("y", "bad", "sales"), mk("z", "warn", "base")]);
    expect(rep.groups.map((g) => g.id)).toEqual(["base", "sales"]);
    expect(rep.groups[1].checks.map((c) => c.id)).toEqual(["y", "x"]);
    expect(rep.groups[1].status).toBe("bad");
    expect(rep.status).toBe("bad");
    expect(rep.summary).toEqual({ ok: 1, warn: 1, bad: 1, unknown: 0 });
  });

  it("الجملة العامة بتتغير حسب الحالة", () => {
    expect(headline("ok", summarize([mk("a", "ok")]))).toContain("سليم");
    expect(headline("warn", summarize([mk("a", "warn")]))).toContain("ملاحظة");
    expect(headline("bad", summarize([mk("a", "bad"), mk("b", "warn")]))).toContain("خطيرة");
  });

  it("مجموعة غير معرّفة في GROUP_TITLES ما بتضيعش", () => {
    const rep = buildReport([mk("a", "ok", "custom")]);
    expect(rep.groups[0].id).toBe("custom");
  });
});

describe("فحوصات الأدوار (نقية)", () => {
  it("rolesWithoutPages / usersWithUnknownRole", () => {
    expect(rolesWithoutPages(["a", "b"], (r) => (r === "a" ? 3 : 0))).toEqual(["b"]);
    expect(usersWithUnknownRole([{ username: "u1", role: "chairman" }, { username: "u2", role: "admin" }], USER_ROLES)).toEqual([{ username: "u2", role: "admin" }]);
  });

  it("الحقيقي: كل دور في النظام عنده صفحة واحدة على الأقل في القايمة (وإلا هيدخل على نظام فاضي)", () => {
    const empty = rolesWithoutPages(USER_ROLES, (r) => getNavForRole(r as (typeof USER_ROLES)[number]).flatMap((d) => d.subFunctions.flatMap((s) => s.pages)).length);
    expect(empty).toEqual([]);
  });
});

describe("normalizePath: الأخطاء المتشابهة بتتجمّع", () => {
  it("بيشيل الأرقام والـquery", () => {
    expect(normalizePath("/api/v1/sales/123?x=1")).toBe("/api/v1/sales/:id");
    expect(normalizePath("/api/v1/sales/123/items/9")).toBe("/api/v1/sales/:id/items/:id");
    expect(normalizePath("/api/v1/health")).toBe("/api/v1/health");
  });
});

describe("الصفحة ↔ الحراسة", () => {
  const nav = (role: string) => getNavForRole(role as (typeof USER_ROLES)[number]).flatMap((d) => d.subFunctions.flatMap((s) => s.pages.map((p) => p.href)));

  it("صفحة صحة النظام ظاهرة بس للأدوار المسموحة في ACCESS.systemHealthRead (والعكس)", () => {
    const seen = USER_ROLES.filter((r) => nav(r).includes("/v2/staff/system-health"));
    const allowed = USER_ROLES.filter((r) => (ACCESS.systemHealthRead as readonly string[]).includes(r));
    expect(seen.sort()).toEqual(allowed.sort());
  });

  it("الصفحة القديمة اتشالت ومفيش حاجة في القايمة بتشاور عليها", () => {
    for (const r of USER_ROLES) expect(nav(r)).not.toContain("admin-health.html");
  });

  it("الراوت بيقرا من السجل وفيه حارس الواجهة بنفس الأدوار", () => {
    const root = process.cwd();
    expect(readFileSync(resolve(root, "src/routes/health.ts"), "utf8")).toContain("ACCESS.systemHealthRead");
    const web = readFileSync(resolve(root, "web/src/staff/SystemHealth.tsx"), "utf8");
    const roles = web.match(/HEALTH_ROLES = \[([^\]]*)\]/)?.[1].match(/"([a-z_]+)"/g)?.map((s) => s.replace(/"/g, "")) ?? [];
    expect(roles.sort()).toEqual([...ACCESS.systemHealthRead].sort());
  });
});

describe("حراسة الـSQL: الجداول والأعمدة في الفحوصات موجودة فعلًا", () => {
  const root = process.cwd();
  const src = readFileSync(resolve(root, "src/lib/systemHealth.ts"), "utf8");
  const schema = [
    ...readdirSync(resolve(root, "src/db/schema")).filter((f) => f.endsWith(".ts")).map((f) => readFileSync(resolve(root, "src/db/schema", f), "utf8")),
    ...readdirSync(resolve(root, "migrations")).map((f) => readFileSync(resolve(root, "migrations", f), "utf8")),
  ].join("\n");

  it("كل جدول بعد FROM/JOIN معرّف في الـschema أو الهجرات", () => {
    const tables = new Set([...src.matchAll(/\b(?:FROM|JOIN)\s+"?([a-z_]+)"?/g)].map((m) => m[1]));
    tables.delete("generate_series");
    const missing = [...tables].filter((t) => !new RegExp(`pgTable\\(\\s*"${t}"|CREATE TABLE(?: IF NOT EXISTS)?\\s+"?${t}"?`).test(schema));
    expect(missing).toEqual([]);
  });

  it("الأعمدة المستخدمة في الفحوصات موجودة بالاسم في الـschema أو الهجرات", () => {
    const cols = [
      "locked_until", "totp_enabled", "created_by_id", "order_number", "order_id", "assigned_sales_user_id", "archived_at", "company_name",
      "awaiting_staff_since", "reserved_qty", "created_at", "company_name", "is_active", "role", "status", "channel", "username",
    ];
    const missing = cols.filter((c) => !schema.includes(`"${c}"`));
    expect(missing).toEqual([]);
  });

  it("كل فحص له مجموعة معرّفة، ومعرّفاتها فريدة", () => {
    const ids = [...src.matchAll(/\n    id: "([a-z_0-9]+)",\n    group: "([a-z]+)"/g)];
    expect(ids.length).toBeGreaterThanOrEqual(18);
    expect(new Set(ids.map((m) => m[1])).size).toBe(ids.length);
    for (const m of ids) expect(Object.keys(GROUP_TITLES)).toContain(m[2]);
  });

  it("الرسائل بدون مصطلحات تقنية إنجليزية (كلمات الجمهور العادي)", () => {
    const messages = [...src.matchAll(/(?:message|title|action):\s*[`"]([^`"]+)[`"]/g)].map((m) => m[1]);
    const banned = /\b(SQL|query|null|undefined|exception|stack|schema|migration|500|HTTP|API)\b/i;
    // «migrate» و«Neon» و«Vercel» و«ERR-» أسماء أدوات/مراجع مسموحة لأن الإدارة بتحتاجها حرفيًا
    expect(messages.filter((m) => banned.test(m))).toEqual([]);
  });
});
