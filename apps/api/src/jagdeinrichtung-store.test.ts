import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FacilityStore, type UpsertFacilityInput } from './jagdeinrichtung-store.js';

const tempDirs: string[] = [];

afterEach(async () => {
   await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('JagdeinrichtungStore', () => {
   const createInput = (name: string, revierId = 'revier-1'): UpsertFacilityInput => ({
      revierId,
      name,
      typ: 'Kanzel',
      position: { lat: 50.9, lng: 6.9 },
      status: 'aktiv',
      createdBy: 'user-1',
   });

   it('persists, filters, updates and deletes facilities', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'jjtool-jagdeinrichtung-'));
      tempDirs.push(directory);
      const store = new FacilityStore(directory);
      await store.initialize();

      const first = await store.create(createInput('Kanzel Nord'));
      const second = await store.create(createInput('Kirrung Süd', 'revier-2'));
      const updated = await store.update(first.id, { ...createInput('Kanzel Nord defekt'), status: 'defekt' });

      assert.equal(updated?.id, first.id);
      assert.equal(updated?.createdAt, first.createdAt);
      assert.equal(updated?.status, 'defekt');
      assert.deepEqual((await store.getByRevierId('revier-1')).map((entry) => entry.name), ['Kanzel Nord defekt']);
      assert.equal(await store.delete(second.id), true);
      assert.equal(await store.delete('unknown'), false);

      const reloaded = new FacilityStore(directory);
      await reloaded.initialize();
      assert.equal((await reloaded.getByRevierId('revier-1'))[0]?.name, 'Kanzel Nord defekt');
      assert.equal(JSON.parse(await readFile(join(directory, 'jagdeinrichtungen.json'), 'utf8')).jagdeinrichtungen.length, 1);
   });
});