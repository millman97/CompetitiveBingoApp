import { Hono } from 'hono';
import type { Env } from '../env';
import { listPublicGames } from '../db/public-games';

export const eventRoutes = new Hono<{ Bindings: Env }>()
  .get('/', async (c) => c.json(await listPublicGames(c.env.DB)));
