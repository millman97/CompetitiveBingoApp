import type { GameSummary } from '../../model/domain/Game/Game';
import { get } from './apiRequest';

const apiFetchGames = () => get<GameSummary[]>('/games');

export default apiFetchGames;
