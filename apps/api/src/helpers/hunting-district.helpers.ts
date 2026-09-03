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
   function canAdministerHuntingDistrict(user: User, revierId: string) {
      return user.accountType === 'systemAdmin' || authStore.getAdminHuntingDistrictIds(user.id).includes(revierId);
   }

   function canAccessHuntingDistrict(user: User, revierId: string) {
      return user.accountType === 'systemAdmin' || user.memberships.some(
         (membership) => membership.revierId === revierId && membership.status === 'active',
      );
   }

   function canCreateFacility(user: User, revierId: string) {
      if (user.accountType === 'systemAdmin') return true;
      return user.memberships.some((membership) =>
         membership.revierId === revierId &&
         membership.status === 'active' &&
         (membership.isAdmin || membership.memberType === 'paechter' || membership.memberType === 'bgs'),
      );
   }

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

   function isActiveHuntingDistrictMember(userId: string, revierId: string) {
      const user = authStore.findUserById(userId);
      return user?.status === 'active' && canAccessHuntingDistrict(user, revierId);
   }

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
