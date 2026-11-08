import { describe, expect, it } from "vitest";
import { CARD_IDS, DEFAULT_LAYOUT, customizableCards, isDefaultLayout, moveCard, normalizeLayout, toggleCard, visibleCards, type CardId } from "./dashboardLayout";

const all = new Set<CardId>(CARD_IDS);
describe("normalizeLayout", () => {
  it("قيمة فاضية أو فاسدة ترجع الترتيب الأصلي", () => {
    expect(normalizeLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(normalizeLayout("x")).toEqual(DEFAULT_LAYOUT);
  });
  it("بيشيل المجهول والمكرر ويضيف الناقص في الآخر", () => {
    const l = normalizeLayout({ order: ["alerts", "zzz", "alerts", "kpis"], hidden: ["status", "status", "bad"] });
    expect(l.order).toEqual(["alerts", "kpis", "status", "orders", "categories", "summary"]);
    expect(l.hidden).toEqual(["status"]);
  });
});
describe("visibleCards", () => {
  it("بالترتيب المحفوظ من غير المخفي وغير المتاح", () => {
    const l = { order: ["summary", "kpis", "orders", "status", "alerts", "categories"] as CardId[], hidden: ["orders"] as CardId[] };
    expect(visibleCards(l, new Set<CardId>(["summary", "kpis", "orders", "status"]))).toEqual(["summary", "kpis", "status"]);
  });
});
describe("moveCard", () => {
  it("بيبدّل مع الجار الظاهر له", () => {
    expect(moveCard(DEFAULT_LAYOUT, "status", -1, all).order.slice(0, 2)).toEqual(["status", "kpis"]);
    expect(moveCard(DEFAULT_LAYOUT, "kpis", 1, all).order.slice(0, 2)).toEqual(["status", "kpis"]);
  });
  it("الأول لفوق والأخير لتحت مفيش حاجة تتغير", () => {
    expect(moveCard(DEFAULT_LAYOUT, "kpis", -1, all)).toBe(DEFAULT_LAYOUT);
    expect(moveCard(DEFAULT_LAYOUT, "summary", 1, all)).toBe(DEFAULT_LAYOUT);
  });
  it("بيتخطى الكروت اللي مش متاحة للمستخدم", () => {
    const avail = new Set<CardId>(["kpis", "orders"]);
    const m = moveCard(DEFAULT_LAYOUT, "orders", -1, avail);
    expect(customizableCards(m, avail)).toEqual(["orders", "kpis"]);
    expect(m.order.length).toBe(CARD_IDS.length);
  });
});
describe("toggleCard", () => {
  it("إخفاء ثم إظهار", () => {
    const h = toggleCard(DEFAULT_LAYOUT, "alerts");
    expect(h.hidden).toEqual(["alerts"]);
    expect(isDefaultLayout(h)).toBe(false);
    expect(isDefaultLayout(toggleCard(h, "alerts"))).toBe(true);
  });
});
