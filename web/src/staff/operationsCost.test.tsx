import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../design/components";
import { Operations } from "./Operations";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const OVERVIEW = {
  generatedAt: "2026-10-25T10:00:00Z",
  kpis: { activeCases: 0, atRisk: 0, slaBreached: 0, waitingSales: 0, unassigned: 0, readyToConvert: 0, awaitingClaim: 0, requisitionsPending: 0, transfersPending: 0, exceptionsOpen: 0, overdueOrders: 0 },
  byStatus: {}, pipeline: {}, atRisk: [], claimQueue: [], team: [],
};
const WORKSPACE = {
  case: { id: 5, caseNumber: "OPS-5", salesOrderId: 11, status: "converted", priority: "normal", dueDate: null, assignedTo: null, customerDisplayName: "شركة النور", workflowOrderId: 9, version: 4 },
  lines: [], revisions: [], salesOrder: null,
  linkedOrders: [{ id: 9, orderNumber: "PO-9", workflowStatus: "in_production", productName: "بطارية", qty: "10", unit: "قطعة", neededBy: null, claimedByName: null, bomRecipeId: 1, splitSequence: null }],
  requisitions: [], risk: { level: "low", reasons: [], sla: null }, nextAction: "track_orders",
};
let calls: Array<{ key: string; body: unknown }> = [];
function stub() {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input).split("?")[0]!.replace("/api/v1", "")}`;
    calls.push({ key, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (key === "GET /operations-center/overview") return json(OVERVIEW);
    if (key === "GET /operations-center/cases/5/workspace") return json(WORKSPACE);
    if (key === "GET /operations/orders/9/cost") return json({ orderId: 9, total: 1250, byType: { material: 1000, labor: 250 }, entries: [] });
    if (key === "GET /operations/orders/9/batches") return json([{ id: 1, batchNumber: "B-1", plannedQty: "10", producedQty: "4", acceptedQty: "4", stage: "manufacturing", status: "open" }]);
    return json({ data: {} });
  }));
}
beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem("hyper_erp_session", JSON.stringify({ token: "t", user: { id: 1, username: "u", fullName: "مستخدم", role: "operations_manager" } }));
  history.replaceState(null, "", "/v2/staff/operations?case=5");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("مركز التشغيل: تكلفة الأمر ودفعاته (م3ب)", () => {
  it("بيعرض الإجمالي والدفعات وبيسجّل تكلفة يدوية", async () => {
    stub();
    render(<ToastProvider><Operations /></ToastProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "التكلفة والدفعات" }));
    expect(await screen.findByText("B-1")).toBeTruthy();
    expect(screen.getByText(/إجمالي التكلفة/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "سجّل تكلفة" }));
    const input = (await screen.findAllByRole("textbox")).find((el) => (el as HTMLInputElement).inputMode === "decimal")!;
    fireEvent.input(input, { target: { value: "300" } });
    fireEvent.click(screen.getByRole("button", { name: "سجّل" }));
    await waitFor(() => {
      const c = calls.find((x) => x.key === "POST /operations/cost-entries");
      expect(c?.body).toMatchObject({ workflowOrderId: 9, costType: "labor", amount: "300" });
    });
  });
});
