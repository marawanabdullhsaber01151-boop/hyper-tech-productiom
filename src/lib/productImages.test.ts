/** @format */

import { describe, expect, it } from "vitest";
import {
  isValidImageDataUrl,
  approxDecodedBytes,
  assertImageDataUrlOk,
  nextSecondarySortOrder,
  MAX_IMAGE_BYTES,
} from "./productImages";

function fakeDataUrl(mime: string, base64Length: number) {
  return `data:image/${mime};base64,${"A".repeat(base64Length)}`;
}

describe("isValidImageDataUrl", () => {
  it("accepts png/jpg/jpeg/webp data URLs", () => {
    expect(isValidImageDataUrl("data:image/png;base64,AAAA")).toBe(true);
    expect(isValidImageDataUrl("data:image/jpg;base64,AAAA")).toBe(true);
    expect(isValidImageDataUrl("data:image/jpeg;base64,AAAA")).toBe(true);
    expect(isValidImageDataUrl("data:image/webp;base64,AAAA")).toBe(true);
  });

  it("rejects non-image data URLs and plain strings", () => {
    expect(isValidImageDataUrl("data:application/pdf;base64,AAAA")).toBe(
      false,
    );
    expect(isValidImageDataUrl("not-a-data-url")).toBe(false);
    expect(isValidImageDataUrl("")).toBe(false);
  });
});

describe("assertImageDataUrlOk", () => {
  it("does not throw for a small, valid image", () => {
    expect(() => assertImageDataUrlOk(fakeDataUrl("png", 100))).not.toThrow();
  });

  it("throws a clear Arabic 400 error for an invalid format", () => {
    expect(() => assertImageDataUrlOk("data:application/pdf;base64,AAAA")).toThrow();
    try {
      assertImageDataUrlOk("not-a-data-url");
    } catch (e: any) {
      expect(e.status).toBe(400);
      expect(e.message).toContain("png");
    }
  });

  it("throws a clear Arabic 400 error when the image exceeds the size cap", () => {
    // base64Length * 3/4 must exceed MAX_IMAGE_BYTES
    const tooLongBase64 = Math.ceil((MAX_IMAGE_BYTES / 3) * 4) + 100;
    const bigDataUrl = fakeDataUrl("png", tooLongBase64);
    expect(approxDecodedBytes(bigDataUrl)).toBeGreaterThan(MAX_IMAGE_BYTES);
    try {
      assertImageDataUrlOk(bigDataUrl);
      throw new Error("expected assertImageDataUrlOk to throw");
    } catch (e: any) {
      expect(e.status).toBe(400);
      expect(e.message).toContain("2 ميجا");
    }
  });
});

describe("nextSecondarySortOrder", () => {
  it("returns 0 when there are no existing secondary images", () => {
    expect(nextSecondarySortOrder([])).toBe(0);
  });

  it("returns one more than the current maximum sort order", () => {
    expect(nextSecondarySortOrder([0, 1, 2])).toBe(3);
    expect(nextSecondarySortOrder([5])).toBe(6);
    // Order of the input array shouldn't matter — it should still find the max.
    expect(nextSecondarySortOrder([4, 0, 2])).toBe(5);
  });
});
