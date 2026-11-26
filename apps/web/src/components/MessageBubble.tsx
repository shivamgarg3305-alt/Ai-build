import type { ChatMessage } from '../hooks/useConversation';

interface Props {
  message: ChatMessage;
  canAct: boolean;
  onRetry(): void;
  onDiscard(): void;
}

function waitHint(seconds: number | undefined): string {
  if (!seconds) return '';
  return seconds >= 120 ? ` Try again in about ${Math.ceil(seconds / 60)} minutes.` : ` Try again in about ${seconds} seconds.`;
}

export function MessageBubble({ message, canAct, onRetry, onDiscard }: Props) {
  const { role, content, status, error, incomplete, trace, droppedContext } = message;
  const classes = ['bubble', role === 'user' ? 'is-user' : 'is-assistant', status === 'failed' ? 'is-failed' : ''].join(' ').trim();
  return (
    <li className={classes} aria-busy={status === 'pending'}>
      <span className="visually-hidden">{role === 'user' ? 'You said: ' : 'Assistant said: '}</span>
      <div className="bubble-text">{content}</div>

      {status === 'failed' && error ? (
        <>
          <p className="msg-error" role="alert">
            {error.message}
            {waitHint(error.retryAfterSeconds)} Your message is kept.
          </p>
          <div className="msg-actions">
            {error.retryable ? (
              <button type="button" className="btn btn-primary" onClick={onRetry} disabled={!canAct}>Retry</button>
            ) : null}
            <button type="button" className="btn" onClick={onDiscard} disabled={!canAct}>Edit message</button>
          </div>
        </>
      ) : null}

      {incomplete ? <p className="msg-note">This reply was cut off before it finished. It may be missing the end.</p> : null}
      {droppedContext ? <p className="msg-note">{droppedContext} earlier message{droppedContext === 1 ? ' was' : 's were'} left out to fit the model&apos;s limits, so the assistant could not see {droppedContext === 1 ? 'it' : 'them'}.</p> : null}

      {trace ? (
        <details className="msg-details">
          <summary>Details</summary>
          <dl className="facts">
            <div><dt>Model</dt><dd>{trace.provider} / {trace.model}</dd></div>
            {trace.usage ? <div><dt>Tokens</dt><dd>{trace.usage.totalTokens} ({trace.usage.inputTokens} in, {trace.usage.outputTokens} out)</dd></div> : null}
            <div><dt>Instruction</dt><dd><code>{trace.instruction.fingerprint.slice(0, 12)}</code></dd></div>
            <div><dt>Permanent layers</dt><dd><code>{trace.instruction.permanentFingerprint.slice(0, 12)}</code> v{trace.instruction.versions.identity}</dd></div>
            <div><dt>Request</dt><dd><code>{trace.requestId.slice(0, 8)}</code></dd></div>
            <div><dt>Time</dt><dd>{new Date(trace.timestamp).toLocaleTimeString()}</dd></div>
          </dl>
        </details>
      ) : null}
    </li>
  );
}
