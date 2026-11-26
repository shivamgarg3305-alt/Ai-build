import type { AppConfig } from './env';
import type { Logger } from './logger';
import type { Database } from './db/types';
import type { ObjectStorage } from './storage/types';
import type { AiProviderRegistry } from './ai/registry';
import type { JobQueue } from './jobs/types';

/** Everything the HTTP layer depends on. Entry points assemble it; tests substitute parts. */
export interface Services {
  config: AppConfig;
  logger: Logger;
  db: Database;
  /** Absent where no storage adapter exists (currently: the Cloudflare Worker entry). */
  storage?: ObjectStorage;
  ai: AiProviderRegistry;
  jobs: JobQueue;
}
