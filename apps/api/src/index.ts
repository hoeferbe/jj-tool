import { config } from 'dotenv';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { fileURLToPath } from 'node:url';
import { AuthStore } from './auth-store.js';
import { FacilityStore } from './facility-store.js';
import { FacilityTasksStore } from './facility-tasks-store.js';
import { FacilityReservationsStore } from './facility-reservations-store.js';
import { sendRegistrationNotification, sendHuntingDistrictInvitation } from './mailer.js';
import { HuntingDistrictStore } from './hunting-district-store.js';
import { KillEntryStore } from './kill-entry-store.js';
import { createAuthMiddleware } from './middleware/auth.middleware.js';
import { createAuthHelpers } from './helpers/auth.helpers.js';
import { createHuntingDistrictHelpers } from './helpers/hunting-district.helpers.js';
import { registerPublicRoutes } from './routes/public.routes.js';
import { registerAuthRoutes } from './routes/auth.routes.js';
import { registerFacilityRoutes } from './routes/facilities.routes.js';
import { registerTaskRoutes } from './routes/tasks.routes.js';
import { registerReservationRoutes } from './routes/reservations.routes.js';
import { registerKillEntryRoutes } from './routes/kill-entries.routes.js';
import { registerAdminRoutes } from './routes/admin.routes.js';
import { registerHuntingDistrictRoutes } from './routes/hunting-districts.routes.js';
import { bootstrapApi } from './bootstrap.js';

// Load .env from the api package root.
config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const app = new Hono();
const dataDirectory = process.env.DATA_DIRECTORY ?? './data';
const appOrigin = process.env.APP_ORIGIN ?? 'http://127.0.0.1:5173';
const authStore = new AuthStore(dataDirectory);
const huntingDistrictStore = new HuntingDistrictStore(dataDirectory);
const facilityStore = new FacilityStore(dataDirectory);
const taskStore = new FacilityTasksStore(dataDirectory);
const reservationStore = new FacilityReservationsStore(dataDirectory);
const killEntryStore = new KillEntryStore(dataDirectory);
// Encode the secret once so every JWT sign/verify reuses the same Uint8Array.
const authSecret = new TextEncoder().encode(
   process.env.AUTH_SECRET ?? 'development-only-secret-change-me',
);
const { getAuthenticatedPayload, requireAuth, requireAdmin, requireSystemAdmin } = createAuthMiddleware({
   authStore,
   authSecret,
});
const { hasOnlyExistingHuntingDistricts, createPasswordLink } = createAuthHelpers({
   authStore,
   huntingDistrictStore,
   appOrigin,
});
const {
   canAdministerHuntingDistrict,
   canAccessHuntingDistrict,
   canCreateFacility,
   isPointInsideHuntingDistrict,
   isActiveHuntingDistrictMember,
} = createHuntingDistrictHelpers({ authStore, facilityStore });
// Accept requests from the configured app origin and common local dev addresses.
const allowedOrigins = new Set([
   appOrigin,
   'http://localhost:5173',
   'http://127.0.0.1:5173',
]);

// --- CORS -------------------------------------------------------------------
app.use(
   '*',
   cors({
      origin: (origin) => {
         if (!origin) return '';
         if (allowedOrigins.has(origin)) return origin;
         if (/^http:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}):\d{4,5}$/.test(origin)) {
            return origin;
         }
         return '';
      },
      credentials: true,
   }),
);

registerPublicRoutes(app, { authStore, huntingDistrictStore });

registerAuthRoutes(app, {
   authStore,
   huntingDistrictStore,
   authSecret,
   getAuthenticatedPayload,
   requireAuth,
   createPasswordLink,
   sendRegistrationNotification,
});
registerFacilityRoutes(app, {
   authStore,
   facilityStore,
   huntingDistrictStore,
   getAuthenticatedPayload,
   requireAuth,
   canAccessHuntingDistrict,
   canCreateFacility,
   canAdministerHuntingDistrict,
   isPointInsideHuntingDistrict,
});
registerTaskRoutes(app, {
   authStore,
   taskStore,
   facilityStore,
   getAuthenticatedPayload,
   requireAuth,
   canAccessHuntingDistrict,
   canAdministerHuntingDistrict,
   isActiveHuntingDistrictMember,
});
registerReservationRoutes(app, {
   authStore,
   reservationStore,
   facilityStore,
   getAuthenticatedPayload,
   requireAuth,
   canAccessHuntingDistrict,
   canAdministerHuntingDistrict,
});
registerKillEntryRoutes(app, {
   authStore,
   killEntryStore,
   getAuthenticatedPayload,
   requireAuth,
   canAccessHuntingDistrict,
   canAdministerHuntingDistrict,
});
registerAdminRoutes(app, {
   authStore,
   huntingDistrictStore,
   appOrigin,
   getAuthenticatedPayload,
   requireAdmin,
   requireSystemAdmin,
   canAdministerHuntingDistrict,
   hasOnlyExistingHuntingDistricts,
   createPasswordLink,
   sendHuntingDistrictInvitation,
});
registerHuntingDistrictRoutes(app, {
   authStore,
   huntingDistrictStore,
   facilityStore,
   taskStore,
   reservationStore,
   killEntryStore,
   getAuthenticatedPayload,
   requireAuth,
   requireAdmin,
   canAdministerHuntingDistrict,
});

const port = Number(process.env.PORT ?? 8787);
await bootstrapApi({
   app,
   port,
   authStore,
   huntingDistrictStore,
   facilityStore,
   taskStore,
   reservationStore,
   killEntryStore,
   createPasswordLink,
});
