import type { ActivityPage } from '../../worker/db/activity';

/**
 * The feed page.
 *
 * Built by hand rather than through the RPC client: `before` is a plain query string the route
 * reads directly, and Hono only types query parameters that go through a validator. The response
 * type still comes from the server.
 */
const apiFetchActivity = async (
  gameId: string,
  before: string | null
): Promise<ActivityPage> => {
  const url = new URL(
    `/api/board/${encodeURIComponent(gameId)}/activity`,
    window.location.origin
  );
  url.searchParams.set('limit', '30');
  if (before !== null) {
    url.searchParams.set('before', before);
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Could not load the activity feed.');
  }

  return (await response.json()) as ActivityPage;
};

export default apiFetchActivity;
