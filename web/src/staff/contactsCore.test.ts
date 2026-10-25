import { describe, expect, it } from "vitest";
import { canWriteContacts, contactCounts, draftErrors, emptyDraft, filterContacts, initials, intlPhone, sortContacts, telLink, toBody, waLink, type ContactRow } from "./contactsCore";

const row = (o: Partial<ContactRow>): ContactRow => ({ id: 1, type: "customer", name: "عميل", company: null, phone: null, email: null, address: null, city: null, segment: null, notes: null, ownerUserId: null, createdAt: "2026-10-01T00:00:00Z", salesCount: 0, poCount: 0, ...o });
const ROWS = [
  row({ id: 1, name: "أحمد للتجارة", type: "customer", phone: "01001234567", city: "القاهرة", segment: "preferred", salesCount: 5, createdAt: "2026-10-02T00:00:00Z" }),
  row({ id: 2, name: "مورد الخامات", type: "supplier", company: "شركة النور", phone: "+20 122 333 4444", poCount: 9, createdAt: "2026-10-03T00:00:00Z" }),
  row({ id: 3, name: "الأمل", type: "both", city: "الجيزة", salesCount: 1, poCount: 1, createdAt: "2026-10-01T00:00:00Z" }),
];

describe("الأعداد والفلترة", () => {
  it("العدّاد: النوع both بيتحسب مورد وعميل", () => {
    expect(contactCounts(ROWS)).toEqual({ total: 3, suppliers: 2, customers: 2, both: 1 });
  });
  it("تبويب الموردين بيشمل both، والعملاء كمان", () => {
    const f = (tab: "all" | "customer" | "supplier") => filterContacts(ROWS, { tab, search: "", city: "", segment: "" }).map((r) => r.id);
    expect(f("supplier")).toEqual([2, 3]);
    expect(f("customer")).toEqual([1, 3]);
    expect(f("all")).toEqual([1, 2, 3]);
  });
  it("البحث بالاسم والشركة والمدينة والتليفون بأي صيغة", () => {
    const s = (q: string) => filterContacts(ROWS, { tab: "all", search: q, city: "", segment: "" }).map((r) => r.id);
    expect(s("النور")).toEqual([2]);
    expect(s("الجيزة")).toEqual([3]);
    expect(s("100 123")).toEqual([1]);
    expect(s("٠١٢٢٣٣٣٤٤٤٤")).toEqual([2]);
    expect(s("12")).toEqual([]);
  });
  it("فلتر المحافظة والتصنيف", () => {
    expect(filterContacts(ROWS, { tab: "all", search: "", city: "القاهرة", segment: "" }).map((r) => r.id)).toEqual([1]);
    expect(filterContacts(ROWS, { tab: "all", search: "", city: "", segment: "preferred" }).map((r) => r.id)).toEqual([1]);
  });
  it("الترتيب: بالاسم، الأحدث، الأنشط", () => {
    expect(sortContacts(ROWS, "recent").map((r) => r.id)).toEqual([2, 1, 3]);
    expect(sortContacts(ROWS, "activity").map((r) => r.id)).toEqual([2, 1, 3]);
    expect(sortContacts(ROWS, "name")).toHaveLength(3);
  });
});

describe("الهاتف والروابط", () => {
  it("بيحوّل الصيغ المصرية لرقم دولي", () => {
    expect(intlPhone("01001234567")).toBe("201001234567");
    expect(intlPhone("+20 100 123 4567")).toBe("201001234567");
    expect(intlPhone("00201001234567")).toBe("201001234567");
    expect(intlPhone("١٠٠١٢٣٤٥٦٧")).toBe("201001234567");
    expect(intlPhone("123")).toBeNull();
    expect(intlPhone(null)).toBeNull();
  });
  it("روابط الاتصال والواتساب", () => {
    expect(telLink("01001234567")).toBe("tel:+201001234567");
    expect(waLink("01001234567")).toBe("https://wa.me/201001234567");
    expect(waLink("")).toBeNull();
  });
});

describe("المسودة", () => {
  it("التحقق: الاسم مطلوب، والتليفون والإيميل اختياريين لكن لازم يبقوا صح", () => {
    expect(draftErrors(emptyDraft())).toEqual({ name: true, phone: false, email: false });
    expect(draftErrors({ ...emptyDraft(), name: "س", phone: "12", email: "x" })).toEqual({ name: false, phone: true, email: true });
    expect(draftErrors({ ...emptyDraft(), name: "س", phone: "01001234567", email: "a@b.co" })).toEqual({ name: false, phone: false, email: false });
  });
  it("الجسم المبعوت: القيم الفاضية null، والمسافات بتتقص", () => {
    expect(toBody({ ...emptyDraft("supplier"), name: "  مورد  ", phone: " 0100 " })).toEqual({ type: "supplier", name: "مورد", company: null, phone: "0100", email: null, city: null, segment: null, address: null, notes: null });
  });
  it("الأدوار والحروف الأولى", () => {
    expect(canWriteContacts("sales_manager")).toBe(true);
    expect(canWriteContacts("executive_manager")).toBe(false);
    expect(initials("أحمد علي")).toBe("أع");
    expect(initials("الأمل")).toBe("ال");
  });
});
