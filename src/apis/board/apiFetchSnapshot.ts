import type { Snapshot } from '../../model/domain/Board/BoardState';
import { api } from './apiClient';

const apiFetchSnapshot = async (gameId: string): Promise<Snapshot> => {
  const response = await api.api.board[':gameId'].$get({ param: { gameId } });

  if (!response.ok) {
    throw new Error(
      response.status === 404 ? 'No such game.' : 'Could not load the board.'
    );
  }

  return (await response.json()) as Snapshot;
};

export default apiFetchSnapshot;
