import { AiStatusCard } from '../components/AiStatusCard';
import { HealthCard } from '../components/HealthCard';
import { useAuth } from '../hooks/useAuth';

export function SettingsPage() {
  const { state, signOut } = useAuth();
  return (
    <section aria-labelledby="page-title">
      <header className="page-head">
        <h1 id="page-title">Settings</h1>
      </header>
      <h2 className="section-title">Assistant AI</h2>
      <AiStatusCard />
      <h2 className="section-title section-gap">System status</h2>
      <HealthCard />
      <h2 className="section-title section-gap">Account</h2>
      <div className="panel">
        {state.status === 'signedIn' ? <p className="hint">Signed in as {state.user.displayName} ({state.user.email}).</p> : null}
        <button type="button" className="btn" onClick={() => void signOut()}>Sign out</button>
      </div>
    </section>
  );
}
