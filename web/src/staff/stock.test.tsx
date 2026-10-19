import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoleGuard } from "./RoleGuard";
import { STOCK_ROLES, Stock, stockState } from "./Stock";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const row = (id: number, name: string, over: Record<string, unknown> = {}) => ({
  id, code: `C-${id}`, name, category: "raw_material", unit: "كجم", qty: "100", reservedQty: "0", availableQty: "100", minQty: "20", ...over,
});
const ITEMS = [
  row(1, "حبيبات بلاستيك"),
  row(2, "ملون أزرق", { qty: "15", availableQty: "15", minQty: "20" }),
  row(3, "عبوات فاضية", { qty: "0", availableQty: "0", minQty: "50", category: "finished_good" }),
  row(4, "خيط تغليف", { category: "wip", unit: null, code: null, qty: "7.5", availableQty: "7.5", minQty: "0" }),
];

function login(role: string) {
  sessionStorage.setItem("hyper_erp_session", JSON.stringify({ token: "t", user: { id: 1, username: "u", fullName: "مستخدم", role } }));
}
beforeEach(() => {
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("stockState", () => {
  it("نفد / منخفض / متوفر", () => {
    expect(stockState({ qty: "0", minQty: "50" })).toBe("out");
    expect(stockState({ qty: "-3", minQty: "0" })).toBe("out");
    expect(stockState({ qty: "15", minQty: "20" })).toBe("low");
    expect(stockState({ qty: "20", minQty: "20" })).toBe("low");
    expect(stockState({ qty: "21", minQty: "20" })).toBe("ok");
    expect(stockState({ qty: "7.5", minQty: "0" })).toBe("ok");
  });
});

describe("Stock — المخزون للمشتريات (عرض فقط)", () => {
  const mount = () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: ITEMS })));
    return render(<Stock />);
  };

  it("بيعرض الأصناف وحالاتها والأعداد", async () => {
    mount();
    expect(await screen.findByText("حبيبات بلاستيك")).toBeTruthy();
    expect(screen.getByText("ملون أزرق")).toBeTruthy();
    // ٤ أصناف، ١ منخفض، ١ نفد
    expect(screen.getByText("عدد الأصناف")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getAllByText("نفد").length).toBeGreaterThan(0);
    expect(screen.getAllByText("منخفض").length).toBeGreaterThan(0);
    expect(screen.getAllByText("7.5").length).toBeGreaterThan(0);
  });

  it("مفيش عمود سعر ولا أي زر تعديل (عرض فقط)", async () => {
    mount();
    await screen.findByText("حبيبات بلاستيك");
    expect(screen.queryByText(/سعر/)).toBeNull();
    expect(screen.queryByRole("button", { name: /تعديل|إضافة|حذف/ })).toBeNull();
  });

  it("البحث بالاسم والكود", async () => {
    mount();
    await screen.findByText("حبيبات بلاستيك");
    fireEvent.input(screen.getByLabelText("ابحث بالاسم أو الكود"), { target: { value: "ملون" } });
    await waitFor(() => expect(screen.queryByText("حبيبات بلاستيك")).toBeNull());
    expect(screen.getByText("ملون أزرق")).toBeTruthy();
    fireEvent.input(screen.getByLabelText("ابحث بالاسم أو الكود"), { target: { value: "C-3" } });
    await waitFor(() => expect(screen.getByText("عبوات فاضية")).toBeTruthy());
    expect(screen.queryByText("ملون أزرق")).toBeNull();
  });

  it("فلتر النوع والحالة", async () => {
    mount();
    await screen.findByText("حبيبات بلاستيك");
    fireEvent.change(screen.getByLabelText("الحالة"), { target: { value: "out" } });
    await waitFor(() => expect(screen.queryByText("حبيبات بلاستيك")).toBeNull());
    expect(screen.getByText("عبوات فاضية")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("الحالة"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("النوع"), { target: { value: "wip" } });
    await waitFor(() => expect(screen.queryByText("عبوات فاضية")).toBeNull());
    expect(screen.getByText("خيط تغليف")).toBeTruthy();
  });

  it("فشل التحميل: رسالة وزر إعادة المحاولة", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { code: "FORBIDDEN", message: "x" } }, 403)));
    render(<Stock />);
    expect(await screen.findByText("ماقدرناش نحمّل المخزون.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "حاول تاني" })).toBeTruthy();
  });
});

describe("RoleGuard — صفحة المخزون", () => {
  it("المشتريات ورئيس المجلس يشوفوا الصفحة", () => {
    for (const role of ["purchasing_manager", "buyer", "chairman"]) {
      cleanup();
      login(role);
      render(<RoleGuard roles={STOCK_ROLES}><p>المحتوى</p></RoleGuard>);
      expect(screen.getByText("المحتوى")).toBeTruthy();
    }
  });
  it("أي دور تاني يشوف «مش متاحة لدورك»", () => {
    login("online_seller");
    render(<RoleGuard roles={STOCK_ROLES}><p>المحتوى</p></RoleGuard>);
    expect(screen.queryByText("المحتوى")).toBeNull();
    expect(screen.getByText("الصفحة دي مش متاحة لدورك")).toBeTruthy();
  });
});
