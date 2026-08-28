import { serve } from '@hono/node-server'
import { zValidator } from '@hono/zod-validator'
import argon2 from 'argon2'
import { config } from 'dotenv'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { SignJWT } from 'jose'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { AuthStore, type User } from './auth-store.js'
import { sendPasswordLink } from './mailer.js'

config({ path: fileURLToPath(new URL('../.env', import.meta.url)) })

const app = new Hono()
const dataDirectory = process.env.DATA_DIRECTORY ?? './data'
const appOrigin = process.env.APP_ORIGIN ?? 'http://127.0.0.1:5173'
const authStore = new AuthStore(dataDirectory)
const authSecret = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'development-only-secret-change-me')
const allowedOrigins = new Set([appOrigin, 'http://localhost:5173', 'http://127.0.0.1:5173'])

app.use('*', cors({ origin: (origin) => (origin && allowedOrigins.has(origin) ? origin : ''), credentials: true }))

app.get('/health', (context) => context.json({ status: 'ok' }))

const registrationSchema = z.object({
  username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/),
  email: z.string().trim().email(),
  displayName: z.string().trim().min(2).max(80),
})
const loginSchema = z.object({ identifier: z.string().trim().min(3), password: z.string().min(1) })
const emailSchema = z.object({ email: z.string().trim().email() })
const passwordSchema = z.object({ token: z.string().min(1), password: z.string().min(12).max(128) })

const createPasswordLink = async (user: User) => {
  const token = await authStore.createPasswordToken(user.id)
  await sendPasswordLink({
    email: user.email,
    displayName: user.displayName,
    passwordLink: `${appOrigin}/?set-password=${encodeURIComponent(token)}`,
  })
}

app.post('/auth/register', zValidator('json', registrationSchema), async (context) => {
  const input = context.req.valid('json')
  try {
    const user = await authStore.createUser({ ...input, role: 'member', status: 'pending' })
    await createPasswordLink(user)
    return context.json({ message: 'Registrierung erhalten. Pruefe deine E-Mails, um ein Passwort zu setzen.' }, 201)
  } catch (error) {
    if ((error as Error).message === 'USER_EXISTS') {
      return context.json({ message: 'Benutzername oder E-Mail-Adresse ist bereits registriert.' }, 409)
    }
    throw error
  }
})

app.post('/auth/login', zValidator('json', loginSchema), async (context) => {
  const { identifier, password } = context.req.valid('json')
  const user = authStore.findUser(identifier)
  if (!user) {
    return context.json({ message: 'Benutzername oder Passwort ist nicht korrekt.' }, 401)
  }
  if (!user.passwordHash) {
    await createPasswordLink(user)
    return context.json({ code: 'PASSWORD_SETUP_REQUIRED', message: 'Ein Link zum Setzen des Passworts wurde per E-Mail versendet.' }, 409)
  }
  if (!(await argon2.verify(user.passwordHash, password))) {
    return context.json({ message: 'Benutzername oder Passwort ist nicht korrekt.' }, 401)
  }
  if (user.status !== 'active') {
    return context.json({ code: 'PENDING_APPROVAL', message: 'Dein Konto wartet noch auf die Freigabe durch einen Administrator.' }, 403)
  }

  const accessToken = await new SignJWT({ role: user.role, username: user.username })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(authSecret)

  return context.json({ accessToken, user: { id: user.id, displayName: user.displayName, role: user.role } })
})

app.post('/auth/password/forgot', zValidator('json', emailSchema), async (context) => {
  const { email } = context.req.valid('json')
  const user = authStore.findUser(email)
  if (user) {
    await createPasswordLink(user)
  }
  return context.json({ message: 'Wenn die E-Mail-Adresse registriert ist, wurde ein Passwort-Link versendet.' })
})

app.post('/auth/password/reset', zValidator('json', passwordSchema, (result, context) => {
  if (!result.success) {
    return context.json({ message: 'Das Passwort muss mindestens 12 Zeichen lang sein.' }, 400)
  }
}), async (context) => {
  const { token, password } = context.req.valid('json')
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id })
  const wasSet = await authStore.setPassword(token, passwordHash)
  if (!wasSet) {
    return context.json({ message: 'Der Passwort-Link ist ungueltig oder abgelaufen.' }, 400)
  }
  return context.json({ message: 'Passwort gesetzt. Du kannst dich jetzt anmelden.' })
})

const initializeInitialAdmin = async () => {
  const { INITIAL_ADMIN_USERNAME, INITIAL_ADMIN_EMAIL, INITIAL_ADMIN_NAME } = process.env
  if (!INITIAL_ADMIN_USERNAME || !INITIAL_ADMIN_EMAIL || !INITIAL_ADMIN_NAME) {
    return
  }
  if (authStore.findUser(INITIAL_ADMIN_USERNAME)) {
    return
  }
  const admin = await authStore.createUser({
    username: INITIAL_ADMIN_USERNAME,
    email: INITIAL_ADMIN_EMAIL,
    displayName: INITIAL_ADMIN_NAME,
    role: 'admin',
    status: 'active',
  })
  await createPasswordLink(admin)
}

const port = Number(process.env.PORT ?? 8787)

await authStore.initialize()
await initializeInitialAdmin()

serve({ fetch: app.fetch, port }, () => {
  console.log(`API is listening on http://localhost:${port}`)
})