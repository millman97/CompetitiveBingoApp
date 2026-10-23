// Board reads.

import { parseRequirement, type TileRequirement } from '../scoring/tiles';

export interface Tile {
  id: string;
  row: number;
  col: number;
  label: string;
  requirement: TileRequirement;
}

interface TileRow {
  id: string;
  row_index: number;
  col_index: number;
  label: string;
  requirement_json: string;
}

/**
 * Loads a board.
 *
 * A tile whose requirement will not parse throws rather than being skipped: a board that silently
 * drops a tile scores every team wrongly and nobody notices until the event is over.
 */
export const loadTiles = async (db: D1Database, gameId: string): Promise<Tile[]> => {
  const { results } = await db
    .prepare(
      `SELECT id, row_index, col_index, label, requirement_json
       FROM tiles WHERE game_id = ? ORDER BY row_index, col_index`,
    )
    .bind(gameId)
    .all<TileRow>();

  return results.map((row) => ({
    id: row.id,
    row: row.row_index,
    col: row.col_index,
    label: row.label,
    requirement: parseRequirement(row.requirement_json, row.id),
  }));
};

export const listTeamIds = async (db: D1Database, gameId: string): Promise<string[]> => {
  const { results } = await db
    .prepare('SELECT id FROM teams WHERE game_id = ? ORDER BY id')
    .bind(gameId)
    .all<{ id: string }>();

  return results.map((row) => row.id);
};
