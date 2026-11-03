import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../design/components";
import { Receiving } from "./Receiving";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const LINE = { id: 11, description: "رصاص خام", unit: "kg", qtyReceived: "10.000", qtyAccepted: null, qtyRejected: null, rejectReason: null };
const PENDING = { id: 1, receiptNumber: "GRN-000001", poId: 5, poNumber: "PO-000005", supplierName: "مورد الرصاص", status: "pending_inspection", notes: null, receivedByName: "أمين", receivedAt: "2026-11-02T10:00:00Z", inspectedByName: null, inspectedAt: null, inspectionNotes: null, lines: [LINE] };
const DONE = { ...PENDING, id: 2, receiptNumber: "GRN-000002", status: "partially_accepted", inspectedByName: "مراقب", lines: [{ ...LINE, id: 12, qtyAccepted: "7.000", qtyRejected: "3.000", rejectReason: "عبوات تالفة" }] };
let calls: Array<{ key: string; body: unknown }> = [];

function stub() {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input).split("?")[0]!.replace("/api/v1", "")}`;
    calls.push({ key, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (key === "GET /purchases/receipts") return json([PENDING, DONE]);
    return json({});
  }));
}
function login(role: string) {
  sessionStorage.clear();
  sessionStorage.setItem("hyper_erp_session", JSON.stringify({ token: "t", user: { id: 1, username: "u", fullName: "مستخدم", role } }));
}
const mount = () => render(<ToastProvider><Receiving /></ToastProvider>);
beforeEach(() => history.replaceState(null, "", "/v2/staff/receiving"));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("صفحة فحص الخامات الواردة", () => {
  it("دور بلا صلاحية يشوف رسالة منع", () => {
    login("sales_manager");
    stub();
    mount();
    expect(screen.getByText("الصفحة دي مش متاحة لدورك.")).toBeTruthy();
  });

  it("أمين المخزن يشوف المستنية من غير زر فحص", async () => {
    login("warehouse_manager");
    stub();
    mount();
    expect(await screen.findByText("GRN-000001")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "افحص" })).toBeNull();
    expect(screen.getByText("مستني مراقب الجودة")).toBeTruthy();
    expect(screen.queryByText("GRN-000002")).toBeNull();
  });

  it("المراقب يرفض جزء: السبب إجباري، وبعدها بيبعت القرار", async () => {
    login("raw_material_quality_controller");
    stub();
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "افحص" }));
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.input(dialog.getByLabelText("الكمية المقبولة"), { target: { value: "7" } });
    const reason = await dialog.findByLabelText(/سبب الرفض/);
    fireEvent.click(dialog.getByRole("button", { name: "سجّل قرار الفحص" }));
    expect(await dialog.findByText("اكتب سبب الرفض")).toBeTruthy();
    expect(calls.some((c) => c.key.startsWith("POST"))).toBe(false);
    fireEvent.input(reason, { target: { value: "عبوات تالفة" } });
    fireEvent.click(dialog.getByRole("button", { name: "سجّل قرار الفحص" }));
    await waitFor(() => expect(calls.some((c) => c.key === "POST /purchases/receipts/1/inspect")).toBe(true));
    expect(calls.find((c) => c.key === "POST /purchases/receipts/1/inspect")!.body).toEqual({ decisions: [{ lineId: 11, acceptedQty: "7", rejectReason: "عبوات تالفة" }] });
  });

  it("الكل يعرض المفحوص بتفاصيله", async () => {
    login("chairman");
    stub();
    mount();
    await screen.findByText("GRN-000001");
    fireEvent.change(screen.getByLabelText("الحالة"), { target: { value: "all" } });
    expect(await screen.findByText("GRN-000002")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "التفاصيل" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText(/عبوات تالفة/)).toBeTruthy();
  });
});
