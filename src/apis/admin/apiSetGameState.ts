import { post } from './apiRequest';

const apiSetGameState = (gameId: string, state: string) =>
  post(`/games/${encodeURIComponent(gameId)}/state`, { state });

export default apiSetGameState;
