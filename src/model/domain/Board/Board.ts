import type { AdminTile, GameDetail } from '../Game/Game';

export interface BoardShape {
  rows: number;
  cols: number;
  tiles: AdminTile[];
}

export interface TileProblem {
  row: number;
  col: number;
  problems: string[];
}

export interface BoardEditorProps {
  /** Null while the game is still a draft and has nothing to be saved into. */
  gameId: string | null;
  detail: GameDetail;
  onSaved: () => void;
  /**
   * Draft mode: hands the board up as it is edited instead of writing it.
   *
   * A game is created in one piece, so while one is being drafted the board belongs to whoever is
   * assembling it. There is no Save button here in that case — the board is saved when the game is.
   */
  onChange?: (board: BoardShape) => void;
  /** Per-tile problems the server found, when the save that found them was not made here. */
  problems?: TileProblem[];
}
export interface Position {
  row: number;
  col: number;
}
