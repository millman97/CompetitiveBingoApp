import type { Connection } from '../../hooks/useLiveBoard';
import useNow from '../../hooks/useNow';
import type { BoardState } from '../../model/domain/Board/BoardState';
import { timeRemaining } from '../../utils/format';
import BoardHelp from '../BoardHelp/BoardHelp';
import StatusBadge from '../StatusBadge/StatusBadge';

interface ScoreHeaderProps {
  board: BoardState;
  connection: Connection;
}

const ScoreHeader = ({ board, connection }: ScoreHeaderProps) => {
  const now = useNow();
  return (
    <header className='board-titlebar'>
      <h1 className='sr-only'>{board.name}</h1>
      <div className='board-heading-meta'>
        <span className='board-mode'>{board.mode}</span>
        <span
          className='connection-state'
          data-connection={connection}
        >
          {connection === 'live'
            ? 'Live updates connected'
            : connection === 'offline'
              ? 'Updates offline'
              : connection === 'connecting'
                ? 'Connecting…'
                : 'Reconnecting…'}
        </span>
      </div>
      <div className='board-clock'>
        <StatusBadge state={board.state} />
        {board.state !== 'ENDED' && (
          <div className='board-countdown'>
            <span className='text-xs'>
              {board.state === 'UPCOMING'
                ? 'Starts in'
                : board.state === 'SUDDEN_DEATH'
                  ? 'Sudden death'
                  : 'Ends in'}
            </span>
            <strong>
              {board.state === 'SUDDEN_DEATH'
                ? 'Next line wins'
                : timeRemaining(
                    board.state === 'UPCOMING' ? board.startsAt : board.endsAt,
                    now
                  )}
            </strong>
          </div>
        )}
        <BoardHelp board={board} />
      </div>
    </header>
  );
};

export default ScoreHeader;
