import { describe, expect, it } from "vitest";
import {
  ACTIVATION_DEFAULT_TTL_MINUTES,
  ACTIVATION_MAX_TTL_MINUTES,
  ACTIVATION_MIN_TTL_MINUTES,
  buildActivationMessage,
  buildWhatsAppLink,
  clampActivationTtlMinutes,
  makeActivationToken,
} from "./portalActivation";
import { createHash } from "node:crypto";

describe("buildWhatsAppLink", () => {
  const text = "أهلاً\nرابط: https://x.test/a?b=1";
  it.each([
    ["01012345678", "201012345678"],
    ["+201012345678", "201012345678"],
    ["00201012345678", "201012345678"],
    ["0101 234 5678", "201012345678"],
    ["٠١٠١٢٣٤٥٦٧٨", "201012345678"],
  ])("normalizes %s to %s", (input, digits) => {
    const url = buildWhatsAppLink(input, text)!;
    expect(url.startsWith(`https://wa.me/${digits}?text=`)).toBe(true);
    expect(decodeURIComponent(url.split("?text=")[1])).toBe(text);
  });
  it("returns null when there is no usable phone", () => {
    expect(buildWhatsAppLink("", text)).toBeNull();
    expect(buildWhatsAppLink(null, text)).toBeNull();
  });
});

describe("activation lifetime", () => {
  it("defaults and clamps", () => {
    expect(clampActivationTtlMinutes(undefined)).toBe(ACTIVATION_DEFAULT_TTL_MINUTES);
    expect(clampActivationTtlMinutes("abc")).toBe(ACTIVATION_DEFAULT_TTL_MINUTES);
    expect(clampActivationTtlMinutes(1)).toBe(ACTIVATION_MIN_TTL_MINUTES);
    expect(clampActivationTtlMinutes(10 ** 9)).toBe(ACTIVATION_MAX_TTL_MINUTES);
    expect(clampActivationTtlMinutes(180)).toBe(180);
  });
  it("makeActivationToken stores only a sha256 of the raw token", () => {
    const t = makeActivationToken(60);
    expect(t.rawToken.length).toBeGreaterThanOrEqual(43);
    expect(t.tokenHash).toBe(createHash("sha256").update(t.rawToken).digest("hex"));
    const minutes = (t.expiresAt.getTime() - Date.now()) / 60000;
    expect(minutes).toBeGreaterThan(59);
    expect(minutes).toBeLessThan(61);
  });
});

describe("buildActivationMessage", () => {
  it("is short, contains the link, the validity and the support phone", () => {
    const msg = buildActivationMessage(
      "أحمد",
      "https://x.test/portal-activate.html?token=abc",
      new Date(Date.now() + 24 * 60 * 60_000 + 5_000),
      "01055651409",
    );
    expect(msg).toContain("أحمد");
    expect(msg).toContain("https://x.test/portal-activate.html?token=abc");
    expect(msg).toContain("24 ساعة");
    expect(msg).toContain("01055651409");
  });
});
