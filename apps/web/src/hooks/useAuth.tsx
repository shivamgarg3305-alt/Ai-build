import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PublicUser } from '@assistant/shared';
import { ApiError, fetchMe, login, logout, register } from '../lib/api';
import { clearToken, getToken, onUnauthorized, setToken } from '../lib/session';

export type AuthState =
  | { status: 'checking' }
  | { status: 'signedOut' }
  | { status: 'error'; message: string }
  | { status: 'signedIn'; user: PublicUser };

interface AuthContextValue {
  state: AuthState;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, displayName: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  recheck(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => (getToken() ? { status: 'checking' } : { status: 'signedOut' }));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!getToken()) {
      setState({ status: 'signedOut' });
      return;
    }
    let cancelled = false;
    setState({ status: 'checking' });
    fetchMe()
      .then((user) => !cancelled && setState({ status: 'signedIn', user }))
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) setState({ status: 'signedOut' });
        else setState({ status: 'error', message: error instanceof ApiError ? error.message : 'Something went wrong.' });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(() => onUnauthorized(() => setState({ status: 'signedOut' })), []);

  const signIn = useCallback(async (email: string, password: string) => {
    const session = await login(email, password);
    setToken(session.token);
    setState({ status: 'signedIn', user: session.user });
  }, []);

  const signUp = useCallback(async (email: string, displayName: string, password: string) => {
    const session = await register(email, displayName, password);
    setToken(session.token);
    setState({ status: 'signedIn', user: session.user });
  }, []);

  const signOut = useCallback(async () => {
    try {
      await logout();
    } catch {
      /* signing out locally still ends this device's session */
    }
    clearToken();
    setState({ status: 'signedOut' });
  }, []);

  const recheck = useCallback(() => setAttempt((n) => n + 1), []);
  const value = useMemo(() => ({ state, signIn, signUp, signOut, recheck }), [state, signIn, signUp, signOut, recheck]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
