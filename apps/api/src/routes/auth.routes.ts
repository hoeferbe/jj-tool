import argon2 from 'argon2';
import { zValidator } from '@hono/zod-validator';
import type { Hono, MiddlewareHandler } from 'hono';
import { jwtVerify, SignJWT } from 'jose';
import { type AuthStore, type User } from '../auth-store.js';
import { type HuntingDistrictStore } from '../hunting-district-store.js';
import {
   emailSchema,
   loginSchema,
   passwordSchema,
   registrationSchema,
} from '../schemas/auth.schemas.js';
import type { AuthPayload } from '../middleware/auth.middleware.js';

interface AuthRouteDependencies {
   authStore: AuthStore;
   huntingDistrictStore: HuntingDistrictStore;
   authSecret: Uint8Array;
   getAuthenticatedPayload: (context: import('hono').Context) => Promise<AuthPayload | null>;
   requireAuth: MiddlewareHandler;
   createPasswordLink: (user: User) => Promise<void>;
   sendRegistrationNotification: (input: {
      recipients: string[];
      displayName: string;
      email: string;
      revierName?: string;
   }) => Promise<void>;
}

export function registerAuthRoutes(app: Hono, dependencies: AuthRouteDependencies) {
   const {
      authStore,
      huntingDistrictStore,
      authSecret,
      getAuthenticatedPayload,
      requireAuth,
      createPasswordLink,
      sendRegistrationNotification,
   } = dependencies;

   app.post(
      '/auth/register',
      zValidator('json', registrationSchema),
      async (context) => {
         const input = context.req.valid('json');
         try {
            const invitation = input.invitationToken
               ? authStore.getHuntingDistrictInvitation(input.invitationToken)
               : undefined;
            if (input.invitationToken && !invitation) {
               return context.json({ message: 'Einladung ungültig oder abgelaufen.' }, 400);
            }
            if (invitation && invitation.email !== input.email.toLowerCase()) {
               return context.json({ message: 'Die E-Mail-Adresse passt nicht zur Einladung.' }, 400);
            }
            const revierId = invitation?.revierId ?? input.revierId;
            if (revierId && !(await huntingDistrictStore.getHuntingDistricts()).some((district) => district.id === revierId)) {
               return context.json({ message: 'Das ausgewählte Revier existiert nicht mehr.' }, 400);
            }
            const user = await authStore.createUser({
               username: input.username,
               email: input.email,
               displayName: input.displayName,
               status: 'pending',
            });
            const selectedRevier = revierId
               ? (await huntingDistrictStore.getHuntingDistricts()).find((district) => district.id === revierId)
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
            if (input.invitationToken) await authStore.consumeHuntingDistrictInvitation(input.invitationToken);
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
                  { message: 'Benutzername oder E-Mail-Adresse ist bereits registriert.' },
                  409,
               );
            }
            throw error;
         }
      },
   );

   app.post('/auth/login', zValidator('json', loginSchema), async (context) => {
      const { identifier, password } = context.req.valid('json');
      const user = authStore.findUser(identifier);
      if (!user) return context.json({ message: 'Benutzername oder Passwort ist nicht korrekt.' }, 401);
      if (!user.passwordHash) {
         await createPasswordLink(user);
         return context.json({
            code: 'PASSWORD_SETUP_REQUIRED',
            message: 'Ein Link zum Setzen des Passworts wurde per E-Mail versendet.',
         }, 409);
      }
      if (!(await argon2.verify(user.passwordHash, password))) {
         return context.json({ message: 'Benutzername oder Passwort ist nicht korrekt.' }, 401);
      }
      if (user.status !== 'active') {
         return context.json({
            code: 'PENDING_APPROVAL',
            message: 'Dein Konto wartet noch auf die Freigabe durch einen Administrator.',
         }, 403);
      }
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

   app.post('/auth/password/forgot', zValidator('json', emailSchema), async (context) => {
      const { email } = context.req.valid('json');
      const user = authStore.findUser(email);
      if (user) await createPasswordLink(user);
      return context.json({ message: 'Wenn die E-Mail-Adresse registriert ist, wurde ein Passwort-Link versendet.' });
   });

   app.post(
      '/auth/password/reset',
      zValidator('json', passwordSchema, (result, context) => {
         if (!result.success) return context.json({ message: 'Das Passwort muss mindestens 12 Zeichen lang sein.' }, 400);
      }),
      async (context) => {
         const { token, password } = context.req.valid('json');
         const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
         const wasSet = await authStore.setPassword(token, passwordHash);
         if (!wasSet) return context.json({ message: 'Der Passwort-Link ist ungueltig oder abgelaufen.' }, 400);
         return context.json({ message: 'Passwort gesetzt. Du kannst dich jetzt anmelden.' });
      },
   );

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

   app.post('/auth/refresh', async (context) => {
      const authorization = context.req.header('Authorization');
      if (!authorization?.startsWith('Bearer ')) return context.json({ message: 'Nicht autorisiert.' }, 401);
      try {
         const { payload } = await jwtVerify(authorization.slice(7), authSecret);
         const user = authStore.findUserById(payload.sub ?? '');
         if (!user || user.status !== 'active') return context.json({ message: 'Benutzer nicht gefunden.' }, 401);
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

   app.get('/auth/me', requireAuth, async (context) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      if (!user) return context.json({ message: 'Benutzer nicht gefunden.' }, 404);
      const { passwordHash: _passwordHash, ...profile } = user;
      return context.json({ user: profile });
   });
}
