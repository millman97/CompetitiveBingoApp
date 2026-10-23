import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import apiResolveFlag from '../../apis/admin/apiResolveFlag';
import type { FlagView } from '../../model/domain/Review/Review';
import Button from '../Button/Button';
import Field from '../Field/Field';
import Input from '../Input/Input';
import TextArea from '../TextArea/TextArea';

const FlagResolver = ({
  gameId,
  flag,
  onDone,
}: {
  gameId: string;
  flag: FlagView;
  onDone: () => void;
}) => {
  const [reason, setReason] = useState('');
  // A sensible starting point: whatever a policy withheld, else what was credited, else 1.
  const withheld = Math.max((flag.derivedDelta ?? 0) - (flag.credited ?? 0), 0);
  const [delta, setDelta] = useState(
    withheld || Math.abs(flag.credited ?? 0) || 1
  );

  const resolve = useMutation({
    mutationFn: (resolution: 'CREDITED' | 'DISCREDITED' | 'DISMISSED') =>
      apiResolveFlag(gameId, flag.id, {
        resolution,
        reason,
        delta,
        metricId: flag.metricId,
      }),
    onSuccess: onDone,
  });

  return (
    <div className='mt-2 space-y-2 border-t border-[var(--color-bark-900)] pt-2'>
      <div className='flex flex-wrap items-end gap-2'>
        <Field label='Amount'>
          <Input
            type='number'
            min={1}
            value={delta}
            onChange={(event) => setDelta(Number(event.target.value))}
          />
        </Field>

        <div className='min-w-48 flex-1'>
          <Field label='Reason (required to move a score)'>
            <TextArea
              rows={2}
              value={reason}
              placeholder='What you checked and what you concluded'
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        </div>
      </div>

      {resolve.isError ? (
        <p className='text-xs text-error'>{(resolve.error as Error).message}</p>
      ) : null}

      <div className='flex flex-wrap gap-2'>
        <Button
          tone='primary'
          disabled={
            resolve.isPending ||
            reason.trim() === '' ||
            !Number.isInteger(delta) ||
            delta <= 0
          }
          onClick={() => resolve.mutate('CREDITED')}
          title='Award this amount as an adjustment'
        >
          Credit {delta}
        </Button>
        <Button
          tone='danger'
          disabled={
            resolve.isPending ||
            reason.trim() === '' ||
            !Number.isInteger(delta) ||
            delta <= 0
          }
          onClick={() => resolve.mutate('DISCREDITED')}
          title='Take this amount away as an adjustment'
        >
          Discredit {delta}
        </Button>
        <Button
          disabled={resolve.isPending}
          onClick={() => resolve.mutate('DISMISSED')}
          title='Nothing was wrong. Changes no score.'
        >
          Dismiss
        </Button>
        <Button
          disabled={resolve.isPending}
          onClick={onDone}
        >
          Cancel review
        </Button>
      </div>
    </div>
  );
};

export default FlagResolver;
