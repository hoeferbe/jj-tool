import type { Hono, MiddlewareHandler } from 'hono';
import { type AuthStore, type User } from '../auth-store.js';
import { type FacilityReservationsStore } from '../facility-reservations-store.js';
import { type FacilityStore } from '../facility-store.js';
import type { AuthPayload } from '../middleware/auth.middleware.js';

interface ReservationRouteDependencies {
   authStore: AuthStore;
   reservationStore: FacilityReservationsStore;
   facilityStore: FacilityStore;
   getAuthenticatedPayload: (context: import('hono').Context) => Promise<AuthPayload | null>;
   requireAuth: MiddlewareHandler;
   canAccessHuntingDistrict: (user: User, revierId: string) => boolean;
   canAdministerHuntingDistrict: (user: User, revierId: string) => boolean;
}

export function registerReservationRoutes(app: Hono, dependencies: ReservationRouteDependencies) {
   const { authStore, reservationStore, facilityStore, getAuthenticatedPayload, requireAuth, canAccessHuntingDistrict, canAdministerHuntingDistrict } = dependencies;

   app.get('/reviere/:revierId/jagdeinrichtung-reservierungen', requireAuth, async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('revierId');
      if (!revierId || !user || !canAccessHuntingDistrict(user, revierId)) return context.json({ message: 'Kein Zugriff auf dieses Revier.' }, 403);
      return context.json({ reservierungen: await reservationStore.getActiveByHuntingDistrictId(revierId) });
   });

   app.post('/reviere/:revierId/jagdeinrichtungen/:id/reservieren', requireAuth, async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('revierId');
      const id = context.req.param('id');
      if (!revierId || !id) return context.json({ message: 'Revier- oder Einrichtungs-ID fehlt.' }, 400);
      if (!user || !canAccessHuntingDistrict(user, revierId)) return context.json({ message: 'Kein Zugriff auf dieses Revier.' }, 403);
      const facility = await facilityStore.getById(id);
      if (!facility || facility.revierId !== revierId) return context.json({ message: 'Jagdeinrichtung nicht gefunden.' }, 404);
      if (!['Kanzel', 'Bock', 'Leiter'].includes(facility.typ)) return context.json({ message: 'Diese Einrichtung kann nicht reserviert werden.' }, 400);
      try {
         return context.json({ reservierung: await reservationStore.reserve({ revierId, jagdeinrichtungId: id, reservedBy: user.id }) }, 201);
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
      if (!user || !canAccessHuntingDistrict(user, revierId)) return context.json({ message: 'Kein Zugriff auf dieses Revier.' }, 403);
      const reservation = await reservationStore.getActiveByFacilityId(id);
      if (!reservation || reservation.revierId !== revierId) return context.json({ message: 'Keine aktive Reservierung gefunden.' }, 404);
      if (reservation.reservedBy !== user.id && !canAdministerHuntingDistrict(user, revierId)) return context.json({ message: 'Diese Reservierung darf nicht freigegeben werden.' }, 403);
      await reservationStore.release(id);
      return context.json({ message: 'Reservierung freigegeben.' });
   });
}
