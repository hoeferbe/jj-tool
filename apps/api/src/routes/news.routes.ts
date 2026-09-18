import type { Hono, MiddlewareHandler } from 'hono';
import { type AuthStore, type NewsSection } from '../auth-store.js';
import { type FacilityStore } from '../facility-store.js';
import { type FacilityTasksStore } from '../facility-tasks-store.js';
import { type FacilityReservationsStore } from '../facility-reservations-store.js';
import { type HuntingDistrictStore } from '../hunting-district-store.js';
import { type KillEntryStore } from '../kill-entry-store.js';
import type { AuthPayload } from '../middleware/auth.middleware.js';
import { buildNewsFeed } from '../news-service.js';

interface NewsRouteDependencies {
   authStore: AuthStore;
   facilityStore: FacilityStore;
   taskStore: FacilityTasksStore;
   reservationStore: FacilityReservationsStore;
   huntingDistrictStore: HuntingDistrictStore;
   killEntryStore: KillEntryStore;
   getAuthenticatedPayload: (context: import('hono').Context) => Promise<AuthPayload | null>;
   requireAuth: MiddlewareHandler;
}

const newsSections = new Set<NewsSection>(['karte', 'mitglieder', 'einrichtungen', 'aufgaben', 'strecke']);

/** Registers endpoints for fetching the "news since last visit" feed and marking it as seen. */
export function registerNewsRoutes(app: Hono, dependencies: NewsRouteDependencies) {
   const { authStore, facilityStore, taskStore, reservationStore, huntingDistrictStore, killEntryStore, getAuthenticatedPayload, requireAuth } = dependencies;

   app.get('/neuigkeiten', requireAuth, async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      if (!user) return context.json({ message: 'Nicht autorisiert.' }, 401);
      const feed = await buildNewsFeed(user, { authStore, facilityStore, taskStore, reservationStore, huntingDistrictStore, killEntryStore });
      return context.json(feed);
   });

   app.get('/neuigkeiten/bereiche', requireAuth, async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      if (!user) return context.json({ message: 'Nicht autorisiert.' }, 401);
      return context.json({ gesehenSeit: user.sectionNewsSeenAt ?? {} });
   });

   app.post('/neuigkeiten/gesehen', requireAuth, async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      if (!user) return context.json({ message: 'Nicht autorisiert.' }, 401);
      const lastNewsSeenAt = await authStore.markNewsSeen(user.id);
      return context.json({ lastNewsSeenAt });
   });

   app.post('/neuigkeiten/bereiche/:section/gesehen', requireAuth, async (context) => {
      const section = context.req.param('section');
      if (!newsSections.has(section as NewsSection)) return context.json({ message: 'Unbekannter Neuigkeitenbereich.' }, 400);
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      if (!user) return context.json({ message: 'Nicht autorisiert.' }, 401);
      const seenAt = await authStore.markNewsSectionSeen(user.id, section as NewsSection);
      return context.json({ seenAt });
   });
}
