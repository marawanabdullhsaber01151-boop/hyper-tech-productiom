import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Guide } from "./Guide";
import type { GuideLive, GuideMine } from "./guideModel";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const LIVE: GuideLive = {
  roles: [
    { id: "chairman", label: "رئيس مجلس الإدارة", approver: true, exempt: true },
    { id: "supervisor", label: "مشرف الإنتاج", approver: false, exempt: false },
    { id: "buyer", label: "المشتري", approver: false, exempt: false },
  ],
  permissions: [],
  nav: [
    { id: "production", label: "الإنتاج", icon: "factory", roles: ["chairman", "production_manager", "supervisor"], subFunctions: [{ id: "p", label: "الشغل", pages: [
      { id: "production", label: "الإنتاج", href: "/v2/staff/production", roles: ["chairman", "production_manager", "supervisor"] },
      { id: "production-requests", label: "طلبات الإنتاج", href: "/v2/staff/production", roles: ["chairman", "production_manager", "supervisor"] },
      { id: "execution-control", label: "التنفيذ", href: "/v2/staff/production", roles: ["chairman", "production_manager", "supervisor"] },
    ] }] },
  ],
  policies: [],
  sla: { minutes: 240, soonAt: 0.75, hours: { start: 9, end: 17, offDay: 5 } },
};
const NONE: GuideMine = { role: "supervisor", extraRoles: [], grants: [], blocked: [] };
const in3d = new Date(Date.now() + 3 * 86_400_000).toISOString();

function mount(role: string, mine: GuideMine | "fail") {
  sessionStorage.setItem("hyper_erp_session", JSON.stringify({ token: "t", user: { id: 5, username: "u", fullName: "مستخدم", role } }));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/guide/mine")) return mine === "fail" ? json({ error: { code: "X", message: "x" } }, 500) : json(mine);
    return json(LIVE);
  }));
  render(<Guide />);
}
const openMine = async () => { fireEvent.click(await screen.findByRole("tab", { name: "كتالوجي" })); await screen.findByText("كتالوجي: الشرح الخاص بيك"); };

beforeEach(() => { sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); sessionStorage.clear(); });

describe("دليل النظام: تبويب كتالوجي", () => {
  it("المشرف: يشوف شرح الإنتاج بتاعه بس، ومفيش تكلفة ولا تخطيط، ومفيش صلاحيات إضافية", async () => {
    mount("supervisor", NONE);
    await openMine();
    expect(await screen.findByText("دورك: مشرف الإنتاج")).toBeTruthy();
    expect(screen.getByText("مفيش صلاحيات إضافية. كتالوجك على قد دورك.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "طلبات الإنتاج" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "أوامر الإنتاج" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "سجل النشاط" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "التكلفة والمعايير وربحية الدفعة" })).toBeNull();
    // خطوة قرار الإدارة مش بتاعته
    expect(screen.queryByText(/لو انت من الإدارة/)).toBeNull();
    // خطوة إنشاء طلب بتاعته
    expect(screen.getByText(/علشان تطلب إنتاج اضغط/)).toBeTruthy();
  });

  it("مشتري واخد صلاحية تنفيذ مؤقتة: بيظهر له شرح التنفيذ بعلامة «بصلاحية إضافية» وتاريخ الانتهاء", async () => {
    mount("buyer", { role: "buyer", extraRoles: [], blocked: [], grants: [{ key: "productionWorkflow.execute", label: "تنفيذ دفعة إنتاج", group: "دورة الإنتاج", until: in3d, source: "override" }] });
    await openMine();
    expect(await screen.findByText("صلاحيات إضافية معاك دلوقتي")).toBeTruthy();
    expect(screen.getByText("تنفيذ دفعة إنتاج")).toBeTruthy();
    expect(screen.getByText(/مؤقتة، لحد/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "التنفيذ والتوقفات" })).toBeTruthy();
    expect(screen.getAllByText("بصلاحية إضافية").length).toBeGreaterThan(0);
    expect(screen.getByText(/ظاهر لأنك واخد صلاحية إضافية/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "أوامر الإنتاج" })).toBeNull();
  });

  it("صلاحية دائمة بتتكتب «دائمة»، والمشتري من غير صلاحية مايشوفش شرح التنفيذ (المهام بس)", async () => {
    mount("buyer", { role: "buyer", extraRoles: [], blocked: [], grants: [{ key: "productionWorkflow.execute", label: "تنفيذ دفعة إنتاج", group: "", until: null, source: "delegation" }] });
    await openMine();
    expect(await screen.findByText(/دائمة، لحد ما تتسحب/)).toBeTruthy();
    cleanup();
    mount("buyer", { role: "buyer", extraRoles: [], blocked: [], grants: [] });
    await openMine();
    // المشتري من غير صلاحية: المهام بس (شاشة للكل)، ومفيش شرح تنفيذ ولا إنتاج
    expect(await screen.findByRole("heading", { name: "المهام" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "التنفيذ والتوقفات" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "أوامر الإنتاج" })).toBeNull();
  });

  it("الصلاحيات الموقوفة بتظهر في قايمة خاصة", async () => {
    mount("supervisor", { ...NONE, blocked: [{ key: "productionWorkflow.execute", label: "تنفيذ دفعة إنتاج", group: "", until: null }] });
    await openMine();
    expect(await screen.findByText("صلاحيات موقوفة عنك دلوقتي")).toBeTruthy();
    expect(screen.getByText("اتوقفت من الإدارة، فالخطوات بتاعتها مخفية.")).toBeTruthy();
  });

  it("لو تحميل صلاحياتي فشل: تنبيه، والشرح بيفضل ظاهر حسب الدور", async () => {
    mount("supervisor", "fail");
    await openMine();
    expect(await screen.findByText("مقدرناش نحمّل صلاحياتك دلوقتي، فعرضنا الشرح حسب دورك بس.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "أوامر الإنتاج" })).toBeTruthy();
  });

  it("الرابط بين الشروحات بيمشي لشرح ظاهر ومبيعرضش زرار لشرح مش ظاهر", async () => {
    mount("supervisor", NONE);
    await openMine();
    await screen.findByRole("heading", { name: "طلبات الإنتاج" });
    expect(screen.getAllByRole("button", { name: /اقرا شرح: أوامر الإنتاج/, hidden: true }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /اقرا شرح: التخطيط/, hidden: true })).toBeNull();
  });
});
