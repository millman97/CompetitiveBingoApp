import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import apiAssignPlayer from '../../apis/admin/apiAssignPlayer';
import apiFetchRoster from '../../apis/admin/apiFetchRoster';
import apiSetPlayerRemoved from '../../apis/admin/apiSetPlayerRemoved';
import ErrorMessage from '../../error/ErrorMessage';
import type { GameDetail } from '../../model/domain/Game/Game';
import { playerName } from '../../utils/format';
import Button from '../Button/Button';
import Note from '../Note/Note';
import Panel from '../Panel/Panel';
import PlayerReadiness from '../PlayerReadiness/PlayerReadiness';
import Select from '../Select/Select';
import Warning from '../Warning/Warning';

export interface RosterProps {
  gameId: string;
  detail: GameDetail;
}

const Roster = ({ gameId, detail }: RosterProps) => {
  const client = useQueryClient();

  const roster = useQuery({
    queryKey: ['admin', 'roster', gameId],
    queryFn: () => apiFetchRoster(gameId),
    refetchInterval: 15_000,
  });

  const invalidate = () => {
    void client.invalidateQueries({ queryKey: ['admin', 'roster', gameId] });
  };

  const assign = useMutation({
    mutationFn: ({
      playerId,
      teamId,
    }: {
      playerId: string;
      teamId: string | null;
    }) => apiAssignPlayer(gameId, playerId, teamId),
    onSuccess: invalidate,
  });

  const setRemoved = useMutation({
    mutationFn: ({
      playerId,
      removed,
    }: {
      playerId: string;
      removed: boolean;
    }) => apiSetPlayerRemoved(gameId, playerId, removed),
    onSuccess: invalidate,
  });

  const players = roster.data?.players ?? [];
  const stale = players.filter(
    (player) => player.needsResync && player.removedAt === null
  );
  const notReporting = players.filter((player) => player.ready === false);
  const unassigned = players.filter(
    (player) => player.teamId === null && player.removedAt === null
  );

  return (
    <div className='space-y-3'>
      {assign.isError && <ErrorMessage error={assign.error} />}
      {setRemoved.isError && <ErrorMessage error={setRemoved.error} />}
      {(assign.isSuccess || setRemoved.isSuccess) && (
        <p
          role='status'
          className='text-success'
        >
          Player updated.
        </p>
      )}
      {stale.length > 0 ? (
        <Warning>
          <p className='font-bold'>
            {stale.length} {stale.length === 1 ? 'player has' : 'players have'}{' '}
            not re-synced since you added a metric.
          </p>
          <p className='mt-1 text-xs'>
            The plugin does not poll, so a metric added mid-game reaches a
            player only when they press Sync again — until then they will not
            report it at all. Ask them to hit Sync:{' '}
            {stale.map((player) => playerName(player.displayName)).join(', ')}.
          </p>
        </Warning>
      ) : null}

      {notReporting.length > 0 ? (
        <Warning>
          <p className='font-bold'>
            {notReporting.length}{' '}
            {notReporting.length === 1 ? 'player is' : 'players are'} sending
            nothing at all.
          </p>
          <p className='mt-1 text-xs'>
            Readiness is all-or-nothing in the plugin: one failed check stops
            every metric, not just the one it affects. The fixes are listed
            against each player below.
          </p>
        </Warning>
      ) : null}

      <Panel
        title={`Roster — ${players.length} synced`}
        actions={
          unassigned.length > 0 ? (
            <span className='text-[11px] normal-case text-parchment-dim'>
              {unassigned.length} not on a team
            </span>
          ) : null
        }
      >
        {roster.isError ? (
          <ErrorMessage
            error={roster.error}
            onRetry={() => void roster.refetch()}
          />
        ) : roster.isLoading ? (
          <Note>Loading…</Note>
        ) : players.length === 0 ? (
          <Note>
            Nobody has synced yet. Players join with the code{' '}
            {detail.game.joinCode}.
          </Note>
        ) : (
          <div className='overflow-x-auto'>
            <table className='w-full min-w-[46rem] text-left text-sm'>
              <thead>
                <tr className='text-[11px] uppercase tracking-wide text-parchment-dim'>
                  <th className='pb-1 pr-3 font-bold'>Player</th>
                  <th className='pb-1 pr-3 font-bold'>Team</th>
                  <th className='pb-1 pr-3 font-bold'>Readiness</th>
                  <th className='pb-1 font-bold'>Actions</th>
                </tr>
              </thead>

              <tbody className='align-top'>
                {players.map((player) => (
                  <tr
                    key={player.id}
                    className='border-t border-[var(--color-bark-900)]'
                    style={{ opacity: player.removedAt === null ? 1 : 0.45 }}
                  >
                    <td className='py-2 pr-3'>
                      <span className='font-bold text-parchment'>
                        {playerName(player.displayName)}
                      </span>
                      {player.removedAt !== null ? (
                        <span className='ml-2 text-[11px] text-error'>
                          removed
                        </span>
                      ) : null}
                      {player.needsResync && player.removedAt === null ? (
                        <span className='ml-2 text-[11px] text-[var(--color-gold)]'>
                          needs re-sync
                        </span>
                      ) : null}
                    </td>

                    <td className='py-2 pr-3'>
                      <Select
                        aria-label={
                          'Team for ' + playerName(player.displayName)
                        }
                        disabled={assign.isPending}
                        value={player.teamId ?? ''}
                        onChange={(event) =>
                          assign.mutate({
                            playerId: player.id,
                            teamId:
                              event.target.value === ''
                                ? null
                                : event.target.value,
                          })
                        }
                      >
                        <option value=''>— none —</option>
                        {detail.teams.map((team) => (
                          <option
                            key={team.id}
                            value={team.id}
                          >
                            {team.name}
                          </option>
                        ))}
                      </Select>
                    </td>

                    <td className='max-w-sm py-2 pr-3'>
                      <PlayerReadiness player={player} />
                    </td>

                    <td className='py-2'>
                      <Button
                        disabled={setRemoved.isPending}
                        tone={player.removedAt === null ? 'danger' : 'default'}
                        onClick={() =>
                          setRemoved.mutate({
                            playerId: player.id,
                            removed: player.removedAt === null,
                          })
                        }
                        title={
                          player.removedAt === null
                            ? 'Stops them reporting. What they have already contributed stays on the board — use an adjustment to take that away.'
                            : 'Lets them sync and report again.'
                        }
                      >
                        {player.removedAt === null ? 'Remove' : 'Restore'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
};

export default Roster;
