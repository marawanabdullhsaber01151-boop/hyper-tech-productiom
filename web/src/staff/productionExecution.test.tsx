import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../design/components";
import { Production } from "./Production";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const BATCHES = [
  { id: 11, workflowOrderId: 3, batchNumber: "B-11", plannedQty: "100", producedQty: "100", acceptedQty: "90", reworkQty: "6", scrapQty: "4", status: "in_progress" },
  { id: 12, workflowOrderId: 3, batchNumber: "B-12", plannedQty: "50", producedQty: "20", acceptedQty: "5", reworkQty: "0", scrapQty: "0", status: "in_progress" },
  { id: 13, workflowOrderId: 3, batchNumber: "B-13", plannedQty: "50", producedQty: "50", acceptedQty: "50", reworkQty: "0", scrapQty: "0", status: "completed" },
];
let calls: Array<{ key: string; body: unknown }> = [];
function stub() {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input).split("?")[0]!.replace("/api/v1", "")}`;
    calls.push({ key, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (key === "GET /production-workflow") return json({ data: [{ id: 3, orderNumber: "PO-3", productName: "بطارية", workflowStatus: "in_production" }], stats: {} });
    if (key === "GET /operations/orders/3/batches") return json(BATCHES);
    if (key === "GET /production-cycle/dashboard") return json({ data: { stages: [{ key: "manufacturing", shortName: "التصنيع", orderCount: 2 }, { key: "x", shortName: "فاضية", orderCount: 0 }] } });
    if (key === "GET /production-execution/batches/12/downtimes") return json({ data: [{ id: 1, reasonCode: "power_outage", minutes: 30, notes: null, createdAt: "2026-10-31T09:00:00Z" }] });
    return json({ data: {} });
  }));
}
function login(role: string) {
  sessionStorage.clear();
  sessionStorage.setItem("hyper_erp_session", JSON.stringify({ token: "t", user: { id: 1, username: "u", fullName: "مستخدم", role } }));
}
const mount = () => render(<ToastProvider><Production /></ToastProvider>);
beforeEach(() => history.replaceState(null, "", "/v2/staff/production?tab=execution"));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function pickOrder() {
  const sel = (await screen.findByRole("combobox", { name: "أمر الإنتاج" })) as HTMLSelectElement;
  await screen.findByRole("option", { name: "PO-3 | بطارية" });
  fireEvent.change(sel, { target: { value: "3" } });
  await screen.findByText("B-11");
}

describe("تبويب التنفيذ والتوقفات", () => {
  it("المشرف يشوف الدفعات ومراحل الدورة، ويقفل الدفعة الموزونة بـ PATCH", async () => {
    login("supervisor");
    stub();
    mount();
    await pickOrder();
    expect(await screen.findByText("التصنيع: 2 أمر")).toBeTruthy();
    expect(screen.queryByText(/فاضية/)).toBeNull();
    const row = screen.getByText("B-11").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "قفل الدفعة" }));
    const dlg = await screen.findByRole("dialog");
    fireEvent.click(within(dlg).getByRole("button", { name: "تأكيد القفل" }));
    await waitFor(() => expect(calls.some((c) => c.key === "PATCH /production-execution/batches/11/close")).toBe(true));
  });

  it("الدفعة غير الموزونة: زر القفل مقفول ومكتوب السبب", async () => {
    login("supervisor");
    stub();
    mount();
    await pickOrder();
    fireEvent.click(within(screen.getByText("B-12").closest("tr")!).getByRole("button", { name: "قفل الدفعة" }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByText(/الكميات مش متوازنة/)).toBeTruthy();
    expect((within(dlg).getByRole("button", { name: "تأكيد القفل" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("الدفعة المقفولة: مفيش تأكيد ولا قفل", async () => {
    login("supervisor");
    stub();
    mount();
    await pickOrder();
    const row = screen.getByText("B-13").closest("tr")!;
    expect(within(row).queryByRole("button", { name: "تأكيد عملية" })).toBeNull();
    expect(within(row).queryByRole("button", { name: "قفل الدفعة" })).toBeNull();
  });

  it("تأكيد عملية بيبعت PATCH (مش POST) بالكميات والفاضي صفر", async () => {
    login("supervisor");
    stub();
    mount();
    await pickOrder();
    fireEvent.click(within(screen.getByText("B-12").closest("tr")!).getByRole("button", { name: "تأكيد عملية" }));
    const dlg = await screen.findByRole("dialog");
    const save = within(dlg).getByRole("button", { name: "تسجيل التأكيد" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.input(within(dlg).getByLabelText(/رقم العملية/), { target: { value: "10" } });
    fireEvent.input(within(dlg).getByLabelText(/الكمية الجيدة/), { target: { value: "7.5" } });
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    await waitFor(() => expect(calls.find((c) => c.key === "PATCH /production-execution/batches/12/confirm")?.body).toEqual({ operationNo: 10, goodQty: "7.5", scrapQty: "0", reworkQty: "0" }));
    expect(calls.some((c) => c.key === "POST /production-execution/batches/12/confirm")).toBe(false);
  });

  it("الجودة تسجّل توقف وتشوف السجل، بدون أزرار التأكيد والقفل", async () => {
    login("production_quality_controller");
    stub();
    mount();
    await pickOrder();
    const row = screen.getByText("B-12").closest("tr")!;
    expect(within(row).queryByRole("button", { name: "تأكيد عملية" })).toBeNull();
    expect(within(row).queryByRole("button", { name: "قفل الدفعة" })).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "توقف" }));
    const dlg = await screen.findByRole("dialog");
    expect(await within(dlg).findByText(/انقطاع كهرباء: 30 دقيقة/)).toBeTruthy();
    fireEvent.change(within(dlg).getByLabelText(/سبب التوقف/), { target: { value: "other" } });
    fireEvent.input(within(dlg).getByLabelText(/المدة بالدقائق/), { target: { value: "15" } });
    const save = within(dlg).getByRole("button", { name: "تسجيل التوقف" }) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    await waitFor(() => expect(calls.find((c) => c.key === "POST /production-execution/batches/12/downtimes")?.body).toEqual({ reasonCode: "other", minutes: 15 }));
  });
});
