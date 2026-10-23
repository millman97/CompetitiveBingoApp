import type { CSSProperties } from 'react';
import type { BoardState, TeamView } from '../../model/domain/Board/BoardState';
import Panel from '../Panel/Panel';
import Tile from '../Tile/Tile';

export interface BoardProps {
  board: BoardState;
  recentlyChanged: Set<string>;
  onSelect: (tileId: string) => void;
}

const teamsById = (teams: TeamView[]): Map<string, TeamView> =>
  new Map(teams.map((team) => [team.id, team]));

/** Cells that belong to a completed line, so the board can pick them out. */
const lineCells = (board: BoardState): Map<string, string> => {
  const cells = new Map<string, string>();

  for (const line of board.lines) {
    for (const cell of line.cells) {
      cells.set(`${cell.row},${cell.col}`, line.teamId);
    }
  }

  return cells;
};

const Board = ({ board, recentlyChanged, onSelect }: BoardProps) => {
  const teams = teamsById(board.teams);
  const cells = lineCells(board);
  const completed = board.tiles.filter((tile) =>
    board.mode === 'CLASSIC'
      ? tile.progress.some((progress) => progress.complete)
      : tile.ownerTeamId !== null
  ).length;

  if (board.tiles.length === 0) {
    return (
      <div className='panel p-8 text-center text-parchment-dim'>
        This board has no tiles yet.
      </div>
    );
  }

  return (
    <Panel
      title='Bingo board'
      className='bingo-board-panel'
      actions={
        <span
          className='board-completion'
          title={
            board.mode === 'CLASSIC'
              ? 'Tiles completed by at least one team'
              : undefined
          }
        >
          <span>
            {completed} / {board.tiles.length} tiles{' '}
            {board.mode === 'CONTROL' ? 'held' : 'complete'}
          </span>
          <span
            className='board-completion-track'
            aria-hidden='true'
          >
            <span
              style={{
                width: `${board.tiles.length ? (completed / board.tiles.length) * 100 : 0}%`,
              }}
            />
          </span>
        </span>
      }
    >
      <div
        role='region'
        aria-label='Bingo board'
        tabIndex={0}
        className='board-scroll'
      >
        <div
          className='board-grid'
          style={
            {
              '--board-cols': board.cols,
              '--board-rows': board.rows,
            } as CSSProperties
          }
        >
          <span aria-hidden='true' />
          {Array.from({ length: board.cols }, (_, col) => (
            <span
              key={col}
              className='board-coordinate'
              aria-hidden='true'
            >
              {String.fromCharCode(65 + col)}
            </span>
          ))}
          {Array.from({ length: board.rows }, (_, row) => (
            <div
              className='contents'
              key={row}
            >
              <span
                className='board-coordinate self-center'
                aria-hidden='true'
              >
                {row + 1}
              </span>
              {Array.from({ length: board.cols }, (__, col) => {
                const tile = board.tiles.find(
                  (entry) => entry.row === row && entry.col === col
                );
                return tile ? (
                  <div
                    key={tile.tileId}
                    className='board-cell'
                  >
                    <Tile
                      tile={tile}
                      board={board}
                      teams={teams}
                      lineTeamId={cells.get(`${tile.row},${tile.col}`)}
                      flash={recentlyChanged.has(tile.tileId)}
                      onSelect={onSelect}
                    />
                  </div>
                ) : (
                  <div
                    key={`empty-${row}-${col}`}
                    className='board-cell'
                  >
                    <div className='bingo-tile opacity-50'>
                      <span className='tile-label'>No challenge set</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
};

export default Board;
