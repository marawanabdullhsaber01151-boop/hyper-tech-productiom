import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../design/components";
import { Stock } from "./Stock";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const item = (id: number, name: string, over: Record<string, unknown> = {}) => ({
  id, code: `C-${id}`, name, category: "raw_material", unit: "كجم", qty: "100", reservedQty: "10", availableQty: "90", minQty: "20", unitPrice: "5", foundationItemId: id, ...over,
});
const ITEMS = [item(1, "حبيبات بلاستيك"), item(2, "ملون أزرق", { qty: "15", availableQty: "15", unitPrice: "10" })];
const MOVES = [
  { id: 9, inventoryItemId: 1, movementType: "in", qty: "30", referenceType: "adjustment", referenceId: 1, unitPrice: null, notes: "استلام من مورّد", createdAt: "2026-10-20T10:00:00.000Z" },
];

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
function stub(extra: Record<string, () => Response> = {}) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const key = `${method} ${url.split("?")[0]!.replace("/api/v1", "")}`;
    if (extra[key]) return extra[key]!();
    if (key === "GET /inventory") return json({ data: ITEMS });
    if (key === "GET /stock-movements") return json({ data: MOVES });
    if (key === "GET /inventory/link-options") return json({ data: [{ id: 7, code: "F-7", name: "صبغة حمراء", itemType: "raw_material", baseUnit: "لتر", minStock: "5", category: "raw_material" }] });
    if (method === "POST") return json({ data: { id: 99 } }, 201);
    return json({ data: {} });
  }));
}
const mount = () => render(<ToastProvider><Stock /></ToastProvider>);
function login(role: string) {
  sessionStorage.setItem("hyper_erp_session", JSON.stringify({ token: "t", user: { id: 1, username: "u", fullName: "مستخدم", role } }));
}
beforeEach(() => {
  sessionStorage.clear();
  login("storekeeper");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("المخزون — إدارة أمين المخزن", () => {
  it("بيشوف السعر وقيمة المخزون وزرار صنف جديد وتبويب الحركات", async () => {
    stub();
    mount();
    expect(await screen.findByText("حبيبات بلاستيك")).toBeTruthy();
    expect(screen.getByText("قيمة المخزون")).toBeTruthy();
    expect(screen.getAllByText("سعر الوحدة").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /صنف جديد/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "الحركات" })).toBeTruthy();
  });

  it("الضغط على صنف بيفتح تفاصيله بأزرار الاستلام والصرف والجرد", async () => {
    stub();
    mount();
    fireEvent.click(await screen.findByText("ملون أزرق"));
    expect(await screen.findByRole("button", { name: /استلام/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /صرف/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /جرد/ })).toBeTruthy();
  });

  it("الاستلام بيبعت حركة يدوية بسبب", async () => {
    stub();
    mount();
    fireEvent.click(await screen.findByText("حبيبات بلاستيك"));
    fireEvent.click(await screen.findByRole("button", { name: /استلام/ }));
    fireEvent.input(await screen.findByLabelText(/الكمية/), { target: { value: "25" } });
    fireEvent.input(screen.getByLabelText(/السبب/), { target: { value: "توريد جديد" } });
    fireEvent.click(screen.getByRole("button", { name: "سجّل الحركة" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.includes("/stock-movements"))).toBe(true));
    const post = calls.find((c) => c.method === "POST" && c.url.includes("/stock-movements"))!;
    expect(post.body).toMatchObject({ inventoryItemId: 1, movementType: "in", qty: "25", referenceType: "adjustment", notes: "توريد جديد" });
  });

  it("الصرف أكتر من الرصيد بيتمنع قبل الإرسال", async () => {
    stub();
    mount();
    fireEvent.click(await screen.findByText("ملون أزرق"));
    fireEvent.click(await screen.findByRole("button", { name: /صرف/ }));
    fireEvent.input(await screen.findByLabelText(/الكمية/), { target: { value: "500" } });
    fireEvent.input(screen.getByLabelText(/السبب/), { target: { value: "تالف" } });
    fireEvent.click(screen.getByRole("button", { name: "سجّل الحركة" }));
    expect(await screen.findByText(/أكبر من الرصيد الحالي/)).toBeTruthy();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("صنف جديد: لازم يتختار من البيانات الأساسية", async () => {
    stub();
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /صنف جديد/ }));
    expect(await screen.findByText("F-7 — صبغة حمراء")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "احفظ" }));
    expect(await screen.findByText("اختار الصنف من القايمة")).toBeTruthy();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("تبويب الحركات بيعرض الرصيد قبل وبعد", async () => {
    stub();
    mount();
    fireEvent.click(await screen.findByRole("tab", { name: "الحركات" }));
    expect(await screen.findByText("استلام من مورّد")).toBeTruthy();
    // الرصيد الحالي ١٠٠ والحركة وارد ٣٠ ← قبل ٧٠ وبعد ١٠٠
    expect(screen.getAllByText("70").length).toBeGreaterThan(0);
  });
});

describe("المخزون — المشتريات عرض فقط", () => {
  it("مفيش تبويبات ولا زرار صنف جديد", async () => {
    login("buyer");
    stub();
    mount();
    await screen.findByText("حبيبات بلاستيك");
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByRole("button", { name: /صنف جديد/ })).toBeNull();
  });
});
