import type {
  GameDetail,
  GameSetup,
  SetupProblem,
} from '../../model/domain/Game/Game';
import Warning from '../Warning/Warning';

/**
 * Gaps an organiser has left in a game, and where to go and close them.
 *
 * A game cannot be created with any of these — it is written in one piece, complete — so every
 * one of them is something taken back out afterwards. Nothing is blocked over them; the panel
 * just says so, because an empty square is otherwise found by a player grinding at a row that
 * cannot be completed.
 */
const SETUP_HELP: Record<SetupProblem, (setup: GameSetup) => string> = {
  BOARD_INCOMPLETE: (setup) =>
    `${setup.cells - setup.tiles} of the ${setup.cells} squares are still empty. An empty square is a row, a column and possibly a diagonal that nobody can ever complete — fill them on the Board tab.`,
  TOO_FEW_TEAMS: (setup) =>
    setup.teams === 0
      ? 'There are no teams yet. Add at least two below.'
      : 'There is only one team, which is competing against nobody. Add at least one more below.',
  WINDOW_PASSED: () =>
    'The end time has already passed. Move the start, or give the game longer to run.',
};

const SetupWarning = ({ detail }: { detail: GameDetail }) => {
  const { problems } = detail.setup;

  if (problems.length === 0) {
    return null;
  }

  return (
    <Warning>
      <p className='font-bold'>This game has gaps in it.</p>
      <ul className='mt-1 list-disc space-y-1 pl-5'>
        {problems.map((problem) => (
          <li key={problem}>{SETUP_HELP[problem](detail.setup)}</li>
        ))}
      </ul>
    </Warning>
  );
};

export default SetupWarning;
