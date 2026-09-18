import { type AuthStore, type User } from './auth-store.js';
import { type FacilityStore } from './facility-store.js';
import { type FacilityTasksStore } from './facility-tasks-store.js';
import { type FacilityReservationsStore } from './facility-reservations-store.js';
import { type HuntingDistrictStore } from './hunting-district-store.js';
import { type KillEntryStore } from './kill-entry-store.js';

export type NewsItemType = 'facility' | 'revierAufgabe' | 'einrichtungsAufgabe' | 'reservierung' | 'mitglied' | 'streckeneintrag';

export interface NewsItem {
   id: string;
   type: NewsItemType;
   revierId: string;
   revierName: string;
   text: string;
   createdAt: string;
}

export interface NewsFeed {
   items: NewsItem[];
   count: number;
}

interface NewsServiceDependencies {
   authStore: AuthStore;
   facilityStore: FacilityStore;
   taskStore: FacilityTasksStore;
   reservationStore: FacilityReservationsStore;
   huntingDistrictStore: HuntingDistrictStore;
   killEntryStore: KillEntryStore;
}

// Cap how far back news reach for users who never checked before, so old accounts don't get a huge backlog.
const FALLBACK_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const ITEM_LIMIT = 30;

/**
 * Aggregates events across all of the user's active hunting districts that happened
 * after their last "seen" timestamp (or a 30-day fallback for first-time checks).
 */
export async function buildNewsFeed(user: User, dependencies: NewsServiceDependencies): Promise<NewsFeed> {
   const activeRevierIds = user.memberships
      .filter((membership) => membership.status === 'active')
      .map((membership) => membership.revierId);
   if (!activeRevierIds.length) return { items: [], count: 0 };

   const fallbackSince = Math.max(Date.parse(user.createdAt), Date.now() - FALLBACK_WINDOW_MS);
   const sinceMs = user.lastNewsSeenAt ? Date.parse(user.lastNewsSeenAt) : fallbackSince;

   const districts = await dependencies.huntingDistrictStore.getHuntingDistricts();
   const districtName = (revierId: string) => districts.find((district) => district.id === revierId)?.name ?? 'Unbekanntes Revier';

   const items: NewsItem[] = [];

   for (const revierId of activeRevierIds) {
      const revierName = districtName(revierId);
      const facilities = await dependencies.facilityStore.getByHuntingDistrictId(revierId);

      for (const facility of facilities) {
         if (facility.createdBy === user.id || Date.parse(facility.createdAt) <= sinceMs) continue;
         items.push({
            id: `facility-${facility.id}`,
            type: 'facility',
            revierId,
            revierName,
            text: `Neue Einrichtung „${facility.name}“ angelegt`,
            createdAt: facility.createdAt,
         });
      }

      const tasks = await dependencies.taskStore.getByHuntingDistrictId(revierId);
      for (const task of tasks) {
         if (task.assignedBy === user.id || Date.parse(task.createdAt) <= sinceMs) continue;
         if (task.assignedTo && task.assignedTo !== user.id) continue;
         const facilityName = task.jagdeinrichtungId
            ? facilities.find((facility) => facility.id === task.jagdeinrichtungId)?.name
            : undefined;
         const audience = task.assignedTo ? 'für dich' : 'für euch alle';
         items.push({
            id: `task-${task.id}`,
            type: facilityName ? 'einrichtungsAufgabe' : 'revierAufgabe',
            revierId,
            revierName,
            text: facilityName
               ? `Neue Aufgabe „${task.titel}“ bei ${facilityName} ${audience}`
               : `Neue Revieraufgabe „${task.titel}“ ${audience}`,
            createdAt: task.createdAt,
         });
      }

      const activeReservations = await dependencies.reservationStore.getActiveByHuntingDistrictId(revierId);
      for (const reservation of activeReservations) {
         if (reservation.reservedBy === user.id || Date.parse(reservation.reservedAt) <= sinceMs) continue;
         const facilityName = facilities.find((facility) => facility.id === reservation.jagdeinrichtungId)?.name ?? 'einer Einrichtung';
         const reservedByName = dependencies.authStore.findUserById(reservation.reservedBy)?.displayName ?? 'Ein Mitglied';
         items.push({
            id: `reservation-${reservation.id}`,
            type: 'reservierung',
            revierId,
            revierName,
            text: `${reservedByName} hat „${facilityName}“ reserviert`,
            createdAt: reservation.reservedAt,
         });
      }

      for (const otherUser of dependencies.authStore.getAllUsers()) {
         if (otherUser.id === user.id || otherUser.status !== 'active') continue;
         const membership = otherUser.memberships.find((entry) => entry.revierId === revierId && entry.status === 'active');
         if (!membership || Date.parse(membership.createdAt) <= sinceMs) continue;
         items.push({
            id: `member-${otherUser.id}-${revierId}`,
            type: 'mitglied',
            revierId,
            revierName,
            text: `${otherUser.displayName} ist dem Revier ${revierName} beigetreten`,
            createdAt: membership.createdAt,
         });
      }

      const killEntries = await dependencies.killEntryStore.getByHuntingDistrictId(revierId);
      for (const killEntry of killEntries) {
         if (killEntry.createdBy === user.id || Date.parse(killEntry.createdAt) <= sinceMs) continue;
         items.push({
            id: `kill-entry-${killEntry.id}`,
            type: 'streckeneintrag',
            revierId,
            revierName,
            text: `Neuer Streckeneintrag: ${killEntry.wildart}`,
            createdAt: killEntry.createdAt,
         });
      }
   }

   items.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
   return { items: items.slice(0, ITEM_LIMIT), count: items.length };
}
