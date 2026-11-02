import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../design/components";
import { Foundation } from "./Foundation";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const LOCATIONS = [{ id: 1, code: "WH-1", name: "مخزن رئيسي", locationType: "warehouse", parentId: null, active: true, allowsInventory: true, allowsProduction: false, requiresQuarantine: false, notes: null }];
const CENTERS = [{ id: 2, code: "WC-1", name: "خط التعبئة", centerType: "production_line", locationId: 1, capacityMinutesPerShift: 480, active: true, notes: null }];
const MACHINES = [{ id: 3, code: "M-1", name: "ماكينة لحام", workCenterId: 2, status: "available", serialNumber: null, calibrationDueDate: "2000-01-01", maintenanceDueDate: null, active: true, notes: null }];
const SHIFTS = [{ id: 4, code: "S-1", name: "ليلي", startTime: "22:00", endTime: "06:00", breakMinutes: 60, active: true }];
const SEQUENCES = [{ id: 5, sequenceKey: "production_order", prefix: "PO-", nextValue: 42, padding: 6, active: true }];
const ITEM = { id: 7, code: "RM-1", name: "رصاص", itemType: "raw_material", baseUnit: "kg", active: true, lotTracked: true, serialTracked: false, shelfLifeDays: null, minStock: "10.000", notes: null, status: "active", version: 1, pendingChangePayload: null, pendingChangeReason: null, pendingChangeRequestedByName: null, pendingChangeRequestedAt: null };
const PENDING = { ...ITEM, id: 8, code: "RM-2", name: "حمض", status: "pending_approval", pendingChangePayload: { baseUnit: "طن" }, pendingChangeReason: "الشراء بالطن", pendingChangeRequestedByName: "أحمد" };
let impact: unknown;
let calls: Array<{ key: string; body: unknown }> = [];

