import { describe, expect, it } from "vitest";
import {
  EMPTY_DELEGATION, EMPTY_OVERRIDE, EMPTY_POLICY, canEditGovernance, canManageDelegations, canRevoke, countActive, delegationError, delegationPayload, delegationState, overrideError, overridePayload, overrideState, policyError, policyPayload, simulateSummary, sortPolicies, togglePayload,
  type DelegationRow, type PolicyRow,
} from "./approvalsAdminCore";

const NOW = Date.parse("2026-11-05T10:00:00Z");
const d = (o: Partial<DelegationRow["delegation"]> = {}): DelegationRow["delegation"] => ({ id: 1, actionKey: "sales.approve", grantorUserId: 1, delegateUserId: 2, scopeType: "company", startsAt: "2026-11-01T00:00:00Z", endsAt: "2026-11-30T00:00:00Z", status: "active", revokedAt: null, reason: "إجازة", ...o });

describe("الأدوار", () => {
  it("النواب للرئيس والمدير التنفيذي، والباقي للرئيس فقط", () => {
    expect(canManageDelegations("chairman")).toBe(true);
    expect(canManageDelegations("executive_manager")).toBe(true);
    expect(canManageDelegations("sales_manager")).toBe(false);
    expect(canEditGovernance("chairman")).toBe(true);
    expect(canEditGovernance("executive_manager")).toBe(false);
  });
});

describe("حالة التفويض", () => {
  it("شغال / لسه / منتهي / ملغي", () => {
    expect(delegationState(d(), NOW)).toBe("active");
    expect(delegationState(d({ startsAt: "2026-12-01T00:00:00Z", endsAt: "2026-12-05T00:00:00Z" }), NOW)).toBe("upcoming");
    expect(delegationState(d({ endsAt: "2026-11-02T00:00:00Z" }), NOW)).toBe("expired");
    expect(delegationState(d({ revokedAt: "2026-11-03T00:00:00Z", status: "revoked" }), NOW)).toBe("revoked");
  });
  it("الإلغاء متاح للشغال واللي لسه، مش للمنتهي والملغي", () => {
    expect(canRevoke("active")).toBe(true);
    expect(canRevoke("upcoming")).toBe(true);
    expect(canRevoke("expired")).toBe(false);
    expect(canRevoke("revoked")).toBe(false);
  });
  it("عدّ الشغالين", () => {
    const rows = [d(), d({ id: 2, endsAt: "2026-11-02T00:00:00Z" })].map((delegation) => ({ delegation, grantorName: "أ", delegateName: "ب" }));
    expect(countActive(rows, NOW)).toBe(1);
  });
});

describe("نموذج التفويض", () => {
  const ok = { ...EMPTY_DELEGATION, grantorUserId: "1", delegateUserId: "2", actionKey: "sales.approve", startsAt: "2026-11-06T09:00", endsAt: "2026-11-10T09:00", reason: "إجازة سنوية" };
  it("بيرفض الناقص بترتيب واضح", () => {
    expect(delegationError(EMPTY_DELEGATION, NOW)).toBe("grantor");
    expect(delegationError({ ...ok, delegateUserId: "" }, NOW)).toBe("delegate");
    expect(delegationError({ ...ok, delegateUserId: "1" }, NOW)).toBe("same");
    expect(delegationError({ ...ok, actionKey: "" }, NOW)).toBe("action");
    expect(delegationError({ ...ok, startsAt: "" }, NOW)).toBe("dates");
    expect(delegationError({ ...ok, endsAt: "2026-11-05T09:00" }, NOW)).toBe("range");
    expect(delegationError({ ...ok, startsAt: "2026-10-01T09:00", endsAt: "2026-10-02T09:00" }, NOW)).toBe("past");
    expect(delegationError({ ...ok, reason: " ab " }, NOW)).toBe("reason");
    expect(delegationError(ok, NOW)).toBeNull();
  });
  it("الحمولة أرقام وتواريخ ISO", () => {
    const p = delegationPayload(ok);
    expect(p.grantorUserId).toBe(1);
    expect(p.delegateUserId).toBe(2);
    expect(/^\d{4}-\d{2}-\d{2}T.*Z$/.test(p.startsAt)).toBe(true);
    expect(p.reason).toBe("إجازة سنوية");
  });
});

describe("نموذج السياسة", () => {
  const ok = { ...EMPTY_POLICY, actionKey: "sales.approve", minAmount: "1000.50", approverRoles: ["sales_manager"], sequence: "2" };
  it("التحقق", () => {
    expect(policyError(EMPTY_POLICY)).toBe("action");
    expect(policyError({ ...ok, minAmount: "-5" })).toBe("amount");
    expect(policyError({ ...ok, minAmount: "10.123" })).toBe("amount");
    expect(policyError({ ...ok, approverRoles: [] })).toBe("roles");
    expect(policyError({ ...ok, sequence: "0" })).toBe("sequence");
    expect(policyError(ok)).toBeNull();
  });
  it("الحمولة والتفعيل والترتيب", () => {
    expect(policyPayload(ok)).toEqual({ actionKey: "sales.approve", minAmount: "1000.50", approverRoles: ["sales_manager"], sequence: 2 });
    const p: PolicyRow = { id: 1, actionKey: "a", minAmount: "0", approverRoles: [], sequence: 1, active: true };
    expect(togglePayload(p)).toEqual({ active: false });
    const rows = sortPolicies([{ ...p, id: 3, actionKey: "b" }, { ...p, id: 2, minAmount: "100" }, p]);
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3]);
  });
});

describe("استثناء الصلاحية والمحاكاة", () => {
  const ok = { ...EMPTY_OVERRIDE, userId: "5", actionKey: "sales.approve", reason: "تغطية مؤقتة" };
  it("التحقق والحمولة", () => {
    expect(overrideError(EMPTY_OVERRIDE, NOW)).toBe("user");
    expect(overrideError({ ...ok, actionKey: "" }, NOW)).toBe("action");
    expect(overrideError({ ...ok, expiresAt: "2020-01-01T00:00" }, NOW)).toBe("expiry");
    expect(overrideError({ ...ok, reason: "x" }, NOW)).toBe("reason");
    expect(overrideError(ok, NOW)).toBeNull();
    expect(overridePayload(ok)).toEqual({ userId: 5, actionKey: "sales.approve", allowed: true, reason: "تغطية مؤقتة" });
    expect(overridePayload({ ...ok, allowed: "false", expiresAt: "2026-12-01T10:00" }).allowed).toBe(false);
    expect("expiresAt" in overridePayload({ ...ok, expiresAt: "2026-12-01T10:00" })).toBe(true);
  });
  it("حالة الاستثناء", () => {
    const o = { id: 1, actionKey: "a", allowed: true, reason: null, expiresAt: null, revokedAt: null };
    expect(overrideState(o, NOW)).toBe("active");
    expect(overrideState({ ...o, expiresAt: "2026-11-01T00:00:00Z" }, NOW)).toBe("expired");
    expect(overrideState({ ...o, revokedAt: "2026-11-01T00:00:00Z" }, NOW)).toBe("revoked");
  });
  it("ملخص المحاكاة", () => {
    expect(simulateSummary([{ key: "a", label: "أ", allowed: true }, { key: "b", label: "ب", allowed: false }])).toEqual({ allowed: 1, total: 2 });
  });
});
