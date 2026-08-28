import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export type UserRole = 'admin' | 'member'
export type UserStatus = 'active' | 'pending'

export interface User {
  id: string
  username: string
  email: string
  displayName: string
  passwordHash?: string
  role: UserRole
  status: UserStatus
  createdAt: string
  updatedAt: string
}

interface PasswordToken {
  id: string
  userId: string
  tokenHash: string
  expiresAt: string
}

interface AuthData {
  users: User[]
  passwordTokens: PasswordToken[]
}

const emptyData = (): AuthData => ({ users: [], passwordTokens: [] })

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

export class AuthStore {
  private data: AuthData = emptyData()
  private writeQueue = Promise.resolve()
  private readonly filePath: string

  constructor(dataDirectory: string) {
    this.filePath = join(dataDirectory, 'auth.json')
  }

  async initialize() {
    await mkdir(dirname(this.filePath), { recursive: true })

    try {
      this.data = JSON.parse(await readFile(this.filePath, 'utf8')) as AuthData
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
      await this.persist()
    }
  }

  findUser(identifier: string) {
    const normalized = identifier.trim().toLowerCase()
    return this.data.users.find(
      (user) => user.username.toLowerCase() === normalized || user.email.toLowerCase() === normalized,
    )
  }

  async createUser(input: Pick<User, 'username' | 'email' | 'displayName' | 'role' | 'status'>) {
    return this.enqueue(async () => {
      if (this.findUser(input.username) || this.data.users.some((user) => user.email.toLowerCase() === input.email.toLowerCase())) {
        throw new Error('USER_EXISTS')
      }

      const now = new Date().toISOString()
      const user: User = { id: randomUUID(), ...input, createdAt: now, updatedAt: now }
      this.data.users.push(user)
      return user
    })
  }

  async createPasswordToken(userId: string) {
    return this.enqueue(async () => {
      const token = randomBytes(32).toString('base64url')
      const now = Date.now()
      this.data.passwordTokens = this.data.passwordTokens.filter(
        (entry) => entry.userId !== userId && Date.parse(entry.expiresAt) > now,
      )
      this.data.passwordTokens.push({
        id: randomUUID(),
        userId,
        tokenHash: hashToken(token),
        expiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
      })
      return token
    })
  }

  async setPassword(token: string, passwordHash: string) {
    return this.enqueue(async () => {
      const now = Date.now()
      const tokenHash = hashToken(token)
      const tokenIndex = this.data.passwordTokens.findIndex(
        (entry) => entry.tokenHash === tokenHash && Date.parse(entry.expiresAt) > now,
      )
      if (tokenIndex === -1) {
        return false
      }

      const passwordToken = this.data.passwordTokens[tokenIndex]
      const user = this.data.users.find((entry) => entry.id === passwordToken.userId)
      if (!user) {
        return false
      }

      user.passwordHash = passwordHash
      user.updatedAt = new Date(now).toISOString()
      this.data.passwordTokens = this.data.passwordTokens.filter((entry) => entry.userId !== user.id)
      return true
    })
  }

  async updateUser(userId: string, input: Pick<User, 'username' | 'email' | 'displayName' | 'role' | 'status'>) {
    return this.enqueue(async () => {
      const user = this.data.users.find((entry) => entry.id === userId)
      if (!user) {
        throw new Error('USER_NOT_FOUND')
      }
      const duplicate = this.data.users.find(
        (entry) => entry.id !== userId && (entry.username.toLowerCase() === input.username.toLowerCase() || entry.email.toLowerCase() === input.email.toLowerCase()),
      )
      if (duplicate) {
        throw new Error('USER_EXISTS')
      }
      Object.assign(user, input, { passwordHash: undefined, updatedAt: new Date().toISOString() })
      this.data.passwordTokens = this.data.passwordTokens.filter((entry) => entry.userId !== userId)
      return user
    })
  }

  private async enqueue<T>(operation: () => Promise<T>) {
    let result: T
    const operationPromise = this.writeQueue.then(async () => {
      result = await operation()
      await this.persist()
    })
    this.writeQueue = operationPromise.catch(() => undefined)
    await operationPromise
    return result!
  }

  private async persist() {
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8')
    await rename(temporaryPath, this.filePath)
  }
}