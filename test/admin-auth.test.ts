// Admin authentication, end to end through the real Hono app against a real D1 instance.

import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import app from '../src/worker';
import type { Env } from '../src/worker/env';
import { hashPassword } from '../src/worker/lib/password';

const PASSWORD = 'a-very-good-clan-password';

let testEnv: Env;

beforeAll(async () => {
  testEnv = {
    ...env,
    SIGNING_KEY: 'test-signing-key',
    ADMIN_PASSWORD_HASH: await hashPassword(PASSWORD),
  };
});

/** Each test uses its own client IP so one test's failures cannot throttle another's. */
const post = async (path: string, body: unknown, ip: string, cookie?: string): Promise<Response> =>
  app.fetch(
    new Request(`https://bingo.test${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': ip,
        ...(cookie === undefined ? {} : { Cookie: cookie }),
      },
      body: JSON.stringify(body),
    }),
    testEnv,
  );

const get = async (path: string, cookie?: string): Promise<Response> =>
  app.fetch(
    new Request(`https://bingo.test${path}`, {
      headers: cookie === undefined ? {} : { Cookie: cookie },
    }),
    testEnv,
  );

const loginCookie = async (ip: string): Promise<string> => {
  const res = await post('/api/admin/login', { password: PASSWORD }, ip);
  expect(res.status).toBe(200);
  const setCookie = res.headers.get('Set-Cookie');
  expect(setCookie).not.toBeNull();
  return (setCookie as string).split(';')[0] as string;
};

describe('admin login', () => {
  it('accepts the right password and sets a hardened cookie', async () => {
    const res = await post('/api/admin/login', { password: PASSWORD }, '10.0.0.1');
    expect(res.status).toBe(200);

    const cookie = res.headers.get('Set-Cookie') ?? '';
    expect(cookie).toContain('cb_admin=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('rejects the wrong password', async () => {
    const res = await post('/api/admin/login', { password: 'guess' }, '10.0.0.2');
    expect(res.status).toBe(401);
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it('rejects a request with no password', async () => {
    const res = await post('/api/admin/login', {}, '10.0.0.3');
    expect(res.status).toBe(400);
  });
});

describe('admin session', () => {
  it('refuses a protected route without a cookie', async () => {
    const res = await get('/api/admin/whoami');
    expect(res.status).toBe(401);
  });

  it('refuses a protected route with a forged cookie', async () => {
    const res = await get('/api/admin/whoami', 'cb_admin=not.a.real.token');
    expect(res.status).toBe(401);
  });

  it('allows a protected route with a valid cookie', async () => {
    const cookie = await loginCookie('10.0.0.4');
    const res = await get('/api/admin/whoami', cookie);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ actor: 'admin' });
  });

  it('reports session state without a 401', async () => {
    expect(await (await get('/api/admin/session')).json()).toEqual({ authenticated: false });

    const cookie = await loginCookie('10.0.0.5');
    expect(await (await get('/api/admin/session', cookie)).json()).toEqual({
      authenticated: true,
      actor: 'admin',
    });
  });
});

describe('login throttling', () => {
  // One password and a public URL is a word list away from a compromised board, so the lockout
  // is the whole defence rather than a nicety.
  it('locks out after repeated failures and says when to come back', async () => {
    const ip = '10.0.0.99';

    for (let attempt = 0; attempt < 10; attempt++) {
      const res = await post('/api/admin/login', { password: 'wrong' }, ip);
      expect(res.status).toBe(401);
    }

    const locked = await post('/api/admin/login', { password: PASSWORD }, ip);
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('does not throttle a different client', async () => {
    const res = await post('/api/admin/login', { password: PASSWORD }, '10.0.0.100');
    expect(res.status).toBe(200);
  });

  it('clears the failure count on a successful login', async () => {
    const ip = '10.0.0.101';
    await post('/api/admin/login', { password: 'wrong' }, ip);
    await post('/api/admin/login', { password: PASSWORD }, ip);

    const row = await testEnv.DB.prepare('SELECT * FROM login_attempts WHERE client_key = ?')
      .bind(ip)
      .first();
    expect(row).toBeNull();
  });
});

describe('health', () => {
  it('reports the schema version it speaks', async () => {
    const res = await get('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, schemaVersion: 1 });
  });
});
