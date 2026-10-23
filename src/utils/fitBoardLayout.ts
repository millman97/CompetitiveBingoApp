import type {
  BoardLayout,
  BoardLayoutMeasurements,
} from '../model/domain/Board/BoardLayout';

/** Fit against the outer viewport so narrowing the page cannot shrink it again. */
export const fitBoardLayout = ({
  rows,
  cols,
  viewportWidth,
  gridHeight,
  sidebarWidth,
  columnGap,
  tileGap,
  pageChromeWidth,
  boardChromeWidth,
  coordinateWidth,
  coordinateHeight,
}: BoardLayoutMeasurements): BoardLayout => {
  const maxBoardWidth = Math.max(
    0,
    viewportWidth - pageChromeWidth - sidebarWidth - columnGap
  );
  // Leave 2px for fractional browser layout rounding, as in the CSS fallback.
  const gridInlineSpace = coordinateWidth + cols * tileGap + 2;
  const gridBlockSpace = coordinateHeight + rows * tileGap + 2;
  const tileSize = Math.max(
    44,
    Math.floor(
      Math.min(
        (maxBoardWidth - boardChromeWidth - gridInlineSpace) / cols,
        (gridHeight - gridBlockSpace) / rows
      )
    )
  );
  const boardWidth = Math.min(
    maxBoardWidth,
    Math.ceil(boardChromeWidth + gridInlineSpace + cols * tileSize)
  );
  return {
    tileSize,
    boardWidth,
    pageWidth: boardWidth + sidebarWidth + columnGap + pageChromeWidth,
  };
};
