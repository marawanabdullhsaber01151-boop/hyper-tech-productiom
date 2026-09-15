import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const correlationIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;

declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
    }
  }
}

function safeCorrelationId(value: string | undefined): string {
  if (value && correlationIdPattern.test(value)) return value;
  return randomUUID();
}

export function requestContext(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const correlationId = safeCorrelationId(req.get("x-correlation-id"));
  req.correlationId = correlationId;
  res.setHeader("X-Correlation-Id", correlationId);
  next();
}