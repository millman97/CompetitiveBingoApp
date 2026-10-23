import type { AdminTile } from '../model/domain/Game/Game';
import {
  isValueAggregate,
  valueRequirementProblems,
} from '../worker/scoring/value-tiles';

export interface ImportedBoard {
  rows: number;
  cols: number;
  tiles: AdminTile[];
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const parseBoardTransfer = (
  text: string,
  size: { rows: number; cols: number }
): ImportedBoard => {
  const value: unknown = JSON.parse(text);
  if (!record(value) || !Array.isArray(value.tiles))
    throw new Error('Paste a board exported from Competitive Bingo.');
  const rows = value.rows ?? size.rows;
  const cols = value.cols ?? size.cols;
  if (
    ![rows, cols].every(
      (dimension) =>
        typeof dimension === 'number' &&
        Number.isInteger(dimension) &&
        dimension >= 1 &&
        dimension <= 9
    )
  )
    throw new Error(
      'The imported board must have between 1 and 9 rows and columns.'
    );
  const cells = new Set<string>();
  const tiles = value.tiles.map((tile, index): AdminTile => {
    if (
      !record(tile) ||
      typeof tile.row !== 'number' ||
      typeof tile.col !== 'number' ||
      !Number.isInteger(tile.row) ||
      !Number.isInteger(tile.col) ||
      tile.row < 0 ||
      tile.row >= Number(rows) ||
      tile.col < 0 ||
      tile.col >= Number(cols) ||
      typeof tile.label !== 'string' ||
      !record(tile.requirement) ||
      !Array.isArray(tile.requirement.metrics) ||
      !tile.requirement.metrics.every((metric) => typeof metric === 'string') ||
      !['SUM', 'UNIQUE', 'MIN_DURATION', 'COUNT_DROPS', 'MAX_VALUE'].includes(
        String(tile.requirement.aggregate)
      ) ||
      !(
        tile.requirement.target === null ||
        (typeof tile.requirement.target === 'number' &&
          Number.isFinite(tile.requirement.target))
      )
    )
      throw new Error(
        `Tile ${index + 1} has an invalid position, label or scoring rule. Your board has not been replaced.`
      );
    if (isValueAggregate(String(tile.requirement.aggregate))) {
      const reasons = valueRequirementProblems(
        tile.requirement as unknown as AdminTile['requirement']
      );
      if (reasons.length)
        throw new Error(`Tile ${index + 1}: ${reasons.join(' ')}`);
    }
    const cell = `${tile.row},${tile.col}`;
    if (cells.has(cell))
      throw new Error(
        `More than one tile uses row ${tile.row + 1}, column ${tile.col + 1}.`
      );
    cells.add(cell);
    return {
      id: `imported_${tile.row}_${tile.col}`,
      row: tile.row,
      col: tile.col,
      label: tile.label,
      requirement: tile.requirement as unknown as AdminTile['requirement'],
    };
  });
  return { rows: Number(rows), cols: Number(cols), tiles };
};
