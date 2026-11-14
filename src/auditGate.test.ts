import { describe, expect, it } from "vitest";
import { evaluateAudit, gateFails } from "./lib/auditGateCore";

const adv = (severity: string, ghsa: string) => ({ severity, title: "t", url: `https://github.com/advisories/${ghsa}` });
const audit = {
  vulnerabilities: {
    zod: { via: [adv("high", "GHSA-mrhx-c7xc-m3w5")] },
    "proxy-addr": { via: [adv("critical", "GHSA-jqcg-44mw-7w3h")] },
    qs: { via: [adv("moderate", "GHSA-6pq8-jhm2-2vcw")] },
    express: { via: ["proxy-addr", "qs"] },
  },
};
const allow = [{ id: "GHSA-mrhx-c7xc-m3w5", package: "zod", reason: "x", expires: "2027-02-28" }];

describe("بوابة npm audit", () => {
  it("بتمنع الحرج/العالي غير المسموح، وبتسمح بالمسموح، وبتتجاهل المتوسط والموروث", () => {
    const r = evaluateAudit(audit, allow, "2026-11-14");
    expect(r.blocked.map((f) => f.pkg)).toEqual(["proxy-addr"]);
    expect(r.allowed.map((f) => f.pkg)).toEqual(["zod"]);
    expect(gateFails(r)).toBe(true);
  });
  it("لو اتصلّحت كلها ما بتفشلش، والسماح المنتهي بيفشل", () => {
    const onlyZod = { vulnerabilities: { zod: audit.vulnerabilities.zod } };
    expect(gateFails(evaluateAudit(onlyZod, allow, "2026-11-14"))).toBe(false);
    expect(gateFails(evaluateAudit(onlyZod, allow, "2027-03-01"))).toBe(true);
  });
  it("مدخل فاضي أو غريب = نظيف", () => {
    expect(gateFails(evaluateAudit({}, [], "2026-11-14"))).toBe(false);
    expect(gateFails(evaluateAudit(null, [], "2026-11-14"))).toBe(false);
  });
});
