import { useState } from 'react';
import ErrorMessage from '../../error/ErrorMessage';
import type { PublicGameSummary } from '../../model/domain/Game/PublicGame';
import { boardPath, gamePath } from '../../routing/routes';
import {
  EVENT_FILTERS,
  matchesEventFilter,
  orderEvents,
  type EventFilter,
} from '../../utils/events';
import GameIcon from '../GameIcon/GameIcon';
import Panel from '../Panel/Panel';
import StatusBadge from '../StatusBadge/StatusBadge';

const EventList = ({
  events,
  loading,
  error,
  onRetry,
  admin = false,
}: {
  events: readonly (PublicGameSummary & { openFlags?: number })[];
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  admin?: boolean;
}) => {
  const [filter, setFilter] = useState<EventFilter>('all');
  const visible = orderEvents(events).filter((game) =>
    matchesEventFilter(game.state, filter)
  );
  return (
    <Panel
      title='Events'
      className='event-list-panel'
      actions={
        <span>
          {events.length} {events.length === 1 ? 'event' : 'events'}
        </span>
      }
    >
      <div className='list-toolbar'>
        <div
          className='event-filters'
          role='group'
          aria-label='Filter events'
        >
          {EVENT_FILTERS.map((entry) => (
            <button
              key={entry.id}
              type='button'
              aria-pressed={filter === entry.id}
              onClick={() => setFilter(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <span className='text-xs text-parchment-dim'>
          Times shown in your local timezone
        </span>
      </div>
      {loading ? (
        <p
          className='p-6'
          role='status'
        >
          Loading events…
        </p>
      ) : error ? (
        <div className='p-4'>
          <ErrorMessage
            error={error}
            onRetry={onRetry}
          />
        </div>
      ) : visible.length === 0 ? (
        <div className='empty-state'>
          <GameIcon kind='board' />
          <h2 className='text-xl font-bold text-gold'>
            {events.length ? 'No events in this view' : 'No events yet'}
          </h2>
          <p>
            {events.length
              ? 'Try another filter to find your event.'
              : admin
                ? 'Create an event to get started.'
                : 'Your clan’s events will appear here once they are created.'}
          </p>
          {events.length > 0 && (
            <button
              type='button'
              className='game-button'
              onClick={() => setFilter('all')}
            >
              Show all events
            </button>
          )}
        </div>
      ) : (
        <ul className='event-list'>
          {visible.map((game) => (
            <li
              className='event-row'
              key={game.id}
            >
              <div className='event-row-main'>
                <span className='event-emblem'>
                  <GameIcon kind='board' />
                </span>
                <div className='min-w-0'>
                  <div className='event-row-title'>
                    <a href={admin ? gamePath(game.id) : boardPath(game.id)}>
                      {game.name}
                    </a>
                    <StatusBadge state={game.state} />
                  </div>
                  <div className='event-row-meta'>
                    <span>
                      {game.mode.charAt(0) + game.mode.slice(1).toLowerCase()}
                    </span>
                    <span>{game.players} players</span>
                    <span>{game.teams} teams</span>
                    <span>{game.tiles} tiles</span>
                  </div>
                  <p className='event-row-date'>
                    {new Date(game.starts_at).toLocaleString()} →{' '}
                    {new Date(game.ends_at).toLocaleString()}
                  </p>
                  {admin && (game.openFlags ?? 0) > 0 && (
                    <a
                      href={gamePath(game.id, 'flags')}
                      className='mt-2 inline-block text-sm text-gold underline'
                    >
                      {game.openFlags} flags need review
                    </a>
                  )}
                </div>
              </div>
              <div className='event-row-actions'>
                {admin && (
                  <a
                    href={boardPath(game.id)}
                    className='text-parchment-dim underline'
                  >
                    Open board
                  </a>
                )}
                <a
                  href={admin ? gamePath(game.id) : boardPath(game.id)}
                  className='game-button'
                >
                  {admin ? 'Manage event' : 'Open board'}{' '}
                  <span aria-hidden='true'>→</span>
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
};

export default EventList;
