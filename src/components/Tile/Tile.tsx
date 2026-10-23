import type { CSSProperties } from 'react';
import type {
  BoardState,
  TeamView,
  TileView,
} from '../../model/domain/Board/BoardState';
import { duration } from '../../utils/format';
import TileArtwork from '../TileArtwork/TileArtwork';
import { formatTileScore, valueFilterLabel } from '../../utils/valueTiles';

interface TileProps {
  tile: TileView;
  board: BoardState;
  teams: Map<string, TeamView>;
  lineTeamId: string | undefined;
  flash: boolean;
  onSelect: (tileId: string) => void;
}

const Tile = ({
  tile,
  board,
  teams,
  lineTeamId,
  flash,
  onSelect,
}: TileProps) => {
  const owner =
    tile.ownerTeamId === null ? undefined : teams.get(tile.ownerTeamId);
  const lineTeam = lineTeamId === undefined ? undefined : teams.get(lineTeamId);
  const scored = tile.progress.filter(
    (entry) => entry.score !== 0 || entry.complete
  );
  const completed =
    board.mode === 'CLASSIC'
      ? tile.progress.some((entry) => entry.complete)
      : owner !== undefined;
  const coordinate = String.fromCharCode(65 + tile.col) + (tile.row + 1);
  return (
    <button
      type='button'
      onClick={() => onSelect(tile.tileId)}
      title={
        tile.label +
        (tile.dropValue ? ' · ' + valueFilterLabel(tile.dropValue) : '')
      }
      aria-label={
        coordinate +
        ': ' +
        tile.label +
        (owner
          ? ', held by ' + owner.name
          : tile.contested
            ? ', contested'
            : '') +
        ' — details'
      }
      className={'bingo-tile ' + (flash ? 'just-changed' : '')}
      data-owned={!!owner}
      data-line={lineTeamId !== undefined}
      style={
        {
          '--tile-accent': owner?.colour ?? '#b29964',
          '--line-accent': lineTeam?.colour ?? '#ffce58',
        } as CSSProperties
      }
    >
      <span
        className='tile-address'
        aria-hidden='true'
      >
        {coordinate}
      </span>
      <div className='tile-task'>
        <TileArtwork
          metrics={tile.metrics}
          aggregate={tile.aggregate}
          valueBased={tile.valueBased}
        />
        <span className='tile-label'>
          {tile.label}
          {tile.dropValue && (
            <small className='tile-value-filter'>
              {valueFilterLabel(tile.dropValue)}
            </small>
          )}
        </span>
      </div>
      <div className='tile-progress'>
        {tile.contested && (
          <p className='tile-owner text-error'>Contested — leaders tied</p>
        )}
        {scored.length === 0 ? (
          <div className='tile-unstarted'>
            {tile.target !== null && (
              <div
                className='tile-track'
                aria-hidden='true'
              />
            )}
            <span className='text-xs text-parchment-dim'>
              {tile.aggregate === 'MIN_DURATION'
                ? 'No time posted'
                : tile.aggregate === 'MAX_VALUE'
                  ? 'No valued drop yet'
                  : 'Target: ' + (tile.target ?? '—')}
            </span>
          </div>
        ) : (
          scored.map((entry) => {
            const team = teams.get(entry.teamId);
            return (
              <div
                className='tile-progress-entry'
                key={entry.teamId}
                style={
                  {
                    '--progress-colour': team?.colour ?? '#bca271',
                  } as CSSProperties
                }
              >
                <div className='tile-progress-label'>
                  <span className='tile-team-name'>
                    {team?.name ?? 'Team'}
                    {owner?.id === entry.teamId && (
                      <span className='sr-only'>
                        {' '}
                        — {board.mode === 'RUSH' ? 'claimed' : 'held'}
                      </span>
                    )}
                  </span>
                  <strong>
                    {tile.aggregate === 'MIN_DURATION' &&
                    entry.bestDurationMs !== null
                      ? duration(entry.bestDurationMs)
                      : formatTileScore(tile.aggregate, entry.score)}
                    {tile.target !== null ? ' / ' + tile.target : ''}
                    {entry.complete ? ' ✓' : ''}
                  </strong>
                </div>
                {tile.target !== null && tile.target > 0 && (
                  <div
                    className='tile-track'
                    aria-hidden='true'
                  >
                    <span
                      style={{
                        width:
                          Math.min(
                            100,
                            Math.max(0, (entry.score / tile.target) * 100)
                          ) + '%',
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      {completed && (
        <span
          className='tile-complete'
          aria-label='Completed'
        >
          ✓
        </span>
      )}
    </button>
  );
};

export default Tile;
