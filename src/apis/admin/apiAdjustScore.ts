import { post } from './apiRequest';

const apiAdjustScore = (
  gameId: string,
  adjustment: {
    playerId: string;
    metricId: string;
    delta: number;
    reason: string;
  }
) => post(`/games/${encodeURIComponent(gameId)}/adjustments`, adjustment);

export default apiAdjustScore;
