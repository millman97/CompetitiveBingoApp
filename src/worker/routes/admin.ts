// Admin authentication.
//
// One password, no user accounts. Login exchanges it for an HMAC-signed session cookie; every
// other admin route requires that cookie. The password itself is never stored — only a PBKDF2
// hash, pushed as a secret by the deploy workflow.

import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { MiddlewareHandler } from 'hono';

import { adminPasswordHash, signingKey, type Env } from '../env';
import { ApiError, rateLimited } from '../lib/errors';
import { clearFailures, clientKey, lockoutRemaining, recordFailure } from '../lib/login-throttle';
import { verifyPassword } from '../lib/password';
import { signToken, verifyToken } from '../lib/tokens';
import type { Game } from '../db/games';
import { adminGameRoutes } from './admin-games';

export const ADMIN_COOKIE = 'cb_admin';
const SESSION_MS = 12 * 60 * 60 * 1000;

interface AdminSession {
  /** Recorded on every admin_actions row, so an audit trail has something to name. */
  actor: string;
}

/**
 * Requires a valid admin session. Applied to every /api/admin route except login, so a route
 * added later is protected by default rather than by remembering to protect it.
 */
export const requireAdmin: MiddlewareHandler<{
  Bindings: Env;
  Variables: { admin: AdminSession };
}> = async (c, next) => {
  const cookie = getCookie(c, ADMIN_COOKIE);
  if (cookie === undefined) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Sign in to continue.');
  }

  const session = await verifyToken<AdminSession>(signingKey(c.env), 'admin', cookie);
  if (session === null) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Your admin session has expired. Sign in again.');
  }

  c.set('admin', session);
  await next();
};

export const adminAuthRoutes = new Hono<{ Bindings: Env; Variables: { admin: AdminSession } }>()
  .post('/login', async (c) => {
    const key = clientKey(c.req.raw);

    const remaining = await lockoutRemaining(c.env.DB, key);
    if (remaining > 0) {
      c.header('Retry-After', String(Math.ceil(remaining / 1000)));
      throw rateLimited();
    }

    const body = await c.req.json<{ password?: unknown }>().catch(() => null);
    if (body === null || typeof body.password !== 'string') {
      throw new ApiError(400, 'MALFORMED_REQUEST', 'Enter a password.');
    }

    const ok = await verifyPassword(body.password, adminPasswordHash(c.env));
    if (!ok) {
      await recordFailure(c.env.DB, key);
      // Deliberately says nothing about why. There is one password, so "wrong password" and
      // "no such user" are the same statement anyway.
      throw new ApiError(401, 'UNAUTHORIZED', 'That password is not right.');
    }

    await clearFailures(c.env.DB, key);

    const expiresAt = Date.now() + SESSION_MS;
    const token = await signToken<AdminSession>(
      signingKey(c.env),
      'admin',
      { actor: 'admin' },
      expiresAt,
    );

    setCookie(c, ADMIN_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: Math.floor(SESSION_MS / 1000),
    });

    return c.json({ ok: true, expiresAt });
  })

  .post('/logout', (c) => {
    deleteCookie(c, ADMIN_COOKIE, { path: '/' });
    return c.json({ ok: true });
  })

  // Lets the admin SPA decide whether to show a login screen without guessing from a 401.
  .get('/session', async (c) => {
    const cookie = getCookie(c, ADMIN_COOKIE);
    if (cookie === undefined) {
      return c.json({ authenticated: false as const });
    }
    const session = await verifyToken<AdminSession>(signingKey(c.env), 'admin', cookie);
    return session === null
      ? c.json({ authenticated: false as const })
      : c.json({ authenticated: true as const, actor: session.actor });
  });

/**
 * Admin routes that require a session.
 *
 * Protection is applied by this router to everything mounted on it, rather than route by route,
 * so an endpoint added later is guarded by default instead of by remembering to guard it. The
 * public login routes live on their own router above and never pass through here.
 */
export const adminProtectedRoutes = new Hono<{
  Bindings: Env;
  Variables: { admin: AdminSession; game: Game };
}>()
  .use('*', requireAdmin)
  .get('/whoami', (c) => c.json({ actor: c.get('admin').actor }))
  .route('/', adminGameRoutes);
