import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "./Dashboard";
import { categoryShares, computeKpis, deriveAlerts, isKnownStatus, statusCounts, statusTone, type InvItem, type WorkflowOrder } from "./dashboardCore";
import type { NavResponse } from "./nav";
import { invalidateShared } from "./sharedData";

const NOW = new Date("2026-10-22T10:00:00Z");
const po = (o: Partial<WorkflowOrder> & { id: number }): WorkflowOrder => ({ orderNumber: `PO-${o.id}`, productName: "كوب", qty: "100", workflowStatus: "in_production", ...o });
const inv = (o: Partial<InvItem> & { id: number }): InvItem => ({ name: `صنف ${o.id}`, unit: "كجم", qty: "50", minQty: "10", category: "raw_material", ...o });

describe("dashboardCore", () => {
  it("المؤشرات: المسلّم هذا الشهر، الشغّال، المنخفض، والتغطية", () => {
    const orders = [
      po({ id: 1, workflowStatus: "delivered_customer", updatedAt: "2026-10-03T00:00:00Z" }),
      po({ id: 2, workflowStatus: "delivered_warehouse", updatedAt: "2026-09-30T00:00:00Z" }),
      po({ id: 3 }),
      po({ id: 4, workflowStatus: "cancelled" }),
    ];
    const items = [inv({ id: 1, qty: "0" }), inv({ id: 2, qty: "10" }), inv({ id: 3, qty: "5", minQty: "0" })];
    expect(computeKpis(orders, items, NOW)).toEqual({ completedThisMonth: 1, active: 1, lowStock: 2, coverage: Math.round((0 + 100 + 100) / 3) });
  });
  it("من غير بيانات: كله صفر من غير NaN", () => {
    expect(computeKpis([], [], NOW)).toEqual({ completedThisMonth: 0, active: 0, lowStock: 0, coverage: 0 });
  });
  it("التنبيهات: نفد ثم متأخر ثم منخفض، بدون تكرار الأصناف القريبة", () => {
    const a = deriveAlerts(
      [po({ id: 1, neededBy: "2026-10-01" }), po({ id: 2, workflowStatus: "materials_rejected" }), po({ id: 3, workflowStatus: "materials_requested" }), po({ id: 4, workflowStatus: "delivered_customer", neededBy: "2026-01-01" })],
      [inv({ id: 1, qty: "0" }), inv({ id: 2, qty: "8" }), inv({ id: 3 })],
      { inventory: { approachingLowStock: [{ id: 2, name: "x" }, { id: 3, name: "قريب", proximityRatio: 1.2 }] } },
      "2026-10-22",
    );
    expect(a.map((x) => x.kind)).toEqual(["out", "late", "rejected", "low", "waiting", "near"]);
    expect(a.filter((x) => x.tone === "danger").map((x) => x.kind).sort()).toEqual(["late", "out", "rejected"]);
    expect(a.find((x) => x.kind === "low")?.subject).toBe("صنف 2");
    expect(a.filter((x) => x.kind === "near").map((x) => x.subject)).toEqual(["قريب"]);
    expect(a.some((x) => x.id === "po-4")).toBe(false);
    expect(a[a.length - 1]?.tone).toBe("info");
  });
  it("حالة غير معروفة مش بتتسمّى «جديد»", () => {
    expect(isKnownStatus("in_production")).toBe(true);
    expect(isKnownStatus("brand_new_status")).toBe(false);
    expect(statusTone("brand_new_status")).toBe("neutral");
  });
  it("التوزيعات", () => {
    expect(statusCounts([po({ id: 1 }), po({ id: 2 }), po({ id: 3, workflowStatus: "quality_check" })]).find((c) => c.status === "in_production")?.count).toBe(2);
    expect(categoryShares([inv({ id: 1 }), inv({ id: 2, category: "wip" })]).map((c) => c.pct)).toEqual([50, 50, 0]);
  });
});

