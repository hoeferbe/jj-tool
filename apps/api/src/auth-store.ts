import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Possible membership roles within the hunting group. */
export type MembershipType = 'paechter' | 'bgs' | 'guest';
export type UserRole = 'admin' | MembershipType;
/** Account lifecycle state: pending = awaiting admin approval, active = approved. */
export type UserStatus = 'active' | 'pending' | 'blocked';
/** Optional organisational position a member can hold. */
export type OrganizationalRole = 'revierleiter' | 'kassenwart' | 'schriftfuehrer';
export type AccountType = 'systemAdmin' | 'member';
export type MembershipStatus = 'active' | 'pending';
export type NewsSection = 'karte' | 'mitglieder' | 'einrichtungen' | 'aufgaben' | 'strecke';

export interface HuntingDistrictMembership {
   revierId: string;
   status: MembershipStatus;
   memberType: MembershipType;
   position?: OrganizationalRole;
   isAdmin: boolean;
   source: 'migration' | 'invitation' | 'systemAdmin';
   createdAt: string;
   updatedAt: string;
}

/** Full user record as stored in auth.json (passwordHash excluded from API responses). */
export interface User {
   id: string;
   username: string;
   email: string;
   displayName: string;
   passwordHash?: string;
   accountType: AccountType;
   status: UserStatus;
   memberships: HuntingDistrictMembership[];
   lastLoginAt?: string;
   lastNewsSeenAt?: string;
   sectionNewsSeenAt?: Partial<Record<NewsSection, string>>;
   createdAt: string;
   updatedAt: string;
}

/** One-time token for password setup / reset (stored as SHA-256 hash). */
interface PasswordToken {
   id: string;
   userId: string;
   tokenHash: string;
   expiresAt: string;
}

/** Represents a browser session created on login and removed on logout. */
interface Session {
   id: string;
   userId: string;
   createdAt: string;
}

interface HuntingDistrictInvitation {
   id: string;
   revierId: string;
   email: string;
   tokenHash: string;
   invitedBy: string;
   expiresAt: string;
   usedAt?: string;
}

/** Shape of the persisted auth.json file. */
interface AuthData {
   users: User[];
   passwordTokens: PasswordToken[];
   sessions: Session[];
   invitations: HuntingDistrictInvitation[];
}

const emptyData = (): AuthData => ({
   users: [],
   passwordTokens: [],
   sessions: [],
   invitations: [],
});

/** SHA-256 hash used for password-reset tokens so plaintext never hits disk. */
const hashToken = (token: string) =>
   createHash('sha256').update(token).digest('hex');

/**
 * In-memory store for all auth data backed by a single JSON file.
 * All writes go through a serial queue so concurrent requests never corrupt the file.
 */
export class AuthStore {
   private data: AuthData = emptyData();
   /** Serialises all write operations to prevent race conditions. */
   private writeQueue = Promise.resolve();
   private readonly filePath: string;

   constructor(dataDirectory: string) {
      this.filePath = join(dataDirectory, 'auth.json');
   }

