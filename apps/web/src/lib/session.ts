// The bearer token issued by POST /api/v1/auth/login. Kept in localStorage so the installed app stays signed in.
// Trade-off (documented in the README): script running on this origin can read it, so the app must stay free of
// injected content. All access is wrapped because storage can be unavailable (private mode, blocked storage).
const KEY = 'assistant.session';

export function getToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(KEY, token);
  } catch {
    /* storage unavailable: the session lasts until the page is closed */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

type Listener = () => void;
const listeners = new Set<Listener>();

/** Called when the server rejects the stored token, so the UI can return to the sign-in screen. */
export function onUnauthorized(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function notifyUnauthorized(): void {
  for (const listener of listeners) listener();
}
