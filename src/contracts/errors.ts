import type { ApiErrorResponse } from "./api-response";

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "DUPLICATE_ENTRY"
  | "FOREIGN_KEY_VIOLATION"
  | "INTERNAL_SERVER_ERROR"
  | "DOMAIN_ERROR";

export class HttpError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | string;
  readonly details?: unknown;

  constructor(
    status: number,
    code: ApiErrorCode | string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isHttpError(
  error: unknown,
): error is HttpError & { status: number } {
  return (
    error instanceof Error &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
  );
}

export function getClientError(
  error: unknown,
): ApiErrorResponse["error"] | undefined {
  if (!isHttpError(error)) return undefined;
  return {
    code: error.code,
    message: error.message,
    details: error.details,
  };
}