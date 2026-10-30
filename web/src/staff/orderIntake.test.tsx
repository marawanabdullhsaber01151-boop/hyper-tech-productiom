import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../design/components";
import { Production } from "./Production";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ORDERS = [
  { id: 5, orderNumber: "PO-5", productName: "بطارية 12 فولت", qty: "10.000", unit: "قطعة", priority: "high", workflowStatus: "new", neededBy: "2099-01-01", createdById: 9, bomRecipeId: 7, customerName: "شركة النور", customerPhone: "01012345678", customerEmail: "n@x.co", orderSource: "direct", orderDetails: "تغليف خاص" },
  { id: 6, orderNumber: "PO-6", productName: "كابل", qty: "3.000", unit: "لفة", priority: "normal", workflowStatus: "new", neededBy: "2099-01-01", createdById: 9, bomRecipeId: 8, customerName: "عميل البوابة", orderSource: "website" },
];
let calls: Array<{ key: string; body: unknown }> = [];
function stub() {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input).split("?")[0]!.replace("/api/v1", "")}`;
    calls.push({ key, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (key === "GET /production-workflow") return json({ data: ORDERS, stats: {} });
    if (key === "GET /production-workflow/recipes") return json({ data: [{ id: 7, productName: "بطارية 12 فولت", productCode: "B12" }, { id: 8, productName: "كابل", productCode: null }] });
    if (key.endsWith("/lifecycle")) return json({ viewKind: "canonical_workflow_order", data: { blockedGates: [], conformance: { ok: true }, children: [], timeline: [] } });
    return json({ data: {} });
  }));
}
function login(role: string) {
  sessionStorage.clear();
  sessionStorage.setItem("hyper_erp_session", JSON.stringify({ token: "t", user: { id: 1, username: "u", fullName: "مستخدم", role } }));
}
const mount = () => render(<ToastProvider><Production /></ToastProvider>);
beforeEach(() => { history.replaceState(null, "", "/v2/staff/production?tab=orders"); localStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("استقبال أمر إنتاج جديد", () => {
  it("أوامر البوابة عليها علامة «من البوابة»", async () => {
    login("chairman");
    stub();
    mount();
    await screen.findByText("كابل");
    expect(screen.getAllByText("من البوابة").length).toBe(1);
  });

  it("تكرار الأمر بيعبّي الوصفة والكمية والعميل ويسيب الموعد فاضي لحد ما تختاره", async () => {
    login("chairman");
    stub();
    mount();
    await screen.findByText("بطارية 12 فولت");
    fireEvent.click(screen.getAllByRole("button", { name: "التفاصيل" })[0]!);
    const detail = await screen.findByRole("dialog");
    fireEvent.click(within(detail).getByRole("button", { name: "تكرار الأمر" }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByText("تكرار الأمر PO-5")).toBeTruthy();
    expect((within(dlg).getByLabelText(/^الكمية/) as HTMLInputElement).value).toBe("10");
    expect((within(dlg).getByLabelText(/^اسم العميل/) as HTMLInputElement).value).toBe("شركة النور");
    expect((within(dlg).getByLabelText(/^بريد العميل/) as HTMLInputElement).value).toBe("n@x.co");
    expect((within(dlg).getByLabelText(/^موعد التسليم/) as HTMLInputElement).value).toBe("");
    const save = within(dlg).getByRole("button", { name: "إنشاء الأمر" }) as HTMLButtonElement;
    await waitFor(() => expect((within(dlg).getByLabelText(/^المنتج/) as HTMLSelectElement).value).toBe("7"));
    expect(save.disabled).toBe(true);
    fireEvent.input(within(dlg).getByLabelText(/^موعد التسليم/), { target: { value: "2099-02-01" } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(calls.find((c) => c.key === "POST /production-workflow")?.body).toMatchObject({ bomRecipeId: 7, qty: "10", customerName: "شركة النور", customerPhone: "01012345678", customerEmail: "n@x.co", orderSource: "direct", priority: "high", neededBy: "2099-02-01", orderDetails: "تغليف خاص" }));
  });

  it("موعد في الماضي وبريد غلط وموبايل قصير بيقفلوا الحفظ وبتظهر الأسباب", async () => {
    login("chairman");
    stub();
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "أمر إنتاج جديد" }));
    const dlg = await screen.findByRole("dialog");
    await within(dlg).findByRole("option", { name: "كابل" });
    fireEvent.change(within(dlg).getByLabelText(/^المنتج/), { target: { value: "8" } });
    fireEvent.input(within(dlg).getByLabelText(/^الكمية/), { target: { value: "2" } });
    fireEvent.input(within(dlg).getByLabelText(/^اسم العميل/), { target: { value: "شركة" } });
    fireEvent.input(within(dlg).getByLabelText(/^موعد التسليم/), { target: { value: "2020-01-01" } });
    const save = within(dlg).getByRole("button", { name: "إنشاء الأمر" }) as HTMLButtonElement;
    expect(within(dlg).getByText(/لا يمكن أن يكون في الماضي/)).toBeTruthy();
    expect(save.disabled).toBe(true);
    fireEvent.input(within(dlg).getByLabelText(/^موعد التسليم/), { target: { value: "2099-02-01" } });
    expect(save.disabled).toBe(false);
    fireEvent.input(within(dlg).getByLabelText(/^بريد العميل/), { target: { value: "غلط" } });
    expect(within(dlg).getByText(/بريدًا إلكترونيًا صحيحًا/)).toBeTruthy();
    expect(save.disabled).toBe(true);
    fireEvent.input(within(dlg).getByLabelText(/^بريد العميل/), { target: { value: "" } });
    fireEvent.input(within(dlg).getByLabelText(/^هاتف العميل/), { target: { value: "123" } });
    expect(within(dlg).getByText(/7 أرقام على الأقل/)).toBeTruthy();
    expect(save.disabled).toBe(true);
  });

  it("اختيار عميل معروف بيكمّل الموبايل والإيميل", async () => {
    login("chairman");
    stub();
    mount();
    // لازم قايمة الأوامر تتحمّل الأول: العملاء المعروفين بيتاخدوا منها (على جهاز بطيء الزر بيظهر قبلها).
    await screen.findByText("بطارية 12 فولت");
    fireEvent.click(await screen.findByRole("button", { name: "أمر إنتاج جديد" }));
    const dlg = await screen.findByRole("dialog");
    fireEvent.input(within(dlg).getByLabelText(/^اسم العميل/), { target: { value: "شركة النور" } });
    expect((within(dlg).getByLabelText(/^هاتف العميل/) as HTMLInputElement).value).toBe("01012345678");
    expect((within(dlg).getByLabelText(/^بريد العميل/) as HTMLInputElement).value).toBe("n@x.co");
  });
});
