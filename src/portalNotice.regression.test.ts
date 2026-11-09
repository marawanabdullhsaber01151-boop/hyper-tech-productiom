/** @format */
// إشعارات الطلبات على القنوات الخارجية (42د). بنقرا الملفات كنص عشان الاختبار ميحتاجش قاعدة بيانات.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(resolve(__dirname, "..", f), "utf8");

describe("إشعارات الطلبات على القنوات الخارجية", () => {
  const n = read("src/lib/portalNotifications.ts");
  it("الإشعار الداخلي بيتكتب الأول، والخارجي بعده وبيتفلتر بالنوع", () => {
    expect(n.indexOf("values({ ...base, memberId: null })")).toBeLessThan(n.indexOf("await queueExternalNotices("));
    expect(n).toContain("if (!isExternalNotice(payload.type)) return;");
  });
  it("بيتكتب في صندوق الصادر بمفتاح منع تكرار، وأي خطأ بيتسجّل ومش بيكسّر الإشعار", () => {
    expect(n).toContain('type: "portal.notice"');
    expect(n).toContain('dedupeKey("notice", userId');
    expect(n).toMatch(/catch \(e\) \{\s*logger\.warn/);
  });
  it("المعالج مسجّل وبيستخدم قايمة القنوات الخاصة بالإشعارات", () => {
    const h = read("src/lib/outboxHandlers.ts");
    expect(h).toContain('"portal.notice": portalNotice');
    expect(h).toContain('purpose: "notice"');
    expect(h).toContain('only: ["email", "telegram"]');
    const d = read("src/lib/channels/deliver.ts");
    expect(d).toContain('"delivery.notice.channels"');
    expect(d).toContain("{ companyId: input.companyId ?? null }");
  });
  it("الإعداد متاح لكل شركة، والافتراضي إيميل وتيليجرام، والموظف بس هو اللي يغيّره", () => {
    const s = read("src/lib/portalSettings.ts");
    const line = s.split("\n").find((l) => l.includes('key: "delivery.notice.channels"')) ?? "";
    expect(line).toContain('scopes: ["global", "company"]');
    expect(line).toContain('default: ["email", "telegram"]');
    expect(line).toContain('editableBy: ["staff"]');
  });
  it("القالب بيستخدم عنوان الإشعار كموضوع للإيميل", () => {
    const t = read("src/lib/channels/templates.ts");
    expect(t).toContain("order_notice");
    expect(t).toMatch(/order_notice: \{\s*subject: "\{title\}"/);
  });
});
