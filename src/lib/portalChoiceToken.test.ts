import { describe, expect, it } from "vitest";

process.env.JWT_SECRET ??= "test-secret-long-enough-for-hmac-1234567";
const { makeChoiceToken, readChoiceToken } = await import("./portalChoiceToken");

describe("portal choice token", () => {
  it("round-trips", () => {
    const t = makeChoiceToken(5, true, 1000);
    expect(readChoiceToken(t, 2000)).toEqual({ userId: 5, rememberMe: true });
  });
  it("expires after 5 minutes", () => {
    const t = makeChoiceToken(5, false, 0);
    expect(readChoiceToken(t, 5 * 60_000 + 1)).toBeNull();
  });
  it("rejects tampering", () => {
    const t = makeChoiceToken(5, false, 1000);
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ u: 6, r: 0, e: 9e12 })).toString("base64url");
    expect(readChoiceToken(`${forged}.${sig}`, 2000)).toBeNull();
    expect(readChoiceToken(`${body}.x${sig}`, 2000)).toBeNull();
    expect(readChoiceToken("garbage", 2000)).toBeNull();
  });
});
