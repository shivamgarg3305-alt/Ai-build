import { useCallback, useEffect, useRef, useState } from 'react';
import type { ResponseTrace } from '@assistant/shared';
import { ApiError, sendConversation } from '../lib/api';

export interface MessageError {
  code: string;
  message: string;
  retryable: boolean;
  retryAfterSeconds?: number | undefined;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** user messages: pending while in flight, failed if the assistant could not answer, sent once answered */
  status: 'pending' | 'sent' | 'failed';
  error?: MessageError | undefined;
  /** assistant messages only */
  incomplete?: boolean;
  trace?: ResponseTrace;
  droppedContext?: number;
}

/**
 * The conversation as the browser knows it. It is NOT stored anywhere (permanent storage is a later phase):
 * reloading the page clears it. Every request carries the whole visible thread, because the model remembers nothing.
 * A message that could not be answered stays in place, marked failed, so it is never lost.
 */
export function useConversation() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  const controllerRef = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const counter = useRef(0);
  messagesRef.current = messages;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  const run = useCallback(async (list: ChatMessage[], userId: string) => {
    const history = list.filter((m) => m.status !== 'failed').map(({ role, content }) => ({ role, content }));
    const controller = new AbortController();
    controllerRef.current = controller;
    setThinking(true);
    try {
      const reply = await sendConversation(history, controller.signal);
      if (!mounted.current) return;
      setMessages((current) => [
        ...current.map((m) => (m.id === userId ? { ...m, status: 'sent' as const, error: undefined } : m)),
        {
          id: `a${++counter.current}`,
          role: 'assistant' as const,
          content: reply.message.content,
          status: 'sent' as const,
          incomplete: !reply.complete,
          trace: reply.trace,
          ...(reply.context.truncated ? { droppedContext: reply.context.dropped } : {}),
        },
      ]);
    } catch (caught) {
      if (!mounted.current) return;
      const error = caught instanceof ApiError ? caught : new ApiError('unknown', 'Something went wrong. Please try again.', undefined, { retryable: true });
      const failure: MessageError = { code: error.code, message: error.message, retryable: error.retryable, retryAfterSeconds: error.retryAfterSeconds };
      setMessages((current) => current.map((m) => (m.id === userId ? { ...m, status: 'failed' as const, error: failure } : m)));
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      if (mounted.current) setThinking(false);
    }
  }, []);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || controllerRef.current) return;
      const user: ChatMessage = { id: `u${++counter.current}`, role: 'user', content, status: 'pending' };
      const next = [...messagesRef.current, user];
      setMessages(next);
      await run(next, user.id);
    },
    [run],
  );

  /** Sends the failed message again. Safe: generating a reply has no side effect. */
  const retry = useCallback(async () => {
    const failed = messagesRef.current.find((m) => m.status === 'failed');
    if (!failed || controllerRef.current) return;
    const next = messagesRef.current.map((m) => (m.id === failed.id ? { ...m, status: 'pending' as const, error: undefined } : m));
    setMessages(next);
    await run(next, failed.id);
  }, [run]);

  /** Removes the failed message and hands its text back so the user can edit it. */
  const discard = useCallback((): string => {
    const failed = messagesRef.current.find((m) => m.status === 'failed');
    if (!failed) return '';
    setMessages((current) => current.filter((m) => m.id !== failed.id));
    return failed.content;
  }, []);

  const cancel = useCallback(() => controllerRef.current?.abort(), []);

  return { messages, thinking, hasFailed: messages.some((m) => m.status === 'failed'), send, retry, discard, cancel };
}
