import { useQuery } from '@tanstack/react-query';
import apiFetchTileDetail from '../../apis/board/apiFetchTileDetail';
import ErrorMessage from '../../error/ErrorMessage';
import type { BoardState, TeamView } from '../../model/domain/Board/BoardState';
import { duration, playerName, tint } from '../../utils/format';
import { screenshotUrl } from '../../utils/screenshotUrl';
import Dialog from '../Dialog/Dialog';
import { formatTileScore, valueFilterLabel } from '../../utils/valueTiles';

export interface TileDetailProps {
  gameId: string;
  board: BoardState;
  tileId: string;
  onClose: () => void;
}

const TileDetail = ({ gameId, board, tileId, onClose }: TileDetailProps) => {
  const detail = useQuery({
    queryKey: ['tile', gameId, tileId],
    queryFn: () => apiFetchTileDetail(gameId, tileId),
  });

  const tile = board.tiles.find((entry) => entry.tileId === tileId);
  const teams = new Map<string, TeamView>(
    board.teams.map((team) => [team.id, team])
  );
  const owner =
    tile?.ownerTeamId === undefined || tile.ownerTeamId === null
      ? undefined
      : teams.get(tile.ownerTeamId);

  return (
    <Dialog
      title={tile?.label ?? 'Tile details'}
      onClose={onClose}
    >
      <div className='space-y-4 p-3'>
        {tile !== undefined ? (
          <p className='text-xs text-parchment-dim'>
            {tile.aggregate === 'MIN_DURATION'
              ? board.mode === 'RUSH'
                ? 'First team to report a run claims this tile.'
                : 'Fastest run wins this tile.'
              : tile.aggregate === 'MAX_VALUE'
                ? board.mode === 'RUSH'
                  ? 'The first qualifying drop claims this tile.'
                  : 'Scores the highest single loot stack in gp.'
                : tile.aggregate === 'COUNT_DROPS'
                  ? `Needs ${tile.target} qualifying loot stacks.`
                  : tile.aggregate === 'UNIQUE'
                    ? `Needs ${tile.target ?? '—'} different things.`
                    : `Needs ${tile.target ?? '—'} in total.`}
            {owner !== undefined ? (
              <>
                {' '}
                Held by{' '}
                <span
                  style={{ color: owner.colour }}
                  className='font-bold'
                >
                  {owner.name}
                </span>
                .
              </>
            ) : tile.contested ? (
              <> Contested — the leaders are level.</>
            ) : null}
          </p>
        ) : null}

        {tile?.dropValue && (
          <p className='text-sm text-parchment-dim'>
            {valueFilterLabel(tile.dropValue)} ·{' '}
            {tile.dropValue.valuation === 'HIGH_ALCHEMY'
              ? 'High alchemy'
              : 'Grand Exchange'}{' '}
            prices. The filter applies to each stack’s recorded total value.
          </p>
        )}

        <div>
          <h3 className='mb-1 text-xs font-bold tracking-wide text-gold uppercase'>
            Contributions
          </h3>

          {detail.isError ? (
            <ErrorMessage
              error={detail.error}
              onRetry={() => void detail.refetch()}
            />
          ) : detail.isLoading ? (
            <p className='text-sm text-parchment-dim'>Loading…</p>
          ) : (detail.data?.contributors.length ?? 0) === 0 ? (
            <p className='text-sm text-parchment-dim'>
              Nobody has scored on this tile.
            </p>
          ) : (
            <ul className='divide-y divide-[var(--color-bark-900)]'>
              {detail.data?.contributors.map((contributor) => {
                const team =
                  contributor.teamId === null
                    ? undefined
                    : teams.get(contributor.teamId);

                return (
                  <li
                    key={`${contributor.teamId}:${contributor.playerName}`}
                    className='flex items-baseline justify-between gap-3 py-1.5'
                    style={{
                      background:
                        team === undefined
                          ? undefined
                          : tint(team.colour, 0.08),
                    }}
                  >
                    <span className='truncate text-sm'>
                      <span className='font-bold text-parchment'>
                        {playerName(contributor.playerName)}
                      </span>
                      {team !== undefined ? (
                        <span
                          style={{ color: team.colour }}
                          className='text-xs'
                        >
                          {' '}
                          {team.name}
                        </span>
                      ) : null}
                    </span>

                    <span className='stat shrink-0 text-xs text-parchment-dim'>
                      {contributor.bestDurationMs !== null ? (
                        <span className='text-gold'>
                          {duration(contributor.bestDurationMs)}
                        </span>
                      ) : (
                        <span className='text-gold'>
                          {formatTileScore(
                            tile?.aggregate ?? 'SUM',
                            contributor.credited
                          )}
                        </span>
                      )}
                      <span> from {contributor.events} events</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {(detail.data?.evidence.length ?? 0) > 0 ? (
          <div>
            <h3 className='mb-1 text-xs font-bold tracking-wide text-gold uppercase'>
              Evidence
            </h3>

            <div className='flex flex-wrap gap-1.5'>
              {detail.data?.evidence.map((shot) => (
                <a
                  key={shot.eventId}
                  href={screenshotUrl(gameId, shot.eventId)}
                  target='_blank'
                  rel='noreferrer'
                  title={`${shot.playerName} — ${new Date(shot.at).toLocaleString()}`}
                >
                  <img
                    src={screenshotUrl(gameId, shot.eventId)}
                    alt={`Screenshot from ${shot.playerName}`}
                    loading='lazy'
                    className='bevel-inset h-16 w-24 rounded-[2px] object-cover hover:brightness-125'
                  />
                </a>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
};

export default TileDetail;
