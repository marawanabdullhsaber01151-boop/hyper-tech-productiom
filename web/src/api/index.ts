import { portalSession } from "../auth/portalSession";
import { staffSession } from "../auth/staffSession";
import { createApiClient } from "./client";

export { ApiError, createApiClient } from "./client";
export { useQuery, useMutation } from "./hooks";

/** عميل البوابة (توكن العميل). */
export const portalApi = createApiClient({ session: portalSession });
/** عميل الموظفين (توكن الـ ERP). */
export const staffApi = createApiClient({ session: staffSession });
