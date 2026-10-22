import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import type { ComponentChildren } from "preact";
import { ToastProvider } from "../design/components";
import { authStore } from "./session";
import { PriceInquiries } from "./screens/PriceInquiries";
import { ProfileEdit, profileProblem } from "./screens/ProfileEdit";
import { ActivationRequest } from "./screens/auth/ActivationRequest";
import { LEGACY_HASH_TARGET } from "./screens/auth/Login";
import { Lightbox } from "./screens/Products";

const get = vi.fn();
const post = vi.fn(async (_p: string, _b?: unknown, _o?: unknown) => ({ message: "وصل طلبك. فريق المبيعات هيتواصل معاك." }));
const patch = vi.fn(async (_p: string, b?: unknown) => b);
vi.mock("./api", () => ({
  api: { get: (p: string, o?: unknown) => get(p, o), post: (p: string, b?: unknown, o?: unknown) => post(p, b, o), patch: (p: string, b?: unknown) => patch(p, b) },
  setOnExpired: vi.fn(),
}));

const ui = (n: ComponentChildren) => render(<ToastProvider>{n}</ToastProvider>);
beforeEach(() => {
  get.mockReset();
  post.mockClear();
  patch.mockClear();
});
afterEach(() => cleanup());

describe("طلبات الأسعار (العميل)", () => {
  it("بيفرّق بين المستني والمردود عليه وبيعرض السعر", async () => {
    get.mockResolvedValue([
      { id: 1, bomRecipeId: 7, productName: "كوب ورق", requestedQty: "500", suggestedPrice: "2.5", finalPrice: "2.75", status: "answered", createdAt: new Date().toISOString(), answeredAt: new Date().toISOString() },
      { id: 2, bomRecipeId: 8, productName: "غطا", requestedQty: "1000", suggestedPrice: null, finalPrice: null, status: "pending", createdAt: new Date().toISOString(), answeredAt: null },
    ]);
    ui(<PriceInquiries />);
    expect(await screen.findByText("سألت عن: كوب ورق")).toBeTruthy();
    expect(screen.getByText(/السعر:/)).toBeTruthy();
    expect(screen.getByText("مستنيين رد المبيعات")).toBeTruthy();
    expect(screen.getByText("اتردّ عليه")).toBeTruthy();
  });
  it("لو مفيش طلبات بيقول كده", async () => {
    get.mockResolvedValue([]);
    ui(<PriceInquiries />);
    expect(await screen.findByText("لسه مفيش طلبات أسعار")).toBeTruthy();
  });
});

describe("تعديل بيانات الحساب", () => {
  const customer = { id: 1, fullName: "منى أحمد", phone: "01001234567", email: null, companyName: "النور", city: "القاهرة", address: null };
  it("profileProblem بنفس شروط السيرفر", () => {
    const ok = { fullName: "منى", phone: "01001234567", email: "", companyName: "النور", city: "", address: "", currentPassword: "x" };
    expect(profileProblem(ok)).toBe(false);
    expect(profileProblem({ ...ok, fullName: "م" })).toBe(true);
    expect(profileProblem({ ...ok, phone: "123" })).toBe(true);
    expect(profileProblem({ ...ok, currentPassword: "" })).toBe(true);
    expect(profileProblem({ ...ok, email: "bad" })).toBe(true);
    expect(profileProblem({ ...ok, email: "a@b.co" })).toBe(false);
  });
  it("من غير كلمة السر ما بيبعتش، ومعاها بيبعت بيانات مقصوصة وبيحدّث الجلسة", async () => {
    authStore.set({ status: "authed", customer, member: null, mustChangePassword: false });
    ui(<ProfileEdit customer={customer} open onClose={() => {}} />);
    const save = await screen.findByRole("button", { name: "احفظ التعديلات" });
    fireEvent.click(save);
    expect(await screen.findByText(/راجع البيانات/)).toBeTruthy();
    expect(patch).not.toHaveBeenCalled();
    fireEvent.input(screen.getByLabelText("اسم الشركة", { exact: false }), { target: { value: "  النور للتجارة " } });
    fireEvent.input(screen.getByLabelText("كلمة السر الحالية", { exact: false }), { target: { value: "secret1" } });
    fireEvent.click(save);
    await waitFor(() => expect(patch).toHaveBeenCalled());
    const [path, body] = patch.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe("/portal/me");
    expect(body).toMatchObject({ companyName: "النور للتجارة", email: null, address: null, city: "القاهرة", currentPassword: "secret1" });
    await waitFor(() => expect(authStore.get().customer?.companyName).toBe("النور للتجارة"));
  });
});

describe("طلب تفعيل العميل القديم", () => {
  it("بيرفض بيانات ناقصة، وبيبعت الصحيحة ويعرض رد السيرفر", async () => {
    ui(<ActivationRequest />);
    fireEvent.click(await screen.findByRole("button", { name: "ابعت طلب التفعيل" }));
    expect(await screen.findByText(/اكتب اسم الشركة/)).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
    fireEvent.input(screen.getByLabelText("اسم الشركة", { exact: false }), { target: { value: " النور " } });
    fireEvent.input(screen.getByLabelText("رقم الموبايل", { exact: false }), { target: { value: "01001234567" } });
    fireEvent.click(screen.getByRole("button", { name: "ابعت طلب التفعيل" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/portal/activation-requests", { companyName: "النور", phone: "01001234567" }, { anonymous: true }));
    expect(await screen.findByText("وصل طلبك. فريق المبيعات هيتواصل معاك.")).toBeTruthy();
  });
});

describe("روابط قديمة بتنتهي بـ #", () => {
  it("#new-customer و#old-customer بيروحوا للشاشات الجديدة", () => {
    expect(LEGACY_HASH_TARGET["#new-customer"]).toBe("/portal/apply");
    expect(LEGACY_HASH_TARGET["#old-customer"]).toBe("/portal/activation-request");
  });
});

describe("تكبير صور المنتج", () => {
  const imgs = ["/a.jpg", "/b.jpg", "/c.jpg"];
  it("التنقل دايري، وبيتقفل", () => {
    const onIndex = vi.fn();
    const onClose = vi.fn();
    ui(<Lightbox images={imgs} index={0} name="كوب" onIndex={onIndex} onClose={onClose} />);
    expect(screen.getByText("1 من 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "الصورة اللي بعدها" }));
    expect(onIndex).toHaveBeenLastCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: "الصورة اللي قبلها" }));
    expect(onIndex).toHaveBeenLastCalledWith(2);
  });
  it("صورة واحدة: مفيش أزرار تنقل", () => {
    ui(<Lightbox images={["/a.jpg"]} index={0} name="كوب" onIndex={() => {}} onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: "الصورة اللي بعدها" })).toBeNull();
  });
});
