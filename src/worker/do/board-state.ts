// The shape of a board as clients see it.
//
// This is what the WebSocket sends and what the snapshot endpoint returns, so it is deliberately
// self-contained: a client that receives one of these can render the whole page without asking
// anything else. Raw events are not in here — the activity feed is fetched over HTTP and
// paginated, because a live board and a scrolling log have very different update rates.

import { listDropValueRules, type Game } from '../db/games';
import { listTeamIds, type Tile } from '../db/tiles';
import { loadCompletedCells, loadOwnedCells } from '../scoring/control';
import type { Line } from '../scoring/lines';
import { toWireState, type WireGameState } from '../lib/game-state';
import { teamResults } from '../scoring/win';
import type { DropValueSettings } from '../scoring/tiles';

export interface TeamView {
  id: string;
  name: string;
  colour: string;
}

export interface TileProgressView {
  teamId: string;
  score: number;
  complete: boolean;
  bestDurationMs: number | null;
}

export interface TileView {
  tileId: string;
  row: number;
  col: number;
  label: string;
  target: number | null;
  aggregate: string;
  /** Optional on older saved snapshots. Used only to select local challenge artwork. */
  metrics?: string[];
  valueBased?: boolean;
  dropValue?: DropValueSettings;
  /** CONTROL only. Null in CLASSIC, where every team works the tile independently. */
  ownerTeamId: string | null;
  contested: boolean;
  progress: TileProgressView[];
}

export interface LineView {
  teamId: string;
  kind: Line['kind'];
  index: number;
  cells: { row: number; col: number }[];
}

export interface BoardState {
  gameId: string;
  name: string;
  /** The public state. SUDDEN_DEATH is reported as itself here — this is not the plugin's enum. */
  state: WireGameState | 'SUDDEN_DEATH';
  mode: Game['mode'];
  winCondition: Game['winCondition'];
  startsAt: number;
  endsAt: number;
  rows: number;
  cols: number;
  teams: TeamView[];
  tiles: TileView[];
  lines: LineView[];
  winner: { teamId: string; at: number } | null;
}

/**
 * Reads the whole board out of D1.
 *
 * Called when a client connects, when a reconnecting client is too far behind to patch, and when
 * the game ends and the final board is written down.
 */
export const buildBoardState = async (
  db: D1Database,
  game: Game,
  tiles: readonly Tile[],
): Promise<BoardState> => {
  const teams = await db
    .prepare('SELECT id, name, colour FROM teams WHERE game_id = ? ORDER BY id')
    .bind(game.id)
    .all<TeamView>();

  const progress = await db
    .prepare(
      `SELECT tile_id, team_id, score, complete, best_duration_ms FROM tile_progress
       WHERE game_id = ?`,
    )
    .bind(game.id)
    .all<{
      tile_id: string;
      team_id: string;
      score: number;
      complete: number;
      best_duration_ms: number | null;
    }>();

  const ownership = await db
    .prepare('SELECT tile_id, owner_team_id, contested FROM tile_ownership WHERE game_id = ?')
    .bind(game.id)
    .all<{ tile_id: string; owner_team_id: string | null; contested: number }>();

  const byTile = new Map<string, TileProgressView[]>();
  for (const row of progress.results) {
    const list = byTile.get(row.tile_id) ?? [];
    list.push({
      teamId: row.team_id,
      score: row.score,
      complete: row.complete === 1,
      bestDurationMs: row.best_duration_ms,
    });
    byTile.set(row.tile_id, list);
  }

  const ownerOf = new Map(ownership.results.map((row) => [row.tile_id, row]));

  const valueMetrics = new Set((await listDropValueRules(db, game.id)).map((rule) => rule.metricId));
  const tileViews: TileView[] = tiles.map((tile) => {
    const owner = ownerOf.get(tile.id);
    return {
      tileId: tile.id,
      row: tile.row,
      col: tile.col,
      label: tile.label,
      target: tile.requirement.target,
      aggregate: tile.requirement.aggregate,
      metrics: tile.requirement.metrics,
      valueBased: tile.requirement.metrics.some((metric) => valueMetrics.has(metric)),
      dropValue: tile.requirement.dropValue,
      ownerTeamId: owner?.owner_team_id ?? null,
      contested: owner?.contested === 1,
      progress: (byTile.get(tile.id) ?? []).sort((a, b) => a.teamId.localeCompare(b.teamId)),
    };
  });

  // Lines run over owned tiles in CONTROL and RUSH, and over completed tiles in CLASSIC. The
  // geometry is the same; only the definition of "held" differs.
  const held =
    game.mode === 'CLASSIC'
      ? await loadCompletedCells(db, game.id, tiles)
      : await loadOwnedCells(db, game.id, tiles);

  const lines: LineView[] = teamResults({ rows: game.boardRows, cols: game.boardCols }, held)
    .flatMap((result) =>
      result.lines.map((line) => ({
        teamId: result.teamId,
        kind: line.kind,
        index: line.index,
        cells: line.cells,
      })),
    )
    .sort((a, b) => a.teamId.localeCompare(b.teamId) || a.kind.localeCompare(b.kind) || a.index - b.index);

  return {
    gameId: game.id,
    name: game.name,
    state: game.state === 'SUDDEN_DEATH' ? 'SUDDEN_DEATH' : toWireState(game.state),
    mode: game.mode,
    winCondition: game.winCondition,
    startsAt: game.startsAt,
    endsAt: game.endsAt,
    rows: game.boardRows,
    cols: game.boardCols,
    teams: teams.results,
    tiles: tileViews,
    lines,
    winner:
      game.wonByTeamId === null ? null : { teamId: game.wonByTeamId, at: game.wonAt ?? 0 },
  };
};

/** Team ids, in the order the board presents them. */
export const boardTeamIds = (db: D1Database, gameId: string): Promise<string[]> =>
  listTeamIds(db, gameId);
