import { useQuery } from '@tanstack/react-query';
import apiFetchRoster from '../../apis/admin/apiFetchRoster';

import ErrorMessage from '../../error/ErrorMessage';
import type { GameDetail } from '../../model/domain/Game/Game';
import { boardPath, gamePath } from '../../routing/routes';
import CopyField from '../CopyField/CopyField';
import Panel from '../Panel/Panel';

const GameOverview = ({
  gameId,
  detail,
}: {
  gameId: string;
  detail: GameDetail;
}) => {
  const roster = useQuery({
    queryKey: ['admin', 'roster', gameId],
    queryFn: () => apiFetchRoster(gameId),
    refetchInterval: detail.game.state === 'ENDED' ? false : 15_000,
  });
  const active =
    roster.data?.players.filter((player) => player.removedAt === null) ?? [];
  const ready = active.filter(
    (player) =>
      player.ready === true && player.teamId !== null && !player.needsResync
  );

  return (
    <div className='overview-layout'>
      <Panel title='Invite your players'>
        <p className='mb-4 text-sm text-parchment-dim'>
          The game is created. Share the board link for spectators, and the
          server address plus join code for players using RuneLite.
        </p>
        <div className='grid gap-5 sm:grid-cols-2'>
          <CopyField
            label='Public board link'
            value={`${window.location.origin}${boardPath(gameId)}`}
          />
          <CopyField
            label='Server address'
            value={window.location.origin}
          />
          <CopyField
            label='Join code'
            value={detail.game.joinCode}
          />
        </div>
        <ol className='mt-5 list-decimal space-y-2 pl-5 text-sm'>
          <li>
            Players open the Competitive Bingo plugin in RuneLite and enter the
            server address and join code, then press Sync.
          </li>
          <li>
            <a
              className='text-gold underline'
              href={gamePath(gameId, 'roster')}
            >
              Assign each player to a team and check readiness.
            </a>{' '}
            Unassigned players do not contribute to a team.
          </li>
          <li>
            The game starts automatically at{' '}
            {new Date(detail.game.startsAt).toLocaleString()}.{' '}
            <a
              className='text-gold underline'
              href={gamePath(gameId, 'settings')}
            >
              Manage the schedule or start early.
            </a>
          </li>
        </ol>
      </Panel>
      <div className='overview-sidebar'>
        <Panel title='Player readiness'>
          {roster.isLoading ? (
            <p role='status'>Checking players…</p>
          ) : roster.isError ? (
            <ErrorMessage
              error={roster.error}
              onRetry={() => void roster.refetch()}
            />
          ) : (
            <div className='space-y-3'>
              <p className='text-lg font-bold'>
                {ready.length} of {active.length} players ready and assigned
              </p>
              <p className='text-sm text-parchment-dim'>
                {active.length === 0
                  ? 'No players have synced yet. Share the joining details above.'
                  : `${active.filter((player) => player.teamId === null).length} without a team · ${active.filter((player) => player.ready !== true).length} not confirmed ready · ${active.filter((player) => player.needsResync).length} need to sync again`}
              </p>
              <a
                href={gamePath(gameId, 'roster')}
                className='text-gold underline'
              >
                Open player readiness →
              </a>
            </div>
          )}
        </Panel>
        <Panel title='Run the event'>
          <div className='quick-links'>
            <a
              href={gamePath(gameId, 'flags')}
              className='text-gold underline'
            >
              Review flagged events
            </a>
            <a
              href={gamePath(gameId, 'evidence')}
              className='text-gold underline'
            >
              Browse screenshots
            </a>
            <a
              href={boardPath(gameId)}
              className='text-gold underline'
            >
              Watch the live board
            </a>
          </div>
        </Panel>
      </div>
    </div>
  );
};

export default GameOverview;
