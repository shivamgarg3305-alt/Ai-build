import { Hono } from 'hono';
import {
  loginRequestSchema,
  registerRequestSchema,
  type AuthSessionResponse,
  type MeResponse,
} from '@assistant/shared';
import type { AppEnv } from '../../app-env';
import { recordAudit } from '../../auth/audit';
import { hashPassword, verifyPassword } from '../../auth/password';
import { createSession, revokeSession } from '../../auth/sessions';
import { findUserByEmail, findUserById, registerFirstUser } from '../../auth/users';
import { AppError } from '../../errors';
import { parseJson } from '../../middleware/validate';
import { requireAuth } from '../../middleware/require-auth';
import type { Services } from '../../services';

// Verified against when the email is unknown, so response time does not reveal which emails exist.
let decoyHash: Promise<string> | undefined;
const getDecoyHash = () => (decoyHash ??= hashPassword(crypto.randomUUID()));

export function authRoutes(services: Services) {
  const { db, config } = services;
  const routes = new Hono<AppEnv>();

  routes.post('/register', async (c) => {
    const input = await parseJson(c, registerRequestSchema);
    const now = new Date();
    const user = await registerFirstUser(
      db,
      { email: input.email, displayName: input.displayName, passwordHash: await hashPassword(input.password) },
      now,
    );
    if (!user) {
      throw AppError.forbidden('registration_closed', 'Registration is closed: this assistant already has an owner.');
    }
    const session = await createSession(db, config.sessionSecret, user.id, config.sessionTtlHours, now);
    await recordAudit(db, { userId: user.id, event: 'auth.register' }, now);
    const body: AuthSessionResponse = { ...session, user };
    return c.json(body, 201);
  });

  routes.post('/login', async (c) => {
    const input = await parseJson(c, loginRequestSchema);
    const now = new Date();
    const user = await findUserByEmail(db, input.email);
    const valid = await verifyPassword(input.password, user?.passwordHash ?? (await getDecoyHash()));
    if (!user || !valid) {
      await recordAudit(db, { userId: user?.id ?? null, event: 'auth.login_failure' }, now);
      throw AppError.unauthorized('Email or password is incorrect.', 'invalid_credentials');
    }
    const session = await createSession(db, config.sessionSecret, user.id, config.sessionTtlHours, now);
    await recordAudit(db, { userId: user.id, event: 'auth.login' }, now);
    const { passwordHash: _omit, ...publicUser } = user;
    const body: AuthSessionResponse = { ...session, user: publicUser };
    return c.json(body);
  });

  routes.post('/logout', requireAuth(services), async (c) => {
    const auth = c.get('auth');
    if (!auth) throw AppError.unauthorized();
    await revokeSession(db, auth.sessionId);
    await recordAudit(db, { userId: auth.userId, event: 'auth.logout' }, new Date());
    return c.body(null, 204);
  });

  routes.get('/me', requireAuth(services), async (c) => {
    const auth = c.get('auth');
    if (!auth) throw AppError.unauthorized();
    const user = await findUserById(db, auth.userId);
    if (!user) throw AppError.unauthorized('Your session is invalid or has expired.', 'invalid_session');
    const body: MeResponse = { user };
    return c.json(body);
  });

  return routes;
}
