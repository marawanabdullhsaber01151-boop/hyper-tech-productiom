import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../design/components";
import { Production } from "./Production";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const REQUESTS = [
  { id: 1, requestNumber: "PR-0001", productName: "بطارية 12 فولت", requestedQty: "10", unit: "piece", priority: "high", status: "pending_warehouse", createdAt: "2026-10-25T10:00:00Z", workflowOrderNumber: null },
  { id: 2, requestNumber: "PR-0002", productName: "شاحن", requestedQty: "5", unit: "box", priority: "normal", status: "pending_director", createdAt: "2026-10-25T11:00:00Z", workflowOrderNumber: null },
];
const NCRS = [
  { id: 7, ncrNumber: "NCR-000007", workflowOrderId: 3, orderNumber: "PO-3", productName: "بطارية", defectCode: "خدش", affectedQty: "4", disposition: "hold", status: "open", rootCause: null, correctiveAction: null, createdAt: "2026-10-25T09:00:00Z" },
];
let calls: Array<{ key: string; body: unknown }> = [];
function stub() {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input).split("?")[0]!.replace("/api/v1", "")}`;
    calls.push({ key, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (key === "GET /production-requests") return json({ data: REQUESTS, stats: {} });
    if (key === "GET /production-requests/recipes") return json({ data: [{ id: 4, productName: "بطارية 12 فولت", productCode: "B12" }] });
    if (key === "GET /production-execution/ncrs") return json({ data: NCRS });
    if (key === "GET /production-workflow") return json({ data: [{ id: 3, orderNumber: "PO-3", productName: "بطارية", workflowStatus: "in_production" }, { id: 4, orderNumber: "PO-4", productName: "جديد", workflowStatus: "new" }], stats: {} });
    if (key === "GET /production-execution/traceability/LOT-1") return json({ data: [{ id: 1, lotNumber: "LOT-1", traceType: "output_lot", itemCode: "B12", quantity: "10", batchId: 2, orderNumber: "PO-3", createdAt: "2026-10-25T09:00:00Z" }] });
    return json({ data: {} });
  }));
}
function login(role: string) {
  sessionStorage.clear();
  sessionStorage.setItem("hyper_erp_session", JSON.stringify({ token: "t", user: { id: 1, username: "u", fullName: "مستخدم", role } }));
}
const mount = () => render(<ToastProvider><Production /></ToastProvider>);
beforeEach(() => history.replaceState(null, "", "/v2/staff/production"));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("صفحة الإنتاج: طلبات الإنتاج", () => {
  it("أمين المخزن يشوف تبويب الطلبات بس، ويعتمد من المخزن بقرار مؤكد", async () => {
    login("storekeeper");
    stub();
    mount();
    expect(await screen.findByText("PR-0001")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /الجودة/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "طلب إنتاج جديد" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "اعتماد المخزن" }));
    const dlg = await screen.findByRole("dialog");
    fireEvent.click(within(dlg).getByRole("button", { name: "تنفيذ" }));
    await waitFor(() => expect(calls.find((c) => c.key === "PATCH /production-requests/1/warehouse-action")?.body).toMatchObject({ action: "approve" }));
  });

  it("الاعتماد الجزئي بيرفض كمية أكبر من المطلوب ويبعت الكمية الصحيحة", async () => {
    login("warehouse_manager");
    stub();
    mount();
    await screen.findByText("PR-0001");
    fireEvent.click(screen.getByRole("button", { name: "اعتماد جزئي" }));
    const dlg = await screen.findByRole("dialog");
    const qty = within(dlg).getAllByRole("textbox").find((el) => (el as HTMLInputElement).inputMode === "decimal")!;
    fireEvent.input(qty, { target: { value: "11" } });
    expect((within(dlg).getByRole("button", { name: "تنفيذ" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.input(qty, { target: { value: "6" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "تنفيذ" }));
    await waitFor(() => expect(calls.find((c) => c.key === "PATCH /production-requests/1/warehouse-action")?.body).toMatchObject({ action: "partial", approvedQty: "6" }));
  });

  it("الإدارة: رفض من غير سبب مش بيتبعت، وبالسبب بيتبعت", async () => {
    login("production_manager");
    stub();
    mount();
    await screen.findByText("PR-0002");
    fireEvent.click(screen.getByRole("button", { name: "قرار الإدارة" }));
    const dlg = await screen.findByRole("dialog");
    fireEvent.change(within(dlg).getByRole("combobox"), { target: { value: "reject" } });
    expect((within(dlg).getByRole("button", { name: "تنفيذ" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.input(within(dlg).getAllByRole("textbox")[0]!, { target: { value: "الخامات غير كافية" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "تنفيذ" }));
    await waitFor(() => expect(calls.find((c) => c.key === "PATCH /production-requests/2/director-action")?.body).toMatchObject({ action: "reject", comment: "الخامات غير كافية" }));
  });

  it("المشرف ينشئ طلب بالوصفة والكمية، والاسم بيتاخد من الوصفة", async () => {
    login("supervisor");
    stub();
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "طلب إنتاج جديد" }));
    const dlg = await screen.findByRole("dialog");
    await within(dlg).findByRole("option", { name: /B12/ });
    fireEvent.change(within(dlg).getByLabelText(/وصفة التصنيع/), { target: { value: "4" } });
    const qty = within(dlg).getAllByRole("textbox").find((el) => (el as HTMLInputElement).inputMode === "decimal")!;
    fireEvent.input(qty, { target: { value: "25" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "إرسال الطلب" }));
    await waitFor(() => expect(calls.find((c) => c.key === "POST /production-requests")?.body).toMatchObject({ bomRecipeId: 4, productName: "بطارية 12 فولت", requestedQty: "25", priority: "normal" }));
  });
});

describe("صفحة الإنتاج: الجودة والتتبع", () => {
  it("مراقب الجودة يقفل الحالة بسبب جذري وإجراء تصحيحي", async () => {
    login("production_quality_controller");
    stub();
    history.replaceState(null, "", "/v2/staff/production?tab=quality");
    mount();
    expect(await screen.findByText("NCR-000007")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "قفل الحالة" }));
    const dlg = await screen.findByRole("dialog");
    const close = within(dlg).getByRole("button", { name: "قفل الحالة" }) as HTMLButtonElement;
    expect(close.disabled).toBe(true);
    const [root, action] = within(dlg).getAllByRole("textbox");
    fireEvent.input(root!, { target: { value: "حرارة الماكينة عالية" } });
    fireEvent.input(action!, { target: { value: "ضبط الحرارة وفحص كل ساعة" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "قفل الحالة" }));
    await waitFor(() => expect(calls.find((c) => c.key === "PATCH /production-execution/ncrs/7/close")?.body).toMatchObject({ rootCause: "حرارة الماكينة عالية", correctiveAction: "ضبط الحرارة وفحص كل ساعة" }));
  });

  it("المشرف يشوف الحالة بس من غير زر قفل", async () => {
    login("supervisor");
    stub();
    history.replaceState(null, "", "/v2/staff/production?tab=quality");
    mount();
    await screen.findByText("NCR-000007");
    expect(screen.queryByRole("button", { name: "قفل الحالة" })).toBeNull();
  });

  it("فتح حالة بيعرض أوامر التصنيع بس ويبعت الأمر والكمية", async () => {
    login("production_quality_controller");
    stub();
    history.replaceState(null, "", "/v2/staff/production?tab=quality");
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "فتح حالة عدم مطابقة" }));
    const dlg = await screen.findByRole("dialog");
    await within(dlg).findByRole("option", { name: /PO-3/ });
    expect(within(dlg).queryByRole("option", { name: /PO-4/ })).toBeNull();
    fireEvent.change(within(dlg).getByLabelText(/أمر الإنتاج/), { target: { value: "3" } });
    // حقل كود العيب مربوط بقايمة اقتراحات (list)، فدوره combobox مش textbox.
    fireEvent.input(within(dlg).getByLabelText(/كود العيب/), { target: { value: "كسر" } });
    const qty = within(dlg).getAllByRole("textbox").find((el) => (el as HTMLInputElement).inputMode === "decimal")!;
    fireEvent.input(qty, { target: { value: "2.5" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "فتح الحالة" }));
    await waitFor(() => expect(calls.find((c) => c.key === "POST /production-execution/ncrs")?.body).toMatchObject({ workflowOrderId: 3, defectCode: "كسر", affectedQty: "2.5" }));
  });

  it("تتبع التشغيلة بيجيب سجلها", async () => {
    login("production_quality_controller");
    stub();
    history.replaceState(null, "", "/v2/staff/production?tab=trace");
    mount();
    const input = await screen.findByPlaceholderText("رقم التشغيلة");
    fireEvent.input(input, { target: { value: "LOT-1" } });
    fireEvent.click(screen.getByRole("button", { name: "بحث" }));
    expect(await screen.findByText("ناتج إنتاج")).toBeTruthy();
    expect(screen.getByText("PO-3")).toBeTruthy();
  });

  it("دور من غير صلاحية بيشوف رسالة وضحة", () => {
    login("online_seller");
    stub();
    mount();
    expect(screen.getByText(/مفيش تبويب متاح/)).toBeTruthy();
  });
});
