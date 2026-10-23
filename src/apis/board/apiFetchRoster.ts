import type { TeamRoster } from '../../model/domain/Board/BoardState';
import { api } from './apiClient';

const apiFetchRoster = async (gameId: string): Promise<TeamRoster[]> => {
  const response = await api.api.board[':gameId'].teams.$get({
    param: { gameId },
  });

  if (!response.ok) {
    throw new Error('Could not load the teams.');
  }

  return (await response.json()) as TeamRoster[];
};

export default apiFetchRoster;
