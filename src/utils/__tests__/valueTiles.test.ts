import { describe, expect, it } from 'vitest';
import { emptyTile } from '../boardEditor';
import { changeTileAggregate, changeValueSettings } from '../valueTiles';
import { parseBoardTransfer } from '../boardTransfer';
import { newDraft } from '../gameDraft';
import { readDraft, writeDraft } from '../gameDraftStorage';

describe('value tile editing and persistence', () => {
  it('creates a complete, valid value challenge without a separate rule editor', () => {
    const tile = changeTileAggregate(emptyTile(0, 0), 'COUNT_DROPS');
    expect(tile.requirement).toMatchObject({
      aggregate: 'COUNT_DROPS',
      target: 1,
      dropValue: { minValue: 1_000_000, valuation: 'GRAND_EXCHANGE' },
    });
    expect(tile.requirement.metrics[0]).toMatch(
      /^drop\.bingo_tile_value_[a-f0-9]+$/
    );
  });
  it('changes the comparison while reusing the same priced observations when the filter is unchanged', () => {
    const count = changeTileAggregate(emptyTile(0, 0), 'COUNT_DROPS');
    const best = changeTileAggregate(count, 'MAX_VALUE');
    expect(best.requirement.metrics).toEqual(count.requirement.metrics);
    expect(best.requirement.target).toBeNull();
    expect(best.requirement.dropValue).toEqual(count.requirement.dropValue);
  });
  it('starts a new tracking rule when a value filter changes, keeping the original requirement intact', () => {
    const tile = changeTileAggregate(emptyTile(0, 0), 'COUNT_DROPS');
    const changed = changeValueSettings(tile.requirement, {
      minValue: 5_000_000,
    });
    expect(changed.metrics).not.toEqual(tile.requirement.metrics);
    expect(changed.dropValue.minValue).toBe(5_000_000);
    expect(tile.requirement.dropValue?.minValue).toBe(1_000_000);
  });
  it('clears the hidden value rule when changing back to an ordinary challenge', () => {
    const value = changeTileAggregate(emptyTile(0, 0), 'MAX_VALUE');
    expect(changeTileAggregate(value, 'SUM').requirement).toEqual({
      metrics: [],
      aggregate: 'SUM',
      target: 1,
    });
  });
  it('round-trips value rules through board export/import and the saved setup draft', () => {
    const tile = changeTileAggregate(emptyTile(0, 0), 'MAX_VALUE');
    const restored = parseBoardTransfer(
      JSON.stringify({ rows: 1, cols: 1, tiles: [tile] }),
      { rows: 1, cols: 1 }
    );
    expect(restored.tiles[0]?.requirement).toEqual(tile.requirement);
    const draft = {
      ...newDraft('Value bingo', 'CONTROL', 'FIRST_LINE'),
      tiles: [tile],
    };
    expect(readDraft(writeDraft(draft))?.tiles[0]?.requirement).toEqual(
      tile.requirement
    );
  });
  it('rejects broken value-filter settings before restoring a saved editor', () => {
    const tile = changeTileAggregate(emptyTile(0, 0), 'MAX_VALUE');
    const draft = {
      ...newDraft('Value bingo', 'CONTROL', 'FIRST_LINE'),
      tiles: [
        {
          ...tile,
          requirement: {
            ...tile.requirement,
            dropValue: {
              minValue: '1m',
              maxValue: null,
              valuation: 'GRAND_EXCHANGE',
            },
          },
        },
      ],
    };
    expect(() => readDraft(JSON.stringify({ version: 1, draft }))).toThrow(
      'could not be read'
    );
  });
});
