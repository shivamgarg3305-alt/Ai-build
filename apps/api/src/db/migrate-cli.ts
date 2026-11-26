import { fileURLToPath } from 'node:url';
import { loadDotEnv } from '../load-env';
import { loadConfig } from '../env';
import { SqliteDatabase } from './sqlite';
import { migrateSqlite } from './migrate-node';

loadDotEnv();
const config = loadConfig(process.env);
const db = SqliteDatabase.open(config.databasePath);
const dir = fileURLToPath(new URL('../../migrations', import.meta.url));
const { applied, skipped } = migrateSqlite(db, dir);
console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'No pending migrations.');
if (skipped.length) console.log(`Already applied: ${skipped.join(', ')}`);
await db.close();
