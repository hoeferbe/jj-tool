import { serve } from '@hono/node-server';
import type { Hono } from 'hono';
import { type AuthStore } from './auth-store.js';
import { type JagdeinrichtungAufgabenStore } from './jagdeinrichtung-aufgaben-store.js';
import { type JagdeinrichtungReservierungenStore } from './jagdeinrichtung-reservierungen-store.js';
import { type JagdeinrichtungStore } from './jagdeinrichtung-store.js';
import { type RevierStore } from './revier-store.js';
import { type StreckeneintragStore } from './streckeneintrag-store.js';
import { type User } from './auth-store.js';

interface BootstrapDependencies {
   app: Hono;
   port: number;
   authStore: AuthStore;
   revierStore: RevierStore;
   jagdeinrichtungStore: JagdeinrichtungStore;
   aufgabenStore: JagdeinrichtungAufgabenStore;
   reservierungenStore: JagdeinrichtungReservierungenStore;
   streckeneintragStore: StreckeneintragStore;
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
      revierStore,
      jagdeinrichtungStore,
      aufgabenStore,
      reservierungenStore,
      streckeneintragStore,
      createPasswordLink,
   } = dependencies;

   await authStore.initialize();
   await revierStore.initialize();
   await jagdeinrichtungStore.initialize();
   await aufgabenStore.initialize();
   await reservierungenStore.initialize();
   await streckeneintragStore.initialize();
   for (const revier of await revierStore.getReviere()) {
      await authStore.ensureRevierOwner(revier.createdBy, revier.id);
   }
   await initializeInitialAdmin(authStore, createPasswordLink);

   serve({ fetch: app.fetch, port }, () => {
      console.log(`API is listening on http://localhost:${port}`);
   });
}
