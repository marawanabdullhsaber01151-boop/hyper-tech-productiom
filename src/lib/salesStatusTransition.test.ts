import { describe, expect, it } from "vitest";
import {
  computeStockAndBalanceEffects,
  getSalesOrderStockState,
  hasOutstandingSalesBalance,
  SALES_ORDER_STATUSES,
  type SalesOrderStatus,
} from "./salesStatusTransition";

const expected: Record<SalesOrderStatus, Record<SalesOrderStatus, string[] | false>> = {
  draft: {
    draft: [],
    pending_approval: [],
    confirmed: ["reserve", "increaseBalance"],
    shipped: ["reserve", "increaseBalance", "releaseReservation", "deductStock"],
    paid: ["reserve", "increaseBalance", "releaseReservation", "deductStock", "decreaseBalance"],
    cancelled: [],
  },
  pending_approval: {
    draft: false,
    pending_approval: [],
    confirmed: false,
    shipped: false,
    paid: false,
    cancelled: false,
  },
  confirmed: {
    draft: false,
    pending_approval: false,
    confirmed: [],
    shipped: ["releaseReservation", "deductStock"],
    paid: ["releaseReservation", "deductStock", "decreaseBalance"],
    cancelled: ["releaseReservation", "decreaseBalance"],
  },
  shipped: {
    draft: false,
    pending_approval: false,
    confirmed: false,
    shipped: [],
    paid: ["decreaseBalance"],
    cancelled: ["restoreStock", "decreaseBalance"],
  },
  paid: {
    draft: false,
    pending_approval: false,
    confirmed: false,
    shipped: false,
    paid: [],
    cancelled: ["restoreStock"],
  },
  cancelled: {
    draft: false,
    pending_approval: false,
    confirmed: false,
    shipped: false,
    paid: false,
    cancelled: [],
  },
};

describe("sales status transition matrix", () => {
  it.each(SALES_ORDER_STATUSES.flatMap((fromStatus) =>
    SALES_ORDER_STATUSES.map((toStatus) => [fromStatus, toStatus] as const),
  ))("covers %s -> %s", (fromStatus, toStatus) => {
    const plan = computeStockAndBalanceEffects(fromStatus, toStatus);
    const expectedEffects = expected[fromStatus][toStatus];
    expect(plan.allowed).toBe(expectedEffects !== false);
    expect(plan.effects).toEqual(expectedEffects === false ? [] : expectedEffects);
  });

  it("exposes the same stock state used by item add/delete operations", () => {
    expect(getSalesOrderStockState("draft")).toBe("none");
    expect(getSalesOrderStockState("pending_approval")).toBe("none");
    expect(getSalesOrderStockState("confirmed")).toBe("reserved");
    expect(getSalesOrderStockState("shipped")).toBe("deducted");
    expect(getSalesOrderStockState("paid")).toBe("deducted");
    expect(getSalesOrderStockState("cancelled")).toBe("none");
  });

  it("keeps customer-balance semantics centralized", () => {
    expect(hasOutstandingSalesBalance("confirmed")).toBe(true);
    expect(hasOutstandingSalesBalance("shipped")).toBe(true);
    expect(hasOutstandingSalesBalance("draft")).toBe(false);
    expect(hasOutstandingSalesBalance("paid")).toBe(false);
    expect(hasOutstandingSalesBalance("cancelled")).toBe(false);
  });
});