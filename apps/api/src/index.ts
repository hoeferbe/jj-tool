import { serve } from '@hono/node-server';
import { zValidator } from '@hono/zod-validator';
import argon2 from 'argon2';
import { config } from 'dotenv';
import { type Context, Hono, type Next } from 'hono';
import { cors } from 'hono/cors';
import { SignJWT, jwtVerify } from 'jose';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { AuthStore, type User } from './auth-store.js';
import { sendPasswordLink } from './mailer.js';

// Load .env from the api package root.
config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const app = new Hono();
const dataDirectory = process.env.DATA_DIRECTORY ?? './data';
const appOrigin = process.env.APP_ORIGIN ?? 'http://127.0.0.1:5173';
const authStore = new AuthStore(dataDirectory);
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
});
const loginSchema = z.object({
   identifier: z.string().trim().min(3),
   password: z.string().min(1),
});
const emailSchema = z.object({ email: z.string().trim().email() });
const passwordSchema = z.object({
   token: z.string().min(1),
   password: z.string().min(12).max(128),
});
const ROLES = ['guest', 'paechter', 'bgs', 'admin'] as const;
const POSITIONS = ['revierleiter', 'kassenwart', 'schriftfuehrer'] as const;
/** Schema for admin approval: role defaults to 'paechter', position and isAdmin are optional. */
const approveSchema = z.object({
   role: z.enum(ROLES).default('paechter'),
   position: z.enum(POSITIONS).optional(),
   isAdmin: z.boolean().optional(),
});
/** Schema for inline role/position/isAdmin updates in the member list. */
const updateRoleSchema = z.object({
   role: z.enum(ROLES),
   position: z.enum(POSITIONS).optional(),
   isAdmin: z.boolean().optional(),
});

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

// --- Auth routes ------------------------------------------------------------

/** POST /auth/register — Creates a guest account awaiting admin approval. No e-mail is sent yet. */
app.post(
   '/auth/register',
   zValidator('json', registrationSchema),
   async (context) => {
      const input = context.req.valid('json');
      try {
         // New accounts start as 'guest' + 'pending' until an admin approves them.
         await authStore.createUser({
            ...input,
            role: 'guest',
            status: 'pending',
         });
         return context.json(
            {
               message:
                  'Registrierung erhalten. Ein Admin schaltet dein Konto frei.',
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
      new SignJWT({ role: user.role, username: user.username, isAdmin: user.isAdmin ?? false })
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
      user: { id: user.id, displayName: user.displayName, role: user.role },
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
      // Re-read current role/isAdmin so changes by the admin take effect on next refresh.
      const accessToken = await new SignJWT({
         role: user.role,
         username: user.username,
         isAdmin: user.isAdmin ?? false,
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

/**
 * Middleware that allows only users with role 'admin' OR the isAdmin flag.
 * Must be applied before every admin route handler.
 */
const requireAdmin = async (context: Context, next: Next) => {
   const authorization = context.req.header('Authorization');
   if (!authorization?.startsWith('Bearer ')) {
      return context.json({ message: 'Nicht autorisiert.' }, 401);
   }
   try {
      const { payload } = await jwtVerify(authorization.slice(7), authSecret);
      if (payload['role'] !== 'admin' && payload['isAdmin'] !== true) {
         return context.json({ message: 'Zugriff verweigert.' }, 403);
      }
   } catch {
      return context.json({ message: 'Token ungueltig oder abgelaufen.' }, 401);
   }
   await next();
};

// --- Admin routes ------------------------------------------------------------

/** GET /admin/users — Returns all users with live isOnline status. Not cached. */
app.get('/admin/users', requireAdmin, (context) => {
   context.header('Cache-Control', 'no-store');
   return context.json({ users: authStore.getAllUsers() });
});

/** POST /admin/users/:id/approve — Approves a pending registration and sends the password-setup e-mail. */
app.post(
   '/admin/users/:id/approve',
   requireAdmin,
   zValidator('json', approveSchema),
   async (context) => {
      const userId = context.req.param('id') ?? '';
      const { role, position, isAdmin } = context.req.valid('json');
      try {
         const user = await authStore.approveUser(userId, role, position, isAdmin);
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
app.delete('/admin/users/:id', requireAdmin, async (context) => {
   const userId = context.req.param('id') ?? '';
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

/** PATCH /admin/users/:id — Updates an existing member's role, position, and/or admin flag. */
app.patch(
   '/admin/users/:id',
   requireAdmin,
   zValidator('json', updateRoleSchema),
   async (context) => {
      const userId = context.req.param('id') ?? '';
      const { role, position, isAdmin } = context.req.valid('json');
      try {
         const user = await authStore.updateUserRoleAndPosition(
            userId,
            role,
            position,
            isAdmin,
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
      role: 'admin',
      status: 'active',
   });
   await createPasswordLink(admin);
};

const port = Number(process.env.PORT ?? 8787);

await authStore.initialize();
await initializeInitialAdmin();

serve({ fetch: app.fetch, port }, () => {
   console.log(`API is listening on http://localhost:${port}`);
});
