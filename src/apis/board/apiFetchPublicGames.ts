import type { PublicGameSummary } from '../../model/domain/Game/PublicGame';
import { api } from './apiClient';

const apiFetchPublicGames = async (): Promise<PublicGameSummary[]> => {
  const response = await api.api.games.$get();
  if (!response.ok) throw new Error('Could not load the events.');
  return response.json();
};

export default apiFetchPublicGames;
