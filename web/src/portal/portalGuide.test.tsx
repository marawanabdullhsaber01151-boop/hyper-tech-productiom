import { cleanup, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "../test/axe";
import { authStore } from "./session";
import { guideSeen, markGuideSeen } from "./guideSeen";
import { PortalGuide } from "./screens/PortalGuide";
import { Home } from "./screens/Home";
import type { PortalMember } from "./types";

const member = (over: Partial<PortalMember>): PortalMember => ({ id: 7, isOwner: false, roleKey: "buyer", roleName: "مشتري", permissions: [], limits: {}, ...over });
const as = (m: PortalMember) => authStore.set({ status: "authed", customer: { id: 1, fullName: "أحمد علي", phone: "0100", email: null, companyName: "شركة الأمل" }, member: m, mustChangePassword: false });

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ok */ }
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup(); authStore.set({ status: "anon", customer: null, member: null, mustChangePassword: false }); });

describe("دليل البوابة (شاشة)", () => {
  it("رئيس الشركة: كل الأقسام بما فيها التحويلات والأرصدة والفريق، ومفيش «مش متاح»", () => {
    as(member({ isOwner: true, roleName: undefined }));
    render(<PortalGuide />);
    for (const name of ["السلة", "الطلبات", "التحويلات", "الأرصدة", "المحادثة", "الفريق", "حسابي"]) {
      expect(screen.getAllByRole("heading", { name }).length, name).toBeGreaterThan(0);
    }
    expect(screen.getAllByText(/إنت رئيس الشركة/).length).toBeGreaterThan(0);
    expect(screen.getByText("مفيش حاجة ناقصة. كل الصلاحيات معاك.")).toBeTruthy();
  });

  it("المشتري: بيشوف السلة والطلبات، ومفيش تحويلات ولا أرصدة ولا فريق، وبيشوف اللي مش متاح ليه", () => {
    as(member({ permissions: ["cart.use", "orders.create", "orders.view_own"] }));
    render(<PortalGuide />);
    expect(screen.getAllByRole("heading", { name: "السلة" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "التحويلات" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "الأرصدة" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "الفريق" })).toBeNull();
    expect(screen.getByText(/دورك: مشتري/)).toBeTruthy();
    expect(screen.getByText("يبلّغ عن تحويل")).toBeTruthy();
  });

  it("موظف مشاهدة بس: مفيش «ابعت الطلب» ولا «ضيف للسلة» في الشرح", () => {
    as(member({ permissions: ["orders.view_own"] }));
    render(<PortalGuide />);
    expect(screen.queryByText("ابعت الطلب")).toBeNull();
    expect(screen.queryByText("ضيف للسلة")).toBeNull();
    expect(screen.queryByText("اطلب بهذا السعر")).toBeNull();
    expect(screen.getAllByRole("heading", { name: "الطلبات" }).length).toBeGreaterThan(0);
  });

  it("مدير الفريق: بيشوف أزرار الإضافة والإدارة والكود", () => {
    as(member({ permissions: ["team.view", "team.invite", "team.manage", "company.manage_code"] }));
    render(<PortalGuide />);
    for (const label of ["ضيف موظف", "غيّر الدور", "رابط كلمة سر جديدة", "كود جديد"]) expect(screen.getByText(label), label).toBeTruthy();
    expect(screen.queryByText("اقبل")).toBeNull();
  });

  it("بيعلّم إن العضو شاف الدليل", () => {
    as(member({ id: 42 }));
    expect(guideSeen(42)).toBe(false);
    render(<PortalGuide />);
    expect(guideSeen(42)).toBe(true);
  });

  it("من غير مخالفات a11y", async () => {
    as(member({ permissions: ["cart.use", "orders.create", "orders.view_own", "payments.report"] }));
    const { container } = render(<PortalGuide />);
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe("كارت الترحيب في الرئيسية", () => {
  it("بيظهر أول مرة، وبعد ما العضو يعلّم إنه شاف الدليل ما بيظهرش", () => {
    as(member({ id: 9 }));
    const first = render(<Home />);
    expect(first.queryByText("أول مرة في البوابة؟")).toBeTruthy();
    first.unmount();
    markGuideSeen(9);
    const second = render(<Home />);
    expect(second.queryByText("أول مرة في البوابة؟")).toBeNull();
  });
});
