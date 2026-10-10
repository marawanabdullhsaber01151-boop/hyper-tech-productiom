import { render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "../test/axe";
import { ToastProvider } from "../design/components";
import { authStore, can } from "./session";
import { cartPieces, cartStore, removeFromCart, setCartQty } from "./cart";
import { createStore } from "./lib/store";
import { Login } from "./screens/auth/Login";
import { Team } from "./screens/Team";
import type { CartItem, PortalMember } from "./types";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const item = (recipeId: number, qty: string) => ({ id: recipeId, recipeId, productName: "منتج", productCode: "P", qty }) as unknown as CartItem;

describe("store", () => {
  it("بينبّه المشتركين ويقبل تحديث جزئي ودالة", () => {
    const s = createStore({ n: 0, label: "أ" });
    const cb = vi.fn();
    const off = s.subscribe(cb);
    s.set({ n: 1 });
    s.set((x) => ({ ...x, n: x.n + 1 }));
    expect(s.get()).toEqual({ n: 2, label: "أ" });
    off();
    s.set({ n: 9 });
    expect(cb).toHaveBeenCalledTimes(2);
  });
});

describe("can()", () => {
  const mk = (over: Partial<PortalMember>): PortalMember => ({ id: 1, isOwner: false, roleKey: "buyer", permissions: [], limits: {}, ...over });
  it("الرئيس معاه كل حاجة، والموظف بصلاحياته بس", () => {
    authStore.set({ status: "authed", member: mk({ isOwner: true }) });
    expect(can("team.manage")).toBe(true);
    authStore.set({ member: mk({ permissions: ["cart.use"] }) });
    expect(can("cart.use")).toBe(true);
    expect(can("team.manage")).toBe(false);
    authStore.set({ member: null });
    expect(can("cart.use")).toBe(false);
  });
});

describe("cart", () => {
  beforeEach(() => cartStore.set({ items: [item(1, "10"), item(2, "5")], loaded: true, busy: false }));
  afterEach(() => vi.restoreAllMocks());
  it("بيجمع القطع", () => expect(cartPieces(cartStore.get().items)).toBe(15));
  it("لو السيرفر رفض تعديل الكمية بيرجّع الكمية القديمة", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ error: { message: "الحد الأدنى 10", code: "X" } }, 400));
    await expect(setCartQty(1, 3)).rejects.toBeTruthy();
    expect(cartStore.get().items.find((i) => i.recipeId === 1)?.qty).toBe("10");
  });
  it("لو مسح فشل بيرجّع الصنف", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ error: { message: "x" } }, 500));
    await expect(removeFromCart(2)).rejects.toBeTruthy();
    expect(cartStore.get().items).toHaveLength(2);
  });
});

describe("شاشات", () => {
  afterEach(() => vi.restoreAllMocks());
  it("الدخول: بيتعرض من غير مخالفات a11y", async () => {
    history.replaceState(null, "", "/v2/portal/login");
    const { container } = render(<Login />);
    expect(await screen.findByRole("button", { name: "ادخل" })).toBeInTheDocument();
    const res = await axe(container);
    expect(res.violations).toEqual([]);
  });

  it("الفريق: بيعرض الموظفين وعدّاد المقاعد وكود الشركة", async () => {
    authStore.set({
      status: "authed",
      member: { id: 1, isOwner: true, roleKey: "owner", permissions: [], limits: {} },
    });
    const member = { memberId: 1, userId: 1, status: "active", isOwner: true, joinedVia: "x", title: null, lastActiveAt: null, roleKey: "owner", roleName: "رئيس", fullName: "منى علي", phone: "01000000000", email: null };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/portal/team")) return json({ members: [member], maxMembers: 10, pendingRequests: 0 });
      if (url.includes("/portal/roles")) return json({ roles: [{ id: 1, key: "buyer", name: "مشتري", description: null, permissions: [], isSystem: true }] });
      if (url.includes("/portal/company")) return json({ company: { id: 1, companyName: "ش", city: null }, joinCode: { code: "HT-ABCD-EFGH", expiresAt: null, maxUses: null, uses: 2 }, settings: { "join.mode": "approval" } });
      if (url.includes("/portal/audit")) return json({ events: [], nextBefore: null });
      return json({});
    });
    history.replaceState(null, "", "/v2/portal/team");
    const { container } = render(<ToastProvider><Team /></ToastProvider>);
    expect(await screen.findByText("منى علي")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("HT-ABCD-EFGH")).toBeInTheDocument());
    expect(screen.getByText("1 من 10 موظف")).toBeInTheDocument();
    const res = await axe(container);
    expect(res.violations).toEqual([]);
  });
});
