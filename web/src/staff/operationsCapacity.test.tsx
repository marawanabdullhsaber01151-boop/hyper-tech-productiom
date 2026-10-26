import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../design/components";
import { Operations } from "./Operations";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const OVERVIEW = {
  generatedAt: "2026-10-25T10:00:00Z",
  kpis: { activeCases: 1, atRisk: 0, slaBreached: 0, waitingSales: 0, unassigned: 0, readyToConvert: 1, awaitingClaim: 0, requisitionsPending: 0, transfersPending: 0, exceptionsOpen: 0, overdueOrders: 0 },
  byStatus: {}, pipeline: {}, atRisk: [], claimQueue: [], team: [],
};
const CAP = {
  generatedAt: "2026-10-25T10:00:00Z", cap: 0.85, lines: 2, linesAssumed: true, openOrders: 4, noRecipeOrders: 1,
  days: [{ date: "2026-10-26", used: 1.7, capacity: 1.7, load: 1 }, { date: "2026-10-27", used: 0.5, capacity: 1.7, load: 0.294 }],
  queueDays: 6.5, utilization: 0.62, overloadedDays: 1, freeDays: 4, lateOrders: 1,
};
const WORKSPACE = {
  case: { id: 5, caseNumber: "OPS-5", salesOrderId: 11, status: "analysis_ready", priority: "normal", dueDate: "2026-11-05", assignedTo: null, customerDisplayName: "شركة النور", workflowOrderId: null, version: 4 },
  lines: [], revisions: [], salesOrder: null, linkedOrders: [], requisitions: [], risk: { level: "low", reasons: [], sla: null }, nextAction: "convert",
};
function stub() {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input).split("?")[0]!.replace("/api/v1", "")}`;
    if (key === "GET /operations-center/overview") return json(OVERVIEW);
    if (key === "GET /operations-center/capacity") return json(CAP);
    if (key === "GET /operations-center/cases/5/workspace") return json(WORKSPACE);
    if (key === "GET /operations-center/cases/5/promise") return json({ earliest: "2026-11-01", likely: "2026-11-03", latest: "2026-11-08", verdict: "tight", dueDate: "2026-11-05", queueDays: 6.5, linesAssumed: false, assumedDurationLines: 1, neededDays: 5, lines: 2, utilization: 0.62 });
    return json({ data: {} });
  }));
}
beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem("hyper_erp_session", JSON.stringify({ token: "t", user: { id: 1, username: "u", fullName: "مستخدم", role: "operations_manager" } }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("مركز التشغيل: السعة ووعد التسليم (م4)", () => {
  it("تبويب السعة بيعرض التحميل والتحذيرات وأيام الـ14", async () => {
    stub();
    history.replaceState(null, "", "/v2/staff/operations?tab=capacity");
    render(<ToastProvider><Operations /></ToastProvider>);
    expect(await screen.findByText("62%")).toBeTruthy();
    expect(screen.getByText(/مفيش خطوط إنتاج مسجلة/)).toBeTruthy();
    expect(screen.getByText(/1 أمر إنتاج من غير وصفة/)).toBeTruthy();
    expect(screen.getAllByRole("img").length).toBeGreaterThanOrEqual(2);
  });
  it("وعد التسليم في الحالة: النطاق والحكم", async () => {
    stub();
    history.replaceState(null, "", "/v2/staff/operations?case=5");
    render(<ToastProvider><Operations /></ToastProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "احسب الوعد" }));
    expect(await screen.findByText("الموعد ضيّق")).toBeTruthy();
    expect(screen.getByText(/الأقرب .* \| الأرجح .* \| الأبعد/)).toBeTruthy();
  });
});
