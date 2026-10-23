import { del } from './apiRequest';

const apiDeleteTeam = (gameId: string, teamId: string) =>
  del(
    `/games/${encodeURIComponent(gameId)}/teams/${encodeURIComponent(teamId)}`
  );

export default apiDeleteTeam;
