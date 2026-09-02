import { serve } from '@hono/node-server';
import { zValidator } from '@hono/zod-validator';
import argon2 from 'argon2';
import { config } from 'dotenv';
import { type Context, Hono, type Next } from 'hono';
import { cors } from 'hono/cors';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import { SignJWT, jwtVerify } from 'jose';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { AuthStore, type User } from './auth-store.js';
import { sendPasswordLink, sendRegistrationNotification, sendRevierInvitation } from './mailer.js';
import { RevierStore } from './revier-store.js';

// Load .env from the api package root.
config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const app = new Hono();
const dataDirectory = process.env.DATA_DIRECTORY ?? './data';
const appOrigin = process.env.APP_ORIGIN ?? 'http://127.0.0.1:5173';
const authStore = new AuthStore(dataDirectory);
const revierStore = new RevierStore(dataDirectory);
// Encode the secret once so every JWT sign/verify reuses the same Uint8Array.
const authSecret = new TextEncoder().encode(
   process.env.AUTH_SECRET ?? 'development-only-secret-change-me',
);
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

app.get('/health', (context) => context.json({ status: 'ok' }));

// --- Validation schemas -----------------------------------------------------

const registrationSchema = z.object({
   username: z
      .string()
      .trim()
      .min(3)
      .max(40)
      .regex(/^[a-zA-Z0-9._-]+$/),
   email: z.string().trim().email(),
   displayName: z.string().trim().min(2).max(80),
   revierId: z.string().uuid().optional(),
   invitationToken: z.string().min(20).optional(),
});
const invitationSchema = z.object({ email: z.string().trim().email() });
const loginSchema = z.object({
   identifier: z.string().trim().min(3),
   password: z.string().min(1),
});
const emailSchema = z.object({ email: z.string().trim().email() });
const passwordSchema = z.object({
   token: z.string().min(1),
   password: z.string().min(12).max(128),
});
const revierSchema = z.object({
   name: z.string().trim().min(2).max(120),
   municipalityName: z.string().trim().min(2).max(120),
   municipalityCode: z.string().trim().min(1).max(30).optional(),
   center: z.object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
   }),
   boundary: z.object({
      type: z.literal('FeatureCollection'),
      features: z.array(
         z.object({
            type: z.literal('Feature'),
            properties: z.record(z.string(), z.any()).optional(),
            geometry: z.object({
               type: z.enum([
                  'Point',
                  'LineString',
                  'Polygon',
                  'MultiPoint',
                  'MultiLineString',
                  'MultiPolygon',
                  'GeometryCollection',
               ]),
               coordinates: z.any(),
            }),
         }),
      ),
   }),
   source: z.literal('bkg-wfs-vg25'),
});
const ROLES = ['guest', 'paechter', 'bgs', 'admin'] as const;
const POSITIONS = ['revierleiter', 'kassenwart', 'schriftfuehrer'] as const;
/** Schema for admin approval: role defaults to 'paechter', position and isAdmin are optional. */
const approveSchema = z.object({
   role: z.enum(ROLES).default('paechter'),
   position: z.enum(POSITIONS).optional(),
   isAdmin: z.boolean().optional(),
   revierIds: z.array(z.string().uuid()).default([]),
});
/** Schema for inline role/position/isAdmin updates in the member list. */
const updateRoleSchema = z.object({
   role: z.enum(ROLES),
   position: z.enum(POSITIONS).optional(),
   isAdmin: z.boolean().optional(),
   revierIds: z.array(z.string().uuid()).optional(),
});
const updateUserStatusSchema = z.object({ blocked: z.boolean() });
const membershipSchema = z.object({
   memberType: z.enum(['paechter', 'bgs', 'guest']),
   position: z.enum(POSITIONS).optional(),
   isAdmin: z.boolean().default(false),
   status: z.enum(['pending', 'active']).default('active'),
});

async function hasOnlyExistingReviere(revierIds: string[] | undefined) {
   if (!revierIds) return true;
   const existingIds = new Set((await revierStore.getReviere()).map((revier) => revier.id));
   return revierIds.every((id) => existingIds.has(id));
}

/**
 * Creates a one-time password-setup link for a user and sends it by e-mail.
 * In development the link is printed to stdout if SMTP is not configured.
 */
const createPasswordLink = async (user: User) => {
   const token = await authStore.createPasswordToken(user.id);
   await sendPasswordLink({
      email: user.email,
      displayName: user.displayName,
      passwordLink: `${appOrigin}/?set-password=${encodeURIComponent(token)}`,
   });
};

