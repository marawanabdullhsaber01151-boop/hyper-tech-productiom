import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPortalActivationUrl,
  validatePortalPublicUrl,
} from "./portalConfig";

afterEach(() => {
  vi.unstubAllEnvs();
});

function requestWithHost(host: string) {
  return {
    protocol: "https",
    get: () => host,
  } as never;
}

describe("portal public URL configuration", () => {
  it("builds the activation URL from the configured origin, not Host", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PORTAL_PUBLIC_URL", "https://example.com");

    expect(
      buildPortalActivationUrl(
        requestWithHost("attacker.example"),
        "test-token-123",
      ),
    ).toBe(
      "https://example.com/portal-activate.html?token=test-token-123",
    );
  });

  it("rejects a configured path", () => {
    expect(() =>
      validatePortalPublicUrl(
        "https://example.com/portal.html",
        "production",
      ),
    ).toThrow("must contain only the origin");
  });

  it("rejects http in production", () => {
    expect(() =>
      validatePortalPublicUrl("http://example.com", "production"),
    ).toThrow("must use https in production");
  });

  it("allows a local http origin outside production", () => {
    expect(validatePortalPublicUrl("http://localhost:3000", "development")).toBe(
      "http://localhost:3000",
    );
  });
});