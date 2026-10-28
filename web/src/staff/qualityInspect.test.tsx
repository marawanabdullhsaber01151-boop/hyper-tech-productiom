import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../design/components";
import { Production } from "./Production";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ORDERS = [
  { id: 1, orderNumber: "PO-1", productName: "بطارية", qty: "100", unit: "قطعة", workflowStatus: "quality_check", qualityControllerUserId: 7, supervisorName: "منى", productionLine: "خط 1" },
  { id: 2, orderNumber: "PO-2", productName: "شاحن", qty: "50", unit: "قطعة", workflowStatus: "quality_check", qualityControllerUserId: 8, supervisorName: "أحمد", productionLine: "خط 2" },
  { id: 3, orderNumber: "PO-3", productName: "كابل", qty: "5", unit: "قطعة", workflowStatus: "in_production", qualityControllerUserId: 7 },
];
const RECORDS = [{ id: 1, orderNumber: "PO-9", qualityStatus: "failed", qualityNotes: "x", sampleSize: 40, samplePassedCount: 30, defectTags: ["خدش", "كسر"], recordedByName: "هدى", createdAt: "2026-10-25T10:00:00Z" }];
let calls: Array<{ key: string; body: unknown }> = [];
function stub() {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input).split("?")[0]!.replace("/api/v1", "")}`;
    calls.push({ key, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (key === "GET /production-workflow") return json({ data: ORDERS, stats: {} });
    if (key === "GET /production-workflow/quality-records") return json({ data: RECORDS });
    return json({ data: {} });
  }));
}
function login(role: string, id: number) {
  sessionStorage.clear();
  sessionStorage.setItem("hyper_erp_session", JSON.stringify({ token: "t", user: { id, username: "u", fullName: "مستخدم", role } }));
}
const mount = () => render(<ToastProvider><Production /></ToastProvider>);
beforeEach(() => { history.replaceState(null, "", "/v2/staff/production"); localStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function openForm() {
  fireEvent.click(await screen.findByRole("button", { name: "فحص" }));
  return await screen.findByRole("dialog");
}

describe("تبويب فحص الجودة", () => {
  it("مراقب الجودة يفتح عليه، ويشوف أوامره بس مع آخر الفحوصات والعيوب", async () => {
    login("production_quality_controller", 7);
    stub();
    mount();
    expect(await screen.findByText("PO-1")).toBeTruthy();
    expect(screen.queryByText("PO-2")).toBeNull();
    expect(screen.queryByText("PO-3")).toBeNull();
    expect(await screen.findByText("PO-9")).toBeTruthy();
    expect(screen.getByText(/خدش، كسر/)).toBeTruthy();
    expect(screen.getByText("75%")).toBeTruthy();
  });

  it("الفاشل بيتحسب تلقائيًا والنسبة بتظهر، والاجتياز بيبعت الجسم الصح", async () => {
    login("production_quality_controller", 7);
    stub();
    mount();
    const dlg = await openForm();
    fireEvent.input(within(dlg).getByLabelText(/حجم العينة/), { target: { value: "40" } });
    fireEvent.input(within(dlg).getByLabelText(/عدد الناجح/), { target: { value: "38" } });
    expect((within(dlg).getByLabelText(/عدد الفاشل/) as HTMLInputElement).value).toBe("2");
    expect(within(dlg).getByRole("status").textContent).toMatch(/95%/);
    fireEvent.click(within(dlg).getByRole("button", { name: "3 من 5" }));
    fireEvent.input(within(dlg).getByLabelText(/اكتب العيب/), { target: { value: "خدش" } });
    fireEvent.keyDown(within(dlg).getByLabelText(/اكتب العيب/), { key: "Enter" });
    fireEvent.click(within(dlg).getByRole("button", { name: "اجتاز الفحص" }));
    await waitFor(() => expect(calls.find((c) => c.key === "PATCH /production-workflow/1/quality-done")?.body).toMatchObject({ qualityStatus: "passed", sampleSize: 40, samplePassedCount: 38, sampleFailedCount: 2, performanceRating: 3, defectTags: ["خدش"] }));
  });

  it("الرسوب من غير سبب مقفول، والاعتماد تحت 95% محتاج مبرر", async () => {
    login("production_quality_controller", 7);
    stub();
    mount();
    const dlg = await openForm();
    const fail = within(dlg).getByRole("button", { name: "رسب الفحص" }) as HTMLButtonElement;
    const pass = within(dlg).getByRole("button", { name: "اجتاز الفحص" }) as HTMLButtonElement;
    expect(fail.disabled).toBe(true);
    fireEvent.input(within(dlg).getByLabelText(/حجم العينة/), { target: { value: "100" } });
    fireEvent.input(within(dlg).getByLabelText(/عدد الناجح/), { target: { value: "90" } });
    expect(pass.disabled).toBe(true);
    fireEvent.input(within(dlg).getByLabelText(/ملاحظات الفحص/), { target: { value: "العميل وافق على الدرجة الثانية" } });
    expect(pass.disabled).toBe(false);
    expect(fail.disabled).toBe(false);
    fireEvent.click(fail);
    await waitFor(() => expect(calls.find((c) => c.key === "PATCH /production-workflow/1/quality-done")?.body).toMatchObject({ qualityStatus: "failed", qualityNotes: "العميل وافق على الدرجة الثانية" }));
  });

  it("الناجح والفاشل أكبر من العينة بيقفل الأزرار", async () => {
    login("production_quality_controller", 7);
    stub();
    mount();
    const dlg = await openForm();
    fireEvent.input(within(dlg).getByLabelText(/حجم العينة/), { target: { value: "10" } });
    fireEvent.input(within(dlg).getByLabelText(/عدد الناجح/), { target: { value: "8" } });
    fireEvent.input(within(dlg).getByLabelText(/عدد الفاشل/), { target: { value: "5" } });
    expect((within(dlg).getByRole("button", { name: "اجتاز الفحص" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(dlg).getByText(/أكبر من حجم العينة/)).toBeTruthy();
  });

  it("قائمة الفحص بتتحفظ وتترجع بزرار «استخدم قائمة آخر فحص»", async () => {
    login("production_quality_controller", 7);
    stub();
    mount();
    let dlg = await openForm();
    fireEvent.input(within(dlg).getByLabelText(/أضف نقطة فحص/), { target: { value: "الشكل العام" } });
    fireEvent.keyDown(within(dlg).getByLabelText(/أضف نقطة فحص/), { key: "Enter" });
    fireEvent.click(within(dlg).getByRole("checkbox", { name: "الشكل العام" }));
    fireEvent.click(within(dlg).getByRole("button", { name: "اجتاز الفحص" }));
    await waitFor(() => expect(calls.some((c) => c.key === "PATCH /production-workflow/1/quality-done")).toBe(true));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    dlg = await openForm();
    fireEvent.click(within(dlg).getByRole("button", { name: /استخدم قائمة آخر فحص/ }));
    expect(within(dlg).getByRole("checkbox", { name: "الشكل العام" })).toBeTruthy();
  });

  it("المشرف مايشوفش التبويب (فصل المهام)", async () => {
    login("supervisor", 3);
    stub();
    mount();
    await screen.findAllByRole("tab");
    expect(screen.queryByRole("tab", { name: "فحص الجودة" })).toBeNull();
  });

  it("المهندس والإدارة يشوفوا كل أوامر الفحص", async () => {
    login("quality_engineer", 99);
    stub();
    history.replaceState(null, "", "/v2/staff/production?tab=inspect");
    mount();
    expect(await screen.findByText("PO-1")).toBeTruthy();
    expect(screen.getByText("PO-2")).toBeTruthy();
  });
});
