import * as zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildXlsx, colRef, crc32, sheetName, xmlText } from "./xlsxWriter";

/** قارئ zip صغير للاختبار (بيقرا الـlocal headers). */
function unzip(buf: Buffer): Map<string, { text: string; crc: number; data: Buffer }> {
  const out = new Map<string, { text: string; crc: number; data: Buffer }>();
  let p = 0;
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const method = buf.readUInt16LE(p + 8);
    const crc = buf.readUInt32LE(p + 14);
    const csize = buf.readUInt32LE(p + 18);
    const nlen = buf.readUInt16LE(p + 26);
    const name = buf.subarray(p + 30, p + 30 + nlen).toString("utf8");
    const body = buf.subarray(p + 30 + nlen, p + 30 + nlen + csize);
    const data = method === 8 ? zlib.inflateRawSync(body) : Buffer.from(body);
    out.set(name, { text: data.toString("utf8"), crc, data });
    p += 30 + nlen + csize;
  }
  return out;
}

describe("كاتب xlsx", () => {
  const xlsx = buildXlsx([{
    name: "تقرير: المبيعات/2026",
    columns: [{ header: "الاسم", kind: "text" }, { header: "الكمية", kind: "qty" }, { header: "المبلغ", kind: "money" }],
    rows: [["شركة & أبناؤه <x>", 10.5, "22.05"], ["=HYPERLINK(\"http://x\")", null, "abc"]],
    totals: ["الإجمالي (2)", 10.5, "22.05"],
  }]);
  const files = unzip(xlsx);

  it("zip سليم: الملفات المطلوبة وبصمة كل ملف مطابقة", () => {
    expect([...files.keys()].sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"]);
    for (const f of files.values()) expect(crc32(f.data)).toBe(f.crc);
    const native = (zlib as unknown as { crc32?: (b: Buffer) => number }).crc32;
    if (native) for (const f of files.values()) expect(native(f.data) >>> 0).toBe(f.crc);
  });
  it("كل ملف XML صالح الشكل (فتح/قفل الوسوم)", () => {
    for (const [name, f] of files) {
      expect(f.text.startsWith("<?xml"), name).toBe(true);
      const open = (f.text.match(/<[A-Za-z][^>]*(?<!\/)>/g) ?? []).length;
      const close = (f.text.match(/<\/[A-Za-z][^>]*>/g) ?? []).length;
      expect(open, name).toBe(close);
    }
  });
  it("الورقة من اليمين لليسار وفيها الأرقام كأرقام والنص نص", () => {
    const s = files.get("xl/worksheets/sheet1.xml")!.text;
    expect(s).toContain('rightToLeft="1"');
    expect(s).toContain("<v>10.5</v>");
    expect(s).toContain("<v>22.05</v>");
    expect(s).toContain("الاسم");
  });
  it("المعادلات والرموز الخاصة بتتحوّل لنص آمن", () => {
    const s = files.get("xl/worksheets/sheet1.xml")!.text;
    expect(s).not.toContain("<f>");
    expect(s).toContain("شركة &amp; أبناؤه &lt;x&gt;");
    expect(s).toContain("=HYPERLINK(&quot;http://x&quot;)");
  });
  it("المبلغ الفاسد بيتكتب نص مش رقم، والفاضي خلية فاضية", () => {
    const s = files.get("xl/worksheets/sheet1.xml")!.text;
    expect(s).toContain('<c r="C3" s="0" t="inlineStr">');
    expect(s).toContain('<c r="B3" s="0"/>');
  });
  it("صف الإجماليات عريض", () => {
    const s = files.get("xl/worksheets/sheet1.xml")!.text;
    expect(s).toContain('<c r="A4" s="5" t="inlineStr">');
    expect(s).toContain('<c r="C4" s="8"><v>22.05</v></c>');
  });
  it("اسم الورقة بيتنضف", () => {
    expect(sheetName("تقرير: المبيعات/2026")).toBe("تقرير  المبيعات 2026");
    expect(sheetName("x".repeat(50))).toHaveLength(31);
    expect(sheetName("[]")).toBe("Sheet1");
    expect(files.get("xl/workbook.xml")!.text).toContain('name="تقرير  المبيعات 2026"');
  });
  it("أدوات صغيرة", () => {
    expect(colRef(0)).toBe("A");
    expect(colRef(25)).toBe("Z");
    expect(colRef(26)).toBe("AA");
    expect(colRef(701)).toBe("ZZ");
    expect(colRef(702)).toBe("AAA");
    expect(xmlText("a\u0000b&")).toBe("ab&amp;");
    expect(() => buildXlsx([])).toThrow();
  });
});
