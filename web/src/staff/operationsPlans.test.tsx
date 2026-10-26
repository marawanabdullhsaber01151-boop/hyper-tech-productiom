import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../design/components";
import { Operations } from "./Operations";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const OVERVIEW = {
  generatedAt: "2026-10-25T10:00:00Z",
  kpis: { activeCases: 0, atRisk: 0, slaBreached: 0, waitingSales: 0, unassigned: 0, readyToConvert: 0, awaitingClaim: 0, requisitionsPending: 0, transfersPending: 0, exceptionsOpen: 0, overdueOrders: 0 },
  byStatus: {},
  pipeline: {},
  atRisk: [],
  claimQueue: [],
  team: [],
};
const ROW = { id: 4, planNumber: "PLN-000004", salesOrderId: 11, salesOrderNumber: "INV-11", status: "submitted", shortageValue: "30000.00", approvalLevel: 1, createdByName: "مهندس", submittedBy: 1, createdAt: "2026-10-25T08:00:00Z" };
const DETAIL = { ...ROW, notes: null, decisionNote: null, decidedByName: null, snapshot: { plan: [{ productName: "بطارية 12 فولت", requestedQty: "10", allocation: { fromStock: "2", toProduction: "8" }, purchaseShortages: [{ materialName: "رصاص", shortageQty: "5" }] }] } };

let calls: string[] = [];
function stub() {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input).split("?")[0]!.replace("/api/v1", "")}`;
    calls.push(key);
    if (key === "GET /operations-center/overview") return json(OVERVIEW);
    if (key === "GET /operations-center/plans") return json([ROW]);
    if (key === "GET /operations-center/plans/4") return json(DETAIL);
    return json({ data: {} });
  }));
}
const login = (role: string, id: number) => sessionStorage.setItem("hyper_erp_session", JSON.stringify({ token: "t", user: { id, username: "u", fullName: "مستخدم", role } }));
beforeEach(() => {
  sessionStorage.clear();
  history.replaceState(null, "", "/v2/staff/operations?tab=plans");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("مركز التشغيل: الخطط (م3)", () => {
  it("المدير التنفيذي يفتح خطة مستنية ويعتمدها", async () => {
    login("executive_manager", 2);
    stub();
    render(<ToastProvider><Operations /></ToastProvider>);
    fireEvent.click((await screen.findAllByText("PLN-000004"))[0]!);
    expect(await screen.findByText("بطارية 12 فولت")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "اعتمد" }));
    await waitFor(() => expect(calls).toContain("POST /operations-center/plans/4/approve"));
  });
  it("مدير التشغيل يشوف إن الخطة مستنية اعتماد من غير زر اعتماد", async () => {
    login("operations_manager", 3);
    stub();
    render(<ToastProvider><Operations /></ToastProvider>);
    fireEvent.click((await screen.findAllByText("PLN-000004"))[0]!);
    expect(await screen.findByText("بطارية 12 فولت")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "اعتمد" })).toBeNull();
    expect(screen.getByText(/مستنية اعتماد: مدير تنفيذي أو رئيس/)).toBeTruthy();
  });
});
