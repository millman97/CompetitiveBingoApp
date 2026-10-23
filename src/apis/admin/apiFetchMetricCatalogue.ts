import type { MetricCatalogue } from '../../model/domain/Metric/Metric';
import { get } from './apiRequest';

const apiFetchMetricCatalogue = (gameId: string) =>
  get<MetricCatalogue>(`/games/${encodeURIComponent(gameId)}/metric-catalogue`);

export default apiFetchMetricCatalogue;
