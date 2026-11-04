import { describe, expect, it } from "vitest";
import { approveBlock, canOpenInbox, decidePayload, decisionError, slaTone, sortInbox, summarize, waitParts, type InboxRow } from "./approvalsCore";

const row = (id: number, sla: InboxRow["sla"], waitedMinutes: number, extra: Partial<InboxRow> = {}): InboxRow => ({
  id, actionKey: "sales.approve", resourceType: "sales_order", resourceId: id, title: `t${id}`, amount: 1, status: "pending", requesterName: "أحمد", requesterRoleLabel: "مدير المبيعات",
  createdAt: "2026-11-04T08:00:00Z", waitedMinutes, sla, stepRoleLabels: [], mine: false, verdict: { canApprove: true, canReject: true, block: null, selfException: false },
  impact: { approve: [], reject: [] }, decisionNote: null, decidedAt: null, ...extra,
});

describe("صندوق الاعتمادات", () => {
  it("الأدوار", () => {
    expect(canOpenInbox("sales_manager")).toBe(true);
    expect(canOpenInbox("storekeeper")).toBe(false);
    expect(canOpenInbox(undefined)).toBe(false);
  });
  it("الترتيب: المتأخر ثم الأطول انتظارًا", () => {
    const r = sortInbox([row(1, "ok", 300), row(2, "overdue", 250), row(3, "overdue", 400), row(4, "due_soon", 200)]);
    expect(r.map((x) => x.id)).toEqual([3, 2, 4, 1]);
  });
  it("الملخص", () => {
    expect(summarize([row(1, "overdue", 1), row(2, "due_soon", 1, { mine: true }), row(3, "ok", 1)])).toEqual({ total: 3, overdue: 1, dueSoon: 1, mine: 1 });
  });
  it("الرفض لازم سبب والاعتماد لأ", () => {
    expect(decisionError("reject", " ")).toBe("note");
    expect(decisionError("reject", "سعر غلط")).toBeNull();
    expect(decisionError("approve", "")).toBeNull();
    expect(decidePayload("approve", "  ")).toEqual({ decision: "approve" });
    expect(decidePayload("reject", " سعر غلط ")).toEqual({ decision: "reject", note: "سعر غلط" });
  });
  it("سبب قفل الاعتماد وألوان المهلة وعرض الانتظار", () => {
    expect(approveBlock(row(1, "ok", 1, { verdict: { canApprove: false, canReject: true, block: "self", selfException: false } }))).toBe("self");
    expect(approveBlock(row(1, "ok", 1))).toBeNull();
    expect(slaTone("overdue")).toBe("danger");
    expect(slaTone("due_soon")).toBe("warn");
    expect(slaTone("ok")).toBe("success");
    expect(waitParts(135)).toEqual({ h: 2, m: 15 });
  });
});
