/** @format */

// Phase 2 (Governance & Portal project) — small pure helpers for product
// image validation, pulled out of src/routes/bom.ts so they can be unit
// tested without a database.

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2MB decoded

const DATA_URL_PATTERN = /^data:image\/(png|jpe?g|webp);base64,/;

export function isValidImageDataUrl(dataUrl: string): boolean {
  return DATA_URL_PATTERN.test(dataUrl);
}

// Approximate decoded byte length from a base64 payload's string length,
// without actually decoding it — cheap and accurate enough for a size guard
// (base64 encodes 3 bytes as 4 characters, so decodedBytes ≈ base64Length * 3/4).
export function approxDecodedBytes(dataUrl: string): number {
  const base64 = dataUrl.split(",")[1] || "";
  return Math.floor((base64.length * 3) / 4);
}

export function assertImageDataUrlOk(dataUrl: string): void {
  if (!isValidImageDataUrl(dataUrl)) {
    throw Object.assign(
      new Error("لازم تكون صورة بصيغة png أو jpg أو webp"),
      { status: 400 },
    );
  }
  if (approxDecodedBytes(dataUrl) > MAX_IMAGE_BYTES) {
    throw Object.assign(
      new Error("حجم الصورة كبير أوي — الحد الأقصى 2 ميجا"),
      { status: 400 },
    );
  }
}

// Given the sort orders already used by a recipe's secondary images, returns
// the sort order the next newly-added secondary image should get (appended
// at the end of the gallery).
export function nextSecondarySortOrder(existingSortOrders: number[]): number {
  if (!existingSortOrders.length) return 0;
  return Math.max(...existingSortOrders) + 1;
}
