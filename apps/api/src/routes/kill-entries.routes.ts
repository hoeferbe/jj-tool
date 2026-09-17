import { zValidator } from '@hono/zod-validator';
import type { Hono, MiddlewareHandler } from 'hono';
import { type AuthStore, type User } from '../auth-store.js';
import { type KillEntryStore } from '../kill-entry-store.js';
import { type ImageStore } from '../image-store.js';
import type { AuthPayload } from '../middleware/auth.middleware.js';
import { killEntrySchema, updateKillEntrySchema } from '../schemas/kill-entry.schemas.js';

interface KillEntryRouteDependencies {
   authStore: AuthStore;
   killEntryStore: KillEntryStore;
   imageStore: ImageStore;
   getAuthenticatedPayload: (context: import('hono').Context) => Promise<AuthPayload | null>;
   requireAuth: MiddlewareHandler;
   canAccessHuntingDistrict: (user: User, revierId: string) => boolean;
   canAdministerHuntingDistrict: (user: User, revierId: string) => boolean;
}

/** Registers CRUD endpoints for Streckeneinträge (kill entries) within a hunting district. */
export function registerKillEntryRoutes(app: Hono, dependencies: KillEntryRouteDependencies) {
   const { authStore, killEntryStore, imageStore, getAuthenticatedPayload, requireAuth, canAccessHuntingDistrict, canAdministerHuntingDistrict } = dependencies;
   const withCreatorName = <T extends { createdBy: string }>(entry: T) => ({
      ...entry,
      createdByName: authStore.findUserById(entry.createdBy)?.displayName ?? 'Unbekanntes Mitglied',
   });

   app.get('/reviere/:revierId/streckeneintraege', requireAuth, async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('revierId');
      if (!revierId || !user || !canAccessHuntingDistrict(user, revierId)) return context.json({ message: 'Kein Zugriff auf dieses Revier.' }, 403);
      return context.json({ streckeneintraege: (await killEntryStore.getByHuntingDistrictId(revierId)).map(withCreatorName) });
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
      return context.json({ streckeneintrag: withCreatorName(killEntry) }, 201);
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
      const existing = await killEntryStore.getById(id, revierId);
      if (!existing) return context.json({ message: 'Streckeneintrag nicht gefunden.' }, 404);
      if (existing.createdBy !== user.id && !canAdministerHuntingDistrict(user, revierId)) return context.json({ message: 'Dieser Streckeneintrag darf nicht bearbeitet werden.' }, 403);
      const updated = await killEntryStore.update(id, revierId, context.req.valid('json'));
      return context.json({ streckeneintrag: updated ? withCreatorName(updated) : updated });
   });

   app.delete('/reviere/:revierId/streckeneintraege/:id', requireAuth, async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('revierId');
      const id = context.req.param('id');
      if (!revierId || !id || !user || !canAccessHuntingDistrict(user, revierId)) return context.json({ message: 'Kein Zugriff auf dieses Revier.' }, 403);
      const existing = await killEntryStore.getById(id, revierId);
      if (!existing) return context.json({ message: 'Streckeneintrag nicht gefunden.' }, 404);
      if (existing.createdBy !== user.id && !canAdministerHuntingDistrict(user, revierId)) return context.json({ message: 'Dieser Streckeneintrag darf nicht gelöscht werden.' }, 403);
      await imageStore.deleteByEntity('streckeneintrag', id);
      const deleted = await killEntryStore.delete(id, revierId);
      return context.json({ message: 'Streckeneintrag gelöscht.' });
   });
}
