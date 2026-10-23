import type { AdminTile, GameMode } from '../Game/Game';

/**
 * A game being put together, which does not exist anywhere yet.
 *
 * Nothing is written until the whole thing is: an organiser fills in the times, the teams and the
 * board, and one save commits the lot. That is what makes "players cannot join an unfinished game"
 * true by construction rather than by a rule the server has to keep enforcing.
 */
export interface Draft {
  name: string;
  mode: GameMode;
  winCondition: string;
  joinCode: string;
  startsAt: number;
  /** Null once the end has been pinned to a time; otherwise how long after the start it falls. */
  endOffsetMs: number | null;
  endsAt: number;
  backfillPolicy: string;
  manualEntryAllowed: boolean;
  boardRows: number;
  boardCols: number;
  tiles: AdminTile[];
  teams: { name: string; colour: string }[];
}