   /**
    * Loads auth.json from disk into memory.
    * Creates the file if it does not exist yet.
    * Runs data migrations for schema changes.
    */
   async initialize() {
      await mkdir(dirname(this.filePath), { recursive: true });

      try {
         const stored = JSON.parse(
            await readFile(this.filePath, 'utf8'),
         ) as AuthData;
         this.data = stored;
         // Older files may not have a sessions array yet.
         this.data.sessions ??= [];
         this.data.invitations ??= [];
         const invitationCount = this.data.invitations.length;
         this.data.invitations = this.data.invitations.filter(
            (invitation) => !invitation.usedAt && Date.parse(invitation.expiresAt) > Date.now(),
         );
         const legacyUsers = this.data.users.filter(
            (user) => !user.accountType || !Array.isArray(user.memberships),
         );
         if (legacyUsers.length > 0) {
            await copyFile(this.filePath, `${this.filePath}.pre-memberships.bak`);
            for (const user of legacyUsers) {
               const legacy = user as User & {
                  role?: UserRole | 'member';
                  position?: OrganizationalRole;
                  isAdmin?: boolean;
                  revierIds?: string[];
               };
               const now = new Date().toISOString();
               const memberType: MembershipType = legacy.role === 'bgs' || legacy.role === 'guest'
                  ? legacy.role
                  : 'paechter';
               legacy.accountType = legacy.role === 'admin' ? 'systemAdmin' : 'member';
               legacy.memberships = (legacy.revierIds ?? []).map((revierId) => ({
                  revierId,
                  status: 'active',
                  memberType,
                  position: legacy.position,
                  isAdmin: legacy.isAdmin === true,
                  source: 'migration',
                  createdAt: legacy.createdAt,
                  updatedAt: now,
               }));
               delete (legacy as { role?: UserRole }).role;
               delete (legacy as { position?: OrganizationalRole }).position;
               delete (legacy as { isAdmin?: boolean }).isAdmin;
               delete (legacy as { revierIds?: string[] }).revierIds;
            }
         }
         let normalizedGuestMemberships = false;
         for (const user of this.data.users) {
            for (const membership of user.memberships) {
               if (membership.memberType !== 'guest' || (!membership.position && !membership.isAdmin)) continue;
               membership.position = undefined;
               membership.isAdmin = false;
               membership.updatedAt = new Date().toISOString();
               normalizedGuestMemberships = true;
            }
         }
         if (legacyUsers.length > 0 || normalizedGuestMemberships || invitationCount !== this.data.invitations.length) await this.persist();
      } catch (error: unknown) {
         // ENOENT means first run – bootstrap an empty file.
         if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
         }
         await this.persist();
      }
   }

   /**
    * Finds a user by username or e-mail (case-insensitive).
    * @param identifier - Username or e-mail address.
    */
   findUser(identifier: string) {
      const normalized = identifier.trim().toLowerCase();
      return this.data.users.find(
         (user) =>
            user.username.toLowerCase() === normalized ||
            user.email.toLowerCase() === normalized,
      );
   }

   /**
    * Finds a user by their UUID.
    * @param id - The user's UUID.
    */
   findUserById(id: string) {
      return this.data.users.find((user) => user.id === id);
   }

   /**
    * Creates a new user account.
    * Throws `USER_EXISTS` if the username or e-mail is already taken.
    */
   async createUser(
      input: Pick<
         User,
         'username' | 'email' | 'displayName' | 'status'
      > & { accountType?: AccountType },
   ) {
      return this.enqueue(async () => {
         if (
            this.findUser(input.username) ||
            this.data.users.some(
               (user) => user.email.toLowerCase() === input.email.toLowerCase(),
            )
         ) {
            throw new Error('USER_EXISTS');
         }

         const now = new Date().toISOString();
         const user: User = {
            id: randomUUID(),
            ...input,
            accountType: input.accountType ?? 'member',
            memberships: [],
            createdAt: now,
            updatedAt: now,
         };
         this.data.users.push(user);
         return user;
      });
   }

   /**
    * Generates a secure one-time password-setup link token (valid 24 hours).
    * Removes any existing tokens for the same user before creating a new one.
    */
   async createPasswordToken(userId: string) {
      return this.enqueue(async () => {
         const token = randomBytes(32).toString('base64url');
         const now = Date.now();
         // Purge old tokens for this user and any globally expired tokens.
         this.data.passwordTokens = this.data.passwordTokens.filter(
            (entry) =>
               entry.userId !== userId && Date.parse(entry.expiresAt) > now,
         );
         this.data.passwordTokens.push({
            id: randomUUID(),
            userId,
            tokenHash: hashToken(token),
            expiresAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
         });
         return token;
      });
   }

   /**
    * Creates a hashed, one-time invitation link token for joining a hunting district (valid 7 days).
    * Removes any expired invitations for the same e-mail/district before creating a new one.
    */
   async createHuntingDistrictInvitation(revierId: string, email: string, invitedBy: string) {
      return this.enqueue(async () => {
         const token = randomBytes(32).toString('base64url');
         const normalizedEmail = email.trim().toLowerCase();
         this.data.invitations = this.data.invitations.filter(
            (invitation) =>
               Date.parse(invitation.expiresAt) > Date.now() &&
               (invitation.email !== normalizedEmail || invitation.revierId !== revierId),
         );
         this.data.invitations.push({
            id: randomUUID(),
            revierId,
            email: normalizedEmail,
            tokenHash: hashToken(token),
            invitedBy,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
         });
         return token;
      });
   }

   /** Finds a valid (unused, unexpired) hunting district invitation by its token. */
   getHuntingDistrictInvitation(token: string) {
      const tokenHash = hashToken(token);
      return this.data.invitations.find(
         (invitation) =>
            invitation.tokenHash === tokenHash &&
            !invitation.usedAt &&
            Date.parse(invitation.expiresAt) > Date.now(),
      );
   }

   /**
    * Marks a hunting district invitation as used and removes it.
    * Throws `INVITATION_INVALID` if the token is unknown, used, or expired.
    */
   async consumeHuntingDistrictInvitation(token: string) {
      return this.enqueue(async () => {
         const invitation = this.getHuntingDistrictInvitation(token);
         if (!invitation) throw new Error('INVITATION_INVALID');
         this.data.invitations = this.data.invitations.filter(
            (entry) => entry.id !== invitation.id,
         );
         return invitation;
      });
   }

   /**
    * Validates a password-reset token and sets the new password hash.
    * Returns `false` if the token is invalid or expired.
    */
   async setPassword(token: string, passwordHash: string) {
      return this.enqueue(async () => {
         const now = Date.now();
         const tokenHash = hashToken(token);
         const tokenIndex = this.data.passwordTokens.findIndex(
            (entry) =>
               entry.tokenHash === tokenHash &&
               Date.parse(entry.expiresAt) > now,
         );
         if (tokenIndex === -1) {
            return false;
         }

         const passwordToken = this.data.passwordTokens[tokenIndex];
         const user = this.data.users.find(
            (entry) => entry.id === passwordToken.userId,
         );
         if (!user) {
            return false;
         }

         user.passwordHash = passwordHash;
         user.updatedAt = new Date(now).toISOString();
         // Invalidate all tokens for this user after a successful password set.
         this.data.passwordTokens = this.data.passwordTokens.filter(
            (entry) => entry.userId !== user.id,
         );
         return true;
      });
   }

   /**
    * Updates a user's profile fields.
    * Throws `USER_NOT_FOUND` or `USER_EXISTS` on conflict.
    * Invalidates all password-reset tokens for the user.
    */
   async updateUser(
      userId: string,
      input: Pick<
         User,
         'username' | 'email' | 'displayName' | 'accountType' | 'status'
      >,
   ) {
      return this.enqueue(async () => {
         const user = this.data.users.find((entry) => entry.id === userId);
         if (!user) {
            throw new Error('USER_NOT_FOUND');
         }
         // Ensure no other user already owns the new username or e-mail.
         const duplicate = this.data.users.find(
            (entry) =>
               entry.id !== userId &&
               (entry.username.toLowerCase() === input.username.toLowerCase() ||
                  entry.email.toLowerCase() === input.email.toLowerCase()),
         );
         if (duplicate) {
            throw new Error('USER_EXISTS');
         }
         Object.assign(user, input, {
            passwordHash: undefined,
            updatedAt: new Date().toISOString(),
         });
         // Profile change invalidates any outstanding password tokens.
         this.data.passwordTokens = this.data.passwordTokens.filter(
            (entry) => entry.userId !== userId,
         );
         return user;
      });
   }

   /**
    * Updates the display name and e-mail a user can change themselves (login name stays fixed).
    * Throws `USER_NOT_FOUND` or `USER_EXISTS` on conflict, and invalidates outstanding password tokens.
    */
   async updateOwnProfile(
      userId: string,
      input: Pick<User, 'email' | 'displayName'>,
   ) {
      return this.enqueue(async () => {
         const user = this.data.users.find((entry) => entry.id === userId);
         if (!user) throw new Error('USER_NOT_FOUND');
         const email = input.email.trim().toLowerCase();
         const duplicate = this.data.users.some(
            (entry) => entry.id !== userId && entry.email.toLowerCase() === email,
         );
         if (duplicate) throw new Error('USER_EXISTS');
         user.email = email;
         user.displayName = input.displayName.trim();
         user.updatedAt = new Date().toISOString();
         this.data.passwordTokens = this.data.passwordTokens.filter(
            (entry) => entry.userId !== userId,
         );
         return user;
      });
   }

   /**
    * Returns all users (without passwordHash) enriched with a live `isOnline` flag.
    * Sessions older than the JWT lifetime (7 days) are treated as stale and ignored.
    */
   getAllUsers() {
      const jwtTtl = 7 * 24 * 60 * 60 * 1000;
      const onlineIds = new Set(
         this.data.sessions
            .filter((s) => Date.now() - new Date(s.createdAt).getTime() < jwtTtl)
            .map((s) => s.userId),
      );
      return this.data.users.map(({ passwordHash: _h, ...user }) => ({
         ...user,
         isOnline: onlineIds.has(user.id),
      }));
   }

   /**
    * Creates a browser session for the given user.
    * Removes any previous sessions for the same user (one active session at a time).
    * @returns The new session ID stored in the client's localStorage.
    */
   async createSession(userId: string) {
      return this.enqueue(async () => {
         // One active session per user – remove any leftover sessions before creating a new one.
         this.data.sessions = this.data.sessions.filter((s) => s.userId !== userId);
         const session = {
            id: randomUUID(),
            userId,
            createdAt: new Date().toISOString(),
         };
         this.data.sessions.push(session);
         return session.id;
      });
   }

   /**
    * Removes a single session by its ID.
    * Use `deleteUserSessions` instead to log out from all devices at once.
    */
   async deleteSession(sessionId: string) {
      return this.enqueue(async () => {
         this.data.sessions = this.data.sessions.filter(
            (s) => s.id !== sessionId,
         );
      });
   }

   /**
    * Removes all sessions for a user (full logout, all devices).
    * Called by the /auth/logout endpoint using the JWT subject claim.
    */
   async deleteUserSessions(userId: string) {
      return this.enqueue(async () => {
         this.data.sessions = this.data.sessions.filter(
            (s) => s.userId !== userId,
         );
      });
   }

   /**
    * Approves a pending registration: sets status to active and assigns role/position.
    * Guests cannot receive the isAdmin flag.
    */
   async approveUser(
      userId: string,
      role: UserRole,
      position?: OrganizationalRole | null,
      isAdmin = false,
      revierIds: string[] = [],
   ) {
      return this.enqueue(async () => {
         const user = this.data.users.find((entry) => entry.id === userId);
         if (!user) {
            throw new Error('USER_NOT_FOUND');
         }
         if (role === 'guest' && (position || isAdmin)) {
            throw new Error('GUEST_PRIVILEGES');
         }
         user.status = 'active';
         if (role === 'admin') {
            user.accountType = 'systemAdmin';
            user.memberships = [];
         } else {
            user.accountType = 'member';
            const now = new Date().toISOString();
            user.memberships = [...new Set(revierIds)].map((revierId) => ({
               revierId,
               status: 'active',
               memberType: role,
               position: role === 'guest' ? undefined : position ?? undefined,
               isAdmin: role === 'guest' ? false : isAdmin,
               source: 'systemAdmin',
               createdAt: now,
               updatedAt: now,
            }));
         }
         user.updatedAt = new Date().toISOString();
         return user;
      });
   }

   /**
    * Permanently removes a user and all associated tokens / sessions.
    * Typically used when rejecting a pending registration.
    */
   async deleteUser(userId: string) {
      return this.enqueue(async () => {
         const index = this.data.users.findIndex(
            (entry) => entry.id === userId,
         );
         if (index === -1) {
            throw new Error('USER_NOT_FOUND');
         }
         const deletedEmail = this.data.users[index]!.email.trim().toLowerCase();
         this.data.users.splice(index, 1);
         // Cascade: clean up all authentication data tied to the deleted user.
         this.data.passwordTokens = this.data.passwordTokens.filter(
            (entry) => entry.userId !== userId,
         );
         this.data.sessions = this.data.sessions.filter(
            (entry) => entry.userId !== userId,
         );
         this.data.invitations = this.data.invitations.filter(
            (entry) => entry.email !== deletedEmail && entry.invitedBy !== userId,
         );
      });
   }

   /**
    * Blocks or unblocks a user account. Blocking revokes all active sessions.
    * Throws `USER_NOT_FOUND` or `USER_NOT_ACTIVE` (pending accounts cannot be blocked).
    */
   async setUserBlocked(userId: string, blocked: boolean) {
      return this.enqueue(async () => {
         const user = this.data.users.find((entry) => entry.id === userId);
         if (!user) throw new Error('USER_NOT_FOUND');
         if (user.status === 'pending') throw new Error('USER_NOT_ACTIVE');
         user.status = blocked ? 'blocked' : 'active';
         user.updatedAt = new Date().toISOString();
         if (blocked) {
            this.data.sessions = this.data.sessions.filter(
               (session) => session.userId !== userId,
            );
         }
         return user;
      });
   }

   /**
    * Updates a user's role, position, and optional admin flag.
    * Guests are automatically stripped of any isAdmin flag.
    * If `isAdmin` is omitted the existing value is preserved.
    */
   async updateUserRoleAndPosition(
      userId: string,
      role: UserRole,
      position?: OrganizationalRole | null,
      isAdmin?: boolean,
      revierIds?: string[],
   ) {
      return this.enqueue(async () => {
         const user = this.data.users.find((entry) => entry.id === userId);
         if (!user) {
            throw new Error('USER_NOT_FOUND');
         }
         if (role === 'guest' && (position || isAdmin)) {
            throw new Error('GUEST_PRIVILEGES');
         }
         if (role === 'admin') {
            user.accountType = 'systemAdmin';
            user.memberships = [];
         } else if (revierIds !== undefined) {
            const existing = new Map(user.memberships.map((membership) => [membership.revierId, membership]));
            const now = new Date().toISOString();
            user.accountType = 'member';
            user.memberships = [...new Set(revierIds)].map((revierId) => ({
               revierId,
               status: 'active',
               memberType: role,
               position: role === 'guest' ? undefined : position ?? undefined,
               isAdmin: role === 'guest' ? false : isAdmin ?? existing.get(revierId)?.isAdmin ?? false,
               source: existing.get(revierId)?.source ?? 'systemAdmin',
               createdAt: existing.get(revierId)?.createdAt ?? now,
               updatedAt: now,
            }));
         }
         user.updatedAt = new Date().toISOString();
         return user;
      });
   }

   /** Removes every user's membership in one hunting district (used when the district itself is deleted). */
   async removeHuntingDistrictAssignments(revierId: string) {
      return this.enqueue(async () => {
         for (const user of this.data.users) {
            if (!user.memberships.some((membership) => membership.revierId === revierId)) continue;
            user.memberships = user.memberships.filter((membership) => membership.revierId !== revierId);
            user.updatedAt = new Date().toISOString();
         }
      });
   }

   /** Returns the ids of all hunting districts where the user has an active admin membership. */
   getAdminHuntingDistrictIds(userId: string) {
      return this.findUserById(userId)?.memberships
         .filter((membership) => membership.status === 'active' && membership.isAdmin)
         .map((membership) => membership.revierId) ?? [];
   }

   /** Counts active users with an active admin membership in one hunting district. */
   countActiveHuntingDistrictAdmins(revierId: string) {
      return this.data.users.filter(
         (user) =>
            user.status === 'active' &&
            user.memberships.some(
               (membership) =>
                  membership.revierId === revierId &&
                  membership.status === 'active' &&
                  membership.isAdmin,
            ),
      ).length;
   }

   /** Returns the ids of hunting districts where the user is the last remaining admin (used to block self-removal). */
   getSoleAdminHuntingDistrictIds(userId: string) {
      const user = this.findUserById(userId);
      if (!user) return [];
      return user.memberships
         .filter(
            (membership) =>
               membership.status === 'active' &&
               membership.isAdmin &&
               this.countActiveHuntingDistrictAdmins(membership.revierId) === 1,
         )
         .map((membership) => membership.revierId);
   }

   /** Counts active system administrator accounts (used to prevent removing the last one). */
   countActiveSystemAdmins() {
      return this.data.users.filter(
         (user) => user.accountType === 'systemAdmin' && user.status === 'active',
      ).length;
   }

   /**
    * Creates or replaces a user's membership in one hunting district.
    * Throws `USER_NOT_FOUND`, `SYSTEM_ADMIN_MEMBERSHIP` (system admins can't hold memberships),
    * `GUEST_PRIVILEGES` (guests can't get a position/admin flag), or `LAST_REVIER_ADMIN`.
    */
   async upsertMembership(
      userId: string,
      input: Omit<HuntingDistrictMembership, 'createdAt' | 'updatedAt' | 'source' | 'position'> & {
         source?: HuntingDistrictMembership['source'];
         position?: OrganizationalRole | null;
      },
   ) {
      return this.enqueue(async () => {
         const user = this.findUserById(userId);
         if (!user) throw new Error('USER_NOT_FOUND');
         if (user.accountType === 'systemAdmin') throw new Error('SYSTEM_ADMIN_MEMBERSHIP');
         const now = new Date().toISOString();
         if (input.memberType === 'guest' && (input.position || input.isAdmin)) {
            throw new Error('GUEST_PRIVILEGES');
         }
         const existing = user.memberships.find((membership) => membership.revierId === input.revierId);
         if (
            existing?.status === 'active' &&
            existing.isAdmin &&
            (input.status !== 'active' || !input.isAdmin) &&
            this.countActiveHuntingDistrictAdmins(input.revierId) <= 1
         ) {
            throw new Error('LAST_REVIER_ADMIN');
         }
         const membership: HuntingDistrictMembership = {
            ...input,
            position: input.position ?? undefined,
            source: input.source ?? existing?.source ?? 'systemAdmin',
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
         };
         if (existing) Object.assign(existing, membership);
         else user.memberships.push(membership);
         if (membership.status === 'active') user.status = 'active';
         user.updatedAt = now;
         return membership;
      });
   }

   /** Ensures the given user holds an active, admin Pächter membership in the hunting district they created. */
   async ensureHuntingDistrictOwner(userId: string, revierId: string) {
      const user = this.findUserById(userId);
      if (!user || user.accountType === 'systemAdmin') return;
      const existing = user.memberships.find((membership) => membership.revierId === revierId);
      await this.upsertMembership(userId, {
         revierId,
         status: 'active',
         memberType: 'paechter',
         position: existing?.position,
         isAdmin: true,
         source: existing?.source ?? 'systemAdmin',
      });
   }

   /**
    * Removes a user's membership in one hunting district.
    * Throws `USER_NOT_FOUND`, `LAST_REVIER_ADMIN`, or `MEMBERSHIP_NOT_FOUND`.
    */
   async removeMembership(userId: string, revierId: string) {
      return this.enqueue(async () => {
         const user = this.findUserById(userId);
         if (!user) throw new Error('USER_NOT_FOUND');
         const membership = user.memberships.find((entry) => entry.revierId === revierId);
         if (
            membership?.status === 'active' &&
            membership.isAdmin &&
            this.countActiveHuntingDistrictAdmins(revierId) <= 1
         ) {
            throw new Error('LAST_REVIER_ADMIN');
         }
         const initialLength = user.memberships.length;
         user.memberships = user.memberships.filter((membership) => membership.revierId !== revierId);
         if (user.memberships.length === initialLength) throw new Error('MEMBERSHIP_NOT_FOUND');
         user.updatedAt = new Date().toISOString();
      });
   }

   /** Returns all users a Revieradmin (or system admin) is allowed to manage: themselves plus members of their administered districts. */
   getUsersForAdmin(userId: string) {
      const administrator = this.findUserById(userId);
      if (!administrator) return [];
      if (administrator.accountType === 'systemAdmin') return this.getAllUsers();
      const adminRevierIds = new Set(this.getAdminHuntingDistrictIds(userId));
      return this.getAllUsers().filter((user) =>
         user.id === userId ||
         user.memberships.some((membership) => adminRevierIds.has(membership.revierId)),
      );
   }

   /** Returns a data-minimal member list (name, type, position, joined time) for one hunting district's active members. */
   getMemberDirectory(revierId: string) {
      return this.data.users.flatMap((user) => {
         if (user.status !== 'active') return [];
         const membership = user.memberships.find(
            (entry) => entry.revierId === revierId && entry.status === 'active',
         );
         if (!membership) return [];
         return [{
            id: user.id,
            displayName: user.displayName,
            memberType: membership.memberType,
            position: membership.position,
            createdAt: membership.createdAt,
         }];
      });
   }

   /** Picks a display name for the public district contact: the creator if still an active admin, otherwise the first active admin alphabetically, otherwise the (still active) creator. */
   getHuntingDistrictContactName(revierId: string, creatorId: string) {
      const activeAdministrators = this.data.users
         .filter(
            (user) =>
               user.status === 'active' &&
               user.memberships.some(
                  (membership) =>
                     membership.revierId === revierId &&
                     membership.status === 'active' &&
                     membership.isAdmin,
               ),
         )
         .sort((left, right) => left.displayName.localeCompare(right.displayName, 'de'));
      const creator = this.findUserById(creatorId);
      const contact = activeAdministrators.find((user) => user.id === creatorId)
         ?? activeAdministrators[0]
         ?? (creator?.status === 'active' ? creator : undefined);
      return contact?.displayName;
   }

   /**
    * Records the current timestamp as the user's last login.
    * @returns The previous `lastLoginAt` value (shown on the welcome screen).
    */
   async recordLogin(userId: string) {
      return this.enqueue(async () => {
         const user = this.data.users.find((entry) => entry.id === userId);
         if (!user) return undefined;
         const previousLoginAt = user.lastLoginAt;
         user.lastLoginAt = new Date().toISOString();
         return previousLoginAt;
      });
   }

   getLastNewsSeenAt(userId: string) {
      return this.findUserById(userId)?.lastNewsSeenAt;
   }

   /**
    * Marks all news as seen for the user and returns the new timestamp.
    */
   async markNewsSeen(userId: string) {
      return this.enqueue(async () => {
         const user = this.data.users.find((entry) => entry.id === userId);
         if (!user) throw new Error('USER_NOT_FOUND');
         user.lastNewsSeenAt = new Date().toISOString();
         return user.lastNewsSeenAt;
      });
   }

   /** Marks one news section as seen for the user and returns its new timestamp. */
   async markNewsSectionSeen(userId: string, section: NewsSection) {
      return this.enqueue(async () => {
         const user = this.data.users.find((entry) => entry.id === userId);
         if (!user) throw new Error('USER_NOT_FOUND');
         const seenAt = new Date().toISOString();
         user.sectionNewsSeenAt ??= {};
         user.sectionNewsSeenAt[section] = seenAt;
         return seenAt;
      });
   }

   /**
    * Serialises all write operations so they execute one at a time.
    * Each operation modifies in-memory state and then flushes it to disk.
    */
   private async enqueue<T>(operation: () => Promise<T>) {
      let result: T;
      const operationPromise = this.writeQueue.then(async () => {
         result = await operation();
         await this.persist();
      });
      this.writeQueue = operationPromise.catch(() => undefined);
      await operationPromise;
      return result!;
   }

   /**
    * Atomically writes auth.json by first writing to a temp file then renaming it.
    * This prevents corrupt files if the process is killed mid-write.
    */
   private async persist() {
      const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
      await writeFile(
         temporaryPath,
         `${JSON.stringify(this.data, null, 2)}\n`,
         'utf8',
      );
      await rename(temporaryPath, this.filePath);
   }
}

interface AuthData {
   users: User[];
   passwordTokens: PasswordToken[];
   sessions: Session[];
}
