import type { BoardShape } from './Board';

export type BoardSize = Pick<BoardShape, 'rows' | 'cols'>;

export interface BoardLayoutMeasurements extends BoardSize {
  viewportWidth: number;
  gridHeight: number;
  sidebarWidth: number;
  columnGap: number;
  tileGap: number;
  pageChromeWidth: number;
  boardChromeWidth: number;
  coordinateWidth: number;
  coordinateHeight: number;
}

export interface BoardLayout {
  tileSize: number;
  boardWidth: number;
  pageWidth: number;
}
