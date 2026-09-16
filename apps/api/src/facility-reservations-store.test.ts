import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FacilityReservationsStore } from './facility-reservations-store.js';

const tempDirs: string[] = [];
afterEach(async () => Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe('FacilityReservationsStore', () => {
   it('allows one active reservation and releases it', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'jjtool-reservierungen-'));
      tempDirs.push(directory);
      const store = new FacilityReservationsStore(directory);
      await store.initialize();
      await store.reserve({ revierId: 'revier-1', jagdeinrichtungId: 'facility-1', reservedBy: 'user-1' });
      await assert.rejects(
         store.reserve({ revierId: 'revier-1', jagdeinrichtungId: 'facility-1', reservedBy: 'user-2' }),
         /ALREADY_RESERVED/,
      );
      await store.release('facility-1');
      assert.equal(await store.getActiveByFacilityId('facility-1'), null);
   });

   it('supports check-in and check-out without a prior reservation', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'jjtool-checkin-'));
      tempDirs.push(directory);
      const store = new FacilityReservationsStore(directory);
      await store.initialize();

      const checkedIn = await store.checkIn({
         revierId: 'revier-1',
         jagdeinrichtungId: 'facility-2',
         reservedBy: 'user-1',
         checkedInBy: 'user-1',
      });

      assert.equal(checkedIn.checkedInBy, 'user-1');
      assert.equal(checkedIn.checkedInAt !== undefined, true);

      const active = await store.getActiveByFacilityId('facility-2');
      assert.equal(active?.checkedInBy, 'user-1');

      await store.checkOut('facility-2');
      assert.equal(await store.getActiveByFacilityId('facility-2'), null);
   });

   it('supports scheduled reservations and changing or cancelling them', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'jjtool-scheduled-'));
      tempDirs.push(directory);
      const store = new FacilityReservationsStore(directory);
      await store.initialize();
      const reservation = await store.reserve({
         revierId: 'revier-1',
         jagdeinrichtungId: 'facility-3',
         reservedBy: 'user-1',
         startAt: '2030-06-15T18:00:00.000Z',
         endAt: '2030-06-15T20:00:00.000Z',
      });

      assert.equal(reservation.startAt, '2030-06-15T18:00:00.000Z');
      assert.equal(reservation.endAt, '2030-06-15T21:00:00.000Z');
      await store.updateReservation(reservation.id, {
         startAt: '2030-06-16T18:30:00.000Z',
      });
      const updated = await store.getActiveByFacilityId('facility-3');
      assert.equal(updated?.startAt, '2030-06-16T18:30:00.000Z');
      assert.equal(updated?.endAt, '2030-06-16T21:30:00.000Z');
      await assert.rejects(
         store.updateReservation(reservation.id, { startAt: '2030-06-16T18:15:00.000Z' }),
         /INVALID_PERIOD/,
      );
      await store.releaseById(reservation.id);
      assert.equal(await store.getActiveByFacilityId('facility-3'), null);
   });

   it('keeps expired reservations as history but excludes them from active results', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'jjtool-expired-reservierungen-'));
      tempDirs.push(directory);
      const store = new FacilityReservationsStore(directory);
      await store.initialize();
      const reservation = await store.reserve({
         revierId: 'revier-1',
         jagdeinrichtungId: 'facility-4',
         reservedBy: 'user-1',
         startAt: '2020-06-15T18:00:00.000Z',
      });

      assert.deepEqual(await store.getActiveByHuntingDistrictId('revier-1'), []);
      assert.equal(await store.getActiveById(reservation.id), null);
      const checkedIn = await store.checkIn({ revierId: 'revier-1', jagdeinrichtungId: 'facility-4', checkedInBy: 'user-2' });
      assert.equal(checkedIn.id === reservation.id, false);
   });

   it('deletes reservations for one district without affecting another', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'jjtool-delete-reservierungen-'));
      tempDirs.push(directory);
      const store = new FacilityReservationsStore(directory);
      await store.initialize();
      await store.checkIn({ revierId: 'revier-1', jagdeinrichtungId: 'facility-1', checkedInBy: 'user-1' });
      await store.checkIn({ revierId: 'revier-2', jagdeinrichtungId: 'facility-2', checkedInBy: 'user-1' });

      assert.equal(await store.deleteByHuntingDistrictId('revier-1'), 1);
      assert.deepEqual(await store.getActiveByHuntingDistrictId('revier-1'), []);
      assert.equal((await store.getActiveByHuntingDistrictId('revier-2')).length, 1);
   });
});