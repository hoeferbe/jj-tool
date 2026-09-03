import { serve } from '@hono/node-server';
import type { Hono } from 'hono';
import { type AuthStore } from './auth-store.js';
import { type FacilityTasksStore } from './facility-tasks-store.js';
import { type FacilityReservationsStore } from './facility-reservations-store.js';
import { type FacilityStore } from './facility-store.js';
import { type HuntingDistrictStore } from './hunting-district-store.js';
import { type KillEntryStore } from './kill-entry-store.js';
import { type User } from './auth-store.js';

interface BootstrapDependencies {
   app: Hono;
   port: number;
   authStore: AuthStore;
   huntingDistrictStore: HuntingDistrictStore;
   facilityStore: FacilityStore;
   taskStore: FacilityTasksStore;
   reservationStore: FacilityReservationsStore;
   killEntryStore: KillEntryStore;
   createPasswordLink: (user: User) => Promise<void>;
}

async function initializeInitialAdmin(authStore: AuthStore, createPasswordLink: (user: User) => Promise<void>) {
   const { INITIAL_ADMIN_USERNAME, INITIAL_ADMIN_EMAIL, INITIAL_ADMIN_NAME } = process.env;
   if (!INITIAL_ADMIN_USERNAME || !INITIAL_ADMIN_EMAIL || !INITIAL_ADMIN_NAME) return;
   if (authStore.findUser(INITIAL_ADMIN_USERNAME)) return;
   const admin = await authStore.createUser({
      username: INITIAL_ADMIN_USERNAME,
      email: INITIAL_ADMIN_EMAIL,
      displayName: INITIAL_ADMIN_NAME,
      accountType: 'systemAdmin',
      status: 'active',
   });
   await createPasswordLink(admin);
}

export async function bootstrapApi(dependencies: BootstrapDependencies) {
   const {
      app,
      port,
      authStore,
      huntingDistrictStore,
      facilityStore,
      taskStore,
      reservationStore,
      killEntryStore,
      createPasswordLink,
   } = dependencies;

   await authStore.initialize();
   await huntingDistrictStore.initialize();
   await facilityStore.initialize();
   await taskStore.initialize();
   await reservationStore.initialize();
   await killEntryStore.initialize();
   for (const district of await huntingDistrictStore.getHuntingDistricts()) {
      await authStore.ensureHuntingDistrictOwner(district.createdBy, district.id);
   }
   await initializeInitialAdmin(authStore, createPasswordLink);

   serve({ fetch: app.fetch, port }, () => {
      console.log(`API is listening on http://localhost:${port}`);
   });
}
