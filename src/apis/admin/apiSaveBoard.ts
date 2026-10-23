import type { AdminTile } from '../../model/domain/Game/Game';
import { put } from './apiRequest';

const apiSaveBoard = (
  gameId: string | null,
  board: { tiles: Pick<AdminTile, 'row' | 'col' | 'label' | 'requirement'>[] }
) => {
  if (gameId === null)
    throw new Error('Create the event before saving its board.');
  return put<{ added: string[]; removed: string[] }>(
    `/games/${encodeURIComponent(gameId)}/tiles`,
    board
  );
};

export default apiSaveBoard;
