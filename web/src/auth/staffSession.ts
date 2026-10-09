import { createSessionStore } from "./session";
/** موظفين الشركة (ERP): sessionStorage بس. */
export const staffSession = createSessionStore("hyper_erp_session", { allowLocal: false });
