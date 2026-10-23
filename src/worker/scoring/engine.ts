// The scoring engine: crediting one observation, and recomputing tiles from what has been
// credited.
//
// The important property here is that ingestion and replay go through the same two functions.
// Crediting is order-dependent, because a COUNT is differenced against the last value seen, so a
// replay has to walk events in received_at order. Tile progress is not order-dependent at all —
// it is a pure aggregate over what was credited — so it can be recomputed at any time from the
// event log without knowing how it got there.

import type { Game } from '../db/games';
import { raiseFlag } from '../db/flags';
import type { Tile } from '../db/tiles';
import {
  DEFAULT_THRESHOLDS,
  derive,
  type DerivedFlag,
  type MetricState,
  type Thresholds,
} from './derive';
import type { Observation } from './observation';
import { evaluate, type TileContribution } from './tiles';
import { isValueAggregate } from './value-tiles';

export interface ScoringContext {
  db: D1Database;
  game: Game;
  tiles: Tile[];
  /** Per-metric overrides. Anything absent uses the shipped defaults. */
  thresholds: Map<string, Partial<Thresholds>>;
}

export const loadThresholds = async (
  db: D1Database,
  gameId: string,
): Promise<Map<string, Partial<Thresholds>>> => {
  const { results } = await db
    .prepare('SELECT metric_id, max_per_minute, min_duration_ms FROM metric_thresholds WHERE game_id = ?')
    .bind(gameId)
    .all<{ metric_id: string; max_per_minute: number | null; min_duration_ms: number | null }>();

  const map = new Map<string, Partial<Thresholds>>();
  for (const row of results) {
    const entry: Partial<Thresholds> = {};
    if (row.max_per_minute !== null) {
      entry.maxPerMinute = row.max_per_minute;
    }
    if (row.min_duration_ms !== null) {
      entry.minDurationMs = row.min_duration_ms;
    }
    map.set(row.metric_id, entry);
  }
  return map;
};

const thresholdsFor = (ctx: ScoringContext, metricId: string): Thresholds => ({
  ...DEFAULT_THRESHOLDS,
  ...ctx.thresholds.get(metricId),
});

const loadMetricState = async (
  db: D1Database,
  gameId: string,
  playerId: string,
  metricId: string,
): Promise<MetricState | null> => {
  const row = await db
    .prepare(
      `SELECT last_value, last_seen_at FROM metric_state
       WHERE game_id = ? AND player_id = ? AND metric_id = ?`,
    )
    .bind(gameId, playerId, metricId)
    .first<{ last_value: number | null; last_seen_at: number }>();

  return row === null ? null : { lastValue: row.last_value, lastSeenAt: row.last_seen_at };
};

export interface CreditResult {
  credited: number;
  derivedDelta: number | null;
  flags: DerivedFlag[];
}

/**
 * Works out what one event is worth and records it.
 *
 * Flags are returned rather than written when `persistFlags` is false, which is how a replay
 * recomputes every score without disturbing an admin's flag resolutions — a replay is recomputing
 * scores, not re-observing facts.
 */
