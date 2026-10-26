import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../design/components";
import { Operations } from "./Operations";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const KPIS = { activeCases: 3, atRisk: 1, slaBreached: 1, waitingSales: 0, unassigned: 2, readyToConvert: 1, awaitingClaim: 1, requisitionsPending: 0, transfersPending: 0, exceptionsOpen: 0, overdueOrders: 0 };
const OVERVIEW = {
  generatedAt: "2026-10-25T10:00:00Z",
  kpis: KPIS,
  byStatus: { received: 1, under_validation: 1, analysis_ready: 1 },
  pipeline: {},
  atRisk: [{ id: 5, caseNumber: "OPS-5", status: "received", priority: "urgent", dueDate: "2026-10-20", customerDisplayName: "شركة النور", level: "high", reasons: ["overdue", "sla_breached"], slaHours: 6, slaLimit: 4 }],
  claimQueue: [],
  team: [{ id: 9, name: "مهندس التشغيل", role: "operations_manager", activeCases: 2 }],
};
const caseRec = (over: Record<string, unknown> = {}) => ({ id: 5, caseNumber: "OPS-5", salesOrderId: 11, status: "analysis_ready", priority: "urgent", dueDate: "2026-10-20", assignedTo: null, customerDisplayName: "شركة النور", workflowOrderId: null, version: 4, ...over });
const WORKSPACE = (over: Record<string, unknown> = {}) => ({
  case: caseRec(over),
  lines: [{ id: 1, productNameSnapshot: "بطارية 12 فولت", orderedQty: "10.000", baseUnit: "قطعة", packagingQty: "0", packagingUnit: "كرتونة", lineStatus: "validated" }],
  revisions: [{ revision: 3, changeReason: "sales_clarification_requested: السعر ناقص", changedByName: "مهندس التشغيل", createdAt: "2026-10-25T09:00:00Z" }],
  salesOrder: { orderNumber: "INV-11", status: "confirmed", date: "2026-10-01", dueDate: null, notes: null, channel: "direct" },
  linkedOrders: [],
  requisitions: [],
  risk: { level: "high", reasons: ["overdue"], sla: null },
  nextAction: over.status === "received" ? "start_validation" : over.status === "under_validation" ? "complete_validation" : "convert",
});

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
function stub(opts: { workspace?: Record<string, unknown>; convertError?: boolean } = {}) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const key = `${method} ${url.split("?")[0]!.replace("/api/v1", "")}`;
    if (key === "GET /operations-center/overview") return json(OVERVIEW);
    if (key === "GET /operations-manager/cases") return json({ items: [], pagination: { page: 1, pageSize: 15, total: 0, totalPages: 0 } });
    if (key === "GET /operations-center/cases/5/workspace") return json(WORKSPACE(opts.workspace));
    if (key === "GET /operations-manager/staff") return json([{ id: 9, name: "مهندس التشغيل" }]);
    if (key === "POST /operations/cases/5/convert") {
      if (opts.convertError) return json({ error: { code: "OPERATIONS_CONVERT_RECIPE_UNRESOLVED", message: "مفيش وصفة", details: [{ lineId: 1, productName: "بطارية 12 فولت", reason: "none" }] } }, 422);
      return json({ data: { order: { id: 1 }, alreadyConverted: false } }, 201);
    }
    if (key === "POST /operations-manager/cases/5/start-validation") return json({ case: caseRec({ status: "under_validation" }) });
    if (key === "POST /operations-manager/cases/5/request-sales-clarification") return json({ case: caseRec({ status: "needs_sales_clarification" }) });
    return json({ data: {} });
  }));
}
function login(role: string) {
  sessionStorage.setItem("hyper_erp_session", JSON.stringify({ token: "t", user: { id: 1, username: "u", fullName: "مستخدم", role } }));
}
const mount = () => render(<ToastProvider><Operations /></ToastProvider>);
beforeEach(() => {
  sessionStorage.clear();
  history.replaceState(null, "", "/v2/staff/operations");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("مركز قيادة التشغيل", () => {
  it("النظرة العامة: الخطوة الأهم (مهلة) والمؤشرات والحالة المعرّضة للخطر", async () => {
    login("operations_manager");
    stub();
    mount();
    expect(await screen.findByText("1 حالة عدّت مهلتها")).toBeTruthy();
    expect(screen.getByText("حالات نشطة")).toBeTruthy();
    expect(screen.getByText("OPS-5")).toBeTruthy();
    expect(screen.getByText(/عدّت المهلة \(6\/4\)/)).toBeTruthy();
    expect(screen.getByText("مهندس التشغيل")).toBeTruthy();
  });

  it("فتح حالة جاهزة: زر التحويل والسجل بيعرض السبب المسجّل", async () => {
    login("operations_manager");
    stub();
    history.replaceState(null, "", "/v2/staff/operations?case=5");
    mount();
    expect(await screen.findByRole("button", { name: "حوّل لأمر إنتاج" })).toBeTruthy();
    expect(screen.getByText("بطارية 12 فولت")).toBeTruthy();
    expect(screen.getByText("اتطلب توضيح من المبيعات")).toBeTruthy();
    expect(screen.getByText("السعر ناقص")).toBeTruthy();
  });

  it("التحويل بيتأكد الأول وبعدها بيبعت الطلب", async () => {
    login("operations_manager");
    stub();
    history.replaceState(null, "", "/v2/staff/operations?case=5");
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "حوّل لأمر إنتاج" }));
    expect(calls.some((c) => c.url.includes("/convert"))).toBe(false);
    fireEvent.click(await screen.findByRole("button", { name: "حوّل" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/operations/cases/5/convert"))).toBe(true));
  });

  it("رفض التحويل لبند من غير وصفة بيعرض اسم البند", async () => {
    login("operations_manager");
    stub({ convertError: true });
    history.replaceState(null, "", "/v2/staff/operations?case=5");
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "حوّل لأمر إنتاج" }));
    fireEvent.click(await screen.findByRole("button", { name: "حوّل" }));
    expect(await screen.findByText(/مفيش وصفة تصنيع باسم «بطارية 12 فولت»/)).toBeTruthy();
  });

  it("طلب التوضيح بيحتاج سبب 3 حروف على الأقل وبيبعته للمبيعات", async () => {
    login("operations_manager");
    stub({ workspace: { status: "under_validation" } });
    history.replaceState(null, "", "/v2/staff/operations?case=5");
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "اطلب توضيح من المبيعات" }));
    const send = (await screen.findByRole("button", { name: "ابعت للمبيعات" })) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.input(screen.getByLabelText(/إيه اللي محتاج توضيح/), { target: { value: "السعر ناقص" } });
    await waitFor(() => expect((screen.getByRole("button", { name: "ابعت للمبيعات" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "ابعت للمبيعات" }));
    await waitFor(() => {
      const c = calls.find((x) => x.url.endsWith("/request-sales-clarification"));
      expect(c?.body).toEqual({ reason: "السعر ناقص" });
    });
  });
});
