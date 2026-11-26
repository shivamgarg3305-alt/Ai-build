import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { MessageBubble } from '../components/MessageBubble';
import { StatePanel } from '../components/StatePanel';
import { useAiStatus, type AiState } from '../hooks/useAiStatus';
import { useConversation } from '../hooks/useConversation';

const ACTIVATION_REASON = {
  disabled: 'Live AI is switched off on the server, so no message can be sent. The owner can enable it (see docs/AI_PROVIDER.md).',
  missing_api_key: 'AI is enabled, but no provider credentials are configured on the server.',
  terms_not_reviewed: 'AI is enabled, but the owner has not confirmed the provider terms review.',
  active: 'The AI provider is not available.',
} as const;

/** Why the composer is switched off, or null when messages can be sent. */
function blockedReason(ai: AiState): { message: string; recheck: boolean } | null {
  if (ai.phase === 'loading') return { message: 'Checking the assistant…', recheck: false };
  if (ai.phase === 'error') return { message: ai.error.message, recheck: true };
  const { status } = ai;
  if (status.state === 'ready') return null;
  if (status.state === 'cooling_down') {
    const until = status.blockedUntil ? new Date(status.blockedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'later';
    return { message: `The AI provider is paused until ${until}. Your messages will work again then.`, recheck: true };
  }
  if (status.state === 'limit_reached') return { message: 'The usage limit set for this assistant has been reached for now.', recheck: true };
  return { message: ACTIVATION_REASON[status.activation], recheck: false };
}

export function ConversationPage() {
  const { state: ai, refresh } = useAiStatus();
  const { messages, thinking, hasFailed, send, retry, discard, cancel } = useConversation();
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end', behavior: 'smooth' });
  }, [messages, thinking]);

  const blocked = blockedReason(ai);
  const canType = blocked === null;
  const canSend = canType && !thinking && !hasFailed && draft.trim() !== '';

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSend) return;
    const text = draft;
    setDraft('');
    void send(text).then(refresh);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  const dataNotice = ai.phase === 'ready' ? ai.status.dataNotice : null;

  return (
    <section className="conversation" aria-labelledby="page-title">
      <header className="page-head">
        <h1 id="page-title">Conversation</h1>
      </header>

      {dataNotice ? <p className="notice">{dataNotice}</p> : null}

      <div className="thread">
        {messages.length === 0 ? (
          <div className="thread-empty">
            <StatePanel
              visual={<div className="lantern" aria-hidden="true" />}
              title="Your conversation will live here"
              description="This conversation is not stored yet: it is cleared when you reload the page, and the assistant only knows what is shown here."
            />
          </div>
        ) : (
          <ol className="thread-list" aria-label="Conversation">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} canAct={!thinking} onRetry={() => void retry().then(refresh)} onDiscard={() => setDraft((d) => (d ? `${discard()}\n${d}` : discard()))} />
            ))}
            {thinking ? (
              <li className="thinking" role="status" aria-live="polite">
                <span className="thinking-dots" aria-hidden="true"><i /><i /><i /></span>
                Thinking…
              </li>
            ) : null}
          </ol>
        )}
        <div ref={endRef} />
      </div>

      {blocked ? (
        <p className="notice" role="status">
          {blocked.message}{' '}
          {blocked.recheck ? <button type="button" className="btn-link" onClick={refresh}>Check again</button> : null}
        </p>
      ) : null}
      {hasFailed && !thinking ? <p className="notice" role="status">Retry or edit the message above before sending another.</p> : null}

      <form className="composer panel" onSubmit={submit}>
        <label className="visually-hidden" htmlFor="message">Message</label>
        <textarea
          id="message"
          rows={Math.min(6, Math.max(1, draft.split('\n').length))}
          placeholder={canType ? 'Message your assistant' : "Messaging isn't available right now"}
          enterKeyHint="send"
          autoComplete="off"
          disabled={!canType}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {thinking ? (
          <button type="button" className="btn" onClick={cancel}>Stop</button>
        ) : (
          <button type="submit" className="btn btn-primary" disabled={!canSend}>Send</button>
        )}
      </form>
    </section>
  );
}