export const creditEvent = async (
  ctx: ScoringContext,
  playerId: string,
  eventId: string,
  observation: Observation,
  options: { persistFlags: boolean },
): Promise<CreditResult> => {
  const state = await loadMetricState(ctx.db, ctx.game.id, playerId, observation.metricId);

  const derivation = derive({
    observation,
    state,
    backfillPolicy: ctx.game.backfillPolicy,
    thresholds: thresholdsFor(ctx, observation.metricId),
  });

  const statements: D1PreparedStatement[] = [
    ctx.db
      .prepare(
        `INSERT INTO event_credit (game_id, event_id, credited, derived_delta)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(game_id, event_id) DO UPDATE SET
           credited = excluded.credited,
           derived_delta = excluded.derived_delta`,
      )
      .bind(ctx.game.id, eventId, derivation.credited, derivation.derivedDelta),
  ];

  if (derivation.nextState !== null) {
    statements.push(
      ctx.db
        .prepare(
          `INSERT INTO metric_state (game_id, player_id, metric_id, last_value, last_seen_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(game_id, player_id, metric_id) DO UPDATE SET
             last_value = excluded.last_value,
             last_seen_at = excluded.last_seen_at`,
        )
        .bind(
          ctx.game.id,
          playerId,
          observation.metricId,
          derivation.nextState.lastValue,
          derivation.nextState.lastSeenAt,
        ),
    );
  }

  if (options.persistFlags) {
    for (const flag of derivation.flags) {
      statements.push(
        raiseFlag(
          ctx.db,
          {
            gameId: ctx.game.id,
            eventId,
            playerId,
            kind: flag.kind,
            detail: flag.detail,
          },
          observation.receivedAt,
        ),
      );
    }
  }

  await ctx.db.batch(statements);

  return {
    credited: derivation.credited,
    derivedDelta: derivation.derivedDelta,
    flags: derivation.flags,
  };
};

/**
 * Builds the SQL predicate matching a tile's metrics.
 *
 * The two permitted wildcards are already valid SQLite GLOB patterns — `collection_log.*` means
 * exactly what it looks like — so they need no translation.
 */
const metricPredicate = (metrics: string[]): { sql: string; binds: string[] } => {
  const exact = metrics.filter((metric) => !metric.endsWith('.*'));
  const globs = metrics.filter((metric) => metric.endsWith('.*'));

  const clauses: string[] = [];
  const binds: string[] = [];

  if (exact.length > 0) {
    clauses.push(`e.metric_id IN (${exact.map(() => '?').join(', ')})`);
    binds.push(...exact);
  }
  for (const glob of globs) {
    clauses.push('e.metric_id GLOB ?');
    binds.push(glob);
  }

  return { sql: `(${clauses.join(' OR ')})`, binds };
};

/**
 * Aggregates one team's contribution to one tile straight out of the event log.
 *
 * Team membership is read from players.team_id rather than stored per event, which is what makes
 * an admin's team assignment retroactive for free: assigning somebody re-attributes their whole
 * history by definition, with no rows rewritten.
 */
const contributionFor = async (
  ctx: ScoringContext,
  tile: Tile,
  teamId: string,
): Promise<TileContribution> => {
  const { sql, binds } = metricPredicate(tile.requirement.metrics);

  if (tile.requirement.aggregate === 'MIN_DURATION') {
    // Ties break on who got there first, so receipt time is the second sort key.
    const best = await ctx.db
      .prepare(
        `SELECT e.value AS ms, e.received_at AS at
         FROM events e
         JOIN players p ON p.id = e.player_id
         WHERE e.game_id = ? AND p.team_id = ? AND e.metric_type = 'DURATION' AND ${sql}
         ORDER BY e.value ASC, e.received_at ASC
         LIMIT 1`,
      )
      .bind(ctx.game.id, teamId, ...binds)
      .first<{ ms: number; at: number }>();

    return {
      totalCredited: 0,
      distinctMetrics: 0,
      bestDurationMs: best?.ms ?? null,
      bestAt: best?.at ?? null,
    };
  }

  const row = await ctx.db
    .prepare(
      `SELECT COALESCE(SUM(c.credited), 0) AS total,
              COUNT(DISTINCT CASE WHEN c.credited > 0 THEN e.metric_id END) AS distinct_metrics,
              MAX(CASE WHEN e.metric_type = 'DROP' THEN c.credited END) AS max_value,
              COUNT(CASE WHEN e.metric_type = 'DROP' AND c.credited > 0 THEN 1 END) AS drop_count,
              COALESCE(SUM(CASE WHEN e.metric_type = 'MANUAL' THEN c.credited ELSE 0 END), 0) AS adjustments
       FROM event_credit c
       JOIN events e ON e.game_id = c.game_id AND e.event_id = c.event_id
       JOIN players p ON p.id = e.player_id
       WHERE c.game_id = ? AND p.team_id = ? AND ${sql}`,
    )
    .bind(ctx.game.id, teamId, ...binds)
    .first<{ total: number; distinct_metrics: number; max_value: number | null; drop_count: number; adjustments: number }>();

  return {
    totalCredited: row?.total ?? 0,
    distinctMetrics: row?.distinct_metrics ?? 0,
    bestDurationMs: null,
    bestAt: null,
    maxValue: row?.max_value ?? 0,
    dropCount: row?.drop_count ?? 0,
    adjustments: row?.adjustments ?? 0,
  };
};

