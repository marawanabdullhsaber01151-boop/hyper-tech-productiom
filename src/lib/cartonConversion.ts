/** @format */

// Phase 5 (Governance & Portal project) — carton ↔ piece ordering.
//
// A product's "carton" conversion is read from صفحة البيانات الأساسية
// (foundation_unit_conversions): a row where toUnit equals the linked
// Foundation item's base selling unit represents "1 <fromUnit> = <factor>
// <baseUnit>" — e.g. "1 box = 12 piece". The portal always canonicalizes to
// the base unit (pieces) internally; carton is only ever a presentation
// choice at entry time. These are pure functions so the math and the
// incomplete-carton suggestion rule are unit-testable without a database or
// the browser.

export type CartonConversion = {
  cartonUnit: string; // the "fromUnit" — whatever the admin named it (e.g. "box")
  piecesPerCarton: number; // the "factor" — must be a whole number > 1 to be a real carton
};

export function pieceQtyFromCartonQty(
  cartonQty: number,
  conversion: CartonConversion,
): number {
  return cartonQty * conversion.piecesPerCarton;
}

export function cartonQtyFromPieceQty(
  pieceQty: number,
  conversion: CartonConversion,
): number {
  return pieceQty / conversion.piecesPerCarton;
}

export type CartonCompletionSuggestion = {
  needsSuggestion: boolean;
  suggestedPieceQty: number | null;
  suggestedCartonQty: number | null;
};

/**
 * A customer ordering by piece, above the minimum order quantity, whose
 * quantity does not complete a whole number of cartons gets a soft
 * suggestion to round up — never a hard block. Below the minimum quantity is
 * a separate, existing validation (not this function's job — it assumes the
 * quantity has already cleared the minimum-quantity check).
 */
export function suggestCartonCompletion(
  pieceQty: number,
  conversion: CartonConversion | null,
  minOrderQty: number,
): CartonCompletionSuggestion {
  const none: CartonCompletionSuggestion = {
    needsSuggestion: false,
    suggestedPieceQty: null,
    suggestedCartonQty: null,
  };
  if (!conversion || conversion.piecesPerCarton <= 1) return none;
  if (!Number.isFinite(pieceQty) || pieceQty < minOrderQty) return none;
  if (pieceQty % conversion.piecesPerCarton === 0) return none;

  const suggestedCartonQty = Math.ceil(
    pieceQty / conversion.piecesPerCarton,
  );
  return {
    needsSuggestion: true,
    suggestedPieceQty: suggestedCartonQty * conversion.piecesPerCarton,
    suggestedCartonQty,
  };
}
