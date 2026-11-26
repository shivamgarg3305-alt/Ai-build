import type { z } from 'zod';
import type { Logger } from '../logger';

export interface JobContext {
  logger: Logger;
  attempt: number;
}

export interface JobDefinition<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  /** Payloads are validated against this schema when a job is enqueued. */
  payload: S;
  /** Total attempts including the first. Defaults to 3. */
  maxAttempts?: number;
  run(payload: z.infer<S>, context: JobContext): Promise<void>;
}

export interface JobQueue {
  enqueue(name: string, payload: unknown, options?: { delayMs?: number }): Promise<string>;
}
