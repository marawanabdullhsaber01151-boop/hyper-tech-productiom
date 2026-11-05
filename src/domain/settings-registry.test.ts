import { describe, expect, it } from "vitest";
import { slaState, workingMinutesBetween } from "./approvals-inbox";
import { stallInfo } from "./production-stall";
import { DEFAULT_OPERATIONAL, SETTING_DEFS, checkValue, defOf, isKnownKey, operationalConfig, planChanges, resolveSettings } from "./settings-registry";

const def = (k: string) => defOf(k)!;

describe("سجل الإعدادات", () => {
  it("كل إعداد افتراضيه صالح، والمفاتيح مش مكررة", () => {
    for (const d of SETTING_DEFS) {
      const c = checkValue(d, d.default);
      if (d.key === "company_name") expect(c.ok).toBe(false);
      else expect(c.ok).toBe(true);
    }
    expect(new Set(SETTING_DEFS.map((d) => d.key)).size).toBe(SETTING_DEFS.length);
  });
  it("الأرقام: حدود ونوع", () => {
    expect(checkValue(def("work.start_hour"), "8")).toEqual({ ok: true, value: "8" });
    expect(checkValue(def("work.start_hour"), 8)).toEqual({ ok: true, value: "8" });
    expect(checkValue(def("work.start_hour"), "24")).toEqual({ ok: false, error: "range" });
    expect(checkValue(def("work.start_hour"), "-1")).toEqual({ ok: false, error: "type" });
    expect(checkValue(def("work.start_hour"), "8.5")).toEqual({ ok: false, error: "type" });
    expect(checkValue(def("approval.sla_hours"), "0")).toEqual({ ok: false, error: "range" });
    expect(checkValue(def("work.start_hour"), null)).toEqual({ ok: false, error: "type" });
  });
  it("الاختيارات والنصوص والإيميل", () => {
    expect(checkValue(def("currency"), "USD").ok).toBe(true);
    expect(checkValue(def("currency"), "XXX")).toEqual({ ok: false, error: "option" });
    expect(checkValue(def("fiscal_year_start"), "04")).toEqual({ ok: true, value: "04-01" });
    expect(checkValue(def("company_email"), "abc")).toEqual({ ok: false, error: "email" });
    expect(checkValue(def("company_email"), "")).toEqual({ ok: true, value: "" });
    expect(checkValue(def("company_email"), "a@b.co")).toEqual({ ok: true, value: "a@b.co" });
    expect(checkValue(def("company_name"), "  هايبر  ")).toEqual({ ok: true, value: "هايبر" });
    expect(checkValue(def("company_name"), "x".repeat(121))).toEqual({ ok: false, error: "length" });
  });
  it("القيمة التالفة المخزّنة بترجع للافتراضي", () => {
    const v = resolveSettings({ "work.start_hour": "abc", "work.end_hour": "18" });
    expect(v["work.start_hour"]).toBe("9");
    expect(v["work.end_hour"]).toBe("18");
  });
  it("المفاتيح المعروفة (الجديدة والقديمة المتوافقة)", () => {
    expect(isKnownKey("work.off_day")).toBe(true);
    expect(isKnownKey("vat_rate")).toBe(true);
    expect(isKnownKey("hacker")).toBe(false);
  });
});

describe("حساب التغييرات", () => {
  it("بيرجّع المتغيّر فعلًا بس", () => {
    const p = planChanges({ "work.start_hour": "9" }, { "work.start_hour": "9", "work.end_hour": "18" });
    expect(p.issues).toEqual([]);
    expect(p.changes).toEqual([{ key: "work.end_hour", before: "17", after: "18" }]);
  });
  it("مفتاح مجهول وقيمة غلط ونهاية قبل البداية", () => {
    expect(planChanges({}, { nope: "1" }).issues).toEqual([{ key: "nope", error: "unknown" }]);
    expect(planChanges({}, { "work.start_hour": "30" }).issues[0].error).toBe("range");
    const h = planChanges({}, { "work.start_hour": "18" });
    expect(h.issues).toEqual([{ key: "work.end_hour", error: "hours" }]);
    expect(planChanges({}, { "work.start_hour": "8", "work.end_hour": "20" }).issues).toEqual([]);
  });
});

describe("إعدادات التشغيل بتأثر على الحسابات", () => {
  it("الافتراضي = السلوك القديم", () => {
    expect(DEFAULT_OPERATIONAL).toEqual({ work: { startHour: 9, endHour: 17, offDay: 5 }, slaMinutes: 240, stallFactor: 1 });
  });
  // الأحد 2026-11-08 بتوقيت القاهرة (UTC+2): 9ص = 07:00Z
  const from = new Date("2026-11-08T07:00:00Z"), to = new Date("2026-11-08T10:00:00Z");
  it("ساعات العمل", () => {
    expect(workingMinutesBetween(from, to)).toBe(180);
    expect(workingMinutesBetween(from, to, { startHour: 10, endHour: 17, offDay: 5 })).toBe(120);
    expect(workingMinutesBetween(from, to, { startHour: 9, endHour: 17, offDay: 0 })).toBe(0);
    expect(workingMinutesBetween(from, to, { startHour: 9, endHour: 11, offDay: 5 })).toBe(120);
  });
  it("مهلة الاعتماد", () => {
    expect(slaState(200)).toBe("due_soon");
    expect(slaState(200, 480)).toBe("ok");
    expect(slaState(200, 120)).toBe("overdue");
    expect(operationalConfig({ "approval.sla_hours": "2" }).slaMinutes).toBe(120);
  });
  it("حساسية الوقوف", () => {
    const now = new Date("2026-11-08T12:00:00Z"), last = new Date(now.getTime() - 30 * 3_600_000);
    expect(stallInfo("in_production", last, now).stalled).toBe(true);
    expect(stallInfo("in_production", last, now, 2).stalled).toBe(false);
    expect(stallInfo("in_production", last, now, 2).thresholdHours).toBe(48);
    expect(stallInfo("in_production", last, now, 0.5).thresholdHours).toBe(12);
    expect(operationalConfig({ "stall.percent": "200" }).stallFactor).toBe(2);
  });
});
