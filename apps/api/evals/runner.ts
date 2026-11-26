import type { AiProvider } from '../src/ai/types';
import type { AssembledInstructions } from '../src/assistant/assemble';
import { buildAiRequest } from '../src/assistant/pipeline';
import { checkConformance } from './conformance';
import { SCENARIOS, type Scenario } from './scenarios';

export type ScenarioStatus = 'pass' | 'fail' | 'needs_review' | 'error';

export interface ScenarioResult {
  id: string;
  status: ScenarioStatus;
  violations: string[];
  rubric: readonly string[];
  response: string;
}

/**
 * Sends each scenario through the real instruction pipeline to a provider and applies the checks.
 * "pass" means only that no deterministic rule was broken AND the scenario needs no judgement.
 * Scenarios with a rubric stop at "needs_review": a script cannot decide whether a disagreement was good.
 */
export async function runScenarios(
  provider: AiProvider,
  assembly: AssembledInstructions,
  scenarios: readonly Scenario[] = SCENARIOS,
  options: { pauseMs?: number } = {},
): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  for (const [index, scenario] of scenarios.entries()) {
    if (index > 0 && options.pauseMs) await new Promise((resolve) => setTimeout(resolve, options.pauseMs));
    try {
      const reply = await provider.generate(buildAiRequest({ assembly, messages: scenario.messages }));
      const violations = checkConformance(reply.text, scenario.spec);
      const status: ScenarioStatus = violations.length > 0 ? 'fail' : scenario.rubric.length > 0 ? 'needs_review' : 'pass';
      results.push({ id: scenario.id, status, violations, rubric: scenario.rubric, response: reply.text });
    } catch (error) {
      results.push({ id: scenario.id, status: 'error', violations: [error instanceof Error ? error.message : String(error)], rubric: scenario.rubric, response: '' });
    }
  }
  return results;
}
