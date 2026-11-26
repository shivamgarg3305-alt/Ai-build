// Creates .env from .env.example with a freshly generated SESSION_SECRET.
// Refuses to overwrite an existing .env.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const target = `${root}.env`;

if (existsSync(target)) {
  console.log('.env already exists; leaving it untouched.');
  process.exit(0);
}

const secret = randomBytes(48).toString('base64url');
const template = readFileSync(`${root}.env.example`, 'utf8');
writeFileSync(target, template.replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${secret}`), { mode: 0o600 });
console.log('Created .env with a new SESSION_SECRET.');
