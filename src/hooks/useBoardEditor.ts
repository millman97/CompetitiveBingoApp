import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import apiFetchMetricCatalogue from '../apis/admin/apiFetchMetricCatalogue';
import apiSaveBoard from '../apis/admin/apiSaveBoard';
import { AdminError } from '../error/errors/AdminError';
import type {
  BoardEditorProps,
  Position,
  TileProblem,
} from '../model/domain/Board/Board';
import type { AdminTile } from '../model/domain/Game/Game';
import {
  KILL_CATALOGUE,
  labelFor,
} from '../model/domain/Metric/metricCatalogue';
import type { Option } from '../model/domain/Metric/MetricOption';
import { describeTile, emptyTile, isFilled } from '../utils/boardEditor';
import { parseBoardTransfer } from '../utils/boardTransfer';
import { isManagedValueMetric } from '../worker/scoring/value-tiles';
import useUnsavedChanges from './useUnsavedChanges';

const useBoardEditor = ({
  gameId,
  detail,
  onSaved,
  onChange,
  problems: given,
}: BoardEditorProps) => {
  const client = useQueryClient();
  const [rows, setRows] = useState(detail.game.boardRows);
  const [cols, setCols] = useState(detail.game.boardCols);
  const [tiles, setTiles] = useState<AdminTile[]>(detail.tiles);
  const [selected, setSelected] = useState<Position | null>(
    detail.tiles[0] === undefined
      ? null
      : { row: detail.tiles[0].row, col: detail.tiles[0].col }
  );
  const [ownProblems, setOwnProblems] = useState<TileProblem[]>([]);
  const [dragging, setDragging] = useState<Position | null>(null);
  const [confirmLiveEdit, setConfirmLiveEdit] = useState<string[] | null>(null);
  const [clearing, setClearing] = useState(false);
  const [resizing, setResizing] = useState<{
    rows: number;
    cols: number;
  } | null>(null);
  const [importing, setImporting] = useState<ReturnType<
    typeof parseBoardTransfer
  > | null>(null);
  const [moving, setMoving] = useState<Position | null>(null);
  const [savedBoard, setSavedBoard] = useState(() =>
    JSON.stringify(detail.tiles)
  );
  const dirty = JSON.stringify(tiles) !== savedBoard;
  useUnsavedChanges(gameId !== null && dirty);
  const resize = (next: { rows: number; cols: number }) => {
    if (
      ![next.rows, next.cols].every(
        (value) => Number.isInteger(value) && value >= 1 && value <= 9
      )
    )
      return;
    if (
      tiles.some(
        (tile) =>
          isFilled(tile) && (tile.row >= next.rows || tile.col >= next.cols)
      )
    ) {
      setResizing(next);
      return;
    }
    setRows(next.rows);
    setCols(next.cols);
    setSelected(null);
  };
  const applyImport = (board: ReturnType<typeof parseBoardTransfer>) => {
    setRows(board.rows);
    setCols(board.cols);
    setTiles(board.tiles);
    setSelected(null);
    setOwnProblems([]);
    setImporting(null);
  };
  const [transfer, setTransfer] = useState('');

  // A draft has observed nothing, so there is nothing to promote to the top of the picker.
  const catalogue = useQuery({
    queryKey: ['admin', 'catalogue', gameId],
    queryFn: () => apiFetchMetricCatalogue(gameId as string),
    enabled: gameId !== null,
  });

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onChangeRef.current?.({ rows, cols, tiles });
  }, [rows, cols, tiles]);

  // A parent with nothing to report falls back to whatever went wrong in here, so a bad import
  // still marks its own squares while a draft is being assembled.
  const problems =
    given === undefined || given.length === 0 ? ownProblems : given;

  /**
   * Observed ordinary metrics are exact by construction. Value tracking belongs to
   * the separate Drop value category, rather than the item-drop catalogue.
   */
  const observed = useMemo<Option[]>(() => {
    const valueMetrics = new Set(
      detail.dropValueRules.map((rule) => rule.metricId)
    );
    const result: Option[] = [];

    for (const entry of catalogue.data?.observed ?? []) {
      if (
        valueMetrics.has(entry.metric_id) ||
        isManagedValueMetric(entry.metric_id)
      )
        continue;
      result.push({
        metricId: entry.metric_id,
        label: labelFor(entry.metric_id),
        group: `seen ${entry.seen}×`,
      });
    }

    return result;
  }, [catalogue.data, detail.dropValueRules]);

  const at = (row: number, col: number): AdminTile =>
    tiles.find((tile) => tile.row === row && tile.col === col) ??
    emptyTile(row, col);

  const update = (tile: AdminTile): void => {
    setTiles((current) => [
      ...current.filter(
        (entry) => !(entry.row === tile.row && entry.col === tile.col)
      ),
      tile,
    ]);
  };

  const boardMetrics = [
    ...new Set(
      tiles.filter(isFilled).flatMap((tile) => tile.requirement.metrics)
    ),
  ];
  const tracked = detail.trackedMetrics.map((entry) => entry.metricId);
  const willAdd = boardMetrics.filter((metric) => !tracked.includes(metric));
  const isRunning =
    detail.game.state === 'LIVE' || detail.game.state === 'SUDDEN_DEATH';

  const submittedBoard = useRef('');
  const save = useMutation({
    onMutate: () => {
      submittedBoard.current = JSON.stringify(tiles);
    },
    mutationFn: () =>
      apiSaveBoard(gameId, {
        tiles: tiles.filter(isFilled).map((tile) => ({
          row: tile.row,
          col: tile.col,
          label: tile.label,
          requirement: tile.requirement,
        })),
      }),
    onSuccess: () => {
      setSavedBoard(submittedBoard.current);
      setOwnProblems([]);
      setConfirmLiveEdit(null);
      void client.invalidateQueries({ queryKey: ['admin', 'game', gameId] });
      onSaved();
    },
    onError: (error) => {
      setConfirmLiveEdit(null);
      if (
        error instanceof AdminError &&
        typeof error.body === 'object' &&
        error.body !== null
      ) {
        const body = error.body as {
          problems?: { row: number; col: number; problems: string[] }[];
        };
        setOwnProblems(body.problems ?? []);
      }
    },
  });

  const attemptSave = () => {
    // Adding a metric to a running game is the one board change with a consequence a warning can
    // prevent, so it is the only one that stops to ask.
    if (isRunning && willAdd.length > 0) {
      setConfirmLiveEdit(willAdd);
      return;
    }
    save.mutate();
  };

  /** Moves a tile onto another square, swapping with whatever is already there. */
  const swap = (from: Position, to: Position): void => {
    if (from.row === to.row && from.col === to.col) {
      return;
    }

    const source = at(from.row, from.col);
    const target = at(to.row, to.col);

    setTiles((current) => {
      const rest = current.filter(
        (tile) =>
          !(tile.row === from.row && tile.col === from.col) &&
          !(tile.row === to.row && tile.col === to.col)
      );
      const moved: AdminTile[] = [{ ...source, row: to.row, col: to.col }];
      if (isFilled(target)) {
        moved.push({ ...target, row: from.row, col: from.col });
      }
      return [...rest, ...moved];
    });

    setSelected(to);
  };

  const shuffle = (): void => {
    const filled = tiles.filter(isFilled);
    const positions: Position[] = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        positions.push({ row, col });
      }
    }

    for (let i = positions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [positions[i], positions[j]] = [
        positions[j] as Position,
        positions[i] as Position,
      ];
    }

    setTiles(
      filled.map((tile, index) => ({
        ...tile,
        ...(positions[index] as Position),
      }))
    );
    setSelected(null);
  };

  /**
   * Fills every empty square with a metric the board is not already using.
   *
   * The pool is shuffled once and drawn from in order rather than sampled per square: sampling
   * would collide with metrics already taken, and a square whose pick collided would be left
   * empty — which looks like the button half-worked.
   */
  const randomFill = (): void => {
    const used = new Set(
      tiles.filter(isFilled).flatMap((tile) => tile.requirement.metrics)
    );
    const pool = KILL_CATALOGUE.filter((option) => !used.has(option.metricId));

    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j] as Option, pool[i] as Option];
    }

    const next = [...tiles];
    let taken = 0;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (isFilled(at(row, col))) {
          continue;
        }

        const pick = pool[taken];
        if (pick === undefined) {
          // The catalogue ran out. Better a partly filled board than repeated tiles.
          break;
        }
        taken += 1;

        const target = detail.game.mode === 'CONTROL' ? 1 : 5;
        next.push({
          id: `new_${row}_${col}`,
          row,
          col,
          label: describeTile(pick.metricId, pick.label, target),
          requirement: { metrics: [pick.metricId], aggregate: 'SUM', target },
        });
      }
    }

    setTiles(next);
  };

  const exportJson = (): void => {
    setTransfer(
      JSON.stringify(
        {
          rows,
          cols,
          tiles: tiles
            .filter(isFilled)
            .sort((a, b) => a.row - b.row || a.col - b.col)
            .map((tile) => ({
              row: tile.row,
              col: tile.col,
              label: tile.label,
              requirement: tile.requirement,
            })),
        },
        null,
        2
      )
    );
  };

  const importJson = (): void => {
    try {
      const board = parseBoardTransfer(transfer, { rows, cols });
      if (gameId !== null && (board.rows !== rows || board.cols !== cols))
        throw new Error(
          'This event has a fixed board size. Import a board with the same rows and columns, or create a new event.'
        );
      if (tiles.some(isFilled)) setImporting(board);
      else applyImport(board);
    } catch (error) {
      setOwnProblems([
        {
          row: 0,
          col: 0,
          problems: [
            error instanceof Error
              ? error.message
              : 'That is not a board this editor can read.',
          ],
        },
      ]);
    }
  };

  const current = selected === null ? null : at(selected.row, selected.col);
  const problemFor = (row: number, col: number) =>
    problems.find((entry) => entry.row === row && entry.col === col);
  return {
    rows,
    setRows,
    cols,
    setCols,
    tiles,
    setTiles,
    selected,
    setSelected,
    dragging,
    setDragging,
    confirmLiveEdit,
    setConfirmLiveEdit,
    clearing,
    setClearing,
    resizing,
    setResizing,
    importing,
    setImporting,
    moving,
    setMoving,
    dirty,
    resize,
    applyImport,
    transfer,
    setTransfer,
    problems,
    observed,
    at,
    update,
    save,
    attemptSave,
    swap,
    shuffle,
    randomFill,
    exportJson,
    importJson,
    current,
    problemFor,
  };
};

export default useBoardEditor;
