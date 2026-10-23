import { describe, expect, it, vi } from 'vitest';
import { evaluate, requirementProblems, type TileRequirement } from '../tiles';
import {
  managedValueRules,
  managedValueStatements,
  VALUE_METRIC_PREFIX,
} from '../value-tiles';
import { resolveOwnership } from '../ownership';
import { recomputeTile } from '../engine';
import type { ScoringContext } from '../engine';

const requirement = (
  aggregate: 'COUNT_DROPS' | 'MAX_VALUE'
): TileRequirement => ({
  metrics: [VALUE_METRIC_PREFIX + 'test'],
  aggregate,
  target: aggregate === 'MAX_VALUE' ? null : 2,
  dropValue: {
    minValue: 1_000_000,
    maxValue: null,
    valuation: 'GRAND_EXCHANGE',
  },
});
const contribution = {
  totalCredited: 22_000_000,
  distinctMetrics: 1,
  bestDurationMs: null,
  bestAt: null,
  maxValue: 15_000_000,
  dropCount: 2,
  adjustments: 0,
};

describe('value-based drop scoring', () => {
  it('counts qualifying stacks instead of their item quantities or gp total', () => {
    expect(evaluate(requirement('COUNT_DROPS'), contribution)).toMatchObject({
      score: 2,
      complete: true,
    });
    expect(
      evaluate({ ...requirement('COUNT_DROPS'), target: 3 }, contribution)
        .complete
    ).toBe(false);
  });
  it('scores the highest single stack instead of accumulating several smaller drops', () => {
    expect(evaluate(requirement('MAX_VALUE'), contribution)).toMatchObject({
      score: 15_000_000,
      complete: true,
    });
    expect(
      evaluate(requirement('MAX_VALUE'), { ...contribution, maxValue: 0 })
    ).toMatchObject({ score: 0, complete: false });
  });
  it('keeps explicit admin adjustments effective in both scoring types', () => {
    expect(
      evaluate(requirement('MAX_VALUE'), {
        ...contribution,
        adjustments: -5_000_000,
      }).score
    ).toBe(10_000_000);
    expect(
      evaluate(requirement('MAX_VALUE'), {
        ...contribution,
        adjustments: -50_000_000,
      }).score
    ).toBe(0);
    expect(
      evaluate(requirement('COUNT_DROPS'), { ...contribution, adjustments: -1 })
    ).toMatchObject({ score: 1, complete: false });
  });
  it('awards Control ownership by highest value and leaves equal records contested', () => {
    const score = (teamId: string, value: number) => ({
      teamId,
      score: value,
      complete: true,
      completedAt: null,
      bestDurationMs: null,
      bestAt: null,
    });
    expect(
      resolveOwnership(
        [score('red', 15_000_000), score('blue', 12_000_000)],
        'MAX_VALUE'
      )
    ).toEqual({ ownerTeamId: 'red', contested: false });
    expect(
      resolveOwnership(
        [score('red', 15_000_000), score('blue', 15_000_000)],
        'MAX_VALUE'
      )
    ).toEqual({ ownerTeamId: null, contested: true });
  });
  it('validates bounds, price source, dedicated metric and quantity rules', () => {
    expect(requirementProblems(requirement('MAX_VALUE'))).toEqual([]);
    expect(requirementProblems(requirement('COUNT_DROPS'))).toEqual([]);
    expect(
      requirementProblems({
        ...requirement('MAX_VALUE'),
        metrics: ['kc.vorkath'],
      })
    ).not.toEqual([]);
    expect(
      requirementProblems({ ...requirement('MAX_VALUE'), target: 3 })
    ).not.toEqual([]);
    expect(
      requirementProblems({ ...requirement('COUNT_DROPS'), target: 0 })
    ).not.toEqual([]);
    expect(
      requirementProblems({
        ...requirement('COUNT_DROPS'),
        dropValue: {
          minValue: 2_000_000,
          maxValue: 1_000_000,
          valuation: 'GRAND_EXCHANGE',
        },
      })
    ).not.toEqual([]);
  });
  it('configures existing plugin value tracking for every inline tile', () => {
    const rules = managedValueRules([
      { label: 'Biggest drop', requirement: requirement('MAX_VALUE') },
    ]);
    expect(rules).toEqual([
      {
        metricId: VALUE_METRIC_PREFIX + 'test',
        label: 'Biggest drop',
        minValue: 1_000_000,
        maxValue: null,
        valuation: 'GRAND_EXCHANGE',
        counts: 'VALUE',
      },
    ]);
    const bind = vi.fn().mockReturnValue({});
    const prepare = vi.fn().mockReturnValue({ bind });
    managedValueStatements({ prepare } as unknown as D1Database, 'game', rules);
    expect(bind.mock.calls[0]).toEqual(['game', VALUE_METRIC_PREFIX + '*']);
    expect(prepare.mock.calls[0]?.[0]).toContain('metric_id GLOB ?');
  });
  it('rejects imported tiles that assign conflicting filters to the same tracking metric', () => {
    const second = {
      ...requirement('MAX_VALUE'),
      dropValue: {
        minValue: 5_000_000,
        maxValue: null,
        valuation: 'GRAND_EXCHANGE' as const,
      },
    };
    expect(() =>
      managedValueRules([
        { label: 'A', requirement: requirement('MAX_VALUE') },
        { label: 'B', requirement: second },
      ])
    ).toThrow('different filters');
  });
  it.each([
    ['MAX_VALUE', 15_000_000],
    ['COUNT_DROPS', 2],
  ] as const)(
    'persists %s from mocked event aggregates, preserving replay’s scoring path',
    async (aggregate, expectedScore) => {
      const writes: unknown[][] = [];
      const db = {
        prepare: vi.fn((sql: string) => ({
          bind: (...args: unknown[]) => ({
            first: async () => ({
              total: 22_000_000,
              distinct_metrics: 1,
              max_value: 15_000_000,
              drop_count: 2,
              adjustments: 0,
            }),
            run: async () => {
              if (sql.includes('INSERT INTO tile_progress')) writes.push(args);
            },
          }),
        })),
      } as unknown as D1Database;
      const tile = {
        id: 'tile',
        row: 0,
        col: 0,
        label: 'Value challenge',
        requirement: requirement(aggregate),
      };
      await recomputeTile(
        {
          db,
          game: { id: 'game', mode: 'CONTROL' },
          tiles: [tile],
          thresholds: new Map(),
        } as ScoringContext,
        tile,
        'red'
      );
      expect(writes[0]?.[3]).toBe(expectedScore);
      expect(writes[0]?.[6]).toBe(1);
    }
  );
});
