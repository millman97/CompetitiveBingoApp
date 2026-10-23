import { useState } from 'react';
import type { BoardState } from '../../model/domain/Board/BoardState';
import { MODE_HELP } from '../../model/domain/Game/gameOptions';
import Button from '../Button/Button';
import Dialog from '../Dialog/Dialog';
import GameIcon from '../GameIcon/GameIcon';

const CONTROL_RULES: Record<string, string> = {
  FIRST_LINE: 'The first team to hold a completed line wins immediately.',
  MOST_AT_DEADLINE:
    'At the deadline, the team with the most lines wins, with ties broken by tiles held.',
  HYBRID_SUDDEN_DEATH:
    'At the deadline, a team holding a line can win. If nobody holds a line, play continues into sudden death and the next line wins.',
};

const BoardHelp = ({ board }: { board: BoardState }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <GameIcon kind='help' />
        Help
      </Button>
      {open && (
        <Dialog
          title='Board help'
          onClose={() => setOpen(false)}
        >
          <p>
            Select a tile to view its targets, player contributions and
            screenshots.
          </p>
          <details
            className='rules-accordion'
            open
          >
            <summary>
              Event rules ·{' '}
              {board.mode.charAt(0) + board.mode.slice(1).toLowerCase()}
            </summary>
            <p>{MODE_HELP[board.mode]}</p>
            {board.mode === 'CONTROL' && board.winCondition && (
              <p>{CONTROL_RULES[board.winCondition]}</p>
            )}
          </details>
        </Dialog>
      )}
    </>
  );
};

export default BoardHelp;
