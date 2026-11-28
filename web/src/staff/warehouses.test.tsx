import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../design/components";
import { Warehouses } from "./Warehouses";
import { Sidebar } from "./Sidebar";
import type { NavResponse } from "./nav";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const LIST = {
  kinds: ["raw"], canManage: true,
  items: [
    { id: 1, code: "WH-RAW", name: "مخزن الخامات", kind: "raw", isDefault: true, active: true, notes: null, itemsCount: 2, keepers: [] },
    { id: 5, code: "WH-RAW-5", name: "B1", kind: "raw", isDefault: false, active: true, notes: null, itemsCount: 1, keepers: [{ userId: 9, name: "أمين ١" }] },
  ],
};
const ROWS = [
  { itemId: 1, itemName: "حبيبات", unit: "كجم", minQty: "10", qty: "100", reserved: "10", warehouseId: 1, warehouseName: "مخزن الخامات" },
  { itemId: 1, itemName: "حبيبات", unit: "كجم", minQty: "10", qty: "40", reserved: "0", warehouseId: 5, warehouseName: "B1" },
];
type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
function stub(role = "chairman") {
  calls = [];
  sessionStorage.setItem("hyper_erp_session", JSON.stringify({ token: "t", user: { id: 1, username: "u", fullName: "م", role } }));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const key = `${method} ${url.split("?")[0]!.replace("/api/v1", "")}`;
    if (key === "GET /warehouses") return json({ data: LIST });
    if (key === "GET /warehouses/stock") return json({ data: { kind: "raw", mode: "separate", warehouses: [], rows: ROWS } });
    if (key === "POST /warehouses") return json({ data: { id: 8, name: "B2" } }, 201);
    return json({ data: {} });
  }));
}
const go = (q: string) => history.replaceState(null, "", `/v2/staff/warehouses${q}`);
const mount = () => render(<ToastProvider><Warehouses /></ToastProvider>);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});
beforeEach(() => go(""));

describe("شاشة المخازن", () => {
  it("نوع مجهول بيعرض «مش متاح» من غير نداء للسيرفر على الأصناف", async () => {
    stub();
    go("?kind=zzz");
    mount();
    expect((await screen.findAllByText(/مش متاح/)).length).toBeGreaterThan(0);
    expect(calls.some((c) => c.url.includes("/warehouses/stock"))).toBe(false);
  });

  it("نوع مش مسموح للدور بيعرض «مش متاح»", async () => {
    stub("production_manager");
    go("?kind=finished&wh=all");
    mount();
    await waitFor(() => expect(screen.getAllByText(/مش متاح/).length).toBeGreaterThan(0));
  });

  it("بيعرض أصناف النوع بعمود المخزن وزرار مخزن جديد للمدير", async () => {
    stub();
    go("?kind=raw&wh=all");
    mount();
    expect((await screen.findAllByText("حبيبات")).length).toBe(2);
    expect(screen.getAllByText("B1").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /مخزن جديد/ })).toBeTruthy();
  });

  it("أمين/مشتريات من غير صلاحية إدارة مايشوفوش زرار مخزن جديد", async () => {
    stub("buyer");
    calls = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const key = String(input).split("?")[0]!.replace("/api/v1", "");
      if (key === "/warehouses") return json({ data: { ...LIST, canManage: false } });
      return json({ data: { kind: "raw", mode: "separate", warehouses: [], rows: ROWS } });
    }));
    go("?kind=raw&wh=all");
    mount();
    await screen.findAllByText("حبيبات");
    expect(screen.queryByRole("button", { name: /مخزن جديد/ })).toBeNull();
  });

  it("العرض المجمّع بيطلب mode=combined", async () => {
    stub();
    go("?kind=raw&wh=all");
    mount();
    await screen.findAllByText("حبيبات");
    fireEvent.click(screen.getByRole("button", { name: "مجمّع" }));
    await waitFor(() => expect(calls.some((c) => c.url.includes("mode=combined"))).toBe(true));
  });

  it("مخزن واحد بيطلب warehouseId ويعرض الأمين", async () => {
    stub();
    go("?kind=raw&wh=5");
    mount();
    await waitFor(() => expect(calls.some((c) => c.url.includes("warehouseId=5"))).toBe(true));
    expect((await screen.findAllByText(/أمين ١/)).length).toBeGreaterThan(0);
  });

  it("إنشاء مخزن بيبعت النوع والاسم", async () => {
    stub();
    go("?kind=raw&wh=all&new=1");
    mount();
    const input = await screen.findByLabelText(/اسم المخزن/);
    fireEvent.input(input, { target: { value: "B2" } });
    fireEvent.click(screen.getByRole("button", { name: "إنشاء المخزن" }));
    await waitFor(() => expect(calls.find((c) => c.method === "POST" && c.url.endsWith("/warehouses"))?.body).toMatchObject({ kind: "raw", name: "B2" }));
  });

  it("الاسم الفاضي ماينبعتش", async () => {
    stub();
    go("?kind=raw&wh=all&new=1");
    mount();
    await screen.findByLabelText(/اسم المخزن/);
    fireEvent.click(screen.getByRole("button", { name: "إنشاء المخزن" }));
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });
});

describe("السايدبار: إدارة المخازن", () => {
  const nav: NavResponse = {
    role: "chairman", singleDepartment: false, homeHref: null,
    departments: [{ id: "warehouse-mgmt", label: "إدارة المخازن", icon: "warehouse", subFunctions: [
      { id: "wh-raw", label: "مخازن الخامات", collapsible: true, pages: [
        { id: "wh-raw-all", label: "كل مخازن الخامات", href: "/v2/staff/warehouses?kind=raw&wh=all" },
        { id: "wh-5", label: "B1", href: "/v2/staff/warehouses?kind=raw&wh=5" },
      ] },
      { id: "wh-wip", label: "مخازن تحت التشغيل", collapsible: true, pages: [{ id: "wh-wip-all", label: "كل مخازن تحت التشغيل", href: "/v2/staff/warehouses?kind=wip&wh=all" }] },
    ] }],
  };
  it("الأنواع قوايم مطوية، والنوع اللي فيه الصفحة الحالية بس هو المفتوح", () => {
    go("?kind=raw&wh=5");
    const { container } = render(<Sidebar nav={nav} path="/staff/warehouses" collapsed={false} openDept="warehouse-mgmt" onToggleDept={() => undefined} />);
    const folds = container.querySelectorAll("details.st-sub--fold");
    expect(folds).toHaveLength(2);
    expect((folds[0] as HTMLDetailsElement).open).toBe(true);
    expect((folds[1] as HTMLDetailsElement).open).toBe(false);
    expect(screen.getByText("B1")).toBeTruthy();
  });
});
