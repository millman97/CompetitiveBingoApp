import { afterEach, describe, expect, it, vi } from 'vitest';
import apiFetchPublicGames from '../apiFetchPublicGames';

afterEach(() => vi.unstubAllGlobals());

describe('public event requests', () => {
  it('uses the games endpoint rather than a tracking-like events endpoint', async () => {
    const games = [{ id: 'trial', name: 'Trial event' }];
    const request = vi.fn().mockResolvedValue(Response.json(games));
    vi.stubGlobal('fetch', request);

    expect(await apiFetchPublicGames()).toEqual(games);
    expect(request).toHaveBeenCalledWith(
      '/api/games',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('keeps a server error distinct from an empty event list', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: 'INTERNAL' }, { status: 500 })
        )
    );
    await expect(apiFetchPublicGames()).rejects.toThrow(
      'Could not load the events.'
    );
  });
});
