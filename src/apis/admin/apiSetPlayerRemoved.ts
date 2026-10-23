import { post } from './apiRequest';

const apiSetPlayerRemoved = (
  gameId: string,
  playerId: string,
  removed: boolean
) =>
  post(
    `/games/${encodeURIComponent(gameId)}/players/${encodeURIComponent(playerId)}/removal`,
    { removed }
  );

export default apiSetPlayerRemoved;
