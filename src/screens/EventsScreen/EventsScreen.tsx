import { useQuery } from '@tanstack/react-query';
import apiFetchPublicGames from '../../apis/board/apiFetchPublicGames';
import EventList from '../../components/EventList/EventList';
import PublicLayout from '../../components/PublicLayout/PublicLayout';

const EventsScreen = () => {
  const events = useQuery({
    queryKey: ['events'],
    queryFn: apiFetchPublicGames,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  return (
    <PublicLayout>
      <div className='page-heading'>
        <div>
          <h1 className='page-title'>Events</h1>
          <p className='page-description'>Your clan’s bingo events.</p>
        </div>
      </div>
      <EventList
        events={events.data ?? []}
        loading={events.isLoading}
        error={events.error}
        onRetry={() => void events.refetch()}
      />
    </PublicLayout>
  );
};

export default EventsScreen;
