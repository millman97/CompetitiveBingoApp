export interface FlagView {
  id: string;
  kind: string;
  detail: Record<string, unknown>;
  createdAt: number;
  eventId: string | null;
  hasScreenshot: boolean;
  credited: number | null;
  derivedDelta: number | null;
  metricId: string | null;
  resolution: string | null;
  resolvedBy: string | null;
  resolvedAt: number | null;
}

export interface AdminAction {
  id: string;
  actor: string;
  action: string;
  detail: unknown;
  at: number;
}

export interface PlayerFlags {
  playerId: string;
  playerName: string;
  teamId: string | null;
  flags: FlagView[];
}

export interface EvidenceRow {
  event_id: string;
  metric_id: string;
  received_at: number;
  display_name: string;
  team_id: string | null;
}
