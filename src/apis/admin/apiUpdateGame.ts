import type { GameUpdate } from '../../model/domain/Game/Game';
import { patch } from './apiRequest';

const apiUpdateGame = (gameId: string, update: GameUpdate) =>
  patch(`/games/${encodeURIComponent(gameId)}`, update);

export default apiUpdateGame;
