import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../design/components";
import { Contacts } from "./Contacts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const base = { company: null, email: null, address: null, notes: null, ownerUserId: null, createdAt: "2026-10-01T00:00:00Z", segment: null };
const ROWS = [
  { ...base, id: 1, type: "customer", name: "أحمد للتجارة", phone: "01001234567", city: "القاهرة", salesCount: 3, poCount: 0 },
  { ...base, id: 2, type: "supplier", name: "مورد الخامات", phone: "01222334444", city: "الجيزة", salesCount: 0, poCount: 2 },
];

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
function stub(opts: { dup?: boolean } = {}) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const key = `${method} ${url.split("?")[0]!.replace("/api/v1", "")}`;
    if (key === "GET /contacts/overview") return json({ data: ROWS });
    if (key === "GET /contacts/duplicate-check") return json({ data: { matches: opts.dup ? [{ id: 1, name: "أحمد للتجارة", company: null, phone: "01001234567" }] : [] } });
    if (/^GET \/contacts\/\d+\/activity$/.test(key)) return json({ data: { sales: [{ id: 9, orderNumber: "INV-9", status: "confirmed", total: "1500.00", date: "2026-10-05" }], purchases: [{ id: 4, poNumber: "PO-000004", status: "approved", createdAt: "2026-10-06T10:00:00Z" }] } });
    if (method === "POST" && key === "POST /contacts") return json({ data: { id: 7 } }, 201);
    return json({ data: {} });
  }));
}
function login(role: string) {
  sessionStorage.setItem("hyper_erp_session", JSON.stringify({ token: "t", user: { id: 1, username: "u", fullName: "مستخدم", role } }));
}
const mount = () => render(<ToastProvider><Contacts /></ToastProvider>);
beforeEach(() => {
  sessionStorage.clear();
  history.replaceState(null, "", "/v2/staff/contacts");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("الموردون والعملاء", () => {
  it("بيعرض الجهات والأعداد، وتبويب الموردين بيفلتر", async () => {
    login("sales_manager");
    stub();
    mount();
    expect(await screen.findByText("أحمد للتجارة")).toBeTruthy();
    expect(screen.getByText("مورد الخامات")).toBeTruthy();
    expect(screen.getByText("إجمالي جهات الاتصال")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /الموردون/ }));
    await waitFor(() => expect(screen.queryByText("أحمد للتجارة")).toBeNull());
    expect(screen.getByText("مورد الخامات")).toBeTruthy();
  });

  it("الدرج بيعرض روابط الاتصال والواتساب وآخر الفواتير", async () => {
    login("sales_manager");
    stub();
    mount();
    fireEvent.click(await screen.findByText("أحمد للتجارة"));
    expect(await screen.findByText("INV-9")).toBeTruthy();
    const wa = (await screen.findByRole("link", { name: /ابعت واتساب/ })) as HTMLAnchorElement;
    expect(wa.href).toBe("https://wa.me/201001234567");
    expect(screen.getByRole("button", { name: "عدّل" })).toBeTruthy();
  });

  it("المدير التنفيذي بيشوف بس: من غير إضافة ولا تعديل", async () => {
    login("executive_manager");
    stub();
    mount();
    fireEvent.click(await screen.findByText("أحمد للتجارة"));
    await screen.findByText("INV-9");
    expect(screen.queryByRole("button", { name: "جهة اتصال جديدة" })).toBeNull();
    expect(screen.queryByRole("button", { name: "عدّل" })).toBeNull();
  });

  it("إضافة جهة اتصال بتبعت POST بالقيم المقصوصة", async () => {
    login("sales_manager");
    stub();
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "جهة اتصال جديدة" }));
    fireEvent.input(await screen.findByLabelText(/الاسم التجاري/), { target: { value: " شركة الفجر " } });
    fireEvent.click(screen.getByRole("button", { name: "احفظ" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/contacts"))).toBe(true));
    expect(calls.find((c) => c.method === "POST")!.body).toMatchObject({ type: "customer", name: "شركة الفجر", phone: null });
  });

  it("الاسم الفاضي بيتمنع قبل الإرسال", async () => {
    login("sales_manager");
    stub();
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "جهة اتصال جديدة" }));
    fireEvent.click(await screen.findByRole("button", { name: "احفظ" }));
    expect(await screen.findByText("اكتب الاسم")).toBeTruthy();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("تحذير التكرار: الحفظ بيطلب تأكيد تاني قبل ما يبعت", async () => {
    login("sales_manager");
    stub({ dup: true });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "جهة اتصال جديدة" }));
    fireEvent.input(await screen.findByLabelText(/الاسم التجاري/), { target: { value: "أحمد" } });
    fireEvent.input(screen.getByRole("textbox", { name: /^التليفون/ }), { target: { value: "0100 123 4567" } });
    expect(await screen.findByText("ممكن تكون مكررة", {}, { timeout: 2000 })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "احفظ" }));
    const again = await screen.findByRole("button", { name: "فهمت، اضيفها برضه" });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.click(again);
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/contacts"))).toBe(true));
  });
});
