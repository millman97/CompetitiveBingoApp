// Whether an existing game still holds together.
//
// A game cannot be created incomplete — `POST /games` writes the whole thing or nothing — so this
// is not a gate and nothing consults it before letting a player in. It exists because an organiser
// can take a game apart afterwards: delete a team, clear a row of the board, leave a deadline
// behind them. The admin panel says so; nobody is refused over it.

import type { Game } from '../db/games';

export type SetupProblem = 'BOARD_INCOMPLETE' | 'TOO_FEW_TEAMS' | 'WINDOW_PASSED';

/** The counted facts a judgement is made from. */
export interface SetupFacts {
  /** Tiles placed inside the board's bounds. */
  tiles: number;
  /** Squares the board has. */
  cells: number;
  teams: number;
  problems: SetupProblem[];
}

export const problemsFrom = (
  facts: { tiles: number; cells: number; teams: number; endsAt: number },
  now: number,
): SetupProblem[] => {
  const problems: SetupProblem[] = [];

  // An empty square is not a smaller board — it is a row, a column and possibly a diagonal that
  // no team can ever complete, in a game whose win condition is usually a line.
  if (facts.tiles < facts.cells) {
    problems.push('BOARD_INCOMPLETE');
  }

  // One team competes against nobody, in either mode.
  if (facts.teams < 2) {
    problems.push('TOO_FEW_TEAMS');
  }

  // A game whose deadline is already behind it can no longer be run.
  if (facts.endsAt <= now) {
    problems.push('WINDOW_PASSED');
  }

  return problems;
};

export const readSetup = async (db: D1Database, game: Game, now: number): Promise<SetupFacts> => {
  const counts = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM tiles
                WHERE game_id = ?1 AND row_index < ?2 AND col_index < ?3) AS tiles,
              (SELECT COUNT(*) FROM teams WHERE game_id = ?1) AS teams`,
    )
    .bind(game.id, game.boardRows, game.boardCols)
    .first<{ tiles: number; teams: number }>();

  const facts = {
    tiles: counts?.tiles ?? 0,
    cells: game.boardRows * game.boardCols,
    teams: counts?.teams ?? 0,
    endsAt: game.endsAt,
  };

  return { ...facts, problems: problemsFrom(facts, now) };
};
