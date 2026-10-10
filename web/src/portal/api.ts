import { createApiClient } from "../api/client";
import { portalSession } from "../auth/portalSession";

let onExpired: () => void = () => undefined;
export const setOnExpired = (fn: () => void) => {
  onExpired = fn;
};

/** عميل الـ API بتاع البوابة: التوكن من نفس مفتاح الجلسة القديم. */
export const api = createApiClient({ session: portalSession, onUnauthorized: () => onExpired() });
