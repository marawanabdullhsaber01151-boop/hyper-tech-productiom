import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../design/components";
import { Operations } from "./Operations";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const OVERVIEW = {
  generatedAt: "2026-10-25T10:00:00Z",
  kpis: { activeCases: 0, atRisk: 0, slaBreached: 0, waitingSales: 0, unassigned: 0, readyToConvert: 0, awaitingClaim: 0, requisitionsPending: 2, transfersPending: 1, exceptionsOpen: 0, overdueOrders: 0 },
  byStatus: {},
  pipeline: {},
  atRisk: [],
  claimQueue: [],
  team: [],
};
const TRANSFER = { id: 7, workflowOrderId: 3, orderNumber: "PO-3", productName: "بطارية", direction: "warehouse_to_operations", itemName: "رصاص", quantity: "25.000", status: "pending", notes: null, preparedAt: "2026-10-25T08:00:00Z", receivedAt: null };
const REQ = (id: number, name: string, status = "pending_operations", extra: Record<string, unknown> = {}) => ({ id, materialName: name, requiredQty: "10", availableQty: "2", shortageQty: "8", status, reason: "عجز", createdAt: "2026-10-25T08:00:00Z", ...extra });

let calls: Array<{ key: string; body: unknown }> = [];
function stub() {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const key = `${method} ${url.split("?")[0]!.replace("/api/v1", "")}`;
    calls.push({ key, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (key === "GET /operations-center/overview") return json(OVERVIEW);
    if (key === "GET /operations-control/transfers") return json([TRANSFER]);
    if (key === "GET /operations-control/purchase-requisitions") return json([REQ(1, "رصاص"), REQ(2, "حمض"), REQ(3, "بلاستيك", "ordered", { poId: 40, poNumber: "PO-40" })]);
    return json({ data: {} });
  }));
}
const login = (role: string) => sessionStorage.setItem("hyper_erp_session", JSON.stringify({ token: "t", user: { id: 1, username: "u", fullName: "مستخدم", role } }));
const mount = () => render(<ToastProvider><Operations /></ToastProvider>);
beforeEach(() => sessionStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("مركز التشغيل: التحويلات والاحتياجات (م2)", () => {
  it("التحويل المستني بيظهر وزر الاستلام بيتأكد وبعدها بيبعت PATCH", async () => {
    login("operations_manager");
    stub();
    history.replaceState(null, "", "/v2/staff/operations?tab=transfers");
    mount();
    expect((await screen.findAllByText("من المخزن للتشغيل")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "تحويل جديد" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "استلمت" }));
    expect((await screen.findAllByText(/الرصيد هيتخصم من المخزن عند الاستلام/)).length).toBeGreaterThan(0);
    const confirmBtns = screen.getAllByRole("button", { name: "استلمت" });
    fireEvent.click(confirmBtns[confirmBtns.length - 1]!);
    await waitFor(() => expect(calls.some((c) => c.key === "PATCH /operations-control/transfers/7/receive")).toBe(true));
  });

  it("مدير المخزن مايقدرش يستلم من المخزن للتشغيل (بيشوف حالة الانتظار بس)", async () => {
    login("warehouse_manager");
    stub();
    history.replaceState(null, "", "/v2/staff/operations?tab=transfers");
    mount();
    expect((await screen.findAllByText("من المخزن للتشغيل")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "استلمت" })).toBeNull();
    expect(screen.getAllByText("مستني الاستلام").length).toBeGreaterThan(0);
  });

  it("الاحتياجات: تأكيد الكل بطلب واحد، وأمر الشراء ظاهر لما يتحوّل", async () => {
    login("operations_manager");
    stub();
    history.replaceState(null, "", "/v2/staff/operations?tab=needs");
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "أكّد الكل (2)" }));
    await waitFor(() => {
      const c = calls.find((x) => x.key === "POST /operations-control/purchase-requisitions/confirm-bulk");
      expect(c?.body).toEqual({ ids: [1, 2] });
    });
  });
});
