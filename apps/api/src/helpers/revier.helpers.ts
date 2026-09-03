import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import { type AuthStore, type User } from '../auth-store.js';
import { type JagdeinrichtungStore } from '../jagdeinrichtung-store.js';
import { type Revier } from '../revier-store.js';

interface RevierHelperDependencies {
   authStore: AuthStore;
   jagdeinrichtungStore: JagdeinrichtungStore;
}

export function createRevierHelpers({ authStore, jagdeinrichtungStore }: RevierHelperDependencies) {
   function canAdministerRevier(user: User, revierId: string) {
      return user.accountType === 'systemAdmin' || authStore.getAdminRevierIds(user.id).includes(revierId);
   }

   function canAccessRevier(user: User, revierId: string) {
      return user.accountType === 'systemAdmin' || user.memberships.some(
         (membership) => membership.revierId === revierId && membership.status === 'active',
      );
   }

   function canCreateJagdeinrichtung(user: User, revierId: string) {
      if (user.accountType === 'systemAdmin') return true;
      return user.memberships.some((membership) =>
         membership.revierId === revierId &&
         membership.status === 'active' &&
         (membership.isAdmin || membership.memberType === 'paechter' || membership.memberType === 'bgs'),
      );
   }

   function isPointInsideRevier(revier: Revier, position: { lat: number; lng: number }) {
      const clickedPoint = point([position.lng, position.lat]);
      return revier.boundary.features.some((feature) => {
         if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') return false;
         return booleanPointInPolygon(
            clickedPoint,
            feature as unknown as Feature<Polygon | MultiPolygon>,
         );
      });
   }

   function isActiveRevierMember(userId: string, revierId: string) {
      const user = authStore.findUserById(userId);
      return user?.status === 'active' && canAccessRevier(user, revierId);
   }

   async function getFacilityInRevier(revierId: string, facilityId: string) {
      const facility = await jagdeinrichtungStore.getById(facilityId);
      return facility?.revierId === revierId ? facility : null;
   }

   return {
      canAdministerRevier,
      canAccessRevier,
      canCreateJagdeinrichtung,
      isPointInsideRevier,
      isActiveRevierMember,
      getFacilityInRevier,
   };
}
