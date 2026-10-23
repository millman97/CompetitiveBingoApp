import type { Draft } from '../../model/domain/GameDraft/GameDraft';
import { post } from './apiRequest';

const apiCreateGame = (draft: Draft) =>
  post<{ id: string }>('/games', {
    name: draft.name,
    mode: draft.mode,
    winCondition: draft.mode === 'CONTROL' ? draft.winCondition : undefined,
    joinCode: draft.joinCode.trim() === '' ? undefined : draft.joinCode.trim(),
    startsAt: draft.startsAt,
    durationMs: draft.endOffsetMs ?? undefined,
    endsAt: draft.endOffsetMs === null ? draft.endsAt : undefined,
    backfillPolicy: draft.backfillPolicy,
    manualEntryAllowed: draft.manualEntryAllowed,
    boardRows: draft.boardRows,
    boardCols: draft.boardCols,
    teams: draft.teams.map((team) => ({
      name: team.name.trim(),
      colour: team.colour,
    })),
    tiles: draft.tiles
      .filter((tile) => tile.label.trim() !== '')
      .map((tile) => ({
        row: tile.row,
        col: tile.col,
        label: tile.label,
        requirement: tile.requirement,
      })),
  });

export default apiCreateGame;
