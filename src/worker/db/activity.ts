// The activity feed.
//
// One line per scoring event: who, what, which tile, when. Deliberately not the raw event stream —
// a player does not want to read envelopes, they want to see that Ted just got a whip and which
// tile it moved.
//
// It is fetched over HTTP and paginated rather than pushed down the socket. A board changes a
// handful of times an hour; a feed is append-only and unbounded, and the two want very different
// delivery.

import type { Tile } from './tiles';
import { tileTracks } from '../scoring/engine';
import { isValueAggregate, valueScoreSql } from '../scoring/value-tiles';
import { evaluate } from '../scoring/tiles';

export interface ActivityEntry {
  eventId: string;
  at: number;
  playerName: string;
  teamId: string | null;
  metricId: string;
  metricType: string;
  /** What this event added to its team's total, after the backfill policy. */
  credited: number;
  /** The full increment implied before the policy trimmed it, when they differ. */
  derivedDelta: number | null;
  /** A short human phrase for the thing that happened, built from the type-specific detail. */
  what: string;
  /** Every tile this event moved. Usually one, occasionally none. */
  tiles: { tileId: string; label: string }[];
  hasScreenshot: boolean;
}

export interface ActivityPage {
  entries: ActivityEntry[];
  /** Pass back as `before` to get the next page. Null when the feed is exhausted. */
  cursor: string | null;
}

interface ActivityRow {
  event_id: string;
  received_at: number;
  rowid: number;
  display_name: string;
  team_id: string | null;
  metric_id: string;
  metric_type: string;
  detail_json: string;
  credited: number | null;
  derived_delta: number | null;
  has_screenshot: number;
}

/**
 * Turns the type-specific detail into something readable.
 *
 * The shapes are the contract's, selected by metric type — there is no discriminator inside the
 * detail object itself, which is why this switches on the type rather than sniffing fields.
 */
const describe = (metricType: string, detailJson: string): string => {
  let detail: Record<string, unknown>;
  try {
    detail = JSON.parse(detailJson) as Record<string, unknown>;
  } catch {
    return 'an unreadable event';
  }

  switch (metricType) {
    case 'COUNT':
      return `${String(detail['activity'] ?? 'something')} kill`;

    case 'KILL':
      return `${String(detail['npcName'] ?? 'a monster')} kill`;

    case 'DROP': {
      const quantity = Number(detail['quantity'] ?? 1);
      const name = String(detail['itemName'] ?? 'an item');
      return quantity > 1 ? `${name} x${quantity}` : name;
    }

    case 'DURATION': {
      const ms = Number(detail['durationMs'] ?? 0);
      const minutes = Math.floor(ms / 60_000);
      const seconds = Math.floor((ms % 60_000) / 1000);
      const best = detail['isPersonalBest'] === true ? ' (personal best)' : '';
      return `${String(detail['activity'] ?? 'a run')} in ${minutes}:${String(seconds).padStart(2, '0')}${best}`;
    }

    case 'COLLECTION_LOG':
      return `${String(detail['itemName'] ?? 'a log slot')} (collection log)`;

    case 'MANUAL':
      return String(detail['reason'] ?? 'an admin adjustment');

    default:
      return metricType.toLowerCase();
  }
};

/**
 * Builds the SQL predicate matching every metric the board actually scores.
 *
 * Filtering in SQL rather than after the fact is what keeps pagination honest: fetching fifty rows
 * and discarding thirty would give short pages and a cursor that skips.
 */