function stub() {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input).split("?")[0]!.replace("/api/v1", "")}`;
    calls.push({ key, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (key === "GET /foundation/locations") return json(LOCATIONS);
    if (key === "GET /foundation/work-centers") return json(CENTERS);
    if (key === "GET /foundation/machines") return json(MACHINES);
    if (key === "GET /foundation/shifts") return json(SHIFTS);
    if (key === "GET /foundation/number-sequences") return json(SEQUENCES);
    if (key === "GET /foundation/audit") return json([]);
    if (key === "GET /foundation/items") return json([ITEM, PENDING]);
    if (key.startsWith("GET /foundation/impact/")) return json(impact);
    return json({});
  }));
}
function login(role: string) {
  sessionStorage.clear();
  sessionStorage.setItem("hyper_erp_session", JSON.stringify({ token: "t", user: { id: 1, username: "u", fullName: "مستخدم", role } }));
}
const mount = () => render(<ToastProvider><Foundation /></ToastProvider>);
beforeEach(() => { history.replaceState(null, "", "/v2/staff/foundation"); impact = { kind: "work-center", id: 2, name: "خط التعبئة", active: true, blocked: false, blockers: [], references: [] }; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("صفحة البيانات الأساسية", () => {
  it("دور بلا صلاحية يشوف رسالة منع", () => {
    login("sales_manager");
    stub();
    mount();
    expect(screen.getByText("الصفحة دي مش متاحة لدورك.")).toBeTruthy();
  });

  it("أمين المخازن يشوف التبويبات من غير سجل التدقيق، والعدّاد من غير زر تعديل", async () => {
    login("warehouse_manager");
    stub();
    mount();
    expect(await screen.findByText("مخزن رئيسي")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "سجل التدقيق" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "عدادات المستندات" }));
    expect(await screen.findByText("PO-000042")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "تعديل" })).toBeNull();
  });

  it("الماكينة المتأخرة معايرتها بتتعلّم، والوردية الليلية بتتعلّم", async () => {
    login("chairman");
    stub();
    mount();
    fireEvent.click(await screen.findByRole("tab", { name: "الماكينات" }));
    expect(await screen.findByText("ماكينة لحام")).toBeTruthy();
    expect(screen.getAllByText(/متأخر/).length > 0).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: "الورديات" }));
    expect(await screen.findByText("بتعدّي منتصف الليل")).toBeTruthy();
  });

  it("الإيقاف من غير مراجع حيّة بيبعت active:false من غير سبب", async () => {
    login("chairman");
    stub();
    mount();
    fireEvent.click(await screen.findByRole("tab", { name: "مراكز العمل" }));
    await screen.findByText("خط التعبئة");
    fireEvent.click(screen.getByRole("button", { name: "إيقاف" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(await dialog.findByText("مفيش حاجة حيّة معتمدة على السجل ده. تقدر توقفه بأمان.")).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: "أوقف" }));
    await waitFor(() => expect(calls.some((c) => c.key === "PATCH /foundation/work-centers/2")).toBe(true));
    expect(calls.find((c) => c.key === "PATCH /foundation/work-centers/2")!.body).toEqual({ active: false });
  });

  it("مع مراجع حيّة الزر مقفول لحد ما يتكتب سبب، وبعدها بيبعت overrideReason", async () => {
    login("chairman");
    impact = { kind: "work-center", id: 2, name: "خط التعبئة", active: true, blocked: true, blockers: [{ type: "machines", count: 2, label: "ماكينات نشطة مرتبطة بمركز العمل هذا", examples: ["M-1 - ماكينة لحام"] }], references: [] };
    stub();
    mount();
    fireEvent.click(await screen.findByRole("tab", { name: "مراكز العمل" }));
    await screen.findByText("خط التعبئة");
    fireEvent.click(screen.getByRole("button", { name: "إيقاف" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(await dialog.findByText(/ماكينات نشطة مرتبطة بمركز العمل هذا/)).toBeTruthy();
    const confirm = dialog.getByRole("button", { name: "أوقف رغم كده" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.input(dialog.getByLabelText(/سبب الإيقاف/), { target: { value: "نقل الخط لمصنع تاني" } });
    await waitFor(() => expect((dialog.getByRole("button", { name: "أوقف رغم كده" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(dialog.getByRole("button", { name: "أوقف رغم كده" }));
    await waitFor(() => expect(calls.some((c) => c.key === "PATCH /foundation/work-centers/2")).toBe(true));
    expect(calls.find((c) => c.key === "PATCH /foundation/work-centers/2")!.body).toEqual({ active: false, overrideReason: "نقل الخط لمصنع تاني" });
  });

  it("الأصناف: تعديل الاسم مباشر، وتغيير الوحدة على صنف نشط بيبعت طلب تغيير بسبب", async () => {
    login("warehouse_manager");
    stub();
    mount();
    fireEvent.click(await screen.findByRole("tab", { name: "الأصناف" }));
    await screen.findByText("رصاص");
    fireEvent.click(screen.getAllByRole("button", { name: "تعديل" })[0]!);
    let dialog = within(await screen.findByRole("dialog"));
    fireEvent.input(dialog.getByLabelText(/اسم الصنف/), { target: { value: "رصاص نقي" } });
    fireEvent.click(dialog.getByRole("button", { name: "احفظ" }));
    await waitFor(() => expect(calls.some((c) => c.key === "PATCH /foundation/items/7")).toBe(true));
    expect(calls.find((c) => c.key === "PATCH /foundation/items/7")!.body).toEqual({ name: "رصاص نقي" });
    cleanup();
    calls = [];
    mount();
    fireEvent.click(await screen.findByRole("tab", { name: "الأصناف" }));
    await screen.findByText("رصاص");
    fireEvent.click(screen.getAllByRole("button", { name: "تعديل" })[0]!);
    dialog = within(await screen.findByRole("dialog"));
    fireEvent.input(dialog.getByLabelText(/وحدة القياس الأساسية/), { target: { value: "طن" } });
    const send = await dialog.findByRole("button", { name: "ابعت طلب التغيير" });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.input(dialog.getByLabelText(/سبب التغيير/), { target: { value: "الشراء بالطن" } });
    await waitFor(() => expect((dialog.getByRole("button", { name: "ابعت طلب التغيير" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(dialog.getByRole("button", { name: "ابعت طلب التغيير" }));
    await waitFor(() => expect(calls.some((c) => c.key === "POST /foundation/items/7/request-change")).toBe(true));
    expect(calls.find((c) => c.key === "POST /foundation/items/7/request-change")!.body).toEqual({ changes: { baseUnit: "طن" }, reason: "الشراء بالطن" });
  });

  it("الأصناف: مدير الإنتاج مايشوفش زر المراجعة، والمدير التنفيذي يعتمد", async () => {
    login("production_manager");
    stub();
    mount();
    fireEvent.click(await screen.findByRole("tab", { name: "الأصناف" }));
    await screen.findByText("حمض");
    expect(screen.queryByRole("button", { name: "راجع الطلب" })).toBeNull();
    expect(screen.getByText("مستني قرار المعتمِد")).toBeTruthy();
    cleanup();
    login("executive_manager");
    mount();
    fireEvent.click(await screen.findByRole("tab", { name: "الأصناف" }));
    await screen.findByText("حمض");
    fireEvent.click(screen.getByRole("button", { name: "راجع الطلب" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(await dialog.findByText(/الشراء بالطن/)).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: "اعتمد" }));
    await waitFor(() => expect(calls.some((c) => c.key === "POST /foundation/items/8/approve")).toBe(true));
  });
});
