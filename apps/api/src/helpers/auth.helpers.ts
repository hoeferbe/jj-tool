import { type AuthStore, type User } from '../auth-store.js';
import { type RevierStore } from '../revier-store.js';
import { sendPasswordLink } from '../mailer.js';

interface AuthHelperDependencies {
   authStore: AuthStore;
   revierStore: RevierStore;
   appOrigin: string;
}

export function createAuthHelpers({ authStore, revierStore, appOrigin }: AuthHelperDependencies) {
   async function hasOnlyExistingReviere(revierIds: string[] | undefined) {
      if (!revierIds) return true;
      const existingIds = new Set((await revierStore.getReviere()).map((revier) => revier.id));
      return revierIds.every((id) => existingIds.has(id));
   }

   async function createPasswordLink(user: User) {
      const token = await authStore.createPasswordToken(user.id);
      await sendPasswordLink({
         email: user.email,
         displayName: user.displayName,
         passwordLink: `${appOrigin}/?set-password=${encodeURIComponent(token)}`,
      });
   }

   return { hasOnlyExistingReviere, createPasswordLink };
}
