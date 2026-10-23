// Worker entry point.
//
// One Worker serves the API and the React SPA. Static assets are handled by the platform before
// the Worker runs for anything outside /api/*, per the assets block in wrangler.json.

import { Hono } from 'hono';

import { SCHEMA_VERSION, type Env } from './env';
import { ApiError } from './lib/errors';
import { adminAuthRoutes, adminProtectedRoutes } from './routes/admin';
import { pluginRoutes } from './routes/plugin';
import { boardRoutes } from './routes/board';
import { eventRoutes } from './routes/events';

export { GameRoom } from './do/game-room';

const app = new Hono<{ Bindings: Env }>();

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(err.toBody(), err.status as 400);
  }

  // Anything reaching here is a bug rather than a rejection. It is logged in full, and the
  // player is told something true and useless rather than shown a stack trace.
  console.error('unhandled error', {
    path: c.req.path,
    method: c.req.method,
    error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });

  return c.json(
    {
      error: 'INTERNAL' as const,
      message: 'The bingo server had a problem. Try again in a moment.',
    },
    500,
  );
});

// Liveness only; this does not check database setup or admin credentials.
app.get('/api/health', (c) =>
  c.json({ ok: true as const, schemaVersion: SCHEMA_VERSION }),
);

// Order matters. The public login routes are registered first, so a request to /api/admin/login
// is answered by them and never reaches the session check on the protected router below.
const routes = app
  .route('/api/games', eventRoutes)
  .route('/api/board', boardRoutes)
  .route('/api/plugin', pluginRoutes)
  .route('/api/admin', adminAuthRoutes)
  .route('/api/admin', adminProtectedRoutes);

app.notFound((c) =>
  c.json({ error: 'NOT_FOUND' as const, message: 'No such endpoint.' }, 404),
);

/** Exported so the frontend can derive its client types from the Worker with no codegen step. */
export type AppType = typeof routes;

export default app;
