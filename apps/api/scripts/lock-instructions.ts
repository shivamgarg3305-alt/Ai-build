// Records the version and SHA-256 of each permanent layer in src/assistant/instruction-lock.json.
// A test fails if the code and the lock disagree, so changing the identity, constitution or
// personality profile is always a visible, deliberate step. Refuses if content changed but the
// version did not.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getCoreLayers } from '../src/assistant/core';

const lockPath = fileURLToPath(new URL('../src/assistant/instruction-lock.json', import.meta.url));
type Lock = Record<string, { version: string; sha256: string }>;
const previous: Lock = existsSync(lockPath) ? (JSON.parse(readFileSync(lockPath, 'utf8')) as Lock) : {};
const current = await getCoreLayers();

const problems = current
  .filter((layer) => previous[layer.id]?.version === layer.version && previous[layer.id]?.sha256 !== layer.hash)
  .map((layer) => `${layer.id}: content changed but the version is still ${layer.version}. Bump the version constant first.`);
if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}

const next: Lock = Object.fromEntries(current.map((layer) => [layer.id, { version: layer.version, sha256: layer.hash }]));
writeFileSync(lockPath, `${JSON.stringify(next, null, 2)}\n`);
for (const layer of current) {
  const before = previous[layer.id];
  const status = !before ? 'new' : before.sha256 === layer.hash ? 'unchanged' : `updated ${before.version} -> ${layer.version}`;
  console.log(`${layer.id.padEnd(13)} v${layer.version}  ${layer.hash.slice(0, 16)}...  ${status}`);
}
