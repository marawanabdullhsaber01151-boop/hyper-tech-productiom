import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../design/components";
import { Sales, fixedChannel } from "./Sales";
import { flowItems } from "./SalesDetail";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const order = (id: number, no: string, over: Record<string, unknown> = {}) => ({
  id, orderNumber: no, contactId: 5, channel: "direct", date: "2026-10-01", dueDate: null, status: "draft", notes: null, subtotal: "100.00", total: "100.00",
  createdAt: "2026-10-01T08:00:00Z", updatedAt: "2026-10-01T08:00:00Z", ...over,
});
const ORDERS = [order(1, "INV-1"), order(2, "INV-2", { status: "paid", total: "250.00", contactId: null })];

interface Call { path: string; query: URLSearchParams; method: string; body: any }
function setup(over: { orders?: unknown[]; detail?: Record<string, unknown> } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://x");
      const method = (init?.method ?? "GET").toUpperCase();
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path: u.pathname, query: u.searchParams, method, body });
      const p = u.pathname;
      if (p === "/api/v1/sales" && method === "GET") {
        const items = over.orders ?? ORDERS;
        return json({
          items,
          pagination: { page: 1, pageSize: 15, total: items.length, totalPages: 1 },
          statusCounts: { draft: 1, paid: 1 },
          summary: { total: items.length, revenue: "250.00", pending: 1, customers: 1 },
        });
      }
      if (p === "/api/v1/sales" && method === "POST") return json({ ...order(9, body.orderNumber), items: [] }, 201);
      if (/^\/api\/v1\/sales\/\d+$/.test(p) && method === "GET")
        return json({ ...order(1, "INV-1"), items: [{ id: 1, inventoryItemId: 3, description: "كرتونة كبيرة", qty: "2.000", unitPrice: "50.00", total: "100.00" }], ...over.detail });
      if (/^\/api\/v1\/sales\/\d+$/.test(p) && method === "PATCH") return json({ ...order(1, "INV-1", { status: body.status ?? "draft" }), items: [] });
      if (p === "/api/v1/contacts") return json([{ id: 5, name: "شركة النور", type: "customer" }, { id: 6, name: "مورّد", type: "supplier" }]);
      if (p === "/api/v1/inventory") return json([{ id: 3, name: "كرتونة كبيرة", unit: "قطعة", availableQty: "40" }]);
      return json({ error: { message: "x" } }, 404);
    }),
  );
  return calls;
}
function login(role: string) {
  sessionStorage.setItem("hyper_erp_session", JSON.stringify({ token: "t", user: { id: 1, username: "u", fullName: "مستخدم", role } }));
}
const mount = () => render(<ToastProvider><Sales /></ToastProvider>);

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, "", "/v2/staff/sales");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("منطق الشاشة", () => {
  it("القناة الثابتة حسب الدور", () => {
    expect(fixedChannel("online_seller")).toBe("website");
    expect(fixedChannel("offline_seller")).toBe("direct");
    expect(fixedChannel("sales_manager")).toBeNull();
    expect(fixedChannel("chairman")).toBeNull();
  });
  it("مسار الفاتورة: اللي خلص والحالي والجاي", () => {
    const items = flowItems({ status: "confirmed", createdAt: "2026-10-01T08:00:00Z", updatedAt: "2026-10-02T08:00:00Z" });
    expect(items.map((i) => i.tone)).toEqual(["success", "brand", "neutral", "neutral"]);
    expect(flowItems({ status: "cancelled" }).map((i) => i.tone)).toEqual(["success", "danger"]);
    expect(flowItems({ status: "pending_approval" }).map((i) => i.tone)).toEqual(["success", "warn"]);
  });
});

describe("Sales — القايمة", () => {
  it("بتعرض الفواتير والعملاء وأعداد الحالات والمؤشرات", async () => {
    login("sales_manager");
    setup();
    mount();
    expect(await screen.findByText("INV-1")).toBeTruthy();
    expect(screen.getByText("INV-2")).toBeTruthy();
    expect((await screen.findAllByText("شركة النور")).length).toBeGreaterThan(0);
    expect(screen.getByText("من غير عميل")).toBeTruthy();
    expect(screen.getByText("المدفوع")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^مسودة/ }).getAttribute("aria-pressed")).toBe("false");
  });

  it("بائع الأونلاين: القناة ثابتة، مفيش تابات ولا زر إنشاء", async () => {
    login("online_seller");
    const calls = setup();
    mount();
    await screen.findByText("INV-1");
    expect(calls.find((c) => c.path === "/api/v1/sales")!.query.get("channel")).toBe("website");
    expect(screen.queryByRole("button", { name: "فاتورة جديدة" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "أوفلاين" })).toBeNull();
  });

  it("المدير: بيبدّل القناة من التابات والطلب بيتبعت بيها", async () => {
    login("chairman");
    const calls = setup();
    mount();
    await screen.findByText("INV-1");
    expect(calls.find((c) => c.path === "/api/v1/sales")!.query.get("channel")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "أونلاين" }));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/v1/sales" && c.query.get("channel") === "website")).toBe(true));
    expect(screen.queryByRole("button", { name: "فاتورة جديدة" })).toBeNull();
  });

  it("فلتر الحالة بيتبعت للسيرفر", async () => {
    login("sales_manager");
    const calls = setup();
    mount();
    await screen.findByText("INV-1");
    fireEvent.click(screen.getByRole("button", { name: /^اتدفعت/ }));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/v1/sales" && c.query.get("status") === "paid")).toBe(true));
  });

  it("فشل التحميل: رسالة وزر إعادة المحاولة", async () => {
    login("sales_manager");
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { message: "x" } }, 403)));
    mount();
    expect(await screen.findByText("ماقدرناش نحمّل الفواتير.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "حاول تاني" })).toBeTruthy();
  });
});

