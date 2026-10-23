import type { BoardState } from '../../model/domain/Board/BoardState';
import { tint } from '../../utils/format';

export interface WinBannerProps {
  board: BoardState;
}

const WinBanner = ({ board }: WinBannerProps) => {
  if (board.winner === null) {
    // A game can finish without a winner: a deadline nobody built a line by.
    if (board.state !== 'ENDED') {
      return null;
    }

    return (
      <div className='panel px-4 py-3 text-center'>
        <p className='font-[family-name:var(--font-display)] text-lg font-bold text-parchment'>
          Finished — no single winning team.
        </p>
      </div>
    );
  }

  const team = board.teams.find((entry) => entry.id === board.winner?.teamId);
  const colour = team?.colour ?? 'var(--color-gold)';
  const lines = board.lines.filter(
    (line) => line.teamId === board.winner?.teamId
  );

  return (
    <div
      className='bevel rounded-[3px] px-4 py-3 text-center'
      style={{
        background: `linear-gradient(180deg, ${tint(colour, 0.55)} 0%, ${tint(colour, 0.2)} 100%)`,
        boxShadow: `inset 0 0 0 2px ${colour}, 0 0 22px ${tint(colour, 0.45)}`,
      }}
    >
      <p className='font-[family-name:var(--font-display)] text-2xl font-bold tracking-wide text-parchment [text-shadow:0_2px_0_#000]'>
        {team?.name ?? 'A team'} wins
      </p>

      <p className='mt-0.5 text-xs text-parchment'>
        {lines.length === 0
          ? 'Most tiles held.'
          : lines
              .map((line) =>
                line.kind === 'DIAGONAL'
                  ? `diagonal ${line.index + 1}`
                  : `${line.kind.toLowerCase()} ${line.index + 1}`
              )
              .join(', ')}
        {board.winner.at > 0
          ? ` · ${new Date(board.winner.at).toLocaleString()}`
          : ''}
      </p>
    </div>
  );
};

export default WinBanner;
