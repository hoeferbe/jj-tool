import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HuntingDistrictStore, type UpsertHuntingDistrictInput } from './revier-store.js';

const tempDirs: string[] = [];

afterEach(async () => {
   await Promise.all(
      tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
   );
});

describe('RevierStore', () => {
   const createInput = (name: string): UpsertHuntingDistrictInput => ({
      name,
      municipalityName: 'Köln',
      municipalityCode: '05315000',
      center: { lat: 50.9374, lng: 6.9603 },
      boundary: {
         type: 'FeatureCollection',
         features: [
            {
               type: 'Feature',
               properties: { gen: 'Köln' },
               geometry: {
                  type: 'Polygon',
                  coordinates: [
                     [
                        [6.9, 50.9],
                        [6.97, 50.9],
                        [6.97, 51.0],
                        [6.9, 51.0],
                        [6.9, 50.9],
                     ],
                  ],
               },
            },
         ],
      },
      source: 'bkg-wfs-vg25',
      createdBy: 'user-123',
   });

   it('persists, updates and deletes multiple reviere independently', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'jjtool-revier-'));
      tempDirs.push(directory);
      const store = new HuntingDistrictStore(directory);
      await store.initialize();

      const north = await store.createHuntingDistrict(createInput('Jagdrevier Nord'));
      const south = await store.createHuntingDistrict(createInput('Jagdrevier Süd'));
      const updated = await store.updateHuntingDistrict(north.id, createInput('Nord neu'));

      assert.equal(updated?.id, north.id);
      assert.equal(updated?.createdAt, north.createdAt);
      assert.equal(updated?.name, 'Nord neu');
      assert.equal((await store.getHuntingDistricts()).length, 2);
      assert.equal(await store.deleteHuntingDistrict(south.id), true);
      assert.equal(await store.deleteHuntingDistrict('unknown'), false);

      const reloaded = new HuntingDistrictStore(directory);
      await reloaded.initialize();
      const loaded = await reloaded.getHuntingDistricts();
      assert.deepEqual(loaded.map((revier) => revier.name), ['Nord neu']);
      assert.equal(loaded[0]?.boundary.features.length, 1);
   });

   it('migrates the legacy single-revier file without losing data', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'jjtool-revier-'));
      tempDirs.push(directory);
      const legacyRevier = {
         id: 'legacy-id',
         ...createInput('Bestehendes Revier'),
         createdAt: '2026-01-01T00:00:00.000Z',
         updatedAt: '2026-01-01T00:00:00.000Z',
      };
      await writeFile(join(directory, 'revier.json'), JSON.stringify({ revier: legacyRevier }));

      const store = new HuntingDistrictStore(directory);
      await store.initialize();

      assert.deepEqual(await store.getHuntingDistricts(), [legacyRevier]);
      const persisted = JSON.parse(await readFile(join(directory, 'revier.json'), 'utf8')) as { reviere: unknown[] };
      assert.equal(persisted.reviere.length, 1);
   });
});
