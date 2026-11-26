import type { z } from 'zod';
import type { Logger } from '../logger';
import type { JobDefinition, JobQueue } from './types';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs jobs inside the current process with retry and exponential backoff.
 * Jobs are NOT persisted: anything pending is lost if the process stops.
 * That is acceptable for Phase 1 (no jobs are defined yet); a durable
 * adapter (e.g. Cloudflare Cron Triggers or Queues) will implement the same JobQueue.
 */
export class InProcessJobRunner implements JobQueue {
  private readonly definitions = new Map<string, JobDefinition>();
  private readonly inflight = new Set<Promise<void>>();

  constructor(
    private readonly logger: Logger,
    private readonly backoffMs: (attempt: number) => number = (attempt) => 500 * 2 ** (attempt - 1),
  ) {}

  register<S extends z.ZodTypeAny>(job: JobDefinition<S>): void {
    if (this.definitions.has(job.name)) throw new Error(`Job already registered: ${job.name}`);
    this.definitions.set(job.name, job as unknown as JobDefinition);
  }

  async enqueue(name: string, payload: unknown, options: { delayMs?: number } = {}): Promise<string> {
    const job = this.definitions.get(name);
    if (!job) throw new Error(`Unknown job: ${name}`);
    const parsed: unknown = job.payload.parse(payload); // throws on an invalid payload
    const id = crypto.randomUUID();
    const task: Promise<void> = this.execute(id, job, parsed, options.delayMs ?? 0).finally(() => {
      this.inflight.delete(task);
    });
    this.inflight.add(task);
    return id;
  }

  /** Resolves when every enqueued job has finished (used by tests and graceful shutdown). */
  async idle(): Promise<void> {
    while (this.inflight.size > 0) await Promise.allSettled([...this.inflight]);
  }

  private async execute(id: string, job: JobDefinition, payload: unknown, delayMs: number): Promise<void> {
    if (delayMs > 0) await sleep(delayMs);
    const maxAttempts = job.maxAttempts ?? 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const logger = this.logger.child({ job: job.name, jobId: id, attempt });
      try {
        await job.run(payload, { logger, attempt });
        logger.info('job succeeded');
        return;
      } catch (error) {
        if (attempt === maxAttempts) {
          logger.error('job failed permanently', { err: error });
          return;
        }
        logger.warn('job failed, will retry', { err: error });
        await sleep(this.backoffMs(attempt));
      }
    }
  }
}
