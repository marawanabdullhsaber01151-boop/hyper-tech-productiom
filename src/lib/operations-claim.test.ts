import { describe, expect, it } from "vitest";

process.env.DATABASE_URL ??= "postgresql://phase04:phase04@localhost:5432/phase04";

const { claimOperationsLine } = await import("./operations-claim");

type FakeRow = {
  id: number;
  orderNumber: string;
  workflowStatus: string;
  claimedById: number | null;
  claimedByName: string | null;
  claimedAt: Date | null;
};

/**
 * This fake deliberately makes the compare-and-set operation synchronous.
 * Promise.all still schedules two independent simulated requests, while the
 * store models PostgreSQL's row-level atomic UPDATE predicate.
 */
function fakeTransaction(row: FakeRow, audits: unknown[]) {
  return {
    update: () => ({
      set: (values: Partial<FakeRow>) => ({
        where: () => ({
          returning: async () => {
            if (
              row.workflowStatus !== "awaiting_operations_claim" ||
              row.claimedById !== null
            ) {
              return [];
            }
            Object.assign(row, values);
            return [structuredClone(row)];
          },
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [structuredClone(row)],
        }),
      }),
    }),
    audits,
  };
}

describe("Operations Manager claim gate", () => {
  it("allows exactly one winner under concurrent portal-sales/operations attempts", async () => {
    const row: FakeRow = {
      id: 41,
      orderNumber: "PO-0041",
      workflowStatus: "awaiting_operations_claim",
      claimedById: null,
      claimedByName: null,
      claimedAt: null,
    };
    const audits: unknown[] = [];
    const tx = fakeTransaction(row, audits);

    const attempts = await Promise.allSettled([
      claimOperationsLine(
        tx,
        {
          orderId: 41,
          actorUserId: 10,
          actorName: "Portal Sales",
          actionKey: "production_workflow.claimed_by_portal_sales",
        },
        { auditWriter: async (event) => audits.push(event) },
      ),
      claimOperationsLine(
        tx,
        {
          orderId: 41,
          actorUserId: 20,
          actorName: "Operations Manager",
          actionKey: "production_workflow.claimed_by_operations_manager",
        },
        { auditWriter: async (event) => audits.push(event) },
      ),
    ]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    const loser = attempts.find((attempt) => attempt.status === "rejected");
    expect(loser?.status).toBe("rejected");
    if (loser?.status === "rejected") {
      expect(loser.reason.code).toBe("OPERATIONS_LINE_ALREADY_CLAIMED");
      expect(loser.reason.message).toContain("تم استلام سطر الإنتاج بالفعل بواسطة");
    }
    expect(row.workflowStatus).toBe("claimed");
    expect(row.claimedById).not.toBeNull();
    expect(row.claimedByName).not.toBeNull();
    expect(row.claimedAt).toBeInstanceOf(Date);
    expect(audits).toHaveLength(1);
  });
});