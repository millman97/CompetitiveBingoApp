import type { AdminAction } from '../../model/domain/Review/Review';
import { get } from './apiRequest';

const apiFetchActions = (gameId: string) =>
  get<AdminAction[]>(`/games/${encodeURIComponent(gameId)}/actions`);

export default apiFetchActions;
