import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FacilityReservationsStore } from './jagdeinrichtung-reservierungen-store.js';

const tempDirs: string[] = [];
afterEach(async () => Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe('JagdeinrichtungReservierungenStore', () => {
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
});