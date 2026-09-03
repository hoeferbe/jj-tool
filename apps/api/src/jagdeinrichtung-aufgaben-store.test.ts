import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FacilityTasksStore } from './jagdeinrichtung-aufgaben-store.js';

const tempDirs: string[] = [];
afterEach(async () => Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe('JagdeinrichtungAufgabenStore', () => {
   it('creates, claims and completes a task', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'jjtool-aufgaben-'));
      tempDirs.push(directory);
      const store = new FacilityTasksStore(directory);
      await store.initialize();
      const task = await store.create({
         revierId: 'revier-1', jagdeinrichtungId: 'facility-1', titel: 'Leiter prüfen',
         status: 'offen', assignedBy: 'user-1',
      });
      const claimed = await store.update(task.id, { assignedTo: 'user-2', status: 'in Bearbeitung' });
      assert.equal(claimed?.assignedTo, 'user-2');
      const completed = await store.update(task.id, { status: 'erledigt' });
      assert.equal(completed?.completedAt !== undefined, true);
      assert.equal((await store.getByRevierId('revier-1')).length, 1);
   });
});