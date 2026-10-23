import { useQuery } from '@tanstack/react-query';
import apiFetchGames from '../../apis/admin/apiFetchGames';
import EventList from '../../components/EventList/EventList';
import useGameDraftStore from '../../stores/useGameDraftStore';

const GamesScreen = () => {
  const { draft, storageError } = useGameDraftStore();
  const games = useQuery({
    queryKey: ['admin', 'games'],
    queryFn: apiFetchGames,
  });
  return (
    <div>
      <div className='page-heading'>
        <div>
          <p className='eyebrow'>Admin</p>
          <h1 className='page-title'>Manage events</h1>
        </div>
        <a
          href='/admin/new'
          className='action-link'
        >
          {draft ? 'Resume draft →' : 'Create an event →'}
        </a>
      </div>
      {draft && (
        <section
          className='draft-banner'
          aria-label='Saved draft'
        >
          <div>
            <strong>{draft.name || 'Untitled event'}</strong>
            <p>Unpublished draft · Saved on this device</p>
          </div>
          <a
            href='/admin/new'
            className='text-sm text-gold underline'
          >
            Continue setup →
          </a>
        </section>
      )}
      {storageError && (
        <p
          role='alert'
          className='mb-4 text-error'
        >
          {storageError}
        </p>
      )}
      <EventList
        admin
        events={games.data ?? []}
        loading={games.isLoading}
        error={games.error}
        onRetry={() => void games.refetch()}
      />
    </div>
  );
};

export default GamesScreen;
