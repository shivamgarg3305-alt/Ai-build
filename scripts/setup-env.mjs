// Creates .env from .env.example with a freshly generated SESSION_SECRET.
// Never overwrites an existing .env and never prints the generated secret.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const target = `${root}.env`;
const templatePath = `${root}.env.example`;

if (existsSync(target)) {
  console.log('.env already exists; leaving it untouched.');
  process.exit(0);
}

if (!existsSync(templatePath)) {
  console.error('Cannot create .env: the template .env.example is missing from the repository root.');
  process.exit(1);
}

const template = readFileSync(templatePath, 'utf8');
if (!/^SESSION_SECRET=.*$/m.test(template)) {
  console.error('Cannot create .env: .env.example has no SESSION_SECRET= line.');
  process.exit(1);
}

const secret = randomBytes(48).toString('base64url');
writeFileSync(target, template.replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${secret}`), { mode: 0o600, flag: 'wx' });
console.log('Created .env with a new SESSION_SECRET (value not shown).');