app.get('/public/reviere', async (context) => {
   const reviere = await revierStore.getReviere();
   return context.json({
      reviere: reviere.map(({ id, name, municipalityName }) => ({ id, name, municipalityName })),
   });
});

app.get('/auth/invitations/:token', async (context) => {
   const invitation = authStore.getRevierInvitation(context.req.param('token'));
   if (!invitation) return context.json({ message: 'Einladung ungültig oder abgelaufen.' }, 404);
   const revier = (await revierStore.getReviere()).find((entry) => entry.id === invitation.revierId);
   if (!revier) return context.json({ message: 'Das eingeladene Revier existiert nicht mehr.' }, 404);
   return context.json({ invitation: { email: invitation.email, revierId: revier.id, revierName: revier.name } });
});

// --- Auth routes ------------------------------------------------------------

/** POST /auth/register — Creates a guest account awaiting admin approval. No e-mail is sent yet. */
app.post(
   '/auth/register',
   zValidator('json', registrationSchema),
   async (context) => {
      const input = context.req.valid('json');
      try {
         const invitation = input.invitationToken
            ? authStore.getRevierInvitation(input.invitationToken)
            : undefined;
         if (input.invitationToken && !invitation) {
            return context.json({ message: 'Einladung ungültig oder abgelaufen.' }, 400);
         }
         if (invitation && invitation.email !== input.email.toLowerCase()) {
            return context.json({ message: 'Die E-Mail-Adresse passt nicht zur Einladung.' }, 400);
         }
         const revierId = invitation?.revierId ?? input.revierId;
         if (revierId && !(await revierStore.getReviere()).some((revier) => revier.id === revierId)) {
            return context.json({ message: 'Das ausgewählte Revier existiert nicht mehr.' }, 400);
         }
         const user = await authStore.createUser({
            username: input.username,
            email: input.email,
            displayName: input.displayName,
            status: 'pending',
         });
         const selectedRevier = revierId
            ? (await revierStore.getReviere()).find((revier) => revier.id === revierId)
            : undefined;
         if (revierId) {
            await authStore.upsertMembership(user.id, {
               revierId,
               status: 'pending',
               memberType: 'guest',
               isAdmin: false,
               source: invitation ? 'invitation' : 'systemAdmin',
            });
         }
         await sendRegistrationNotification({
            recipients: authStore.getAllUsers()
               .filter((candidate) => candidate.accountType === 'systemAdmin' && candidate.status === 'active')
               .map((candidate) => candidate.email),
            displayName: user.displayName,
            email: user.email,
            revierName: selectedRevier?.name,
         });
         if (input.invitationToken) await authStore.consumeRevierInvitation(input.invitationToken);
         return context.json(
            {
               message:
                  'Registrierung erhalten. Nach der Freigabe erhältst du per E-Mail einen Link zum Festlegen deines Passworts.',
            },
            201,
         );
      } catch (error) {
         if ((error as Error).message === 'USER_EXISTS') {
            return context.json(
               {
                  message:
                     'Benutzername oder E-Mail-Adresse ist bereits registriert.',
               },
               409,
            );
         }
         throw error;
      }
   },
);

/**
 * POST /auth/login — Validates credentials and issues a 7-day JWT.
 * Also records the login timestamp and creates a browser session.
 */
app.post('/auth/login', zValidator('json', loginSchema), async (context) => {
   const { identifier, password } = context.req.valid('json');
   const user = authStore.findUser(identifier);
   // Generic message to avoid leaking whether the username exists.
   if (!user) {
      return context.json(
         { message: 'Benutzername oder Passwort ist nicht korrekt.' },
         401,
      );
   }
   // Account exists but no password set yet → resend the setup link.
   if (!user.passwordHash) {
      await createPasswordLink(user);
      return context.json(
         {
            code: 'PASSWORD_SETUP_REQUIRED',
            message:
               'Ein Link zum Setzen des Passworts wurde per E-Mail versendet.',
         },
         409,
      );
   }
   if (!(await argon2.verify(user.passwordHash, password))) {
      return context.json(
         { message: 'Benutzername oder Passwort ist nicht korrekt.' },
         401,
      );
   }
   // Account still pending admin approval.
   if (user.status !== 'active') {
      return context.json(
         {
            code: 'PENDING_APPROVAL',
            message:
               'Dein Konto wartet noch auf die Freigabe durch einen Administrator.',
         },
         403,
      );
   }

   // Issue JWT, record login timestamp, and create session in parallel.
   const [accessToken, previousLoginAt, sessionId] = await Promise.all([
      new SignJWT({
         accountType: user.accountType,
         username: user.username,
         hasRevierAdminAccess: user.memberships.some((membership) => membership.isAdmin),
      })
         .setProtectedHeader({ alg: 'HS256' })
         .setSubject(user.id)
         .setIssuedAt()
         .setExpirationTime('7d')
         .sign(authSecret),
      authStore.recordLogin(user.id),
      authStore.createSession(user.id),
   ]);

   return context.json({
      accessToken,
      previousLoginAt,
      sessionId,
      user: {
         id: user.id,
         displayName: user.displayName,
         accountType: user.accountType,
         memberships: user.memberships,
      },
   });
});

