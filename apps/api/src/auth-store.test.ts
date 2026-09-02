import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthStore } from './auth-store.js';

const tempDirs: string[] = [];

afterEach(async () => {
   await Promise.all(
      tempDirs.splice(0).map((directory) =>
         rm(directory, { recursive: true, force: true }),
      ),
   );
});

describe('AuthStore Revier assignments', () => {
   it('persists assignments and removes a deleted Revier from all users', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'jjtool-auth-'));
      tempDirs.push(directory);
      const store = new AuthStore(directory);
      await store.initialize();
      const user = await store.createUser({
         username: 'mitglied',
         email: 'mitglied@example.test',
         displayName: 'Mitglied',
         status: 'pending',
      });

      await store.approveUser(user.id, 'paechter', undefined, false, [
         'revier-a',
         'revier-b',
         'revier-a',
      ]);
      assert.deepEqual(store.findUserById(user.id)?.memberships.map((membership) => membership.revierId), [
         'revier-a',
         'revier-b',
      ]);

      await store.updateUserRoleAndPosition(
         user.id,
         'paechter',
         'revierleiter',
         true,
         ['revier-a'],
      );
      assert.equal(store.findUserById(user.id)?.memberships[0]?.isAdmin, true);
      assert.equal(store.findUserById(user.id)?.memberships[0]?.position, 'revierleiter');
      assert.deepEqual(store.findUserById(user.id)?.memberships.map((membership) => membership.revierId), ['revier-a']);
      assert.deepEqual(store.getAdminRevierIds(user.id), ['revier-a']);

      await store.updateUserRoleAndPosition(
         user.id,
         'paechter',
         undefined,
         false,
         ['revier-b', 'revier-c'],
      );
      await store.removeRevierAssignments('revier-b');

      await store.setUserBlocked(user.id, true);
      assert.equal(store.findUserById(user.id)?.status, 'blocked');
      await store.setUserBlocked(user.id, false);
      assert.equal(store.findUserById(user.id)?.status, 'active');

      const reloaded = new AuthStore(directory);
      await reloaded.initialize();
      assert.deepEqual(reloaded.findUserById(user.id)?.memberships.map((membership) => membership.revierId), ['revier-c']);
      assert.equal(reloaded.findUserById(user.id)?.status, 'active');
   });

   it('shows Revieradmins only users from their administered Reviere', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'jjtool-auth-'));
      tempDirs.push(directory);
      const store = new AuthStore(directory);
      await store.initialize();
      const administrator = await store.createUser({ username: 'admin-a', email: 'admin-a@example.test', displayName: 'Admin A', status: 'active' });
      const visible = await store.createUser({ username: 'visible', email: 'visible@example.test', displayName: 'Visible', status: 'active' });
      const hidden = await store.createUser({ username: 'hidden', email: 'hidden@example.test', displayName: 'Hidden', status: 'active' });
      await store.upsertMembership(administrator.id, { revierId: 'revier-a', status: 'active', memberType: 'paechter', isAdmin: true });
      await store.upsertMembership(visible.id, { revierId: 'revier-a', status: 'active', memberType: 'bgs', isAdmin: false });
      await store.upsertMembership(hidden.id, { revierId: 'revier-b', status: 'active', memberType: 'guest', isAdmin: false });

      assert.deepEqual(
         store.getUsersForAdmin(administrator.id).map((user) => user.id).sort(),
         [administrator.id, visible.id].sort(),
      );
      assert.deepEqual(store.getMemberDirectory('revier-a'), [
         {
            id: administrator.id,
            displayName: 'Admin A',
            memberType: 'paechter',
            position: undefined,
         },
         {
            id: visible.id,
            displayName: 'Visible',
            memberType: 'bgs',
            position: undefined,
         },
      ]);
      assert.equal('email' in store.getMemberDirectory('revier-a')[0]!, false);
   });

   it('requires a successor before the last Revieradmin can be removed', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'jjtool-auth-'));
      tempDirs.push(directory);
      const store = new AuthStore(directory);
      await store.initialize();
      const first = await store.createUser({ username: 'first-admin', email: 'first@example.test', displayName: 'First', status: 'active' });
      const successor = await store.createUser({ username: 'successor', email: 'successor@example.test', displayName: 'Successor', status: 'active' });
      await store.upsertMembership(first.id, { revierId: 'revier-a', status: 'active', memberType: 'guest', isAdmin: true });

      await assert.rejects(
         () => store.upsertMembership(first.id, { revierId: 'revier-a', status: 'active', memberType: 'guest', isAdmin: false }),
         /LAST_REVIER_ADMIN/,
      );
      await assert.rejects(
         () => store.removeMembership(first.id, 'revier-a'),
         /LAST_REVIER_ADMIN/,
      );

      await store.upsertMembership(successor.id, { revierId: 'revier-a', status: 'active', memberType: 'bgs', isAdmin: true });
      assert.equal(store.countActiveRevierAdmins('revier-a'), 2);
      await store.upsertMembership(first.id, { revierId: 'revier-a', status: 'active', memberType: 'guest', isAdmin: false });
      assert.deepEqual(store.getAdminRevierIds(first.id), []);
      assert.deepEqual(store.getAdminRevierIds(successor.id), ['revier-a']);
   });

   it('normalizes an existing member owner to Pächter and Revieradmin', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'jjtool-auth-'));
      tempDirs.push(directory);
      const store = new AuthStore(directory);
      await store.initialize();
      const owner = await store.createUser({ username: 'owner', email: 'owner@example.test', displayName: 'Owner', status: 'active' });
      await store.upsertMembership(owner.id, { revierId: 'revier-a', status: 'active', memberType: 'guest', isAdmin: true });

      await store.ensureRevierOwner(owner.id, 'revier-a');

      assert.equal(store.findUserById(owner.id)?.memberships[0]?.memberType, 'paechter');
      assert.equal(store.findUserById(owner.id)?.memberships[0]?.isAdmin, true);
   });

   it('stores invitation tokens hashed and allows them only once', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'jjtool-auth-'));
      tempDirs.push(directory);
      const store = new AuthStore(directory);
      await store.initialize();

      const token = await store.createRevierInvitation(
         'revier-a',
         'Invitee@Example.test',
         'admin-a',
      );
      const invitation = store.getRevierInvitation(token);
      assert.equal(invitation?.email, 'invitee@example.test');
      assert.equal(invitation?.revierId, 'revier-a');

      await store.consumeRevierInvitation(token);
      assert.equal(store.getRevierInvitation(token), undefined);
      await assert.rejects(() => store.consumeRevierInvitation(token), /INVITATION_INVALID/);
   });

   it('migrates legacy admins safely and creates a backup', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'jjtool-auth-'));
      tempDirs.push(directory);
      const now = '2026-01-01T00:00:00.000Z';
      await writeFile(join(directory, 'auth.json'), JSON.stringify({
         users: [
            { id: 'system', username: 'admin', email: 'admin@example.test', displayName: 'Admin', role: 'admin', status: 'active', createdAt: now, updatedAt: now },
            { id: 'legacy', username: 'legacy', email: 'legacy@example.test', displayName: 'Legacy', role: 'bgs', status: 'active', isAdmin: true, createdAt: now, updatedAt: now },
         ],
         passwordTokens: [],
         sessions: [],
      }));

      const store = new AuthStore(directory);
      await store.initialize();

      assert.equal(store.findUserById('system')?.accountType, 'systemAdmin');
      assert.equal(store.findUserById('legacy')?.accountType, 'member');
      assert.deepEqual(store.findUserById('legacy')?.memberships, []);
      await access(join(directory, 'auth.json.pre-memberships.bak'));
   });
});