import { post } from './apiRequest';

const apiAssignPlayer = (
  gameId: string,
  playerId: string,
  teamId: string | null
) =>
  post(
    `/games/${encodeURIComponent(gameId)}/players/${encodeURIComponent(playerId)}/team`,
    { teamId }
  );

export default apiAssignPlayer;
