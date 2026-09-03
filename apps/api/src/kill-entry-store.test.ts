import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KillEntryStore } from './kill-entry-store.js';

const tempDirectories: string[] = [];
afterEach(async () => Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe('KillEntryStore', () => {
   it('creates and sorts entries by date', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'jjtool-strecke-'));
      tempDirectories.push(directory);
      const store = new KillEntryStore(directory);
      await store.initialize();
      await store.create({ revierId: 'revier-1', datum: '2026-01-01', wildart: 'Reh', createdBy: 'user-1' });
      await store.create({ revierId: 'revier-1', datum: '2026-02-01', wildart: 'Fuchs', createdBy: 'user-2' });
      const entries = await store.getByHuntingDistrictId('revier-1');
      assert.deepEqual(entries.map((entry) => entry.wildart), ['Fuchs', 'Reh']);
   });
});