const NAV: NavResponse = {
  role: "chairman",
  singleDepartment: false,
  homeHref: null,
  departments: [{ id: "d", label: "قسم", icon: "industry", subFunctions: [{ id: "s", label: "م", pages: [{ id: "p", label: "الإنتاج", href: "/v2/staff/production?tab=orders" }] }] }],
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** بنحاكي السيرفر على مستوى fetch (فالغلاف { data } بيتفك بالعميل الحقيقي زي الإنتاج). */
const serve = (can: Record<string, boolean>, routes: Record<string, unknown> = {}) => {
  const f = vi.fn(async (url: string) => {
    const path = String(url).replace("/api/v1", "").split("?")[0]!;
    if (path === "/me/access") return json({ data: { role: "chairman", can } });
    if (path in routes) {
      const v = routes[path];
      return v instanceof Error ? json({ error: { code: "X", message: "عطل" } }, 500) : json(v);
    }
    return json({ error: { code: "NOT_FOUND", message: "مش موجود" } }, 404);
  });
  vi.stubGlobal("fetch", f);
  return f;
};
const calls = (f: ReturnType<typeof serve>) => f.mock.calls.map((c) => String(c[0]).replace("/api/v1", ""));

afterEach(() => {
  cleanup();
  invalidateShared();
  vi.unstubAllGlobals();
});

describe("Dashboard (الواجهة)", () => {
  it("رئيس المجلس: بيحمّل التلات مصادر وبيعرض المؤشرات والتنبيهات والرابط السريع", async () => {
    serve(
      { productionWorkflowRead: true, inventoryRead: true, dashboardRead: true },
      {
        "/production-workflow": { data: [po({ id: 1, orderNumber: "PO-1" }), po({ id: 2, workflowStatus: "materials_rejected" })], stats: { total: 2 } },
        "/inventory": { data: [inv({ id: 1, name: "ورق", qty: "0" })] },
        "/dashboard": { data: { quality: { passRate: 97, trend: { direction: "up" } }, sales: { trend: { last7DaysOrders: 12 } }, inventory: { approachingLowStock: [] } } },
      },
    );
    render(<Dashboard nav={NAV} />);
    expect(await screen.findByText("نفد من المخزن: ورق")).toBeTruthy();
    expect(screen.getByText("مواد مرفوضة: PO-2")).toBeTruthy();
    expect(screen.getByText("PO-1")).toBeTruthy();
    expect(screen.getByText("97%")).toBeTruthy();
    expect(screen.getByText("أحسن من الأسبوع اللي فات")).toBeTruthy();
    expect(screen.getByText("مباشر")).toBeTruthy();
    expect(screen.getByRole("link", { name: "أوامر الإنتاج" }).getAttribute("href")).toBe("/v2/staff/production?tab=orders");
    expect(screen.queryByRole("link", { name: "المبيعات" })).toBeNull();
  });
  it("دور مخزن بس: مبينادش الإنتاج ولا الملخص ومفيش خطأ", async () => {
    const f = serve({ productionWorkflowRead: false, inventoryRead: true, dashboardRead: false }, { "/inventory": { data: [inv({ id: 1, qty: "3", minQty: "10" })] } });
    render(<Dashboard />);
    expect(await screen.findByText("أصناف محتاجة تعبئة")).toBeTruthy();
    expect(screen.queryByText("أوامر إنتاج شغّالة")).toBeNull();
    expect(screen.queryByText(/تعذّر تحميل/)).toBeNull();
    expect(calls(f)).not.toContain("/production-workflow");
    expect(calls(f)).not.toContain("/dashboard");
  });
  it("دور من غير ولا مصدر: اللوحة مختفية", async () => {
    const f = serve({ productionWorkflowRead: false, inventoryRead: false, dashboardRead: false });
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(calls(f)).toContain("/me/access"));
    await new Promise((r) => setTimeout(r, 30));
    expect(container.textContent).toBe("");
    expect(calls(f)).toEqual(["/me/access"]);
  });
  it("مصدر وقع: بيقول أنهي واحد وبيبقى غير متصل، والباقي شغّال، وزرار التحديث بيعيد الطلب", async () => {
    const f = serve({ productionWorkflowRead: true, inventoryRead: true, dashboardRead: false }, { "/production-workflow": new Error("down"), "/inventory": { data: [inv({ id: 1 })] } });
    render(<Dashboard />);
    expect(await screen.findByText("تعذّر تحميل: أوامر الإنتاج")).toBeTruthy();
    expect(screen.getByText("غير متصل")).toBeTruthy();
    const before = calls(f).filter((c) => c === "/inventory").length;
    fireEvent.click(screen.getByRole("button", { name: "حدّث" }));
    await waitFor(() => expect(calls(f).filter((c) => c === "/inventory").length).toBe(before + 1));
  });
});
