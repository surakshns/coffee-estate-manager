import { webcrypto, randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'

const [destination, appUrl, contact] = process.argv.slice(2)
if (!destination || !appUrl || !contact || !appUrl.startsWith('https://') || !contact.startsWith('mailto:')) {
  throw new Error('Usage: node scripts/generate-reminder-secrets.mjs /private/path/reminders.env https://your-app.example/ mailto:you@example.com')
}
const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const exported = { publicKey: await webcrypto.subtle.exportKey('jwk', keys.publicKey), privateKey: await webcrypto.subtle.exportKey('jwk', keys.privateKey) }
const contents = [
  `REMINDER_VAPID_KEYS=${JSON.stringify(exported)}`,
  `REMINDER_CRON_SECRET=${randomBytes(32).toString('base64url')}`,
  `REMINDER_VAPID_CONTACT=${contact}`,
  `REMINDER_APP_URL=${appUrl}`,
  'REMINDER_DELIVERY_ENABLED=false',
  ''
].join('\n')
writeFileSync(destination, contents, { flag: 'wx', mode: 0o600 })
console.log(`Created ${destination}. Keep this private; it contains server signing credentials.`)
