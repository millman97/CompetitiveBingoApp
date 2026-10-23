// Tile ownership and win conditions. Pure.

import { describe, expect, it } from 'vitest';

import { resolveClaim, resolveOwnership, type TeamScore } from '../src/worker/scoring/ownership';
import {
  evaluateDeadline,
  evaluateLive,
  evaluateRush,
  type OwnedCells,
} from '../src/worker/scoring/win';

const score = (teamId: string, value: number): TeamScore => ({
  teamId,
  score: value,
  complete: false,
  completedAt: null,
  bestDurationMs: null,
  bestAt: null,
});

const duration = (teamId: string, ms: number | null, at: number | null): TeamScore => ({
  teamId,
  score: 0,
  complete: ms !== null,
  completedAt: at,
  bestDurationMs: ms,
  bestAt: at,
});

/** A team that has completed a tile, and when. */
const claimed = (teamId: string, at: number | null): TeamScore => ({
  teamId,
  score: 1,
  complete: at !== null,
  completedAt: at,
  bestDurationMs: null,
  bestAt: null,
});

describe('ownership', () => {
  it('gives the tile to whoever leads', () => {
    expect(resolveOwnership([score('a', 5), score('b', 3)], 'SUM')).toEqual({
      ownerTeamId: 'a',
      contested: false,
    });
  });

  // A tie means the tile is contested and owned by nobody.
  it('contests a tile when the leaders are level', () => {
    expect(resolveOwnership([score('a', 5), score('b', 5)], 'SUM')).toEqual({
      ownerTeamId: null,
      contested: true,
    });
  });

  // Contested and untouched are different states, and the board shows them differently.
  it('leaves a tile nobody has scored on unowned rather than contested', () => {
    expect(resolveOwnership([score('a', 0), score('b', 0)], 'SUM')).toEqual({
      ownerTeamId: null,
      contested: false,
    });
  });

  it('ignores teams below the leaders when breaking a tie', () => {
    expect(resolveOwnership([score('a', 5), score('b', 5), score('c', 1)], 'SUM')).toMatchObject({
      contested: true,
    });
  });

  it('counts distinct metrics for a UNIQUE tile', () => {
    expect(resolveOwnership([score('a', 2), score('b', 3)], 'UNIQUE')).toMatchObject({
      ownerTeamId: 'b',
    });
  });

  describe('fastest-time tiles', () => {
    it('gives the tile to the fastest run', () => {
      expect(
        resolveOwnership([duration('a', 200_000, 10), duration('b', 150_000, 20)], 'MIN_DURATION'),
      ).toMatchObject({ ownerTeamId: 'b' });
    });

    // Ties break on who got there first, so a duration tile is never contested.
    it('breaks an exact tie on who got there first', () => {
      expect(
        resolveOwnership([duration('a', 150_000, 20), duration('b', 150_000, 10)], 'MIN_DURATION'),
      ).toEqual({ ownerTeamId: 'b', contested: false });
    });

    it('leaves it unowned until somebody runs it', () => {
      expect(
        resolveOwnership([duration('a', null, null), duration('b', null, null)], 'MIN_DURATION'),
      ).toEqual({ ownerTeamId: null, contested: false });
    });
  });
});

const BOARD = { rows: 3, cols: 3 };
const row = (index: number) => [0, 1, 2].map((col) => ({ row: index, col }));

describe('FIRST_LINE', () => {
  it('ends the game the instant a team owns a line', () => {
    const owned: OwnedCells = new Map([['a', row(0)]]);
    const outcome = evaluateLive('FIRST_LINE', BOARD, owned, false);

    expect(outcome).toMatchObject({ kind: 'WIN', teamId: 'a' });
  });

  it('continues while nobody holds one', () => {
    const owned: OwnedCells = new Map([['a', [{ row: 0, col: 0 }, { row: 0, col: 1 }]]]);

    expect(evaluateLive('FIRST_LINE', BOARD, owned, false)).toEqual({ kind: 'CONTINUE' });
  });

  // Two teams cannot own the same tile, so a genuine simultaneous line means two different lines.
  // Most lines, then tiles owned; if those are level too, the server does not invent a winner.
  it('separates two teams that complete a line at the same moment', () => {
    const owned: OwnedCells = new Map([
      ['a', [...row(0), { row: 1, col: 0 }]],
      ['b', row(2)],
    ]);

    expect(evaluateLive('FIRST_LINE', BOARD, owned, false)).toMatchObject({
      kind: 'WIN',
      teamId: 'a',
    });
  });

  it('declines to pick between two teams that are exactly level', () => {
    const owned: OwnedCells = new Map([
      ['a', row(0)],
      ['b', row(2)],
    ]);

    expect(evaluateLive('FIRST_LINE', BOARD, owned, false)).toEqual({ kind: 'CONTINUE' });
  });

  it('does not end the other conditions mid-game', () => {
    const owned: OwnedCells = new Map([['a', row(0)]]);

    expect(evaluateLive('MOST_AT_DEADLINE', BOARD, owned, false)).toEqual({ kind: 'CONTINUE' });
    expect(evaluateLive('HYBRID_SUDDEN_DEATH', BOARD, owned, false)).toEqual({ kind: 'CONTINUE' });
  });
});

