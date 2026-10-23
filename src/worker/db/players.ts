// Player identity and the sync handshake's storage side.
//
// accountHash is the identity key and is a string in every signature here. displayName is for
// humans to read and is never used to identify anybody — contract section 2.

import { newPlayerId } from '../lib/ids';

export interface Player {
  id: string;
  gameId: string;
  accountHash: string;
  displayName: string;
  teamId: string | null;
  removedAt: number | null;
}

interface PlayerRow {
  id: string;
  game_id: string;
  account_hash: string;
  display_name: string;
  team_id: string | null;
  removed_at: number | null;
}

const toPlayer = (row: PlayerRow): Player => ({
  id: row.id,
  gameId: row.game_id,
  accountHash: row.account_hash,
  displayName: row.display_name,
  teamId: row.team_id,
  removedAt: row.removed_at,
});

export const findPlayer = async (
  db: D1Database,
  gameId: string,
  accountHash: string,
): Promise<Player | null> => {
  const row = await db
    .prepare(
      `SELECT id, game_id, account_hash, display_name, team_id, removed_at
       FROM players WHERE game_id = ? AND account_hash = ?`,
    )
    .bind(gameId, accountHash)
    .first<PlayerRow>();

  return row === null ? null : toPlayer(row);
};

export const findTeamName = async (db: D1Database, teamId: string): Promise<string | null> => {
  const row = await db
    .prepare('SELECT name FROM teams WHERE id = ?')
    .bind(teamId)
    .first<{ name: string }>();
  return row === null ? null : row.name;
};

/**
 * Creates the player on first sync, or refreshes their display name on a repeat.
 *
 * Idempotent by contract: the plugin re-syncs unprompted on login and while waiting out an
 * unstarted lobby, so most calls here have no user behind them. A repeat must not create a
 * duplicate player and must not reset any progress — so this touches the display name and the
 * timestamps and nothing else. Team assignment and removal belong to the admin, not to a sync.
 */
export const upsertPlayer = async (
  db: D1Database,
  gameId: string,
  accountHash: string,
  displayName: string,
  now: number,
): Promise<Player> => {
  const existing = await findPlayer(db, gameId, accountHash);

  // The plugin sends an empty name when the client has not filled one in yet — getLocalPlayer()
  // has no name for a moment after login, and it syncs rather than waiting. It is never worth
  // overwriting a name we already know with nothing, and an empty name does not belong in the
  // player's recorded display-name history.
  const named = displayName !== '';

  if (existing !== null) {
    const keep = named ? displayName : existing.displayName;

    await db.batch([
      db
        .prepare('UPDATE players SET display_name = ?, last_synced_at = ? WHERE id = ?')
        .bind(keep, now, existing.id),
      ...(named ? [recordName(db, existing.id, displayName, now)] : []),
    ]);

    return { ...existing, displayName: keep };
  }

  const id = newPlayerId();

  await db.batch([
    db
      .prepare(
        `INSERT INTO players (id, game_id, account_hash, display_name, team_id, removed_at,
                              first_synced_at, last_synced_at)
         VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)`,
      )
      .bind(id, gameId, accountHash, displayName, now, now),
    ...(named ? [recordName(db, id, displayName, now)] : []),
  ]);

  return {
    id,
    gameId,
    accountHash,
    displayName,
    teamId: null,
    removedAt: null,
  };
};

/**
 * Records an RSN in the player's name history.
 *
 * Keeps previous names attached to the same account for event provenance. `seen_at` is
 * advanced when a known name is seen again, so the history keeps its ordering.
 */
const recordName = (
  db: D1Database,
  playerId: string,
  displayName: string,
  now: number,
): D1PreparedStatement =>
  db
    .prepare(
      `INSERT INTO player_names (player_id, display_name, seen_at)
       VALUES (?, ?, ?)
       ON CONFLICT(player_id, display_name) DO UPDATE SET seen_at = excluded.seen_at`,
    )
    .bind(playerId, displayName, now);

/**
 * Fills in a display name we do not have from an event envelope.
 *
 * The plugin captures the name once, when the session starts on LOGGED_IN — and at that moment
 * `getLocalPlayer()` is usually still null, so it sends an empty name for the whole session. The
 * envelope carries the same field, so if a later session ever knows the name this picks it up
 * without waiting for a sync.
 *
 * Deliberately only fills a blank. A name we already know is not replaced by one off an event.
 */
export const fillMissingName = async (
  db: D1Database,
  playerId: string,
  displayName: string,
  now: number,
): Promise<void> => {
  if (displayName.trim() === '') {
    return;
  }

  const changed = await db
    .prepare("UPDATE players SET display_name = ? WHERE id = ? AND display_name = ''")
    .bind(displayName, playerId)
    .run();

  if (changed.meta.changes > 0) {
    await db
      .prepare(
        `INSERT INTO player_names (player_id, display_name, seen_at) VALUES (?, ?, ?)
         ON CONFLICT(player_id, display_name) DO UPDATE SET seen_at = excluded.seen_at`,
      )
      .bind(playerId, displayName, now)
      .run();
  }
};
