/** @format */

import { describe, expect, it } from "vitest";
import {
  pieceQtyFromCartonQty,
  cartonQtyFromPieceQty,
  suggestCartonCompletion,
} from "./cartonConversion";

const boxOf12 = { cartonUnit: "box", piecesPerCarton: 12 };

describe("piece/carton conversion math", () => {
  it("converts cartons to pieces", () => {
    expect(pieceQtyFromCartonQty(5, boxOf12)).toBe(60);
    expect(pieceQtyFromCartonQty(0, boxOf12)).toBe(0);
  });

  it("converts pieces to cartons, including fractional results", () => {
    expect(cartonQtyFromPieceQty(60, boxOf12)).toBe(5);
    expect(cartonQtyFromPieceQty(130, boxOf12)).toBeCloseTo(10.833, 2);
  });
});

describe("suggestCartonCompletion", () => {
  it("suggests rounding up when the quantity does not complete a whole carton", () => {
    // 130 pieces, min order 100, box of 12 → 130/12 = 10.83 → round up to 11 → 132
    const result = suggestCartonCompletion(130, boxOf12, 100);
    expect(result).toEqual({
      needsSuggestion: true,
      suggestedPieceQty: 132,
      suggestedCartonQty: 11,
    });
  });

  it("does not suggest anything when the quantity already completes whole cartons", () => {
    const result = suggestCartonCompletion(120, boxOf12, 100);
    expect(result.needsSuggestion).toBe(false);
    expect(result.suggestedPieceQty).toBeNull();
  });

  it("does not suggest anything below the minimum order quantity (that's a separate hard rule)", () => {
    const result = suggestCartonCompletion(5, boxOf12, 100);
    expect(result.needsSuggestion).toBe(false);
  });

  it("is a soft suggestion right at the minimum-quantity boundary too", () => {
    // exactly at minimum, but not a full carton multiple → still suggested
    const result = suggestCartonCompletion(100, boxOf12, 100);
    expect(result.needsSuggestion).toBe(true);
    expect(result.suggestedPieceQty).toBe(108); // ceil(100/12)=9 → 9*12=108
  });

  it("never suggests anything when the product has no carton conversion at all", () => {
    const result = suggestCartonCompletion(130, null, 100);
    expect(result.needsSuggestion).toBe(false);
  });

  it("never suggests anything when the 'conversion' factor is 1 or less (not a real carton)", () => {
    const result = suggestCartonCompletion(130, { cartonUnit: "x", piecesPerCarton: 1 }, 100);
    expect(result.needsSuggestion).toBe(false);
  });

  it("treats non-finite quantities safely (never throws, never suggests)", () => {
    expect(suggestCartonCompletion(NaN, boxOf12, 100).needsSuggestion).toBe(
      false,
    );
  });
});