const boardMetricPredicate = (tiles: readonly Tile[]): { sql: string; binds: string[] } => {
  const metrics = new Set(tiles.flatMap((tile) => tile.requirement.metrics));

  const exact = [...metrics].filter((metric) => !metric.endsWith('.*'));
  const globs = [...metrics].filter((metric) => metric.endsWith('.*'));

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

const parseCursor = (cursor: string | null): { at: number; rowid: number } | null => {
  if (cursor === null) {
    return null;
  }
  const [at, rowid] = cursor.split(':').map(Number);
  if (!Number.isFinite(at) || !Number.isFinite(rowid)) {
    return null;
  }
  return { at: at as number, rowid: rowid as number };
};

/**
 * Reads a page of the feed, newest first.
 *
 * Ordering is receipt time then rowid, the same pair replay uses, because a batch of events all
 * share one receipt time and the feed would otherwise shuffle them on every read.
 */
export const readActivity = async (
  db: D1Database,
  gameId: string,
  tiles: readonly Tile[],
  options: { limit?: number; before?: string | null } = {},
): Promise<ActivityPage> => {
  if (tiles.length === 0) {
    return { entries: [], cursor: null };
  }

  const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
  const { sql, binds } = boardMetricPredicate(tiles);
  const cursor = parseCursor(options.before ?? null);

  const paging = cursor === null
    ? ''
    : 'AND (e.received_at < ? OR (e.received_at = ? AND e.rowid < ?))';
  const pagingBinds = cursor === null ? [] : [cursor.at, cursor.at, cursor.rowid];

  const { results } = await db
    .prepare(
      `SELECT e.event_id, e.received_at, e.rowid AS rowid, p.display_name, p.team_id,
              e.metric_id, e.metric_type, e.detail_json,
              c.credited AS credited, c.derived_delta AS derived_delta,
              (s.event_id IS NOT NULL) AS has_screenshot
       FROM events e
       JOIN players p ON p.id = e.player_id
       LEFT JOIN event_credit c ON c.game_id = e.game_id AND c.event_id = e.event_id
       LEFT JOIN event_screenshots s ON s.game_id = e.game_id AND s.event_id = e.event_id
       WHERE e.game_id = ? AND ${sql} ${paging}
       ORDER BY e.received_at DESC, e.rowid DESC
       LIMIT ?`,
    )
    .bind(gameId, ...binds, ...pagingBinds, limit + 1)
    .all<ActivityRow>();

  // One extra row is fetched purely to learn whether another page exists.
  const page = results.slice(0, limit);
  const more = results.length > limit;
  const last = page[page.length - 1];

  return {
    entries: page.map((row) => ({
      eventId: row.event_id,
      at: row.received_at,
      playerName: row.display_name,
      teamId: row.team_id,
      metricId: row.metric_id,
      metricType: row.metric_type,
      credited: row.credited ?? 0,
      derivedDelta: row.derived_delta,
      what: describe(row.metric_type, row.detail_json),
      tiles: tiles
        .filter((tile) => tileTracks(tile, row.metric_id))
        .map((tile) => ({ tileId: tile.id, label: tile.label })),
      hasScreenshot: row.has_screenshot === 1,
    })),
    cursor: more && last !== undefined ? `${last.received_at}:${last.rowid}` : null,
  };
};

export interface TileContributor {
  playerName: string;
  teamId: string | null;
  credited: number;
  events: number;
  bestDurationMs: number | null;
}

export interface TileDetail {
  tileId: string;
  label: string;
  contributors: TileContributor[];
  evidence: { eventId: string; playerName: string; at: number }[];
}

/**
 * Who has done what on one tile.
 *
 * This is what a disputed tile gets judged on, so it names players rather than teams and links
 * every image held for it.
 */
export const readTileDetail = async (
  db: D1Database,
  gameId: string,
  tile: Tile,
): Promise<TileDetail> => {
  const { sql, binds } = boardMetricPredicate([tile]);
  const creditedSql = isValueAggregate(tile.requirement.aggregate) ? valueScoreSql(tile.requirement.aggregate) : 'COALESCE(SUM(c.credited), 0)';

  const contributors = await db
    .prepare(
      `SELECT p.display_name, p.team_id,
              ${creditedSql} AS credited,
              COUNT(*) AS events,
              MIN(CASE WHEN e.metric_type = 'DURATION' THEN e.value END) AS best_duration_ms
       FROM events e
       JOIN players p ON p.id = e.player_id
       LEFT JOIN event_credit c ON c.game_id = e.game_id AND c.event_id = e.event_id
       WHERE e.game_id = ? AND ${sql}
       GROUP BY p.id
       ORDER BY credited DESC, p.display_name`,
    )
    .bind(gameId, ...binds)
    .all<{
      display_name: string;
      team_id: string | null;
      credited: number;
      events: number;
      best_duration_ms: number | null;
    }>();

  const evidence = await db
    .prepare(
      `SELECT s.event_id, p.display_name, e.received_at
       FROM event_screenshots s
       JOIN events e ON e.game_id = s.game_id AND e.event_id = s.event_id
       JOIN players p ON p.id = e.player_id
       WHERE s.game_id = ? AND ${sql}
       ORDER BY e.received_at DESC
       LIMIT 40`,
    )
    .bind(gameId, ...binds)
    .all<{ event_id: string; display_name: string; received_at: number }>();

  return {
    tileId: tile.id,
    label: tile.label,
    contributors: contributors.results.map((row) => ({
      playerName: row.display_name,
      teamId: row.team_id,
      credited: row.credited,
      events: row.events,
      bestDurationMs: row.best_duration_ms,
    })),
    evidence: evidence.results.map((row) => ({
      eventId: row.event_id,
      playerName: row.display_name,
      at: row.received_at,
    })),
  };
};

export interface RosterMember {
  playerName: string;
  /** Total credited across every tile on the board. */
  credited: number;
  /** What they have contributed, per tile, for the team panel's breakdown. */
  perTile: Record<string, number>;
  ready: boolean | null;
}

export interface TeamRoster {
  /** Null groups players who have joined but have not been assigned to a team. */
  teamId: string | null;
  members: RosterMember[];
}

/**
 * Who is on each team and what they have put on the board.
 *
 * Read separately from the board rather than pushed down the socket: it changes on every event but
 * matters far less urgently than a tile flipping, and keeping it out of the broadcast keeps the
 * patch payload to the things the spec says to broadcast.
 *
 * Players with no team are included in a null team group so the public board can show everyone
 * waiting for allocation before kickoff. Removed players remain excluded.
 */
export const readRoster = async (
  db: D1Database,
  gameId: string,
  tiles: readonly Tile[],
): Promise<TeamRoster[]> => {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.display_name, p.team_id, r.ready AS ready,
              e.metric_id AS metric_id, COALESCE(SUM(c.credited), 0) AS credited,
              MAX(CASE WHEN e.metric_type = 'DROP' THEN c.credited END) AS max_value,
              COUNT(CASE WHEN e.metric_type = 'DROP' AND c.credited > 0 THEN 1 END) AS drop_count,
              COALESCE(SUM(CASE WHEN e.metric_type = 'MANUAL' THEN c.credited ELSE 0 END), 0) AS adjustments
       FROM players p
       LEFT JOIN readiness r ON r.player_id = p.id
       LEFT JOIN events e ON e.player_id = p.id AND e.game_id = p.game_id
       LEFT JOIN event_credit c ON c.game_id = e.game_id AND c.event_id = e.event_id
       WHERE p.game_id = ? AND p.removed_at IS NULL
       GROUP BY p.id, e.metric_id
       ORDER BY p.display_name`,
    )
    .bind(gameId)
    .all<{
      id: string;
      display_name: string;
      team_id: string | null;
      ready: number | null;
      metric_id: string | null;
      credited: number;
      max_value: number | null;
      drop_count: number;
      adjustments: number;
    }>();

  const byTeam = new Map<string | null, Map<string, RosterMember>>();

  for (const row of results) {
    const team = byTeam.get(row.team_id) ?? new Map<string, RosterMember>();
    const member = team.get(row.id) ?? {
      playerName: row.display_name,
      credited: 0,
      perTile: {},
      ready: row.ready === null ? null : row.ready === 1,
    };

    // A player with no events at all still belongs on the panel, just with nothing next to them.
    if (row.metric_id !== null) {
      for (const tile of tiles.filter((candidate) => tileTracks(candidate, row.metric_id as string))) {
        const credited = isValueAggregate(tile.requirement.aggregate) ? evaluate(tile.requirement, { totalCredited: row.credited, distinctMetrics: 0, bestDurationMs: null, bestAt: null, maxValue: row.max_value ?? 0, dropCount: row.drop_count, adjustments: row.adjustments }).score : row.credited;
        member.perTile[tile.id] = (member.perTile[tile.id] ?? 0) + credited;
        member.credited += credited;
      }
    }

    team.set(row.id, member);
    byTeam.set(row.team_id, team);
  }

  return [...byTeam.entries()].map(([teamId, members]) => ({
    teamId,
    members: [...members.values()].sort(
      (a, b) => b.credited - a.credited || a.playerName.localeCompare(b.playerName),
    ),
  }));
};