/** POST /auth/password/forgot — Sends a password-reset link. Always returns 200 to prevent user enumeration. */
app.post(
   '/auth/password/forgot',
   zValidator('json', emailSchema),
   async (context) => {
      const { email } = context.req.valid('json');
      const user = authStore.findUser(email);
      if (user) {
         await createPasswordLink(user);
      }
      // Same response regardless of whether the e-mail is registered.
      return context.json({
         message:
            'Wenn die E-Mail-Adresse registriert ist, wurde ein Passwort-Link versendet.',
      });
   },
);

/** POST /auth/password/reset — Validates the one-time token and stores the Argon2id password hash. */
app.post(
   '/auth/password/reset',
   zValidator('json', passwordSchema, (result, context) => {
      if (!result.success) {
         return context.json(
            { message: 'Das Passwort muss mindestens 12 Zeichen lang sein.' },
            400,
         );
      }
   }),
   async (context) => {
      const { token, password } = context.req.valid('json');
      const passwordHash = await argon2.hash(password, {
         type: argon2.argon2id,
      });
      const wasSet = await authStore.setPassword(token, passwordHash);
      if (!wasSet) {
         return context.json(
            { message: 'Der Passwort-Link ist ungueltig oder abgelaufen.' },
            400,
         );
      }
      return context.json({
         message: 'Passwort gesetzt. Du kannst dich jetzt anmelden.',
      });
   },
);

/**
 * POST /auth/logout — Deletes all sessions for the authenticated user.
 * Uses the Bearer JWT to identify the user; no request body needed.
 */
app.post('/auth/logout', async (context) => {
   const authorization = context.req.header('Authorization');
   if (authorization?.startsWith('Bearer ')) {
      try {
         const { payload } = await jwtVerify(authorization.slice(7), authSecret);
         if (payload.sub) await authStore.deleteUserSessions(payload.sub);
      } catch { /* expired token – sessions already stale, nothing to clean up */ }
   }
   return context.json({ message: 'Abgemeldet.' });
});

/**
 * POST /auth/refresh — Issues a fresh 7-day JWT for an already-authenticated user.
 * Called silently on app startup to extend the sliding session window.
 */
app.post('/auth/refresh', async (context) => {
   const authorization = context.req.header('Authorization');
   if (!authorization?.startsWith('Bearer ')) {
      return context.json({ message: 'Nicht autorisiert.' }, 401);
   }
   try {
      const { payload } = await jwtVerify(authorization.slice(7), authSecret);
      const user = authStore.findUserById(payload.sub ?? '');
      if (!user || user.status !== 'active') {
         return context.json({ message: 'Benutzer nicht gefunden.' }, 401);
      }
      // Re-read current account and membership scopes so changes take effect immediately.
      const accessToken = await new SignJWT({
         accountType: user.accountType,
         username: user.username,
         hasRevierAdminAccess: user.memberships.some((membership) => membership.isAdmin),
      })
         .setProtectedHeader({ alg: 'HS256' })
         .setSubject(user.id)
         .setIssuedAt()
         .setExpirationTime('7d')
         .sign(authSecret);
      return context.json({ accessToken });
   } catch {
      return context.json({ message: 'Token ungueltig oder abgelaufen.' }, 401);
   }
});

// --- Admin middleware --------------------------------------------------------

