import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import apiFetchActions from '../../apis/admin/apiFetchActions';
import apiReplayGame from '../../apis/admin/apiReplayGame';
import ErrorMessage from '../../error/ErrorMessage';
import Button from '../Button/Button';
import Confirm from '../Confirm/Confirm';
import Note from '../Note/Note';
import Panel from '../Panel/Panel';

const ActionLog = ({ gameId }: { gameId: string }) => {
  const client = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const replay = useMutation({
    mutationFn: () => apiReplayGame(gameId),
    onSuccess: () => {
      setConfirming(false);
      void client.invalidateQueries({ queryKey: ['admin'] });
    },
  });
  const log = useQuery({
    queryKey: ['admin', 'actions', gameId],
    queryFn: () => apiFetchActions(gameId),
  });

  return (
    <Panel title='Admin log'>
      <Note>Every decision that moved a score, and who made it.</Note>
      <details className='my-4 space-y-3'>
        <summary className='cursor-pointer text-sm text-gold'>
          Maintenance
        </summary>
        <p className='text-sm text-parchment-dim'>
          Rebuild all scores from the stored event history after resolving a
          scoring issue.
        </p>
        <Button
          onClick={() => setConfirming(true)}
          disabled={replay.isPending}
        >
          Rebuild scores
        </Button>
        {replay.isSuccess && (
          <p
            role='status'
            className='text-success'
          >
            Scores rebuilt.
          </p>
        )}
      </details>
      {confirming && (
        <Confirm
          title='Rebuild every score?'
          body='This recomputes the board from the event history and current team assignments. It may change tile ownership and the result. Stored events and review decisions are kept.'
          confirmLabel='Rebuild scores'
          pending={replay.isPending}
          error={replay.error?.message}
          onConfirm={() => replay.mutate()}
          onCancel={() => setConfirming(false)}
        />
      )}

      {log.isError ? (
        <ErrorMessage
          error={log.error}
          onRetry={() => void log.refetch()}
        />
      ) : log.isLoading ? (
        <p role='status'>Loading history…</p>
      ) : (
        <ul className='mt-2 divide-y divide-[var(--color-bark-900)] text-xs'>
          {(log.data ?? []).map((entry) => (
            <li
              key={entry.id}
              className='py-1.5'
            >
              <span className='font-bold text-gold'>{entry.action}</span>
              <span className='text-parchment-dim'>
                {' '}
                · {entry.actor} · {new Date(entry.at).toLocaleString()}
              </span>
              <pre className='overflow-x-auto text-[11px] text-parchment-dim'>
                {JSON.stringify(entry.detail)}
              </pre>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
};

export default ActionLog;