/**
 * When a team's contribution first satisfied a tile, or null if it has not.
 *
 * Only asked for in RUSH, where the whole mode turns on who got there first. It is deliberately
 * derived from the event log rather than stamped when a tile happens to complete during ingestion:
 * a replay rebuilds tile progress from nothing, and a claim it could not reproduce would be a
 * claim that changed every time an organiser pressed Replay.
 */
const completionTimeFor = async (
  ctx: ScoringContext,
  tile: Tile,
  teamId: string,
): Promise<number | null> => {
  const { sql, binds } = metricPredicate(tile.requirement.metrics);
  const { aggregate, target } = tile.requirement;

  if (isValueAggregate(aggregate)) {
    const window = 'OVER (ORDER BY e.received_at ASC, e.rowid ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)';
    const running = aggregate === 'MAX_VALUE'
      ? `MAX(CASE WHEN e.metric_type = 'DROP' THEN c.credited ELSE 0 END) ${window}`
      : `SUM(CASE WHEN e.metric_type = 'DROP' AND c.credited > 0 THEN 1 ELSE 0 END) ${window}`;
    const row = await ctx.db.prepare(`SELECT MIN(at) AS at FROM (
      SELECT e.received_at AS at, ${running} + SUM(CASE WHEN e.metric_type = 'MANUAL' THEN c.credited ELSE 0 END) ${window} AS running
      FROM event_credit c JOIN events e ON e.game_id = c.game_id AND e.event_id = c.event_id JOIN players p ON p.id = e.player_id
      WHERE c.game_id = ? AND p.team_id = ? AND ${sql}
    ) WHERE running >= ?`).bind(ctx.game.id, teamId, ...binds, aggregate === 'MAX_VALUE' ? 1 : target).first<{ at: number | null }>();
    return row?.at ?? null;
  }

  if (aggregate === 'MIN_DURATION') {
    // Any completed run satisfies a fastest-time tile, so the claim goes to the first team to
    // post a time at all rather than to the fastest. In RUSH that is the point: the tile is a
    // race to finish the thing, and being beaten on time afterwards does not take it back.
    const row = await ctx.db
      .prepare(
        `SELECT MIN(e.received_at) AS at
         FROM events e
         JOIN players p ON p.id = e.player_id
         WHERE e.game_id = ? AND p.team_id = ? AND e.metric_type = 'DURATION' AND ${sql}`,
      )
      .bind(ctx.game.id, teamId, ...binds)
      .first<{ at: number | null }>();

    return row?.at ?? null;
  }

  if (target === null) {
    return null;
  }

  if (aggregate === 'UNIQUE') {
    // The moment the target-th distinct metric first credited anything.
    const row = await ctx.db
      .prepare(
        `SELECT at FROM (
           SELECT MIN(e.received_at) AS at
           FROM event_credit c
           JOIN events e ON e.game_id = c.game_id AND e.event_id = c.event_id
           JOIN players p ON p.id = e.player_id
           WHERE c.game_id = ? AND p.team_id = ? AND c.credited > 0 AND ${sql}
           GROUP BY e.metric_id
         )
         ORDER BY at ASC
         LIMIT 1 OFFSET ?`,
      )
      .bind(ctx.game.id, teamId, ...binds, target - 1)
      .first<{ at: number }>();

    return row?.at ?? null;
  }

  // SUM: the receipt time of the event that carried the running total up to the target. The
  // ordering matches replay's, rowid included, because a whole batch shares one receipt time.
  const row = await ctx.db
    .prepare(
      `SELECT MIN(at) AS at FROM (
         SELECT e.received_at AS at,
                SUM(c.credited) OVER (
                  ORDER BY e.received_at ASC, e.rowid ASC
                  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                ) AS running
         FROM event_credit c
         JOIN events e ON e.game_id = c.game_id AND e.event_id = c.event_id
         JOIN players p ON p.id = e.player_id
         WHERE c.game_id = ? AND p.team_id = ? AND ${sql}
       )
       WHERE running >= ?`,
    )
    .bind(ctx.game.id, teamId, ...binds, target)
    .first<{ at: number | null }>();

  return row?.at ?? null;
};

