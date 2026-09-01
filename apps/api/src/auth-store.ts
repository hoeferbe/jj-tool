import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Possible membership roles within the hunting group. */
export type UserRole = 'admin' | 'paechter' | 'bgs' | 'guest';
/** Account lifecycle state: pending = awaiting admin approval, active = approved. */
export type UserStatus = 'active' | 'pending';
/** Optional organisational position a member can hold. */
export type UserPosition = 'revierleiter' | 'kassenwart' | 'schriftfuehrer';

/** Full user record as stored in auth.json (passwordHash excluded from API responses). */
export interface User {
   id: string;
   username: string;
   email: string;
   displayName: string;
   passwordHash?: string;
   role: UserRole;
   status: UserStatus;
   position?: UserPosition;
   /** Grants admin-dashboard access without changing the base role. */
   isAdmin?: boolean;
   lastLoginAt?: string;
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

/** Shape of the persisted auth.json file. */
interface AuthData {
   users: User[];
   passwordTokens: PasswordToken[];
   sessions: Session[];
}

const emptyData = (): AuthData => ({
   users: [],
   passwordTokens: [],
   sessions: [],
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
         this.data = JSON.parse(
            await readFile(this.filePath, 'utf8'),
         ) as AuthData;
         // Older files may not have a sessions array yet.
         this.data.sessions ??= [];
         // Migrate legacy 'member' role to 'paechter'.
         const legacy = this.data.users.filter(
            (u) => (u.role as string) === 'member',
         );
         if (legacy.length > 0) {
            legacy.forEach((u) => {
               u.role = 'paechter';
            });
            await this.persist();
         }
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
         'username' | 'email' | 'displayName' | 'role' | 'status'
      >,
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
         'username' | 'email' | 'displayName' | 'role' | 'status'
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
   async approveUser(userId: string, role: UserRole, position?: UserPosition, isAdmin = false) {
      return this.enqueue(async () => {
         const user = this.data.users.find((entry) => entry.id === userId);
         if (!user) {
            throw new Error('USER_NOT_FOUND');
         }
         user.status = 'active';
         user.role = role;
         user.position = position;
         // Guests can never hold admin rights.
         user.isAdmin = role !== 'guest' && isAdmin;
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
         this.data.users.splice(index, 1);
         // Cascade: clean up tokens and sessions that belong to the deleted user.
         this.data.passwordTokens = this.data.passwordTokens.filter(
            (entry) => entry.userId !== userId,
         );
         this.data.sessions = this.data.sessions.filter(
            (entry) => entry.userId !== userId,
         );
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
      position?: UserPosition,
      isAdmin?: boolean,
   ) {
      return this.enqueue(async () => {
         const user = this.data.users.find((entry) => entry.id === userId);
         if (!user) {
            throw new Error('USER_NOT_FOUND');
         }
         user.role = role;
         user.position = position;
         // Demoting to guest always strips admin rights.
         if (role === 'guest') user.isAdmin = false;
         else if (isAdmin !== undefined) user.isAdmin = isAdmin;
         user.updatedAt = new Date().toISOString();
         return user;
      });
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

export interface User {
   id: string;
   username: string;
   email: string;
   displayName: string;
   passwordHash?: string;
   role: UserRole;
   status: UserStatus;
   position?: UserPosition;
   isAdmin?: boolean;
   lastLoginAt?: string;
   createdAt: string;
   updatedAt: string;
}

interface PasswordToken {
   id: string;
   userId: string;
   tokenHash: string;
   expiresAt: string;
}

interface Session {
   id: string;
   userId: string;
   createdAt: string;
}

interface AuthData {
   users: User[];
   passwordTokens: PasswordToken[];
   sessions: Session[];
}
