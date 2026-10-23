import { post } from './apiRequest';

const apiAddTeam = (gameId: string, team: { name: string; colour: string }) =>
  post(`/games/${encodeURIComponent(gameId)}/teams`, team);

export default apiAddTeam;
