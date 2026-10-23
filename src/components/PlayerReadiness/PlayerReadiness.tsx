import type { AdminPlayer } from '../../model/domain/Player/Player';
import { CHECK_HELP } from '../../model/domain/Player/Player';

const PlayerReadiness = ({ player }: { player: AdminPlayer }) => {
  if (player.ready === null) {
    return (
      <span
        className='text-xs text-parchment-dim'
        title='This client has never reported readiness'
      >
        unknown
      </span>
    );
  }

  if (player.ready) {
    return <span className='text-xs font-bold text-success'>ready</span>;
  }

  const failed = player.checks.filter((check) => !check.satisfied);

  return (
    <div className='space-y-1'>
      <span className='text-xs font-bold text-error'>reporting nothing</span>

      <ul className='space-y-1'>
        {failed.map((check) => {
          const help = CHECK_HELP[check.id];
          return (
            <li
              key={check.id}
              className='text-[11px] leading-snug'
            >
              <span className='font-bold text-parchment'>
                {help?.name ?? check.id}
              </span>
              <br />
              <span className='text-parchment-dim'>
                {help?.fix ?? 'No guidance for this check.'}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default PlayerReadiness;
