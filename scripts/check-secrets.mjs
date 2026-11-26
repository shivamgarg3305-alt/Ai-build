#!/usr/bin/env node
// Dependency-free secret scanner for the PAPPU repository.
//
// Default: scans every file Git would commit (tracked files plus untracked files that are
// not ignored). `--dir <path>` scans every file under a directory instead (used by tests).
//
// Findings are reported as file:line plus a rule name. The matched value is NEVER printed;
// only its length is shown. Exit codes: 0 = clean, 1 = findings, 2 = scanner error.
//
// A line can be exempted with the marker `pappu-secret-scan: allow`. Use it only for
// deliberate, reviewed test fixtures, and never for a real credential.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOW_MARKER = 'pappu-secret-scan: allow';
const MAX_BYTES = 2 * 1024 * 1024;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'coverage', '.wrangler']);

/** Content rules. Each pattern must match the secret itself (group 0), never more context than needed. */
export const CONTENT_RULES = [
  { id: 'google-api-key', pattern: /AIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/g },
  { id: 'private-key-block', pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g },
  { id: 'github-token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/g },
  { id: 'aws-access-key-id', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: 'slack-token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { id: 'api-secret-key', pattern: /\bsk-(?:ant-|proj-|live-)?[A-Za-z0-9_-]{32,}\b/g },
  { id: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
];

/** `NAME=value` assignments of sensitive-looking names, checked only in config-style files. */
const ASSIGNMENT = /^\s*(?:export\s+)?([A-Z0-9_]*(?:SECRET|API_KEY|APIKEY|TOKEN|PASSWORD|PASSWD|PRIVATE_KEY|ACCESS_KEY|CREDENTIALS?)[A-Z0-9_]*)\s*[=:]\s*["']?([^"'\s#]+)/;
const CONFIG_FILE = /(^|\/)(\.env[^/]*|\.dev\.vars[^/]*|[^/]+\.(?:env|toml|ya?ml|ini|cfg|conf|properties|sh|bash))$/i;
const PLACEHOLDER = /^(?:<.*>|\$\{.*\}|\$[A-Z_]+|x+|\*+|changeme|change-me|replace.*|your.*|example.*|placeholder.*|dummy.*|fake.*|todo|none|null|false|true|""|'')$/i;

/** Files that must never be committed, whatever they contain. */
const FORBIDDEN_FILES = [
  { id: 'env-file', test: (name) => (name === '.env' || name.startsWith('.env.')) && name !== '.env.example' },
  { id: 'dev-vars-file', test: (name) => name === '.dev.vars' || name.startsWith('.dev.vars.') },
  { id: 'database-file', test: (name) => /\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm|journal))?$/i.test(name) },
  { id: 'key-file', test: (name) => /\.(?:pem|key|p12|pfx)$/i.test(name) || /^id_(?:rsa|ed25519|ecdsa)/.test(name) },
];

export function scanText(path, text) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  const isConfig = CONFIG_FILE.test(path.split(sep).join('/'));
  lines.forEach((line, index) => {
    if (line.includes(ALLOW_MARKER)) return;
    for (const rule of CONTENT_RULES) {
      rule.pattern.lastIndex = 0;
      for (const match of line.matchAll(rule.pattern)) {
        findings.push({ path, line: index + 1, rule: rule.id, length: match[0].length });
      }
    }
    if (isConfig) {
      const assignment = ASSIGNMENT.exec(line);
      if (assignment) {
        const value = assignment[2];
        if (value.length >= 8 && !PLACEHOLDER.test(value)) {
          findings.push({ path, line: index + 1, rule: `assigned-secret:${assignment[1]}`, length: value.length });
        }
      }
    }
  });
  return findings;
}

export function scanFileName(path) {
  const name = basename(path);
  return FORBIDDEN_FILES.filter((rule) => rule.test(name)).map((rule) => ({ path, line: 0, rule: `forbidden-file:${rule.id}`, length: 0 }));
}

function listGitFiles(root) {
  const output = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' });
  return output.split('\0').filter(Boolean);
}

function listDirFiles(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name));
      } else if (entry.isFile()) {
        files.push(relative(root, join(dir, entry.name)));
      }
    }
  };
  walk(root);
  return files;
}

export function scan(root, files) {
  const findings = [];
  for (const file of files) {
    findings.push(...scanFileName(file));
    const full = join(root, file);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue; // deleted in the working tree but still tracked
    }
    if (!stats.isFile() || stats.size > MAX_BYTES) continue;
    const buffer = readFileSync(full);
    if (buffer.includes(0)) continue; // binary
    findings.push(...scanText(file, buffer.toString('utf8')));
  }
  return findings;
}

function main(argv) {
  const dirIndex = argv.indexOf('--dir');
  const root = dirIndex >= 0 ? argv[dirIndex + 1] : process.cwd();
  if (dirIndex >= 0 && !root) throw new Error('--dir needs a path');
  const files = dirIndex >= 0 ? listDirFiles(root) : listGitFiles(root);
  const findings = scan(root, files);
  if (findings.length === 0) {
    console.log(`Secret scan: ${files.length} files checked, no findings.`);
    return 0;
  }
  console.error(`Secret scan: ${findings.length} finding(s) in ${files.length} files checked. Values are not shown.`);
  for (const f of findings) {
    const where = f.line > 0 ? `${f.path}:${f.line}` : f.path;
    const size = f.length > 0 ? ` (matched value redacted, ${f.length} chars)` : '';
    console.error(`  ${where}  ${f.rule}${size}`);
  }
  console.error('Remove the secret (and rotate it if it was real), or move the file out of the repository.');
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(`Secret scan failed to run: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}
