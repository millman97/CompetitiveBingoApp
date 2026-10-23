export type {
  Aggregate,
  TileRequirement,
  DropValueSettings,
} from '../../../worker/scoring/tiles';
import type { TileRequirement } from '../../../worker/scoring/tiles';
export interface GameUpdate {
  joinCode?: string;
  startsAt?: number;
  endsAt?: number;
  durationMs?: number;
  backfillPolicy?: string;
  manualEntryAllowed?: boolean;
}

export type GameMode = 'CLASSIC' | 'CONTROL' | 'RUSH';

export interface AdminTile {
  id: string;
  row: number;
  col: number;
  label: string;
  requirement: TileRequirement;
}

export interface GameSummary {
  id: string;
  name: string;
  join_code: string;
  mode: GameMode;
  win_condition: string | null;
  state: string;
  starts_at: number;
  ends_at: number;
  end_offset_ms: number | null;
  board_rows: number;
  board_cols: number;
  won_by_team_id: string | null;
  players: number;
  tiles: number;
  teams: number;
  openFlags: number;
}

/** A gap an organiser has left in a game that already exists. Named by the server. */
export type SetupProblem =
  'BOARD_INCOMPLETE' | 'TOO_FEW_TEAMS' | 'WINDOW_PASSED';

export interface GameSetup {
  tiles: number;
  cells: number;
  teams: number;
  problems: SetupProblem[];
}

export interface GameDetail {
  game: {
    id: string;
    name: string;
    joinCode: string;
    mode: GameMode;
    winCondition: string | null;
    state: string;
    startsAt: number;
    endsAt: number;
    /** Null when the end is pinned to a time; otherwise how long after the start it falls. */
    endOffsetMs: number | null;
    boardRows: number;
    boardCols: number;
    screenshotsRequested: boolean;
    backfillPolicy: string;
    metricsChangedAt: number | null;
    manualEntryAllowed: boolean;
  };
  setup: GameSetup;
  teams: { id: string; name: string; colour: string }[];
  trackedMetrics: { metricId: string; label: string | null }[];
  dropValueRules: DropValueRule[];
  tiles: AdminTile[];
}

/** A metric asked for by band of coin value rather than by item name. */
export interface DropValueRule {
  metricId: string;
  label: string | null;
  minValue: number | null;
  maxValue: number | null;
  valuation: 'GRAND_EXCHANGE' | 'HIGH_ALCHEMY' | null;
  counts: 'ITEMS' | 'VALUE' | null;
}