/** Reads the bearer token from the request and returns the decoded JWT payload. */
async function getAuthenticatedPayload(context: Context) {
   const authorization = context.req.header('Authorization');
   if (!authorization?.startsWith('Bearer ')) {
      return null;
   }
   try {
      const { payload } = await jwtVerify(authorization.slice(7), authSecret);
      return payload as {
         sub?: string;
         accountType?: string;
         hasRevierAdminAccess?: boolean;
      };
   } catch {
      return null;
   }
}

/** Middleware that allows only authenticated users. */
const requireAuth = async (context: Context, next: Next) => {
   const payload = await getAuthenticatedPayload(context);
   const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
   if (!payload || !payload.sub || user?.status !== 'active') {
      return context.json({ message: 'Nicht autorisiert.' }, 401);
   }
   await next();
};

app.get('/auth/me', requireAuth, async (context) => {
   const payload = await getAuthenticatedPayload(context);
   const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
   if (!user) return context.json({ message: 'Benutzer nicht gefunden.' }, 404);
   const { passwordHash: _passwordHash, ...profile } = user;
   return context.json({ user: profile });
});

/**
 * Middleware that allows only users with role 'admin' OR the isAdmin flag.
 * Must be applied before every admin route handler.
 */
const requireAdmin = async (context: Context, next: Next) => {
   const payload = await getAuthenticatedPayload(context);
   const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
   if (!payload || !payload.sub || user?.status !== 'active') {
      return context.json({ message: 'Nicht autorisiert.' }, 401);
   }
   if (user.accountType !== 'systemAdmin' && authStore.getAdminRevierIds(user.id).length === 0) {
      return context.json({ message: 'Zugriff verweigert.' }, 403);
   }
   await next();
};

function canAdministerRevier(user: User, revierId: string) {
   return user.accountType === 'systemAdmin' || authStore.getAdminRevierIds(user.id).includes(revierId);
}

async function requireSystemAdmin(context: Context, next: Next) {
   const payload = await getAuthenticatedPayload(context);
   const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
   if (!user || user.status !== 'active' || user.accountType !== 'systemAdmin') {
      return context.json({ message: 'Nur Systemadministratoren dürfen diese Aktion ausführen.' }, 403);
   }
   await next();
}

// --- Revier routes -----------------------------------------------------------

app.get('/reviere', requireAuth, async (context) => {
   const payload = await getAuthenticatedPayload(context);
   const reviere = await revierStore.getReviere();
   const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
   if (user?.accountType === 'systemAdmin') {
      return context.json({ reviere });
   }
   const assignedIds = new Set(
      user?.memberships
         .filter((membership) => membership.status === 'active')
         .map((membership) => membership.revierId) ?? [],
   );
   return context.json({
      reviere: reviere.filter((revier) => assignedIds.has(revier.id)),
   });
});

app.get('/reviere/:id/members', requireAuth, async (context) => {
   const payload = await getAuthenticatedPayload(context);
   const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
   const revierId = context.req.param('id');
   if (!revierId) return context.json({ message: 'Revier-ID fehlt.' }, 400);
   const mayView = user?.accountType === 'systemAdmin' || user?.memberships.some(
      (membership) => membership.revierId === revierId && membership.status === 'active',
   );
   if (!mayView) return context.json({ message: 'Kein Zugriff auf dieses Revier.' }, 403);
   const viewerMembership = user?.memberships.find(
      (membership) => membership.revierId === revierId && membership.status === 'active',
   );
   const members = authStore.getMemberDirectory(revierId).map((member) => ({
      ...member,
      memberType: viewerMembership?.memberType === 'guest'
         ? member.memberType === 'guest' ? 'guest' : 'member'
         : member.memberType,
   }));
   return context.json({ members });
});

app.post(
   '/reviere',
   requireAuth,
   zValidator('json', revierSchema),
   async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const input = context.req.valid('json');
      const revier = await revierStore.createRevier({
         ...input,
         createdBy: payload?.sub ?? 'unknown',
      });
      const creator = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      if (creator?.accountType === 'member') {
         await authStore.upsertMembership(creator.id, {
            revierId: revier.id,
            status: 'active',
            memberType: 'paechter',
            isAdmin: true,
         });
      }
      return context.json({ revier }, 201);
   },
);

app.put(
   '/reviere/:id',
   requireAdmin,
   zValidator('json', revierSchema),
   async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      if (!user || !canAdministerRevier(user, context.req.param('id'))) {
         return context.json({ message: 'Dieses Revier darf nicht administriert werden.' }, 403);
      }
      const revier = await revierStore.updateRevier(context.req.param('id'), {
         ...context.req.valid('json'),
         createdBy: payload?.sub ?? 'unknown',
      });
      if (!revier) {
         return context.json({ message: 'Revier nicht gefunden.' }, 404);
      }
      return context.json({ revier });
   },
);

