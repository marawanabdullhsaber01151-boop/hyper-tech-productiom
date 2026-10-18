/** @format */

import { describe, expect, it } from "vitest";
import {
  FINISHED_ORDER_STATUSES,
  archiveNeedsOpenOrdersConfirmation,
  canPlainReactivate,
  derivePortalCompanyStatus,
  parseArchiveReason,
  restoredCompanyFields,
} from "./companyArchive";

const at = new Date("2026-10-17T10:00:00Z");

describe("derivePortalCompanyStatus", () => {
  it("المؤرشفة تغلب أي حالة تانية (حتى لو is_active=true بالغلط)", () => {
    expect(derivePortalCompanyStatus({ isActive: false, activatedAt: at, archivedAt: at })).toBe("archived");
    expect(derivePortalCompanyStatus({ isActive: true, activatedAt: at, archivedAt: at })).toBe("archived");
  });
  it("موقوفة، نشطة، لسه ما اتفعّلتش", () => {
    expect(derivePortalCompanyStatus({ isActive: false, activatedAt: at, archivedAt: null })).toBe("suspended");
    expect(derivePortalCompanyStatus({ isActive: true, activatedAt: at, archivedAt: null })).toBe("active");
    expect(derivePortalCompanyStatus({ isActive: true, activatedAt: null, archivedAt: null })).toBe("not_activated");
  });
});

describe("parseArchiveReason", () => {
  it("بيطلب سبب مفهوم وبينضّف المسافات", () => {
    expect(parseArchiveReason("  الشركة   قررت  إنهاء التعامل ")).toEqual({ ok: true, reason: "الشركة قررت إنهاء التعامل" });
  });
  it("بيرفض الفاضي والقصير والطويل جدًا والمش نص", () => {
    for (const bad of ["", "  ", "ab", undefined, null, 5]) expect(parseArchiveReason(bad).ok).toBe(false);
    expect(parseArchiveReason("س".repeat(501)).ok).toBe(false);
    expect(parseArchiveReason("س".repeat(500)).ok).toBe(true);
  });
});

describe("قواعد الأرشفة والاسترجاع", () => {
  it("الطلبات الشغّالة تحتاج تأكيد صريح", () => {
    expect(archiveNeedsOpenOrdersConfirmation(0, false)).toBe(false);
    expect(archiveNeedsOpenOrdersConfirmation(3, false)).toBe(true);
    expect(archiveNeedsOpenOrdersConfirmation(3, true)).toBe(false);
  });
  it("الاسترجاع يفعّل ويجبر تغيير كلمة السر", () => {
    expect(restoredCompanyFields()).toEqual({ isActive: true, mustChangePassword: true });
  });
  it("إعادة التفعيل العادي ممنوعة على المؤرشفة", () => {
    expect(canPlainReactivate(null)).toBe(true);
    expect(canPlainReactivate(at)).toBe(false);
  });
  it("قايمة الحالات المنتهية بتغطي القايمتين القديمتين", () => {
    for (const s of ["cancelled", "completed", "closed", "shipped", "delivered", "delivered_customer", "delivered_warehouse"]) {
      expect((FINISHED_ORDER_STATUSES as readonly string[]).includes(s)).toBe(true);
    }
    expect((FINISHED_ORDER_STATUSES as readonly string[]).includes("awaiting_operations_claim")).toBe(false);
  });
});
