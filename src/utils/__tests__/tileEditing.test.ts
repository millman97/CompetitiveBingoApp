import { describe, expect, it } from 'vitest';
import type { AdminTile, Aggregate } from '../../model/domain/Game/Game';
import { familyOf } from '../../model/domain/Metric/metricCatalogue';
import { emptyTile } from '../boardEditor';
import { addTileMetric, categoryForTile, scoringForTile } from '../tileEditing';
import { changeTileAggregate } from '../valueTiles';

const categories = [
  { metric: 'kc.vorkath', aggregate: 'SUM' },
  { metric: 'kill.abyssal_demon', aggregate: 'SUM' },
  { metric: 'time.gauntlet', aggregate: 'MIN_DURATION' },
  { metric: 'drop.abyssal_whip', aggregate: 'SUM' },
  { metric: 'collection_log.*', aggregate: 'UNIQUE' },
] satisfies { metric: string; aggregate: Aggregate }[];

const tileWith = (
  metrics: string[],
  aggregate: Aggregate = 'SUM'
): AdminTile => ({
  ...emptyTile(0, 0),
  label: 'Clan challenge',
  requirement: {
    metrics,
    aggregate,
    target: aggregate === 'MIN_DURATION' ? null : 1,
  },
});

describe('tile metric categories', () => {
  it.each(categories)(
    'replaces other categories when choosing $metric, including when leaving speed scoring',
    ({ metric }) => {
      for (const previous of categories) {
        const original = tileWith([previous.metric], previous.aggregate);
        const changed = addTileMetric(original, metric);
        expect(changed.requirement.metrics).toEqual([metric]);
        expect(changed.requirement.aggregate).toBe(
          familyOf(metric) === 'SPEED'
            ? 'MIN_DURATION'
            : previous.aggregate === 'UNIQUE'
              ? 'UNIQUE'
              : 'SUM'
        );
        expect(changed.requirement.target).toBe(
          familyOf(metric) === 'SPEED' ? null : 1
        );
        expect(original.requirement.metrics).toEqual([previous.metric]);
        expect(changed.label).toBe('Clan challenge');
      }
    }
  );

  it('keeps several metrics in the same category without duplicating a selection', () => {
    const original = tileWith(['kc.vorkath', 'kc.zulrah']);
    const changed = addTileMetric(original, 'kc.cerberus');
    expect(changed.requirement.metrics).toEqual([
      'kc.vorkath',
      'kc.zulrah',
      'kc.cerberus',
    ]);
    expect(addTileMetric(changed, 'kc.cerberus')).toEqual(changed);
  });

  it('cleans up an older mixed-category tile when another metric is selected', () => {
    const original = tileWith([
      'kc.vorkath',
      'drop.abyssal_whip',
      'kill.abyssal_demon',
    ]);
    expect(
      addTileMetric(original, 'drop.abyssal_dagger').requirement.metrics
    ).toEqual(['drop.abyssal_whip', 'drop.abyssal_dagger']);
  });

  it.each(categories)(
    'clears a value filter and its hidden tracking metric when choosing $metric',
    ({ metric }) => {
      const value = changeTileAggregate(emptyTile(0, 0), 'MAX_VALUE');
      const changed = addTileMetric(value, metric);
      expect(changed.requirement.metrics).toEqual([metric]);
      expect(changed.requirement.dropValue).toBeUndefined();
      expect(categoryForTile(changed.requirement)).toBe(familyOf(metric));
    }
  );

  it('keeps the value modes mutually exclusive with a single reusable tracking rule', () => {
    const original = tileWith(['drop.abyssal_whip', 'drop.abyssal_dagger']);
    const count = changeTileAggregate(original, 'COUNT_DROPS');
    const best = changeTileAggregate(count, 'MAX_VALUE');
    const back = changeTileAggregate(best, 'COUNT_DROPS');
    expect(count.requirement.metrics).toHaveLength(1);
    expect(count.requirement.metrics).not.toContain('drop.abyssal_whip');
    expect(best.requirement.aggregate).toBe('MAX_VALUE');
    expect(back.requirement.aggregate).toBe('COUNT_DROPS');
    expect(back.requirement.metrics).toEqual(count.requirement.metrics);
    expect(back.requirement.dropValue).toEqual(count.requirement.dropValue);
    expect(categoryForTile(back.requirement)).toBe('VALUE');
  });

  it('does not allow a hidden value tracking ID to be added as an ordinary drop', () => {
    const original = tileWith(['drop.abyssal_whip']);
    const value = changeTileAggregate(emptyTile(0, 0), 'MAX_VALUE');
    expect(addTileMetric(original, value.requirement.metrics[0]!)).toEqual(
      original
    );
  });
});

describe('category-specific scoring choices', () => {
  it.each(categories)(
    'offers only scoring applicable to $metric',
    ({ metric, aggregate }) => {
      expect(scoringForTile(tileWith([metric], aggregate).requirement)).toEqual(
        familyOf(metric) === 'SPEED' ? ['MIN_DURATION'] : ['SUM', 'UNIQUE']
      );
    }
  );

  it.each(['COUNT_DROPS', 'MAX_VALUE'] as const)(
    'offers only the two value modes for %s, despite their drop. tracking prefix',
    (aggregate) => {
      const tile = changeTileAggregate(emptyTile(0, 0), aggregate);
      expect(scoringForTile(tile.requirement)).toEqual([
        'COUNT_DROPS',
        'MAX_VALUE',
      ]);
    }
  );

  it('keeps fastest-time scoring available after its final metric is removed', () => {
    expect(scoringForTile(tileWith([], 'MIN_DURATION').requirement)).toEqual([
      'MIN_DURATION',
    ]);
  });
});
