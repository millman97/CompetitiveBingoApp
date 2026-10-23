import { useState } from 'react';
import ActivityFeed from '../../components/ActivityFeed/ActivityFeed';
import PublicLayout from '../../components/PublicLayout/PublicLayout';
import Board from '../../components/Board/Board';
import Button from '../../components/Button/Button';
import ScoreHeader from '../../components/ScoreHeader/ScoreHeader';
import Standings from '../../components/Standings/Standings';
import TeamsPanel from '../../components/TeamsPanel/TeamsPanel';
import TileDetail from '../../components/TileDetail/TileDetail';
import WinBanner from '../../components/WinBanner/WinBanner';
import useDocumentTitle from '../../hooks/useDocumentTitle';
import useLiveBoard from '../../hooks/useLiveBoard';

const BoardScreen = ({ gameId }: { gameId: string }) => {
  const { board, connection, error, isLoading, recentlyChanged, retry } =
    useLiveBoard(gameId);
  const [selectedTile, setSelectedTile] = useState<string | null>(null);
  useDocumentTitle(board?.name ?? 'Loading board');

  if (isLoading) {
    return (
      <PublicLayout>
        <p className='panel p-6 text-center text-parchment-dim'>
          Loading the board…
        </p>
      </PublicLayout>
    );
  }

  if (board === undefined) {
    return (
      <PublicLayout>
        <div className='panel p-6 text-center'>
          <p className='font-bold text-parchment'>
            {error?.message ?? 'Could not load the board.'}
          </p>
          <p className='mt-1 text-sm text-parchment-dim'>
            Check the link, or ask whoever is running the event for the right
            one.
          </p>
          <div className='mt-4 flex justify-center gap-4'>
            <Button onClick={retry}>Try again</Button>
            <a
              href='/'
              className='self-center underline'
            >
              Back to events
            </a>
          </div>
        </div>
      </PublicLayout>
    );
  }

  const beforeStart = board.state === 'UPCOMING';
  const sidebarOrder = beforeStart
    ? (['teams', 'standings', 'activity'] as const)
    : (['standings', 'activity', 'teams'] as const);

  return (
    <PublicLayout
      boardSize={
        board.tiles.length > 0
          ? { rows: board.rows, cols: board.cols }
          : undefined
      }
    >
      <ScoreHeader
        board={board}
        connection={connection}
      />
      {(connection !== 'live' || error !== null) && (
        <div
          role='status'
          className='panel flex flex-wrap items-center justify-between gap-3 p-3 text-sm'
        >
          <p>
            {connection === 'connecting'
              ? 'Connecting to live updates…'
              : connection === 'reconnecting'
                ? 'Reconnecting… The board may be behind the latest scores.'
                : 'Live updates are unavailable. Retrying the board every minute while this page is visible.'}
          </p>
          {connection !== 'connecting' && (
            <Button onClick={retry}>Reconnect now</Button>
          )}
        </div>
      )}

      {board.state === 'ENDED' ? <WinBanner board={board} /> : null}

      <div className='live-board-layout'>
        <section className='min-w-0'>
          <Board
            board={board}
            recentlyChanged={recentlyChanged}
            onSelect={setSelectedTile}
          />
        </section>
        <aside
          className='board-sidebar'
          aria-label='Event teams, standings and activity'
        >
          {sidebarOrder.map((section) =>
            section === 'teams' ? (
              <TeamsPanel
                key={section}
                gameId={gameId}
                board={board}
                onSelectTile={setSelectedTile}
                defaultOpen={beforeStart}
              />
            ) : section === 'standings' ? (
              <Standings
                key={section}
                board={board}
                defaultOpen={!beforeStart}
              />
            ) : (
              <ActivityFeed
                key={section}
                gameId={gameId}
                board={board}
                onSelectTile={setSelectedTile}
                defaultOpen={!beforeStart}
              />
            )
          )}
        </aside>
      </div>

      {selectedTile !== null ? (
        <TileDetail
          gameId={gameId}
          board={board}
          tileId={selectedTile}
          onClose={() => setSelectedTile(null)}
        />
      ) : null}
    </PublicLayout>
  );
};

export default BoardScreen;
