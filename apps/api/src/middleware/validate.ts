import type { Context } from 'hono';
import type { z } from 'zod';
import { AppError } from '../errors';

/** Parses and validates a JSON body. Failures surface as 400s through the central error handler. */
export async function parseJson<S extends z.ZodTypeAny>(c: Context, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new AppError(400, 'invalid_json', 'Request body must be valid JSON.');
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw AppError.validation(result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })));
  }
  return result.data;
}
