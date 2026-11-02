import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../design/components";
import { Engineering } from "./Engineering";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const RECIPES = [
  { id: 1, productCode: "FG-1", productName: "بطارية 12 فولت", foundationItemId: 5, outputQty: "10.000", referencePrice: "500.00", expectedProductionDays: 3, isActive: true, description: null },
  { id: 2, productCode: null, productName: "شاحن قديم", foundationItemId: null, outputQty: "1.000", referencePrice: null, expectedProductionDays: null, isActive: false, description: null },
];
const DETAIL = {
  ...RECIPES[0],
  items: [
    { id: 11, inventoryItemId: 7, materialName: "رصاص", qty: "20.000", unit: "kg", unitCost: "30.00", isFeatured: false, featuredImageData: null, linked: true, available: true },
    { id: 12, inventoryItemId: null, materialName: "غلاف بلاستيك", qty: "10.000", unit: "قطعة", unitCost: "0.00", isFeatured: true, featuredImageData: null, linked: false, available: false },
  ],
  images: [],
};
const LOOKUPS = { products: [{ id: 5, code: "FG-1", name: "بطارية 12 فولت" }, { id: 6, code: "FG-2", name: "بطارية 6 فولت" }], inventory: [{ id: 7, code: "RM-1", name: "رصاص", unit: "kg" }, { id: 8, code: "RM-2", name: "حمض", unit: "لتر" }] };
let calls: Array<{ key: string; body: unknown }> = [];
let deleteStatus = 204;

function stub() {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input).split("?")[0]!.replace("/api/v1", "")}`;
    calls.push({ key, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (key === "GET /bom") return json(RECIPES);
    if (key === "GET /bom/lookups") return json({ data: LOOKUPS });
    if (key === "GET /bom/1") return json(DETAIL);
    if (key === "POST /bom") return json({ id: 9, productName: "x" }, 201);
    if (key === "POST /bom/1/items") return json({ id: 20 }, 201);
    if (key === "DELETE /bom/1") return deleteStatus === 204 ? new Response(null, { status: 204 }) : json({ error: { message: "الوصفة دي مستخدمة. أوقفها بدل ما تمسحها." } }, deleteStatus);
    return json({});
  }));
}
function login(role: string) {
  sessionStorage.clear();
  sessionStorage.setItem("hyper_erp_session", JSON.stringify({ token: "t", user: { id: 1, username: "u", fullName: "مستخدم", role } }));
}
const mount = () => render(<ToastProvider><Engineering /></ToastProvider>);
beforeEach(() => { history.replaceState(null, "", "/v2/staff/engineering"); deleteStatus = 204; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function openFirst() {
  const row = (await screen.findByText("بطارية 12 فولت")).closest("tr") ?? (await screen.findByText("بطارية 12 فولت")).closest("li, div")!;
  fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "افتح" }));
  // عنوان التفاصيل فريد (اسم المكوّن بيظهر في الجدول وفي رسالة التحذير فمينفعش نستنى عليه).
  await screen.findByRole("heading", { name: /وصفة بطارية 12 فولت/ });
}

describe("تبويب وصفات التصنيع", () => {
  it("مدير الموارد البشرية يشوف التبويب لوحده ويبدأ عليه", async () => {
    login("hr_manager");
    stub();
    mount();
    expect(await screen.findByText("بطارية 12 فولت")).toBeTruthy();
    expect(screen.getByText("شاحن قديم")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "الإصدارات الهندسية" })).toBeNull();
    expect(screen.getByRole("button", { name: "وصفة جديدة" })).toBeTruthy();
  });

  it("المشرف يشوف من غير أزرار تعديل", async () => {
    login("supervisor");
    stub();
    mount();
    await screen.findByText("بطارية 12 فولت");
    expect(screen.queryByRole("button", { name: "وصفة جديدة" })).toBeNull();
    await openFirst();
    expect(screen.queryByRole("button", { name: "إضافة مكوّن" })).toBeNull();
    expect(screen.queryByRole("button", { name: "مسح الوصفة" })).toBeNull();
  });

  it("الفتح بيعرض تحذير المكوّن غير المربوط وسبب منع أمر الإنتاج", async () => {
    login("hr_manager");
    stub();
    mount();
    await openFirst();
    expect(await screen.findByText("أمر الإنتاج مش هيتأكد")).toBeTruthy();
    expect(screen.getAllByText(/غلاف بلاستيك/).length).toBeGreaterThanOrEqual(2);
  });

  it("إنشاء وصفة: لازم المنتج الأول، وبعدين بيبعت الربط والكمية", async () => {
    login("hr_manager");
    stub();
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "وصفة جديدة" }));
    const dialog = within(await screen.findByRole("dialog"));
    const save = dialog.getByRole("button", { name: "احفظ" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(await dialog.findByLabelText(/المنتج التام/), { target: { value: "6" } });
    fireEvent.input(dialog.getByLabelText(/الناتج للدفعة/), { target: { value: "١٢" } });
    await waitFor(() => expect((dialog.getByRole("button", { name: "احفظ" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(dialog.getByRole("button", { name: "احفظ" }));
    await waitFor(() => expect(calls.some((c) => c.key === "POST /bom")).toBe(true));
    expect(calls.find((c) => c.key === "POST /bom")!.body).toMatchObject({ foundationItemId: 6, outputQty: "12", referencePrice: null });
  });

  it("إضافة مكوّن مربوط بالمخزون بيبعت الصنف والكمية بأرقام لاتينية", async () => {
    login("hr_manager");
    stub();
    mount();
    await openFirst();
    fireEvent.click(await screen.findByRole("button", { name: "إضافة مكوّن" }));
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.change(dialog.getByLabelText(/صنف المخزون/), { target: { value: "8" } });
    fireEvent.input(dialog.getByLabelText(/الكمية للدفعة/), { target: { value: "٢٫٥" } });
    await waitFor(() => expect((dialog.getByRole("button", { name: "احفظ" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(dialog.getByRole("button", { name: "احفظ" }));
    await waitFor(() => expect(calls.some((c) => c.key === "POST /bom/1/items")).toBe(true));
    expect(calls.find((c) => c.key === "POST /bom/1/items")!.body).toMatchObject({ inventoryItemId: 8, materialName: "حمض", qty: "2.5", unit: "لتر", unitCost: "0" });
  });

  it("مسح وصفة مستخدمة: السيرفر بيرفض والرسالة بتظهر والوصفة بتفضل", async () => {
    login("hr_manager");
    stub();
    deleteStatus = 409;
    mount();
    await openFirst();
    fireEvent.click(screen.getByRole("button", { name: "مسح الوصفة" }));
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.click(dialog.getByRole("button", { name: "مسح الوصفة" }));
    expect(await screen.findByText(/أوقفها بدل ما تمسحها/)).toBeTruthy();
    expect(screen.getAllByText("بطارية 12 فولت", { exact: false }).length).toBeGreaterThan(0);
  });
});
