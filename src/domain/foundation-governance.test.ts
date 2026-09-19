/** @format */
import { describe, expect, it } from "vitest";
import {
  isAllowedFoundationItemTransition,
  assertAllowedFoundationItemTransition,
  isCriticalFoundationItemChange,
  normalizeForDuplicateMatch,
  preValidateImportRow,
  summarizeImportRows,
} from "./foundation-governance";

describe("foundation item status machine (phase 03 delivery 3)", () => {
  it("allows the documented governance flow", () => {
    expect(isAllowedFoundationItemTransition("draft", "pending_approval")).toBe(true);
    expect(isAllowedFoundationItemTransition("pending_approval", "active")).toBe(true);
    expect(isAllowedFoundationItemTransition("pending_approval", "draft")).toBe(true);
    expect(isAllowedFoundationItemTransition("active", "pending_approval")).toBe(true);
    expect(isAllowedFoundationItemTransition("active", "superseded")).toBe(true);
    expect(isAllowedFoundationItemTransition("active", "retired")).toBe(true);
    expect(isAllowedFoundationItemTransition("superseded", "active")).toBe(true);
    expect(isAllowedFoundationItemTransition("retired", "active")).toBe(true);
  });

  it("staying in the same status is always a no-op allow", () => {
    expect(isAllowedFoundationItemTransition("active", "active")).toBe(true);
  });

  it("rejects transitions that skip the review step", () => {
    expect(isAllowedFoundationItemTransition("draft", "active")).toBe(false);
    expect(isAllowedFoundationItemTransition("retired", "pending_approval")).toBe(false);
    expect(isAllowedFoundationItemTransition("superseded", "pending_approval")).toBe(false);
  });

  it("assertAllowedFoundationItemTransition throws a 409 with a stable code", () => {
    try {
      assertAllowedFoundationItemTransition("draft", "active");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as { status?: number }).status).toBe(409);
      expect((err as { code?: string }).code).toBe("INVALID_STATUS_TRANSITION");
    }
  });
});

describe("isCriticalFoundationItemChange", () => {
  it("flags baseUnit/itemType/minStock", () => {
    expect(isCriticalFoundationItemChange({ baseUnit: "kg" })).toBe(true);
    expect(isCriticalFoundationItemChange({ itemType: "wip" })).toBe(true);
    expect(isCriticalFoundationItemChange({ minStock: "5" })).toBe(true);
  });

  it("does not flag descriptive-only changes", () => {
    expect(isCriticalFoundationItemChange({ name: "اسم جديد" })).toBe(false);
    expect(isCriticalFoundationItemChange({ notes: "ملاحظة" })).toBe(false);
    expect(isCriticalFoundationItemChange({ active: false })).toBe(false);
    expect(isCriticalFoundationItemChange({})).toBe(false);
  });

  it("flags a mixed batch that includes even one critical field", () => {
    expect(
      isCriticalFoundationItemChange({ name: "اسم جديد", minStock: "10" }),
    ).toBe(true);
  });
});

describe("normalizeForDuplicateMatch", () => {
  it("treats case, dashes, underscores, and extra spaces as equivalent", () => {
    expect(normalizeForDuplicateMatch("Raw Material 001")).toBe(
      normalizeForDuplicateMatch("raw-material_001"),
    );
    expect(normalizeForDuplicateMatch("  Steel  Bar  ")).toBe(
      normalizeForDuplicateMatch("steel bar"),
    );
  });

  it("does not strip Arabic letters", () => {
    expect(normalizeForDuplicateMatch("مادة خام")).toBe("مادة خام");
  });

  it("does not accidentally equate genuinely different names", () => {
    expect(normalizeForDuplicateMatch("Steel Bar A")).not.toBe(
      normalizeForDuplicateMatch("Steel Bar B"),
    );
  });
});

describe("import row pre-validation (phase 03 delivery 3)", () => {
  it("accepts a well-formed row", () => {
    const result = preValidateImportRow(
      { code: "RM-100", name: "صنف تجريبي", baseUnit: "kg" },
      0,
    );
    expect(result).toEqual({ row: 1, ok: true, code: "RM-100" });
  });

  it("reports every missing required field, 1-based row numbers", () => {
    const result = preValidateImportRow({}, 4);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.row).toBe(5);
      expect(result.errors).toContain("code مطلوب");
      expect(result.errors).toContain("name مطلوب");
      expect(result.errors).toContain("baseUnit مطلوب");
    }
  });

  it("rejects a non-numeric minStock", () => {
    const result = preValidateImportRow(
      { code: "A", name: "ب", baseUnit: "kg", minStock: "abc" },
      0,
    );
    expect(result.ok).toBe(false);
  });

  it("summarizeImportRows only allows apply when every row is ok", () => {
    const clean = [
      preValidateImportRow({ code: "A", name: "ا", baseUnit: "kg" }, 0),
      preValidateImportRow({ code: "B", name: "ب", baseUnit: "kg" }, 1),
    ];
    expect(summarizeImportRows(clean)).toEqual({
      totalRows: 2,
      errorCount: 0,
      okCount: 2,
      canApply: true,
    });

    const dirty = [
      ...clean,
      preValidateImportRow({}, 2),
    ];
    expect(summarizeImportRows(dirty).canApply).toBe(false);
    expect(summarizeImportRows(dirty).errorCount).toBe(1);
  });

  it("an empty batch can never be applied", () => {
    expect(summarizeImportRows([]).canApply).toBe(false);
  });
});
