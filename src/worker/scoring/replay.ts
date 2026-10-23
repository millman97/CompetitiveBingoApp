// Rebuilding every derived number from the event log.
//
// This is what you reach for when a dispute needs settling or a scoring bug needs fixing mid
// event: change the rules, replay, and the board is correct without anybody re-reporting
// anything. It is also the guarantee the rest of the design leans on, so it is a real function
// with real tests rather than a claim in a comment.
//
// Flags are deliberately left alone. A replay recomputes scores; it does not re-observe facts,
// and an admin's flag resolutions must survive it.

import { findGameById, type Game } from '../db/games';
import { listTeamIds, loadTiles, type Tile } from '../db/tiles';
import { completedLines } from './lines';
import {
  creditEvent,
  loadThresholds,
  recomputeBoard,
  type ScoringContext,
} from './engine';
import { fromRow, type EventRow } from './observation';

interface ReplayRow extends EventRow {
  event_id: string;
  player_id: string;
}

export const scoringContextFor = async (
  db: D1Database,
  game: Game,
): Promise<ScoringContext> => ({
  db,
  game,
  tiles: await loadTiles(db, game.id),
  thresholds: await loadThresholds(db, game.id),
});

export interface ReplayResult {
  events: number;
  teams: number;
  tiles: number;
}

/**
 * Recomputes metric state, per-event credit and tile progress for a whole game.
 *
 * Ordering is `received_at`, then rowid. The tiebreak matters: every envelope in one batch is
 * stamped with the same receipt time, and a COUNT is differenced against the last value seen, so
 * ordering three kills 1, 2, 3 as 3, 1, 2 would derive a decrease and credit nothing. rowid is
 * SQLite's insertion order, which is the order ingestion actually processed them in.
 */
export const replayGame = async (db: D1Database, gameId: string): Promise<ReplayResult> => {
  const game = await findGameById(db, gameId);
  if (game === null) {
    throw new Error(`Cannot replay ${gameId}: no such game.`);
  }

  const ctx = await scoringContextFor(db, game);
  const teamIds = await listTeamIds(db, gameId);

  // Everything below is derived and about to be rebuilt from the events that produced it.
  await db.batch([
    db.prepare('DELETE FROM event_credit WHERE game_id = ?').bind(gameId),
    db.prepare('DELETE FROM metric_state WHERE game_id = ?').bind(gameId),
    db.prepare('DELETE FROM tile_progress WHERE game_id = ?').bind(gameId),
  ]);

  const { results } = await db
    .prepare(
      `SELECT event_id, player_id, metric_id, metric_type, value, delta,
              first_observation, received_at
       FROM events
       WHERE game_id = ?
       ORDER BY received_at ASC, rowid ASC`,
    )
    .bind(gameId)
    .all<ReplayRow>();

  for (const row of results) {
    await creditEvent(ctx, row.player_id, row.event_id, fromRow(row), { persistFlags: false });
  }

  await recomputeBoard(ctx, teamIds);

  return { events: results.length, teams: teamIds.length, tiles: ctx.tiles.length };
};

export interface TeamStanding {
  teamId: string;
  tilesComplete: number;
  linesComplete: number;
  /** Final score in CLASSIC: tiles completed plus lines completed. */
  score: number;
}

/**
 * The scoreboard for a CLASSIC game.
 *
 * Every team works the same board independently, so several teams may complete the same tile and
 * each is scored on its own.
 */
export const classicStandings = async (
  db: D1Database,
  game: Game,
  tiles: Tile[],
): Promise<TeamStanding[]> => {
  const byId = new Map(tiles.map((tile) => [tile.id, tile]));

  const { results } = await db
    .prepare(
      `SELECT team_id, tile_id FROM tile_progress
       WHERE game_id = ? AND complete = 1`,
    )
    .bind(game.id)
    .all<{ team_id: string; tile_id: string }>();

  const held = new Map<string, { row: number; col: number }[]>();
  for (const row of results) {
    const tile = byId.get(row.tile_id);
    if (tile === undefined) {
      continue;
    }
    const cells = held.get(row.team_id) ?? [];
    cells.push({ row: tile.row, col: tile.col });
    held.set(row.team_id, cells);
  }

  const teamIds = await listTeamIds(db, game.id);

  return teamIds.map((teamId) => {
    const cells = held.get(teamId) ?? [];
    const lines = completedLines(game.boardRows, game.boardCols, cells);

    return {
      teamId,
      tilesComplete: cells.length,
      linesComplete: lines.length,
      score: cells.length + lines.length,
    };
  });
};

/**
 * Recomputes one team's whole board.
 *
 * Kept as a narrow scoring primitive for tests and offline reconstruction. Production mutations
 * enter through GameRoom so this operation cannot race live ingestion.
 */
export const recomputeTeam = async (
  db: D1Database,
  gameId: string,
  teamId: string,
): Promise<void> => {
  const game = await findGameById(db, gameId);
  if (game === null) {
    throw new Error(`Cannot recompute ${gameId}: no such game.`);
  }

  const ctx = await scoringContextFor(db, game);
  await recomputeBoard(ctx, [teamId]);
};