app.get('/municipalities/search', requireAuth, async (context) => {
   const municipalityName = context.req.query('name');
   const latitude = context.req.query('lat');
   const longitude = context.req.query('lng');

   const bkgBaseUrl = process.env.BKG_WFS_URL ?? 'https://sgx.geodatenzentrum.de/wfs_vg25';
   if (!municipalityName && (!latitude || !longitude)) {
      return context.json({ message: 'Fehlende Suchparameter.' }, 400);
   }

   const url = new URL(bkgBaseUrl);
   const searchParams = new URLSearchParams({
      service: 'WFS',
      version: '2.0.0',
      request: 'GetFeature',
      typeNames: 'vg25:vg25_gem',
      outputFormat: 'application/json',
      srsName: 'EPSG:4326',
   });
   if (municipalityName) {
      searchParams.set('cql_filter', `gen = '${municipalityName.replace(/'/g, "''")}'`);
   } else {
      const lat = Number(latitude);
      const lng = Number(longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
         return context.json({ message: 'Koordinaten sind ungültig.' }, 400);
      }
      const tolerance = 0.00005;
      searchParams.set(
         'bbox',
         `${lng - tolerance},${lat - tolerance},${lng + tolerance},${lat + tolerance},EPSG:4326`,
      );
   }
   url.search = searchParams.toString();

   const response = await fetch(url.toString());
   if (!response.ok) {
      const text = await response.text();
      console.error('BKG WFS failed', response.status, text.slice(0, 400));
      return context.json({ message: 'Gemeinde konnte nicht vom BKG geladen werden.' }, 502);
   }

   const data = (await response.json()) as {
      features?: Array<{
         properties?: Record<string, unknown>;
         geometry?: unknown;
      }>;
   };
   const features = data.features ?? [];
   if (features.length === 0) {
      return context.json({ message: 'Keine Gemeinde unter diesen Kriterien gefunden.' }, 404);
   }

   const clickedPoint = latitude && longitude
      ? point([Number(longitude), Number(latitude)])
      : null;
   const firstFeature = (clickedPoint
      ? features.find((feature) => {
         const geometry = feature.geometry as { type?: string } | undefined;
         if (geometry?.type !== 'Polygon' && geometry?.type !== 'MultiPolygon') return false;
         return booleanPointInPolygon(
            clickedPoint,
            feature as Feature<Polygon | MultiPolygon>,
         );
      }) ?? features[0]
      : features[0]) as {
      properties?: Record<string, unknown>;
      geometry?: unknown;
   };
   const municipality = String(firstFeature.properties?.gen ?? municipalityName ?? 'Gemeinde');
   const code = firstFeature.properties?.ags ?? firstFeature.properties?.ars;

   return context.json({
      municipalityName: municipality,
      municipalityCode: typeof code === 'string' ? code : undefined,
      boundary: { type: 'FeatureCollection', features: [firstFeature] },
   });
});

app.delete('/reviere/:id', requireAdmin, async (context) => {
   const id = context.req.param('id');
   if (!id) {
      return context.json({ message: 'Revier-ID fehlt.' }, 400);
   }
   const payload = await getAuthenticatedPayload(context);
   const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
   if (!user || !canAdministerRevier(user, id)) {
      return context.json({ message: 'Dieses Revier darf nicht administriert werden.' }, 403);
   }
   if (authStore.getAllUsers().some((candidate) =>
      candidate.id !== user.id &&
      candidate.memberships.some((membership) => membership.revierId === id),
   )) {
      return context.json({ message: 'Das Revier kann erst gelöscht werden, wenn keine Mitglieder mehr zugeordnet sind.' }, 409);
   }
   const deleted = await revierStore.deleteRevier(id);
   if (!deleted) {
      return context.json({ message: 'Revier nicht gefunden.' }, 404);
   }
   await authStore.removeRevierAssignments(id);
   return context.json({ message: 'Revier gelöscht.' });
});

// --- Admin routes ------------------------------------------------------------

