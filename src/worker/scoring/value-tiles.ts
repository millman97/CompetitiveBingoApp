import type { DropValueRule } from '../db/games';
import type { Aggregate, TileRequirement } from './tiles';

export const VALUE_METRIC_PREFIX = 'drop.bingo_tile_value_';
export const isManagedValueMetric = (metric: string) =>
  metric.startsWith(VALUE_METRIC_PREFIX);
export const isValueAggregate = (
  aggregate: string
): aggregate is 'COUNT_DROPS' | 'MAX_VALUE' =>
  aggregate === 'COUNT_DROPS' || aggregate === 'MAX_VALUE';

export const valueRequirementProblems = (
  requirement: TileRequirement
): string[] => {
  const problems: string[] = [];
  if (
    requirement.metrics.length !== 1 ||
    !isManagedValueMetric(requirement.metrics[0] ?? '')
  )
    problems.push(
      'A value tile needs its own drop-value tracking rule. Choose its scoring type again.'
    );
  const settings = requirement.dropValue;
  if (!settings || typeof settings !== 'object')
    return [...problems, 'Set the drop-value filter.'];
  for (const bound of [settings.minValue, settings.maxValue]) {
    if (bound !== null && (!Number.isSafeInteger(bound) || bound < 0))
      problems.push(
        'Value limits must be non-negative whole numbers of gp, or blank.'
      );
  }
  if (
    settings.minValue !== null &&
    settings.maxValue !== null &&
    settings.minValue > settings.maxValue
  )
    problems.push('The minimum value cannot exceed the maximum.');
  if (!['GRAND_EXCHANGE', 'HIGH_ALCHEMY'].includes(settings.valuation))
    problems.push('Choose Grand Exchange or high alchemy prices.');
  if (requirement.aggregate === 'MAX_VALUE') {
    if (requirement.target !== null)
      problems.push('A most-valuable-drop tile has no quantity target.');
  } else if (
    !Number.isSafeInteger(requirement.target) ||
    (requirement.target ?? 0) < 1
  )
    problems.push('Set a target of at least one qualifying drop stack.');
  return problems;
};

export const managedValueRules = (
  tiles: readonly { label: string; requirement: TileRequirement }[]
): DropValueRule[] => {
  const rules = new Map<string, DropValueRule>();
  for (const tile of tiles.filter((tile) =>
    isValueAggregate(tile.requirement.aggregate)
  )) {
    const settings = tile.requirement.dropValue!;
    const metricId = tile.requirement.metrics[0]!;
    const rule: DropValueRule = {
      metricId,
      label: tile.label,
      minValue: settings.minValue,
      maxValue: settings.maxValue,
      valuation: settings.valuation,
      counts: 'VALUE',
    };
    const previous = rules.get(metricId);
    if (
      previous &&
      (previous.minValue !== rule.minValue ||
        previous.maxValue !== rule.maxValue ||
        previous.valuation !== rule.valuation)
    )
      throw new Error(
        'Two value tiles share a tracking rule with different filters. Choose the scoring type again for one of them.'
      );
    rules.set(metricId, rule);
  }
  return [...rules.values()];
};

export const managedValueStatements = (
  db: D1Database,
  gameId: string,
  rules: readonly DropValueRule[]
): D1PreparedStatement[] => [
  db
    .prepare(
      'DELETE FROM drop_value_rules WHERE game_id = ? AND metric_id GLOB ?'
    )
    .bind(gameId, VALUE_METRIC_PREFIX + '*'),
  ...rules.map((rule) =>
    db
      .prepare(
        'INSERT INTO drop_value_rules (game_id, metric_id, label, min_value, max_value, valuation, counts) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(
        gameId,
        rule.metricId,
        rule.label,
        rule.minValue,
        rule.maxValue,
        rule.valuation,
        rule.counts
      )
  ),
];

/** Same units on the team score, player breakdown and public roster. Admin adjustments stay effective. */
export const valueScoreSql = (aggregate: Aggregate) =>
  aggregate === 'MAX_VALUE'
    ? "MAX(0, COALESCE(MAX(CASE WHEN e.metric_type = 'DROP' THEN c.credited END), 0) + COALESCE(SUM(CASE WHEN e.metric_type = 'MANUAL' THEN c.credited ELSE 0 END), 0))"
    : "MAX(0, COUNT(CASE WHEN e.metric_type = 'DROP' AND c.credited > 0 THEN 1 END) + COALESCE(SUM(CASE WHEN e.metric_type = 'MANUAL' THEN c.credited ELSE 0 END), 0))";
