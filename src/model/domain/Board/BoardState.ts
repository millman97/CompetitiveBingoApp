import type { BoardState } from '../../../worker/do/board-state';

export type {
  ActivityPage,
  RosterMember,
  TeamRoster,
  TileDetail,
} from '../../../worker/db/activity';
export type { BoardState } from '../../../worker/do/board-state';

export type TileView = BoardState['tiles'][number];

export type TeamView = BoardState['teams'][number];

export type LineView = BoardState['lines'][number];

export interface Snapshot {
  version: number;
  board: BoardState;
}