describe('MOST_AT_DEADLINE', () => {
  it('gives it to the team with the most lines', () => {
    const owned: OwnedCells = new Map([
      ['a', [...row(0), ...row(1)]],
      ['b', row(2)],
    ]);

    expect(evaluateDeadline('MOST_AT_DEADLINE', BOARD, owned)).toMatchObject({
      kind: 'WIN',
      teamId: 'a',
    });
  });

  it('breaks a tie on lines by tiles owned', () => {
    const owned: OwnedCells = new Map([
      ['a', [...row(0), { row: 1, col: 0 }]],
      ['b', row(2)],
    ]);

    expect(evaluateDeadline('MOST_AT_DEADLINE', BOARD, owned)).toMatchObject({
      kind: 'WIN',
      teamId: 'a',
    });
  });

  it('ends without a winner when nobody holds a line', () => {
    const owned: OwnedCells = new Map([['a', [{ row: 0, col: 0 }]]]);

    expect(evaluateDeadline('MOST_AT_DEADLINE', BOARD, owned)).toEqual({ kind: 'ENDED_NO_WINNER' });
  });
});

describe('HYBRID_SUDDEN_DEATH', () => {
  it('awards it at the deadline to a team already holding a line', () => {
    const owned: OwnedCells = new Map([['a', row(1)]]);

    expect(evaluateDeadline('HYBRID_SUDDEN_DEATH', BOARD, owned)).toMatchObject({
      kind: 'WIN',
      teamId: 'a',
    });
  });

  it('goes to sudden death when nobody holds one', () => {
    const owned: OwnedCells = new Map([['a', [{ row: 0, col: 0 }]]]);

    expect(evaluateDeadline('HYBRID_SUDDEN_DEATH', BOARD, owned)).toEqual({ kind: 'SUDDEN_DEATH' });
  });

  // Board state carries over and ownership keeps flipping; the first line to appear takes it.
  it('ends on the first line once sudden death has begun', () => {
    const owned: OwnedCells = new Map([['b', row(2)]]);

    expect(evaluateLive('HYBRID_SUDDEN_DEATH', BOARD, owned, true)).toMatchObject({
      kind: 'WIN',
      teamId: 'b',
    });
  });
});

describe('FIRST_LINE at its deadline', () => {
  // The condition has no deadline rule: it is won the instant somebody completes a line, so
  // reaching endsAt without that having happened means nobody won.
  it('ends without a winner even if a team leads on tiles', () => {
    const owned: OwnedCells = new Map([['a', [{ row: 0, col: 0 }, { row: 0, col: 1 }]]]);

    expect(evaluateDeadline('FIRST_LINE', BOARD, owned)).toEqual({ kind: 'ENDED_NO_WINNER' });
  });
});

// RUSH: the first team to complete a tile takes it, and being overtaken afterwards means nothing.
describe('rush claims', () => {
  it('gives the tile to whoever completed it first', () => {
    expect(resolveClaim([claimed('a', 200), claimed('b', 100)])).toEqual({
      ownerTeamId: 'b',
      contested: false,
    });
  });

  it('leaves a tile nobody has completed unowned rather than contested', () => {
    expect(resolveClaim([claimed('a', null), claimed('b', null)])).toEqual({
      ownerTeamId: null,
      contested: false,
    });
  });

  // Two teams can complete inside one batch, which shares a receipt time. The answer has to be
  // arbitrary, but it has to be the same arbitrary answer every time it is asked — including
  // after a replay.
  it('settles a dead heat the same way every time', () => {
    const scores = [claimed('b', 500), claimed('a', 500)];

    expect(resolveClaim(scores)).toEqual({ ownerTeamId: 'a', contested: false });
    expect(resolveClaim([...scores].reverse())).toEqual({ ownerTeamId: 'a', contested: false });
  });

  // The claim is recomputed, not stamped. An admin discrediting the event that completed a tile
  // has to hand it to whoever was next.
  it('passes the tile on when the first team stops being complete', () => {
    const later = claimed('b', 900);
    expect(resolveClaim([{ ...claimed('a', 100), complete: false }, later])).toEqual({
      ownerTeamId: 'b',
      contested: false,
    });
  });
});

describe('the rush win rule', () => {
  const board = { rows: 3, cols: 3 };
  const row = (index: number) => [0, 1, 2].map((col) => ({ row: index, col }));

  it('is won by the first line, without waiting for anything', () => {
    const owned: OwnedCells = new Map([['a', row(0)]]);

    expect(evaluateRush(board, owned, false)).toMatchObject({ kind: 'WIN', teamId: 'a' });
  });

  it('keeps going while tiles are still unclaimed and nobody has a line', () => {
    const owned: OwnedCells = new Map([['a', [{ row: 0, col: 0 }]]]);

    expect(evaluateRush(board, owned, false)).toEqual({ kind: 'CONTINUE' });
  });

  // The board being full is the same ending as the clock running out: nothing anybody does can
  // move it, so making people wait for the deadline only delays a decided result.
  it('is won on tiles held once there is nothing left to race for', () => {
    const owned: OwnedCells = new Map([
      ['a', [{ row: 0, col: 0 }, { row: 1, col: 1 }]],
      ['b', [{ row: 0, col: 1 }]],
    ]);

    expect(evaluateRush(board, owned, true)).toMatchObject({ kind: 'WIN', teamId: 'a' });
  });

  it('does not invent a winner from a dead heat on tiles', () => {
    const owned: OwnedCells = new Map([
      ['a', [{ row: 0, col: 0 }]],
      ['b', [{ row: 0, col: 1 }]],
    ]);

    expect(evaluateRush(board, owned, true)).toEqual({ kind: 'ENDED_NO_WINNER' });
  });

  it('ends without a winner when nobody took anything', () => {
    expect(evaluateRush(board, new Map(), true)).toEqual({ kind: 'ENDED_NO_WINNER' });
  });
});
