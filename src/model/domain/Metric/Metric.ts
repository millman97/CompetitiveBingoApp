export interface MetricCatalogue {
  tracked: { metricId: string; label: string | null }[];
  observed: { metric_id: string; metric_type: string; seen: number }[];
  wildcards: string[];
}
