import type { ReactNode } from 'react';
import { useAuth } from '../hooks/useAuth';
import { SignInPage } from '../pages/SignInPage';
import { LoadingPanel, StatePanel } from './StatePanel';

/** Shows the app only to a signed-in owner. Uses the existing authentication API; there is no second system. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { state, recheck } = useAuth();
  if (state.status === 'signedIn') return <>{children}</>;
  if (state.status === 'signedOut') return <SignInPage />;
  return (
    <main className="signin">
      <div className="backdrop" aria-hidden="true" />
      <div className="signin-card">
        {state.status === 'checking' ? (
          <LoadingPanel label="Checking your session" />
        ) : (
          <div className="panel">
            <StatePanel
              tone="danger"
              role="alert"
              title="Can't reach the server"
              description={state.message}
              action={<button type="button" className="btn btn-primary" onClick={recheck}>Try again</button>}
            />
          </div>
        )}
      </div>
    </main>
  );
}
