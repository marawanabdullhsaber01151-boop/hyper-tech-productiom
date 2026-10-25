import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../design/components";
import { Purchases } from "./Purchases";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const NEEDS = [
  { source: "ops", id: 1, number: "OC-1", inventoryItemId: 10, name: "حبيبات بلاستيك", unit: "كجم", qty: "500", reason: "نقص لأمر إنتاج", supplierId: 5, supplierName: "مورد الخامات", createdAt: "2026-10-20T10:00:00Z", orderable: true },
  { source: "plan", id: 2, number: "PR-000002", inventoryItemId: 11, name: "ملون أزرق", unit: "كجم", qty: "20", reason: null, supplierId: 5, supplierName: "مورد الخامات", createdAt: "2026-10-21T10:00:00Z", orderable: true },
  { source: "ops", id: 3, number: "OC-3", inventoryItemId: 12, name: "عبوات", unit: null, qty: "100", reason: null, supplierId: null, supplierName: null, createdAt: "2026-10-22T10:00:00Z", orderable: true },
];
const ROWS = [
  { id: 1, poNumber: "PO-000001", supplierId: 5, supplierName: "مورد الخامات", status: "pending_approval", expectedDate: null, createdAt: "2026-10-20T10:00:00Z", itemsCount: 1, orderedQty: "100", receivedQty: "0", total: "1000.00" },
  { id: 2, poNumber: "PO-000002", supplierId: 5, supplierName: "مورد الخامات", status: "approved", expectedDate: "2026-12-01", createdAt: "2026-10-21T10:00:00Z", itemsCount: 1, orderedQty: "50", receivedQty: "0", total: "500.00" },
];
const detail = (id: number, status: string, prices = true) => ({
  id, poNumber: `PO-00000${id}`, supplierId: 5, supplierName: "مورد الخامات", status, expectedDate: null, notes: null, createdByName: "مشتري", approvedAt: null, sentAt: null, cancelReason: null, createdAt: "2026-10-20T10:00:00Z", updatedAt: "2026-10-20T10:00:00Z",
  ...(prices ? { total: "1000.00" } : {}),
  items: [{ id: 7, inventoryItemId: 10, description: "حبيبات بلاستيك", unit: "كجم", qty: "100", receivedQty: "0", ...(prices ? { unitPrice: "10.00" } : {}), requisitionSource: null, requisitionId: null }],
});

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
function stub(opts: { prices?: boolean; status?: string } = {}) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const key = `${method} ${url.split("?")[0]!.replace("/api/v1", "")}`;
    if (key === "GET /purchases/needs") return json({ data: NEEDS });
    if (key === "GET /purchases") return json({ data: opts.prices === false ? ROWS.map(({ total: _t, ...r }) => r) : ROWS });
    if (key === "GET /purchases/suppliers") return json({ data: [{ id: 5, name: "مورد الخامات" }] });
    if (key === "GET /inventory") return json({ data: [{ id: 10, name: "حبيبات بلاستيك", unit: "كجم" }, { id: 11, name: "ملون أزرق", unit: "كجم" }, { id: 12, name: "عبوات", unit: null }] });
    if (/^GET \/purchases\/\d+$/.test(key)) return json({ data: detail(Number(key.split("/").pop()), opts.status ?? "pending_approval", opts.prices !== false) });
    if (method === "POST") return json({ data: detail(1, "approved") });
    return json({ data: {} });
  }));
}
const mount = () => render(<ToastProvider><Purchases /></ToastProvider>);
function login(role: string) {
  sessionStorage.setItem("hyper_erp_session", JSON.stringify({ token: "t", user: { id: 1, username: "u", fullName: "مستخدم", role } }));
}
beforeEach(() => {
  sessionStorage.clear();
  history.replaceState(null, "", "/v2/staff/purchases");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("المشتريات — المشتري", () => {
  it("الاحتياجات متجمّعة بالمورد، ومن غير مورد لوحدها", async () => {
    login("buyer");
    stub();
    mount();
    expect(await screen.findByText("المورد: مورد الخامات")).toBeTruthy();
    expect(screen.getByText("حبيبات بلاستيك")).toBeTruthy();
    expect(screen.getByText("ملون أزرق")).toBeTruthy();
    expect(screen.getByText("من غير مورد محدد")).toBeTruthy();
    expect(screen.getAllByText("من الإنتاج").length).toBe(2);
  });

  it("اعمل أمر شراء بيفتح المحرر متملي بالمورد والبنود", async () => {
    login("buyer");
    stub();
    mount();
    const btns = await screen.findAllByRole("button", { name: "اعمل أمر شراء" });
    fireEvent.click(btns[0]!);
    expect(await screen.findByText("من احتياج OC-1")).toBeTruthy();
    expect(screen.getByText("من احتياج PR-000002")).toBeTruthy();
  });

  it("المسودة من غير سعر بتتحفظ، والإرسال بيحمل رقم الاحتياج", async () => {
    login("buyer");
    stub();
    mount();
    fireEvent.click((await screen.findAllByRole("button", { name: "اعمل أمر شراء" }))[0]!);
    fireEvent.click(await screen.findByRole("button", { name: "احفظ المسودة" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/purchases"))).toBe(true));
    const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/purchases"))!;
    expect(post.body).toMatchObject({ supplierId: 5, items: [{ inventoryItemId: 10, qty: "500", unitPrice: "0", requisition: { source: "ops", id: 1 } }, { inventoryItemId: 11, qty: "20" }] });
  });

  it("تبويب الأوامر بيعرض الأعداد والإجمالي، والمشتري مايقدرش يعتمد", async () => {
    login("buyer");
    stub();
    mount();
    fireEvent.click(await screen.findByRole("tab", { name: /أوامر الشراء/ }));
    expect(await screen.findByText("PO-000001")).toBeTruthy();
    expect(screen.getByText("قيمة الأوامر المفتوحة")).toBeTruthy();
    fireEvent.click(screen.getByText("PO-000001"));
    expect(await screen.findByText("الأمر مستني اعتماد مدير المشتريات أو رئيس المجلس.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "اعتمد" })).toBeNull();
  });
});

describe("المشتريات — مدير المشتريات", () => {
  it("بيعتمد أمر بانتظار الاعتماد", async () => {
    login("purchasing_manager");
    stub();
    mount();
    fireEvent.click(await screen.findByRole("tab", { name: /أوامر الشراء/ }));
    fireEvent.click(await screen.findByText("PO-000001"));
    fireEvent.click(await screen.findByRole("button", { name: "اعتمد" }));
    const confirm = (await screen.findAllByRole("button", { name: "اعتمد" })).pop()!;
    fireEvent.click(confirm);
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/purchases/1/status"))).toBe(true));
    expect(calls.find((c) => c.url.endsWith("/purchases/1/status"))!.body).toMatchObject({ status: "approved" });
  });
});

describe("المشتريات — أمين المخزن", () => {
  it("من غير تبويبات ولا أسعار، ويستلم أمر معتمد", async () => {
    login("storekeeper");
    stub({ prices: false, status: "approved" });
    mount();
    expect(await screen.findByText("PO-000002")).toBeTruthy();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByText("قيمة الأوامر المفتوحة")).toBeNull();
    fireEvent.click(screen.getByText("PO-000002"));
    fireEvent.click(await screen.findByRole("button", { name: "استلم بضاعة" }));
    fireEvent.input(await screen.findByLabelText(/الكمية المستلمة/), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "سجّل الاستلام" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/purchases/2/receive"))).toBe(true));
    expect(calls.find((c) => c.url.endsWith("/purchases/2/receive"))!.body).toMatchObject({ lines: [{ itemId: 7, qty: "60" }] });
  });

  it("الاستلام أكتر من المتبقي بيتمنع قبل الإرسال", async () => {
    login("warehouse_manager");
    stub({ prices: false, status: "approved" });
    mount();
    fireEvent.click(await screen.findByText("PO-000002"));
    fireEvent.click(await screen.findByRole("button", { name: "استلم بضاعة" }));
    fireEvent.input(await screen.findByLabelText(/الكمية المستلمة/), { target: { value: "101" } });
    fireEvent.click(screen.getByRole("button", { name: "سجّل الاستلام" }));
    expect(await screen.findByText("الكمية أكبر من المتبقي")).toBeTruthy();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });
});
