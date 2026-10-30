import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../design/components";
import { Tasks } from "./Tasks";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const iso = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const row = (o: Record<string, unknown> = {}) => ({
  id: 1, kind: "general", title: "اتصل بالعميل أحمد", description: "متابعة الطلب", status: "open", priority: "normal", assigneeUserId: 5, assigneeRole: null,
  escalateToRole: "executive_manager", dueAt: iso(-2), escalationLevel: 0, createdBy: 1, completedAt: null, resultNote: null, createdAt: iso(-30), ...o,
});
const ROWS = [row(), row({ id: 2, title: "راجع فاتورة المورد", dueAt: iso(48), priority: "high" })];

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
function stub(detailStatus = "open") {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const key = `${method} ${url.split("?")[0]!.replace("/api/v1", "")}`;
    if (key === "GET /tasks") return json({ data: ROWS });
    if (key === "GET /tasks/1") return json({ data: { task: row({ status: detailStatus, escalationLevel: 1 }), events: [{ id: 1, event: "created", actorUserId: 1, detail: "اتنشأت", createdAt: iso(-30) }, { id: 2, event: "escalated_l1", actorUserId: null, detail: "عدّى الموعد", createdAt: iso(-1) }] } });
    if (method === "POST") return json({ data: row({ status: "done" }) });
    return json({ data: {} });
  }));
}
function login(role: string, id = 5) {
  sessionStorage.setItem("hyper_erp_session", JSON.stringify({ token: "t", user: { id, username: "u", fullName: "مستخدم", role } }));
}
const mount = () => render(<ToastProvider><Tasks /></ToastProvider>);
beforeEach(() => {
  sessionStorage.clear();
  history.replaceState(null, "", "/v2/staff/tasks");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("المهام", () => {
  it("بتعرض المهام والمتأخرة بتتعلّم وبتتعدّ", async () => {
    login("buyer");
    stub();
    mount();
    expect(await screen.findByText("اتصل بالعميل أحمد")).toBeTruthy();
    expect(screen.getByText("راجع فاتورة المورد")).toBeTruthy();
    expect(screen.getAllByText("متأخرة").length).toBeGreaterThan(0);
  });

  it("الموظف العادي ما بيشوفش تبويب مهام الفريق، والمدير بيشوفه", async () => {
    login("buyer");
    stub();
    mount();
    await screen.findByText("اتصل بالعميل أحمد");
    expect(screen.queryByRole("tab", { name: "مهام الفريق" })).toBeNull();
    cleanup();
    login("sales_manager", 9);
    stub();
    mount();
    expect(await screen.findByRole("tab", { name: "مهام الفريق" })).toBeTruthy();
  });

  it("فتح مهمة بيعرض سجلها بالتصعيد، والتنفيذ بيطلب نتيجة ثم بيبعتها", async () => {
    login("buyer");
    stub();
    mount();
    fireEvent.click(await screen.findByText("اتصل بالعميل أحمد"));
    expect(await screen.findByText("تصعيد مستوى 1: تم تنبيه المسؤول ومديره")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "تم التنفيذ" }));
    fireEvent.click(screen.getByRole("button", { name: "سجّل التنفيذ" }));
    expect(await screen.findByText("اكتب كلمتين على الأقل.")).toBeTruthy();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.input(screen.getByLabelText(/اكتب نتيجة التنفيذ/), { target: { value: "اتصلت وتم الاتفاق" } });
    fireEvent.click(screen.getByRole("button", { name: "سجّل التنفيذ" }));
    await waitFor(() => expect(calls.find((c) => c.method === "POST")?.url).toContain("/tasks/1/complete"));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ note: "اتصلت وتم الاتفاق" });
  });

  it("موظف مش مسؤول عن المهمة ما بيشوفش أزرار التنفيذ", async () => {
    login("storekeeper", 77);
    stub();
    mount();
    fireEvent.click(await screen.findByText("اتصل بالعميل أحمد"));
    await screen.findByText("سجل المهمة");
    expect(screen.queryByRole("button", { name: "تم التنفيذ" })).toBeNull();
    expect(screen.queryByRole("button", { name: "نقل لدور تاني" })).toBeNull();
  });

  it("المهمة المنتهية ما فيهاش أزرار إجراءات", async () => {
    login("buyer");
    stub("done");
    mount();
    fireEvent.click(await screen.findByText("اتصل بالعميل أحمد"));
    await screen.findByText("سجل المهمة");
    expect(screen.queryByRole("button", { name: "تم التنفيذ" })).toBeNull();
  });

  it("مهمة جديدة: بتتحقق من العنوان وبعدين بتبعت مهمة لنفسي", async () => {
    login("buyer");
    stub();
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "مهمة جديدة" }));
    fireEvent.click(await screen.findByRole("button", { name: "أنشئ المهمة" }));
    expect(await screen.findByText("اكتب عنوان المهمة (حرفين على الأقل).")).toBeTruthy();
    // بنبحث جوه النافذة بس: خانة البحث في الصفحة اسمها كمان فيه «عنوان المهمة»
    fireEvent.input(within(screen.getByRole("dialog")).getByLabelText(/عنوان المهمة/), { target: { value: "راجع الجرد" } });
    fireEvent.click(screen.getByRole("button", { name: "أنشئ المهمة" }));
    await waitFor(() => expect(calls.find((c) => c.method === "POST")?.url).toMatch(/\/tasks$/));
    expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({ title: "راجع الجرد", assigneeUserId: 5 });
  });
});