/** GET /admin/users — Returns all users with live isOnline status. Not cached. */
app.get('/admin/users', requireAdmin, (context) => {
   context.header('Cache-Control', 'no-store');
   return getAuthenticatedPayload(context).then((payload) =>
      context.json({ users: payload?.sub ? authStore.getUsersForAdmin(payload.sub) : [] }),
   );
});

app.post(
   '/reviere/:id/invitations',
   requireAdmin,
   zValidator('json', invitationSchema),
   async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const administrator = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('id');
      if (!administrator || !canAdministerRevier(administrator, revierId)) {
         return context.json({ message: 'Für dieses Revier dürfen keine Einladungen versendet werden.' }, 403);
      }
      const revier = (await revierStore.getReviere()).find((entry) => entry.id === revierId);
      if (!revier) return context.json({ message: 'Revier nicht gefunden.' }, 404);
      const { email } = context.req.valid('json');
      const token = await authStore.createRevierInvitation(revier.id, email, administrator.id);
      await sendRevierInvitation({
         email,
         revierName: revier.name,
         inviterName: administrator.displayName,
         invitationLink: `${appOrigin}/?invite=${encodeURIComponent(token)}`,
      });
      return context.json({ message: 'Einladung wurde versendet.' }, 201);
   },
);

/** POST /admin/users/:id/approve — Approves a pending registration and sends the password-setup e-mail. */
app.post(
   '/admin/users/:id/approve',
   requireSystemAdmin,
   zValidator('json', approveSchema),
   async (context) => {
      const userId = context.req.param('id') ?? '';
      const { role, position, isAdmin, revierIds } = context.req.valid('json');
      try {
         const target = authStore.findUserById(userId);
         if (
            target?.accountType === 'systemAdmin' &&
            role !== 'admin' &&
            authStore.countActiveSystemAdmins() <= 1
         ) {
            return context.json({ message: 'Der letzte Systemadministrator kann nicht herabgestuft werden.' }, 409);
         }
         if (!(await hasOnlyExistingReviere(revierIds))) {
            return context.json({ message: 'Mindestens ein Revier ist nicht mehr vorhanden.' }, 400);
         }
         const user = await authStore.approveUser(userId, role, position, isAdmin, revierIds);
         await createPasswordLink(user);
         return context.json({
            message:
               'Benutzer freigeschaltet. Ein Passwort-Link wurde versendet.',
         });
      } catch (error) {
         if ((error as Error).message === 'USER_NOT_FOUND') {
            return context.json({ message: 'Benutzer nicht gefunden.' }, 404);
         }
         throw error;
      }
   },
);

/** DELETE /admin/users/:id — Rejects and permanently removes a pending registration. */
app.delete('/admin/users/:id', requireSystemAdmin, async (context) => {
   const userId = context.req.param('id') ?? '';
   const payload = await getAuthenticatedPayload(context);
   if (payload?.sub === userId) {
      return context.json({ message: 'Das eigene Administratorkonto kann nicht gelöscht werden.' }, 400);
   }
   try {
      await authStore.deleteUser(userId);
      return context.json({ message: 'Registrierung abgelehnt.' });
   } catch (error) {
      if ((error as Error).message === 'USER_NOT_FOUND') {
         return context.json({ message: 'Benutzer nicht gefunden.' }, 404);
      }
      throw error;
   }
});

app.patch(
   '/admin/users/:id/status',
   requireSystemAdmin,
   zValidator('json', updateUserStatusSchema),
   async (context) => {
      const userId = context.req.param('id') ?? '';
      const payload = await getAuthenticatedPayload(context);
      if (payload?.sub === userId) {
         return context.json({ message: 'Das eigene Administratorkonto kann nicht gesperrt werden.' }, 400);
      }
      try {
         const user = await authStore.setUserBlocked(
            userId,
            context.req.valid('json').blocked,
         );
         return context.json({ user });
      } catch (error) {
         if ((error as Error).message === 'USER_NOT_FOUND') {
            return context.json({ message: 'Benutzer nicht gefunden.' }, 404);
         }
         if ((error as Error).message === 'USER_NOT_ACTIVE') {
            return context.json({ message: 'Ausstehende Registrierungen können nicht gesperrt werden.' }, 400);
         }
         throw error;
      }
   },
);

