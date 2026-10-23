import type { Aggregate } from '../Game/Game';
import type { MetricFamily } from './metricCatalogue';

export type TileMetricCategory = MetricFamily | 'VALUE';
export type ValueAggregate = Extract<Aggregate, 'COUNT_DROPS' | 'MAX_VALUE'>;

export interface ScoringOption {
  value: Aggregate;
  label: string;
  help: string;
}

export const VALUE_SCORING_OPTIONS: (ScoringOption & {
  value: ValueAggregate;
})[] = [
  {
    value: 'COUNT_DROPS',
    label: 'Drops above a value',
    help: 'Count loot stacks meeting the value filter.',
  },
  {
    value: 'MAX_VALUE',
    label: 'Most valuable drop',
    help: 'The team with the highest single stack value holds the tile.',
  },
];

export const TILE_SCORING_OPTIONS: ScoringOption[] = [
  {
    value: 'SUM',
    label: 'Total',
    help: 'Adds up everything across the metrics listed.',
  },
  {
    value: 'UNIQUE',
    label: 'Different things',
    help: 'Counts how many of the listed metrics have been contributed to at all.',
  },
  {
    value: 'MIN_DURATION',
    label: 'Fastest time',
    help: 'The fastest run wins. Only time metrics, and no target.',
  },
  ...VALUE_SCORING_OPTIONS,
];

export const SCORING_BY_CATEGORY: Record<TileMetricCategory, Aggregate[]> = {
  COUNTS: ['SUM', 'UNIQUE'],
  MONSTERS: ['SUM', 'UNIQUE'],
  SPEED: ['MIN_DURATION'],
  DROPS: ['SUM', 'UNIQUE'],
  LOG: ['SUM', 'UNIQUE'],
  VALUE: ['COUNT_DROPS', 'MAX_VALUE'],
};
