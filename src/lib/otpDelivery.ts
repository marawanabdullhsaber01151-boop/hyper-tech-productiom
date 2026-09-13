/** @format */
/**
 * Unified, server-side delivery boundary for portal OTPs and customer alerts.
 *
 * This module intentionally owns the only path from a portal workflow to an
 * SMS/email provider. It never logs message contents, OTPs, activation URLs,
 * credentials, or provider response bodies.
 */
import { logger } from "./logger";

export type OtpChannel = "phone" | "email";

export type CustomerAlertInput = Readonly<{
  channel: OtpChannel;
  destination: string;
  message: string;
  event?: string;
}>;

export type DeliveryResult = Readonly<{
  delivered: boolean;
  provider: string;
}>;

type DeliveryAdapterResult = Readonly<{
  delivered: boolean;
}>;

export type DeliveryAdapter = Readonly<{
  /**
   * The runtime guard prevents a test adapter from being injected into
   * production by accident.
   */
  mode: "production" | "test";
  provider: string;
  send: (input: CustomerAlertInput) => Promise<DeliveryAdapterResult>;
}>;

type ProviderConfiguration = Readonly<{
  apiKey: string;
  endpoint: string;
  sender: string;
}>;

const DELIVERY_TIMEOUT_MS = 10_000;

function readProviderConfiguration(
  channel: OtpChannel,
): ProviderConfiguration | undefined {
  const prefix =
    channel === "phone" ? "PORTAL_SMS_PROVIDER" : "PORTAL_EMAIL_PROVIDER";
  const apiKey = process.env[`${prefix}_API_KEY`]?.trim();
  const endpoint = process.env[`${prefix}_URL`]?.trim();
  const sender = process.env[`${prefix}_FROM`]?.trim();

  if (!apiKey || !endpoint || !sender) return undefined;
  return { apiKey, endpoint, sender };
}

function maskDestination(destination: string, channel: OtpChannel): string {
  if (channel === "email") {
    const [localPart, domain = ""] = destination.split("@");
    return `${localPart?.slice(0, 1) ?? "*"}***@${domain}`;
  }

  return `***${destination.slice(-2)}`;
}

function logSafeDeliveryFailure(
  input: CustomerAlertInput,
  reason: "provider_configuration_missing" | "provider_request_failed",
  provider = "unconfigured",
  status?: number,
): void {
  logger.warn("Portal message was not delivered", {
    event: input.event ?? "portal_customer_alert",
    channel: input.channel,
    destination: maskDestination(input.destination, input.channel),
    delivered: false,
    provider,
    reason,
    ...(status === undefined ? {} : { status }),
  });
}

/**
 * Generic HTTPS provider adapter.
 *
 * The configured endpoint must accept:
 * { channel, to, from, message, event }
 * and an Authorization: Bearer header. Provider-specific credentials stay in
 * the server environment and are never returned or logged.
 */
function createHttpDeliveryAdapter(
  channel: OtpChannel,
  configuration: ProviderConfiguration,
): DeliveryAdapter {
  return {
    mode: "production",
    provider: "configured_http_provider",
    async send(input) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

      try {
        const response = await fetch(configuration.endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${configuration.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            channel,
            to: input.destination,
            from: configuration.sender,
            message: input.message,
            event: input.event ?? "portal_customer_alert",
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          logger.error("Portal message provider rejected delivery", {
            event: input.event ?? "portal_customer_alert",
            channel: input.channel,
            delivered: false,
            provider: "configured_http_provider",
            status: response.status,
          });
          return { delivered: false };
        }

        return { delivered: true };
      } catch {
        logger.error("Portal message provider request failed", {
          event: input.event ?? "portal_customer_alert",
          channel: input.channel,
          delivered: false,
          provider: "configured_http_provider",
        });
        return { delivered: false };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function createUnavailableDeliveryAdapter(
  input: CustomerAlertInput,
): DeliveryAdapter {
  return {
    mode: "production",
    provider: "unconfigured",
    async send() {
      logSafeDeliveryFailure(input, "provider_configuration_missing");
      return { delivered: false };
    },
  };
}

/**
 * Resolve the production adapter from server-side environment configuration.
 * There is no development fallback that claims delivery.
 */
export function createProductionDeliveryAdapter(
  input: CustomerAlertInput,
): DeliveryAdapter {
  const configuration = readProviderConfiguration(input.channel);
  return configuration ?
      createHttpDeliveryAdapter(input.channel, configuration)
    : createUnavailableDeliveryAdapter(input);
}

/**
 * Test-only adapter factory. It is deliberately impossible to construct in
 * production, even if a caller accidentally passes NODE_ENV=production.
 */
export function createTestDeliveryAdapter(
  delivered = true,
): DeliveryAdapter {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Test delivery adapter is not allowed in production");
  }

  return {
    mode: "test",
    provider: "test",
    async send() {
      return { delivered };
    },
  };
}

/**
 * Send a customer-facing message.
 */
export async function sendCustomerAlert(
  input: CustomerAlertInput,
  options: Readonly<{ adapter?: DeliveryAdapter }> = {},
): Promise<DeliveryResult> {
  const adapter = options.adapter ?? createProductionDeliveryAdapter(input);

  if (process.env.NODE_ENV === "production" && adapter.mode !== "production") {
    logger.error("Portal message delivery adapter rejected", {
      event: input.event ?? "portal_customer_alert",
      channel: input.channel,
      delivered: false,
      provider: "invalid_test_adapter",
    });
    return { delivered: false, provider: "invalid_adapter" };
  }

  const result = await adapter.send(input);
  if (!result.delivered && adapter.provider !== "unconfigured") {
    logSafeDeliveryFailure(input, "provider_request_failed", adapter.provider);
  }

  return { delivered: result.delivered, provider: adapter.provider };
}

export async function sendOtpCode(
  {
    channel,
    destination,
    code,
  }: {
    channel: OtpChannel;
    destination: string;
    code: string;
  },
  options: Readonly<{ adapter?: DeliveryAdapter }> = {},
): Promise<DeliveryResult> {
  return sendCustomerAlert(
    {
      channel,
      destination,
      message: `رمز استرجاع كلمة المرور الخاص بك هو: ${code}`,
      event: "portal_otp_password_reset",
    },
    options,
  );
}