import type { ConversationMessage } from '@assistant/shared';
import { AppError } from '../errors';

export interface ContextLimits {
  maxMessages: number;
  maxChars: number;
}

export interface FittedContext {
  messages: ConversationMessage[];
  received: number;
  dropped: number;
  truncated: boolean;
}

/**
 * The boundary between "what the application supplied" and "what the model is sent".
 * Keeps the NEWEST messages that fit, in their original order, and reports exactly how many older ones were
 * left out so nothing is silently forgotten. Always keeps the latest user message, and never begins with an
 * assistant message. Phase 4 (full archive) and Phase 5 (memory) will feed this same function.
 */
export function fitContext(messages: readonly ConversationMessage[], limits: ContextLimits): FittedContext {
  for (const message of messages as readonly { role: string }[]) {
    if (message.role !== 'user' && message.role !== 'assistant') throw AppError.validation([{ path: 'messages', message: 'Only user and assistant messages are accepted.' }]);
  }
  const latest = messages[messages.length - 1];
  if (!latest || latest.role !== 'user') throw AppError.validation([{ path: 'messages', message: 'The last message must be a user message.' }]);
  if (latest.content.length > limits.maxChars) {
    throw new AppError(413, 'message_too_long', 'That message is too long to send to the assistant.');
  }

  const kept: ConversationMessage[] = [];
  let chars = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (kept.length >= limits.maxMessages || chars + message.content.length > limits.maxChars) break;
    kept.unshift(message);
    chars += message.content.length;
  }
  while (kept.length > 1 && kept[0]?.role === 'assistant') kept.shift();

  const dropped = messages.length - kept.length;
  return { messages: kept, received: messages.length, dropped, truncated: dropped > 0 };
}
