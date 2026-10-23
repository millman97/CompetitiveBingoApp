import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import apiFetchFlags from '../../apis/admin/apiFetchFlags';
import ErrorMessage from '../../error/ErrorMessage';
import type { GameDetail } from '../../model/domain/Game/Game';
import { playerName } from '../../utils/format';
import Button from '../Button/Button';
import FlagResolver from '../FlagResolver/FlagResolver';
import Note from '../Note/Note';
import Panel from '../Panel/Panel';

export interface FlagQueueProps {
  gameId: string;
  detail: GameDetail;
}

/** What each flag actually means, in a sentence an organiser can act on. */
const KIND_HELP: Record<string, string> = {
  BACKFILL:
    'More happened than the plugin watched — mobile, another client, or the plugin switched off. Not dishonest on its own.',
  MONOTONIC_DECREASE:
    'A count came in below the one already stored. Nothing was credited for it.',
  IMPLAUSIBLE_RATE:
    'Faster than the per-metric ceiling for this game. The ceiling is generous.',
  CLOCK_SKEW:
    "The player's clock is more than five minutes off. Display only; scoring uses server time.",
  HASH_MISMATCH:
    'The event id did not match a recomputation of it. Detects clumsy editing only, never proof.',
  NOT_READY:
    'This arrived while the client was reporting itself as not set up.',
  IMPLAUSIBLE_DURATION: 'Faster than the per-metric floor for this game.',
  HISCORE_DISCREPANCY:
    'The hiscores and the plugin disagree about this metric.',
  MANUAL_ENTRY:
    'The player typed this in rather than the plugin observing it. Every one is shown here — the plugin vouches for the screenshot and for nothing else.',
};

const FlagQueue = ({ gameId, detail }: FlagQueueProps) => {
  const client = useQueryClient();
  const [showResolved, setShowResolved] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const queue = useQuery({
    queryKey: ['admin', 'flags', gameId, showResolved],
    queryFn: () => apiFetchFlags(gameId, showResolved),
  });

  const refresh = () => {
    setOpen(null);
    void client.invalidateQueries({ queryKey: ['admin', 'flags', gameId] });
  };

  const teamName = (teamId: string | null) =>
    detail.teams.find((team) => team.id === teamId)?.name ?? 'no team';

  const groups = queue.data ?? [];

  return (
    <div className='space-y-3'>
      <Panel
        title={`Flags — ${groups.reduce((total, group) => total + group.flags.length, 0)}`}
        actions={
          <label className='flex items-center gap-1.5 text-[11px] normal-case text-parchment-dim'>
            <input
              type='checkbox'
              checked={showResolved}
              onChange={(event) => setShowResolved(event.target.checked)}
            />
            include resolved
          </label>
        }
      >
        <Note>
          A flag never moved a score by itself. Resolving one is where any
          movement happens, and it is written into the event log as an
          adjustment so a replay still reaches the same board.
        </Note>
      </Panel>

      {queue.isError ? (
        <ErrorMessage
          error={queue.error}
          onRetry={() => void queue.refetch()}
        />
      ) : queue.isLoading ? (
        <Panel>
          <Note>Loading…</Note>
        </Panel>
      ) : groups.length === 0 ? (
        <Panel>
          <Note>Nothing flagged.</Note>
        </Panel>
      ) : (
        groups.map((group) => (
          <Panel
            key={group.playerId}
            title={`${playerName(group.playerName)} — ${teamName(group.teamId)}`}
          >
            <ul className='space-y-2'>
              {group.flags.map((flag) => (
                <li
                  key={flag.id}
                  className='bevel-inset rounded-[3px] p-2'
                >
                  <div className='flex flex-wrap items-start justify-between gap-2'>
                    <div className='min-w-0'>
                      <p className='text-sm font-bold text-gold'>{flag.kind}</p>
                      <p className='text-xs text-parchment-dim'>
                        {KIND_HELP[flag.kind]}
                      </p>

                      <p className='mt-1 text-xs text-parchment'>
                        {flag.metricId ?? 'no metric'}
                        {flag.credited !== null
                          ? ` · credited ${flag.credited}`
                          : ''}
                        {/* A gap forward is backfill; a gap backwards is a count that regressed,
                            and calling that "implied" would read as though it counted. */}
                        {flag.derivedDelta !== null && flag.derivedDelta < 0
                          ? ` · went backwards by ${Math.abs(flag.derivedDelta)}`
                          : flag.derivedDelta !== null &&
                              flag.derivedDelta > (flag.credited ?? 0)
                            ? ` · ${flag.derivedDelta} implied`
                            : ''}
                        {' · '}
                        {new Date(flag.createdAt).toLocaleString()}
                      </p>

                      {flag.kind === 'MANUAL_ENTRY' &&
                      typeof flag.detail['typed'] === 'string' ? (
                        <p className='mt-1 text-xs text-parchment'>
                          Typed:{' '}
                          <span className='stat rounded-[2px] bg-[var(--color-bark-900)] px-1.5 py-0.5 text-gold'>
                            {String(flag.detail['typed'])}
                          </span>
                          {flag.detail['interpretedAs'] === null ? (
                            <span className='text-error'>
                              {' '}
                              — nothing numeric could be read from it
                            </span>
                          ) : (
                            <span className='text-parchment-dim'>
                              {' '}
                              — read as {String(flag.detail['interpretedAs'])}
                            </span>
                          )}
                        </p>
                      ) : null}

                      <details className='mt-1'>
                        <summary className='cursor-pointer text-[11px] text-parchment-dim'>
                          what was recorded
                        </summary>
                        <pre className='mt-1 overflow-x-auto text-[11px] text-parchment-dim'>
                          {JSON.stringify(flag.detail, null, 2)}
                        </pre>
                      </details>
                    </div>

                    {flag.hasScreenshot && flag.eventId !== null ? (
                      <a
                        href={`/api/board/${gameId}/screenshots/${flag.eventId}`}
                        target='_blank'
                        rel='noreferrer'
                        title='The screenshot taken at the moment this was observed'
                      >
                        <img
                          src={`/api/board/${gameId}/screenshots/${flag.eventId}`}
                          alt=''
                          loading='lazy'
                          className='bevel-inset h-20 w-28 rounded-[2px] object-cover'
                        />
                      </a>
                    ) : null}
                  </div>

                  {flag.resolution !== null ? (
                    <p className='mt-1 text-xs text-success'>
                      {flag.resolution.toLowerCase()} by {flag.resolvedBy}
                    </p>
                  ) : open === flag.id ? (
                    <FlagResolver
                      gameId={gameId}
                      flag={flag}
                      onDone={refresh}
                    />
                  ) : (
                    <div className='mt-2'>
                      <Button onClick={() => setOpen(flag.id)}>Review</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        ))
      )}
    </div>
  );
};

export default FlagQueue;