describe("Sales — تفاصيل الفاتورة وتغيير الحالة", () => {
  it("بيفتح التفاصيل بالبنود، وتأكيد الحالة بيعرض أثر المخزون وبعدها بيبعت PATCH", async () => {
    login("sales_manager");
    const calls = setup();
    mount();
    fireEvent.click(await screen.findByText("INV-1"));
    expect(await screen.findByText("كرتونة كبيرة")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "أكّد الفاتورة" }));
    expect(await screen.findByText(/الكميات هتتحجز للفاتورة دي/)).toBeTruthy();
    const confirm = screen.getAllByRole("button", { name: "أكّد الفاتورة" }).at(-1)!;
    fireEvent.click(confirm);
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH" && c.path === "/api/v1/sales/1" && c.body.status === "confirmed")).toBe(true));
  });

  it("فاتورة أونلاين: مفيش تعديل، وبائع الأونلاين مفيش مسح", async () => {
    login("online_seller");
    setup({ detail: { channel: "website" } });
    mount();
    fireEvent.click(await screen.findByText("INV-1"));
    await screen.findByText("كرتونة كبيرة");
    expect(screen.getByText(/فاتورة أونلاين: بتتعمل وتتحدّث من البوابة/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "المزيد" }));
    expect(screen.queryByRole("menuitem", { name: "عدّل" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "امسح" })).toBeNull();
  });

  it("المنتظرة للاعتماد: تنبيه ومفيش زر خطوة جاية", async () => {
    login("sales_manager");
    setup({ detail: { status: "pending_approval" } });
    mount();
    fireEvent.click(await screen.findByText("INV-1"));
    expect(await screen.findByText(/منتظرة قرار الاعتماد، ومش هتتعدّل/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "أكّد الفاتورة" })).toBeNull();
  });
});

describe("Sales — إنشاء فاتورة", () => {
  it("بيرفض فاتورة من غير بنود ومبيبعتش حاجة", async () => {
    login("offline_seller");
    const calls = setup();
    mount();
    await screen.findByText("INV-1");
    fireEvent.click(screen.getByRole("button", { name: "فاتورة جديدة" }));
    fireEvent.click(await screen.findByRole("button", { name: "احفظ الفاتورة" }));
    expect(await screen.findByText("ضيف بند واحد على الأقل")).toBeTruthy();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("بند يدوي: بيتبعت POST كمسودة بالإجمالي المحسوب", async () => {
    login("offline_seller");
    const calls = setup();
    mount();
    await screen.findByText("INV-1");
    fireEvent.click(screen.getByRole("button", { name: "فاتورة جديدة" }));
    const dlg = await screen.findByRole("dialog", { name: /فاتورة أوفلاين جديدة/ });
    fireEvent.click(within(dlg).getByRole("button", { name: "إضافة بند يدوي" }));
    fireEvent.input(within(dlg).getByLabelText(/وصف البند/), { target: { value: "خدمة نقل" } });
    fireEvent.input(within(dlg).getByLabelText(/الكمية/), { target: { value: "2" } });
    fireEvent.input(within(dlg).getByLabelText(/سعر الوحدة/), { target: { value: "10.5" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "احفظ الفاتورة" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/v1/sales")).toBe(true));
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body.status).toBe("draft");
    expect(post.body.total).toBe("21.00");
    expect(post.body.items).toEqual([{ inventoryItemId: null, description: "خدمة نقل", qty: "2", unitPrice: "10.5", total: "21.00" }]);
    expect(post.body.orderNumber).toMatch(/^INV-\d{4}-\d{6}$/);
  });

  it("بند من المخزون: بيتبعت بسعر 0 (السيرفر بياخد سعر الصنف)", async () => {
    login("offline_seller");
    const calls = setup();
    mount();
    await screen.findByText("INV-1");
    fireEvent.click(screen.getByRole("button", { name: "فاتورة جديدة" }));
    const dlg = await screen.findByRole("dialog", { name: /فاتورة أوفلاين جديدة/ });
    fireEvent.click(within(dlg).getByRole("button", { name: "إضافة صنف من المخزون" }));
    await waitFor(() => expect(within(dlg).getByRole("option", { name: /كرتونة كبيرة/ })).toBeTruthy());
    fireEvent.change(within(dlg).getByLabelText(/اختار الصنف/), { target: { value: "3" } });
    fireEvent.input(within(dlg).getByLabelText(/الكمية/), { target: { value: "4" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "احفظ الفاتورة" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")!.body.items).toEqual([{ inventoryItemId: 3, description: "كرتونة كبيرة", qty: "4", unitPrice: "0", total: "0.00" }]);
  });
});
