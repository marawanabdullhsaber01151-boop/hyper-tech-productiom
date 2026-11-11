import { describe, expect, it } from "vitest";
import { analyzeRows, cleanRow, headerKey, mapHeaders, rowsFromTable, rowsToCreate, summarizeRows, type ExistingContact, type ImportRow } from "./contactsImportCore";

const R = (o: Partial<ImportRow> = {}): ImportRow => ({ name: "أحمد علي", company: "", phone: "", email: "", address: "", city: "", notes: "", ...o });
const raw = (rows: ImportRow[]) => rows.map((r, i) => ({ line: i + 2, raw: r }));
const C = (o: Partial<ExistingContact> & { id: number }): ExistingContact => ({ name: "س", company: null, phone: null, email: null, ...o });

describe("عناوين الأعمدة", () => {
  it("بتفهم عربي وإنجليزي وتشكيل وهمزات", () => {
    expect(headerKey("  الشَّركة ")).toBe(headerKey("الشركة"));
    expect(headerKey("البريد الإلكتروني")).toBe("البريدالالكتروني");
    const h = mapHeaders(["الاسم", "اسم الشركة", "Mobile", "E-mail", "المحافظة", "حاجة غريبة"]);
    expect(h.map).toEqual(["name", "company", "phone", "email", "city", null]);
    expect(h.unknown).toEqual(["حاجة غريبة"]);
  });
  it("أول عمود لكل حقل بيكسب والتاني بيتجاهل", () => {
    const h = mapHeaders(["name", "الاسم", "phone"]);
    expect(h.map).toEqual(["name", null, "phone"]);
    expect(h.unknown).toEqual(["الاسم"]);
  });
});

describe("الجدول", () => {
  it("بيحوّل الصفوف ويحسب رقم السطر ويشيل الفاضي", () => {
    const r = rowsFromTable([["الاسم", "التليفون"], ["أحمد", "0100"], ["", ""], ["سعيد", "0111"]]);
    expect(r.error).toBeNull();
    expect(r.rows.map((x) => x.line)).toEqual([2, 4]);
    expect(r.rows[0]!.raw.phone).toBe("0100");
  });
  it("أخطاء: فاضي، من غير عمود اسم، كتير", () => {
    expect(rowsFromTable([]).error).toBe("EMPTY");
    expect(rowsFromTable([["الاسم"]]).error).toBe("EMPTY");
    expect(rowsFromTable([["الشركة"], ["x"]]).error).toBe("NO_NAME_COLUMN");
    const many = [["الاسم"], ...Array.from({ length: 501 }, (_, i) => [`عميل ${i}`])];
    expect(rowsFromTable(many).error).toBe("TOO_MANY_ROWS");
    expect(rowsFromTable([Array.from({ length: 31 }, () => "x")]).error).toBe("TOO_MANY_COLUMNS");
  });
});

describe("تنضيف الصف", () => {
  it("الهاتف +20 والإيميل صغير", () => {
    const { row, issues } = cleanRow(R({ phone: "٠١٠٠ ١٢٣ ٤٥٦٧", email: " A@B.COM " }));
    expect(issues).toEqual([]);
    expect(row.phone).toBe("+201001234567");
    expect(row.email).toBe("a@b.com");
  });
  it("كل المشاكل", () => {
    expect(cleanRow(R({ name: "ا", phone: "12", email: "x" })).issues.sort()).toEqual(["BAD_EMAIL", "BAD_PHONE", "NO_NAME"]);
    expect(cleanRow(R({ notes: "x".repeat(301) })).issues).toEqual(["TOO_LONG"]);
  });
});

describe("كشف التكرار", () => {
  it("نفس التليفون بأي شكل = موجود", () => {
    const [a] = analyzeRows(raw([R({ phone: "0100 123 4567" })]), [C({ id: 9, name: "حد تاني", phone: "+20 100 123 4567" })]);
    expect(a!.status).toBe("exists");
    expect(a!.matches[0]!.id).toBe(9);
    expect(a!.matches[0]!.reason).toBe("phone");
  });
  it("نفس الإيميل = موجود", () => {
    expect(analyzeRows(raw([R({ email: "X@y.com" })]), [C({ id: 1, email: "x@Y.com" })])[0]!.status).toBe("exists");
  });
  it("نفس الشركة واسم متشابه = موجود، ونفس الشركة باسم مختلف = متشابه (قرار الموظف)", () => {
    const ex = [C({ id: 1, name: "أحمد علي", company: "شركة النور للتجارة" })];
    expect(analyzeRows(raw([R({ company: "النور" })]), ex)[0]!.status).toBe("exists");
    const b = analyzeRows(raw([R({ name: "سامي منصور", company: "النور" })]), ex)[0]!;
    expect(b.status).toBe("similar");
    expect(b.matches[0]!.reason).toBe("company");
  });
  it("اسم متشابه (غلطة إملائية) = متشابه، وشركة مختلفة صراحة = مش متشابه", () => {
    expect(analyzeRows(raw([R({ name: "احمد علي" })]), [C({ id: 1, name: "أحمد علىّ" })])[0]!.status).toBe("similar");
    expect(analyzeRows(raw([R({ company: "الأمل" })]), [C({ id: 1, name: "أحمد علي", company: "السلام" })])[0]!.status).toBe("new");
  });
  it("جديد تمامًا", () => {
    expect(analyzeRows(raw([R({ name: "كريم حسن", phone: "01234567890" })]), [C({ id: 1, name: "أحمد علي", phone: "01000000000" })])[0]!.status).toBe("new");
  });
  it("تكرار جوه الملف بيشير للسطر الأول", () => {
    const r = analyzeRows(raw([R({ name: "كريم حسن", phone: "01234567890" }), R({ name: "ولد تاني", phone: "+201234567890" })]), []);
    expect(r.map((x) => x.status)).toEqual(["new", "file_duplicate"]);
    expect(r[1]!.duplicateOfLine).toBe(2);
  });
  it("الصف الغلط بيتعلّم invalid ومبيتقارنش", () => {
    expect(analyzeRows(raw([R({ phone: "1" })]), [])[0]!.status).toBe("invalid");
  });
});

describe("اللي هيتحفظ", () => {
  it("الجديد + المتشابه الموافَق عليه بس", () => {
    const rows = analyzeRows(
      raw([R({ name: "كريم حسن" }), R({ name: "احمد علي" }), R({ name: "ثالث واحد", phone: "01000000000" }), R({ name: "رابع", phone: "1" })]),
      [C({ id: 1, name: "أحمد علي" }), C({ id: 2, name: "x", phone: "01000000000" })],
    );
    expect(rows.map((r) => r.status)).toEqual(["new", "similar", "exists", "invalid"]);
    expect(rowsToCreate(rows, []).map((r) => r.line)).toEqual([2]);
    expect(rowsToCreate(rows, [3, 4]).map((r) => r.line)).toEqual([2, 3]);
    expect(summarizeRows(rows)).toEqual({ total: 4, new: 1, invalid: 1, fileDuplicate: 0, exists: 1, similar: 1 });
  });
});
