import { describe, expect, it } from 'vitest';
import type { BoardLayoutMeasurements } from '../../model/domain/Board/BoardLayout';
import { fitBoardLayout } from '../fitBoardLayout';

const measurements: BoardLayoutMeasurements = {
  rows: 5,
  cols: 5,
  viewportWidth: 1800,
  gridHeight: 700,
  sidebarWidth: 360,
  columnGap: 18,
  tileGap: 8,
  pageChromeWidth: 0,
  boardChromeWidth: 38,
  coordinateWidth: 18,
  coordinateHeight: 22,
};

describe('public board layout sizing', () => {
  it('wraps a height-limited square board and sizes the page to the board plus sidebar', () => {
    const fit = fitBoardLayout(measurements);
    expect(fit).toEqual({ tileSize: 127, boardWidth: 733, pageWidth: 1111 });
    expect(fit.pageWidth).toBeLessThan(measurements.viewportWidth);
    expect(fit.boardWidth - measurements.boardChromeWidth).toBe(
      measurements.coordinateWidth +
        5 * fit.tileSize +
        5 * measurements.tileGap +
        2
    );
  });

  it('fits a narrow desktop without exceeding either the width or height', () => {
    const input = { ...measurements, viewportWidth: 800, sidebarWidth: 260 };
    const fit = fitBoardLayout(input);
    expect(fit.tileSize).toBe(84);
    expect(fit.pageWidth).toBeLessThanOrEqual(input.viewportWidth);
    expect(
      input.coordinateHeight + input.rows * (fit.tileSize + input.tileGap) + 2
    ).toBeLessThanOrEqual(input.gridHeight);
  });

  it.each([
    [3, 7],
    [7, 3],
    [1, 1],
    [9, 9],
  ])(
    'keeps %i × %i board tiles square while reserving coordinates and gaps',
    (rows, cols) => {
      const input = { ...measurements, rows, cols };
      const fit = fitBoardLayout(input);
      expect(
        input.coordinateHeight + rows * (fit.tileSize + input.tileGap) + 2
      ).toBeLessThanOrEqual(input.gridHeight);
      expect(fit.pageWidth).toBeLessThanOrEqual(input.viewportWidth);
      expect(Number.isInteger(fit.tileSize)).toBe(true);
      expect(fit.boardWidth).toBe(
        input.boardChromeWidth +
          input.coordinateWidth +
          cols * (fit.tileSize + input.tileGap) +
          2
      );
    }
  );

  it('accounts for page padding and fractional sidebar widths without adding overflow', () => {
    const input = {
      ...measurements,
      viewportWidth: 1000.5,
      sidebarWidth: 300.25,
      pageChromeWidth: 12,
    };
    const fit = fitBoardLayout(input);
    expect(fit.pageWidth).toBeLessThanOrEqual(input.viewportWidth);
    expect(fit.pageWidth).toBe(
      fit.boardWidth +
        input.sidebarWidth +
        input.columnGap +
        input.pageChromeWidth
    );
  });

  it('shrinks when a taller heading or connection message takes up more vertical space', () => {
    const smaller = fitBoardLayout({ ...measurements, gridHeight: 540 });
    const original = fitBoardLayout(measurements);
    expect(smaller.tileSize).toBeLessThan(original.tileSize);
    expect(smaller.boardWidth).toBeLessThan(original.boardWidth);
    expect(smaller.pageWidth).toBeLessThan(original.pageWidth);
  });

  it('reserves readable minimum tiles on an exceptionally small viewport while keeping the page within its width', () => {
    const input = {
      ...measurements,
      rows: 9,
      cols: 9,
      viewportWidth: 600,
      gridHeight: 250,
    };
    const fit = fitBoardLayout(input);
    expect(fit.tileSize).toBe(44);
    expect(fit.pageWidth).toBeLessThanOrEqual(input.viewportWidth);
  });
});
