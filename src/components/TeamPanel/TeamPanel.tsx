import type { CSSProperties } from 'react';
import type {
  BoardState,
  RosterMember,
  TeamView,
} from '../../model/domain/Board/BoardState';
import { playerName } from '../../utils/format';
import GameIcon from '../GameIcon/GameIcon';
import { formatTileScore } from '../../utils/valueTiles';

const TeamPanel = ({
  board,
  team,
  members,
  onSelectTile,
}: {
  board: BoardState;
  team: TeamView;
  members: RosterMember[];
  onSelectTile: (tileId: string) => void;
}) => {
  const beforeStart = board.state === 'UPCOMING';
  const lines = board.lines.filter((line) => line.teamId === team.id).length;
  const tiles = board.tiles.filter((tile) =>
    board.mode === 'CLASSIC'
      ? tile.progress.some(
          (progress) => progress.teamId === team.id && progress.complete
        )
      : tile.ownerTeamId === team.id
  ).length;
  const tileLabels = new Map(
    board.tiles.map((tile) => [tile.tileId, tile.label])
  );
  return (
    <section
      className='team-roster-group'
      style={{ '--team-colour': team.colour } as CSSProperties}
    >
      <h3 className='team-roster-heading'>
        <span className='team-roster-name'>
          <GameIcon kind='banner' />
          {team.name}
        </span>
        <span>
          {beforeStart
            ? `${members.length} ${members.length === 1 ? 'player' : 'players'}`
            : `${lines} lines · ${tiles} tiles`}
        </span>
      </h3>
      {members.length === 0 ? (
        <p className='p-3 text-sm text-parchment-dim'>
          Nobody has joined this team yet.
        </p>
      ) : (
        <ul className='team-member-list'>
          {members.map((member) => {
            const contributions = Object.entries(member.perTile)
              .filter(([, credited]) => credited !== 0)
              .sort((a, b) => b[1] - a[1]);
            return (
              <li key={member.playerName}>
                <div className='team-member-name'>
                  <strong>{playerName(member.playerName)}</strong>
                  {!beforeStart && (
                    <span className='stat text-parchment-dim'>
                      {contributions.length}{' '}
                      {contributions.length === 1 ? 'tile' : 'tiles'}
                    </span>
                  )}
                </div>
                {member.ready === false && (
                  <p
                    className='text-xs text-error'
                    title='This client is not currently reporting anything'
                  >
                    Not reporting
                  </p>
                )}
                {beforeStart && member.ready === true && (
                  <p className='text-xs text-success'>Ready</p>
                )}
                {!beforeStart && contributions.length > 0 && (
                  <ul className='mt-1 flex flex-wrap gap-x-2 gap-y-1'>
                    {contributions.map(([tileId, credited]) => (
                      <li key={tileId}>
                        <button
                          type='button'
                          onClick={() => onSelectTile(tileId)}
                          className='text-xs text-parchment-dim underline decoration-dotted underline-offset-2 hover:text-gold'
                        >
                          {tileLabels.get(tileId) ?? 'Tile'}{' '}
                          <span className='stat text-parchment'>
                            {formatTileScore(
                              board.tiles.find((tile) => tile.tileId === tileId)
                                ?.aggregate ?? 'SUM',
                              credited
                            )}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

export default TeamPanel;
