// Line detection.
//
// A line is a full row, a full column, or a full diagonal. Diagonals exist only on a square
// board — on a 4x5 grid there is no diagonal to complete, and inventing one would mean a tile
// counted towards a line that the board does not visually contain.

export type LineKind = 'ROW' | 'COLUMN' | 'DIAGONAL';

export interface Line {
  kind: LineKind;
  /** Row index, column index, or 0 for the leading and 1 for the counter diagonal. */
  index: number;
  cells: { row: number; col: number }[];
}

/** Every line a board of this shape contains. */
export const linesFor = (rows: number, cols: number): Line[] => {
  const lines: Line[] = [];

  for (let row = 0; row < rows; row++) {
    lines.push({
      kind: 'ROW',
      index: row,
      cells: Array.from({ length: cols }, (_, col) => ({ row, col })),
    });
  }

  for (let col = 0; col < cols; col++) {
    lines.push({
      kind: 'COLUMN',
      index: col,
      cells: Array.from({ length: rows }, (_, row) => ({ row, col })),
    });
  }

  if (rows === cols && rows > 1) {
    lines.push({
      kind: 'DIAGONAL',
      index: 0,
      cells: Array.from({ length: rows }, (_, i) => ({ row: i, col: i })),
    });
    lines.push({
      kind: 'DIAGONAL',
      index: 1,
      cells: Array.from({ length: rows }, (_, i) => ({ row: i, col: rows - 1 - i })),
    });
  }

  return lines;
};

const key = (row: number, col: number): string => `${row},${col}`;

/**
 * The lines a team has completed, given the cells it holds.
 *
 * "Holds" means completed in CLASSIC and owned in CONTROL. The geometry is identical either way,
 * which is why this takes cells rather than knowing about modes.
 */
export const completedLines = (
  rows: number,
  cols: number,
  held: { row: number; col: number }[],
): Line[] => {
  const heldKeys = new Set(held.map((cell) => key(cell.row, cell.col)));

  return linesFor(rows, cols).filter((line) =>
    line.cells.every((cell) => heldKeys.has(key(cell.row, cell.col))),
  );
};
