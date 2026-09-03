import type { Hono } from 'hono';
import { type AuthStore } from '../auth-store.js';
import { type RevierStore } from '../revier-store.js';

export function registerPublicRoutes(app: Hono, dependencies: { authStore: AuthStore; revierStore: RevierStore }) {
   app.get('/health', (context) => context.json({ status: 'ok' }));

   app.get('/public/reviere', async (context) => {
      const reviere = await dependencies.revierStore.getReviere();
      return context.json({
         reviere: reviere.map(({ id, name, municipalityName }) => ({ id, name, municipalityName })),
      });
   });

   app.get('/auth/invitations/:token', async (context) => {
      const invitation = dependencies.authStore.getRevierInvitation(context.req.param('token'));
      if (!invitation) return context.json({ message: 'Einladung ungültig oder abgelaufen.' }, 404);
      const revier = (await dependencies.revierStore.getReviere()).find((entry) => entry.id === invitation.revierId);
      if (!revier) return context.json({ message: 'Das eingeladene Revier existiert nicht mehr.' }, 404);
      return context.json({ invitation: { email: invitation.email, revierId: revier.id, revierName: revier.name } });
   });
}
