import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KillEntryStore } from './kill-entry-store.js';

const tempDirectories: string[] = [];
afterEach(async () => Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe('KillEntryStore', () => {
   it('creates and sorts entries by date and time descending', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'jjtool-strecke-'));
      tempDirectories.push(directory);
      const store = new KillEntryStore(directory);
      await store.initialize();
      await store.create({ revierId: 'revier-1', datum: '2026-01-01', uhrzeit: '08:00', wildart: 'Reh', createdBy: 'user-1' });
      await store.create({ revierId: 'revier-1', datum: '2026-01-01', uhrzeit: '18:30', wildart: 'Fuchs', createdBy: 'user-2' });
      await store.create({ revierId: 'revier-1', datum: '2026-02-01', uhrzeit: '06:15', wildart: 'Wildschwein', createdBy: 'user-1' });
      const entries = await store.getByHuntingDistrictId('revier-1');
      assert.deepEqual(entries.map((entry) => entry.wildart), ['Wildschwein', 'Fuchs', 'Reh']);
   });

   it('supports full fields, updates and deletion', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'jjtool-strecke-'));
      tempDirectories.push(directory);
      const store = new KillEntryStore(directory);
      await store.initialize();
      const created = await store.create({
         revierId: 'revier-1',
         datum: '2026-09-11',
         uhrzeit: '14:00',
         wildart: 'Reh',
         unterart: 'Bock',
         geschlecht: 'maennlich',
         istVerkehrsopfer: true,
         bescheinigung: true,
         ortName: 'Waldrand',
         position: { lat: 51.0, lng: 10.0 },
         gewicht: 15.5,
         geschaetztesAlter: '2 Jahre',
         notiz: 'Unfall an der B27',
         createdBy: 'user-1',
      });
      assert.equal(created.unterart, 'Bock');
      assert.equal(created.geschlecht, 'maennlich');
      assert.equal(created.istVerkehrsopfer, true);
      assert.equal(created.gewicht, 15.5);

      const updated = await store.update(created.id, 'revier-1', { gewicht: 17.0, geschaetztesAlter: '3 Jahre', unterart: 'Rehbock' });
      assert.equal(updated?.gewicht, 17.0);
      assert.equal(updated?.geschaetztesAlter, '3 Jahre');
      assert.equal(updated?.unterart, 'Rehbock');

      const deleted = await store.delete(created.id, 'revier-1');
      assert.equal(deleted, true);
      const remaining = await store.getByHuntingDistrictId('revier-1');
      assert.equal(remaining.length, 0);
   });

   it('deletes entries for one district without affecting another', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'jjtool-delete-strecke-'));
      tempDirectories.push(directory);
      const store = new KillEntryStore(directory);
      await store.initialize();
      await store.create({ revierId: 'revier-1', datum: '2026-09-16', wildart: 'Reh', createdBy: 'user-1' });
      await store.create({ revierId: 'revier-2', datum: '2026-09-16', wildart: 'Fuchs', createdBy: 'user-1' });

      assert.equal(await store.deleteByHuntingDistrictId('revier-1'), 1);
      assert.deepEqual(await store.getByHuntingDistrictId('revier-1'), []);
      assert.equal((await store.getByHuntingDistrictId('revier-2')).length, 1);
   });
});
