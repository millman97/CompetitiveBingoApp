// Win conditions — spec section 5.2, and RUSH's fixed rule.
//
// Pure, so that the awkward cases can be tested directly: two teams completing a line in the same
// instant, a deadline nobody has a line at, and a sudden death that carries the board over.

import { completedLines, type Line } from './lines';
import type { WinCondition } from '../db/games';

export interface BoardShape {
  rows: number;
  cols: number;
}

/** Which cells each team currently owns. */
export type OwnedCells = Map<string, { row: number; col: number }[]>;

export interface TeamResult {
  teamId: string;
  lines: Line[];
  tilesOwned: number;
}

export const teamResults = (board: BoardShape, owned: OwnedCells): TeamResult[] =>
  [...owned.entries()].map(([teamId, cells]) => ({
    teamId,
    lines: completedLines(board.rows, board.cols, cells),
    tilesOwned: cells.length,
  }));

export type Outcome =
  | { kind: 'CONTINUE' }
  | { kind: 'WIN'; teamId: string; lines: Line[] }
  | { kind: 'SUDDEN_DEATH' }
  /** The deadline passed with nothing to separate the teams, or nothing achieved at all. */
  | { kind: 'ENDED_NO_WINNER' };

/**
 * Picks a winner from teams that hold at least one line.
 *
 * Most lines wins; tiles owned breaks a tie. If that is still level, nobody has separated
 * themselves and the server does not invent a winner — an organiser decides.
 */
const leader = (results: readonly TeamResult[]): TeamResult | null => {
  const contenders = results.filter((result) => result.lines.length > 0);
  if (contenders.length === 0) {
    return null;
  }

  const ranked = [...contenders].sort(
    (a, b) => b.lines.length - a.lines.length || b.tilesOwned - a.tilesOwned,
  );

  const [first, second] = ranked;
  if (
    second !== undefined &&
    second.lines.length === first!.lines.length &&
    second.tilesOwned === first!.tilesOwned
  ) {
    return null;
  }

  return first!;
};

/**
 * Evaluates the board after ownership has changed, while the game is running.
 *
 * Only FIRST_LINE can end a game mid-flight; the other two wait for the deadline. Sudden death is
 * the exception: it is past its deadline already, and the first line to appear takes it.
 */
export const evaluateLive = (
  condition: WinCondition,
  board: BoardShape,
  owned: OwnedCells,
  inSuddenDeath: boolean,
): Outcome => {
  if (!inSuddenDeath && condition !== 'FIRST_LINE') {
    return { kind: 'CONTINUE' };
  }

  const results = teamResults(board, owned);
  const winner = leader(results);

  // Two teams completing a line in the same instant is a real possibility, and the tie-break above
  // is what keeps it deterministic. The Durable Object serialises the events themselves, so only
  // one of them is ever the event that completed a line first.
  return winner === null ? { kind: 'CONTINUE' } : { kind: 'WIN', teamId: winner.teamId, lines: winner.lines };
};

/**
 * Evaluates the board at endsAt.
 *
 * MOST_AT_DEADLINE settles there and then. HYBRID_SUDDEN_DEATH awards the game to a team already
 * holding a line, and otherwise carries the board into sudden death rather than ending it.
 */
export const evaluateDeadline = (
  condition: WinCondition,
  board: BoardShape,
  owned: OwnedCells,
): Outcome => {
  const results = teamResults(board, owned);
  const winner = leader(results);

  if (condition === 'HYBRID_SUDDEN_DEATH') {
    return winner === null ? { kind: 'SUDDEN_DEATH' } : { kind: 'WIN', teamId: winner.teamId, lines: winner.lines };
  }

  if (condition === 'MOST_AT_DEADLINE') {
    return winner === null ? { kind: 'ENDED_NO_WINNER' } : { kind: 'WIN', teamId: winner.teamId, lines: winner.lines };
  }

  // FIRST_LINE has no deadline rule: the game is won the instant somebody completes a line, and
  // reaching endsAt without that having happened means nobody won it.
  return { kind: 'ENDED_NO_WINNER' };
};

/**
 * Picks a winner on tiles held, with no line required.
 *
 * RUSH only. The other modes ask this question of teams that already hold a line, as a tiebreak;
 * here it is the whole answer when nobody managed a line at all.
 */
const mostTiles = (results: readonly TeamResult[]): TeamResult | null => {
  const contenders = results.filter((result) => result.tilesOwned > 0);
  if (contenders.length === 0) {
    return null;
  }

  const ranked = [...contenders].sort((a, b) => b.tilesOwned - a.tilesOwned);
  const [first, second] = ranked;

  // Level on tiles is level. The server does not invent a winner; an organiser decides.
  return second !== undefined && second.tilesOwned === first!.tilesOwned ? null : first!;
};

/**
 * Evaluates a RUSH board.
 *
 * One rule, so there is no win condition to choose: a line wins the moment it appears, and
 * otherwise the most tiles wins once there is nothing left to race for. `finished` is what says
 * there is nothing left — either the clock ran out, or every tile on the board has been claimed
 * and no amount of further play can change the standings.
 */
export const evaluateRush = (
  board: BoardShape,
  owned: OwnedCells,
  finished: boolean,
): Outcome => {
  const results = teamResults(board, owned);

  const online = leader(results);
  if (online !== null) {
    return { kind: 'WIN', teamId: online.teamId, lines: online.lines };
  }

  if (!finished) {
    return { kind: 'CONTINUE' };
  }

  const ahead = mostTiles(results);
  return ahead === null
    ? { kind: 'ENDED_NO_WINNER' }
    : { kind: 'WIN', teamId: ahead.teamId, lines: ahead.lines };
};
