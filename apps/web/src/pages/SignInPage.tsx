import { useState, type FormEvent } from 'react';
import { ApiError } from '../lib/api';
import { useAuth } from '../hooks/useAuth';

export function SignInPage() {
  const { signIn, signUp } = useAuth();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (creating) await signUp(email, displayName, password);
      else await signIn(email, password);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  }

  return (
    <main className="signin">
      <div className="backdrop" aria-hidden="true" />
      <form className="panel signin-card" onSubmit={submit} aria-labelledby="signin-title">
        <h1 id="signin-title">{creating ? 'Create the owner account' : 'Sign in'}</h1>
        <p className="state-text">{creating ? 'There can be only one owner. Registration closes after this.' : 'Your assistant is private to you.'}</p>

        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {creating ? (
          <div className="field">
            <label htmlFor="displayName">Name</label>
            <input id="displayName" type="text" autoComplete="name" required maxLength={80} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete={creating ? 'new-password' : 'current-password'} required minLength={creating ? 12 : 1} value={password} onChange={(e) => setPassword(e.target.value)} />
          {creating ? <span className="hint">At least 12 characters.</span> : null}
        </div>

        {error ? <p className="msg-error" role="alert">{error}</p> : null}
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Please wait…' : creating ? 'Create account' : 'Sign in'}</button>
        <button type="button" className="btn-link" onClick={() => { setCreating((v) => !v); setError(null); }}>
          {creating ? 'I already have an account' : 'First time here? Create the owner account'}
        </button>
      </form>
    </main>
  );
}
