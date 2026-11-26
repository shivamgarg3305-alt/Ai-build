import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AuthProvider, useAuth } from '../hooks/useAuth';
import { AuthGate } from './AuthGate';
import { apiError, json, mockFetch } from '../test/helpers';

const user = { id: 'u1', email: 'owner@example.test', displayName: 'Owner', createdAt: '2026-11-15T00:00:00.000Z' };
const session = { token: 'issued-token', expiresAt: '2026-12-15T00:00:00.000Z', user };

function SignOutButton() {
  const { signOut } = useAuth();
  return <button onClick={() => void signOut()}>leave</button>;
}
const renderGate = () => render(<AuthProvider><AuthGate><p>Private app</p><SignOutButton /></AuthGate></AuthProvider>);
const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('AuthGate', () => {
  it('shows sign-in, not the app, when there is no session', () => {
    mockFetch({});
    renderGate();
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy();
    expect(screen.queryByText('Private app')).toBeNull();
  });

  it('signs in with the existing auth API and stores the token', async () => {
    const { calls } = mockFetch({ 'POST /auth/login': () => json(session) });
    renderGate();
    fill('Email', 'owner@example.test');
    fill('Password', 'correct horse battery staple');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Private app')).toBeTruthy();
    expect(localStorage.getItem('assistant.session')).toBe('issued-token');
    expect(calls[0]!.body).toEqual({ email: 'owner@example.test', password: 'correct horse battery staple' });
  });

  it('shows the server message for wrong credentials and stores nothing', async () => {
    mockFetch({ 'POST /auth/login': () => apiError(401, 'invalid_credentials', 'Email or password is incorrect.') });
    renderGate();
    fill('Email', 'owner@example.test');
    fill('Password', 'wrong');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Email or password is incorrect.');
    expect(localStorage.getItem('assistant.session')).toBeNull();
    expect(screen.queryByText('Private app')).toBeNull();
  });

  it('creates the owner account, and reports when registration is closed', async () => {
    mockFetch({ 'POST /auth/register': () => apiError(403, 'registration_closed', 'Registration is closed: this assistant already has an owner.') });
    renderGate();
    fireEvent.click(screen.getByRole('button', { name: /Create the owner account/ }));
    expect(screen.getByLabelText('Name')).toBeTruthy();
    fill('Email', 'new@example.test');
    fill('Name', 'New');
    fill('Password', 'a long enough passphrase');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Registration is closed');
  });

  it('restores a valid session without asking again', async () => {
    localStorage.setItem('assistant.session', 'good');
    mockFetch({ 'GET /auth/me': () => json({ user }) });
    renderGate();
    expect(await screen.findByText('Private app')).toBeTruthy();
  });

  it('returns to sign-in when the stored session has expired', async () => {
    localStorage.setItem('assistant.session', 'stale');
    mockFetch({ 'GET /auth/me': () => apiError(401, 'invalid_session', 'Your session is invalid or has expired.') });
    renderGate();
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
    expect(localStorage.getItem('assistant.session')).toBeNull();
  });

  it('does not sign the user out just because the server is unreachable', async () => {
    localStorage.setItem('assistant.session', 'good');
    let attempts = 0;
    mockFetch({ 'GET /auth/me': () => { if (++attempts === 1) throw new TypeError('Failed to fetch'); return json({ user }); } });
    renderGate();
    expect((await screen.findByRole('alert')).textContent).toContain("Can't reach the server");
    expect(localStorage.getItem('assistant.session')).toBe('good');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Private app')).toBeTruthy();
  });

  it('signs out: calls the server, clears the token and shows sign-in', async () => {
    localStorage.setItem('assistant.session', 'good');
    const { count } = mockFetch({ 'GET /auth/me': () => json({ user }), 'POST /auth/logout': () => new Response(null, { status: 204 }) });
    renderGate();
    fireEvent.click(await screen.findByText('leave'));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy());
    expect(count('POST /auth/logout')).toBe(1);
    expect(localStorage.getItem('assistant.session')).toBeNull();
  });
});
