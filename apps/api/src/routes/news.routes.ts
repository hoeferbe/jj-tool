import type { Hono, MiddlewareHandler } from 'hono';
import { type AuthStore } from '../auth-store.js';
import { type FacilityStore } from '../facility-store.js';
import { type FacilityTasksStore } from '../facility-tasks-store.js';
import { type FacilityReservationsStore } from '../facility-reservations-store.js';
import { type HuntingDistrictStore } from '../hunting-district-store.js';
import type { AuthPayload } from '../middleware/auth.middleware.js';
import { buildNewsFeed } from '../news-service.js';

interface NewsRouteDependencies {
   authStore: AuthStore;
   facilityStore: FacilityStore;
   taskStore: FacilityTasksStore;
   reservationStore: FacilityReservationsStore;
   huntingDistrictStore: HuntingDistrictStore;
   getAuthenticatedPayload: (context: import('hono').Context) => Promise<AuthPayload | null>;
   requireAuth: MiddlewareHandler;
}

/** Registers endpoints for fetching the "news since last visit" feed and marking it as seen. */
export function registerNewsRoutes(app: Hono, dependencies: NewsRouteDependencies) {
   const { authStore, facilityStore, taskStore, reservationStore, huntingDistrictStore, getAuthenticatedPayload, requireAuth } = dependencies;

   app.get('/neuigkeiten', requireAuth, async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      if (!user) return context.json({ message: 'Nicht autorisiert.' }, 401);
      const feed = await buildNewsFeed(user, { authStore, facilityStore, taskStore, reservationStore, huntingDistrictStore });
      return context.json(feed);
   });

   app.post('/neuigkeiten/gesehen', requireAuth, async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      if (!user) return context.json({ message: 'Nicht autorisiert.' }, 401);
      const lastNewsSeenAt = await authStore.markNewsSeen(user.id);
      return context.json({ lastNewsSeenAt });
   });
}