/**
 * Recomputes one tile for one team and stores the result.
 *
 * A team with nothing on a tile has no row, rather than a row of zeroes. Absence means zero, and
 * making that the single rule is what lets an incremental update during ingestion and a
 * from-scratch replay agree exactly: ingestion only ever touches the tiles an event affects, so
 * if replay wrote a zero row for every tile and team the two would differ on rows that mean
 * nothing. The read path fills the grid by joining tiles against teams.
 */
export const recomputeTile = async (
  ctx: ScoringContext,
  tile: Tile,
  teamId: string,
): Promise<void> => {
  const contribution = await contributionFor(ctx, tile, teamId);
  const outcome = evaluate(tile.requirement, contribution);

  const nothingToRecord =
    outcome.score === 0 && !outcome.complete && outcome.bestDurationMs === null;

  if (nothingToRecord) {
    await ctx.db
      .prepare('DELETE FROM tile_progress WHERE game_id = ? AND tile_id = ? AND team_id = ?')
      .bind(ctx.game.id, tile.id, teamId)
      .run();
    return;
  }

  // Only RUSH asks who got there first, and it costs a query, so only RUSH pays for one.
  const completedAt =
    ctx.game.mode === 'RUSH' && outcome.complete
      ? await completionTimeFor(ctx, tile, teamId)
      : null;

  await ctx.db
    .prepare(
      `INSERT INTO tile_progress (game_id, tile_id, team_id, score, best_duration_ms, best_at,
                                  complete, completed_at, owner_since)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(game_id, tile_id, team_id) DO UPDATE SET
         score = excluded.score,
         best_duration_ms = excluded.best_duration_ms,
         best_at = excluded.best_at,
         complete = excluded.complete,
         completed_at = excluded.completed_at`,
    )
    .bind(
      ctx.game.id,
      tile.id,
      teamId,
      outcome.score,
      outcome.bestDurationMs,
      outcome.bestAt,
      outcome.complete ? 1 : 0,
      completedAt,
    )
    .run();
};

/** Whether a tile's requirement covers a metric, wildcards included. */
export const tileTracks = (tile: Tile, metricId: string): boolean =>
  tile.requirement.metrics.some((metric) =>
    metric.endsWith('.*') ? metricId.startsWith(metric.slice(0, -1)) : metric === metricId,
  );

/** Recomputes only the tiles a metric can affect, for one team. */
export const recomputeAffected = async (
  ctx: ScoringContext,
  metricId: string,
  teamId: string,
): Promise<void> => {
  for (const tile of ctx.tiles.filter((candidate) => tileTracks(candidate, metricId))) {
    await recomputeTile(ctx, tile, teamId);
  }
};

/** Recomputes the whole board for every team. */
export const recomputeBoard = async (ctx: ScoringContext, teamIds: string[]): Promise<void> => {
  for (const teamId of teamIds) {
    for (const tile of ctx.tiles) {
      await recomputeTile(ctx, tile, teamId);
    }
  }
};
