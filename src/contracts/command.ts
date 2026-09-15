import { z } from "zod";

export type UserId = number & { readonly __brand: "UserId" };
export type CorrelationId = string & { readonly __brand: "CorrelationId" };
export type IdempotencyKey = string & { readonly __brand: "IdempotencyKey" };
export type EntityVersion = number & { readonly __brand: "EntityVersion" };

export const commandHeadersSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(150),
  correlationId: z.string().trim().min(1).max(120),
  expectedVersion: z.number().int().positive().optional(),
});

export type ActorContext = {
  userId: number | null;
  username: string | null;
  role: string | null;
};

export type CommandContext = {
  commandName: string;
  idempotencyKey: IdempotencyKey;
  correlationId: CorrelationId;
  expectedVersion?: number;
  actor: ActorContext;
};

export type CommandResult<T> = {
  status: number;
  body: T;
};