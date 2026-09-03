import { zValidator } from '@hono/zod-validator';
import type { Hono, MiddlewareHandler } from 'hono';
import { type AuthStore, type User } from '../auth-store.js';
import { type FacilityStore } from '../facility-store.js';
import { type HuntingDistrict, type HuntingDistrictStore } from '../hunting-district-store.js';
import type { AuthPayload } from '../middleware/auth.middleware.js';
import { facilitySchema } from '../schemas/facility.schemas.js';

interface FacilityRouteDependencies {
   authStore: AuthStore;
   facilityStore: FacilityStore;
   huntingDistrictStore: HuntingDistrictStore;
   getAuthenticatedPayload: (context: import('hono').Context) => Promise<AuthPayload | null>;
   requireAuth: MiddlewareHandler;
   canAccessHuntingDistrict: (user: User, revierId: string) => boolean;
   canCreateFacility: (user: User, revierId: string) => boolean;
   canAdministerHuntingDistrict: (user: User, revierId: string) => boolean;
   isPointInsideHuntingDistrict: (revier: HuntingDistrict, position: { lat: number; lng: number }) => boolean;
}

export function registerFacilityRoutes(app: Hono, dependencies: FacilityRouteDependencies) {
   const {
      authStore,
      facilityStore,
      huntingDistrictStore,
      getAuthenticatedPayload,
      requireAuth,
      canAccessHuntingDistrict,
      canCreateFacility,
      canAdministerHuntingDistrict,
      isPointInsideHuntingDistrict,
   } = dependencies;

   app.get('/reviere/:revierId/jagdeinrichtungen', requireAuth, async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('revierId');
      if (!revierId) return context.json({ message: 'Revier-ID fehlt.' }, 400);
      if (!(await huntingDistrictStore.getHuntingDistricts()).some((district) => district.id === revierId)) {
         return context.json({ message: 'Revier nicht gefunden.' }, 404);
      }
      if (!user || !canAccessHuntingDistrict(user, revierId)) return context.json({ message: 'Kein Zugriff auf dieses Revier.' }, 403);
      return context.json({ jagdeinrichtungen: await facilityStore.getByHuntingDistrictId(revierId) });
   });

   app.post('/reviere/:revierId/jagdeinrichtungen', requireAuth, zValidator('json', facilitySchema), async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('revierId');
      if (!revierId) return context.json({ message: 'Revier-ID fehlt.' }, 400);
      if (!(await huntingDistrictStore.getHuntingDistricts()).some((district) => district.id === revierId)) return context.json({ message: 'Revier nicht gefunden.' }, 404);
      if (!user || !canAccessHuntingDistrict(user, revierId)) return context.json({ message: 'Kein Zugriff auf dieses Revier.' }, 403);
      if (!canCreateFacility(user, revierId)) return context.json({ message: 'Gäste dürfen keine Jagdeinrichtungen anlegen.' }, 403);
      const input = context.req.valid('json');
      const district = (await huntingDistrictStore.getHuntingDistricts()).find((entry) => entry.id === revierId);
      if (!district || !isPointInsideHuntingDistrict(district, input.position)) return context.json({ message: 'Die Position muss innerhalb der Reviergrenze liegen.' }, 400);
      return context.json({ jagdeinrichtung: await facilityStore.create({ ...input, revierId, createdBy: user.id }) }, 201);
   });

   app.put('/reviere/:revierId/jagdeinrichtungen/:id', requireAuth, zValidator('json', facilitySchema), async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('revierId');
      const id = context.req.param('id');
      if (!revierId || !id) return context.json({ message: 'Revier- oder Einrichtungs-ID fehlt.' }, 400);
      if (!(await huntingDistrictStore.getHuntingDistricts()).some((district) => district.id === revierId)) return context.json({ message: 'Revier nicht gefunden.' }, 404);
      if (!user || !canAccessHuntingDistrict(user, revierId)) return context.json({ message: 'Kein Zugriff auf dieses Revier.' }, 403);
      const existing = await facilityStore.getById(id);
      if (!existing || existing.revierId !== revierId) return context.json({ message: 'Jagdeinrichtung nicht gefunden.' }, 404);
      if (existing.createdBy !== user.id && !canAdministerHuntingDistrict(user, revierId)) return context.json({ message: 'Diese Jagdeinrichtung darf nicht bearbeitet werden.' }, 403);
      const input = context.req.valid('json');
      const district = (await huntingDistrictStore.getHuntingDistricts()).find((entry) => entry.id === revierId);
      if (!district || !isPointInsideHuntingDistrict(district, input.position)) return context.json({ message: 'Die Position muss innerhalb der Reviergrenze liegen.' }, 400);
      return context.json({ jagdeinrichtung: await facilityStore.update(id, { ...input, revierId, createdBy: existing.createdBy }) });
   });
}
