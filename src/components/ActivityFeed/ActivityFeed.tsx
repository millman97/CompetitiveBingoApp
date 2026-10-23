import useNow from '../../hooks/useNow';

import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import apiFetchActivity from '../../apis/board/apiFetchActivity';
import ErrorMessage from '../../error/ErrorMessage';
import type { BoardState, TeamView } from '../../model/domain/Board/BoardState';
import { ago, playerName } from '../../utils/format';
import { screenshotUrl } from '../../utils/screenshotUrl';
import GameIcon from '../GameIcon/GameIcon';
import TileArtwork from '../TileArtwork/TileArtwork';
import type { CSSProperties } from 'react';
import CollapsiblePanel from '../CollapsiblePanel/CollapsiblePanel';
import { formatTileScore } from '../../utils/valueTiles';

export interface ActivityFeedProps {
  gameId: string;
  board: BoardState;
  onSelectTile: (tileId: string) => void;
  defaultOpen?: boolean;
}

const ActivityFeed = ({
  gameId,
  board,
  onSelectTile,
  defaultOpen = true,
}: ActivityFeedProps) => {
  const client = useQueryClient();
  const now = useNow(10_000);

  const teams = new Map<string, TeamView>(
    board.teams.map((team) => [team.id, team])
  );

  const feed = useInfiniteQuery({
    queryKey: ['activity', gameId],
    queryFn: ({ pageParam }) => apiFetchActivity(gameId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.cursor,
    staleTime: 5000,
  });

  // The board changing is the signal that something happened. Watching it is cheaper and more
  // accurate than putting the feed on a timer.
  const signature = board.tiles
    .map(
      (tile) => `${tile.tileId}:${tile.progress.map((p) => p.score).join(',')}`
    )
    .join('|');

  useEffect(() => {
    void client.invalidateQueries({ queryKey: ['activity', gameId] });
  }, [client, gameId, signature]);

  const entries = feed.data?.pages.flatMap((page) => page.entries) ?? [];

  return (
    <CollapsiblePanel
      title='Activity'
      icon={<GameIcon kind='chat' />}
      defaultOpen={defaultOpen}
      className='activity-panel'
    >
      <div className='scroll-y max-h-[26rem] min-h-0 lg:max-h-none lg:flex-1'>
        {feed.isError ? (
          <ErrorMessage
            error={feed.error}
            onRetry={() => void feed.refetch()}
          />
        ) : feed.isLoading ? (
          <p className='p-3 text-sm text-parchment-dim'>Loading…</p>
        ) : entries.length === 0 ? (
          <p className='p-3 text-sm text-parchment-dim'>
            Nothing has happened yet.
          </p>
        ) : (
          <ul className='activity-list'>
            {entries.map((entry) => {
              const team =
                entry.teamId === null ? undefined : teams.get(entry.teamId);
              const withheld =
                entry.derivedDelta !== null &&
                entry.derivedDelta > entry.credited;
              const valueTile = board.tiles.find(
                (tile) =>
                  tile.metrics?.includes(entry.metricId) &&
                  (tile.aggregate === 'MAX_VALUE' ||
                    tile.aggregate === 'COUNT_DROPS')
              );
              const creditLabel =
                valueTile?.aggregate === 'MAX_VALUE'
                  ? `${entry.metricType === 'MANUAL' ? '+' : ''}${formatTileScore('MAX_VALUE', entry.credited)}`
                  : valueTile?.aggregate === 'COUNT_DROPS'
                    ? `+${entry.metricType === 'MANUAL' ? entry.credited : 1} ${entry.metricType === 'MANUAL' && entry.credited !== 1 ? 'stacks' : 'stack'}`
                    : `+${entry.credited}`;

              return (
                <li
                  key={entry.eventId}
                  className='activity-entry'
                  style={
                    {
                      '--team-colour': team?.colour ?? '#c5bda9',
                    } as CSSProperties
                  }
                >
                  <div className='activity-artwork'>
                    <TileArtwork
                      metrics={[entry.metricId]}
                      aggregate={
                        entry.metricType === 'DURATION' ? 'MIN_DURATION' : 'SUM'
                      }
                      valueBased={board.tiles.some(
                        (tile) =>
                          tile.valueBased &&
                          tile.metrics?.includes(entry.metricId)
                      )}
                    />
                  </div>

                  <div className='min-w-0 flex-1'>
                    <div className='activity-meta'>
                      <span className='activity-team'>
                        <GameIcon kind='banner' />
                        {team?.name ?? 'Unassigned'}
                      </span>
                      <span>{ago(entry.at, now)}</span>
                    </div>
                    <p className='leading-snug'>
                      <span className='font-bold text-parchment'>
                        {playerName(entry.playerName)}
                      </span>
                      <span className='text-parchment-dim'> — </span>
                      <span className='text-parchment'>{entry.what}</span>
                      {entry.credited > 0 ? (
                        <span className='stat text-success'>
                          {' '}
                          {creditLabel}
                        </span>
                      ) : null}
                      {withheld ? (
                        <span
                          className='stat text-[var(--color-gold-dim)]'
                          title={`${entry.derivedDelta} implied, ${entry.credited} credited — the rest happened off-plugin`}
                        >
                          {' '}
                          ({entry.derivedDelta} implied)
                        </span>
                      ) : null}
                    </p>

                    <p className='activity-tile-links'>
                      {entry.tiles.map((tile) => (
                        <button
                          key={tile.tileId}
                          type='button'
                          onClick={() => onSelectTile(tile.tileId)}
                          className='underline decoration-dotted underline-offset-2 hover:text-gold'
                        >
                          {tile.label}
                        </button>
                      ))}
                    </p>
                  </div>

                  {entry.hasScreenshot ? (
                    <a
                      href={screenshotUrl(gameId, entry.eventId)}
                      target='_blank'
                      rel='noreferrer'
                      title='Screenshot'
                      className='activity-screenshot'
                    >
                      <img
                        src={screenshotUrl(gameId, entry.eventId)}
                        alt=''
                        loading='lazy'
                        className='bevel-inset h-9 w-12 rounded-[2px] object-cover'
                      />
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {feed.hasNextPage ? (
          <div className='p-2'>
            <button
              type='button'
              onClick={() => void feed.fetchNextPage()}
              disabled={feed.isFetchingNextPage}
              className='bevel w-full rounded-[3px] bg-[var(--color-bark-600)] px-3 py-1.5 text-xs font-bold text-parchment uppercase hover:brightness-125 disabled:opacity-50'
            >
              {feed.isFetchingNextPage ? 'Loading…' : 'Older'}
            </button>
          </div>
        ) : null}
      </div>
    </CollapsiblePanel>
  );
};

export default ActivityFeed;
