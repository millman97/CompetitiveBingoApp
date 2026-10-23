import type { EvidenceRow } from '../../model/domain/Review/Review';
import { get } from './apiRequest';

const apiFetchEvidence = (gameId: string, query: string) =>
  get<EvidenceRow[]>(
    `/games/${encodeURIComponent(gameId)}/screenshots?${query}`
  );

export default apiFetchEvidence;
