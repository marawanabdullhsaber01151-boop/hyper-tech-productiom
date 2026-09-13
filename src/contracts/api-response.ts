import { z } from "zod";

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
  reference: z.string().optional(),
});

export const apiErrorResponseSchema = z.object({
  error: apiErrorSchema,
});

export type ApiError = z.infer<typeof apiErrorSchema>;
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;

export type ApiSuccess<T> = {
  data: T;
  message?: string;
  meta?: Record<string, unknown>;
};

export function success<T>(
  data: T,
  options: Omit<ApiSuccess<T>, "data"> = {},
): ApiSuccess<T> {
  return { data, ...options };
}

export function failure(
  code: string,
  message: string,
  options: Pick<ApiError, "details" | "reference"> = {},
): ApiErrorResponse {
  return { error: { code, message, ...options } };
}