import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { ToastProvider } from "../design/components";
import type { QueryState } from "../api/hooks";
import type { PriceInquiryRow } from "./types";
import { PRICE_PATTERN, PriceInquiries, matchInquiry } from "./screens/PriceInquiries";
import { MIN_ORDER_PATTERN } from "./screens/CompanyTabs";

const post = vi.fn(async (_path: string, _body?: unknown) => ({}));
vi.mock("./api", () => ({ api: { post: (p: string, b?: unknown) => post(p, b), get: vi.fn() }, downloadCsv: vi.fn() }));

const row = (id: number, over: Partial<PriceInquiryRow> = {}): PriceInquiryRow => ({
  id,
  customerName: `عميل ${id}`,
  customerCompany: null,
  customerPhone: "01000000000",
  productName: `منتج ${id}`,
  requestedQty: "500",
  requestedUnit: "piece",
  suggestedPrice: "12.50",
  createdAt: new Date().toISOString(),
  assignedSales: null,
  ...over,
});
const state = (rows: PriceInquiryRow[]): QueryState<PriceInquiryRow[]> => ({ data: rows, error: null, loading: false, refetch: vi.fn(async () => undefined) }) as never;
const mount = (rows: PriceInquiryRow[], search = "") => {
  const list = state(rows);
  render(<ToastProvider><PriceInquiries list={list} search={search} /></ToastProvider>);
  return list;
};

beforeEach(() => post.mockClear());
afterEach(() => cleanup());

describe("أنماط الإدخال", () => {
  it("PRICE_PATTERN: رقم موجب بحد أقصى خانتين عشريتين", () => {
    for (const ok of ["1", "12.5", "12.50", "0.99", "1000000"]) expect(PRICE_PATTERN.test(ok)).toBe(true);
    for (const bad of ["", "-1", "12.555", "1,5", "abc", "1.", ".5", "12345678901"]) expect(PRICE_PATTERN.test(bad)).toBe(false);
  });
  it("MIN_ORDER_PATTERN: عدد صحيح ≥ 1", () => {
    for (const ok of ["1", "50", "1000000"]) expect(MIN_ORDER_PATTERN.test(ok)).toBe(true);
    for (const bad of ["0", "-3", "1.5", "", "abc", "12345678"]) expect(MIN_ORDER_PATTERN.test(bad)).toBe(false);
  });
  it("matchInquiry بيدوّر في الاسم والشركة والمنتج والتليفون", () => {
    const r = row(1, { customerCompany: "النور للتجارة" });
    expect(matchInquiry(r, "نور")).toBe(true);
    expect(matchInquiry(r, "منتج 1")).toBe(true);
    expect(matchInquiry(r, "0100")).toBe(true);
    expect(matchInquiry(r, "zzz")).toBe(false);
    expect(matchInquiry(r, "  ")).toBe(true);
  });
});

describe("طلبات الأسعار", () => {
  it("بيعرض الطلبات المستنية، والبحث بيفلتر", () => {
    mount([row(1), row(2)]);
    expect(screen.getByText("عميل 1")).toBeTruthy();
    expect(screen.getByText("عميل 2")).toBeTruthy();
    cleanup();
    mount([row(1), row(2)], "منتج 2");
    expect(screen.queryByText("عميل 1")).toBeNull();
    expect(screen.getByText("عميل 2")).toBeTruthy();
  });

  it("فاضي: رسالة واضحة", () => {
    mount([]);
    expect(screen.getByText("مفيش طلبات أسعار جديدة")).toBeTruthy();
  });

  it("سعر مقترح موجود + حقل فاضي ← بيبعت الرد من غير سعر (السيرفر يقبل المقترح)", async () => {
    const list = mount([row(1)]);
    fireEvent.click(screen.getByRole("button", { name: "ردّ بالسعر" }));
    const send = (await screen.findByRole("button", { name: "ابعت الردّ" })) as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(post).toHaveBeenCalledWith("/price-inquiries/1/answer", {}));
    await waitFor(() => expect(list.refetch).toHaveBeenCalled());
  });

  it("سعر معدّل بيتبعت كنص", async () => {
    mount([row(7)]);
    fireEvent.click(screen.getByRole("button", { name: "ردّ بالسعر" }));
    fireEvent.input(await screen.findByRole("textbox"), { target: { value: "13.75" } });
    fireEvent.click(screen.getByRole("button", { name: "ابعت الردّ" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/price-inquiries/7/answer", { finalPrice: "13.75" }));
  });

  it("من غير سعر مقترح: الزر مقفول لحد ما تكتب سعر صحيح", async () => {
    mount([row(3, { suggestedPrice: null })]);
    fireEvent.click(screen.getByRole("button", { name: "ردّ بالسعر" }));
    const send = (await screen.findByRole("button", { name: "ابعت الردّ" })) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.input(screen.getByRole("textbox"), { target: { value: "12.555" } });
    await waitFor(() => expect((screen.getByRole("button", { name: "ابعت الردّ" }) as HTMLButtonElement).disabled).toBe(true));
    fireEvent.input(screen.getByRole("textbox"), { target: { value: "12.5" } });
    await waitFor(() => expect((screen.getByRole("button", { name: "ابعت الردّ" }) as HTMLButtonElement).disabled).toBe(false));
    expect(post).not.toHaveBeenCalled();
  });
});
