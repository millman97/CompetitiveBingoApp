import { post } from './apiRequest';

const apiGenerateJoinCode = (gameId: string) =>
  post<{ joinCode: string }>(`/games/${encodeURIComponent(gameId)}/join-code`);

export default apiGenerateJoinCode;
