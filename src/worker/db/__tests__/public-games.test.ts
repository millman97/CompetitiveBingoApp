import { describe, expect, it, vi } from 'vitest';
import { listPublicGames } from '../public-games';

describe('public event summaries', () => {
  it('projects only public event fields from a mocked database result', async () => {
    const event = { id: 'autumn', name: 'Autumn Bingo', mode: 'CONTROL', state: 'LIVE', starts_at: 1000, ends_at: 2000, players: 8, teams: 2, tiles: 25 };
    const all = vi.fn().mockResolvedValue({ results: [{ ...event, join_code: 'NOT-PUBLIC', openFlags: 3, adminNote: 'private' }] });
    const prepare = vi.fn().mockReturnValue({ all });
    const db = { prepare } as unknown as D1Database;
    expect(await listPublicGames(db)).toEqual([event]);
    expect(prepare).toHaveBeenCalledOnce();
    expect(prepare.mock.calls[0]?.[0]).not.toMatch(/join_code|openFlags|flags/);
  });

  it('returns an empty list for a new instance', async () => {
    const db = { prepare: vi.fn().mockReturnValue({ all: vi.fn().mockResolvedValue({ results: [] }) }) } as unknown as D1Database;
    expect(await listPublicGames(db)).toEqual([]);
  });
});
