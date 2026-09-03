import { type Context, type Next } from 'hono';
import { jwtVerify } from 'jose';
import { type AuthStore } from '../auth-store.js';

export interface AuthPayload {
   sub?: string;
   accountType?: string;
   hasRevierAdminAccess?: boolean;
}

interface AuthMiddlewareDependencies {
   authStore: AuthStore;
   authSecret: Uint8Array;
}

export function createAuthMiddleware({ authStore, authSecret }: AuthMiddlewareDependencies) {
   async function getAuthenticatedPayload(context: Context) {
      const authorization = context.req.header('Authorization');
      if (!authorization?.startsWith('Bearer ')) return null;
      try {
         const { payload } = await jwtVerify(authorization.slice(7), authSecret);
         return payload as AuthPayload;
      } catch {
         return null;
      }
   }

   const requireAuth = async (context: Context, next: Next) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      if (!payload || !payload.sub || user?.status !== 'active') {
         return context.json({ message: 'Nicht autorisiert.' }, 401);
      }
      await next();
   };

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

   const requireSystemAdmin = async (context: Context, next: Next) => {
      const payload = await getAuthenticatedPayload(context);
      const user = payload?.sub ? authStore.findUserById(payload.sub) : undefined;
      if (!user || user.status !== 'active' || user.accountType !== 'systemAdmin') {
         return context.json({ message: 'Nur Systemadministratoren dürfen diese Aktion ausführen.' }, 403);
      }
      await next();
   };

   return { getAuthenticatedPayload, requireAuth, requireAdmin, requireSystemAdmin };
}
