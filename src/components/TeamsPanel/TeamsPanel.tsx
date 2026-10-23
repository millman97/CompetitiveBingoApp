import { useQuery } from '@tanstack/react-query';
import apiFetchRoster from '../../apis/board/apiFetchRoster';
import ErrorMessage from '../../error/ErrorMessage';
import type { BoardState } from '../../model/domain/Board/BoardState';
import { playerName } from '../../utils/format';
import CollapsiblePanel from '../CollapsiblePanel/CollapsiblePanel';
import GameIcon from '../GameIcon/GameIcon';
import TeamPanel from '../TeamPanel/TeamPanel';

const TeamsPanel = ({
  gameId,
  board,
  onSelectTile,
  defaultOpen,
}: {
  gameId: string;
  board: BoardState;
  onSelectTile: (tileId: string) => void;
  defaultOpen: boolean;
}) => {
  const beforeStart = board.state === 'UPCOMING';
  const roster = useQuery({
    queryKey: ['roster', gameId],
    queryFn: () => apiFetchRoster(gameId),
    staleTime: 5_000,
    refetchInterval:
      board.state === 'ENDED' ? false : beforeStart ? 10_000 : 30_000,
  });
  const waiting =
    roster.data?.find((group) => group.teamId === null)?.members ?? [];
  return (
    <CollapsiblePanel
      title='Teams'
      icon={<GameIcon kind='banner' />}
      defaultOpen={defaultOpen}
      className='teams-panel'
    >
      <div className='scroll-y teams-roster'>
        {roster.isError ? (
          <ErrorMessage
            error={roster.error}
            onRetry={() => void roster.refetch()}
          />
        ) : roster.isLoading ? (
          <p
            className='p-3 text-sm text-parchment-dim'
            role='status'
          >
            Loading players…
          </p>
        ) : (
          <>
            {waiting.length > 0 && (
              <section className='team-roster-group waiting-roster'>
                <h3 className='team-roster-heading'>
                  <span>Awaiting allocation</span>
                  <span>
                    {waiting.length}{' '}
                    {waiting.length === 1 ? 'player' : 'players'}
                  </span>
                </h3>
                <p className='waiting-note'>
                  Joined and waiting for the organiser to assign a team.
                </p>
                <ul className='team-member-list'>
                  {waiting.map((member) => (
                    <li key={member.playerName}>
                      {playerName(member.playerName)}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {board.teams.map((team) => (
              <TeamPanel
                key={team.id}
                board={board}
                team={team}
                members={
                  roster.data?.find((group) => group.teamId === team.id)
                    ?.members ?? []
                }
                onSelectTile={onSelectTile}
              />
            ))}
            {board.teams.length === 0 && (
              <p className='p-3 text-sm text-parchment-dim'>
                No teams have been created yet.
              </p>
            )}
          </>
        )}
      </div>
    </CollapsiblePanel>
  );
};

export default TeamsPanel;
