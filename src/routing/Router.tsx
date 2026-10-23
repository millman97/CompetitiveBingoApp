import { lazy, Suspense } from 'react';

import Loading from '../components/Loading/Loading';
import useDocumentTitle from '../hooks/useDocumentTitle';
import BoardScreen from '../screens/BoardScreen/BoardScreen';
import EventsScreen from '../screens/EventsScreen/EventsScreen';
import NotFoundScreen from '../screens/NotFoundScreen/NotFoundScreen';
import { parseRoute } from './routes';

const AdminLayout = lazy(() => import('../components/AdminLayout/AdminLayout'));
const GamesScreen = lazy(() => import('../screens/GamesScreen/GamesScreen'));
const GameSetupScreen = lazy(
  () => import('../screens/GameSetupScreen/GameSetupScreen')
);
const GameScreen = lazy(() => import('../screens/GameScreen/GameScreen'));

// Native links keep browser Back, refresh and leave-page protection consistent.
const Router = () => {
  const route = parseRoute(window.location.pathname);
  useDocumentTitle(
    route.kind === 'setup'
      ? 'Create event'
      : route.kind === 'game'
        ? 'Manage event'
        : route.kind === 'games'
          ? 'Your events'
          : route.kind === 'notFound'
            ? 'Page not found'
            : route.kind === 'login'
              ? 'Sign in'
              : route.kind === 'board'
                ? 'Live board'
                : 'Events'
  );
  if (route.kind === 'events') return <EventsScreen />;
  if (route.kind === 'board') return <BoardScreen gameId={route.gameId} />;
  if (route.kind === 'notFound') return <NotFoundScreen />;

  return (
    <Suspense fallback={<Loading message='Loading admin…' />}>
      <AdminLayout>
        {route.kind === 'game' ? (
          <GameScreen
            gameId={route.gameId}
            tab={route.tab}
          />
        ) : route.kind === 'setup' ? (
          <GameSetupScreen />
        ) : (
          <GamesScreen />
        )}
      </AdminLayout>
    </Suspense>
  );
};

export default Router;
