import { useQuery, useQueryClient } from '@tanstack/react-query';
import apiFetchGame from '../../apis/admin/apiFetchGame';
import EventNavigation from '../../components/EventNavigation/EventNavigation';
import StatusBadge from '../../components/StatusBadge/StatusBadge';
import useDocumentTitle from '../../hooks/useDocumentTitle';

import ActionLog from '../../components/ActionLog/ActionLog';
import BoardEditor from '../../components/BoardEditor/BoardEditor';
import Evidence from '../../components/Evidence/Evidence';
import FlagQueue from '../../components/FlagQueue/FlagQueue';
import GameOverview from '../../components/GameOverview/GameOverview';
import GameSettings from '../../components/GameSettings/GameSettings';
import Loading from '../../components/Loading/Loading';
import ManualAdjustment from '../../components/ManualAdjustment/ManualAdjustment';
import Roster from '../../components/Roster/Roster';
import SetupWarning from '../../components/SetupWarning/SetupWarning';
import ValueRules from '../../components/ValueRules/ValueRules';
import ErrorMessage from '../../error/ErrorMessage';
import { boardPath, GAME_TABS, type GameTab } from '../../routing/routes';

const GameScreen = ({ gameId, tab }: { gameId: string; tab: GameTab }) => {
  const client = useQueryClient();
  const detail = useQuery({
    queryKey: ['admin', 'game', gameId],
    queryFn: () => apiFetchGame(gameId),
  });
  useDocumentTitle(
    detail.data
      ? `${detail.data.game.name} — ${GAME_TABS.find((entry) => entry.id === tab)?.label}`
      : 'Loading event'
  );
  if (detail.isLoading) return <Loading message='Loading event…' />;
  if (detail.isError)
    return (
      <ErrorMessage
        error={detail.error}
        onRetry={() => void detail.refetch()}
      />
    );
  if (!detail.data) return null;

  const game = detail.data;
  const refresh = () =>
    void client.invalidateQueries({ queryKey: ['admin', 'game', gameId] });

  return (
    <div>
      <a
        href='/admin'
        className='breadcrumb'
      >
        ← Your events
      </a>
      <div className='page-heading'>
        <div>
          <h1 className='page-title'>{game.game.name}</h1>
          <p className='event-title-meta'>
            <StatusBadge state={game.game.state} />
            {game.game.mode.toLowerCase()} mode
          </p>
        </div>
        <a
          href={boardPath(gameId)}
          className='action-link'
        >
          View public board →
        </a>
      </div>
      <SetupWarning detail={game} />
      <div className='event-workspace'>
        <EventNavigation
          gameId={gameId}
          tab={tab}
        />
        <section
          className='event-content'
          aria-label={GAME_TABS.find((entry) => entry.id === tab)?.label}
        >
          {tab === 'overview' && (
            <GameOverview
              gameId={gameId}
              detail={game}
            />
          )}
          {tab === 'settings' && (
            <GameSettings
              gameId={gameId}
              detail={game}
            />
          )}
          {tab === 'board' && (
            <div className='space-y-4'>
              <BoardEditor
                gameId={gameId}
                detail={game}
                onSaved={refresh}
              />
              <ValueRules
                gameId={gameId}
                detail={game}
                onSaved={refresh}
              />
            </div>
          )}
          {tab === 'roster' && (
            <Roster
              gameId={gameId}
              detail={game}
            />
          )}
          {tab === 'flags' && (
            <FlagQueue
              gameId={gameId}
              detail={game}
            />
          )}
          {tab === 'evidence' && (
            <Evidence
              gameId={gameId}
              detail={game}
            />
          )}
          {tab === 'adjust' && (
            <ManualAdjustment
              gameId={gameId}
              detail={game}
            />
          )}
          {tab === 'log' && <ActionLog gameId={gameId} />}
        </section>
      </div>
    </div>
  );
};

export default GameScreen;
