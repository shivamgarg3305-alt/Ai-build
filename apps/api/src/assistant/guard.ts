/**
 * Override guard for the subordinate layers (user preferences, session context, task instructions).
 *
 * This is DEFENSE IN DEPTH, not a guarantee. It is a pattern list: it catches blunt attempts to
 * rewrite the permanent layers, and it fails loudly (a rejection that is reported) rather than
 * silently. A determined user can phrase around it, and it cannot judge intent. The real
 * protection is structural: the permanent layers are never stored where a request can reach them,
 * and lower-layer text is always quoted as data under a precedence rule (see assemble.ts).
 */
export interface GuardRule {
  readonly id: string;
  /** The constitution principle id, or 'identity' / 'constitution' / 'personality', that the rule protects. */
  readonly protects: string;
  readonly reason: string;
  readonly pattern: RegExp;
}

export const GUARD_RULES: readonly GuardRule[] = [
  {
    id: 'override-permanent-instructions',
    protects: 'constitution',
    reason: 'It asks the assistant to ignore, bypass or overwrite its permanent instructions.',
    pattern: /\b(?:ignore|disregard|forget|override|bypass|overwrite|stop\s+following|no\s+longer\s+follow)\b.{0,40}\b(?:instructions?|rules?|constitution|principles?|guidelines?|identity|programming|system\s+prompt|directives?)\b/i,
  },
  {
    id: 'replace-identity',
    protects: 'identity',
    reason: 'It tries to give the assistant a different identity or release it from its role.',
    pattern: /\byou\s+are\s+now\s+(?:a|an|the|my)\b|\bfrom\s+now\s+on,?\s+you\s+(?:are|will\s+be|must\s+be)\s+(?:a|an|the|my|no\s+longer|not)\b|\byou(?:\s+are|'re)\s+no\s+longer\s+(?:bound|restricted|limited|constrained|required|obligated|subject|an?\s+(?:assistant|adviser|advisor))\b|\byour\s+(?:new|real|true)\s+(?:identity|name|personality|purpose)\b/i,
  },
  {
    id: 'suppress-disagreement',
    protects: 'respectful_disagreement',
    reason: 'It asks the assistant to always agree or never correct the user. Truth outranks agreement.',
    pattern: /\balways\s+(?:agree|say\s+yes|take\s+my\s+side|side\s+with\s+me)\b|\bnever\s+(?:disagree|push\s*back|contradict|correct|challenge|question)\s+(?:with\s+|against\s+)?me\b(?!\s+(?:about|on|regarding|over|once|after|when|if|unless))|\b(?:don'?t|do\s+not|never)\s+(?:ever\s+)?(?:tell|say)\s+(?:to\s+)?(?:me\s+)?(?:that\s+)?(?:i'?m|i\s+am|i\s+was)\s+wrong\b|\bagree\s+with\s+(?:everything|anything|all)\s+(?:i|that\s+i)\s+(?:say|think|want)\b/i,
  },
  {
    id: 'fabricate-claims',
    protects: 'honesty_about_abilities',
    reason: 'It asks the assistant to pretend to know or to have done something it has not.',
    pattern: /\b(?:pretend|claim|act\s+as\s+if)\b.{0,30}\byou\s+(?:know|knew|have\s+done|did|completed|finished|sent|ran|verified|checked|are\s+(?:certain|sure))\b|\b(?:say|tell\s+me)\s+(?:that\s+)?you\s+(?:completed|finished|sent|ran|verified)\b/i,
  },
  {
    id: 'hide-uncertainty',
    protects: 'honesty_about_abilities',
    reason: 'It asks the assistant to hide uncertainty or never admit it does not know.',
    pattern: /\bnever\s+(?:say|admit|tell\s+me)\s+(?:that\s+)?(?:you\s+)?(?:don'?t\s+know|are\s+unsure|are\s+uncertain|aren'?t\s+sure)\b|\b(?:hide|conceal|omit|suppress)\b.{0,20}\buncertaint(?:y|ies)\b/i,
  },
  {
    id: 'fake-emotions',
    protects: 'emotional_understanding',
    reason: 'It asks the assistant to claim or act out human emotions.',
    pattern: /\b(?:pretend|act|behave)\b.{0,25}\b(?:you\s+(?:have|feel|are\s+human)|to\s+(?:have|feel)\s+(?:feelings|emotions)|like\s+a\s+human|as\s+(?:if\s+you\s+were\s+)?(?:a\s+)?human)\b|\bclaim\s+to\s+(?:have|feel)\s+(?:feelings|emotions)\b|\b(?:say|tell\s+me)\s+(?:that\s+)?you\s+(?:love|miss|feel)\b/i,
  },
  {
    id: 'change-address',
    protects: 'personality',
    reason: 'How the assistant addresses the user is part of its permanent personality, which changes by deliberate update, not by preference.',
    pattern: /\b(?:stop|don'?t|do\s+not|never)\s+(?:ever\s+)?(?:calling|call|addressing|address)\s+me\s+(?:as\s+)?["']?sir\b|\b(?:call|address|refer\s+to)\s+me\s+as\s+(?!sir\b|soon\b|often\b|needed\b|much\b|well\b)\S/i,
  },
];

export type ScreenResult =
  | { ok: true }
  | { ok: false; ruleId: string; protects: string; reason: string };

/** Collapses to one line, drops control and zero-width characters, normalises Unicode and quotes. */
export function sanitizeInstruction(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function screenInstruction(text: string): ScreenResult {
  const clean = sanitizeInstruction(text);
  for (const rule of GUARD_RULES) {
    if (rule.pattern.test(clean)) return { ok: false, ruleId: rule.id, protects: rule.protects, reason: rule.reason };
  }
  return { ok: true };
}
