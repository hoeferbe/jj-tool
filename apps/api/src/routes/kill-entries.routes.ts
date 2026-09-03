import { zValidator } from '@hono/zod-validator';
import type { Hono, MiddlewareHandler } from 'hono';
import { type AuthStore, type User } from '../auth-store.js';
import { type KillEntryStore } from '../kill-entry-store.js';
import type { AuthPayload } from '../middleware/auth.middleware.js';
import { killEntrySchema } from '../schemas/kill-entry.schemas.js';

interface KillEntryRouteDependencies {
   authStore: AuthStore;
   killEntryStore: KillEntryStore;
   getAuthenticatedPayload: (context: import('hono').Context) => Promise<AuthPayload | null>;
   requireAuth: MiddlewareHandler;
   canAccessHuntingDistrict: (user: User, revierId: string) => boolean;
}

export function registerKillEntryRoutes(app: Hono, dependencies: KillEntryRouteDependencies) {
   const { authStore, killEntryStore, getAuthenticatedPayload, requireAuth, canAccessHuntingDistrict } = dependencies;

   app.get('/reviere/:revierId/streckeneintraege', requireAuth, async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('revierId');
      if (!revierId || !user || !canAccessHuntingDistrict(user, revierId)) return context.json({ message: 'Kein Zugriff auf dieses Revier.' }, 403);
      return context.json({ streckeneintraege: await killEntryStore.getByHuntingDistrictId(revierId) });
   });

   app.post('/reviere/:revierId/streckeneintraege', requireAuth, zValidator('json', killEntrySchema), async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('revierId');
      if (!revierId || !user || !canAccessHuntingDistrict(user, revierId)) return context.json({ message: 'Kein Zugriff auf dieses Revier.' }, 403);
      const killEntry = await killEntryStore.create({ ...context.req.valid('json'), revierId, createdBy: user.id });
      return context.json({ streckeneintrag: killEntry }, 201);
   });
}
