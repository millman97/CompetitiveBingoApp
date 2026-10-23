import type { PlayerFlags } from '../../model/domain/Review/Review';
import { get } from './apiRequest';

const apiFetchFlags = (gameId: string, showResolved: boolean) =>
  get<PlayerFlags[]>(
    `/games/${encodeURIComponent(gameId)}/flags?resolved=${showResolved}`
  );

export default apiFetchFlags;
