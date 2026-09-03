import { zValidator } from '@hono/zod-validator';
import type { Hono, MiddlewareHandler } from 'hono';
import { type AuthStore, type User } from '../auth-store.js';
import { type JagdeinrichtungAufgabenStore } from '../jagdeinrichtung-aufgaben-store.js';
import type { AuthPayload } from '../middleware/auth.middleware.js';
import { type JagdeinrichtungStore } from '../jagdeinrichtung-store.js';
import { aufgabeSchema, aufgabeUpdateSchema } from '../schemas/aufgabe.schemas.js';

interface AufgabenRouteDependencies {
   authStore: AuthStore;
   aufgabenStore: JagdeinrichtungAufgabenStore;
   jagdeinrichtungStore: JagdeinrichtungStore;
   getAuthenticatedPayload: (context: import('hono').Context) => Promise<AuthPayload | null>;
   requireAuth: MiddlewareHandler;
   canAccessRevier: (user: User, revierId: string) => boolean;
   canAdministerRevier: (user: User, revierId: string) => boolean;
   isActiveRevierMember: (userId: string, revierId: string) => boolean;
}

export function registerAufgabenRoutes(app: Hono, dependencies: AufgabenRouteDependencies) {
   const { authStore, aufgabenStore, jagdeinrichtungStore, getAuthenticatedPayload, requireAuth, canAccessRevier, canAdministerRevier, isActiveRevierMember } = dependencies;

   app.get('/reviere/:revierId/jagdeinrichtungs-aufgaben', requireAuth, async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('revierId');
      if (!revierId) return context.json({ message: 'Revier-ID fehlt.' }, 400);
      if (!user || !canAccessRevier(user, revierId)) return context.json({ message: 'Kein Zugriff auf dieses Revier.' }, 403);
      return context.json({ aufgaben: await aufgabenStore.getByRevierId(revierId) });
   });

   app.post('/reviere/:revierId/jagdeinrichtungs-aufgaben', requireAuth, zValidator('json', aufgabeSchema), async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('revierId');
      if (!revierId || !user) return context.json({ message: 'Revier-ID fehlt.' }, 400);
      if (!canAccessRevier(user, revierId)) return context.json({ message: 'Kein Zugriff auf dieses Revier.' }, 403);
      const input = context.req.valid('json');
      const facility = await jagdeinrichtungStore.getById(input.jagdeinrichtungId);
      if (!facility || facility.revierId !== revierId) return context.json({ message: 'Jagdeinrichtung nicht gefunden.' }, 404);
      if (input.assignedTo && !isActiveRevierMember(input.assignedTo, revierId)) return context.json({ message: 'Zugewiesenes Mitglied ist nicht aktiv in diesem Revier.' }, 400);
      return context.json({ aufgabe: await aufgabenStore.create({ ...input, revierId, assignedBy: user.id }) }, 201);
   });

   app.patch('/reviere/:revierId/jagdeinrichtungs-aufgaben/:id', requireAuth, zValidator('json', aufgabeUpdateSchema), async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('revierId');
      const id = context.req.param('id');
      const aufgabe = id ? await aufgabenStore.getById(id) : null;
      if (!revierId || !id || !aufgabe || aufgabe.revierId !== revierId) return context.json({ message: 'Aufgabe nicht gefunden.' }, 404);
      if (!user || !canAccessRevier(user, revierId)) return context.json({ message: 'Kein Zugriff auf dieses Revier.' }, 403);
      const input = context.req.valid('json');
      if (input.assignedTo && !isActiveRevierMember(input.assignedTo, revierId)) return context.json({ message: 'Zugewiesenes Mitglied ist nicht aktiv in diesem Revier.' }, 400);
      if (aufgabe.assignedBy !== user.id && aufgabe.assignedTo !== user.id && !canAdministerRevier(user, revierId)) return context.json({ message: 'Diese Aufgabe darf nicht bearbeitet werden.' }, 403);
      return context.json({ aufgabe: await aufgabenStore.update(id, input) });
   });

   app.post('/reviere/:revierId/jagdeinrichtungs-aufgaben/:id/uebernehmen', requireAuth, async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('revierId');
      const id = context.req.param('id');
      const aufgabe = id ? await aufgabenStore.getById(id) : null;
      if (!revierId || !id || !aufgabe || aufgabe.revierId !== revierId) return context.json({ message: 'Aufgabe nicht gefunden.' }, 404);
      if (!user || !canAccessRevier(user, revierId)) return context.json({ message: 'Kein Zugriff auf dieses Revier.' }, 403);
      if (aufgabe.assignedTo) return context.json({ message: 'Diese Aufgabe ist bereits zugewiesen.' }, 409);
      return context.json({ aufgabe: await aufgabenStore.update(id, { assignedTo: user.id, status: 'in Bearbeitung' }) });
   });
}
