import type { AdminPlayer } from '../../model/domain/Player/Player';
import { get } from './apiRequest';

const apiFetchRoster = (gameId: string) =>
  get<{ players: AdminPlayer[]; metricsChangedAt: number | null }>(
    `/games/${encodeURIComponent(gameId)}/roster`
  );

export default apiFetchRoster;
