import { useAiStatus } from '../hooks/useAiStatus';
import { LoadingPanel, StatePanel } from './StatePanel';

const STATE_LABEL = { ready: 'Ready', disabled: 'Switched off', cooling_down: 'Paused by the provider', limit_reached: 'Usage limit reached' } as const;
const ACTIVATION_HINT = {
  disabled: 'Live AI is switched off on the server (AI_ENABLED).',
  missing_api_key: 'Enabled, but no provider credentials are configured on the server.',
  terms_not_reviewed: 'Enabled, but the owner has not confirmed the provider terms review.',
  active: '',
} as const;

export function AiStatusCard() {
  const { state, refresh } = useAiStatus();
  if (state.phase === 'loading') return <LoadingPanel label="Checking the AI provider" />;
  if (state.phase === 'error') {
    return (
      <div className="panel">
        <StatePanel tone="danger" role="alert" title="Can't read the AI status" description={state.error.message} action={<button type="button" className="btn btn-primary" onClick={refresh}>Try again</button>} />
      </div>
    );
  }
  const { status } = state;
  return (
    <div className="panel">
      <div className="status-line" role="status">
        <span className={status.state === 'ready' ? 'dot' : 'dot is-bad'} aria-hidden="true" />
        <strong>{STATE_LABEL[status.state]}</strong>
      </div>
      {status.activation !== 'active' ? <p className="hint">{ACTIVATION_HINT[status.activation]} See docs/AI_PROVIDER.md.</p> : null}
      {status.blockedUntil ? <p className="hint">Paused until {new Date(status.blockedUntil).toLocaleTimeString()} ({status.blockedReason}).</p> : null}
      <dl className="facts">
        <div><dt>Provider</dt><dd>{status.provider}</dd></div>
        <div><dt>Model</dt><dd>{status.model}</dd></div>
        <div><dt>Requests today</dt><dd>{status.usage.requestsToday} of {status.limits.requestsPerDay}</dd></div>
        <div><dt>Tokens today</dt><dd>{status.usage.tokensToday.toLocaleString()} of {status.limits.tokensPerDay.toLocaleString()}</dd></div>
        <div><dt>Last minute</dt><dd>{status.usage.requestsLastMinute} of {status.limits.requestsPerMinute}</dd></div>
      </dl>
      {status.dataNotice ? <p className="hint">{status.dataNotice}</p> : null}
      <button type="button" className="btn" onClick={refresh}>Refresh</button>
    </div>
  );
}
