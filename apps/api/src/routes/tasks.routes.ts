import { zValidator } from '@hono/zod-validator';
import type { Hono, MiddlewareHandler } from 'hono';
import { type AuthStore, type User } from '../auth-store.js';
import { type FacilityTasksStore } from '../facility-tasks-store.js';
import type { AuthPayload } from '../middleware/auth.middleware.js';
import { type FacilityStore } from '../facility-store.js';
import { taskSchema, taskUpdateSchema } from '../schemas/task.schemas.js';

interface TaskRouteDependencies {
   authStore: AuthStore;
   taskStore: FacilityTasksStore;
   facilityStore: FacilityStore;
   getAuthenticatedPayload: (context: import('hono').Context) => Promise<AuthPayload | null>;
   requireAuth: MiddlewareHandler;
   canAccessHuntingDistrict: (user: User, revierId: string) => boolean;
   canAdministerHuntingDistrict: (user: User, revierId: string) => boolean;
   isActiveHuntingDistrictMember: (userId: string, revierId: string) => boolean;
}

export function registerTaskRoutes(app: Hono, dependencies: TaskRouteDependencies) {
   const { authStore, taskStore, facilityStore, getAuthenticatedPayload, requireAuth, canAccessHuntingDistrict, canAdministerHuntingDistrict, isActiveHuntingDistrictMember } = dependencies;

   app.get('/reviere/:revierId/jagdeinrichtungs-aufgaben', requireAuth, async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('revierId');
      if (!revierId) return context.json({ message: 'Revier-ID fehlt.' }, 400);
      if (!user || !canAccessHuntingDistrict(user, revierId)) return context.json({ message: 'Kein Zugriff auf dieses Revier.' }, 403);
      return context.json({ aufgaben: await taskStore.getByHuntingDistrictId(revierId) });
   });

   app.post('/reviere/:revierId/jagdeinrichtungs-aufgaben', requireAuth, zValidator('json', taskSchema), async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('revierId');
      if (!revierId || !user) return context.json({ message: 'Revier-ID fehlt.' }, 400);
      if (!canAccessHuntingDistrict(user, revierId)) return context.json({ message: 'Kein Zugriff auf dieses Revier.' }, 403);
      const input = context.req.valid('json');
      const facility = await facilityStore.getById(input.jagdeinrichtungId);
      if (!facility || facility.revierId !== revierId) return context.json({ message: 'Jagdeinrichtung nicht gefunden.' }, 404);
      if (input.assignedTo && !isActiveHuntingDistrictMember(input.assignedTo, revierId)) return context.json({ message: 'Zugewiesenes Mitglied ist nicht aktiv in diesem Revier.' }, 400);
      return context.json({ aufgabe: await taskStore.create({ ...input, revierId, assignedBy: user.id }) }, 201);
   });

   app.patch('/reviere/:revierId/jagdeinrichtungs-aufgaben/:id', requireAuth, zValidator('json', taskUpdateSchema), async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('revierId');
      const id = context.req.param('id');
      const aufgabe = id ? await taskStore.getById(id) : null;
      if (!revierId || !id || !aufgabe || aufgabe.revierId !== revierId) return context.json({ message: 'Aufgabe nicht gefunden.' }, 404);
      if (!user || !canAccessHuntingDistrict(user, revierId)) return context.json({ message: 'Kein Zugriff auf dieses Revier.' }, 403);
      const input = context.req.valid('json');
      if (input.assignedTo && !isActiveHuntingDistrictMember(input.assignedTo, revierId)) return context.json({ message: 'Zugewiesenes Mitglied ist nicht aktiv in diesem Revier.' }, 400);
      if (aufgabe.assignedBy !== user.id && aufgabe.assignedTo !== user.id && !canAdministerHuntingDistrict(user, revierId)) return context.json({ message: 'Diese Aufgabe darf nicht bearbeitet werden.' }, 403);
      return context.json({ aufgabe: await taskStore.update(id, input) });
   });

   app.post('/reviere/:revierId/jagdeinrichtungs-aufgaben/:id/uebernehmen', requireAuth, async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('revierId');
      const id = context.req.param('id');
      const aufgabe = id ? await taskStore.getById(id) : null;
      if (!revierId || !id || !aufgabe || aufgabe.revierId !== revierId) return context.json({ message: 'Aufgabe nicht gefunden.' }, 404);
      if (!user || !canAccessHuntingDistrict(user, revierId)) return context.json({ message: 'Kein Zugriff auf dieses Revier.' }, 403);
      if (aufgabe.assignedTo) return context.json({ message: 'Diese Aufgabe ist bereits zugewiesen.' }, 409);
      return context.json({ aufgabe: await taskStore.update(id, { assignedTo: user.id, status: 'in Bearbeitung' }) });
   });
}
