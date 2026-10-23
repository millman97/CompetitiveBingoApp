import { post } from './apiRequest';

const apiResolveFlag = (
  gameId: string,
  flagId: string,
  resolution: {
    resolution: 'CREDITED' | 'DISCREDITED' | 'DISMISSED';
    reason: string;
    delta: number;
    metricId: string | null;
  }
) =>
  post(
    `/games/${encodeURIComponent(gameId)}/flags/${encodeURIComponent(flagId)}/resolve`,
    resolution
  );

export default apiResolveFlag;
