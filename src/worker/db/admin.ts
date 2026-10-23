// Admin writes, and the audit trail behind them.
//
// Every action an admin takes that changes a score is recorded twice: once as the change itself,
// and once in admin_actions saying who did it and why. A board that cannot explain how it got to
// its current state is a board nobody trusts at the end of an event.

import { newFlagId } from '../lib/ids';

export const recordAction = (
  db: D1Database,
  gameId: string | null,
  actor: string,
  action: string,
  detail: Record<string, unknown>,
  now: number,
): D1PreparedStatement =>
  db
    .prepare(
      `INSERT INTO admin_actions (id, game_id, actor, action, detail_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(newFlagId(), gameId, actor, action, JSON.stringify(detail), now);

/**
 * Writes an admin adjustment into the event log.
 *
 * This is the mechanism §7's manual adjustment and the flag queue's credit/discredit both run
 * through, and it is deliberately an events row rather than a number poked into a score: a replay
 * has to reach the same board afterwards, and it only can if the adjustment is part of the history
 * being replayed.
 *
 * The synthetic event id is random rather than derived — there is no observation to hash, and two
 * identical adjustments are two distinct decisions.
 */
export const insertAdjustment = async (
  db: D1Database,
  input: {
    gameId: string;
    playerId: string;
    metricId: string;
    delta: number;
    reason: string;
    actor: string;
  },
  now: number,
): Promise<string> => {
  const eventId = `manual${crypto.randomUUID().replace(/-/g, '').slice(0, 26)}`;

  await db.batch([
    db
      .prepare(
        `INSERT INTO events (game_id, event_id, player_id, metric_id, metric_type, value, delta,
                             first_observation, detail_json, session_id, client_time, received_at,
                             game_tick, world, world_types)
         VALUES (?, ?, ?, ?, 'MANUAL', NULL, ?, 0, ?, NULL, NULL, ?, NULL, NULL, NULL)`,
      )
      .bind(
        input.gameId,
        eventId,
        input.playerId,
        input.metricId,
        input.delta,
        JSON.stringify({ reason: input.reason, actor: input.actor }),
        now,
      ),
    recordAction(
      db,
      input.gameId,
      input.actor,
      input.delta >= 0 ? 'CREDIT' : 'DISCREDIT',
      { eventId, playerId: input.playerId, metricId: input.metricId, delta: input.delta, reason: input.reason },
      now,
    ),
  ]);

  return eventId;
};

export interface FlagView {
  id: string;
  kind: string;
  detail: Record<string, unknown>;
  createdAt: number;
  eventId: string | null;
  hasScreenshot: boolean;
  /** What the event was worth, so an admin can see what crediting or discrediting would move. */
  credited: number | null;
  derivedDelta: number | null;
  metricId: string | null;
  resolution: string | null;
  resolvedBy: string | null;
  resolvedAt: number | null;
}

export interface PlayerFlags {
  playerId: string;
  playerName: string;
  teamId: string | null;
  flags: FlagView[];
}

/**
 * The review queue, grouped by player.
 *
 * Grouped because that is how they are judged: five flags against one player is a conversation,
 * and one flag each against five players is usually nothing at all.
 */
export const readFlagQueue = async (
  db: D1Database,
  gameId: string,
  includeResolved: boolean,
): Promise<PlayerFlags[]> => {
  const { results } = await db
    .prepare(
      `SELECT f.id, f.kind, f.detail_json, f.created_at, f.event_id,
              f.resolution, f.resolved_by, f.resolved_at,
              p.id AS player_id, p.display_name, p.team_id,
              e.metric_id AS metric_id,
              c.credited AS credited, c.derived_delta AS derived_delta,
              (s.event_id IS NOT NULL) AS has_screenshot
       FROM flags f
       JOIN players p ON p.id = f.player_id
       LEFT JOIN events e ON e.game_id = f.game_id AND e.event_id = f.event_id
       LEFT JOIN event_credit c ON c.game_id = f.game_id AND c.event_id = f.event_id
       LEFT JOIN event_screenshots s ON s.game_id = f.game_id AND s.event_id = f.event_id
       WHERE f.game_id = ? ${includeResolved ? '' : 'AND f.resolved_at IS NULL'}
       ORDER BY p.display_name, f.created_at DESC`,
    )
    .bind(gameId)
    .all<{
      id: string;
      kind: string;
      detail_json: string;
      created_at: number;
      event_id: string | null;
      resolution: string | null;
      resolved_by: string | null;
      resolved_at: number | null;
      player_id: string;
      display_name: string;
      team_id: string | null;
      metric_id: string | null;
      credited: number | null;
      derived_delta: number | null;
      has_screenshot: number;
    }>();

  const byPlayer = new Map<string, PlayerFlags>();

  for (const row of results) {
    const group = byPlayer.get(row.player_id) ?? {
      playerId: row.player_id,
      playerName: row.display_name,
      teamId: row.team_id,
      flags: [],
    };

    group.flags.push({
      id: row.id,
      kind: row.kind,
      detail: JSON.parse(row.detail_json) as Record<string, unknown>,
      createdAt: row.created_at,
      eventId: row.event_id,
      hasScreenshot: row.has_screenshot === 1,
      credited: row.credited,
      derivedDelta: row.derived_delta,
      metricId: row.metric_id,
      resolution: row.resolution,
      resolvedBy: row.resolved_by,
      resolvedAt: row.resolved_at,
    });

    byPlayer.set(row.player_id, group);
  }

  return [...byPlayer.values()];
};

export interface AdminPlayer {
  id: string;
  accountHash: string;
  displayName: string;
  teamId: string | null;
  removedAt: number | null;
  firstSyncedAt: number;
  lastSyncedAt: number;
  ready: boolean | null;
  checks: { id: string; satisfied: boolean }[];
  /** True when the board's metrics changed after this player last synced. */
  needsResync: boolean;
}

/**
 * The roster, with the readiness column.
 *
 * The single most valuable pre-event screen: it answers "who is actually set up" before kickoff
 * rather than after. Readiness is all-or-nothing in the plugin — one failed check stops every
 * metric — so a player showing `ready: false` is currently reporting nothing at all.
 */
export const readRosterAdmin = async (
  db: D1Database,
  gameId: string,
  metricsChangedAt: number | null,
): Promise<AdminPlayer[]> => {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.account_hash, p.display_name, p.team_id, p.removed_at,
              p.first_synced_at, p.last_synced_at,
              r.ready AS ready, r.checks_json AS checks_json
       FROM players p
       LEFT JOIN readiness r ON r.player_id = p.id
       WHERE p.game_id = ?
       ORDER BY p.display_name`,
    )
    .bind(gameId)
    .all<{
      id: string;
      account_hash: string;
      display_name: string;
      team_id: string | null;
      removed_at: number | null;
      first_synced_at: number;
      last_synced_at: number;
      ready: number | null;
      checks_json: string | null;
    }>();

  return results.map((row) => ({
    id: row.id,
    // Still a string here. It exceeds 2^53 and a trip through a JS number makes it another player.
    accountHash: row.account_hash,
    displayName: row.display_name,
    teamId: row.team_id,
    removedAt: row.removed_at,
    firstSyncedAt: row.first_synced_at,
    lastSyncedAt: row.last_synced_at,
    ready: row.ready === null ? null : row.ready === 1,
    checks:
      row.checks_json === null
        ? []
        : (JSON.parse(row.checks_json) as { id: string; satisfied: boolean }[]),
    needsResync: metricsChangedAt !== null && row.last_synced_at < metricsChangedAt,
  }));
};
