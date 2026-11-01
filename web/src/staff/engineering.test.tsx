import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../design/components";
import { Engineering } from "./Engineering";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const PRODUCTS = [{ id: 1, code: "BAT-12", name: "بطارية 12 فولت", productType: "finished", baseUnit: "قطعة", status: "active" }];
const LOOKUPS = {
  items: [{ id: 5, code: "RM-1", name: "رصاص", itemType: "raw_material", baseUnit: "kg" }],
  workCenters: [{ id: 2, code: "WC-1", name: "خط التجميع" }],
  machines: [{ id: 7, code: "M-1", name: "ماكينة لحام", workCenterId: 2 }],
  products: [{ id: 1, code: "BAT-12", name: "بطارية 12 فولت" }],
};
const V = (id: number, status: string, validationStatus = "not_validated") => ({ id, productId: 1, version: `V${id}`, status, validationStatus, effectiveFrom: null, changeReason: null });
let versions = [V(10, "draft")];
let changes: unknown[] = [];
let calls: Array<{ key: string; body: unknown }> = [];
function stub() {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input).split("?")[0]!.replace("/api/v1", "")}`;
    calls.push({ key, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (key === "GET /engineering/products") return json({ data: PRODUCTS });
    if (key === "GET /engineering/lookups") return json({ data: LOOKUPS });
    if (key === "GET /engineering/products/1") return json({ data: { ...PRODUCTS[0], versions } });
    if (/^GET \/engineering\/product-versions\/\d+\/components$/.test(key)) return json({ data: [{ id: 1, lineNo: 1, componentType: "raw_material", foundationItemId: 5, subAssemblyProductId: null, qty: "2.5", unit: "kg", scrapFactorPct: "1" }] });
    if (/^GET \/engineering\/routings\/\d+\/operations$/.test(key)) return json({ data: [{ id: 1, operationNo: 10, name: "لحام", workCenterId: 2, machineId: 7, setupMinutes: 5, runMinutesPerUnit: "1.5", workersRequired: 2, qualityPoint: true }] });
    if (key === "POST /engineering/product-versions/10/validate") return json({ data: { passed: false, errorCount: 1, warningCount: 0, issues: [{ severity: "error", code: "X", message: "السطر 1: الكمية غير صالحة" }] } });
    if (key === "GET /engineering/change-requests") return json({ data: changes });
    if (key === "GET /engineering/change-requests/3/impact") return json({ data: { affectedEngineeringVersions: [{ product_version_id: 9, product_id: 1, version: "V9", status: "released" }], productionOrderImpact: "x" } });
    return json({ data: {} });
  }));
}
function login(role: string, id = 1) {
  sessionStorage.clear();
  sessionStorage.setItem("hyper_erp_session", JSON.stringify({ token: "t", user: { id, username: "u", fullName: "مستخدم", role } }));
}
const mount = () => render(<ToastProvider><Engineering /></ToastProvider>);
beforeEach(() => { history.replaceState(null, "", "/v2/staff/engineering"); versions = [V(10, "draft")]; changes = []; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function openVersion(label = "V10") {
  fireEvent.click(await screen.findByRole("button", { name: "الإصدارات" }));
  const row = (await screen.findByText(label)).closest(".eng-ver")!;
  fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "الإصدارات" }));
  await screen.findByText("رصاص", { exact: false });
}

describe("صفحة الهندسة", () => {
  it("دور غير مصرّح له ما يشوفش تبويبات", async () => {
    login("supervisor");
    stub();
    mount();
    expect(await screen.findByText(/مفيش تبويب متاح/)).toBeTruthy();
  });

  it("مسؤول التحكم يشوف المسودة بمكوّناتها ومسارها، ويفحصها، من غير زر اعتماد", async () => {
    login("production_controller");
    stub();
    mount();
    await openVersion();
    expect(screen.getByText("لحام")).toBeTruthy();
    expect(screen.getByText(/إجمالي زمن التشغيل للوحدة: 1.5 دقيقة/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "اعتماد" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "فحص القابلية للتصنيع" }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByText(/السطر 1: الكمية غير صالحة/)).toBeTruthy();
    expect(within(dlg).getByText(/لم يجتز الفحص: 1 خطأ/)).toBeTruthy();
  });

  it("إضافة مكوّن بيبعت مصدرًا واحدًا فقط ورقم سطر تلقائي", async () => {
    login("production_controller");
    stub();
    mount();
    await openVersion();
    fireEvent.click(screen.getByRole("button", { name: "إضافة مكوّن" }));
    const dlg = await screen.findByRole("dialog");
    const save = within(dlg).getByRole("button", { name: "إضافة" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(within(dlg).getByLabelText(/الصنف/), { target: { value: "5" } });
    fireEvent.input(within(dlg).getByLabelText(/الكمية/), { target: { value: "3" } });
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    await waitFor(() => expect(calls.find((c) => c.key === "POST /engineering/product-versions/10/components")?.body).toEqual({ lineNo: 2, componentType: "raw_material", foundationItemId: 5, qty: "3", unit: "kg", scrapFactorPct: "0", isAlternate: false }));
  });

  it("الاعتماد مقفول بدون فحص ناجح، ومفتوح بعده ويبعت POST", async () => {
    login("production_manager");
    versions = [V(10, "in_review", "not_validated")];
    stub();
    mount();
    await openVersion();
    expect((screen.getByRole("button", { name: "اعتماد" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/الاعتماد محتاج فحص قابلية ناجح/)).toBeTruthy();
    cleanup();
    versions = [V(10, "in_review", "passed")];
    stub();
    mount();
    await openVersion();
    fireEvent.click(screen.getByRole("button", { name: "اعتماد" }));
    const dlg = await screen.findByRole("dialog");
    fireEvent.click(within(dlg).getByRole("button", { name: "تأكيد" }));
    await waitFor(() => expect(calls.some((c) => c.key === "POST /engineering/bom-versions/10/approve")).toBe(true));
  });

  it("الإصدار المُصدَر مقفول: مفيش إضافة ولا حذف، والاستبدال محتاج إصدار بديل وسبب", async () => {
    login("chairman");
    versions = [V(10, "released", "passed"), V(11, "draft")];
    stub();
    mount();
    await openVersion();
    expect(screen.queryByRole("button", { name: "إضافة مكوّن" })).toBeNull();
    expect(screen.queryByRole("button", { name: "حذف" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "استبدال بإصدار" }));
    const dlg = await screen.findByRole("dialog");
    const go = within(dlg).getByRole("button", { name: "استبدال بإصدار" }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(within(dlg).getByLabelText(/الإصدار البديل/), { target: { value: "11" } });
    fireEvent.input(within(dlg).getByLabelText(/السبب/), { target: { value: "تحسين المكوّنات" } });
    await waitFor(() => expect(go.disabled).toBe(false));
    fireEvent.click(go);
    await waitFor(() => expect(calls.find((c) => c.key === "POST /engineering/product-versions/10/supersede")?.body).toEqual({ supersededByVersionId: 11, reason: "تحسين المكوّنات" }));
  });
});

describe("طلبات التغيير", () => {
  const CR = (id: number, requestedBy: number, status = "open") => ({ id, productId: 1, productVersionId: null, requestNumber: `ECR-00000${id}`, title: `تغيير ${id}`, reason: "سبب", status, impactSummary: null, requestedBy, decisionReason: null, createdAt: "2026-10-30T10:00:00Z" });

  it("المدير يبت في طلب غيره بسبب مكتوب (PATCH)، ويشوف الأثر", async () => {
    login("production_manager", 8);
    changes = [CR(3, 7)];
    history.replaceState(null, "", "/v2/staff/engineering?tab=changes");
    stub();
    mount();
    expect(await screen.findByText("ECR-000003")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "الأثر" }));
    const imp = await screen.findByRole("dialog");
    expect(await within(imp).findByText(/إصدار V9/)).toBeTruthy();
    expect(within(imp).getByText(/غير متاح حاليًا/)).toBeTruthy();
    fireEvent.click(within(imp).getByRole("button", { name: "قفل" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "رفض" }));
    const dlg = await screen.findByRole("dialog");
    const go = within(dlg).getByRole("button", { name: "رفض" }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.input(within(dlg).getByLabelText(/سبب القرار/), { target: { value: "مش مبرر" } });
    await waitFor(() => expect(go.disabled).toBe(false));
    fireEvent.click(go);
    await waitFor(() => expect(calls.find((c) => c.key === "PATCH /engineering/change-requests/3/decide")?.body).toEqual({ decision: "rejected", reason: "مش مبرر" }));
  });

  it("صاحب الطلب ما يقدرش يبت فيه، والمحرر العادي مالوش قرار", async () => {
    login("production_manager", 7);
    changes = [CR(3, 7)];
    history.replaceState(null, "", "/v2/staff/engineering?tab=changes");
    stub();
    mount();
    expect(await screen.findByText("ECR-000003")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "اعتماد" })).toBeNull();
    expect(screen.getByText(/لا يمكنك البت في طلب فتحته بنفسك/)).toBeTruthy();
    cleanup();
    login("production_controller", 9);
    stub();
    mount();
    expect(await screen.findByText("ECR-000003")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "رفض" })).toBeNull();
  });
});
