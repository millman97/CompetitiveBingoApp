import type { CSSProperties } from 'react';
import type { BoardState } from '../../model/domain/Board/BoardState';
import { standingsFor } from '../../utils/standings';
import GameIcon from '../GameIcon/GameIcon';
import CollapsiblePanel from '../CollapsiblePanel/CollapsiblePanel';

const Standings = ({
  board,
  defaultOpen = true,
}: {
  board: BoardState;
  defaultOpen?: boolean;
}) => (
  <CollapsiblePanel
    title='Standings'
    icon={<GameIcon kind='standings' />}
    defaultOpen={defaultOpen}
    className='standings-panel'
  >
    <ol className='standings-list'>
      {standingsFor(board).map(({ team, lines, tiles }) => (
        <li
          key={team.id}
          style={{ '--team-colour': team.colour } as CSSProperties}
        >
          <span
            className='standing-rank'
            aria-hidden='true'
          >
            <GameIcon kind='banner' />
          </span>
          <div className='standing-detail'>
            <div className='standing-topline'>
              <strong>{team.name}</strong>
              <span>
                {lines} lines · {tiles} tiles
              </span>
            </div>
            <div
              className='standing-track'
              role='img'
              aria-label={`${team.name}: ${tiles} of ${board.tiles.length} tiles`}
            >
              <span
                style={{
                  width: `${board.tiles.length ? (tiles / board.tiles.length) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        </li>
      ))}
    </ol>
    <p className='standing-note'>
      {board.mode === 'CLASSIC'
        ? 'Score: completed tiles + lines.'
        : 'Ownership and completed lines, updated live.'}
    </p>
  </CollapsiblePanel>
);

export default Standings;
