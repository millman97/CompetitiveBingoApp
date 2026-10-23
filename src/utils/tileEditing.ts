import type { AdminTile, TileRequirement } from '../model/domain/Game/Game';
import { familyOf } from '../model/domain/Metric/metricCatalogue';
import {
  SCORING_BY_CATEGORY,
  type TileMetricCategory,
} from '../model/domain/Metric/TileMetricCategory';
import {
  isManagedValueMetric,
  isValueAggregate,
} from '../worker/scoring/value-tiles';

export const categoryForTile = (
  requirement: TileRequirement
): TileMetricCategory =>
  isValueAggregate(requirement.aggregate)
    ? 'VALUE'
    : (familyOf(requirement.metrics[0] ?? '') ??
      (requirement.aggregate === 'MIN_DURATION' ? 'SPEED' : 'COUNTS'));

export const scoringForTile = (requirement: TileRequirement) =>
  SCORING_BY_CATEGORY[categoryForTile(requirement)];

/** Browsing is harmless; choosing a metric replaces metrics from other categories. */
export const addTileMetric = (tile: AdminTile, metricId: string): AdminTile => {
  const category = familyOf(metricId);
  if (category === null || isManagedValueMetric(metricId)) return tile;

  const allowed = SCORING_BY_CATEGORY[category];
  const aggregate = allowed.includes(tile.requirement.aggregate)
    ? tile.requirement.aggregate
    : allowed[0]!;
  const retained = isValueAggregate(tile.requirement.aggregate)
    ? []
    : tile.requirement.metrics.filter(
        (metric) =>
          familyOf(metric) === category && !isManagedValueMetric(metric)
      );

  return {
    ...tile,
    requirement: {
      metrics: [...new Set([...retained, metricId])],
      aggregate,
      target:
        aggregate === 'MIN_DURATION' ? null : (tile.requirement.target ?? 1),
    },
  };
};
