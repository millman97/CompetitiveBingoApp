import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import apiFetchEvidence from '../../apis/admin/apiFetchEvidence';
import apiFetchRoster from '../../apis/admin/apiFetchRoster';
import ErrorMessage from '../../error/ErrorMessage';
import type { ReviewProps } from '../../model/domain/Review/ReviewProps';
import Field from '../Field/Field';
import Note from '../Note/Note';
import Panel from '../Panel/Panel';
import Select from '../Select/Select';

const Evidence = ({ gameId, detail }: ReviewProps) => {
  const [teamId, setTeamId] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [tileId, setTileId] = useState('');

  const roster = useQuery({
    queryKey: ['admin', 'roster', gameId],
    queryFn: () => apiFetchRoster(gameId),
  });

  const query = new URLSearchParams();
  if (teamId !== '') query.set('teamId', teamId);
  if (playerId !== '') query.set('playerId', playerId);
  if (tileId !== '') query.set('tileId', tileId);

  const evidence = useQuery({
    queryKey: ['admin', 'evidence', gameId, query.toString()],
    queryFn: () => apiFetchEvidence(gameId, query.toString()),
  });

  return (
    <Panel title={`Evidence — ${evidence.data?.length ?? 0}`}>
      <div className='mb-3 flex flex-wrap gap-3'>
        <Field label='Team'>
          <Select
            value={teamId}
            onChange={(event) => setTeamId(event.target.value)}
          >
            <option value=''>any</option>
            {detail.teams.map((team) => (
              <option
                key={team.id}
                value={team.id}
              >
                {team.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label='Player'>
          <Select
            value={playerId}
            onChange={(event) => setPlayerId(event.target.value)}
          >
            <option value=''>any</option>
            {(roster.data?.players ?? []).map((player) => (
              <option
                key={player.id}
                value={player.id}
              >
                {player.displayName}
              </option>
            ))}
          </Select>
        </Field>

        <Field label='Tile'>
          <Select
            value={tileId}
            onChange={(event) => setTileId(event.target.value)}
          >
            <option value=''>any</option>
            {detail.tiles.map((tile) => (
              <option
                key={tile.id}
                value={tile.id}
              >
                {tile.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {evidence.isError ? (
        <ErrorMessage
          error={evidence.error}
          onRetry={() => void evidence.refetch()}
        />
      ) : evidence.isLoading ? (
        <Note>Loading…</Note>
      ) : (evidence.data?.length ?? 0) === 0 ? (
        <Note>No screenshots match.</Note>
      ) : (
        <div className='grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6'>
          {evidence.data?.map((row) => (
            <a
              key={row.event_id}
              href={`/api/board/${gameId}/screenshots/${row.event_id}`}
              target='_blank'
              rel='noreferrer'
              className='block'
              title={`${row.display_name} — ${row.metric_id} — ${new Date(row.received_at).toLocaleString()}`}
            >
              <img
                src={`/api/board/${gameId}/screenshots/${row.event_id}`}
                alt={`${row.display_name}, ${row.metric_id}`}
                loading='lazy'
                className='bevel-inset h-24 w-full rounded-[2px] object-cover hover:brightness-125'
              />
              <span className='mt-0.5 block truncate text-[11px] text-parchment-dim'>
                {row.display_name} · {row.metric_id}
              </span>
            </a>
          ))}
        </div>
      )}
    </Panel>
  );
};

export default Evidence;
