import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { AuthStore } from './auth-store.js'
import { sendPasswordLink } from './mailer.js'

config({ path: fileURLToPath(new URL('../.env', import.meta.url)) })

const [username, email, displayName] = process.argv.slice(2)

if (!username || !email || !displayName) {
  console.error('Usage: npm run reset-admin -- <username> <email> <display-name>')
  process.exit(1)
}

const dataDirectory = process.env.DATA_DIRECTORY ?? './data'
const appOrigin = process.env.APP_ORIGIN ?? 'http://127.0.0.1:5173'
const authStore = new AuthStore(dataDirectory)

await authStore.initialize()

const existingUser = authStore.findUser(username)
const admin = existingUser
  ? await authStore.updateUser(existingUser.id, { username, email, displayName, accountType: 'systemAdmin', status: 'active' })
  : await authStore.createUser({ username, email, displayName, accountType: 'systemAdmin', status: 'active' })
const token = await authStore.createPasswordToken(admin.id)
const passwordLink = `${appOrigin}/?set-password=${encodeURIComponent(token)}`

await sendPasswordLink({ email: admin.email, displayName: admin.displayName, passwordLink })
console.log(`Admin account '${admin.username}' is active. A password link was sent to ${admin.email}.`)