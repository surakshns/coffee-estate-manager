import { webcrypto, randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const [destination, appUrl, contact] = process.argv.slice(2)

async function generate() {
  if (!destination || !appUrl || !contact) {
    throw new Error('Usage: node scripts/generate-reminder-secrets.mjs "$HOME/.config/coffee-estate-manager/reminders.env" https://your-app.example/ mailto:you@example.com')
  }
  const url = new URL(appUrl)
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || /[\r\n]/.test(appUrl) || !/^mailto:[^\s]+@[^\s]+$/.test(contact)) {
    throw new Error('Use your HTTPS app URL and a mailto: email address.')
  }
  const filePath = resolve(destination)
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 })
  const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const exported = { publicKey: await webcrypto.subtle.exportKey('jwk', keys.publicKey), privateKey: await webcrypto.subtle.exportKey('jwk', keys.privateKey) }
  const contents = [
    `REMINDER_VAPID_KEYS=${JSON.stringify(exported)}`,
    `REMINDER_CRON_SECRET=${randomBytes(32).toString('base64url')}`,
    `REMINDER_VAPID_CONTACT=${contact}`,
    `REMINDER_APP_URL=${url.href}`,
    'REMINDER_DELIVERY_ENABLED=false',
    ''
  ].join('\n')
  writeFileSync(filePath, contents, { flag: 'wx', mode: 0o600 })
  console.log(`Created ${filePath}. Keep this private; it contains server signing credentials.`)
}

generate().catch(error => {
  if (error.code === 'EEXIST') console.error(`The destination already exists: ${destination}. Keep the existing keys; the file was not changed.`)
  else if (error.code === 'EACCES' || error.code === 'EPERM') console.error('Cannot write to that folder. Use "$HOME/.config/coffee-estate-manager/reminders.env" as the destination.')
  else console.error(error.message)
  process.exitCode = 1
})
