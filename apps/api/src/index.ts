import { config } from 'dotenv';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { fileURLToPath } from 'node:url';
import { AuthStore } from './auth-store.js';
import { JagdeinrichtungStore } from './jagdeinrichtung-store.js';
import { JagdeinrichtungAufgabenStore } from './jagdeinrichtung-aufgaben-store.js';
import { JagdeinrichtungReservierungenStore } from './jagdeinrichtung-reservierungen-store.js';
import { sendRegistrationNotification, sendRevierInvitation } from './mailer.js';
import { RevierStore } from './revier-store.js';
import { StreckeneintragStore } from './streckeneintrag-store.js';
import { createAuthMiddleware } from './middleware/auth.middleware.js';
import { createAuthHelpers } from './helpers/auth.helpers.js';
import { createRevierHelpers } from './helpers/revier.helpers.js';
import { registerPublicRoutes } from './routes/public.routes.js';
import { registerAuthRoutes } from './routes/auth.routes.js';
import { registerJagdeinrichtungRoutes } from './routes/jagdeinrichtungen.routes.js';
import { registerAufgabenRoutes } from './routes/aufgaben.routes.js';
import { registerReservierungenRoutes } from './routes/reservierungen.routes.js';
import { registerStreckeneintragRoutes } from './routes/streckeneintraege.routes.js';
import { registerAdminRoutes } from './routes/admin.routes.js';
import { registerRevierRoutes } from './routes/reviere.routes.js';
import { bootstrapApi } from './bootstrap.js';

// Load .env from the api package root.
config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const app = new Hono();
const dataDirectory = process.env.DATA_DIRECTORY ?? './data';
const appOrigin = process.env.APP_ORIGIN ?? 'http://127.0.0.1:5173';
const authStore = new AuthStore(dataDirectory);
const revierStore = new RevierStore(dataDirectory);
const jagdeinrichtungStore = new JagdeinrichtungStore(dataDirectory);
const aufgabenStore = new JagdeinrichtungAufgabenStore(dataDirectory);
const reservierungenStore = new JagdeinrichtungReservierungenStore(dataDirectory);
const streckeneintragStore = new StreckeneintragStore(dataDirectory);
// Encode the secret once so every JWT sign/verify reuses the same Uint8Array.
const authSecret = new TextEncoder().encode(
   process.env.AUTH_SECRET ?? 'development-only-secret-change-me',
);
const { getAuthenticatedPayload, requireAuth, requireAdmin, requireSystemAdmin } = createAuthMiddleware({
   authStore,
   authSecret,
});
const { hasOnlyExistingReviere, createPasswordLink } = createAuthHelpers({
   authStore,
   revierStore,
   appOrigin,
});
const {
   canAdministerRevier,
   canAccessRevier,
   canCreateJagdeinrichtung,
   isPointInsideRevier,
   isActiveRevierMember,
} = createRevierHelpers({ authStore, jagdeinrichtungStore });
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
      origin: (origin) => (origin && allowedOrigins.has(origin) ? origin : ''),
      credentials: true,
   }),
);

registerPublicRoutes(app, { authStore, revierStore });

registerAuthRoutes(app, {
   authStore,
   revierStore,
   authSecret,
   getAuthenticatedPayload,
   requireAuth,
   createPasswordLink,
   sendRegistrationNotification,
});
registerJagdeinrichtungRoutes(app, {
   authStore,
   jagdeinrichtungStore,
   revierStore,
   getAuthenticatedPayload,
   requireAuth,
   canAccessRevier,
   canCreateJagdeinrichtung,
   canAdministerRevier,
   isPointInsideRevier,
});
registerAufgabenRoutes(app, {
   authStore,
   aufgabenStore,
   jagdeinrichtungStore,
   getAuthenticatedPayload,
   requireAuth,
   canAccessRevier,
   canAdministerRevier,
   isActiveRevierMember,
});
registerReservierungenRoutes(app, {
   authStore,
   reservierungenStore,
   jagdeinrichtungStore,
   getAuthenticatedPayload,
   requireAuth,
   canAccessRevier,
   canAdministerRevier,
});
registerStreckeneintragRoutes(app, {
   authStore,
   streckeneintragStore,
   getAuthenticatedPayload,
   requireAuth,
   canAccessRevier,
});
registerAdminRoutes(app, {
   authStore,
   revierStore,
   appOrigin,
   getAuthenticatedPayload,
   requireAdmin,
   requireSystemAdmin,
   canAdministerRevier,
   hasOnlyExistingReviere,
   createPasswordLink,
   sendRevierInvitation,
});
registerRevierRoutes(app, {
   authStore,
   revierStore,
   getAuthenticatedPayload,
   requireAuth,
   requireAdmin,
   canAdministerRevier,
});

const port = Number(process.env.PORT ?? 8787);
await bootstrapApi({
   app,
   port,
   authStore,
   revierStore,
   jagdeinrichtungStore,
   aufgabenStore,
   reservierungenStore,
   streckeneintragStore,
   createPasswordLink,
});
