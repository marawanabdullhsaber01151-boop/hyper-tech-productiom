import { createSessionStore } from "./session";
/** عملاء البوابة: localStorage لو "افضل مسجّل". */
export const portalSession = createSessionStore("hyper_erp_portal_session", { allowLocal: true });
