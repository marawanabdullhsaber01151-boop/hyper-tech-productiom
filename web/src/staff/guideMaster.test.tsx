import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Guide } from "./Guide";
import type { GuideLive } from "./guideModel";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const LIVE: GuideLive = {
  roles: [
    { id: "chairman", label: "رئيس مجلس الإدارة", approver: true, exempt: true },
    { id: "warehouse_manager", label: "مدير المخازن", approver: false, exempt: false },
    { id: "buyer", label: "المشتري", approver: false, exempt: false },
  ],
  permissions: [],
  nav: [],
  policies: [],
  sla: { minutes: 240, soonAt: 0.75, hours: { start: 9, end: 17, offDay: 5 } },
};

function mount(role: string) {
  sessionStorage.setItem("hyper_erp_session", JSON.stringify({ token: "t", user: { id: 5, username: "u", fullName: "مستخدم", role } }));
  vi.stubGlobal("fetch", vi.fn(async () => json(LIVE)));
  render(<Guide />);
}
const openMaster = async () => { fireEvent.click(await screen.findByRole("tab", { name: "البيانات الأساسية" })); await screen.findByText("دليل البيانات الأساسية"); };

beforeEach(() => { sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); sessionStorage.clear(); });

describe("دليل النظام: تبويب البيانات الأساسية", () => {
  it("رئيس المجلس: يشوف كل التبويبات السبعة وجدول الفرق بين الموقع ومركز العمل والاعتراف الصريح", async () => {
    mount("chairman");
    await openMaster();
    for (const name of ["المواقع", "مراكز العمل", "الماكينات", "الورديات", "الأصناف", "عدادات المستندات", "سجل التدقيق"]) {
      expect(screen.getByRole("heading", { name }), name).toBeTruthy();
    }
    expect(screen.getByRole("heading", { name: "الفرق بين «الموقع» و«مركز العمل»" })).toBeTruthy();
    expect(screen.getByText(/علامات تنظيمية دلوقتي/)).toBeTruthy();
  });

  it("مدير المخازن (من أصحاب الصفحة): يشوف التبويب، وخانة الطاقة بمثالها المحسوب", async () => {
    mount("warehouse_manager");
    await openMaster();
    expect(screen.getByText("الطاقة للوردية (بالدقيقة)")).toBeTruthy();
    expect(screen.getByText(/816 دقيقة في اليوم/)).toBeTruthy();
  });

  it("المشتري (مش من أصحاب الصفحة): مفيش تبويب البيانات الأساسية خالص", async () => {
    mount("buyer");
    await screen.findByRole("tab", { name: "كتالوجي" });
    expect(screen.queryByRole("tab", { name: "البيانات الأساسية" })).toBeNull();
  });

  it("كل خانة بتتعرض بأربع عناوين: تكتب إيه ومثال واقتراح وبتأثر في إيه", async () => {
    mount("chairman");
    await openMaster();
    // نعدّ عناوين الخانات (dt) بس: كلمة «مثال» موجودة كمان في جدول المقارنة
    const n = (name: string) => screen.getAllByText(name, { selector: "dt" }).length;
    expect(n("تكتب إيه")).toBeGreaterThan(20);
    expect(n("مثال")).toBe(n("تكتب إيه"));
    expect(n("اقتراح")).toBe(n("تكتب إيه"));
    expect(n("بتأثر في إيه")).toBe(n("تكتب إيه"));
  });
});
