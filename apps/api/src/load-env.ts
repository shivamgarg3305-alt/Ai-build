import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Loads the first .env found in the working directory or the repo root (two levels up). */
export function loadDotEnv(): void {
  for (const candidate of [resolve('.env'), resolve('../../.env')]) {
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
  }
}
