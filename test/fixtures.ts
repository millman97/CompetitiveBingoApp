// Seeds games directly into D1.
//
// Games are created here rather than through an admin API because the admin surface is a later
// build step. Everything below writes the same rows the admin panel eventually will.

import type { ServerGameState } from '../src/worker/lib/game-state';
import type { BackfillPolicy, GameMode, WinCondition } from '../src/worker/db/games';

export interface SeedGameOptions {
  id?: string;
  name?: string;
  joinCode?: string;
  mode?: GameMode;
  winCondition?: WinCondition | null;
  state?: ServerGameState;
  startsAt?: number;
  endsAt?: number;
  screenshotsRequested?: boolean;
  backfillPolicy?: BackfillPolicy;
  trackedMetrics?: string[];
  metricLabels?: Record<string, string>;
  teams?: { id: string; name: string; colour: string }[];
}

export interface SeededGame {
  id: string;
  joinCode: string;
  startsAt: number;
  endsAt: number;
  teams: { id: string; name: string; colour: string }[];
}

const HOUR = 60 * 60 * 1000;

/**
 * Join codes are UNIQUE in the schema, so a seeded one has to be unique too.
 *
 * Four hex characters is 65,536 codes, and a test file seeds enough games for two to collide
 * often enough to be noticed — as a constraint failure in whichever test drew second, which looks
 * like that test being flaky rather than like the fixture being wrong. A counter cannot collide.
 */
let seeded = 0;

export const seedGame = async (
  db: D1Database,
  options: SeedGameOptions = {},
): Promise<SeededGame> => {
  const now = Date.now();
  const id = options.id ?? `g_${crypto.randomUUID().slice(0, 6)}`;
  const joinCode = options.joinCode ?? `TEST-${(seeded += 1)}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
  const startsAt = options.startsAt ?? now - HOUR;
  const endsAt = options.endsAt ?? now + HOUR;
  const teams = options.teams ?? [
    { id: `t_${id}_a`, name: 'The Sharks', colour: '#3b82f6' },
    { id: `t_${id}_b`, name: 'The Manta Rays', colour: '#ef4444' },
  ];
  const tracked = options.trackedMetrics ?? [
    'kc.vorkath',
    'time.chambers_of_xeric',
    'drop.*',
    'collection_log.*',
  ];

  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO games (id, name, join_code, mode, win_condition, state, starts_at, ends_at,
                            board_rows, board_cols, screenshots_requested, backfill_policy,
                            won_by_team_id, won_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 5, 5, ?, ?, NULL, NULL, ?)`,
      )
      .bind(
        id,
        options.name ?? 'Clan Bingo #4',
        joinCode.toUpperCase(),
        options.mode ?? 'CLASSIC',
        options.winCondition ?? null,
        options.state ?? 'LIVE',
        startsAt,
        endsAt,
        (options.screenshotsRequested ?? true) ? 1 : 0,
        options.backfillPolicy ?? 'COUNT',
        now,
      ),
  ];

  for (const metricId of tracked) {
    statements.push(
      db
        .prepare('INSERT INTO game_metrics (game_id, metric_id, label) VALUES (?, ?, ?)')
        .bind(id, metricId, options.metricLabels?.[metricId] ?? null),
    );
  }

  for (const team of teams) {
    statements.push(
      db
        .prepare('INSERT INTO teams (id, game_id, name, colour) VALUES (?, ?, ?, ?)')
        .bind(team.id, id, team.name, team.colour),
    );
  }

  await db.batch(statements);

  return { id, joinCode: joinCode.toUpperCase(), startsAt, endsAt, teams };
};

/** Puts an already-synced player on a team, as an admin does from the roster. */
export const assignTeam = async (
  db: D1Database,
  gameId: string,
  accountHash: string,
  teamId: string,
): Promise<void> => {
  await db
    .prepare('UPDATE players SET team_id = ? WHERE game_id = ? AND account_hash = ?')
    .bind(teamId, gameId, accountHash)
    .run();
};

/** Removes a player from a game, which is the only thing that produces a 403. */
export const removePlayer = async (
  db: D1Database,
  gameId: string,
  accountHash: string,
): Promise<void> => {
  await db
    .prepare('UPDATE players SET removed_at = ? WHERE game_id = ? AND account_hash = ?')
    .bind(Date.now(), gameId, accountHash)
    .run();
};

export interface SeedTile {
  row: number;
  col: number;
  label?: string;
  metrics: string[];
  aggregate: 'SUM' | 'UNIQUE' | 'MIN_DURATION';
  target: number | null;
}

/** Lays out a board. Tile ids are derived from position so tests can refer to them. */
export const seedTiles = async (
  db: D1Database,
  gameId: string,
  tiles: SeedTile[],
): Promise<string[]> => {
  const ids: string[] = [];

  await db.batch(
    tiles.map((tile) => {
      const id = `tile_${gameId}_${tile.row}_${tile.col}`;
      ids.push(id);

      return db
        .prepare(
          `INSERT INTO tiles (id, game_id, row_index, col_index, label, requirement_json, target)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          gameId,
          tile.row,
          tile.col,
          tile.label ?? `${tile.aggregate} ${tile.metrics.join(', ')}`,
          JSON.stringify({
            metrics: tile.metrics,
            aggregate: tile.aggregate,
            target: tile.target,
          }),
          tile.target,
        );
    }),
  );

  return ids;
};

/** Reads a team's progress on one tile. */
export const tileProgress = async (
  db: D1Database,
  gameId: string,
  tileId: string,
  teamId: string,
): Promise<{ score: number; complete: boolean; bestDurationMs: number | null } | null> => {
  const row = await db
    .prepare(
      `SELECT score, complete, best_duration_ms FROM tile_progress
       WHERE game_id = ? AND tile_id = ? AND team_id = ?`,
    )
    .bind(gameId, tileId, teamId)
    .first<{ score: number; complete: number; best_duration_ms: number | null }>();

  return row === null
    ? null
    : { score: row.score, complete: row.complete === 1, bestDurationMs: row.best_duration_ms };
};

/** Everything the server derived for a game, for comparing before and after a replay. */
export const derivedSnapshot = async (
  db: D1Database,
  gameId: string,
): Promise<Record<string, unknown[]>> => {
  const credit = await db
    .prepare('SELECT event_id, credited, derived_delta FROM event_credit WHERE game_id = ? ORDER BY event_id')
    .bind(gameId)
    .all();
  const state = await db
    .prepare(
      `SELECT player_id, metric_id, last_value FROM metric_state
       WHERE game_id = ? ORDER BY player_id, metric_id`,
    )
    .bind(gameId)
    .all();
  const progress = await db
    .prepare(
      `SELECT tile_id, team_id, score, best_duration_ms, complete FROM tile_progress
       WHERE game_id = ? ORDER BY tile_id, team_id`,
    )
    .bind(gameId)
    .all();

  return {
    credit: credit.results,
    state: state.results,
    progress: progress.results,
  };
};
