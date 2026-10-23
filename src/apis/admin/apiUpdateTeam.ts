import { patch } from './apiRequest';

const apiUpdateTeam = (
  gameId: string,
  teamId: string,
  team: { name: string; colour: string }
) =>
  patch(
    `/games/${encodeURIComponent(gameId)}/teams/${encodeURIComponent(teamId)}`,
    team
  );

export default apiUpdateTeam;
