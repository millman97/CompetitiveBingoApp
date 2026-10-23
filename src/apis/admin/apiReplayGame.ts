import { post } from './apiRequest';

const apiReplayGame = (gameId: string) =>
  post(`/games/${encodeURIComponent(gameId)}/replay`);

export default apiReplayGame;
