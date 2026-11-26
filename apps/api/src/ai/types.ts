export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiGenerateRequest {
  messages: AiMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

/**
 * Why generation ended, normalised across providers. Added in Phase 3 (optional, so every existing
 * implementation stays valid): without it a response cut off at the output limit would be indistinguishable
 * from a finished one.  stop = finished; length = hit the output limit; other = ended for another reason.
 */
export type AiFinishReason = 'stop' | 'length' | 'other';

export interface AiGenerateResult {
  text: string;
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
  finishReason?: AiFinishReason;
}

/**
 * The contract every model provider implements. The Gemini provider (ai/gemini.ts) is the first.
 */
export interface AiProvider {
  readonly name: string;
  generate(request: AiGenerateRequest): Promise<AiGenerateResult>;
}
