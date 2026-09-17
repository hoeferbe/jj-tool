import { type AuthStore, type User } from '../auth-store.js';
import { type HuntingDistrictStore } from '../hunting-district-store.js';
import { sendPasswordLink } from '../mailer.js';

interface AuthHelperDependencies {
   authStore: AuthStore;
   huntingDistrictStore: HuntingDistrictStore;
   appOrigin: string;
}

export function createAuthHelpers({ authStore, huntingDistrictStore, appOrigin }: AuthHelperDependencies) {
   /** Checks that every given hunting district id still exists (e.g. before assigning a membership to it). */
   async function hasOnlyExistingHuntingDistricts(revierIds: string[] | undefined) {
      if (!revierIds) return true;
      const existingIds = new Set((await huntingDistrictStore.getHuntingDistricts()).map((district) => district.id));
      return revierIds.every((id) => existingIds.has(id));
   }

   /** Generates a password-setup token for the user and e-mails them the one-time link. */
   async function createPasswordLink(user: User) {
      const token = await authStore.createPasswordToken(user.id);
      await sendPasswordLink({
         email: user.email,
         displayName: user.displayName,
         passwordLink: `${appOrigin}/?set-password=${encodeURIComponent(token)}`,
      });
   }

   return { hasOnlyExistingHuntingDistricts, createPasswordLink };
}
