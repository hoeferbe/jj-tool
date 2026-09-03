import { zValidator } from '@hono/zod-validator';
import type { Hono, MiddlewareHandler } from 'hono';
import { type AuthStore, type User } from '../auth-store.js';
import { type JagdeinrichtungStore } from '../jagdeinrichtung-store.js';
import { type Revier, type RevierStore } from '../revier-store.js';
import type { AuthPayload } from '../middleware/auth.middleware.js';
import { jagdeinrichtungSchema } from '../schemas/jagdeinrichtung.schemas.js';

interface JagdeinrichtungRouteDependencies {
   authStore: AuthStore;
   jagdeinrichtungStore: JagdeinrichtungStore;
   revierStore: RevierStore;
   getAuthenticatedPayload: (context: import('hono').Context) => Promise<AuthPayload | null>;
   requireAuth: MiddlewareHandler;
   canAccessRevier: (user: User, revierId: string) => boolean;
   canCreateJagdeinrichtung: (user: User, revierId: string) => boolean;
   canAdministerRevier: (user: User, revierId: string) => boolean;
   isPointInsideRevier: (revier: Revier, position: { lat: number; lng: number }) => boolean;
}

export function registerJagdeinrichtungRoutes(app: Hono, dependencies: JagdeinrichtungRouteDependencies) {
   const {
      authStore,
      jagdeinrichtungStore,
      revierStore,
      getAuthenticatedPayload,
      requireAuth,
      canAccessRevier,
      canCreateJagdeinrichtung,
      canAdministerRevier,
      isPointInsideRevier,
   } = dependencies;

   app.get('/reviere/:revierId/jagdeinrichtungen', requireAuth, async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('revierId');
      if (!revierId) return context.json({ message: 'Revier-ID fehlt.' }, 400);
      if (!(await revierStore.getReviere()).some((revier) => revier.id === revierId)) {
         return context.json({ message: 'Revier nicht gefunden.' }, 404);
      }
      if (!user || !canAccessRevier(user, revierId)) return context.json({ message: 'Kein Zugriff auf dieses Revier.' }, 403);
      return context.json({ jagdeinrichtungen: await jagdeinrichtungStore.getByRevierId(revierId) });
   });

   app.post('/reviere/:revierId/jagdeinrichtungen', requireAuth, zValidator('json', jagdeinrichtungSchema), async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('revierId');
      if (!revierId) return context.json({ message: 'Revier-ID fehlt.' }, 400);
      if (!(await revierStore.getReviere()).some((revier) => revier.id === revierId)) return context.json({ message: 'Revier nicht gefunden.' }, 404);
      if (!user || !canAccessRevier(user, revierId)) return context.json({ message: 'Kein Zugriff auf dieses Revier.' }, 403);
      if (!canCreateJagdeinrichtung(user, revierId)) return context.json({ message: 'Gäste dürfen keine Jagdeinrichtungen anlegen.' }, 403);
      const input = context.req.valid('json');
      const revier = (await revierStore.getReviere()).find((entry) => entry.id === revierId);
      if (!revier || !isPointInsideRevier(revier, input.position)) return context.json({ message: 'Die Position muss innerhalb der Reviergrenze liegen.' }, 400);
      return context.json({ jagdeinrichtung: await jagdeinrichtungStore.create({ ...input, revierId, createdBy: user.id }) }, 201);
   });

   app.put('/reviere/:revierId/jagdeinrichtungen/:id', requireAuth, zValidator('json', jagdeinrichtungSchema), async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('revierId');
      const id = context.req.param('id');
      if (!revierId || !id) return context.json({ message: 'Revier- oder Einrichtungs-ID fehlt.' }, 400);
      if (!(await revierStore.getReviere()).some((revier) => revier.id === revierId)) return context.json({ message: 'Revier nicht gefunden.' }, 404);
      if (!user || !canAccessRevier(user, revierId)) return context.json({ message: 'Kein Zugriff auf dieses Revier.' }, 403);
      const existing = await jagdeinrichtungStore.getById(id);
      if (!existing || existing.revierId !== revierId) return context.json({ message: 'Jagdeinrichtung nicht gefunden.' }, 404);
      if (existing.createdBy !== user.id && !canAdministerRevier(user, revierId)) return context.json({ message: 'Diese Jagdeinrichtung darf nicht bearbeitet werden.' }, 403);
      const input = context.req.valid('json');
      const revier = (await revierStore.getReviere()).find((entry) => entry.id === revierId);
      if (!revier || !isPointInsideRevier(revier, input.position)) return context.json({ message: 'Die Position muss innerhalb der Reviergrenze liegen.' }, 400);
      return context.json({ jagdeinrichtung: await jagdeinrichtungStore.update(id, { ...input, revierId, createdBy: existing.createdBy }) });
   });
}
