import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const script = fileURLToPath(new URL('./generate-reminder-secrets.mjs', import.meta.url))
let directory: string
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'estate-reminder-generator-')) })
afterEach(() => { rmSync(directory, { recursive: true, force: true }) })

describe('private reminder secrets generator', () => {
  it('creates missing parent folders and a private secrets file without printing its contents', () => {
    const destination = join(directory, 'config', 'estate', 'reminders.env')
    const output = execFileSync(process.execPath, [script, destination, 'https://estate.example/app/', 'mailto:owner@example.com'], { encoding: 'utf8' })
    expect(statSync(join(directory, 'config', 'estate')).mode & 0o777).toBe(0o700)
    expect(statSync(destination).mode & 0o777).toBe(0o600)
    const values = Object.fromEntries(readFileSync(destination, 'utf8').trim().split('\n').map(line => {
      const separator = line.indexOf('=')
      return [line.slice(0, separator), line.slice(separator + 1)]
    }))
    expect(values.REMINDER_APP_URL).toBe('https://estate.example/app/')
    expect(values.REMINDER_DELIVERY_ENABLED).toBe('false')
    expect(Object.hasOwn(JSON.parse(values.REMINDER_VAPID_KEYS).privateKey, 'd')).toBe(true)
    expect(values.REMINDER_CRON_SECRET.length).toBeGreaterThanOrEqual(32)
    expect(output.includes(values.REMINDER_CRON_SECRET)).toBe(false)
    expect(output.includes(values.REMINDER_VAPID_KEYS)).toBe(false)
  })

  it('preserves existing signing keys and explains how to avoid accidentally replacing them', () => {
    const destination = join(directory, 'reminders.env')
    const args = [script, destination, 'https://estate.example/', 'mailto:owner@example.com']
    execFileSync(process.execPath, args, { encoding: 'utf8' })
    const previous = readFileSync(destination)
    const retry = spawnSync(process.execPath, args, { encoding: 'utf8' })
    expect(retry.status).toBe(1)
    expect(retry.stderr).toContain('Keep the existing keys')
    expect(readFileSync(destination).equals(previous)).toBe(true)
  })

  it('shows a usable folder in its usage message', () => {
    const missing = spawnSync(process.execPath, [script], { encoding: 'utf8' })
    expect(missing.status).toBe(1)
    expect(missing.stderr).toContain('$HOME/.config/coffee-estate-manager/reminders.env')
    expect(missing.stderr).not.toContain('/private/path')
  })

  it('rejects invalid app URLs and multi-line email values before creating a file', () => {
    const destination = join(directory, 'reminders.env')
    const result = spawnSync(process.execPath, [script, destination, 'http://estate.example/', 'mailto:owner@example.com\nREMINDER_DELIVERY_ENABLED=true'], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Use your HTTPS app URL')
    expect(() => statSync(destination)).toThrow()
  })
})
