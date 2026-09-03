import { zValidator } from '@hono/zod-validator';
import type { Hono, MiddlewareHandler } from 'hono';
import { type AuthStore, type User } from '../auth-store.js';
import { type StreckeneintragStore } from '../streckeneintrag-store.js';
import type { AuthPayload } from '../middleware/auth.middleware.js';
import { streckeneintragSchema } from '../schemas/streckeneintrag.schemas.js';

interface StreckeneintragRouteDependencies {
   authStore: AuthStore;
   streckeneintragStore: StreckeneintragStore;
   getAuthenticatedPayload: (context: import('hono').Context) => Promise<AuthPayload | null>;
   requireAuth: MiddlewareHandler;
   canAccessRevier: (user: User, revierId: string) => boolean;
}

export function registerStreckeneintragRoutes(app: Hono, dependencies: StreckeneintragRouteDependencies) {
   const { authStore, streckeneintragStore, getAuthenticatedPayload, requireAuth, canAccessRevier } = dependencies;

   app.get('/reviere/:revierId/streckeneintraege', requireAuth, async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('revierId');
      if (!revierId || !user || !canAccessRevier(user, revierId)) return context.json({ message: 'Kein Zugriff auf dieses Revier.' }, 403);
      return context.json({ streckeneintraege: await streckeneintragStore.getByRevierId(revierId) });
   });

   app.post('/reviere/:revierId/streckeneintraege', requireAuth, zValidator('json', streckeneintragSchema), async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('revierId');
      if (!revierId || !user || !canAccessRevier(user, revierId)) return context.json({ message: 'Kein Zugriff auf dieses Revier.' }, 403);
      const streckeneintrag = await streckeneintragStore.create({ ...context.req.valid('json'), revierId, createdBy: user.id });
      return context.json({ streckeneintrag }, 201);
   });
}
