import type { NextFunction, Request, Response } from "express";

const statusCodes: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  422: "VALIDATION_ERROR",
};

/**
 * Compatibility boundary for legacy routes.
 *
 * New handlers can return the contract directly. Older handlers can continue
 * returning their established payload while this middleware guarantees that
 * every API response has one transport shape.
 */
export function apiEnvelope(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith("/api/")) {
    next();
    return;
  }

  const originalJson = res.json.bind(res);
  res.json = ((payload: unknown) => {
    if (res.statusCode >= 400) {
      const body =
        payload && typeof payload === "object"
          ? (payload as Record<string, any>)
          : {};
      if (body.error && typeof body.error === "object") {
        body.error = {
          code: body.error.code || statusCodes[res.statusCode] || "HTTP_ERROR",
          message: body.error.message || "تعذر إتمام الطلب",
          ...(body.error.details !== undefined
            ? { details: body.error.details }
            : {}),
          ...(body.error.reference
            ? { reference: body.error.reference }
            : {}),
        };
        return originalJson(body);
      }
      return originalJson({
        error: {
          code: statusCodes[res.statusCode] || "HTTP_ERROR",
          message:
            typeof body.message === "string"
              ? body.message
              : "تعذر إتمام الطلب",
        },
      });
    }

    if (
      payload &&
      typeof payload === "object" &&
      ("data" in payload || "error" in payload)
    ) {
      return originalJson(payload);
    }
    return originalJson({ data: payload });
  }) as Response["json"];

  next();
}