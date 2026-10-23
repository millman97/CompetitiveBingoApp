import { describe, expect, it, vi } from 'vitest';
import { readRoster } from '../activity';
import type { Tile } from '../tiles';

describe('public team roster', () => {
  it('includes joined players awaiting allocation without hiding assigned teammates', async () => {
    const rows = [
      {
        id: 'a',
        display_name: 'Waiting player',
        team_id: null,
        ready: 1,
        metric_id: null,
        credited: 0,
      },
      {
        id: 'b',
        display_name: 'Blue player',
        team_id: 'blue',
        ready: 0,
        metric_id: null,
        credited: 0,
      },
    ];
    const bind = vi
      .fn()
      .mockReturnValue({ all: async () => ({ results: rows }) });
    const prepare = vi.fn().mockReturnValue({ bind });
    expect(
      await readRoster({ prepare } as unknown as D1Database, 'game', [])
    ).toEqual([
      {
        teamId: null,
        members: [
          {
            playerName: 'Waiting player',
            ready: true,
            credited: 0,
            perTile: {},
          },
        ],
      },
      {
        teamId: 'blue',
        members: [
          { playerName: 'Blue player', ready: false, credited: 0, perTile: {} },
        ],
      },
    ]);
    expect(prepare.mock.calls[0]?.[0]).not.toContain('p.team_id IS NOT NULL');
    expect(prepare.mock.calls[0]?.[0]).toContain('p.removed_at IS NULL');
  });
  it.each([
    ['MAX_VALUE', 15_000_000],
    ['COUNT_DROPS', 2],
  ] as const)(
    'shows %s player contributions in the same units as the board',
    async (aggregate, expected) => {
      const metric = 'drop.bingo_tile_value_test';
      const rows = [
        {
          id: 'a',
          display_name: 'Player',
          team_id: 'red',
          ready: 1,
          metric_id: metric,
          credited: 22_000_000,
          max_value: 15_000_000,
          drop_count: 2,
          adjustments: 0,
        },
      ];
      const db = {
        prepare: () => ({
          bind: () => ({ all: async () => ({ results: rows }) }),
        }),
      } as unknown as D1Database;
      const tile: Tile = {
        id: 'value',
        label: 'Value',
        row: 0,
        col: 0,
        requirement: {
          aggregate,
          metrics: [metric],
          target: aggregate === 'MAX_VALUE' ? null : 2,
          dropValue: {
            minValue: 1_000_000,
            maxValue: null,
            valuation: 'GRAND_EXCHANGE',
          },
        },
      };
      expect(
        (await readRoster(db, 'game', [tile]))[0]?.members[0]?.perTile.value
      ).toBe(expected);
    }
  );
});
