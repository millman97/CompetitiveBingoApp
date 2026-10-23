import type { GameDetail } from '../../model/domain/Game/Game';
import { get } from './apiRequest';

const apiFetchGame = (gameId: string) =>
  get<GameDetail>(`/games/${encodeURIComponent(gameId)}`);

export default apiFetchGame;
