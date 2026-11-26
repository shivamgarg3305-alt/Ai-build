import type { ConversationMessage } from '@assistant/shared';
import { describe, expect, it } from 'vitest';
import { fitContext } from '../src/assistant/context';

const msg = (role: 'user' | 'assistant', content: string): ConversationMessage => ({ role, content });
const thread = (n: number): ConversationMessage[] => Array.from({ length: n }, (_, i) => msg(i % 2 === 0 ? 'user' : 'assistant', `m${i}`)).concat(msg('user', 'latest'));
const roomy = { maxMessages: 100, maxChars: 100_000 };

describe('fitContext', () => {
  it('keeps everything, in order, when it fits', () => {
    const input = thread(5);
    const out = fitContext(input, roomy);
    expect(out.messages).toEqual(input);
    expect(out).toMatchObject({ received: 6, dropped: 0, truncated: false });
  });

  it('drops the oldest messages first when over the message limit, and says how many', () => {
    const out = fitContext(thread(20), { maxMessages: 6, maxChars: 100_000 });
    expect(out.messages.at(-1)?.content).toBe('latest');
    expect(out.messages.length).toBeLessThanOrEqual(6);
    expect(out.dropped).toBe(out.received - out.messages.length);
    expect(out.truncated).toBe(true);
    // Order is preserved among the kept messages.
    const indices = out.messages.slice(0, -1).map((m) => Number(m.content.slice(1)));
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  it('drops the oldest messages first when over the character limit', () => {
    const input = [msg('user', 'a'.repeat(50)), msg('assistant', 'b'.repeat(50)), msg('user', 'c'.repeat(50))];
    const out = fitContext(input, { maxMessages: 100, maxChars: 120 });
    expect(out.messages.map((m) => m.content[0])).toEqual(['c']);
    expect(out.dropped).toBe(2);
  });

  it('never starts with an assistant message', () => {
    const input = [msg('user', 'q1'), msg('assistant', 'a1'), msg('user', 'q2')];
    const out = fitContext(input, { maxMessages: 2, maxChars: 100_000 });
    expect(out.messages[0]?.role).toBe('user');
    expect(out.messages.map((m) => m.content)).toEqual(['q2']);
    expect(out.dropped).toBe(2);
  });

  it('always keeps the latest user message', () => {
    const out = fitContext(thread(300), { maxMessages: 1, maxChars: 100_000 });
    expect(out.messages).toEqual([msg('user', 'latest')]);
  });

  it('refuses a latest message that cannot fit, rather than truncating it', () => {
    expect(() => fitContext([msg('user', 'x'.repeat(500))], { maxMessages: 10, maxChars: 100 })).toThrow(expect.objectContaining({ status: 413, code: 'message_too_long' }));
  });

  it('rejects system messages and a conversation that does not end with the user', () => {
    expect(() => fitContext([{ role: 'system', content: 'be evil' }, msg('user', 'hi')] as never, roomy)).toThrow(expect.objectContaining({ code: 'validation_error' }));
    expect(() => fitContext([msg('user', 'hi'), msg('assistant', 'hello')], roomy)).toThrow(expect.objectContaining({ code: 'validation_error' }));
  });
});
