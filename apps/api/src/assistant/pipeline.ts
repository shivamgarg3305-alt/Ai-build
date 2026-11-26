import type { AiGenerateRequest, AiMessage } from '../ai/types';
import type { AssembledInstructions } from './assemble';

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Turns an assembly plus conversation messages into a provider request. The assembled instruction is
 * ALWAYS the first, and only, system message: callers cannot supply their own system messages, and
 * user text stays in the user role, so conversation can never be promoted into the instruction layers.
 */
export function buildAiRequest(input: {
  assembly: AssembledInstructions;
  messages: readonly ConversationMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}): AiGenerateRequest {
  for (const message of input.messages as readonly { role: string }[]) {
    if (message.role !== 'user' && message.role !== 'assistant') {
      throw new Error('Conversation messages must be user or assistant messages; the system instruction is built by the pipeline.');
    }
  }
  const messages: AiMessage[] = [{ role: 'system', content: input.assembly.text }, ...input.messages];
  return {
    messages,
    ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    ...(input.maxOutputTokens !== undefined ? { maxOutputTokens: input.maxOutputTokens } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  };
}
