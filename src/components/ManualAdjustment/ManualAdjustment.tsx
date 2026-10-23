import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import apiAdjustScore from '../../apis/admin/apiAdjustScore';
import apiFetchRoster from '../../apis/admin/apiFetchRoster';
import ErrorMessage from '../../error/ErrorMessage';
import type { ReviewProps } from '../../model/domain/Review/ReviewProps';
import Button from '../Button/Button';
import Confirm from '../Confirm/Confirm';
import Field from '../Field/Field';
import Input from '../Input/Input';
import Note from '../Note/Note';
import Panel from '../Panel/Panel';
import Select from '../Select/Select';
import TextArea from '../TextArea/TextArea';

const ManualAdjustment = ({ gameId, detail }: ReviewProps) => {
  const client = useQueryClient();
  const [playerId, setPlayerId] = useState('');
  const [metricId, setMetricId] = useState('');
  const [delta, setDelta] = useState(1);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');

  const roster = useQuery({
    queryKey: ['admin', 'roster', gameId],
    queryFn: () => apiFetchRoster(gameId),
  });

  const adjust = useMutation({
    mutationFn: () =>
      apiAdjustScore(gameId, { playerId, metricId, delta, reason }),
    onSuccess: () => {
      setConfirming(false);
      setReason('');
      void client.invalidateQueries({ queryKey: ['admin'] });
    },
  });

  const metrics = [
    ...new Set(detail.tiles.flatMap((tile) => tile.requirement.metrics)),
  ];

  return (
    <Panel title='Manual adjustment'>
      {roster.isError && (
        <ErrorMessage
          error={roster.error}
          onRetry={() => void roster.refetch()}
        />
      )}
      <Note>
        Credits or discredits a metric for one player, which moves whichever
        tiles track it. It is written into the event log as a MANUAL event, so a
        replay reaches the same board afterwards — and it is the only way to
        score something the plugin cannot observe.
      </Note>

      <div className='mt-3 grid gap-3 sm:grid-cols-2'>
        <Field label='Player'>
          <Select
            value={playerId}
            onChange={(event) => setPlayerId(event.target.value)}
          >
            <option value=''>— pick —</option>
            {(roster.data?.players ?? []).map((player) => (
              <option
                key={player.id}
                value={player.id}
              >
                {player.displayName}
                {player.teamId === null ? ' (no team)' : ''}
              </option>
            ))}
          </Select>
        </Field>

        <Field label='Metric'>
          <Input
            value={metricId}
            list='adjust-metrics'
            placeholder='kc.vorkath'
            onChange={(event) => setMetricId(event.target.value)}
          />
        </Field>

        <datalist id='adjust-metrics'>
          {metrics.map((metric) => (
            <option
              key={metric}
              value={metric}
            />
          ))}
        </datalist>

        <Field label='Amount (negative to take away)'>
          <Input
            type='number'
            value={delta}
            onChange={(event) => setDelta(Number(event.target.value))}
          />
        </Field>

        <div className='sm:col-span-2'>
          <Field label='Reason (required)'>
            <TextArea
              rows={2}
              value={reason}
              placeholder='Why this is being credited or taken away'
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        </div>
      </div>

      {adjust.isError ? (
        <p className='mt-2 text-xs text-error'>
          {(adjust.error as Error).message}
        </p>
      ) : null}
      {adjust.isSuccess ? (
        <p className='mt-2 text-xs text-success'>Adjustment recorded.</p>
      ) : null}

      <div className='mt-3'>
        <Button
          tone='primary'
          disabled={
            adjust.isPending ||
            playerId === '' ||
            metricId === '' ||
            reason.trim() === '' ||
            !Number.isInteger(delta) ||
            delta === 0
          }
          onClick={() => setConfirming(true)}
        >
          {adjust.isPending ? 'Saving…' : 'Apply adjustment'}
        </Button>
      </div>
      {confirming && (
        <Confirm
          title='Record this score adjustment?'
          body={
            'Change ' +
            metricId +
            ' by ' +
            delta +
            ' for ' +
            (roster.data?.players.find((player) => player.id === playerId)
              ?.displayName ?? 'this player') +
            '. Reason: ' +
            reason
          }
          confirmLabel='Record adjustment'
          pending={adjust.isPending}
          error={adjust.error?.message}
          onConfirm={() => adjust.mutate()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </Panel>
  );
};

export default ManualAdjustment;
