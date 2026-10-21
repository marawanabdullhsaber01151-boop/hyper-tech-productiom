import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoleGuard } from "./RoleGuard";
import { HEALTH_ROLES, SystemHealth, visibleGroups, type HealthGroup, type HealthReport } from "./SystemHealth";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const REPORT: HealthReport = {
  status: "bad",
  headline: "في مشكلة محتاجة تدخّل، وفيها واحدة خطيرة",
  checkedAt: new Date().toISOString(),
  summary: { ok: 1, warn: 1, bad: 1, unknown: 0 },
  groups: [
    {
      id: "sales",
      title: "المبيعات والفواتير",
      status: "bad",
      checks: [
        { id: "invoice_totals", group: "sales", title: "إجمالي الفواتير مطابق للأصناف", status: "bad", message: "فاتورتين إجماليها غلط.", action: "راجع الفواتير.", examples: ["INV-1: الإجمالي 10"], href: "/sales.html" },
        { id: "stale_drafts", group: "sales", title: "فواتير مسودة منسية", status: "warn", message: "3 مسودات قديمة.", action: "أكّدها أو الغيها." },
      ],
    },
    { id: "base", title: "الأساس", status: "ok", checks: [{ id: "database", group: "base", title: "قاعدة البيانات", status: "ok", message: "شغّالة." }] },
  ],
};

function login(role: string) {
  sessionStorage.setItem("hyper_erp_session", JSON.stringify({ token: "t", user: { id: 1, username: "u", fullName: "م", role } }));
}
beforeEach(() => sessionStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("visibleGroups", () => {
  it("المشاكل بس: بيشيل السليم والمجموعة اللي كلها سليمة", () => {
    const g = visibleGroups(REPORT.groups, true);
    expect(g.map((x: HealthGroup) => x.id)).toEqual(["sales"]);
    expect(g[0]?.checks).toHaveLength(2);
    expect(visibleGroups(REPORT.groups, false)).toHaveLength(2);
  });
});

describe("SystemHealth", () => {
  const mount = () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: REPORT })));
    return render(<SystemHealth />);
  };

  it("بيعرض الملخص والمشكلة والمطلوب عمله وزر فتح الصفحة", async () => {
    mount();
    expect(await screen.findByText("في مشكلة محتاجة تدخّل، وفيها واحدة خطيرة")).toBeTruthy();
    expect(screen.getByText("إجمالي الفواتير مطابق للأصناف")).toBeTruthy();
    expect(screen.getByText("فاتورتين إجماليها غلط.")).toBeTruthy();
    expect(screen.getByText("راجع الفواتير.")).toBeTruthy();
    expect(screen.getAllByText("افتح الصفحة").length).toBe(1);
  });

  it("افتراضيًا بيعرض المشاكل بس، وزر «كل الفحوصات» بيظهر السليم", async () => {
    mount();
    await screen.findByText("إجمالي الفواتير مطابق للأصناف");
    expect(screen.queryByText("قاعدة البيانات")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "اعرض كل الفحوصات" }));
    expect(await screen.findByText("قاعدة البيانات")).toBeTruthy();
  });

  it("فشل التحميل نفسه بيظهر كمشكلة مع زر محاولة تانية", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { code: "X", message: "عطل" } }, 500)));
    render(<SystemHealth />);
    expect(await screen.findByText(/ماقدرناش نعمل الفحص/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "حاول تاني" })).toBeTruthy();
  });
});

describe("RoleGuard لصفحة الصحة", () => {
  it("الأدوار المسموحة بس", () => {
    expect(HEALTH_ROLES).toEqual(["chairman", "executive_manager"]);
    login("sales_manager");
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: REPORT })));
    render(<RoleGuard roles={HEALTH_ROLES}><SystemHealth /></RoleGuard>);
    expect(screen.queryByText("صحة النظام")).toBeNull();
  });
});
