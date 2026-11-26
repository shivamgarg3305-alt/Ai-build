import { authSessionResponseSchema, errorResponseSchema, meResponseSchema } from '@assistant/shared';
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/auth/password';
import { PASSWORD, createTestApp, postJson } from './helpers';

const register = { email: 'Owner@Example.test', displayName: 'Owner', password: PASSWORD };

describe('password hashing', () => {
  it('verifies the right password and rejects others', async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash).toMatch(/^pbkdf2-sha256\$100000\$/);
    expect(await verifyPassword(PASSWORD, hash)).toBe(true);
    expect(await verifyPassword('wrong password!!', hash)).toBe(false);
  });

  it('salts every hash and rejects malformed stored values', async () => {
    expect(await hashPassword(PASSWORD)).not.toBe(await hashPassword(PASSWORD));
    expect(await verifyPassword(PASSWORD, 'garbage')).toBe(false);
    expect(await verifyPassword(PASSWORD, 'pbkdf2-sha256$abc$x$y')).toBe(false);
  });
});

describe('auth API', () => {
  it('registers the first user, normalises email, and returns a usable session', async () => {
    const { app, db } = createTestApp();
    const res = await app.request(postJson('/api/v1/auth/register', register));
    expect(res.status).toBe(201);
    const body = authSessionResponseSchema.parse(await res.json());
    expect(body.user.email).toBe('owner@example.test');
    expect(JSON.stringify(body)).not.toContain('pbkdf2');

    const me = await app.request('/api/v1/auth/me', { headers: { authorization: `Bearer ${body.token}` } });
    expect(me.status).toBe(200);
    expect(meResponseSchema.parse(await me.json()).user.id).toBe(body.user.id);

    // The raw token is never stored.
    const stored = await db.all<{ token_hash: string }>('SELECT token_hash FROM sessions');
    expect(stored).toHaveLength(1);
    expect(stored[0]!.token_hash).not.toContain(body.token);
  });

  it('closes registration after the first owner', async () => {
    const { app } = createTestApp();
    await app.request(postJson('/api/v1/auth/register', register));
    const second = await app.request(postJson('/api/v1/auth/register', { ...register, email: 'other@example.test' }));
    expect(second.status).toBe(403);
    expect(errorResponseSchema.parse(await second.json()).error.code).toBe('registration_closed');
  });

  it('refuses concurrent registrations beyond the first', async () => {
    const { app, db } = createTestApp();
    const results = await Promise.all(
      [1, 2, 3].map((n) => app.request(postJson('/api/v1/auth/register', { ...register, email: `u${n}@example.test` }))),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await db.all('SELECT id FROM users')).toHaveLength(1);
  });

  it('logs in with correct credentials and rejects bad ones with one generic error', async () => {
    const { app } = createTestApp();
    await app.request(postJson('/api/v1/auth/register', register));

    const ok = await app.request(postJson('/api/v1/auth/login', { email: 'owner@example.test', password: PASSWORD }));
    expect(ok.status).toBe(200);
    authSessionResponseSchema.parse(await ok.json());

    const wrongPassword = await app.request(postJson('/api/v1/auth/login', { email: 'owner@example.test', password: 'nope-nope-nope' }));
    const unknownEmail = await app.request(postJson('/api/v1/auth/login', { email: 'ghost@example.test', password: PASSWORD }));
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    const a = errorResponseSchema.parse(await wrongPassword.json()).error;
    const b = errorResponseSchema.parse(await unknownEmail.json()).error;
    expect(a.code).toBe('invalid_credentials');
    expect(a.message).toBe(b.message);
  });

  it('rejects missing, malformed and unknown tokens', async () => {
    const { app } = createTestApp();
    expect((await app.request('/api/v1/auth/me')).status).toBe(401);
    expect((await app.request('/api/v1/auth/me', { headers: { authorization: 'Basic abc' } })).status).toBe(401);
    expect((await app.request('/api/v1/auth/me', { headers: { authorization: 'Bearer not-a-real-token' } })).status).toBe(401);
  });

  it('rejects expired sessions', async () => {
    const { app, db } = createTestApp();
    const res = await app.request(postJson('/api/v1/auth/register', register));
    const { token } = authSessionResponseSchema.parse(await res.json());
    await db.run("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'");
    expect((await app.request('/api/v1/auth/me', { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
  });

  it('logs out, invalidating the token', async () => {
    const { app } = createTestApp();
    const res = await app.request(postJson('/api/v1/auth/register', register));
    const { token } = authSessionResponseSchema.parse(await res.json());
    const headers = { authorization: `Bearer ${token}` };
    expect((await app.request(postJson('/api/v1/auth/logout', {}, headers))).status).toBe(204);
    expect((await app.request('/api/v1/auth/me', { headers })).status).toBe(401);
  });

  it('writes audit records for auth events without storing credentials', async () => {
    const { app, db } = createTestApp();
    const res = await app.request(postJson('/api/v1/auth/register', register));
    const { token } = authSessionResponseSchema.parse(await res.json());
    await app.request(postJson('/api/v1/auth/login', { email: 'owner@example.test', password: 'wrong-password-1' }));
    await app.request(postJson('/api/v1/auth/login', { email: 'owner@example.test', password: PASSWORD }));
    await app.request(postJson('/api/v1/auth/logout', {}, { authorization: `Bearer ${token}` }));
    const rows = await db.all<{ event: string; metadata: string }>('SELECT event, metadata FROM audit_logs ORDER BY rowid');
    expect(rows.map((r) => r.event)).toEqual(['auth.register', 'auth.login_failure', 'auth.login', 'auth.logout']);
    expect(JSON.stringify(rows)).not.toContain('wrong-password-1');
  });

  it('validates request bodies', async () => {
    const { app } = createTestApp();
    const bad = await app.request(postJson('/api/v1/auth/register', { email: 'nope', displayName: '', password: 'short' }));
    expect(bad.status).toBe(400);
    const err = errorResponseSchema.parse(await bad.json()).error;
    expect(err.code).toBe('validation_error');
    expect((err.details as { path: string }[]).map((d) => d.path).sort()).toEqual(['displayName', 'email', 'password']);

    const notJson = await app.request('/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' });
    expect(notJson.status).toBe(400);
    expect(errorResponseSchema.parse(await notJson.json()).error.code).toBe('invalid_json');
  });
});
