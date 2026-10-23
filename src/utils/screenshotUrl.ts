export const screenshotUrl = (gameId: string, eventId: string): string =>
  `/api/board/${encodeURIComponent(gameId)}/screenshots/${encodeURIComponent(eventId)}`;
