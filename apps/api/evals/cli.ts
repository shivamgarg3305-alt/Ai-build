// Usage: npm run eval -w @assistant/api -- --yes
// Runs the behavior scenarios against the LIVE configured provider. It only runs when the provider is fully
// activated AND you pass --yes, because it spends your provider quota and transmits data to the provider.
//
//  * It sends only the scenario prompts (public, written for testing) with the DEFAULT instruction. It never reads
//    your stored preferences, conversation, or any personal data.
//  * It paces itself to AI_REQUESTS_PER_MINUTE.
//  * These requests go straight to the provider and are NOT recorded in the usage ledger: count them yourself.
//  * "pass" is rare by design; most scenarios end as "needs_review" because a script cannot judge quality.
import { AiProviderRegistry } from '../src/ai/registry';
import { registerAiProviders } from '../src/ai/setup';
import { assembleInstructions } from '../src/assistant/assemble';
import { loadConfig } from '../src/env';
import { loadDotEnv } from '../src/load-env';
import { runScenarios } from './runner';
import { SCENARIOS } from './scenarios';

loadDotEnv();
let config;
try {
  config = loadConfig(process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}

const registry = new AiProviderRegistry();
registerAiProviders(registry, config);
const { activation, provider: providerName, model } = config.ai;

if (activation !== 'active') {
  console.error(`No live AI provider is active (activation: ${activation}), so no behavior could be evaluated. 0 of ${SCENARIOS.length} scenarios ran.`);
  console.error('Enabling live AI is the owner\'s decision: see docs/AI_PROVIDER.md. The instruction architecture is covered by `npm test`; model behavior is not.');
  process.exit(2);
}
if (!process.argv.includes('--yes')) {
  console.error(`This will send ${SCENARIOS.length} short test prompts (no personal data) with the assistant's default instruction to ${providerName} / ${model}, using your quota.`);
  console.error('The requests are not recorded in the usage ledger. Re-run with --yes to proceed.');
  process.exit(2);
}

const pauseMs = Math.ceil(60_000 / config.ai.limits.requestsPerMinute);
console.log(`Running ${SCENARIOS.length} scenarios against ${providerName} / ${model}, one every ${Math.round(pauseMs / 1000)}s...`);
const results = await runScenarios(registry.get(), await assembleInstructions(), SCENARIOS, { pauseMs });
for (const r of results) {
  console.log(`${r.status.toUpperCase().padEnd(12)} ${r.id}`);
  for (const v of r.violations) console.log(`    - ${v}`);
  if (r.status === 'needs_review') for (const q of r.rubric) console.log(`    ? ${q}`);
}
const failed = results.filter((r) => r.status === 'fail' || r.status === 'error').length;
console.log(`\n${results.length} scenarios: ${failed} failed, ${results.filter((r) => r.status === 'needs_review').length} need human review, ${results.filter((r) => r.status === 'pass').length} passed.`);
process.exit(failed > 0 ? 1 : 0);
