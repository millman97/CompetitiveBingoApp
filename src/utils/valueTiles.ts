import type {
  AdminTile,
  Aggregate,
  DropValueSettings,
} from '../model/domain/Game/Game';
import {
  isValueAggregate,
  VALUE_METRIC_PREFIX,
} from '../worker/scoring/value-tiles';

export const newValueMetricId = () =>
  VALUE_METRIC_PREFIX +
  Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) =>
    value.toString(16).padStart(8, '0')
  ).join('');

export const changeTileAggregate = (
  tile: AdminTile,
  aggregate: Aggregate
): AdminTile => {
  if (isValueAggregate(aggregate)) {
    const existing =
      isValueAggregate(tile.requirement.aggregate) &&
      tile.requirement.dropValue;
    const metricId = existing
      ? tile.requirement.metrics[0]!
      : newValueMetricId();
    return {
      ...tile,
      label: tile.label.trim()
        ? tile.label
        : aggregate === 'MAX_VALUE'
          ? 'Most valuable drop'
          : 'Valuable drops',
      requirement: {
        metrics: [metricId],
        aggregate,
        target:
          aggregate === 'MAX_VALUE'
            ? null
            : isValueAggregate(tile.requirement.aggregate)
              ? (tile.requirement.target ?? 1)
              : 1,
        dropValue: existing || {
          minValue: aggregate === 'COUNT_DROPS' ? 1_000_000 : null,
          maxValue: null,
          valuation: 'GRAND_EXCHANGE',
        },
      },
    };
  }
  return {
    ...tile,
    requirement: {
      metrics: isValueAggregate(tile.requirement.aggregate)
        ? []
        : tile.requirement.metrics,
      aggregate,
      target:
        aggregate === 'MIN_DURATION' ? null : (tile.requirement.target ?? 1),
    },
  };
};

export const changeValueSettings = (
  requirement: AdminTile['requirement'],
  patch: Partial<DropValueSettings>
) => ({
  ...requirement,
  metrics: [newValueMetricId()],
  dropValue: { ...requirement.dropValue!, ...patch },
});

export const formatTileScore = (aggregate: string, score: number) =>
  score.toLocaleString('en-GB') + (aggregate === 'MAX_VALUE' ? ' gp' : '');

export const valueFilterLabel = (settings: DropValueSettings) =>
  settings.minValue !== null && settings.maxValue !== null
    ? `${settings.minValue.toLocaleString('en-GB')}–${settings.maxValue.toLocaleString('en-GB')} gp`
    : settings.minValue !== null
      ? `${settings.minValue.toLocaleString('en-GB')} gp or more`
      : settings.maxValue !== null
        ? `Up to ${settings.maxValue.toLocaleString('en-GB')} gp`
        : 'Any priced loot stack';
