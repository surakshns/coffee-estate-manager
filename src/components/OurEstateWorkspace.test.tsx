// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OurEstateWorkspace } from './OurEstateWorkspace'
import type { EstateHolderStatus } from '../lib/estateHoldingsClient'
import type { RtcRecord } from '../lib/farmRtcClient'

const api = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('../lib/estateHoldingsClient', () => ({ loadEstateHolderStatus: api.load }))
const identity = { villageCode: '2301110038' as const, surveyNumber: '72', surnoc: '*', hissaNumber: '4' }
const record = { identity } as RtcRecord
vi.mock('./OurEstate', () => ({ OurEstate: (props: {
  targetName?: string; ownershipLoading: boolean; ownershipStatus: string; ownershipTotalAcres: number;
  onChooseHolder: (record: RtcRecord, name: string) => Promise<void>; onRefreshOwnership: () => void;
}) => <div>
  <span>{props.targetName ?? 'Unconfigured'}</span><span>{props.ownershipStatus}</span><span>{props.ownershipTotalAcres} acres</span>
  <button disabled={props.ownershipLoading} onClick={() => void props.onChooseHolder(record, 'Synthetic holder').catch(() => {})}>Choose holder</button>
  <button onClick={props.onRefreshOwnership}>Refresh status</button>
</div> }))
const status: EstateHolderStatus = { holderName: 'Synthetic holder', configuredAt: '2026-10-07T03:00:00Z', matches: [{ identity, matchedAcres: 1.25, landCode: 'synthetic-land', lastCheckedAt: '2026-10-07T03:00:00Z' }], surveysTotal: 2, surveysChecked: 1, recordsChecked: 1, pending: 1, unavailable: 0, lastCheckedAt: '2026-10-07T03:00:00Z' }
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); api.load.mockResolvedValue(null) })
afterEach(() => { cleanup(); vi.useRealTimers() })
async function settle() { await act(async () => {}) }

describe('Our Estate account workspace', () => {
  it('retains partial acreage and honestly reports unknown shares and incomplete inventory', async () => {
    api.load.mockResolvedValue({ ...status, matches: [...status.matches, { ...status.matches[0], landCode: 'unknown-land', matchedAcres: null }] })
    render(<OurEstateWorkspace userId="first-account" />); await settle()
    expect(screen.getByText('1.25 acres')).toBeTruthy()
    expect(screen.getByText(/background check continues/)).toBeTruthy()
    expect(screen.getByText(/1 matching records have an extent/)).toBeTruthy()
    api.load.mockResolvedValue({ ...status, surveysTotal: 0, surveysChecked: 0, pending: 0 })
    fireEvent.click(screen.getByText('Refresh status')); await settle()
    expect(screen.getByText(/inventory is not yet complete/)).toBeTruthy()
    expect(screen.queryByText(/All available RTC options/)).toBeNull()
  })
  it('does not interrupt holder verification with visibility or periodic status refreshes', async () => {
    render(<OurEstateWorkspace userId="first-account" />); await settle()
    let finish!: (value: EstateHolderStatus) => void
    api.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    fireEvent.click(screen.getByText('Choose holder')); await settle()
    const signal = api.load.mock.calls[1][0] as AbortSignal
    fireEvent(document, new Event('visibilitychange'))
    await act(async () => { await vi.advanceTimersByTimeAsync(60000) })
    expect(api.load).toHaveBeenCalledTimes(2); expect(signal.aborted).toBe(false)
    await act(async () => finish(status))
    expect(screen.getByText('Synthetic holder')).toBeTruthy()
    api.load.mockResolvedValue(status)
    await act(async () => { await vi.advanceTimersByTimeAsync(60000) })
    expect(api.load).toHaveBeenCalledTimes(3)
  })
  it('clears an old account immediately and ignores its unfinished status response', async () => {
    api.load.mockResolvedValueOnce(status)
    const view = render(<OurEstateWorkspace userId="first-account" />); await settle()
    expect(screen.getByText('Synthetic holder')).toBeTruthy()
    let finish!: (value: EstateHolderStatus) => void
    api.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    fireEvent.click(screen.getByText('Refresh status')); await settle()
    const signal = api.load.mock.calls[1][0] as AbortSignal
    view.rerender(<OurEstateWorkspace userId="second-account" />)
    expect(screen.queryByText('Synthetic holder')).toBeNull(); expect(signal.aborted).toBe(true)
    await act(async () => finish(status))
    expect(screen.getByText('Unconfigured')).toBeTruthy()
    expect(screen.getByText('0 acres')).toBeTruthy()
  })
  it('aborts a pending holder choice on account change and does not inherit its result', async () => {
    const view = render(<OurEstateWorkspace userId="first-account" />); await settle()
    let finish!: (value: EstateHolderStatus) => void
    api.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    fireEvent.click(screen.getByText('Choose holder')); await settle()
    const signal = api.load.mock.calls[1][0] as AbortSignal
    view.rerender(<OurEstateWorkspace userId="second-account" />)
    expect(signal.aborted).toBe(true)
    await act(async () => finish(status))
    expect(screen.queryByText('Synthetic holder')).toBeNull()
    expect(screen.getByText('Unconfigured')).toBeTruthy()
  })
  it('keeps markers after a status failure and allows a fresh retry', async () => {
    api.load.mockResolvedValueOnce(status)
    render(<OurEstateWorkspace userId="first-account" />); await settle()
    api.load.mockRejectedValueOnce(new Error('Markers temporarily unavailable.'))
    fireEvent.click(screen.getByText('Refresh status')); await settle()
    expect(screen.getByText('Synthetic holder')).toBeTruthy()
    expect(screen.getByText('1.25 acres')).toBeTruthy()
    api.load.mockResolvedValue(status)
    fireEvent.click(screen.getByText('Refresh status')); await settle()
    expect(api.load).toHaveBeenCalledTimes(3)
  })
})
