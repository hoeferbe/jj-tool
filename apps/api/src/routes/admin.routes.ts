import { zValidator } from '@hono/zod-validator';
import type { Hono, MiddlewareHandler } from 'hono';
import { type AuthStore, type User } from '../auth-store.js';
import type { AuthPayload } from '../middleware/auth.middleware.js';
import { type RevierStore } from '../revier-store.js';
import { approveSchema, membershipSchema, updateRoleSchema, updateUserStatusSchema } from '../schemas/auth.schemas.js';
import { invitationSchema } from '../schemas/revier.schemas.js';

interface AdminRouteDependencies {
   authStore: AuthStore;
   revierStore: RevierStore;
   appOrigin: string;
   getAuthenticatedPayload: (context: import('hono').Context) => Promise<AuthPayload | null>;
   requireAdmin: MiddlewareHandler;
   requireSystemAdmin: MiddlewareHandler;
   canAdministerRevier: (user: User, revierId: string) => boolean;
   hasOnlyExistingReviere: (revierIds: string[] | undefined) => Promise<boolean>;
   createPasswordLink: (user: User) => Promise<void>;
   sendRevierInvitation: (input: { email: string; revierName: string; inviterName: string; invitationLink: string }) => Promise<void>;
}

export function registerAdminRoutes(app: Hono, dependencies: AdminRouteDependencies) {
   const { authStore, revierStore, appOrigin, getAuthenticatedPayload, requireAdmin, requireSystemAdmin, canAdministerRevier, hasOnlyExistingReviere, createPasswordLink, sendRevierInvitation } = dependencies;

   app.get('/admin/users', requireAdmin, (context) => {
      context.header('Cache-Control', 'no-store');
      return getAuthenticatedPayload(context).then((payload) => context.json({ users: payload?.sub ? authStore.getUsersForAdmin(payload.sub) : [] }));
   });

   app.post('/reviere/:id/invitations', requireAdmin, zValidator('json', invitationSchema), async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const administrator = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('id');
      if (!administrator || !canAdministerRevier(administrator, revierId)) return context.json({ message: 'Für dieses Revier dürfen keine Einladungen versendet werden.' }, 403);
      const revier = (await revierStore.getReviere()).find((entry) => entry.id === revierId);
      if (!revier) return context.json({ message: 'Revier nicht gefunden.' }, 404);
      const { email } = context.req.valid('json');
      const token = await authStore.createRevierInvitation(revier.id, email, administrator.id);
      await sendRevierInvitation({ email, revierName: revier.name, inviterName: administrator.displayName, invitationLink: `${appOrigin}/?invite=${encodeURIComponent(token)}` });
      return context.json({ message: 'Einladung wurde versendet.' }, 201);
   });

   app.post('/admin/users/:id/approve', requireSystemAdmin, zValidator('json', approveSchema), async (context) => {
      const userId = context.req.param('id') ?? '';
      const { role, position, isAdmin, revierIds } = context.req.valid('json');
      try {
         const target = authStore.findUserById(userId);
         if (target?.accountType === 'systemAdmin' && role !== 'admin' && authStore.countActiveSystemAdmins() <= 1) return context.json({ message: 'Der letzte Systemadministrator kann nicht herabgestuft werden.' }, 409);
         if (!(await hasOnlyExistingReviere(revierIds))) return context.json({ message: 'Mindestens ein Revier ist nicht mehr vorhanden.' }, 400);
         const user = await authStore.approveUser(userId, role, position, isAdmin, revierIds);
         await createPasswordLink(user);
         return context.json({ message: 'Benutzer freigeschaltet. Ein Passwort-Link wurde versendet.' });
      } catch (error) {
         if ((error as Error).message === 'USER_NOT_FOUND') return context.json({ message: 'Benutzer nicht gefunden.' }, 404);
         throw error;
      }
   });

   app.delete('/admin/users/:id', requireSystemAdmin, async (context) => {
      const userId = context.req.param('id') ?? '';
      const payload = await getAuthenticatedPayload(context);
      if (payload?.sub === userId) return context.json({ message: 'Das eigene Administratorkonto kann nicht gelöscht werden.' }, 400);
      try {
         await authStore.deleteUser(userId);
         return context.json({ message: 'Registrierung abgelehnt.' });
      } catch (error) {
         if ((error as Error).message === 'USER_NOT_FOUND') return context.json({ message: 'Benutzer nicht gefunden.' }, 404);
         throw error;
      }
   });

   app.patch('/admin/users/:id/status', requireSystemAdmin, zValidator('json', updateUserStatusSchema), async (context) => {
      const userId = context.req.param('id') ?? '';
      const payload = await getAuthenticatedPayload(context);
      if (payload?.sub === userId) return context.json({ message: 'Das eigene Administratorkonto kann nicht gesperrt werden.' }, 400);
      try {
         const user = await authStore.setUserBlocked(userId, context.req.valid('json').blocked);
         return context.json({ user });
      } catch (error) {
         if ((error as Error).message === 'USER_NOT_FOUND') return context.json({ message: 'Benutzer nicht gefunden.' }, 404);
         if ((error as Error).message === 'USER_NOT_ACTIVE') return context.json({ message: 'Ausstehende Registrierungen können nicht gesperrt werden.' }, 400);
         throw error;
      }
   });

   app.patch('/admin/users/:id', requireSystemAdmin, zValidator('json', updateRoleSchema), async (context) => {
      const userId = context.req.param('id') ?? '';
      const { role, position, isAdmin, revierIds } = context.req.valid('json');
      try {
         if (!(await hasOnlyExistingReviere(revierIds))) return context.json({ message: 'Mindestens ein Revier ist nicht mehr vorhanden.' }, 400);
         const user = await authStore.updateUserRoleAndPosition(userId, role, position, isAdmin, revierIds);
         return context.json({ user });
      } catch (error) {
         if ((error as Error).message === 'USER_NOT_FOUND') return context.json({ message: 'Benutzer nicht gefunden.' }, 404);
         throw error;
      }
   });

   app.put('/reviere/:revierId/members/:userId', requireAdmin, zValidator('json', membershipSchema), async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const administrator = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('revierId');
      const userId = context.req.param('userId');
      if (!administrator || !canAdministerRevier(administrator, revierId)) return context.json({ message: 'Diese Mitgliedschaft darf nicht administriert werden.' }, 403);
      try {
         const targetWasPending = authStore.findUserById(userId)?.status === 'pending';
         const membership = await authStore.upsertMembership(userId, { revierId, ...context.req.valid('json') });
         const target = authStore.findUserById(userId);
         if (targetWasPending && membership.status === 'active' && target) await createPasswordLink(target);
         return context.json({ membership });
      } catch (error) {
         if ((error as Error).message === 'USER_NOT_FOUND') return context.json({ message: 'Benutzer nicht gefunden.' }, 404);
         if ((error as Error).message === 'LAST_REVIER_ADMIN') return context.json({ message: 'Zuerst muss ein anderes Mitglied zum Revieradmin ernannt werden.' }, 409);
         return context.json({ message: 'Mitgliedschaft konnte nicht gespeichert werden.' }, 400);
      }
   });

   app.delete('/reviere/:revierId/members/:userId', requireAdmin, async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const administrator = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('revierId');
      const userId = context.req.param('userId');
      if (!revierId || !userId) return context.json({ message: 'Revier- oder Benutzer-ID fehlt.' }, 400);
      if (!administrator || !canAdministerRevier(administrator, revierId)) return context.json({ message: 'Diese Mitgliedschaft darf nicht administriert werden.' }, 403);
      try {
         await authStore.removeMembership(userId, revierId);
         return context.json({ message: 'Mitgliedschaft entfernt.' });
      } catch (error) {
         if ((error as Error).message === 'LAST_REVIER_ADMIN') return context.json({ message: 'Zuerst muss ein anderes Mitglied zum Revieradmin ernannt werden.' }, 409);
         return context.json({ message: 'Mitgliedschaft nicht gefunden.' }, 404);
      }
   });
}
