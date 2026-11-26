// Tests for scripts/check-secrets.mjs and scripts/setup-env.mjs (node:test, no dependencies).
// Fake secrets are generated at runtime, so no secret-shaped literal is ever committed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scanner = join(here, 'check-secrets.mjs');
const temps = [];
after(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'pappu-scan-'));
  temps.push(dir);
  return dir;
}

function randomToken(length, alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

function runScan(dir) {
  return spawnSync(process.execPath, [scanner, '--dir', dir], { encoding: 'utf8' });
}

describe('secret scanner', () => {
  test('a clean directory passes', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'index.ts'), 'export const greeting = "hello";\n');
    const result = runScan(dir);
    assert.equal(result.status, 0, result.stderr);
  });

  test('detects a planted Google-style API key without printing it', () => {
    const dir = tempDir();
    const planted = `AIza${randomToken(35)}`;
    writeFileSync(join(dir, 'client.ts'), `const key = "${planted}";\n`);
    const result = runScan(dir);
    const output = result.stdout + result.stderr;
    assert.equal(result.status, 1);
    assert.match(output, /client\.ts:1\s+google-api-key/);
    assert.ok(!output.includes(planted), 'the secret value must not appear in the output');
    assert.ok(!output.includes(planted.slice(4, 20)), 'no fragment of the secret may appear in the output');
  });

  test('detects a planted private key block', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'notes.txt'), ['-----BEGIN', 'PRIVATE KEY-----'].join(' ') + `\n${randomToken(64)}\n`);
    const result = runScan(dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /private-key-block/);
  });

  test('detects a real-looking secret assigned in a config file', () => {
    const dir = tempDir();
    const value = randomToken(40);
    writeFileSync(join(dir, 'settings.toml'), `SESSION_SECRET = "${value}"\n`);
    const result = runScan(dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /assigned-secret:SESSION_SECRET/);
    assert.ok(!(result.stdout + result.stderr).includes(value));
  });

  test('ignores placeholders and empty values in config files', () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, '.env.example'),
      ['SESSION_SECRET=', 'GEMINI_API_KEY=<your-key>', 'API_TOKEN=${API_TOKEN}', 'DB_PASSWORD=changeme', '# GEMINI_API_KEY=', 'AI_ENABLED=false'].join('\n'),
    );
    const result = runScan(dir);
    assert.equal(result.status, 0, result.stderr);
  });

  test('flags files that must never be committed', () => {
    const dir = tempDir();
    writeFileSync(join(dir, '.env'), 'NODE_ENV=development\n');
    writeFileSync(join(dir, '.dev.vars'), 'NODE_ENV=development\n');
    writeFileSync(join(dir, 'assistant.db'), 'not really a database\n');
    const result = runScan(dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /forbidden-file:env-file/);
    assert.match(result.stderr, /forbidden-file:dev-vars-file/);
    assert.match(result.stderr, /forbidden-file:database-file/);
  });

  test('the allow marker exempts a single reviewed line only', () => {
    const dir = tempDir();
    const allowed = `AIza${randomToken(35)}`;
    const blocked = `AIza${randomToken(35)}`;
    writeFileSync(join(dir, 'fixture.ts'), `const a = "${allowed}"; // pappu-secret-scan: allow\nconst b = "${blocked}";\n`);
    const result = runScan(dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /fixture\.ts:2\s+google-api-key/);
    assert.doesNotMatch(result.stderr, /fixture\.ts:1\s/);
  });
});

describe('setup-env', () => {
  function sandbox(template) {
    const root = tempDir();
    mkdirSync(join(root, 'scripts'));
    copyFileSync(join(here, 'setup-env.mjs'), join(root, 'scripts', 'setup-env.mjs'));
    if (template !== undefined) writeFileSync(join(root, '.env.example'), template);
    return root;
  }
  const run = (root) => spawnSync(process.execPath, [join(root, 'scripts', 'setup-env.mjs')], { encoding: 'utf8' });

  test('creates .env from the real template with a fresh secret, mode 600, without printing it', () => {
    const root = sandbox(readFileSync(join(here, '..', '.env.example'), 'utf8'));
    const result = run(root);
    assert.equal(result.status, 0, result.stderr);
    const env = readFileSync(join(root, '.env'), 'utf8');
    const secret = /^SESSION_SECRET=(.*)$/m.exec(env)?.[1] ?? '';
    assert.ok(secret.length >= 32, 'SESSION_SECRET must be at least 32 characters');
    assert.ok(!(result.stdout + result.stderr).includes(secret));
    if (process.platform !== 'win32') assert.equal(statSync(join(root, '.env')).mode & 0o777, 0o600);
  });

  test('never overwrites an existing .env', () => {
    const root = sandbox('SESSION_SECRET=\n');
    writeFileSync(join(root, '.env'), 'KEEP=me\n');
    const result = run(root);
    assert.equal(result.status, 0);
    assert.equal(readFileSync(join(root, '.env'), 'utf8'), 'KEEP=me\n');
  });

  test('fails clearly when the template is missing', () => {
    const root = sandbox(undefined);
    const result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /\.env\.example is missing/);
  });
});
