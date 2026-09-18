import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthStore } from './auth-store.js';
import { HuntingDistrictStore } from './hunting-district-store.js';
import { FacilityStore } from './facility-store.js';
import { FacilityTasksStore } from './facility-tasks-store.js';
import { FacilityReservationsStore } from './facility-reservations-store.js';
import { KillEntryStore } from './kill-entry-store.js';
import { buildNewsFeed } from './news-service.js';

const tempDirs: string[] = [];
afterEach(async () => Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

const emptyBoundary = { type: 'FeatureCollection' as const, features: [] };

async function setup() {
   const directory = await mkdtemp(join(tmpdir(), 'jjtool-news-'));
   tempDirs.push(directory);
   const authStore = new AuthStore(directory);
   const huntingDistrictStore = new HuntingDistrictStore(directory);
   const facilityStore = new FacilityStore(directory);
   const taskStore = new FacilityTasksStore(directory);
   const reservationStore = new FacilityReservationsStore(directory);
   const killEntryStore = new KillEntryStore(directory);
   await Promise.all([
      authStore.initialize(),
      huntingDistrictStore.initialize(),
      facilityStore.initialize(),
      taskStore.initialize(),
      reservationStore.initialize(),
      killEntryStore.initialize(),
   ]);

   const owner = await authStore.createUser({ username: 'owner', email: 'owner@example.com', displayName: 'Revierbesitzer', status: 'active' });
   const revier = await huntingDistrictStore.createHuntingDistrict({
      name: 'Testrevier', municipalityName: 'Musterstadt', center: { lat: 50, lng: 10 }, boundary: emptyBoundary, source: 'bkg-wfs-vg25', createdBy: owner.id,
   });
   await authStore.upsertMembership(owner.id, { revierId: revier.id, status: 'active', memberType: 'paechter', isAdmin: true });
   const member = await authStore.createUser({ username: 'member', email: 'member@example.com', displayName: 'Mitglied Eins', status: 'active' });
   await authStore.upsertMembership(member.id, { revierId: revier.id, status: 'active', memberType: 'bgs', isAdmin: false });

   return { directory, authStore, huntingDistrictStore, facilityStore, taskStore, reservationStore, killEntryStore, owner, member, revier };
}

describe('buildNewsFeed', () => {
   it('reports events by others since the last seen timestamp, excluding own actions', async () => {
      const { authStore, huntingDistrictStore, facilityStore, taskStore, reservationStore, killEntryStore, owner, member, revier } = await setup();

      // Baseline event before the member ever checks: falls into the 30-day fallback window and should show up.
      const facility = await facilityStore.create({
         revierId: revier.id, name: 'Kanzel Nord', typ: 'Kanzel', position: { lat: 50, lng: 10 }, status: 'aktiv', createdBy: owner.id,
      });

      const memberUser = authStore.findUserById(member.id)!;
      const firstFeed = await buildNewsFeed(memberUser, { authStore, facilityStore, taskStore, reservationStore, huntingDistrictStore, killEntryStore });
      assert.equal(firstFeed.items.some((item) => item.type === 'facility' && item.text.includes('Kanzel Nord')), true);

      await authStore.markNewsSeen(member.id);

      // The member's own task should never appear in their own feed.
      await taskStore.create({ revierId: revier.id, titel: 'Eigene Aufgabe', prioritaet: 'normal', status: 'offen', assignedBy: member.id });
      // A general task assigned to everyone should appear; one assigned to someone else should not.
      await taskStore.create({ revierId: revier.id, titel: 'Für alle', prioritaet: 'hoch', status: 'offen', assignedBy: owner.id });
      const otherMember = await authStore.createUser({ username: 'other', email: 'other@example.com', displayName: 'Anderes Mitglied', status: 'active' });
      await authStore.upsertMembership(otherMember.id, { revierId: revier.id, status: 'active', memberType: 'bgs', isAdmin: false });
      await taskStore.create({ revierId: revier.id, titel: 'Nur für andere', prioritaet: 'normal', status: 'offen', assignedBy: owner.id, assignedTo: otherMember.id });
      await reservationStore.reserve({ revierId: revier.id, jagdeinrichtungId: facility.id, reservedBy: owner.id });
      await killEntryStore.create({ revierId: revier.id, datum: '2026-09-18', wildart: 'Reh', verwertung: 'eigenverwertung', createdBy: owner.id });

      const refreshedMember = authStore.findUserById(member.id)!;
      const secondFeed = await buildNewsFeed(refreshedMember, { authStore, facilityStore, taskStore, reservationStore, huntingDistrictStore, killEntryStore });
      const texts = secondFeed.items.map((item) => item.text);

      assert.equal(texts.some((text) => text.includes('Eigene Aufgabe')), false);
      assert.equal(texts.some((text) => text.includes('Für alle')), true);
      assert.equal(texts.some((text) => text.includes('Nur für andere')), false);
      assert.equal(texts.some((text) => text.includes('reserviert')), true);
      assert.equal(texts.some((text) => text.includes('Anderes Mitglied')), true);
      assert.equal(texts.some((text) => text.includes('Streckeneintrag: Reh')), true);
      assert.equal(texts.some((text) => text.includes('Neue Einrichtung')), false);
   });

   it('returns nothing for users without an active hunting district membership', async () => {
      const { authStore, huntingDistrictStore, facilityStore, taskStore, reservationStore, killEntryStore } = await setup();
      const loner = await authStore.createUser({ username: 'loner', email: 'loner@example.com', displayName: 'Ohne Revier', status: 'active' });
      const feed = await buildNewsFeed(loner, { authStore, facilityStore, taskStore, reservationStore, huntingDistrictStore, killEntryStore });
      assert.deepEqual(feed, { items: [], count: 0 });
   });
});
