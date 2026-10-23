/** Only the fields shown on this instance's public event list. */
export interface PublicGameSummary {
  id: string;
  name: string;
  mode: 'CLASSIC' | 'CONTROL' | 'RUSH';
  state: string;
  starts_at: number;
  ends_at: number;
  players: number;
  teams: number;
  tiles: number;
}

export const listPublicGames = async (db: D1Database): Promise<PublicGameSummary[]> => {
  const { results } = await db.prepare(
    `SELECT g.id, g.name, g.mode, g.state, g.starts_at, g.ends_at,
            (SELECT COUNT(*) FROM players p WHERE p.game_id = g.id AND p.removed_at IS NULL) AS players,
            (SELECT COUNT(*) FROM teams t WHERE t.game_id = g.id) AS teams,
            (SELECT COUNT(*) FROM tiles t WHERE t.game_id = g.id) AS tiles
     FROM games g ORDER BY g.starts_at DESC`
  ).all<PublicGameSummary>();

  // Keep the public response explicit even if the query gains admin-only columns later.
  return results.map((game) => ({
    id: game.id,
    name: game.name,
    mode: game.mode,
    state: game.state,
    starts_at: game.starts_at,
    ends_at: game.ends_at,
    players: game.players,
    teams: game.teams,
    tiles: game.tiles,
  }));
};
