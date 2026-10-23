import { describe, expect, it } from 'vitest';

import { parseBoardTransfer } from '../boardTransfer';

const size = { rows: 5, cols: 5 };
const tile = {
  row: 0,
  col: 0,
  label: 'Five kills',
  requirement: { metrics: ['kc.vorkath'], aggregate: 'SUM', target: 5 },
};

describe('board imports', () => {
  it('accepts an exported board and supplies local editor IDs', () => {
    expect(
      parseBoardTransfer(
        JSON.stringify({ rows: 2, cols: 3, tiles: [tile] }),
        size
      )
    ).toEqual({ rows: 2, cols: 3, tiles: [{ ...tile, id: 'imported_0_0' }] });
  });

  it('supports older imports without dimensions', () => {
    expect(
      parseBoardTransfer(JSON.stringify({ tiles: [tile] }), size).rows
    ).toBe(5);
  });

  it.each([
    null,
    {},
    { rows: 0, tiles: [] },
    { cols: 1000, tiles: [] },
    { rows: 1.5, tiles: [] },
    { tiles: [null] },
    { tiles: [{ ...tile, row: -1 }] },
    { tiles: [{ ...tile, col: 5 }] },
    { tiles: [{ ...tile, label: null }] },
    { tiles: [{ ...tile, requirement: { metrics: null } }] },
    { tiles: [tile, tile] },
  ])('rejects malformed data before replacing the board: %j', (data) => {
    expect(() => parseBoardTransfer(JSON.stringify(data), size)).toThrow();
  });
});
