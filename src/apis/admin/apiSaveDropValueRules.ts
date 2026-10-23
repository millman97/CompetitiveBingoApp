import type { DropValueRule } from '../../model/domain/Game/Game';
import { put } from './apiRequest';

const apiSaveDropValueRules = (
  gameId: string,
  rules: { rules: DropValueRule[] }
) => put(`/games/${encodeURIComponent(gameId)}/drop-value-rules`, rules);

export default apiSaveDropValueRules;
