import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ImageStore } from './image-store.js';

const tempDirs: string[] = [];
afterEach(async () => Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

async function setup() {
   const directory = await mkdtemp(join(tmpdir(), 'jjtool-bilder-'));
   tempDirs.push(directory);
   const store = new ImageStore(directory);
   await store.initialize();
   return store;
}

describe('ImageStore', () => {
   it('stores an uploaded image file alongside its metadata', async () => {
      const store = await setup();
      const record = await store.create({
         revierId: 'revier-1', entityType: 'jagdeinrichtung', entityId: 'facility-1',
         mimeType: 'image/jpeg', extension: '.jpg', buffer: new Uint8Array([1, 2, 3]), createdBy: 'user-1',
      });
      assert.equal(record.size, 3);
      assert.deepEqual(await readdir(store.imagesDirectory), [record.fileName]);
      assert.equal((await store.getByEntity('jagdeinrichtung', 'facility-1')).length, 1);
      assert.equal(await store.getById(record.id).then((entry) => entry?.id), record.id);
   });

   it('rejects a fourth image for the same entity', async () => {
      const store = await setup();
      for (let index = 0; index < 3; index += 1) {
         await store.create({
            revierId: 'revier-1', entityType: 'streckeneintrag', entityId: 'entry-1',
            mimeType: 'image/jpeg', extension: '.jpg', buffer: new Uint8Array([index]), createdBy: 'user-1',
         });
      }
      await assert.rejects(
         () => store.create({
            revierId: 'revier-1', entityType: 'streckeneintrag', entityId: 'entry-1',
            mimeType: 'image/jpeg', extension: '.jpg', buffer: new Uint8Array([9]), createdBy: 'user-1',
         }),
         /TOO_MANY_IMAGES/,
      );
   });

   it('deletes one image file and metadata entry', async () => {
      const store = await setup();
      const record = await store.create({
         revierId: 'revier-1', entityType: 'jagdeinrichtung', entityId: 'facility-1',
         mimeType: 'image/png', extension: '.png', buffer: new Uint8Array([1]), createdBy: 'user-1',
      });
      assert.equal(await store.delete(record.id), true);
      assert.equal(await store.getById(record.id), null);
      assert.deepEqual(await readdir(store.imagesDirectory), []);
   });

   it('deletes all images of one entity without affecting another', async () => {
      const store = await setup();
      await store.create({ revierId: 'revier-1', entityType: 'jagdeinrichtung', entityId: 'facility-1', mimeType: 'image/jpeg', extension: '.jpg', buffer: new Uint8Array([1]), createdBy: 'user-1' });
      await store.create({ revierId: 'revier-1', entityType: 'jagdeinrichtung', entityId: 'facility-2', mimeType: 'image/jpeg', extension: '.jpg', buffer: new Uint8Array([2]), createdBy: 'user-1' });

      assert.equal(await store.deleteByEntity('jagdeinrichtung', 'facility-1'), 1);
      assert.deepEqual(await store.getByEntity('jagdeinrichtung', 'facility-1'), []);
      assert.equal((await store.getByEntity('jagdeinrichtung', 'facility-2')).length, 1);
   });
});
