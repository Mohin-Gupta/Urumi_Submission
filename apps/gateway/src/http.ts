import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) throw new HttpError(400, z.prettifyError(result.error));
  return result.data;
}

// fetch hides the real reason (refused, DNS, TLS...) in err.cause
export function errorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause as { code?: string; message?: string } | undefined;
  return cause ? `${err.message} (${cause.code ?? cause.message})` : err.message;
}

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  // Postgres unique violation
  if (err?.code === "23505") return res.status(409).json({ error: "That already exists" });
  console.error(err);
  res.status(500).json({ error: "Internal error" });
}
