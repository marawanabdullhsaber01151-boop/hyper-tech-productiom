import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalize, scoreMatch } from "./arabicSearch";
import { emptyState, notificationTarget, pageItems, pickPage, pushRecent, readRecent, recordItems, search, type CmdItem } from "./commands";
import { CommandPalette } from "./CommandPalette";
import { computeMyActions } from "./myActions";
import { NotificationCenter } from "./NotificationCenter";
import { getShared, invalidateShared } from "./sharedData";
import type { InvItem, WorkflowOrder } from "./dashboardCore";
import type { NavResponse } from "./nav";

const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("../app/router", async (orig) => ({ ...(await orig<typeof import("../app/router")>()), navigate: nav.navigate }));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const log: string[] = [];
/** بنحاكي السيرفر على مستوى fetch (العميل الحقيقي بيفك غلاف { data } زي الإنتاج). */
const serve = (handler: (path: string, method: string) => unknown) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const full = String(url).replace("/api/v1", "");
      log.push(`${init?.method ?? "GET"} ${full}`);
      const r = handler(full.split("?")[0]!, init?.method ?? "GET");
      return r instanceof Response ? r : json(r === undefined ? { data: {} } : r);
    }),
  );
const login = (id: number, role: string) => sessionStorage.setItem("hyper_erp_session", JSON.stringify({ token: "t", user: { id, username: "u", fullName: "م", role } }));

const NAV: NavResponse = {
  role: "chairman",
  singleDepartment: false,
  homeHref: "production.html",
  departments: [
    {
      id: "top",
      label: "الإدارة العليا",
      icon: "landmark",
      subFunctions: [
        {
          id: "gov",
          label: "الحوكمة",
          pages: [
            { id: "customers", label: "عملاء البوابة", href: "/v2/admin/portal-customers" },
            { id: "prod", label: "الإنتاج", href: "production.html" },
            { id: "stock", label: "المخزون", href: "/v2/staff/stock" },
          ],
        },
      ],
    },
  ],
};
const po = (o: Partial<WorkflowOrder> & { id: number }): WorkflowOrder => ({ orderNumber: `PO-${o.id}`, productName: "كوب ورق", qty: "100", workflowStatus: "in_production", ...o });
const inv = (o: Partial<InvItem> & { id: number }): InvItem => ({ name: `صنف ${o.id}`, unit: "كجم", qty: "50", minQty: "10", category: "raw_material", ...o });

