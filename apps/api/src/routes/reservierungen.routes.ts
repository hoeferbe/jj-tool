import type { Hono, MiddlewareHandler } from 'hono';
import { type AuthStore, type User } from '../auth-store.js';
import { type JagdeinrichtungReservierungenStore } from '../jagdeinrichtung-reservierungen-store.js';
import { type JagdeinrichtungStore } from '../jagdeinrichtung-store.js';
import type { AuthPayload } from '../middleware/auth.middleware.js';

interface ReservierungenRouteDependencies {
   authStore: AuthStore;
   reservierungenStore: JagdeinrichtungReservierungenStore;
   jagdeinrichtungStore: JagdeinrichtungStore;
   getAuthenticatedPayload: (context: import('hono').Context) => Promise<AuthPayload | null>;
   requireAuth: MiddlewareHandler;
   canAccessRevier: (user: User, revierId: string) => boolean;
   canAdministerRevier: (user: User, revierId: string) => boolean;
}

export function registerReservierungenRoutes(app: Hono, dependencies: ReservierungenRouteDependencies) {
   const { authStore, reservierungenStore, jagdeinrichtungStore, getAuthenticatedPayload, requireAuth, canAccessRevier, canAdministerRevier } = dependencies;

   app.get('/reviere/:revierId/jagdeinrichtung-reservierungen', requireAuth, async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('revierId');
      if (!revierId || !user || !canAccessRevier(user, revierId)) return context.json({ message: 'Kein Zugriff auf dieses Revier.' }, 403);
      return context.json({ reservierungen: await reservierungenStore.getActiveByRevierId(revierId) });
   });

   app.post('/reviere/:revierId/jagdeinrichtungen/:id/reservieren', requireAuth, async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('revierId');
      const id = context.req.param('id');
      if (!revierId || !id) return context.json({ message: 'Revier- oder Einrichtungs-ID fehlt.' }, 400);
      if (!user || !canAccessRevier(user, revierId)) return context.json({ message: 'Kein Zugriff auf dieses Revier.' }, 403);
      const facility = await jagdeinrichtungStore.getById(id);
      if (!facility || facility.revierId !== revierId) return context.json({ message: 'Jagdeinrichtung nicht gefunden.' }, 404);
      if (!['Kanzel', 'Bock', 'Leiter'].includes(facility.typ)) return context.json({ message: 'Diese Einrichtung kann nicht reserviert werden.' }, 400);
      try {
         return context.json({ reservierung: await reservierungenStore.reserve({ revierId, jagdeinrichtungId: id, reservedBy: user.id }) }, 201);
      } catch (error) {
         if ((error as Error).message === 'ALREADY_RESERVED') return context.json({ message: 'Diese Einrichtung ist bereits reserviert.' }, 409);
         throw error;
      }
   });

   app.delete('/reviere/:revierId/jagdeinrichtungen/:id/reservieren', requireAuth, async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('revierId');
      const id = context.req.param('id');
      if (!revierId || !id) return context.json({ message: 'Revier- oder Einrichtungs-ID fehlt.' }, 400);
      if (!user || !canAccessRevier(user, revierId)) return context.json({ message: 'Kein Zugriff auf dieses Revier.' }, 403);
      const reservation = await reservierungenStore.getActiveByFacilityId(id);
      if (!reservation || reservation.revierId !== revierId) return context.json({ message: 'Keine aktive Reservierung gefunden.' }, 404);
      if (reservation.reservedBy !== user.id && !canAdministerRevier(user, revierId)) return context.json({ message: 'Diese Reservierung darf nicht freigegeben werden.' }, 403);
      await reservierungenStore.release(id);
      return context.json({ message: 'Reservierung freigegeben.' });
   });
}
