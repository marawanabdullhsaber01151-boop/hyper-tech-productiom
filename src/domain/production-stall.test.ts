/** @format */
import { describe, expect, it } from "vitest";
import { CANONICAL_PRODUCTION_STATUSES } from "./production-lifecycle";
import { STALL_HOURS, STALL_OWNER, STALL_STATUSES, stallDedupeKey, stallInfo, stallPriority } from "./production-stall";

const at = (iso: string) => new Date(iso);

describe("production-stall", () => {
  it("كل حالة ليها حد ومسؤول، والحالات كلها معروفة، والمنتهية مالهاش حد", () => {
    for (const s of STALL_STATUSES) {
      expect((CANONICAL_PRODUCTION_STATUSES as readonly string[]).includes(s)).toBe(true);
      expect(STALL_OWNER[s]?.role.length).toBeGreaterThan(0);
      expect(STALL_HOURS[s]).toBeGreaterThan(0);
    }
    for (const s of ["completed", "cancelled", "closed", "delivered_customer", "delivered_warehouse", "corrected", "new"]) expect(STALL_HOURS[s]).toBeUndefined();
  });

  it("الأمر واقف لما السكون يوصل الحد بالظبط", () => {
    const last = at("2026-11-01T00:00:00Z");
    expect(stallInfo("in_production", last, at("2026-11-01T23:59:00Z")).stalled).toBe(false);
    const hit = stallInfo("in_production", last, at("2026-11-02T00:00:00Z"));
    expect(hit.stalled).toBe(true);
    expect(hit.idleHours).toBe(24);
    expect(hit.ratio).toBe(1);
  });

  it("حالة منتهية أو مجهولة مش واقفة أبدًا", () => {
    expect(stallInfo("completed", at("2020-01-01T00:00:00Z"), at("2026-01-01T00:00:00Z")).stalled).toBe(false);
    expect(stallInfo("nope", at("2020-01-01T00:00:00Z"), at("2026-01-01T00:00:00Z")).stalled).toBe(false);
  });

  it("ساعة المستقبل (فرق ساعات الأجهزة) مش بتسبب سكون سالب", () => {
    expect(stallInfo("in_production", at("2026-11-02T10:00:00Z"), at("2026-11-02T09:00:00Z")).idleHours).toBe(0);
  });

  it("الأولوية: ضعف الحد أو أكتر عالية", () => {
    const last = at("2026-11-01T00:00:00Z");
    expect(stallPriority(stallInfo("in_production", last, at("2026-11-02T06:00:00Z")))).toBe("normal");
    expect(stallPriority(stallInfo("in_production", last, at("2026-11-03T00:00:00Z")))).toBe("high");
  });

  it("مفتاح منع التكرار بيتغير مع آخر نشاط والحالة", () => {
    const a = stallDedupeKey(7, "in_production", at("2026-11-01T05:30:00Z"));
    expect(a).toBe("stalled:7:in_production:2026-11-01T05");
    expect(stallDedupeKey(7, "in_production", at("2026-11-01T05:59:00Z"))).toBe(a);
    expect(stallDedupeKey(7, "in_production", at("2026-11-02T05:30:00Z"))).not.toBe(a);
    expect(stallDedupeKey(7, "quality_check", at("2026-11-01T05:30:00Z"))).not.toBe(a);
  });
});
