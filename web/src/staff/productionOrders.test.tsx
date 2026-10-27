import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../design/components";
import { Production } from "./Production";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ORDERS = [
  { id: 1, orderNumber: "PO-1", productName: "بطارية 12 فولت", qty: "10", unit: "قطعة", priority: "high", workflowStatus: "claimed", neededBy: "2020-01-01", createdById: 9, createdByName: "مبيعات", customerName: "شركة النور", customerPhone: "0100", lifecycleRevision: 3 },
  { id: 2, orderNumber: "PO-2", productName: "شاحن", qty: "20", unit: "قطعة", priority: "normal", workflowStatus: "in_production", neededBy: "2099-01-01", createdById: 1, createdByName: "أنا", lifecycleRevision: 5 },
  { id: 3, orderNumber: "PO-3", productName: "كابل", qty: "5", unit: "قطعة", priority: "low", workflowStatus: "materials_approved", neededBy: "2099-01-01", createdById: 9, createdByName: "مبيعات", lifecycleRevision: 2 },
];
const LIFE = { viewKind: "canonical_workflow_order", data: { order: {}, blockedGates: [{ key: "team", label: "تعيين فريق التنفيذ", blocked: true, detail: "لم يتم التعيين" }], conformance: { ok: true }, children: [], timeline: [{ id: 1, toStatus: "claimed", actorName: "سعاد", reason: null, createdAt: "2026-10-25T10:00:00Z" }] } };
let calls: Array<{ key: string; body: unknown }> = [];
function stub() {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input).split("?")[0]!.replace("/api/v1", "")}`;
    calls.push({ key, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (key === "GET /production-workflow") return json({ data: ORDERS, stats: {} });
    if (key === "GET /production-workflow/team-options") return json({ supervisors: [{ id: 11, fullName: "أحمد", activeCount: 4 }, { id: 12, fullName: "منى", activeCount: 1 }], qualityControllers: [{ id: 21, fullName: "هدى", activeCount: 2 }] });
    if (key === "GET /production-workflow/recipes") return json({ data: [{ id: 4, productName: "بطارية 12 فولت", productCode: "B12" }] });
    if (key.endsWith("/lifecycle")) return json(LIFE);
    return json({ data: {} });
  }));
}
function login(role: string, id = 1) {
  sessionStorage.clear();
  sessionStorage.setItem("hyper_erp_session", JSON.stringify({ token: "t", user: { id, username: "u", fullName: "مستخدم", role } }));
}
const mount = () => render(<ToastProvider><Production /></ToastProvider>);
beforeEach(() => { history.replaceState(null, "", "/v2/staff/production?tab=orders"); localStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const rowOf = (no: string) => screen.getAllByText(no)[0]!.closest("tr") as HTMLElement;

describe("تبويب أوامر الإنتاج", () => {
  it("الاتش آر يشوف الأوامر ويقدر ينشئ، من غير أزرار الاستلام", async () => {
    login("hr");
    stub();
    mount();
    expect(await screen.findAllByText("PO-1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "أمر إنتاج جديد" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "استلام وتوزيع" })).toBeNull();
    expect(within(rowOf("PO-1")).getByText("متأخر")).toBeTruthy();
  });

  it("إنشاء أمر: الوصفة والكمية والعميل والموعد ثم الإرسال", async () => {
    login("hr");
    stub();
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "أمر إنتاج جديد" }));
    const dlg = await screen.findByRole("dialog");
    await within(dlg).findByRole("option", { name: /B12/ });
    const save = within(dlg).getByRole("button", { name: "إنشاء الأمر" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(within(dlg).getByLabelText(/المنتج \(وصفة التصنيع\)/), { target: { value: "4" } });
    fireEvent.input(within(dlg).getByLabelText(/^الكمية/), { target: { value: "30" } });
    fireEvent.input(within(dlg).getByLabelText(/اسم العميل/), { target: { value: "شركة الأمل" } });
    fireEvent.input(within(dlg).getByLabelText(/موعد التسليم/), { target: { value: "2026-12-01" } });
    fireEvent.click(save);
    await waitFor(() => expect(calls.find((c) => c.key === "POST /production-workflow")?.body).toMatchObject({ bomRecipeId: 4, productName: "بطارية 12 فولت", qty: "30", customerName: "شركة الأمل", neededBy: "2026-12-01", orderSource: "direct" }));
  });

  it("مدير الإنتاج يستلم الأمر: الأقل حِملًا مختار تلقائيًا ويبعت البيانات", async () => {
    login("production_manager");
    stub();
    mount();
    await screen.findAllByText("PO-1");
    fireEvent.click(within(rowOf("PO-1")).getByRole("button", { name: "استلام وتوزيع" }));
    const dlg = await screen.findByRole("dialog");
    await within(dlg).findByRole("option", { name: /منى/ });
    await waitFor(() => expect((within(dlg).getByLabelText(/^المشرف/) as HTMLSelectElement).value).toBe("12"));
    expect((within(dlg).getByLabelText(/^مراقب الجودة/) as HTMLSelectElement).value).toBe("21");
    const send = within(dlg).getByRole("button", { name: "استلام وتوزيع" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.input(within(dlg).getByLabelText(/خط الإنتاج/), { target: { value: "خط 1" } });
    fireEvent.click(send);
    await waitFor(() => expect(calls.find((c) => c.key === "PATCH /production-workflow/1/receive")?.body).toMatchObject({ supervisorId: 12, qualityControllerUserId: 21, productionLine: "خط 1", operationalStatus: "running" }));
  });

  it("مدير الإنتاج يرسل الأمر للتنفيذ بعد اعتماد المواد", async () => {
    login("production_manager");
    stub();
    mount();
    await screen.findAllByText("PO-3");
    fireEvent.click(within(rowOf("PO-3")).getByRole("button", { name: "إرسال للتنفيذ" }));
    const dlg = await screen.findByRole("dialog");
    fireEvent.click(within(dlg).getByRole("button", { name: "إرسال للتنفيذ" }));
    await waitFor(() => expect(calls.some((c) => c.key === "PATCH /production-workflow/3/dispatch")).toBe(true));
  });

  it("التفاصيل بتعرض السجل والموانع، والمدير التنفيذي يلغي بسبب", async () => {
    login("executive_manager");
    stub();
    mount();
    await screen.findAllByText("PO-2");
    fireEvent.click(within(rowOf("PO-2")).getByRole("button", { name: "التفاصيل" }));
    const detail = await screen.findByRole("dialog");
    expect(await within(detail).findByText(/تعيين فريق التنفيذ/)).toBeTruthy();
    expect(within(detail).getByText(/سعاد/)).toBeTruthy();
    fireEvent.click(within(detail).getByRole("button", { name: "إلغاء الأمر" }));
    const dlg = await screen.findByRole("dialog");
    const send = within(dlg).getByRole("button", { name: "تأكيد الإلغاء" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.input(within(dlg).getByLabelText(/سبب الإلغاء/), { target: { value: "العميل ألغى الطلب" } });
    fireEvent.click(send);
    await waitFor(() => expect(calls.find((c) => c.key === "PATCH /production-workflow/2/cancel")?.body).toEqual({ reason: "العميل ألغى الطلب" }));
  });

  it("المشرف: الإكمال الجزئي بيرفض كمية مش أقل من الأمر وبيبعت رقم النسخة", async () => {
    login("supervisor");
    stub();
    mount();
    await screen.findAllByText("PO-2");
    fireEvent.click(within(rowOf("PO-2")).getByRole("button", { name: "التفاصيل" }));
    fireEvent.click(await within(await screen.findByRole("dialog")).findByRole("button", { name: "إكمال جزئي" }));
    const dlg = await screen.findByRole("dialog");
    const send = within(dlg).getByRole("button", { name: "تسجيل الإكمال الجزئي" }) as HTMLButtonElement;
    fireEvent.input(within(dlg).getByLabelText(/الكمية المكتملة/), { target: { value: "20" } });
    fireEvent.input(within(dlg).getByLabelText(/السبب/), { target: { value: "سلمنا جزء للعميل" } });
    expect(send.disabled).toBe(true);
    fireEvent.input(within(dlg).getByLabelText(/الكمية المكتملة/), { target: { value: "8" } });
    fireEvent.click(send);
    await waitFor(() => expect(calls.find((c) => c.key === "POST /production-workflow/2/partial-completion")?.body).toMatchObject({ quantity: "8", reason: "سلمنا جزء للعميل", expectedRevision: 5 }));
  });

  it("صاحب الطلب بس يشوف تعديل الموعد، وبيبعت التاريخ الجديد", async () => {
    login("executive_manager", 1);
    stub();
    mount();
    await screen.findAllByText("PO-1");
    fireEvent.click(within(rowOf("PO-1")).getByRole("button", { name: "التفاصيل" }));
    const other = await screen.findByRole("dialog");
    expect(within(other).queryByRole("button", { name: "تعديل الموعد" })).toBeNull();
    fireEvent.click(within(other).getByRole("button", { name: "قفل" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(within(rowOf("PO-2")).getByRole("button", { name: "التفاصيل" }));
    fireEvent.click(await within(await screen.findByRole("dialog")).findByRole("button", { name: "تعديل الموعد" }));
    const dlg = await screen.findByRole("dialog");
    fireEvent.input(within(dlg).getByLabelText(/الموعد الجديد/), { target: { value: "2099-02-02" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "حفظ الموعد" }));
    await waitFor(() => expect(calls.find((c) => c.key === "PATCH /production-workflow/2/needed-by")?.body).toMatchObject({ neededBy: "2099-02-02" }));
  });

  it("المشرف يفتح على أوامره بس وينقلها للمرحلة التالية", async () => {
    login("supervisor");
    stub();
    mount();
    await screen.findAllByText("PO-2");
    expect(screen.queryByText("PO-1")).toBeNull();
    expect(within(rowOf("PO-2")).getByText(/المرحلة 1 من 4/)).toBeTruthy();
    fireEvent.click(within(rowOf("PO-2")).getByRole("button", { name: "المرحلة التالية" }));
    const dlg = await screen.findByRole("dialog");
    fireEvent.click(within(dlg).getByRole("button", { name: "نقل للمرحلة التالية" }));
    await waitFor(() => expect(calls.some((c) => c.key === "PATCH /production-workflow/2/advance-stage")).toBe(true));
  });

  it("مدير المبيعات يتابع الأوامر من غير أزرار تنفيذ", async () => {
    login("sales_manager");
    stub();
    mount();
    expect((await screen.findAllByText("PO-1")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "استلام وتوزيع" })).toBeNull();
    expect(screen.queryByRole("button", { name: "المرحلة التالية" })).toBeNull();
  });

  it("فلتر «ينتظر إجراءك» بيعرض أوامر الدور بس", async () => {
    login("production_manager");
    stub();
    mount();
    await screen.findAllByText("PO-1");
    fireEvent.change(screen.getByRole("combobox", { name: "الحالة" }), { target: { value: "mine" } });
    expect(screen.getAllByText("PO-1").length).toBeGreaterThan(0);
    expect(screen.queryByText("PO-2")).toBeNull();
  });
});