beforeEach(() => {
  log.length = 0;
  nav.navigate.mockClear();
  sessionStorage.clear();
  localStorage.clear();
  invalidateShared();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("البحث العربي", () => {
  it("الهمزات والتاء المربوطة والتشكيل والأرقام الهندية ما بتفرقش", () => {
    expect(normalize("أَحْمَد")).toBe(normalize("احمد"));
    expect(normalize("مؤسسة")).toBe(normalize("موسسه"));
    expect(normalize("أمر ٢٣")).toBe("امر 23");
    expect(scoreMatch("ماده", "مادة خام")).toBeGreaterThan(0);
  });
  it("الترتيب: مطابق تمامًا ثم بداية ثم كلمة ثم جزء ثم حروف بالترتيب، وكل الكلمات لازم تتطابق", () => {
    const s = (q: string, x: string) => scoreMatch(q, x);
    expect(s("مخزون", "مخزون")).toBe(100);
    expect(s("مخ", "مخزون الخام")).toBeGreaterThan(s("الخ", "مخزون الخام"));
    expect(s("الخ", "مخزون الخام")).toBeGreaterThan(s("زون", "مخزون الخام"));
    expect(s("زون", "مخزون الخام")).toBeGreaterThan(s("مزن", "مخزون الخام"));
    expect(s("مزن", "مخزون الخام")).toBeGreaterThan(0);
    expect(s("مخزون خام", "مخزون الخام")).toBeGreaterThan(0);
    expect(s("مخزون قماش", "مخزون الخام")).toBe(0);
    expect(s("xyz", "مخزون")).toBe(0);
  });
});

describe("عناصر لوحة الأوامر", () => {
  const go = vi.fn();
  it("صفحات القايمة بس، وبمسارها الوظيفي", () => {
    const pages = pageItems(NAV, go);
    expect(pages.map((p) => p.title)).toEqual(["عملاء البوابة", "الإنتاج", "المخزون"]);
    expect(pages[0]!.hint).toBe("الإدارة العليا › الحوكمة");
    pages[0]!.run();
    expect(go).toHaveBeenCalledWith("/v2/admin/portal-customers");
  });
  it("السجلات: مفيش نتيجة من غير صفحة في قايمة المستخدم تفتحها", () => {
    const label = { status: (s: string) => s, unit: (i: InvItem) => i.unit ?? "" };
    const none = recordItems([po({ id: 1 })], [inv({ id: 1 })], new Set(["x.html"]), go, label);
    expect(none).toEqual([]);
    const some = recordItems([po({ id: 1 })], [inv({ id: 1, name: "ورق A4" })], new Set(["production.html", "v2/staff/stock"]), go, label);
    expect(some.map((x) => x.kind)).toEqual(["order", "item"]);
    some[1]!.run();
    expect(go).toHaveBeenLastCalledWith(`/v2/staff/stock?q=${encodeURIComponent("ورق A4")}`);
    expect(pickPage(new Set(["factory-supervisor.html"]), ["production.html", "factory-supervisor.html"])).toBe("factory-supervisor.html");
  });
  it("البحث متسامح، والأخيرة بتتقدّم عند تساوي الدرجة، والشاشة الفاضية بتبدأ بالأخيرة", () => {
    const mk = (id: string, title: string): CmdItem => ({ id, kind: "page", title, run: () => {} });
    const all = [mk("a", "إدارة المخزون"), mk("b", "ادارة المبيعات"), mk("c", "الإنتاج")];
    expect(search(all, "اداره", []).map((x) => x.id)).toEqual(["a", "b"]);
    expect(search(all, "اداره", ["b"]).map((x) => x.id)[0]).toBe("b");
    expect(emptyState(all, ["c"]).map((x) => x.id)[0]).toBe("c");
  });
  it("الأخيرة: لكل مستخدم، من غير تكرار، وبحد أقصى 8", () => {
    for (let i = 0; i < 12; i++) pushRecent(1, `page:${i}`);
    pushRecent(1, "page:11");
    expect(readRecent(1)).toHaveLength(8);
    expect(readRecent(1)[0]).toBe("page:11");
    expect(readRecent(2)).toEqual([]);
    localStorage.setItem("hyper_cmdk_recent_v1:3", "{bad");
    expect(readRecent(3)).toEqual([]);
  });
  it("هدف الإشعار", () => {
    expect(notificationTarget({ referenceType: "chat_conversation", referenceId: 9 }, NAV)).toBe("/v2/admin/portal-chat/9");
    expect(notificationTarget({ referenceType: "chat" }, NAV)).toBe("/v2/admin/portal-chat");
    expect(notificationTarget({ referenceType: "system_health" }, NAV)).toBe("/v2/staff/system-health");
    expect(notificationTarget({ referenceType: "production_workflow" }, NAV)).toBe("production.html");
    expect(notificationTarget({ referenceType: "other" }, NAV)).toBeNull();
  });
});

describe("مطلوب مني", () => {
  const orders = [po({ id: 1, workflowStatus: "new" }), po({ id: 2, workflowStatus: "materials_requested" }), po({ id: 3, workflowStatus: "delivery_pending_warehouse" }), po({ id: 4, workflowStatus: "in_production", supervisorId: 7 }), po({ id: 5, workflowStatus: "quality_check", qualityControllerUserId: 8 })];
  it("كل دور بيشوف خطوته بس", () => {
    expect(computeMyActions(orders, { id: 1, role: "production_manager" }).map((a) => a.order.id)).toEqual([1]);
    expect(computeMyActions(orders, { id: 1, role: "warehouse_manager" }).map((a) => [a.order.id, a.kind])).toEqual([[2, "decideMaterials"], [3, "confirmWarehouseReceipt"]]);
    expect(computeMyActions(orders, { id: 7, role: "supervisor" }).map((a) => a.order.id)).toEqual([4]);
    expect(computeMyActions(orders, { id: 9, role: "supervisor" })).toEqual([]);
    expect(computeMyActions(orders, { id: 8, role: "production_quality_controller" }).map((a) => a.order.id)).toEqual([5]);
    expect(computeMyActions(orders, { id: 1, role: "chairman" }).map((a) => a.order.id)).toEqual([1, 2, 3]);
    expect(computeMyActions(orders, { id: 1, role: "storekeeper" })).toEqual([]);
  });
});

describe("الكاش المشترك", () => {
  it("بيدمج الطلبات المتزامنة، وبيحترم المدة، وبيتمسح، ومفصول لكل مستخدم، والفشل ما يتخزّنش", async () => {
    login(1, "chairman");
    let n = 0;
    serve(() => ({ data: [{ n: ++n }] }));
    const [a, b] = await Promise.all([getShared<Array<{ n: number }>>("/x"), getShared<Array<{ n: number }>>("/x")]);
    expect(a).toEqual(b);
    expect(log).toHaveLength(1);
    await getShared("/x");
    expect(log).toHaveLength(1);
    invalidateShared("/x");
    await getShared("/x");
    expect(log).toHaveLength(2);
    login(2, "chairman");
    await getShared("/x");
    expect(log).toHaveLength(3);
    invalidateShared();
    serve(() => json({ error: { code: "X", message: "x" } }, 403));
    await expect(getShared("/y")).rejects.toBeTruthy();
    serve(() => ({ data: { ok: 1 } }));
    expect(await getShared("/y")).toEqual({ ok: 1 });
  });
});

describe("CommandPalette", () => {
  const access = { can: { productionWorkflowRead: true, inventoryRead: true } };
  const open = () => render(<CommandPalette open onClose={() => {}} nav={NAV} extra={[]} />);
  it("بيدوّر في الصفحات، وEnter بيفتح الأولى، والأسهم بتنقل", async () => {
    login(1, "chairman");
    serve((p) => (p === "/me/access" ? { data: access } : { data: [] }));
    open();
    const box = await screen.findByRole("combobox");
    fireEvent.input(box, { target: { value: "عملاء" } });
    const opts = await screen.findAllByRole("option");
    expect(opts[0]!.textContent).toContain("عملاء البوابة");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(nav.navigate).toHaveBeenCalledWith("/admin/portal-customers");
    expect(readRecent(1)).toContain("page:v2/admin/portal-customers");
  });
  it("الأسهم: بتتحرك لدايرة، وaria-activedescendant بيتبع", async () => {
    login(1, "chairman");
    serve((p) => (p === "/me/access" ? { data: access } : { data: [] }));
    open();
    const box = await screen.findByRole("combobox");
    const first = box.getAttribute("aria-activedescendant");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    await waitFor(() => expect(box.getAttribute("aria-activedescendant")).not.toBe(first));
    fireEvent.keyDown(box, { key: "ArrowUp" });
    await waitFor(() => expect(box.getAttribute("aria-activedescendant")).toBe(first));
  });
  it("أوامر الإنتاج والأصناف بتظهر بحسب الصلاحية، ورقم الأمر بيلاقيه، والصنف بيفتح المخزون بالبحث", async () => {
    login(1, "chairman");
    serve((p) => (p === "/me/access" ? { data: access } : p === "/production-workflow" ? { data: [po({ id: 77 })], stats: {} } : { data: [inv({ id: 3, name: "ورق A4" })] }));
    open();
    const box = await screen.findByRole("combobox");
    fireEvent.input(box, { target: { value: "po 77" } });
    expect((await screen.findByRole("option", { name: /PO-77/ })).textContent).toContain("قيد التنفيذ");
    fireEvent.input(box, { target: { value: "ورق" } });
    fireEvent.click(await screen.findByRole("option", { name: /ورق A4/ }));
    expect(nav.navigate).toHaveBeenCalledWith(`/staff/stock?q=${encodeURIComponent("ورق A4")}`);
  });
  it("من غير صلاحية: مبينادش السجلات خالص، وبدون نتيجة بيقول كده", async () => {
    login(1, "storekeeper");
    serve((p) => (p === "/me/access" ? { data: { can: { productionWorkflowRead: false, inventoryRead: false } } } : { data: [] }));
    open();
    const box = await screen.findByRole("combobox");
    fireEvent.input(box, { target: { value: "zzzz" } });
    expect(await screen.findByText(/مفيش نتيجة/)).toBeTruthy();
    await waitFor(() => expect(log.some((l) => l.includes("/inventory") || l.includes("/production-workflow"))).toBe(false));
  });
});

describe("NotificationCenter", () => {
  const notes = [
    { id: 11, title: "رسالة جديدة", body: "عميل بيسأل", isRead: false, createdAt: new Date().toISOString(), referenceType: "chat_conversation", referenceId: 9 },
    { id: 12, title: "أمر اتحرّك", body: "PO-1", isRead: true, createdAt: new Date().toISOString(), referenceType: "production_workflow", referenceId: 1 },
  ];
  const server = (p: string) => {
    if (p === "/notifications/unread-count") return { count: 1 };
    if (p === "/notifications") return { data: notes };
    if (p === "/me/access") return { data: { can: { productionWorkflowRead: true } } };
    if (p === "/production-workflow") return { data: [po({ id: 2, workflowStatus: "materials_requested" })], stats: {} };
    return { data: {} };
  };
  it("العدّاد بيجمع «مطلوب مني» والإشعارات الجديدة، وبيعرض تفاصيل الأمر", async () => {
    login(5, "warehouse_manager");
    serve(server);
    render(<NotificationCenter nav={NAV} />);
    expect(await screen.findByText("2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /الإشعارات/ }));
    expect(await screen.findByText("PO-2 — كوب ورق")).toBeTruthy();
    expect(screen.getByText("مستني قرارك في المواد")).toBeTruthy();
  });
  it("دور من غير قايمة: مبيطلبش أوامر الإنتاج", async () => {
    login(5, "storekeeper");
    serve(server);
    render(<NotificationCenter nav={NAV} />);
    expect(await screen.findByText("1")).toBeTruthy();
    expect(log.some((l) => l.includes("/production-workflow"))).toBe(false);
  });
  it("إشعار الشات: بيتعلّم مقروء وبيفتح المحادثة من غير ما يستنى السيرفر", async () => {
    login(5, "chairman");
    serve(server);
    render(<NotificationCenter nav={NAV} />);
    fireEvent.click(await screen.findByRole("button", { name: /الإشعارات/ }));
    fireEvent.click(await screen.findByRole("tab", { name: /الإشعارات/ }));
    fireEvent.click(await screen.findByText("رسالة جديدة"));
    await waitFor(() => expect(log).toContain("PATCH /notifications/11/read"));
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith("/admin/portal-chat/9"));
  });
  it("علّم الكل مقروء", async () => {
    login(5, "storekeeper");
    serve(server);
    render(<NotificationCenter nav={NAV} />);
    fireEvent.click(await screen.findByRole("button", { name: /الإشعارات/ }));
    fireEvent.click(await screen.findByRole("tab", { name: /الإشعارات/ }));
    fireEvent.click(await screen.findByRole("button", { name: "علّم الكل مقروء" }));
    await waitFor(() => expect(log).toContain("PATCH /notifications/read-all"));
  });
});
