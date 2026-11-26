import { useHealth } from '../hooks/useHealth';
import { LoadingPanel, StatePanel } from './StatePanel';

export function HealthCard() {
  const { state, retry } = useHealth();

  if (state.phase === 'loading') return <LoadingPanel label="Checking the API" />;

  if (state.phase === 'error') {
    return (
      <div className="panel">
        <StatePanel
          tone="danger"
          role="alert"
          title="Can't reach the API"
          description={state.error.message}
          action={
            <button type="button" className="btn btn-primary" onClick={retry}>
              Try again
            </button>
          }
        />
      </div>
    );
  }

  const { health } = state;
  const db = health.checks.database;
  const healthy = health.status === 'ok';
  const schemaLabel = { ready: 'Up to date', missing: 'Not applied', unknown: 'Unknown' }[db.schema];

  return (
    <div className="panel">
      <div className="status-line" role="status">
        <span className={healthy ? 'dot' : 'dot is-bad'} aria-hidden="true" />
        <strong>{healthy ? 'Everything is working' : 'The API is up, but something needs attention'}</strong>
      </div>
      {db.schema === 'missing' ? (
        <p className="hint">
          The database has no tables yet. Run <code>npm run db:migrate</code>, then check again.
        </p>
      ) : null}
      {db.schema === 'ready' && health.checks.instructions.status === 'error' ? (
        <p className="hint">The assistant&apos;s permanent instructions failed their integrity check. See the API logs.</p>
      ) : null}
      {db.status === 'error' ? <p className="hint">The API could not reach its database. Check the API logs.</p> : null}
      <dl className="facts">
        <div><dt>Database</dt><dd>{db.status === 'ok' ? `Connected (${db.driver}, ${db.latencyMs} ms)` : 'Unreachable'}</dd></div>
        <div><dt>Schema</dt><dd>{schemaLabel}</dd></div>
        <div><dt>Assistant identity</dt><dd>{health.checks.instructions.status === 'ok' ? `v${health.checks.instructions.identityVersion}, verified` : 'Not verified'}</dd></div>
        <div><dt>Environment</dt><dd>{health.environment}</dd></div>
        <div><dt>API version</dt><dd>{health.version}</dd></div>
        <div><dt>Checked</dt><dd>{new Date(health.time).toLocaleTimeString()}</dd></div>
      </dl>
      <button type="button" className="btn" onClick={retry}>
        Check again
      </button>
    </div>
  );
}