/** PATCH /admin/users/:id — Updates an existing member's role, position, and/or admin flag. */
app.patch(
   '/admin/users/:id',
   requireSystemAdmin,
   zValidator('json', updateRoleSchema),
   async (context) => {
      const userId = context.req.param('id') ?? '';
      const { role, position, isAdmin, revierIds } = context.req.valid('json');
      try {
         if (!(await hasOnlyExistingReviere(revierIds))) {
            return context.json({ message: 'Mindestens ein Revier ist nicht mehr vorhanden.' }, 400);
         }
         const user = await authStore.updateUserRoleAndPosition(
            userId,
            role,
            position,
            isAdmin,
            revierIds,
         );
         return context.json({ user });
      } catch (error) {
         if ((error as Error).message === 'USER_NOT_FOUND') {
            return context.json({ message: 'Benutzer nicht gefunden.' }, 404);
         }
         throw error;
      }
   },
);

app.put(
   '/reviere/:revierId/members/:userId',
   requireAdmin,
   zValidator('json', membershipSchema),
   async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const administrator = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      const revierId = context.req.param('revierId');
      if (!administrator || !canAdministerRevier(administrator, revierId)) {
         return context.json({ message: 'Diese Mitgliedschaft darf nicht administriert werden.' }, 403);
      }
      try {
         const targetWasPending = authStore.findUserById(context.req.param('userId'))?.status === 'pending';
         const membership = await authStore.upsertMembership(context.req.param('userId'), {
            revierId,
            ...context.req.valid('json'),
         });
         const target = authStore.findUserById(context.req.param('userId'));
         if (targetWasPending && membership.status === 'active' && target) {
            await createPasswordLink(target);
         }
         return context.json({ membership });
      } catch (error) {
         if ((error as Error).message === 'USER_NOT_FOUND') {
            return context.json({ message: 'Benutzer nicht gefunden.' }, 404);
         }
         if ((error as Error).message === 'LAST_REVIER_ADMIN') {
            return context.json(
               { message: 'Zuerst muss ein anderes Mitglied zum Revieradmin ernannt werden.' },
               409,
            );
         }
         return context.json({ message: 'Mitgliedschaft konnte nicht gespeichert werden.' }, 400);
      }
   },
);

app.delete('/reviere/:revierId/members/:userId', requireAdmin, async (context) => {
   const payload = await getAuthenticatedPayload(context);
   const administrator = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
   const revierId = context.req.param('revierId');
   const userId = context.req.param('userId');
   if (!revierId || !userId) {
      return context.json({ message: 'Revier- oder Benutzer-ID fehlt.' }, 400);
   }
   if (!administrator || !canAdministerRevier(administrator, revierId)) {
      return context.json({ message: 'Diese Mitgliedschaft darf nicht administriert werden.' }, 403);
   }
   try {
      await authStore.removeMembership(userId, revierId);
      return context.json({ message: 'Mitgliedschaft entfernt.' });
   } catch (error) {
      if ((error as Error).message === 'LAST_REVIER_ADMIN') {
         return context.json(
            { message: 'Zuerst muss ein anderes Mitglied zum Revieradmin ernannt werden.' },
            409,
         );
      }
      return context.json({ message: 'Mitgliedschaft nicht gefunden.' }, 404);
   }
});

// --- Bootstrap --------------------------------------------------------------

/**
 * Creates the initial admin account from env vars if it does not exist yet.
 * Only runs when INITIAL_ADMIN_* variables are set.
 */
const initializeInitialAdmin = async () => {
   const { INITIAL_ADMIN_USERNAME, INITIAL_ADMIN_EMAIL, INITIAL_ADMIN_NAME } =
      process.env;
   if (!INITIAL_ADMIN_USERNAME || !INITIAL_ADMIN_EMAIL || !INITIAL_ADMIN_NAME) {
      return;
   }
   // Skip if the admin already exists (e.g. after a server restart).
   if (authStore.findUser(INITIAL_ADMIN_USERNAME)) {
      return;
   }
   const admin = await authStore.createUser({
      username: INITIAL_ADMIN_USERNAME,
      email: INITIAL_ADMIN_EMAIL,
      displayName: INITIAL_ADMIN_NAME,
      accountType: 'systemAdmin',
      status: 'active',
   });
   await createPasswordLink(admin);
};

const port = Number(process.env.PORT ?? 8787);

await authStore.initialize();
await revierStore.initialize();
for (const revier of await revierStore.getReviere()) {
   await authStore.ensureRevierOwner(revier.createdBy, revier.id);
}
await initializeInitialAdmin();

serve({ fetch: app.fetch, port }, () => {
   console.log(`API is listening on http://localhost:${port}`);
});
