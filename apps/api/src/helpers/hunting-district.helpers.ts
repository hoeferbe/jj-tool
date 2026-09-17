import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import { type AuthStore, type User } from '../auth-store.js';
import { type FacilityStore } from '../facility-store.js';
import { type HuntingDistrict } from '../hunting-district-store.js';

interface HuntingDistrictHelperDependencies {
   authStore: AuthStore;
   facilityStore: FacilityStore;
}

export function createHuntingDistrictHelpers({ authStore, facilityStore }: HuntingDistrictHelperDependencies) {
   /** Whether the user may administer (manage members/settings of) one hunting district. */
   function canAdministerHuntingDistrict(user: User, revierId: string) {
      return user.accountType === 'systemAdmin' || authStore.getAdminHuntingDistrictIds(user.id).includes(revierId);
   }

   /** Whether the user has any active membership (or is a system admin) granting access to one hunting district. */
   function canAccessHuntingDistrict(user: User, revierId: string) {
      return user.accountType === 'systemAdmin' || user.memberships.some(
         (membership) => membership.revierId === revierId && membership.status === 'active',
      );
   }

   /** Whether the user may create facilities in one hunting district (admins, Pächter and BGS; not guests). */
   function canCreateFacility(user: User, revierId: string) {
      if (user.accountType === 'systemAdmin') return true;
      return user.memberships.some((membership) =>
         membership.revierId === revierId &&
         membership.status === 'active' &&
         (membership.isAdmin || membership.memberType === 'paechter' || membership.memberType === 'bgs'),
      );
   }

   /** Whether a map position falls inside any polygon of the district's boundary GeoJSON. */
   function isPointInsideHuntingDistrict(revier: HuntingDistrict, position: { lat: number; lng: number }) {
      const clickedPoint = point([position.lng, position.lat]);
      return revier.boundary.features.some((feature) => {
         if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') return false;
         return booleanPointInPolygon(
            clickedPoint,
            feature as unknown as Feature<Polygon | MultiPolygon>,
         );
      });
   }

   /** Whether the given user id refers to an active account with access to one hunting district. */
   function isActiveHuntingDistrictMember(userId: string, revierId: string) {
      const user = authStore.findUserById(userId);
      return user?.status === 'active' && canAccessHuntingDistrict(user, revierId);
   }

   /** Looks up a facility by id, scoped to one hunting district. Returns `null` if it belongs to another district or doesn't exist. */
   async function getFacilityInHuntingDistrict(revierId: string, facilityId: string) {
      const facility = await facilityStore.getById(facilityId);
      return facility?.revierId === revierId ? facility : null;
   }

   return {
      canAdministerHuntingDistrict,
      canAccessHuntingDistrict,
      canCreateFacility,
      isPointInsideHuntingDistrict,
      isActiveHuntingDistrictMember,
      getFacilityInHuntingDistrict,
   };
}
