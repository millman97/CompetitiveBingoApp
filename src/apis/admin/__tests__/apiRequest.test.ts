import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminError } from '../../../error/errors/AdminError';
import { get, post } from '../apiRequest';

afterEach(() => vi.unstubAllGlobals());

describe('admin request recovery', () => {
  it('returns a successful JSON response using a mocked request', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ authenticated: true })));
    vi.stubGlobal('fetch', request);
    expect(await get('/session')).toEqual({ authenticated: true });
    expect(request).toHaveBeenCalledWith(
      '/api/admin/session',
      expect.any(Object)
    );
  });

  it('signals session expiry without swallowing the failed action', async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Sign in again' }), {
          status: 401,
        })
      )
    );
    await expect(get('/games')).rejects.toBeInstanceOf(AdminError);
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'admin-session-expired' })
    );
  });

  it('keeps a wrong password as a login error', async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Wrong password' }), {
          status: 401,
        })
      )
    );
    await expect(post('/login', { password: 'fake-password' })).rejects.toThrow(
      'Wrong password'
    );
    expect(dispatchEvent).not.toHaveBeenCalled();
  });
});
