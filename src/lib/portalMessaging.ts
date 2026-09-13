/**
 * Portal messaging boundary.
 *
 * Message contents are handed to otpDelivery's server-side adapter and are
 * never logged or returned from this module.
 */
import {
  sendCustomerAlert,
  type DeliveryAdapter,
} from "./otpDelivery";

export type PortalSmsInput = {
  phone: string;
  message: string;
};

export type PortalSmsResult = {
  delivered: boolean;
};

/**
 * Send a portal SMS.
 */
export async function sendPortalSms(
  { phone, message }: PortalSmsInput,
  options: Readonly<{ adapter?: DeliveryAdapter }> = {},
): Promise<PortalSmsResult> {
  const result = await sendCustomerAlert(
    {
      channel: "phone",
      destination: phone,
      message,
      event: "portal_sms_activation",
    },
    options,
  );
  return { delivered: result.delivered };
}