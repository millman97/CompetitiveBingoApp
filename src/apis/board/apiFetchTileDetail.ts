import type { TileDetail } from '../../worker/db/activity';
import { api } from './apiClient';

const apiFetchTileDetail = async (
  gameId: string,
  tileId: string
): Promise<TileDetail> => {
  const response = await api.api.board[':gameId'].tiles[':tileId'].$get({
    param: { gameId, tileId },
  });

  if (!response.ok) {
    throw new Error('Could not load that tile.');
  }

  return (await response.json()) as TileDetail;
};

export default apiFetchTileDetail;
