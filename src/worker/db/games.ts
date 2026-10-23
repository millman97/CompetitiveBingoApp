// Game reads.
//
// Rows come back with the raw column types D1 stores. Booleans are 0/1 integers and are converted
// once, here, so nothing downstream has to remember which is which.

import type { ServerGameState } from '../lib/game-state';

export type GameMode = 'CLASSIC' | 'CONTROL' | 'RUSH';
export type WinCondition = 'FIRST_LINE' | 'MOST_AT_DEADLINE' | 'HYBRID_SUDDEN_DEATH';
export type BackfillPolicy = 'COUNT' | 'IGNORE' | 'FLAG_ONLY';

export interface Game {
  id: string;
  name: string;
  joinCode: string;
  mode: GameMode;
  winCondition: WinCondition | null;
  state: ServerGameState;
  startsAt: number;
  endsAt: number;
  /**
   * How long after the start the game ends, when the end follows the start.
   *
   * Null means the deadline is pinned to a wall-clock time. Otherwise moving the start moves the
   * end with it, which is the only way to push a game back without it briefly ending before it
   * begins.
   */
  endOffsetMs: number | null;
  boardRows: number;
  boardCols: number;
  screenshotsRequested: boolean;
  backfillPolicy: BackfillPolicy;
  wonByTeamId: string | null;
  wonAt: number | null;
  /** When the tracked metric list last gained an entry. Drives the re-sync warning. */
  metricsChangedAt: number | null;
  /** Whether players may submit events by hand. */
  manualEntryAllowed: boolean;
}

interface GameRow {
  id: string;
  name: string;
  join_code: string;
  mode: GameMode;
  win_condition: WinCondition | null;
  state: ServerGameState;
  starts_at: number;
  ends_at: number;
  end_offset_ms: number | null;
  board_rows: number;
  board_cols: number;
  screenshots_requested: number;
  backfill_policy: BackfillPolicy;
  won_by_team_id: string | null;
  won_at: number | null;
  metrics_changed_at: number | null;
  manual_entry_allowed: number;
}

const SELECT = `SELECT id, name, join_code, mode, win_condition, state, starts_at, ends_at,
                       end_offset_ms, board_rows, board_cols, screenshots_requested, backfill_policy,
                       won_by_team_id, won_at, metrics_changed_at, manual_entry_allowed
                FROM games`;

const toGame = (row: GameRow): Game => ({
  id: row.id,
  name: row.name,
  joinCode: row.join_code,
  mode: row.mode,
  winCondition: row.win_condition,
  state: row.state,
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  endOffsetMs: row.end_offset_ms,
  boardRows: row.board_rows,
  boardCols: row.board_cols,
  screenshotsRequested: row.screenshots_requested === 1,
  backfillPolicy: row.backfill_policy,
  wonByTeamId: row.won_by_team_id,
  wonAt: row.won_at,
  metricsChangedAt: row.metrics_changed_at,
  manualEntryAllowed: row.manual_entry_allowed === 1,
});

/** Join codes are compared case-insensitively, because players type them by hand. */
export const findGameByJoinCode = async (db: D1Database, joinCode: string): Promise<Game | null> => {
  const row = await db
    .prepare(`${SELECT} WHERE join_code = ?`)
    .bind(joinCode.trim().toUpperCase())
    .first<GameRow>();
  return row === null ? null : toGame(row);
};

export const findGameById = async (db: D1Database, gameId: string): Promise<Game | null> => {
  const row = await db.prepare(`${SELECT} WHERE id = ?`).bind(gameId).first<GameRow>();
  return row === null ? null : toGame(row);
};

export interface TrackedMetric {
  metricId: string;
  label: string | null;
}

export const listTrackedMetrics = async (
  db: D1Database,
  gameId: string,
): Promise<TrackedMetric[]> => {
  const { results } = await db
    .prepare('SELECT metric_id, label FROM game_metrics WHERE game_id = ? ORDER BY metric_id')
    .bind(gameId)
    .all<{ metric_id: string; label: string | null }>();

  return results.map((row) => ({ metricId: row.metric_id, label: row.label }));
};

/**
 * Starts a game that has reached its advertised start time.
 *
 * Contract section 4.5 is emphatic: a server must never tell the plugin a game is UPCOMING with a
 * startsAt in the past. The plugin schedules exactly one sync at the time the server named and
 * does not retry on a timer, so a client that arrives to find the game still UPCOMING and overdue
 * stops and shows the player an error rather than waiting.
 *
 * Starting the game at the time the organiser set is the honest reading of that: they said when
 * it begins. Starting early is still a manual action.
 */
export const startIfDue = async (db: D1Database, game: Game, now: number): Promise<Game> => {
  if (game.state !== 'UPCOMING' || game.startsAt > now) {
    return game;
  }

  await db
    .prepare("UPDATE games SET state = 'LIVE' WHERE id = ? AND state = 'UPCOMING'")
    .bind(game.id)
    .run();

  return { ...game, state: 'LIVE' };
};

export interface DropValueRule {
  metricId: string;
  label: string | null;
  minValue: number | null;
  maxValue: number | null;
  valuation: 'GRAND_EXCHANGE' | 'HIGH_ALCHEMY' | null;
  counts: 'ITEMS' | 'VALUE' | null;
}

/**
 * Rules asking for a metric per band of coin value.
 *
 * "Any drop worth a million" cannot be a metric ID, because an ID comes from an item's name and
 * says nothing about what it is worth. Naming a rule is what asks the plugin for the metric, so
 * these IDs count as tracked whether or not they also appear in game_metrics.
 */
export const listDropValueRules = async (
  db: D1Database,
  gameId: string,
): Promise<DropValueRule[]> => {
  const { results } = await db
    .prepare(
      `SELECT metric_id, label, min_value, max_value, valuation, counts
       FROM drop_value_rules WHERE game_id = ? ORDER BY min_value, metric_id`,
    )
    .bind(gameId)
    .all<{
      metric_id: string;
      label: string | null;
      min_value: number | null;
      max_value: number | null;
      valuation: 'GRAND_EXCHANGE' | 'HIGH_ALCHEMY' | null;
      counts: 'ITEMS' | 'VALUE' | null;
    }>();

  return results.map((row) => ({
    metricId: row.metric_id,
    label: row.label,
    minValue: row.min_value,
    maxValue: row.max_value,
    valuation: row.valuation,
    counts: row.counts,
  }));
};
