import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { BoardLayout, BoardSize } from '../model/domain/Board/BoardLayout';
import { fitBoardLayout } from '../utils/fitBoardLayout';

const pixels = (value: string) => Number.parseFloat(value) || 0;
const inlinePadding = (style: CSSStyleDeclaration) =>
  pixels(style.paddingLeft) + pixels(style.paddingRight);

const usePublicBoardLayout = (size?: BoardSize) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<BoardLayout | null>(null);
  const rows = size?.rows;
  const cols = size?.cols;

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const shell = shellRef.current;
    if (!viewport || !shell || rows === undefined || cols === undefined) return;

    const workspace = shell.querySelector<HTMLElement>('.live-board-layout');
    const sidebar = shell.querySelector<HTMLElement>('.board-sidebar');
    const panel = shell.querySelector<HTMLElement>('.bingo-board-panel');
    const gridViewport = shell.querySelector<HTMLElement>('.board-scroll');
    const grid = shell.querySelector<HTMLElement>('.board-grid');
    if (!workspace || !sidebar || !panel || !gridViewport || !grid) return;

    const desktop = window.matchMedia('(min-width: 821px)');
    let frame: number | null = null;
    const measure = () => {
      if (!desktop.matches) {
        setLayout(null);
        return;
      }
      const viewportStyle = getComputedStyle(viewport);
      const gridViewportStyle = getComputedStyle(gridViewport);
      const gridStyle = getComputedStyle(grid);
      const next = fitBoardLayout({
        rows,
        cols,
        viewportWidth: viewport.clientWidth - inlinePadding(viewportStyle),
        gridHeight:
          gridViewport.clientHeight -
          pixels(gridViewportStyle.paddingTop) -
          pixels(gridViewportStyle.paddingBottom),
        sidebarWidth: sidebar.getBoundingClientRect().width,
        columnGap: pixels(getComputedStyle(workspace).columnGap),
        tileGap: pixels(gridStyle.columnGap),
        pageChromeWidth:
          shell.getBoundingClientRect().width -
          workspace.getBoundingClientRect().width,
        boardChromeWidth:
          panel.getBoundingClientRect().width -
          gridViewport.getBoundingClientRect().width +
          inlinePadding(gridViewportStyle) +
          (gridViewport.offsetWidth - gridViewport.clientWidth),
        coordinateWidth: pixels(
          gridStyle.getPropertyValue('--board-coordinate-width')
        ),
        coordinateHeight: pixels(
          gridStyle.getPropertyValue('--board-coordinate-height')
        ),
      });
      setLayout((previous) =>
        previous?.tileSize === next.tileSize &&
        previous.boardWidth === next.boardWidth &&
        previous.pageWidth === next.pageWidth
          ? previous
          : next
      );
    };
    const schedule = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        measure();
      });
    };
    const observer = new ResizeObserver(schedule);
    [viewport, workspace, sidebar, gridViewport].forEach((element) =>
      observer.observe(element)
    );
    desktop.addEventListener('change', schedule);
    measure();
    return () => {
      observer.disconnect();
      desktop.removeEventListener('change', schedule);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [rows, cols]);

  const style = layout
    ? ({
        '--public-board-page-width': `${layout.pageWidth}px`,
        '--public-board-panel-width': `${layout.boardWidth}px`,
        '--fitted-board-tile-size': `${layout.tileSize}px`,
      } as CSSProperties)
    : undefined;
  return { viewportRef, shellRef, style };
};

export default usePublicBoardLayout;
