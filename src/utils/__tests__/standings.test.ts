import { describe, expect, it } from 'vitest';
import type { BoardState } from '../../model/domain/Board/BoardState';
import { standingsFor } from '../standings';

const fixture = (mode: BoardState['mode']) =>
  ({
    mode,
    teams: [
      { id: 'red', name: 'Red team', colour: '#ef4444' },
      { id: 'blue', name: 'Blue team', colour: '#3b82f6' },
    ],
    tiles: [
      {
        ownerTeamId: 'red',
        progress: [
          { teamId: 'blue', complete: true },
          { teamId: 'red', complete: true },
        ],
      },
      { ownerTeamId: null, progress: [{ teamId: 'blue', complete: true }] },
    ],
    lines: [{ teamId: 'blue' }],
  }) as unknown as BoardState;

describe('public standings', () => {
  it('counts independent Classic completions and ranks by tiles plus lines', () => {
    expect(
      standingsFor(fixture('CLASSIC')).map(({ team, tiles, lines }) => [
        team.id,
        tiles,
        lines,
      ])
    ).toEqual([
      ['blue', 2, 1],
      ['red', 1, 0],
    ]);
  });

  it.each(['CONTROL', 'RUSH'] as const)(
    'counts ownership rather than completion in %s, leaving contested tiles uncredited',
    (mode) => {
      expect(
        standingsFor(fixture(mode)).map(({ team, tiles }) => [team.id, tiles])
      ).toEqual([
        ['blue', 0],
        ['red', 1],
      ]);
    }
  );

  it('leaves the server board and team order unchanged', () => {
    const board = fixture('CLASSIC');
    const original = JSON.stringify(board);
    standingsFor(board);
    expect(JSON.stringify(board)).toBe(original);
  });
});
