import { zValidator } from '@hono/zod-validator';
import type { Hono, MiddlewareHandler } from 'hono';
import { type AuthStore, type User } from '../auth-store.js';
import { type KillEntryStore } from '../kill-entry-store.js';
import type { AuthPayload } from '../middleware/auth.middleware.js';
import { killEntrySchema, updateKillEntrySchema } from '../schemas/kill-entry.schemas.js';

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

   app.post('/reviere/:revierId/streckeneintraege', requireAuth, zValidator('json', killEntrySchema, (result, context) => {
      if (!result.success) {
         const message = result.error.issues[0]?.message ?? 'Ungültige Eingabedaten.';
         return context.json({ message }, 400);
      }
   }), async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('revierId');
      if (!revierId || !user || !canAccessHuntingDistrict(user, revierId)) return context.json({ message: 'Kein Zugriff auf dieses Revier.' }, 403);
      const killEntry = await killEntryStore.create({ ...context.req.valid('json'), revierId, createdBy: user.id });
      return context.json({ streckeneintrag: killEntry }, 201);
   });

   app.put('/reviere/:revierId/streckeneintraege/:id', requireAuth, zValidator('json', updateKillEntrySchema, (result, context) => {
      if (!result.success) {
         const message = result.error.issues[0]?.message ?? 'Ungültige Eingabedaten.';
         return context.json({ message }, 400);
      }
   }), async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('revierId');
      const id = context.req.param('id');
      if (!revierId || !id || !user || !canAccessHuntingDistrict(user, revierId)) return context.json({ message: 'Kein Zugriff auf dieses Revier.' }, 403);
      const updated = await killEntryStore.update(id, revierId, context.req.valid('json'));
      if (!updated) return context.json({ message: 'Streckeneintrag nicht gefunden.' }, 404);
      return context.json({ streckeneintrag: updated });
   });

   app.delete('/reviere/:revierId/streckeneintraege/:id', requireAuth, async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('revierId');
      const id = context.req.param('id');
      if (!revierId || !id || !user || !canAccessHuntingDistrict(user, revierId)) return context.json({ message: 'Kein Zugriff auf dieses Revier.' }, 403);
      const deleted = await killEntryStore.delete(id, revierId);
      if (!deleted) return context.json({ message: 'Streckeneintrag nicht gefunden.' }, 404);
      return context.json({ message: 'Streckeneintrag gelöscht.' });
   });
}
