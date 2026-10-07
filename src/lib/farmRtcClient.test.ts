import { describe, expect, it, vi } from 'vitest'
import { loadRtcRecord, rtcExtentText, type RtcLookupRequest, type RtcRecord } from './farmRtcClient'
const request: RtcLookupRequest = { villageCode: '2301110012', surveyNumber: '92', surnoc: '*', hissaNumber: '1' }
const record: RtcRecord = { identity: request, villageName: 'Hebbasale', landCode: '123', ulpin: null, extent: { acres: '2', guntas: '3', fractionalGuntas: '4' }, owners: [], sourceUrl: 'https://rdservices.karnataka.gov.in/BhoomiMaps/', retrievedAt: '2026-10-07T13:00:00Z' }
describe('private RTC client', () => {
  it('loads a matching record without caching or modifying its published extent', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: record, error: null }), signal = new AbortController().signal
    expect(await loadRtcRecord(request, signal, invoke)).toEqual(record)
    expect(invoke).toHaveBeenCalledWith(request, signal)
    expect(rtcExtentText(record.extent)).toBe('2 acres · 3 guntas · 4 fractional guntas')
  })
  it('rejects a stale or foreign parcel record', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { ...record, identity: { ...request, hissaNumber: '2' } }, error: null })
    await expect(loadRtcRecord(request, new AbortController().signal, invoke)).rejects.toThrow(/does not match/)
  })
  it('rejects malformed owners and unexpected source URLs', async () => {
    const signal = new AbortController().signal
    await expect(loadRtcRecord(request, signal, async () => ({ data: { ...record, owners: [{}] }, error: null }))).rejects.toThrow(/verified/)
    await expect(loadRtcRecord(request, signal, async () => ({ data: { ...record, sourceUrl: 'https://untrusted.test/' }, error: null }))).rejects.toThrow(/verified/)
  })
  it('drops a response completed after cancellation', async () => {
    const controller = new AbortController()
    await expect(loadRtcRecord(request, controller.signal, async () => { controller.abort(); return { data: record, error: null } })).rejects.toHaveProperty('name', 'AbortError')
  })
  it('gives sign-in and rate-limit messages without reflecting a source error', async () => {
    for (const [status, message] of [[401, /sign in/], [429, /Wait a minute/]] as const) {
      await expect(loadRtcRecord(request, new AbortController().signal, async () => ({ data: null, error: { context: new Response('sensitive', { status }) } }))).rejects.toThrow(message)
    }
  })
})
