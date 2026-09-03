import type { Hono } from 'hono';
import { type AuthStore } from '../auth-store.js';
import { type HuntingDistrictStore } from '../hunting-district-store.js';

export function registerPublicRoutes(app: Hono, dependencies: { authStore: AuthStore; huntingDistrictStore: HuntingDistrictStore }) {
   app.get('/health', (context) => context.json({ status: 'ok' }));

   app.get('/public/reviere', async (context) => {
      const districts = await dependencies.huntingDistrictStore.getHuntingDistricts();
      return context.json({
         reviere: districts.map(({ id, name, municipalityName }) => ({ id, name, municipalityName })),
      });
   });

   app.get('/auth/invitations/:token', async (context) => {
      const invitation = dependencies.authStore.getHuntingDistrictInvitation(context.req.param('token'));
      if (!invitation) return context.json({ message: 'Einladung ungültig oder abgelaufen.' }, 404);
      const revier = (await dependencies.huntingDistrictStore.getHuntingDistricts()).find((entry) => entry.id === invitation.revierId);
      if (!revier) return context.json({ message: 'Das eingeladene Revier existiert nicht mehr.' }, 404);
      return context.json({ invitation: { email: invitation.email, revierId: revier.id, revierName: revier.name } });
   });
}
