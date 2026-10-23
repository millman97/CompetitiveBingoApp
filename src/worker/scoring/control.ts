// Reading and writing tile ownership.
//
// Ownership is resolved from tile_progress rather than re-aggregated from the event log: the
// scoring team's progress has just been recomputed, and every other team's is already stored, so
// deciding who leads is a read of a handful of rows.

import type { Tile } from '../db/tiles';
import type { ScoringContext } from './engine';
import { resolveClaim, resolveOwnership, type Ownership, type TeamScore } from './ownership';
import type { OwnedCells } from './win';

interface ProgressRow {
  team_id: string;
  score: number;
  best_duration_ms: number | null;
  best_at: number | null;
  complete: number;
  completed_at: number | null;
}

/**
 * Every team's standing on one tile.
 *
 * Teams with no row have done nothing on this tile. They are included at zero so that "everyone is
 * level on nothing" resolves to unowned rather than to a contest between absent teams.
 */
const teamScoresFor = async (
  ctx: ScoringContext,
  tile: Tile,
  teamIds: readonly string[],
): Promise<TeamScore[]> => {
  const { results } = await ctx.db
    .prepare(
      `SELECT team_id, score, best_duration_ms, best_at, complete, completed_at
       FROM tile_progress
       WHERE game_id = ? AND tile_id = ?`,
    )
    .bind(ctx.game.id, tile.id)
    .all<ProgressRow>();

  const byTeam = new Map(results.map((row) => [row.team_id, row]));

  return teamIds.map((teamId) => {
    const row = byTeam.get(teamId);
    return {
      teamId,
      score: row?.score ?? 0,
      complete: row?.complete === 1,
      completedAt: row?.completed_at ?? null,
      bestDurationMs: row?.best_duration_ms ?? null,
      bestAt: row?.best_at ?? null,
    };
  });
};

export interface OwnershipChange {
  tileId: string;
  before: Ownership;
  after: Ownership;
  changed: boolean;
}

/**
 * Recomputes who holds a tile and stores the answer.
 *
 * `since` is only refreshed when the owner actually changes, so the board can show how long a team
 * has held something without it resetting every time they extend their lead.
 */
export const resolveTileOwnership = async (
  ctx: ScoringContext,
  tile: Tile,
  teamIds: readonly string[],
  now: number,
): Promise<OwnershipChange> => {
  const stored = await ctx.db
    .prepare('SELECT owner_team_id, contested FROM tile_ownership WHERE game_id = ? AND tile_id = ?')
    .bind(ctx.game.id, tile.id)
    .first<{ owner_team_id: string | null; contested: number }>();

  const before: Ownership = {
    ownerTeamId: stored?.owner_team_id ?? null,
    contested: stored?.contested === 1,
  };

  const scores = await teamScoresFor(ctx, tile, teamIds);
  const after =
    ctx.game.mode === 'RUSH'
      ? resolveClaim(scores)
      : resolveOwnership(scores, tile.requirement.aggregate);

  const changed =
    before.ownerTeamId !== after.ownerTeamId || before.contested !== after.contested;

  if (changed) {
    await ctx.db
      .prepare(
        `INSERT INTO tile_ownership (game_id, tile_id, owner_team_id, contested, since)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(game_id, tile_id) DO UPDATE SET
           owner_team_id = excluded.owner_team_id,
           contested = excluded.contested,
           since = excluded.since`,
      )
      .bind(
        ctx.game.id,
        tile.id,
        after.ownerTeamId,
        after.contested ? 1 : 0,
        after.ownerTeamId === null ? null : now,
      )
      .run();
  }

  return { tileId: tile.id, before, after, changed };
};

/** The cells each team currently owns, for line and win detection. */
export const loadOwnedCells = async (
  db: D1Database,
  gameId: string,
  tiles: readonly Tile[],
): Promise<OwnedCells> => {
  const byId = new Map(tiles.map((tile) => [tile.id, tile]));

  const { results } = await db
    .prepare(
      'SELECT tile_id, owner_team_id FROM tile_ownership WHERE game_id = ? AND owner_team_id IS NOT NULL',
    )
    .bind(gameId)
    .all<{ tile_id: string; owner_team_id: string }>();

  const owned: OwnedCells = new Map();

  for (const row of results) {
    const tile = byId.get(row.tile_id);
    if (tile === undefined) {
      continue;
    }
    const cells = owned.get(row.owner_team_id) ?? [];
    cells.push({ row: tile.row, col: tile.col });
    owned.set(row.owner_team_id, cells);
  }

  return owned;
};

/**
 * In CLASSIC a tile is held by every team that has completed it, and several teams may hold the
 * same one. Lines are detected over exactly the same geometry, which is why win evaluation takes
 * cells rather than knowing about modes.
 */
export const loadCompletedCells = async (
  db: D1Database,
  gameId: string,
  tiles: readonly Tile[],
): Promise<OwnedCells> => {
  const byId = new Map(tiles.map((tile) => [tile.id, tile]));

  const { results } = await db
    .prepare('SELECT tile_id, team_id FROM tile_progress WHERE game_id = ? AND complete = 1')
    .bind(gameId)
    .all<{ tile_id: string; team_id: string }>();

  const held: OwnedCells = new Map();

  for (const row of results) {
    const tile = byId.get(row.tile_id);
    if (tile === undefined) {
      continue;
    }
    const cells = held.get(row.team_id) ?? [];
    cells.push({ row: tile.row, col: tile.col });
    held.set(row.team_id, cells);
  }

  return held;
};
