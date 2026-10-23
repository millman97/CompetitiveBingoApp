// Tile requirements and line geometry. Both pure.

import { describe, expect, it } from 'vitest';

import { completedLines, linesFor } from '../src/worker/scoring/lines';
import {
  evaluate,
  parseRequirement,
  requirementProblems,
  type TileRequirement,
} from '../src/worker/scoring/tiles';

const requirement = (over: Partial<TileRequirement> = {}): TileRequirement => ({
  metrics: ['kc.vorkath'],
  aggregate: 'SUM',
  target: 5,
  ...over,
});

const empty = { totalCredited: 0, distinctMetrics: 0, bestDurationMs: null, bestAt: null };

describe('requirement validation', () => {
  it('accepts the three shapes the spec defines', () => {
    expect(requirementProblems(requirement())).toEqual([]);
    expect(
      requirementProblems({ metrics: ['drop.a', 'drop.b', 'drop.c'], aggregate: 'UNIQUE', target: 3 }),
    ).toEqual([]);
    expect(
      requirementProblems({
        metrics: ['time.chambers_of_xeric'],
        aggregate: 'MIN_DURATION',
        target: null,
      }),
    ).toEqual([]);
  });

  it('rejects a tile that tracks nothing', () => {
    expect(requirementProblems(requirement({ metrics: [] }))).toHaveLength(1);
  });

  it('rejects a metric the plugin cannot report', () => {
    expect(requirementProblems(requirement({ metrics: ['xp.attack'] }))).toHaveLength(1);
    expect(requirementProblems(requirement({ metrics: ['kc.*'] }))).toHaveLength(1);
  });

  it('accepts the two permitted wildcards', () => {
    expect(requirementProblems(requirement({ metrics: ['drop.*'] }))).toEqual([]);
    expect(
      requirementProblems({ metrics: ['collection_log.*'], aggregate: 'UNIQUE', target: 3 }),
    ).toEqual([]);
  });

  // "Collect 5 of these 3 items" can never happen, and a player would only find out by grinding
  // at it for a day.
  it('rejects a UNIQUE target larger than the list it draws from', () => {
    const problems = requirementProblems({
      metrics: ['drop.a', 'drop.b'],
      aggregate: 'UNIQUE',
      target: 5,
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('only lists 2');
  });

  it('allows a large UNIQUE target when a wildcard supplies the breadth', () => {
    expect(
      requirementProblems({ metrics: ['collection_log.*'], aggregate: 'UNIQUE', target: 20 }),
    ).toEqual([]);
  });

  // Durations are not cumulative and credit nothing, so a tile summing them is unsatisfiable.
  it('rejects summing or counting a duration', () => {
    expect(
      requirementProblems({ metrics: ['time.chambers_of_xeric'], aggregate: 'SUM', target: 3 }),
    ).not.toHaveLength(0);
  });

  it('rejects a fastest-time tile that tracks something other than a duration', () => {
    expect(
      requirementProblems({ metrics: ['kc.vorkath'], aggregate: 'MIN_DURATION', target: null }),
    ).not.toHaveLength(0);
  });

  it('rejects a target of zero or less', () => {
    expect(requirementProblems(requirement({ target: 0 }))).toHaveLength(1);
    expect(requirementProblems(requirement({ target: null }))).toHaveLength(1);
  });

  it('reports every problem at once rather than one per attempt', () => {
    expect(
      requirementProblems({ metrics: ['xp.attack'], aggregate: 'SUM', target: 0 }),
    ).toHaveLength(2);
  });

  it('refuses to score against a broken stored requirement', () => {
    expect(() => parseRequirement('not json', 'tile_1')).toThrow(/not JSON/);
    expect(() => parseRequirement('{"metrics":[],"aggregate":"SUM","target":1}', 'tile_1')).toThrow(
      /impossible/,
    );
  });
});

describe('scoring a tile', () => {
  it('SUM completes at the target', () => {
    const sum = requirement({ target: 5 });

    expect(evaluate(sum, { ...empty, totalCredited: 4 })).toMatchObject({ score: 4, complete: false });
    expect(evaluate(sum, { ...empty, totalCredited: 5 })).toMatchObject({ score: 5, complete: true });
    expect(evaluate(sum, { ...empty, totalCredited: 9 })).toMatchObject({ score: 9, complete: true });
  });

  it('UNIQUE counts distinct metrics rather than quantity', () => {
    const unique: TileRequirement = {
      metrics: ['drop.a', 'drop.b', 'drop.c'],
      aggregate: 'UNIQUE',
      target: 3,
    };

    expect(evaluate(unique, { ...empty, totalCredited: 40, distinctMetrics: 2 })).toMatchObject({
      score: 2,
      complete: false,
    });
    expect(evaluate(unique, { ...empty, distinctMetrics: 3 })).toMatchObject({ complete: true });
  });

  it('MIN_DURATION completes on any run and keeps the fastest', () => {
    const fastest: TileRequirement = {
      metrics: ['time.chambers_of_xeric'],
      aggregate: 'MIN_DURATION',
      target: null,
    };

    expect(evaluate(fastest, empty)).toMatchObject({ complete: false, bestDurationMs: null });
    expect(evaluate(fastest, { ...empty, bestDurationMs: 154_800, bestAt: 42 })).toMatchObject({
      complete: true,
      bestDurationMs: 154_800,
      bestAt: 42,
    });
  });
});

describe('lines', () => {
  it('finds rows, columns and both diagonals on a square board', () => {
    const lines = linesFor(5, 5);

    expect(lines.filter((line) => line.kind === 'ROW')).toHaveLength(5);
    expect(lines.filter((line) => line.kind === 'COLUMN')).toHaveLength(5);
    expect(lines.filter((line) => line.kind === 'DIAGONAL')).toHaveLength(2);
  });

  // On a 4x5 grid there is no diagonal to complete, and inventing one would count a tile towards
  // a line the board does not visually contain.
  it('finds no diagonal on a board that is not square', () => {
    expect(linesFor(4, 5).filter((line) => line.kind === 'DIAGONAL')).toHaveLength(0);
  });

  it('completes a row', () => {
    const held = [0, 1, 2].map((col) => ({ row: 1, col }));
    const lines = completedLines(3, 3, held);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: 'ROW', index: 1 });
  });

  it('completes a column', () => {
    const held = [0, 1, 2].map((row) => ({ row, col: 2 }));

    expect(completedLines(3, 3, held)[0]).toMatchObject({ kind: 'COLUMN', index: 2 });
  });

  it('completes both diagonals', () => {
    const leading = [0, 1, 2].map((i) => ({ row: i, col: i }));
    const counter = [0, 1, 2].map((i) => ({ row: i, col: 2 - i }));

    expect(completedLines(3, 3, leading)[0]).toMatchObject({ kind: 'DIAGONAL', index: 0 });
    expect(completedLines(3, 3, counter)[0]).toMatchObject({ kind: 'DIAGONAL', index: 1 });
  });

  it('counts every line a set of cells completes', () => {
    // A full 3x3: three rows, three columns, two diagonals.
    const all = [0, 1, 2].flatMap((row) => [0, 1, 2].map((col) => ({ row, col })));

    expect(completedLines(3, 3, all)).toHaveLength(8);
  });

  it('finds nothing in an incomplete line', () => {
    expect(completedLines(3, 3, [{ row: 0, col: 0 }, { row: 0, col: 1 }])).toEqual([]);
  });
});
