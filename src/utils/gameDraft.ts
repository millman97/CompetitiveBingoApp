import type { GameDetail, GameMode } from '../model/domain/Game/Game';
import type { Draft } from '../model/domain/GameDraft/GameDraft';

/** A race is usually an evening; a classic game is usually a week. */
export const DEFAULT_DURATION_MS: Record<GameMode, number> = {
  CONTROL: 4 * 60 * 60 * 1000,
  RUSH: 4 * 60 * 60 * 1000,
  CLASSIC: 7 * 24 * 60 * 60 * 1000,
};

export const newDraft = (
  name: string,
  mode: Draft['mode'],
  winCondition: string
): Draft => {
  // An hour out by default: there is a board to build and people to get synced before it counts.
  const startsAt = Date.now() + 60 * 60 * 1000;
  const endOffsetMs = DEFAULT_DURATION_MS[mode];

  return {
    name,
    mode,
    winCondition,
    joinCode: '',
    startsAt,
    endOffsetMs,
    endsAt: startsAt + endOffsetMs,
    // Crediting off-plugin play is fine over a week and an exploit in a live race.
    backfillPolicy: mode === 'CLASSIC' ? 'COUNT' : 'IGNORE',
    manualEntryAllowed: true,
    boardRows: 5,
    boardCols: 5,
    tiles: [],
    teams: [],
  };
};

/** Enough of a GameDetail for the board editor to work against a game that does not exist. */
export const asDetail = (draft: Draft): GameDetail => ({
  game: {
    id: '',
    name: draft.name,
    joinCode: draft.joinCode,
    mode: draft.mode,
    winCondition: draft.mode === 'CONTROL' ? draft.winCondition : null,
    state: 'UPCOMING',
    startsAt: draft.startsAt,
    endsAt: draft.endsAt,
    endOffsetMs: draft.endOffsetMs,
    boardRows: draft.boardRows,
    boardCols: draft.boardCols,
    screenshotsRequested: true,
    backfillPolicy: draft.backfillPolicy,
    metricsChangedAt: null,
    manualEntryAllowed: draft.manualEntryAllowed,
  },
  setup: { tiles: 0, cells: 0, teams: 0, problems: [] },
  teams: [],
  trackedMetrics: [],
  dropValueRules: [],
  tiles: draft.tiles,
});
