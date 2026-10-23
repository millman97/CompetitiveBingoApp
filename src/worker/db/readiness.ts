// Readiness reports — contract section 4.5.
//
// The point is the roster view: before a game starts, an organiser wants to see who is set up and
// who still has a chat filter switched on, rather than finding out afterwards that somebody
// reported nothing all week.
//
// Reporting is all-or-nothing in the plugin — one failed check stops every metric — so
// `ready: false` means this player is currently sending nothing at all.

/** The four check IDs from contract section 9.1. Safe to switch on. */
export type ReadinessCheckId =
  | 'KILL_COUNT_FILTER'
  | 'WORLD_TYPE'
  | 'COLLECTION_LOG_NOTIFICATION'
  | 'LOOT_TRACKER';

export interface ReadinessCheck {
  id: string;
  satisfied: boolean;
}

export interface ReadinessReport {
  ready: boolean;
  checks: ReadinessCheck[];
}

export const saveReadiness = async (
  db: D1Database,
  playerId: string,
  report: ReadinessReport,
  now: number,
): Promise<void> => {
  await db
    .prepare(
      `INSERT INTO readiness (player_id, ready, checks_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(player_id) DO UPDATE SET
         ready = excluded.ready,
         checks_json = excluded.checks_json,
         updated_at = excluded.updated_at`,
    )
    .bind(playerId, report.ready ? 1 : 0, JSON.stringify(report.checks), now)
    .run();
};

/**
 * The player's last reported readiness, or null if they have never reported one.
 *
 * Null is not the same as not ready. A player whose plugin has never sent a report is unknown,
 * and treating unknown as guilty would flag everyone who joined before the feature mattered.
 */
export const lastReadiness = async (
  db: D1Database,
  playerId: string,
): Promise<boolean | null> => {
  const row = await db
    .prepare('SELECT ready FROM readiness WHERE player_id = ?')
    .bind(playerId)
    .first<{ ready: number }>();

  return row === null ? null : row.ready === 1;
};

/** Validates the request body. There is no JSON Schema for this payload in the contract. */
export const parseReadiness = (data: unknown): ReadinessReport | null => {
  if (typeof data !== 'object' || data === null) {
    return null;
  }

  const body = data as { ready?: unknown; checks?: unknown };
  if (typeof body.ready !== 'boolean' || !Array.isArray(body.checks)) {
    return null;
  }

  const checks: ReadinessCheck[] = [];
  for (const entry of body.checks) {
    if (typeof entry !== 'object' || entry === null) {
      return null;
    }
    const check = entry as { id?: unknown; satisfied?: unknown };
    if (typeof check.id !== 'string' || typeof check.satisfied !== 'boolean') {
      return null;
    }
    checks.push({ id: check.id, satisfied: check.satisfied });
  }

  return { ready: body.ready, checks };
};
