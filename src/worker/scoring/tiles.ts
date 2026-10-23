// Tile requirements — spec section 5.3.
//
// A requirement names one or more metrics whose contributions are combined, an aggregate that
// says how, and a target. The board editor offers only shapes the plugin can actually observe:
// it must not be possible to build a tile that can never be satisfied, because that is only ever
// discovered by a player grinding at it for a day.

import { COLLECTION_LOG_WILDCARD, DROP_WILDCARD, isValidTrackedEntry } from '../../contract/metrics';
import { isValueAggregate, valueRequirementProblems } from './value-tiles';

export type Aggregate = 'SUM' | 'UNIQUE' | 'MIN_DURATION' | 'COUNT_DROPS' | 'MAX_VALUE';

export interface DropValueSettings {
  minValue: number | null;
  maxValue: number | null;
  valuation: 'GRAND_EXCHANGE' | 'HIGH_ALCHEMY';
}

export interface TileRequirement {
  /** One or more metric IDs, or one of the two permitted wildcards. Contributions are combined. */
  metrics: string[];
  aggregate: Aggregate;
  /** Required for totals/counts, null for MIN_DURATION and MAX_VALUE. */
  target: number | null;
  /** The tile owns its value filter; saving the board also configures the plugin's rule. */
  dropValue?: DropValueSettings;
}

const AGGREGATES: Aggregate[] = ['SUM', 'UNIQUE', 'MIN_DURATION', 'COUNT_DROPS', 'MAX_VALUE'];

const isDurationMetric = (metricId: string): boolean => metricId.startsWith('time.');
const isWildcard = (metricId: string): boolean =>
  metricId === COLLECTION_LOG_WILDCARD || metricId === DROP_WILDCARD;

/**
 * Every reason this requirement could never be satisfied, or an empty list.
 *
 * Returns all of them at once so the board editor can show an admin everything wrong with a tile
 * rather than one problem per attempt.
 */
export const requirementProblems = (requirement: TileRequirement): string[] => {
  const problems: string[] = [];
  const { metrics, aggregate, target } = requirement;

  if (!Array.isArray(metrics) || metrics.length === 0) {
    problems.push('A tile must track at least one metric.');
  } else {
    for (const metric of metrics) {
      if (!isValidTrackedEntry(metric)) {
        problems.push(`"${metric}" is not a metric the plugin can report.`);
      }
    }
  }

  if (!AGGREGATES.includes(aggregate)) {
    problems.push(`"${aggregate}" is not a way of combining metrics.`);
    return problems;
  }

  const durations = metrics.filter(isDurationMetric);

  if (isValueAggregate(aggregate)) {
    problems.push(...valueRequirementProblems(requirement));
    return problems;
  }
  if (requirement.dropValue !== undefined) problems.push('Only value-based drop tiles can have a value filter.');

  if (aggregate === 'MIN_DURATION') {
    if (target !== null) {
      problems.push('A fastest-time tile has no target; the fastest run wins.');
    }
    if (durations.length !== metrics.length) {
      problems.push('A fastest-time tile can only track time. metrics.');
    }
  } else {
    if (target === null || !Number.isInteger(target) || target < 1) {
      problems.push('A tile needs a target of at least 1.');
    }
    // Durations credit nothing towards a total: lower is better, so they are not cumulative.
    // A tile summing them could never be completed.
    if (durations.length > 0) {
      problems.push(
        'time. metrics cannot be summed or counted. Use a fastest-time tile for those.',
      );
    }
  }

  // "Collect 5 of these 3 items" can never happen. A wildcard has no such bound.
  if (
    aggregate === 'UNIQUE' &&
    target !== null &&
    !metrics.some(isWildcard) &&
    target > metrics.length
  ) {
    problems.push(
      `This tile needs ${target} different metrics but only lists ${metrics.length}.`,
    );
  }

  return problems;
};

/** Parses a stored requirement, rejecting loudly rather than scoring against a broken tile. */
export const parseRequirement = (json: string, tileId: string): TileRequirement => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`Tile ${tileId} has a requirement that is not JSON.`);
  }

  const requirement = parsed as TileRequirement;
  const problems = requirementProblems(requirement);

  if (problems.length > 0) {
    throw new Error(`Tile ${tileId} has an impossible requirement: ${problems.join(' ')}`);
  }

  return requirement;
};

/** What one team has contributed towards one tile, aggregated from the event log. */
export interface TileContribution {
  /** Sum of credited increments across the tile's metrics. */
  totalCredited: number;
  /** How many of the tile's metrics this team has contributed anything to. */
  distinctMetrics: number;
  /** Fastest run recorded, for MIN_DURATION. */
  bestDurationMs: number | null;
  /** Receipt time of that fastest run, so a tie breaks on who got there first. */
  bestAt: number | null;
  maxValue?: number;
  dropCount?: number;
  adjustments?: number;
}

export interface TileOutcome {
  score: number;
  complete: boolean;
  bestDurationMs: number | null;
  bestAt: number | null;
}

/**
 * Scores one tile for one team.
 *
 * In CLASSIC every team works the same board independently and completion is absolute, so this is
 * the whole answer. In CONTROL the same numbers decide who is ahead, and ownership is settled by
 * comparing teams against each other — which is the Durable Object's job, not this function's.
 */
export const evaluate = (
  requirement: TileRequirement,
  contribution: TileContribution,
): TileOutcome => {
  const { aggregate, target } = requirement;

  if (aggregate === 'MIN_DURATION') {
    return {
      // A completed run is worth the tile; there is nothing to accumulate.
      score: contribution.bestDurationMs === null ? 0 : 1,
      complete: contribution.bestDurationMs !== null,
      bestDurationMs: contribution.bestDurationMs,
      bestAt: contribution.bestAt,
    };
  }

  const score = aggregate === 'MAX_VALUE'
    ? Math.max(0, (contribution.maxValue ?? 0) + (contribution.adjustments ?? 0))
    : aggregate === 'COUNT_DROPS'
      ? Math.max(0, (contribution.dropCount ?? 0) + (contribution.adjustments ?? 0))
      : aggregate === 'SUM' ? contribution.totalCredited : contribution.distinctMetrics;

  return {
    score,
    complete: aggregate === 'MAX_VALUE' ? score > 0 : target !== null && score >= target,
    bestDurationMs: null,
    bestAt: null,
  };
};
