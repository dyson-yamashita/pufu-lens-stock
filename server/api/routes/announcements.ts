import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../../env';
import { listAnnouncements } from '../../features/announcements/announcements';

export function registerAnnouncementsRoutes(app: Hono<AppEnv>) {
  app.get('/api/v1/announcements', async (c) =>
    c.json({ announcements: await listAnnouncements(c.env) }),
  );

  app.get('/api/v1/announcements/:id', async (c) => {
    const [announcement] = await listAnnouncements(c.env, c.req.param('id'));
    if (!announcement) throw new HTTPException(404);
    return c.json({ announcements: [announcement] });
  });
}
