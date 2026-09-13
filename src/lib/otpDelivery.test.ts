import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTestDeliveryAdapter,
  sendCustomerAlert,
} from "./otpDelivery";
import { sendPortalSms } from "./portalMessaging";

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  delete process.env.PORTAL_SMS_PROVIDER_API_KEY;
  delete process.env.PORTAL_SMS_PROVIDER_URL;
  delete process.env.PORTAL_SMS_FROM;
  delete process.env.PORTAL_EMAIL_PROVIDER_API_KEY;
  delete process.env.PORTAL_EMAIL_PROVIDER_URL;
  delete process.env.PORTAL_EMAIL_PROVIDER_FROM;
});

describe("portal delivery security boundary", () => {
  it("never writes an OTP or activation URL to logger output", async () => {
    const logOutput = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const errorOutput = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const infoOutput = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    const otp = "123456";
    const activationUrl =
      "https://example.test/activate?token=raw-secret-activation-token";

    const result = await sendCustomerAlert({
      channel: "phone",
      destination: "01151774776",
      message: `OTP ${otp}; activate at ${activationUrl}`,
      event: "portal_activation",
    });

    expect(result).toEqual({ delivered: false, provider: "unconfigured" });
    const output = [...logOutput.mock.calls, ...errorOutput.mock.calls, ...infoOutput.mock.calls]
      .flat()
      .join(" ");
    expect(output).not.toContain(otp);
    expect(output).not.toContain(activationUrl);
    expect(output).not.toContain("raw-secret-activation-token");
  });

  it("returns delivered=false when no real channel is configured", async () => {
    const result = await sendCustomerAlert({
      channel: "email",
      destination: "customer@example.test",
      message: "safe message",
    });

    expect(result).toEqual({ delivered: false, provider: "unconfigured" });
  });

  it("keeps the test adapter out of production", () => {
    process.env.NODE_ENV = "production";
    expect(() => createTestDeliveryAdapter()).toThrow(
      "Test delivery adapter is not allowed in production",
    );
  });

  it("delivers through an injected test adapter without returning the secret", async () => {
    const result = await sendPortalSms(
      {
        phone: "01151774776",
        message:
          "https://example.test/activate?token=raw-secret-activation-token",
      },
      { adapter: createTestDeliveryAdapter(true) },
    );

    expect(result).toEqual({ delivered: true });
    expect(JSON.stringify(result)).not.toContain("raw-secret-activation-token");
  });
});