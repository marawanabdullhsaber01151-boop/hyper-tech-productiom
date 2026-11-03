/** @format */
import { describe, expect, it } from "vitest";
import { dropShadowedRows, isRawKey, isViewKey, pathRegex, sectionOf } from "./activity-feed";

const t = (s: number) => new Date(Date.UTC(2026, 10, 3, 10, 0, s));
const row = (id: number, actionKey: string, actorUserId: number | null, sec: number) => ({ id, actionKey, actorUserId, createdAt: t(sec) });

describe("سجل النشاط", () => {
  it("القسم من المفتاح التفصيلي ومن المسار الخام", () => {
    expect(sectionOf("production.stoppage.start")).toBe("production");
    expect(sectionOf("production_workflow.create")).toBe("production");
    expect(sectionOf("purchases.approved")).toBe("purchases");
    expect(sectionOf("post /api/v1/production-oee/stoppages")).toBe("production");
    expect(sectionOf("patch /bom/4")).toBe("engineering");
    expect(sectionOf("company.archived")).toBe("portal");
    expect(sectionOf("zzz.unknown")).toBe("other");
  });
  it("المسار الخام بيتعرّف، والتفصيلي لأ", () => {
    expect(isRawKey("post /api/v1/sales/3")).toBe(true);
    expect(isRawKey("sales.approve")).toBe(false);
  });
  it("الخام بيتخبي لو فيه تفصيلي لنفس الشخص والقسم في 5 ثواني، وإلا بيفضل", () => {
    const rows = [
      row(1, "post /api/v1/production-oee/stoppages", 7, 2),
      row(2, "production.stoppage.start", 7, 1),
      row(3, "post /api/v1/production-oee/stoppages", 8, 2), // شخص تاني
      row(4, "post /api/v1/sales/9", 7, 2), // قسم تاني
      row(5, "post /api/v1/production-oee/stoppages", 7, 30), // بعيد في الوقت
    ];
    expect(dropShadowedRows(rows).map((r) => r.id)).toEqual([2, 3, 4, 5]);
  });
  it("أحداث الفتح بتتعرّف", () => {
    expect(isViewKey("chat.view")).toBe(true);
    expect(isViewKey("operations.case.viewed")).toBe(true);
    expect(isViewKey("sales.edit")).toBe(false);
  });
  it("regex القسم بيطابق المسارات الصح بس", () => {
    const re = new RegExp(pathRegex("production")!.replace("(/api/v[0-9]+)?", "(/api/v[0-9]+)?"));
    expect(re.test("post /api/v1/production-oee/stoppages")).toBe(true);
    expect(re.test("post /production/1")).toBe(true);
    expect(re.test("post /api/v1/sales/1")).toBe(false);
    expect(pathRegex("nope")).toBeNull();
  });
});
