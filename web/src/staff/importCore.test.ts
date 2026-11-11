import { describe, expect, it } from "vitest";
import { detectDelimiter, parseDelimited, willCreate } from "./importCore";

describe("parseDelimited", () => {
  it("CSV عادي مع اقتباس وفاصلة وسطر جوه الخلية", () => {
    const t = 'الاسم,الشركة\r\n"أحمد, علي","نور ""الأمل"""\r\n"س\nص",x\r\n';
    expect(parseDelimited(t)).toEqual([["الاسم", "الشركة"], ["أحمد, علي", 'نور "الأمل"'], ["س\nص", "x"]]);
  });
  it("لصق من Excel بتاب، وفاصلة منقوطة، وBOM", () => {
    expect(detectDelimiter("a\tb,c")).toBe("\t");
    expect(detectDelimiter("a;b;c,d")).toBe(";");
    expect(detectDelimiter('"a,b",c')).toBe(",");
    expect(parseDelimited("﻿الاسم;التليفون\nسعيد;010")).toEqual([["الاسم", "التليفون"], ["سعيد", "010"]]);
  });
  it("بيشيل الصفوف الفاضية وآخر سطر من غير نهاية", () => {
    expect(parseDelimited("a,b\n,\n\nc,d")).toEqual([["a", "b"], ["c", "d"]]);
  });
});

describe("willCreate", () => {
  it("جديد + متشابه معلّم", () => {
    const rows = [{ line: 2, status: "new" as const }, { line: 3, status: "similar" as const }, { line: 4, status: "similar" as const }, { line: 5, status: "exists" as const }];
    expect(willCreate(rows, new Set([3]))).toBe(2);
  });
});
