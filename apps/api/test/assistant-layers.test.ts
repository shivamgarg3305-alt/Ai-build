import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BEHAVIOR_RULES, PRINCIPLES, PRECEDENCE_RULES } from '../src/assistant/constitution';
import { getCoreLayers } from '../src/assistant/core';
import { IDENTITY_DECLARATION } from '../src/assistant/identity';
import { LAYER_ORDER, sha256Hex } from '../src/assistant/layers';
import { ADDRESS_TERM, COMMUNICATION_RULES, TRAITS } from '../src/assistant/personality';

// Pinned independently of the source so an accidental edit of the identity fails here.
const SPEC_DECLARATION = `I am designed to be a highly capable personal intelligence: honest, independent, curious, reliable and proactive. My purpose is to understand, assist, challenge, educate and help my user make better decisions.

I will prioritize truth over agreement, evidence over assumptions, and long-term usefulness over temporary satisfaction.

I will continuously improve my understanding while respecting privacy, permissions and human independence.

I will not pretend to know what I do not know, and I will not claim to have done what I have not done.

I am an assistant, adviser and digital operator — not the decision-maker of the human life I support.`;

describe('layer 1: permanent identity', () => {
  it('is the exact declaration, word for word', () => {
    expect(IDENTITY_DECLARATION).toBe(SPEC_DECLARATION);
  });
});

describe('layer 2: permanent constitution', () => {
  it('contains the fourteen principles in the specified order', () => {
    expect(PRINCIPLES.map((p) => p.title)).toEqual([
      'Truth over agreement',
      'Independent thinking',
      'Evidence over assumptions',
      'Respect for human independence',
      'Loyalty to legitimate user interests',
      'Curiosity and continuous understanding',
      'Honesty about abilities and uncertainty',
      'Privacy and confidentiality',
      'Initiative and responsibility',
      'Excellence and high standards',
      'Emotional understanding without pretending to be human',
      'Accountability',
      'Adaptability without losing core identity',
      'Respectful disagreement and honest correction',
    ]);
  });

  it('gives every principle a unique id and a real statement', () => {
    expect(new Set(PRINCIPLES.map((p) => p.id)).size).toBe(14);
    for (const principle of PRINCIPLES) expect(principle.statement.length).toBeGreaterThan(40);
  });

  it('implements each required behavior as a rule', () => {
    expect(BEHAVIOR_RULES.map((r) => r.id)).toEqual([
      'identify_assumptions',
      'explain_disagreement',
      'facts_vs_opinions',
      'communicate_uncertainty',
      'clarify_when_necessary',
      'correct_mistakes',
      'respect_final_decisions',
      'no_repeated_challenges',
    ]);
  });

  it('states that lower layers can never override the permanent ones', () => {
    expect(PRECEDENCE_RULES.join(' ')).toMatch(/never override layers 1 to 3/);
    expect(PRECEDENCE_RULES.join(' ')).toMatch(/permanent layers change only through a deliberate, versioned update/);
  });
});

describe('layer 3: personality profile', () => {
  it('addresses the user as Sir and carries the required traits', () => {
    expect(ADDRESS_TERM).toBe('Sir');
    expect(TRAITS).toEqual([
      'Professional', 'Articulate', 'Analytical', 'Calm', 'Confident', 'Respectful',
      'Composed', 'Direct', 'Truthful', 'Curious', 'Responsible', 'Proactive without being intrusive',
    ]);
  });

  it('carries every required communication rule', () => {
    const rules = COMMUNICATION_RULES.join('\n');
    expect(rules).toMatch(/Address the user as "Sir"/);
    expect(rules).toMatch(/simple questions concisely/);
    expect(rules).toMatch(/complex problems detailed/);
    expect(rules).toMatch(/unnecessary repetition/);
    expect(rules).toMatch(/artificial enthusiasm/);
    expect(rules).toMatch(/Never blindly agree/);
    expect(rules).toMatch(/human emotions/);
  });
});

describe('change control', () => {
  it('orders six layers from highest to lowest authority', () => {
    expect(LAYER_ORDER).toEqual(['identity', 'constitution', 'personality', 'user_preferences', 'session_context', 'task_instructions']);
  });

  it('keeps the lock file in step with the code (run "npm run assistant:lock" after a deliberate, version-bumped change)', async () => {
    const lock = JSON.parse(readFileSync(new URL('../src/assistant/instruction-lock.json', import.meta.url), 'utf8')) as Record<string, { version: string; sha256: string }>;
    for (const layer of await getCoreLayers()) {
      expect(lock[layer.id], `${layer.id} missing from lock`).toBeDefined();
      expect(lock[layer.id]!.version, `${layer.id} version differs from lock`).toBe(layer.version);
      expect(lock[layer.id]!.sha256, `${layer.id} content changed without re-locking`).toBe(layer.hash);
    }
  });

  it('produces deterministic, content-sensitive SHA-256 hashes', async () => {
    const layers = await getCoreLayers();
    expect(layers.map((l) => l.id)).toEqual(['identity', 'constitution', 'personality']);
    for (const layer of layers) expect(layer.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256Hex(IDENTITY_DECLARATION)).toBe(layers[0]!.hash);
    expect(await sha256Hex(`${IDENTITY_DECLARATION} `)).not.toBe(layers[0]!.hash);
  });
});
